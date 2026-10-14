// F169 phase 4 (C3): the store writer behind POST /api/feeds/refresh. refreshDue claims the due
// modules, runs the existing loaders four at a time, keeps only live answers, and records every
// claimed module with its lease token. While it runs, each outside host gets one request at a time
// and a host that refuses (429 or 403) is closed for the rest of the run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FEED_CAPS, classifyAnswer, itemsFromRows, metaFor, refreshDue, supabaseRpc } from '../../server/feedStore.mjs';

const token = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fake database: feed_claim_due hands out the queued modules in order; feed_record keeps what it was sent. */
function fakeDb(features, { recordAnswer, tier = 'news' } = {}) {
  const queue = features.map((f, i) => (typeof f === 'string' ? { tier, feature: f, variant: '' } : { variant: '', ...f }))
    .map((m, i) => ({ class: 'news', kind: 'news', interval_minutes: 30, lease_token: token(i), ...m }));
  const claimed = [];
  const claims = [];
  const records = [];
  const rpc = vi.fn(async (name, args) => {
    if (name === 'feed_claim_due') {
      claims.push(args);
      const out = queue.splice(0, args.p_limit);
      claimed.push(...out);
      return out;
    }
    if (name === 'feed_record') {
      records.push(args.p);
      if (recordAnswer) return recordAnswer(args.p);
      return { status: args.p.status, items: (args.p.items || []).length, new_items: (args.p.items || []).length };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  return { rpc, claims, records, claimed, queue };
}

const live = (rows, extra = {}) => ({
  ok: true,
  tier: 'news',
  feature: 'x',
  rows,
  source: { adapter: 'rss', links: ['https://wire.example/feed'], note: 'Live wire', gdelt: false, kind: '' },
  coverage: { from: '', through: '', exhaustive: false },
  fallback: false,
  timeline: [],
  meta: null,
  ...extra,
});
const row = (i, extra = {}) => ({ date: '2026-10-14', title: `Item ${i}`, source_url: `https://wire.example/a/${i}`, ...extra });
const statusRow = (reason = 'host did not respond') => ({
  date: '2026-10-15', title: 'Source offline or empty', source_url: '', status: 'source_status', fail_reason: reason,
});
const byFeature = (records) => Object.fromEntries(records.map((r) => [r.feature, r]));

describe('classifyAnswer: only live answers are kept', () => {
  it('maps live, empty, status-row, fallback, backup, stored, archive and planned answers', () => {
    expect(classifyAnswer(live([row(1)])).status).toBe('ok');
    expect(classifyAnswer(live([])).status).toBe('empty');
    expect(classifyAnswer(live([statusRow('timed out')]))).toMatchObject({ status: 'failed', reason: expect.stringMatching(/timed out/) });
    expect(classifyAnswer(live([row(1)], { fallback: true })).status).toBe('failed');
    expect(classifyAnswer(live([row(1)], { fallback: true, served: 'archive', source: { adapter: 'embedded', kind: 'backup-pack' } })).status).toBe('failed');
    // A stored copy that does not call itself a fallback (the NSE feed's dated prices) is still not live.
    expect(classifyAnswer(live([row(1)], { source: { adapter: 'embedded', kind: 'finance-pack', links: [] } })).status).toBe('failed');
    expect(classifyAnswer(live([row(1)], { served: 'archive' })).status).toBe('failed');
    expect(classifyAnswer(live([], { source: { adapter: 'planned', links: [] } })).status).toBe('failed');
    expect(classifyAnswer({ ok: false, rows: [statusRow()], source: { note: 'unknown feature' } }).status).toBe('failed');
    expect(classifyAnswer(null).status).toBe('failed');
  });
});

describe('itemsFromRows: caps, keys and hashes', () => {
  it('drops a row over 64 KB and counts it, and dedupes keys within the batch (first kept)', () => {
    const big = row(1, { body: 'x'.repeat(70 * 1024) });
    const { items, dropped } = itemsFromRows([big, row(2), row(2, { title: 'Second copy' }), statusRow()]);
    expect(items.map((i) => i.title)).toEqual(['Item 2']);
    expect(dropped).toMatchObject({ oversize: 1, duplicate: 1, status_rows: 1 });
  });

  it('keeps at most 2,000 items and counts the rest', () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row(i));
    const { items, dropped } = itemsFromRows(rows);
    expect(items).toHaveLength(FEED_CAPS.items);
    expect(dropped.over_limit).toBe(500);
  });

  it('cuts the title to 1,000 characters, leaves out a link over 2,048, and keys stay within 2,000 bytes', () => {
    const longUrl = `https://wire.example/${'p'.repeat(3000)}`;
    const [item] = itemsFromRows([{ title: 'T'.repeat(1500), source_url: longUrl, date: '2026-10-14' }]).items;
    expect(item.title).toHaveLength(1000);
    expect(item.url).toBeNull();
    expect(Buffer.byteLength(item.item_key)).toBeLessThanOrEqual(2000);
    // A title of astral characters is cut by character, never through a surrogate pair.
    const [emoji] = itemsFromRows([{ title: '\u{1F600}'.repeat(1200), source_url: 'https://wire.example/e' }]).items;
    expect([...emoji.title]).toHaveLength(1000);
    expect(emoji.title.isWellFormed()).toBe(true);
  });

  it('takes published_at from the row date when it parses, sha256 of the row with sorted keys as the hash', () => {
    const a = itemsFromRows([{ title: 'A', source_url: 'https://wire.example/a', date: '2026-10-14' }]).items[0];
    const b = itemsFromRows([{ date: '2026-10-14', source_url: 'https://wire.example/a', title: 'A' }]).items[0];
    expect(a.published_at).toBe('2026-10-14T00:00:00.000Z');
    expect(a.content_hash).toBe(b.content_hash);
    const sorted = '{"date":"2026-10-14","source_url":"https://wire.example/a","title":"A"}';
    expect(a.content_hash).toBe(createHash('sha256').update(sorted).digest('hex'));
    expect(itemsFromRows([{ title: 'B', date: 'not a date' }]).items[0].published_at).toBeNull();
    // Day-first dates are ambiguous; they are not guessed.
    expect(itemsFromRows([{ title: 'C', date: '05/10/2026' }]).items[0].published_at).toBeNull();
    expect(itemsFromRows([{ title: 'D', date: 'Tue, 14 Oct 2026 10:00:00 GMT' }]).items[0].published_at).toBe('2026-10-14T10:00:00.000Z');
  });

  it('removes characters Postgres refuses (NUL, lone surrogates) from the stored row', () => {
    const [item] = itemsFromRows([{ title: 'a\u0000b', note: 'x\uD800y', source_url: 'https://wire.example/n' }]).items;
    expect(item.row.title).toBe('ab');
    expect(item.row.note.isWellFormed()).toBe(true);
  });
});

describe('metaFor', () => {
  it('carries the note, links, coverage and fetched time within 16 KB', () => {
    const body = live([row(1)], {
      source: { adapter: 'rss', note: 'n'.repeat(50_000), links: Array.from({ length: 500 }, (_, i) => `https://l.example/${i}/${'q'.repeat(100)}`) },
      coverage: { from: '2020', through: '2026', exhaustive: false },
    });
    const meta = metaFor(body, '2026-10-15T00:00:00.000Z');
    expect(Buffer.byteLength(JSON.stringify(meta))).toBeLessThanOrEqual(FEED_CAPS.metaBytes);
    expect(meta).toMatchObject({ adapter: 'rss', fetched_at: '2026-10-15T00:00:00.000Z', coverage: { from: '2020', through: '2026', exhaustive: false } });
    expect(meta.note.length).toBeGreaterThan(0);
    expect(meta.links.length).toBeGreaterThan(0);
  });
});

describe('refreshDue', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('records every claimed module with its lease token and the status its answer earns', async () => {
    const answers = {
      live: async () => live([row(1), row(2)]),
      empty: async () => live([]),
      throws: async () => { throw new Error('boom at https://api.example/x?api_key=SECRET123'); },
      'status row': async () => live([statusRow('source refused the request')]),
      fallback: async () => live([row(1)], { fallback: true }),
      backup: async () => live([row(1)], { fallback: true, served: 'archive', source: { adapter: 'embedded', kind: 'backup-pack' } }),
      stored: async () => live([row(1)], { source: { adapter: 'embedded', kind: 'finance-pack' } }),
      planned: async () => live([], { source: { adapter: 'planned' } }),
      slow: () => new Promise(() => {}),
    };
    const db = fakeDb(Object.keys(answers));
    const load = vi.fn((params) => answers[params.get('feature')]());
    const summary = await refreshDue({ rpc: db.rpc, load, budgetMs: 2000, moduleMs: 150, reserveMs: 200 });

    const got = byFeature(db.records);
    expect(Object.keys(got).sort()).toEqual(Object.keys(answers).sort());
    expect(got.live).toMatchObject({ status: 'ok', items: expect.any(Array), meta: expect.objectContaining({ adapter: 'rss' }) });
    expect(got.live.items).toHaveLength(2);
    expect(got.empty.status).toBe('empty');
    expect(got.throws).toMatchObject({ status: 'failed', error: expect.stringMatching(/boom/) });
    expect(got.throws.error).not.toMatch(/SECRET123/);
    expect(got['status row']).toMatchObject({ status: 'failed', error: expect.stringMatching(/refused/) });
    for (const f of ['fallback', 'backup', 'stored', 'planned']) {
      expect(got[f].status, f).toBe('failed');
      expect(got[f].items, f).toBeUndefined();
    }
    expect(got.slow.status).toBe('timeout');
    for (const c of db.claimed) expect(got[c.feature].lease_token).toBe(c.lease_token);
    for (const r of db.records) {
      expect(Number.isInteger(r.ms)).toBe(true);
      expect(Date.parse(r.started_at)).not.toBeNaN();
    }
    expect(summary.counts).toMatchObject({ ok: 1, empty: 1, failed: 6, timeout: 1 });
    expect(summary.claimed).toBe(9);
    expect(summary.ms).toEqual(expect.any(Number));
  });

  it('passes the Statement Tracker leader as the person parameter', async () => {
    const feature = 'Statement & Quote Tracker with Contradiction Detection';
    const db = fakeDb([{ tier: 'national', feature, variant: 'Amit Shah' }]);
    const load = vi.fn(async () => live([row(1)]));
    await refreshDue({ rpc: db.rpc, load });
    const params = load.mock.calls[0][0];
    expect(params.get('tier')).toBe('national');
    expect(params.get('feature')).toBe(feature);
    expect(params.get('person')).toBe('Amit Shah');
    expect(db.records[0]).toMatchObject({ variant: 'Amit Shah', status: 'ok' });
  });

  it('claims with the schedule from code, a bounded count and a lease that outlasts the budget', async () => {
    const db = fakeDb(['a']);
    await refreshDue({ rpc: db.rpc, load: async () => live([row(1)]), budgetMs: 55_000 });
    const first = db.claims[0];
    expect(first.p_runs.length).toBeGreaterThan(50);
    expect(first.p_runs[0]).toEqual(expect.objectContaining({ tier: expect.any(String), feature: expect.any(String), class: expect.any(String), kind: expect.any(String), interval_minutes: expect.any(Number) }));
    expect(first.p_limit).toBeGreaterThanOrEqual(1);
    expect(first.p_limit).toBeLessThanOrEqual(4);
    expect(first.p_lease_seconds).toBeGreaterThan(55);
    expect(first.p_lease_seconds).toBeLessThanOrEqual(3600);
  });

  it('treats a stale answer as done, with no retry', async () => {
    const db = fakeDb(['a', 'b'], { recordAnswer: () => ({ status: 'stale' }) });
    const summary = await refreshDue({ rpc: db.rpc, load: async () => live([row(1)]) });
    expect(db.records).toHaveLength(2);
    expect(summary.counts.stale).toBe(2);
  });

  it('records a refused ok batch as failed instead of leaving the lease to run out', async () => {
    let n = 0;
    const db = fakeDb(['a'], {
      recordAnswer: (p) => {
        n += 1;
        if (n === 1) throw Object.assign(new Error('feed_record: item 1 has a row over 64 KB'), { code: '22023' });
        return { status: p.status };
      },
    });
    const summary = await refreshDue({ rpc: db.rpc, load: async () => live([row(1)]) });
    expect(db.records.map((r) => r.status)).toEqual(['ok', 'failed']);
    expect(db.records[1].lease_token).toBe(db.records[0].lease_token);
    expect(db.records[1].error).toMatch(/refused/);
    expect(summary.counts.failed).toBe(1);
  });

  it('runs four modules at a time', async () => {
    const db = fakeDb(Array.from({ length: 12 }, (_, i) => `m${i}`));
    let active = 0;
    let max = 0;
    const load = async () => {
      active += 1;
      max = Math.max(max, active);
      await sleep(30);
      active -= 1;
      return live([row(1)]);
    };
    const summary = await refreshDue({ rpc: db.rpc, load });
    expect(max).toBe(4);
    expect(db.records).toHaveLength(12);
    expect(summary.counts.ok).toBe(12);
  });

  it('honours the budget: starts nothing it cannot finish and records every module it claimed', async () => {
    const db = fakeDb(Array.from({ length: 40 }, (_, i) => `m${i}`));
    const starts = [];
    const t0 = Date.now();
    const load = async () => {
      starts.push(Date.now() - t0);
      await sleep(60);
      return live([row(1)]);
    };
    const summary = await refreshDue({ rpc: db.rpc, load, budgetMs: 600, moduleMs: 150, reserveMs: 100 });
    const took = Date.now() - t0;
    expect(took).toBeLessThan(600 + 100);
    // A module starts only while a whole module limit still fits before the reserve.
    for (const s of starts) expect(s).toBeLessThanOrEqual(600 - 100 - 150 + 30);
    expect(db.records).toHaveLength(db.claimed.length);
    expect(summary.claimed).toBe(db.claimed.length);
    expect(db.queue.length).toBeGreaterThan(0);
  });

  it('honours the budget when every source hangs: each module is recorded as a timeout', async () => {
    const db = fakeDb(Array.from({ length: 20 }, (_, i) => `m${i}`));
    const t0 = Date.now();
    const summary = await refreshDue({ rpc: db.rpc, load: () => new Promise(() => {}), budgetMs: 500, moduleMs: 120, reserveMs: 100 });
    expect(Date.now() - t0).toBeLessThan(500 + 100);
    expect(db.records.length).toBe(db.claimed.length);
    expect(db.records.every((r) => r.status === 'timeout')).toBe(true);
    expect(summary.counts.timeout).toBe(db.claimed.length);
  });

  describe('host politeness', () => {
    let inFlight;
    let maxPerHost;
    let maxOverall;
    let calls;
    beforeEach(() => {
      inFlight = new Map();
      maxPerHost = new Map();
      maxOverall = 0;
      calls = [];
    });

    function countingFetch({ delay = 30, status = () => 200 } = {}) {
      return vi.fn(async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        calls.push(url.href);
        const n = (inFlight.get(url.host) || 0) + 1;
        inFlight.set(url.host, n);
        maxPerHost.set(url.host, Math.max(maxPerHost.get(url.host) || 0, n));
        maxOverall = Math.max(maxOverall, [...inFlight.values()].reduce((a, b) => a + b, 0));
        try {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, delay);
            init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
          });
          return new Response(`<rss>${url.pathname}</rss>`, { status: status(url) });
        } finally {
          inFlight.set(url.host, inFlight.get(url.host) - 1);
        }
      });
    }

    // A loader as the real ones are written: fetch, and answer a status row when the source fails.
    const fetchingLoad = (urlFor) => async (params) => {
      try {
        const res = await fetch(urlFor(params.get('feature')));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.text();
        return live([row(params.get('feature'))]);
      } catch (err) {
        return live([statusRow(err.message)]);
      }
    };

    it('sends at most one request at a time to any one host, while different hosts run together', async () => {
      globalThis.fetch = countingFetch();
      const features = ['s1', 's2', 's3', 's4', 's5', 's6', 'o1', 'o2'];
      const db = fakeDb(features);
      const summary = await refreshDue({
        rpc: db.rpc,
        load: fetchingLoad((f) => (f.startsWith('s') ? `https://same.example/${f}` : `https://${f}.other.example/feed`)),
      });
      expect(summary.counts.ok).toBe(8);
      expect(maxPerHost.get('same.example')).toBe(1);
      expect(maxOverall).toBeGreaterThan(1);
    });

    it('closes a host that answered 429 for the rest of the run: later modules fail fast with that reason', async () => {
      globalThis.fetch = countingFetch({ delay: 5, status: (u) => (u.host === 'busy.example' ? 429 : 200) });
      const db = fakeDb(['first', 'second', 'third', 'elsewhere']);
      const summary = await refreshDue({
        rpc: db.rpc,
        concurrency: 1,
        load: fetchingLoad((f) => (f === 'elsewhere' ? 'https://fine.example/x' : `https://busy.example/${f}`)),
      });
      expect(calls.filter((c) => c.includes('busy.example'))).toHaveLength(1);
      const got = byFeature(db.records);
      for (const f of ['first', 'second', 'third']) {
        expect(got[f].status, f).toBe('failed');
        expect(got[f].error, f).toMatch(/busy\.example.*429.*closed/i);
      }
      expect(got.elsewhere.status).toBe('ok');
      expect(summary.closed_hosts).toEqual(['busy.example']);
    });

    it('closes a host that answered 403 as well', async () => {
      globalThis.fetch = countingFetch({ delay: 5, status: (u) => (u.host === 'shut.example' ? 403 : 200) });
      const db = fakeDb(['a', 'b']);
      await refreshDue({ rpc: db.rpc, concurrency: 1, load: fetchingLoad((f) => `https://shut.example/${f}`) });
      expect(calls).toHaveLength(1);
      expect(byFeature(db.records).b.error).toMatch(/403/);
    });

    it('aborts a timed-out module\'s request, so its host is free for the next module', async () => {
      const aborted = [];
      globalThis.fetch = vi.fn((input, init = {}) => new Promise((resolve, reject) => {
        if (String(input).endsWith('/fast')) { resolve(new Response('ok')); return; }
        init.signal?.addEventListener('abort', () => { aborted.push(String(input)); reject(new Error('aborted')); }, { once: true });
      }));
      const db = fakeDb(['hang', 'fast']);
      const t0 = Date.now();
      await refreshDue({
        rpc: db.rpc, concurrency: 1, moduleMs: 100, budgetMs: 2000, reserveMs: 200,
        load: fetchingLoad((f) => `https://one.example/${f}`),
      });
      const got = byFeature(db.records);
      expect(got.hang.status).toBe('timeout');
      expect(aborted).toEqual(['https://one.example/hang']);
      // The hung request was aborted, so "fast" got the host's slot at once.
      expect(got.fast.status).toBe('ok');
      expect(Date.now() - t0).toBeLessThan(1000);
    });

    it('leaves fetch as it found it, and never holds up or refuses a request made outside the run', async () => {
      const fake = countingFetch({ delay: 150, status: (u) => (u.host === 'busy.example' && u.pathname === '/run' ? 429 : 200) });
      globalThis.fetch = fake;
      const db = fakeDb(['closer', 'holder']);
      const load = async (params) => {
        const res = await fetch(params.get('feature') === 'closer' ? 'https://busy.example/run' : 'https://held.example/slow');
        await res.text();
        return live([row(params.get('feature'))]);
      };
      const run = refreshDue({ rpc: db.rpc, load });
      expect(globalThis.fetch).not.toBe(fake);
      await sleep(20);
      // While a module holds held.example, an ordinary request to it goes straight through.
      const t0 = Date.now();
      const outside = await globalThis.fetch('https://held.example/other');
      expect(outside.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(250);
      await run;
      expect(maxPerHost.get('held.example')).toBe(2);
      // busy.example was closed for the run, not for anyone else.
      expect((await globalThis.fetch('https://busy.example/later')).status).toBe(200);
      expect(globalThis.fetch).toBe(fake);
    });

    it('restores fetch when the claim fails', async () => {
      const fake = vi.fn();
      globalThis.fetch = fake;
      const rpc = vi.fn(async () => { throw new Error('database unavailable'); });
      await expect(refreshDue({ rpc, load: vi.fn() })).rejects.toThrow(/database unavailable/);
      expect(globalThis.fetch).toBe(fake);
    });
  });
});

describe('supabaseRpc', () => {
  it('POSTs to /rest/v1/rpc/<name> with the secret key and returns the JSON answer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ tier: 't' }]), { status: 200, headers: { 'content-type': 'application/json' } }));
    const rpc = supabaseRpc({ url: 'https://db.example/', key: 'sb_secret_test', fetchImpl });
    expect(await rpc('feed_claim_due', { p_limit: 1 })).toEqual([{ tier: 't' }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://db.example/rest/v1/rpc/feed_claim_due');
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe('sb_secret_test');
    expect(JSON.parse(init.body)).toEqual({ p_limit: 1 });
  });

  it('throws the database error code and message, without the key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: '22023', message: 'feed_record: bad' }), { status: 400 }));
    const rpc = supabaseRpc({ url: 'https://db.example', key: 'sb_secret_test', fetchImpl });
    const err = await rpc('feed_record', {}).catch((e) => e);
    expect(err.code).toBe('22023');
    expect(err.message).toMatch(/feed_record: bad/);
    expect(err.message).not.toMatch(/sb_secret_test/);
  });

  it('refuses to run without a URL and key', async () => {
    const rpc = supabaseRpc({ url: '', key: '', fetchImpl: vi.fn() });
    await expect(rpc('feed_claim_due', {})).rejects.toMatchObject({ code: 'not_configured' });
  });
});
