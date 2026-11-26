import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  CLAIM_LIMIT,
  type Claimed,
  claimLimitOf,
  type FinishResult,
  firecrawlScrape,
  type HandlerDeps,
  handleWebText,
  LEASE_SECONDS,
  MAX_CLAIM_LIMIT,
  MIN_SECRET_LENGTH,
  runOnce,
  SCRAPE_TIMEOUT_MS,
  type WebTextDb,
  type WorkDeps,
} from './handler.ts';
import { FIRECRAWL_SCRAPE_URL, FIRECRAWL_TIMEOUT_MS, scrapeBody, type ScrapeOutcome } from './firecrawl.ts';

const SECRET = 'web-text-secret-0123456789-abcdefghij';
const API_KEY = 'fc-0123456789abcdef0123456789abcdef';
const TEXT = '# Press release\n\nThe Reserve Bank today announced its policy rate.';

const claimed = (n: number, attempt = 1): Claimed => ({
  id: `id-${n}`,
  token: `tok-${n}`,
  source_key: n.toString(16).padStart(40, '0'),
  official_url: `https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=${n}`,
  attempt,
});
const done = (url: string, text = TEXT): ScrapeOutcome => ({
  kind: 'done',
  text,
  sourceStatus: 200,
  finalHost: new URL(url).host,
  contentType: 'text/html; charset=utf-8',
});

function fakeDb(batch: Claimed[], refused: string | null = null, over: Partial<WebTextDb> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const db: WebTextDb = {
    claim: (limit, lease) => {
      calls.push(['claim', limit, lease]);
      return Promise.resolve({ claimed: batch, refused });
    },
    finish: (id, token, result) => {
      calls.push(['finish', id, token, result]);
      return Promise.resolve('done');
    },
    fail: (id, token, code, uncertain, permanent) => {
      calls.push(['fail', id, token, code, uncertain, permanent]);
      return Promise.resolve('queued');
    },
    ...over,
  };
  return { db, calls };
}

function work(db: WebTextDb, scrape: WorkDeps['scrape'], claimLimit = CLAIM_LIMIT) {
  const logs: Array<[string, Record<string, unknown>]> = [];
  const slept: number[] = [];
  const deps: WorkDeps = {
    db,
    scrape,
    claimLimit,
    log: (e, f) => void logs.push([e, f]),
    sleep: (ms) => (slept.push(ms), Promise.resolve()),
  };
  return { deps, logs, slept };
}

// ─── The request ─────────────────────────────────────────────────────────────

const handlerDeps = (over: Partial<HandlerDeps> = {}) => {
  const ran: Promise<unknown>[] = [];
  const logs: string[] = [];
  const base: HandlerDeps = {
    secret: SECRET,
    waitUntil: (p) => void ran.push(p),
    work: () => work(fakeDb([]).db, () => Promise.reject(new Error('no'))).deps,
    log: (e) => void logs.push(e),
  };
  return { deps: { ...base, ...over }, ran, logs };
};
const post = (headers: Record<string, string> = {}) => new Request('https://x/web-text', { method: 'POST', headers });

Deno.test('handler: only POST', async () => {
  const { deps, ran } = handlerDeps();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await handleWebText(
      new Request('https://x/web-text', { method, headers: { 'x-web-text-secret': SECRET } }),
      deps,
    );
    assertEquals(res.status, 405);
  }
  assertEquals(ran.length, 0);
});

Deno.test("handler: a missing, wrong, look-alike or other function's secret is the same bare 401, and no work starts", async () => {
  for (
    const headers of [
      {} as Record<string, string>,
      { 'x-web-text-secret': 'wrong' },
      { 'x-web-text-secret': SECRET + 'x' },
      { 'x-web-text-secret': SECRET.slice(0, -1) },
      { 'x-budget-ocr-secret': SECRET },
      { 'authorization': `Bearer ${SECRET}` },
    ]
  ) {
    let built = 0;
    const { deps, ran } = handlerDeps({
      work: () => (built++, work(fakeDb([]).db, () => Promise.reject(new Error())).deps),
    });
    const res = await handleWebText(post(headers), deps);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'unauthorized' });
    assertEquals(built, 0);
    assertEquals(ran.length, 0);
  }
});

Deno.test('handler: an unset secret refuses everything, even an empty header (fail closed)', async () => {
  const { deps, logs, ran } = handlerDeps({ secret: '' });
  assertEquals((await handleWebText(post({ 'x-web-text-secret': '' }), deps)).status, 401);
  assertEquals((await handleWebText(post({ 'x-web-text-secret': 'anything' }), deps)).status, 401);
  assert(logs.includes('web_text.secret_unset'));
  assertEquals(ran.length, 0);
});

Deno.test('handler: FIRECRAWL_API_KEY unset (work cannot be built) answers 503 without a claim', async () => {
  const { deps, ran, logs } = handlerDeps({
    work: () => {
      throw new Error('FIRECRAWL_API_KEY is not set');
    },
  });
  const res = await handleWebText(post({ 'x-web-text-secret': SECRET }), deps);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: 'not configured' });
  assertEquals(ran.length, 0);
  assert(logs.includes('web_text.config_error'));
});

Deno.test('handler: a secret shorter than 32 characters answers 503 before any claim, even when the header matches it', async () => {
  const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
  let built = 0;
  const { deps, ran, logs } = handlerDeps({
    secret: short,
    work: () => (built++, work(fakeDb([claimed(1)]).db, (u) => Promise.resolve(done(u))).deps),
  });
  const res = await handleWebText(post({ 'x-web-text-secret': short }), deps);
  assertEquals(res.status, 503);
  assertEquals(built, 0);
  assertEquals(ran.length, 0);
  assert(logs.includes('web_text.secret_weak'));
  assertEquals(MIN_SECRET_LENGTH, 32);
  // A wrong header is still the bare 401, so the response does not say how the secret is configured.
  assertEquals((await handleWebText(post({ 'x-web-text-secret': 'wrong' }), deps)).status, 401);
  // Exactly the minimum is accepted.
  const exact = 'y'.repeat(MIN_SECRET_LENGTH);
  assertEquals(
    (await handleWebText(post({ 'x-web-text-secret': exact }), handlerDeps({ secret: exact }).deps)).status,
    202,
  );
});

Deno.test('handler: the right secret answers 202 and the work runs after it', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const w = work(db, (u) => Promise.resolve(done(u)));
  const { deps, ran } = handlerDeps({ work: () => w.deps });
  const res = await handleWebText(post({ 'x-web-text-secret': SECRET }), deps);
  assertEquals(res.status, 202);
  assertEquals(await res.json(), { accepted: true });
  assertEquals(ran.length, 1);
  await Promise.all(ran);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
});

// ─── One run ─────────────────────────────────────────────────────────────────

Deno.test('runOnce: claims CLAIM_LIMIT with the lease, scrapes each official URL with its row id, stores the result', async () => {
  const { db, calls } = fakeDb([claimed(1), claimed(2)]);
  const asked: Array<[string, string]> = [];
  const w = work(db, (url, id) => (asked.push([url, id]), Promise.resolve(done(url))));
  await runOnce(w.deps);
  assertEquals(calls[0], ['claim', CLAIM_LIMIT, LEASE_SECONDS]);
  // I2: x-request-id is the row id and the attempt, so a retry is a fresh Firecrawl request.
  assertEquals(asked, [[claimed(1).official_url, 'id-1-1'], [claimed(2).official_url, 'id-2-1']]);
  // A second attempt is a new x-request-id.
  const again: Array<[string, string]> = [];
  await runOnce(
    work(fakeDb([claimed(3, 2)]).db, (url, id) => (again.push([url, id]), Promise.resolve(done(url)))).deps,
  );
  assertEquals(again, [[claimed(3).official_url, 'id-3-2']]);
  const finishes = calls.filter((c) => c[0] === 'finish');
  assertEquals(finishes, [
    [
      'finish',
      'id-1',
      'tok-1',
      {
        text: TEXT,
        source_status: 200,
        final_url_host: 'www.rbi.org.in',
        content_type: 'text/html; charset=utf-8',
      } satisfies FinishResult,
    ],
    ['finish', 'id-2', 'tok-2', {
      text: TEXT,
      source_status: 200,
      final_url_host: 'www.rbi.org.in',
      content_type: 'text/html; charset=utf-8',
    }],
  ]);
  assert(!calls.some((c) => c[0] === 'fail'));
});

Deno.test('runOnce: each failure outcome is reported with its own code, uncertainty and finality, never finished', async () => {
  const outcomes: ScrapeOutcome[] = [
    { kind: 'fail', code: 'source_status_403', uncertain: false, permanent: false, billed: true, sourceStatus: 403 },
    { kind: 'fail', code: 'not_html', uncertain: false, permanent: true, billed: true, sourceStatus: 200 },
    { kind: 'fail', code: 'firecrawl_forbidden', uncertain: false, permanent: true, billed: false },
    { kind: 'fail', code: 'firecrawl_timeout', uncertain: true, permanent: false, billed: false },
  ];
  const batch = outcomes.map((_, i) => claimed(i + 1));
  const { db, calls } = fakeDb(batch);
  const w = work(db, (_url, id) => Promise.resolve(outcomes[Number(id.split('-')[1]) - 1]), 4);
  await runOnce(w.deps);
  assertEquals(calls.filter((c) => c[0] === 'fail').sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [
    ['fail', 'id-1', 'tok-1', 'source_status_403', false, false],
    ['fail', 'id-2', 'tok-2', 'not_html', false, true],
    ['fail', 'id-3', 'tok-3', 'firecrawl_forbidden', false, true],
    ['fail', 'id-4', 'tok-4', 'firecrawl_timeout', true, false],
  ]);
  assert(!calls.some((c) => c[0] === 'finish'));
  const credits = Object.fromEntries(
    w.logs.filter(([e]) => e === 'web_text.failed').map(([, f]) => [f.code, f.credits]),
  );
  assertEquals(credits, { source_status_403: 1, not_html: 1, firecrawl_forbidden: 0, firecrawl_timeout: 1 });
});

Deno.test('runOnce: a finish that fails ends the request as report_failed (uncertain, permanent): never paid twice', async () => {
  const { db, calls } = fakeDb([claimed(1)], null, {
    finish: (id, token, result) => {
      calls.push(['finish', id, token, result]);
      return Promise.reject(new Error('network'));
    },
  });
  const w = work(db, (u) => Promise.resolve(done(u)));
  await runOnce(w.deps);
  // L4: the finish is tried three times before the request is given up as report_failed.
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish', 'finish', 'finish', 'fail']);
  assertEquals(calls[4], ['fail', 'id-1', 'tok-1', 'report_failed', true, true]);
  assert(w.logs.some(([e, f]) => e === 'web_text.report_failed' && f.code === 'report_failed'));
});

Deno.test('runOnce: a finish or a fail that errors is tried again (3 tries, short backoff) before giving up', async () => {
  // The finish fails twice, then is stored: no report_failed, the credit is not lost.
  let finishes = 0;
  const a = fakeDb([claimed(1)], null, {
    finish: (id, token, result) => {
      a.calls.push(['finish', id, token, result]);
      return ++finishes < 3 ? Promise.reject(new Error('network')) : Promise.resolve('done');
    },
  });
  const wa = work(a.db, (u) => Promise.resolve(done(u)));
  await runOnce(wa.deps);
  assertEquals(a.calls.map((c) => c[0]), ['claim', 'finish', 'finish', 'finish']);
  assertEquals(wa.slept.length, 2);
  assert(wa.slept.every((ms) => ms > 0 && ms <= 5_000), String(wa.slept));
  assert(wa.logs.some(([e]) => e === 'web_text.finished'));
  // The failure report errors twice, then lands.
  let fails = 0;
  const b = fakeDb([claimed(2)], null, {
    fail: (id, token, code, uncertain, permanent) => {
      b.calls.push(['fail', id, token, code, uncertain, permanent]);
      return ++fails < 3 ? Promise.reject(new Error('network')) : Promise.resolve('queued');
    },
  });
  const failure: ScrapeOutcome = {
    kind: 'fail',
    code: 'firecrawl_timeout',
    uncertain: true,
    permanent: false,
    billed: false,
  };
  const wb = work(b.db, () => Promise.resolve(failure));
  await runOnce(wb.deps);
  assertEquals(b.calls.map((c) => c[0]), ['claim', 'fail', 'fail', 'fail']);
  assert(wb.logs.some(([e, f]) => e === 'web_text.failed' && f.outcome === 'queued'));
  // Always down: three tries, then report_unreachable, and runOnce still resolves.
  const c = fakeDb([claimed(3)], null, {
    fail: (id, token, code, uncertain, permanent) => {
      c.calls.push(['fail', id, token, code, uncertain, permanent]);
      return Promise.reject(new Error('down'));
    },
  });
  const wc = work(c.db, () => Promise.resolve(failure));
  await runOnce(wc.deps);
  assertEquals(c.calls.filter((x) => x[0] === 'fail').length, 3);
  assert(wc.logs.some(([e, f]) => e === 'web_text.report_failed' && f.code === 'report_unreachable'));
});

Deno.test('runOnce: an official URL the function-side rule refuses is failed official_url_invalid and never fetched', async () => {
  const bad = [
    'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR12345.PDF',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1#x',
    'https://www.sebi.gov.in/legal/../x.html',
    'https://www.sebi.gov.in/legal/a%2fb.html',
    'https://WWW.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'not a url',
  ];
  const batch = bad.map((u, i) => ({ ...claimed(i + 1), official_url: u }));
  const { db, calls } = fakeDb(batch);
  const sent: unknown[] = [];
  const f = ((input: unknown) => (sent.push(input), Promise.resolve(new Response('{}')))) as typeof fetch;
  const w = work(db, firecrawlScrape(f, API_KEY), 5);
  await runOnce(w.deps);
  assertEquals(sent.length, 0, 'the fake fetch is never called');
  const fails = calls.filter((c) => c[0] === 'fail').sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  assertEquals(fails, batch.map((c) => ['fail', c.id, c.token, 'official_url_invalid', false, true]));
  assert(!calls.some((c) => c[0] === 'finish'));
  // And the scrape itself is not even asked.
  let asked = 0;
  const two = fakeDb([{ ...claimed(9), official_url: bad[0] }]);
  await runOnce(work(two.db, () => (asked++, Promise.resolve(done(bad[0])))).deps);
  assertEquals(asked, 0);
  assertEquals(two.calls[1], ['fail', 'id-9', 'tok-9', 'official_url_invalid', false, true]);
});

Deno.test('runOnce: the database unreachable even for the report does not reject', async () => {
  const { db } = fakeDb([claimed(1)], null, {
    finish: () => Promise.reject(new Error('down')),
    fail: () => Promise.reject(new Error('down')),
  });
  const w = work(db, (u) => Promise.resolve(done(u)));
  await runOnce(w.deps);
  assert(w.logs.some(([e, f]) => e === 'web_text.report_failed' && f.code === 'report_unreachable'));
});

Deno.test('runOnce: a refused or empty claim scrapes nothing; a failed claim scrapes nothing and does not reject', async () => {
  for (const refused of ['cap', 'disabled', null]) {
    let scraped = 0;
    const w = work(fakeDb([], refused).db, () => (scraped++, Promise.reject(new Error())));
    await runOnce(w.deps);
    assertEquals(scraped, 0);
    assertEquals(w.logs[0][0], refused ? 'web_text.refused' : 'web_text.idle');
    assertEquals(w.logs[0][1].refused, refused);
  }
  let scraped = 0;
  const { db } = fakeDb([], null, { claim: () => Promise.reject(new Error('relation does not exist')) });
  const w = work(db, () => (scraped++, Promise.reject(new Error())));
  await runOnce(w.deps);
  assertEquals(scraped, 0);
  assertEquals(w.logs, [['web_text.claim_failed', { code: 'claim_failed' }]]);
});

Deno.test('runOnce: concurrency is bounded by the claim limit, and every claimed request is still scraped', async () => {
  for (const limit of [1, 2, 5]) {
    const batch = Array.from({ length: 7 }, (_, i) => claimed(i + 1));
    const { db, calls } = fakeDb(batch);
    let inFlight = 0, peak = 0;
    const w = work(db, async (u) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return done(u);
    }, limit);
    await runOnce(w.deps);
    assertEquals(calls[0], ['claim', limit, LEASE_SECONDS]);
    assertEquals(peak, limit, `peak with limit ${limit}`);
    assertEquals(calls.filter((c) => c[0] === 'finish').length, 7);
  }
  // A limit out of range is never passed to the database.
  for (const bad of [0, 9, Number.NaN]) {
    const { db, calls } = fakeDb([]);
    await runOnce(work(db, () => Promise.reject(new Error()), bad).deps);
    const asked = calls[0][1] as number;
    assert(asked >= 1 && asked <= MAX_CLAIM_LIMIT, `limit ${bad} claimed ${asked}`);
  }
});

Deno.test('claimLimitOf: WEB_TEXT_CLAIM_LIMIT 1 to 5, else the default of 2', () => {
  assertEquals(CLAIM_LIMIT, 2);
  assertEquals(MAX_CLAIM_LIMIT, 5);
  assertEquals(claimLimitOf(undefined), 2);
  assertEquals(claimLimitOf('5'), 5);
  assertEquals(claimLimitOf(' 3 '), 3);
  assertEquals(claimLimitOf('1'), 1);
  for (const bad of ['0', '6', '9', '10', '-1', '2.5', 'x', '']) assertEquals(claimLimitOf(bad), 2, bad);
});

Deno.test("time limits: a scrape ends inside the lease and the Free-plan function limit, after Firecrawl's own limit", () => {
  assertEquals(SCRAPE_TIMEOUT_MS, 75_000);
  assert(SCRAPE_TIMEOUT_MS > FIRECRAWL_TIMEOUT_MS, 'our limit leaves Firecrawl its own 60 s');
  assert(SCRAPE_TIMEOUT_MS < LEASE_SECONDS * 1000, 'a scrape ends before its lease');
  // Workers run one scrape each at a time; with CLAIM_LIMIT requests and CLAIM_LIMIT workers an invocation is one scrape
  // long. 10 s are left for the claim and the reports under the 150 s Free-plan limit, and the lease outlasts all of it.
  assert(SCRAPE_TIMEOUT_MS + 10_000 <= 150_000);
  assertEquals(LEASE_SECONDS, 300);
});

// ─── Logs ────────────────────────────────────────────────────────────────────

const ALLOWED = new Set([
  'request_id',
  'source_key',
  'outcome',
  'code',
  'source_status',
  'credits',
  'latency_ms',
  'claimed',
  'refused',
]);

Deno.test('logs: only ids, codes, counts and latency; never the text, the URL, the key or a database message', async () => {
  const batch = [1, 2, 3, 4].map((n) => claimed(n));
  const secretText = 'SECRET-PAGE-TEXT-should-never-be-logged';
  const { db } = fakeDb(batch, null, {
    finish: (id) =>
      id === 'id-2'
        ? Promise.reject(new Error(`db said ${API_KEY} ${batch[1].official_url}`))
        : Promise.resolve('done'),
  });
  const outcomes: Record<string, ScrapeOutcome> = {
    'id-1': done(batch[0].official_url, secretText),
    'id-2': done(batch[1].official_url, secretText),
    'id-3': {
      kind: 'fail',
      code: 'source_status_404',
      uncertain: false,
      permanent: false,
      billed: true,
      sourceStatus: 404,
    },
    'id-4': { kind: 'fail', code: 'firecrawl_timeout', uncertain: true, permanent: false, billed: false },
  };
  const w = work(db, (_u, id) => Promise.resolve(outcomes[id.replace(/-1$/, '')]), 1);
  let t = 1000;
  w.deps.now = () => (t += 7);
  await runOnce(w.deps);
  assert(w.logs.length >= 5);
  for (const [event, fields] of w.logs) {
    assert(event.startsWith('web_text.'), event);
    for (const k of Object.keys(fields)) assert(ALLOWED.has(k), `${event} logs ${k}`);
  }
  const all = JSON.stringify(w.logs);
  assert(!all.includes(secretText), 'no text');
  assert(!all.includes('https://'), 'no URL');
  assert(!all.includes('prid='), 'no URL');
  assert(!all.includes(API_KEY), 'no key');
  assert(!all.includes('db said'), 'no database message');
  const fin = w.logs.find(([e, f]) => e === 'web_text.finished' && f.request_id === 'id-1')!;
  assertEquals(fin[1], {
    request_id: 'id-1',
    source_key: batch[0].source_key,
    outcome: 'done',
    code: null,
    source_status: 200,
    credits: 1,
    latency_ms: 7,
  });
  const failed = w.logs.find(([e, f]) => e === 'web_text.failed' && f.request_id === 'id-3')!;
  assertEquals(failed[1].source_status, 404);
  assertEquals(failed[1].code, 'source_status_404');
});

Deno.test('handler: a broken log sink does not break the work', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const deps: WorkDeps = {
    db,
    scrape: (u) => Promise.resolve(done(u)),
    claimLimit: CLAIM_LIMIT,
    log: () => {
      throw new Error('sink down');
    },
  };
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
});

// ─── End to end with Firecrawl's answer (injected fetch only) ─────────────────

Deno.test('end to end: the exact Firecrawl request, and the markdown stored without NUL', async () => {
  const c = claimed(59012);
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: 'Line one\u0000.\n\n| a | b |\n|---|---|\n| 1 | 2 |',
            metadata: { url: c.official_url, sourceURL: c.official_url, statusCode: 200, contentType: 'text/html' },
          },
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  const { db, calls } = fakeDb([c]);
  const w = work(db, firecrawlScrape(f, API_KEY));
  await runOnce(w.deps);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].url, FIRECRAWL_SCRAPE_URL);
  assertEquals(sent[0].init.headers, {
    'authorization': `Bearer ${API_KEY}`,
    'content-type': 'application/json',
    'x-request-id': `${c.id}-1`,
  });
  assertEquals(JSON.parse(String(sent[0].init.body)), scrapeBody(c.official_url));
  assertEquals(calls[1], ['finish', c.id, c.token, {
    text: 'Line one.\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    source_status: 200,
    final_url_host: 'www.rbi.org.in',
    content_type: 'text/html',
  }]);
});

Deno.test('end to end: a 402 from Firecrawl is reported as firecrawl_no_credits, not billed, final', async () => {
  const f = (() => Promise.resolve(new Response('{"success":false}', { status: 402 }))) as typeof fetch;
  const { db, calls } = fakeDb([claimed(1)]);
  await runOnce(work(db, firecrawlScrape(f, API_KEY)).deps);
  assertEquals(calls[1], ['fail', 'id-1', 'tok-1', 'firecrawl_no_credits', false, true]);
});
