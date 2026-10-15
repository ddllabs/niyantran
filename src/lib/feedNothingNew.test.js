import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Task B (2026-10-16): PIB-backed official modules whose source was read but listed nothing of theirs
 * say so with meta.nothing_new, and the refresh records that as a success that keeps the stored items.
 * The first timer run (2026-10-15) recorded Cabinet Decisions as failed every hour ("No Cabinet decision
 * in the latest PIB window (20 releases checked)") and the Policy Pipeline Tracker six times in a row.
 * PIB is stubbed with English RSS titles and release pages (the shapes of cabinetFeed.test.js).
 */
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([t, prid]) => `<item><title>${t}</title><link>https://pib.gov.in/PressReleaseIframePage.aspx?PRID=${prid}</link></item>`).join('')}</channel></rss>`;
const page = (title, ministry) => `<html><head><meta property="og:title" content="${title} | Press Information Bureau" /></head><body>
  <div class="MinistryNameSubhead">${ministry}</div> Posted On: 12 Oct 2026</body></html>`;

const NOT_CABINET = [
  ['Finance Minister addresses an investment forum in New Delhi', 2222, 'Ministry of Finance'],
  ['Mahila Kisan Diwas 2026 celebrated today across the country', 2223, 'Ministry of Agriculture'],
];

function respond(url, body, type) {
  return new Response(body, { status: 200, headers: { 'content-type': type } });
}

/** PIB's RSS lists `items`; `rssDown` makes every RSS request fail (PIB unreachable). */
function stubPib(items, { rssDown = false } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const u = String(input?.url || input);
    if (/RssMain/i.test(u)) {
      if (rssDown) throw new Error('connect ECONNRESET');
      return respond(u, rss(items.map(([t, prid]) => [t, prid])), 'application/rss+xml');
    }
    const prid = (/PRID=(\d+)/.exec(u) || [])[1];
    const hit = items.find(([, p]) => String(p) === prid);
    if (!hit) return new Response('', { status: 404 });
    return respond(u, page(hit[0], hit[2]), 'text/html');
  }));
}

const feed = async (feature) => {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'national', feature }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Cabinet Decisions: nothing new in PIB\'s latest releases', () => {
  it('says nothing_new, and still shows the page its stored decisions', async () => {
    stubPib(NOT_CABINET);
    const out = await feed('Cabinet Decisions');
    expect(out.meta?.nothing_new).toBe(true);
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.source.note).toMatch(/no Cabinet decision in the latest PIB window \(2 releases checked\)/i);
  });

  it('a live decision is an ordinary answer, without the flag', async () => {
    stubPib([['Cabinet approves the Example Scheme for 2026-27', 1111, 'Cabinet Committee on Economic Affairs (CCEA)'], ...NOT_CABINET]);
    const out = await feed('Cabinet Decisions');
    expect(out.rows.map((r) => r.title)).toEqual(['Cabinet approves the Example Scheme for 2026-27']);
    expect(out.meta?.nothing_new).toBeUndefined();
  });

  it('PIB unreachable is not "nothing new"', async () => {
    stubPib([], { rssDown: true });
    const out = await feed('Cabinet Decisions');
    expect(out.meta?.nothing_new).toBeUndefined();
  });
});

describe('Policy Pipeline Tracker: no release about policy in the making', () => {
  it('says nothing_new beside its status row', async () => {
    stubPib(NOT_CABINET);
    const out = await feed('Policy Pipeline Tracker (Draft-to-Gazette)');
    expect(out.rows.every((r) => r.status === 'source_status')).toBe(true);
    expect(out.meta?.nothing_new).toBe(true);
  });

  it('PIB unreachable is not "nothing new"', async () => {
    stubPib([], { rssDown: true });
    const out = await feed('Policy Pipeline Tracker (Draft-to-Gazette)');
    expect(out.meta?.nothing_new).toBeUndefined();
  });
});

describe('the refresh records it as a success that keeps the stored items', () => {
  const token = '00000000-0000-4000-8000-000000000001';
  async function refreshOne(feature) {
    const { refreshDue } = await import('../../server/feedStore.mjs');
    const records = [];
    const queue = [{ tier: 'national', feature, variant: '', class: 'official', kind: 'official', interval_minutes: 60, lease_token: token }];
    const rpc = async (name, args) => {
      if (name === 'feed_claim_due') return queue.splice(0, args.p_limit);
      if (name === 'feed_record') {
        records.push(args.p);
        return { status: args.p.nothing_new ? 'unchanged' : args.p.status };
      }
      throw new Error(`unexpected rpc ${name}`);
    };
    await refreshDue({ rpc });
    return records[0];
  }

  it('Cabinet Decisions with no new decision: ok, nothing_new, no items', async () => {
    stubPib(NOT_CABINET);
    expect(await refreshOne('Cabinet Decisions')).toMatchObject({ status: 'ok', nothing_new: true, items: [], error: null });
  });

  it('the Policy Pipeline with no policy release: ok, nothing_new, no items', async () => {
    stubPib(NOT_CABINET);
    expect(await refreshOne('Policy Pipeline Tracker (Draft-to-Gazette)')).toMatchObject({ status: 'ok', nothing_new: true, items: [] });
  });

  it('PIB unreachable is still a failure', async () => {
    stubPib([], { rssDown: true });
    const rec = await refreshOne('Cabinet Decisions');
    expect(rec.status).toBe('failed');
    expect(rec).not.toHaveProperty('nothing_new');
  });
});
