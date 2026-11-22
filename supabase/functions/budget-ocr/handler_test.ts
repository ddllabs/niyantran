import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  type BudgetOcrDb,
  CLAIM_LIMIT,
  type Claimed,
  classify,
  handleBudgetOcr,
  type HandlerDeps,
  MIN_SECRET_LENGTH,
  mistralOcr,
  OCR_TIMEOUT_MS,
  ocrRequestFor,
  runOnce,
  withTimeout,
  type WorkDeps,
} from './handler.ts';
import { IngestError, type OcrCallResult } from '../ingest-worker/types.ts';

const SECRET = 'budget-secret-0123456789-abcdefghij';
const API_KEY = 'mistral-key-0123456789abcdef';
const URL1 = 'https://www.indiabudget.gov.in/doc/bh1.pdf';

const claimed = (n: number, pages = 2): Claimed => ({
  id: `id-${n}`,
  token: `tok-${n}`,
  source_key: n.toString(16).padStart(40, '0'),
  official_url: `https://www.indiabudget.gov.in/doc/bh${n}.pdf`,
  expected_pages: pages,
});

const page = (index: number, markdown = `text ${index}`) => ({ index, markdown });
const result = (indexes: number[], pagesProcessed = indexes.length): OcrCallResult => ({
  pages: indexes.map((i) => page(i)),
  model: 'mistral-ocr-4-1',
  pagesProcessed,
  docSizeBytes: 1000,
  bytes: 2000,
  latencyMs: 5,
});

function fakeDb(batch: Claimed[], refused: string | null = null) {
  const calls: Array<[string, ...unknown[]]> = [];
  const db: BudgetOcrDb = {
    claim: (limit, lease) => {
      calls.push(['claim', limit, lease]);
      return Promise.resolve({ claimed: batch, refused });
    },
    finish: (id, token, pages, texts) => {
      calls.push(['finish', id, token, pages, texts]);
      return Promise.resolve('done');
    },
    fail: (id, token, code, uncertain, permanent) => {
      calls.push(['fail', id, token, code, uncertain, permanent]);
      return Promise.resolve('queued');
    },
  };
  return { db, calls };
}

function work(db: BudgetOcrDb, ocr: WorkDeps['ocr']) {
  const logs: Array<[string, Record<string, unknown>]> = [];
  const deps: WorkDeps = { db, ocr, log: (e, f) => logs.push([e, f]), secrets: [API_KEY, SECRET] };
  return { deps, logs };
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
const post = (headers: Record<string, string> = {}) => new Request('https://x/budget-ocr', { method: 'POST', headers });

Deno.test('handler: only POST', async () => {
  const { deps } = handlerDeps();
  const res = await handleBudgetOcr(new Request('https://x/budget-ocr', { method: 'GET' }), deps);
  assertEquals(res.status, 405);
});

Deno.test('handler: a missing, wrong or look-alike secret is the same bare 401, and no work starts', async () => {
  for (
    const headers of [{} as Record<string, string>, { 'x-budget-ocr-secret': 'wrong' }, {
      'x-budget-ocr-secret': SECRET + 'x',
    }, { 'x-ingest-secret': SECRET }]
  ) {
    let built = 0;
    const { deps, ran } = handlerDeps({
      work: () => (built++, work(fakeDb([]).db, () => Promise.reject(new Error('no'))).deps),
    });
    const res = await handleBudgetOcr(post(headers), deps);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'unauthorized' });
    assertEquals(built, 0);
    assertEquals(ran.length, 0);
  }
});

Deno.test('handler: an unset secret refuses everything, even an empty header (fail closed)', async () => {
  const { deps, logs } = handlerDeps({ secret: '' });
  assertEquals((await handleBudgetOcr(post({ 'x-budget-ocr-secret': '' }), deps)).status, 401);
  assertEquals((await handleBudgetOcr(post({ 'x-budget-ocr-secret': 'anything' }), deps)).status, 401);
  assert(logs.includes('budget_ocr.secret_unset'));
});

Deno.test('handler: a function that is not configured answers 503 without starting work', async () => {
  const { deps, ran } = handlerDeps({
    work: () => {
      throw new Error(`MISTRAL_API_KEY is not set ${SECRET}`);
    },
  });
  const res = await handleBudgetOcr(post({ 'x-budget-ocr-secret': SECRET }), deps);
  assertEquals(res.status, 503);
  assertEquals(ran.length, 0);
});

Deno.test('handler: a secret shorter than 32 characters answers 503 before any claim, even when the header matches it', async () => {
  const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
  let built = 0;
  const { deps, ran, logs } = handlerDeps({
    secret: short,
    work: () => (built++, work(fakeDb([claimed(1)]).db, () => Promise.resolve(result([0, 1]))).deps),
  });
  const res = await handleBudgetOcr(post({ 'x-budget-ocr-secret': short }), deps);
  assertEquals(res.status, 503);
  assertEquals(built, 0);
  assertEquals(ran.length, 0);
  assert(logs.includes('budget_ocr.secret_weak'));
  // A wrong header is still the bare 401, so the response does not say how the secret is configured.
  assertEquals((await handleBudgetOcr(post({ 'x-budget-ocr-secret': 'wrong' }), deps)).status, 401);
  // Exactly the minimum is accepted.
  const exact = 'y'.repeat(MIN_SECRET_LENGTH);
  const ok = handlerDeps({ secret: exact });
  assertEquals((await handleBudgetOcr(post({ 'x-budget-ocr-secret': exact }), ok.deps)).status, 202);
});

Deno.test('handler: the right secret answers 202 and the work runs after it', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const w = work(db, () => Promise.resolve(result([0, 1])));
  const { deps, ran } = handlerDeps({ work: () => w.deps });
  const res = await handleBudgetOcr(post({ 'x-budget-ocr-secret': SECRET }), deps);
  assertEquals(res.status, 202);
  await Promise.all(ran);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
});

// ─── One run ─────────────────────────────────────────────────────────────────

Deno.test('ocrRequestFor: the official URL as document_url, exactly the expected pages, no image data, no PDF stored', () => {
  const r = ocrRequestFor(URL1, 3);
  assertEquals(r.document, { type: 'document_url', document_url: URL1 });
  assertEquals(r.pages, [0, 1, 2]);
  assertEquals(r.include_image_base64, false);
  assertEquals(r.include_blocks, false);
  assertEquals(r.table_format, 'markdown');
});

Deno.test('runOnce: claims CLAIM_LIMIT, calls OCR with each URL, stores the pages in order with the pages processed', async () => {
  const { db, calls } = fakeDb([claimed(1, 2), claimed(2, 3)]);
  const seen: unknown[] = [];
  const { deps, logs } = work(db, (req) => {
    seen.push(req);
    // Mistral returns pages in any order.
    return Promise.resolve(req.pages.length === 2 ? result([1, 0]) : result([2, 0, 1]));
  });
  await runOnce(deps);
  assertEquals(calls[0], ['claim', CLAIM_LIMIT, 300]);
  assertEquals((seen as Array<{ document: { document_url: string } }>).map((r) => r.document.document_url).sort(), [
    'https://www.indiabudget.gov.in/doc/bh1.pdf',
    'https://www.indiabudget.gov.in/doc/bh2.pdf',
  ]);
  const fin = calls.filter((c) => c[0] === 'finish');
  assertEquals(fin.length, 2);
  const one = fin.find((c) => c[1] === 'id-1')!;
  assertEquals(one.slice(2), ['tok-1', 2, ['text 0', 'text 1']]);
  assertEquals(fin.find((c) => c[1] === 'id-2')!.slice(2), ['tok-2', 3, ['text 0', 'text 1', 'text 2']]);
  assert(logs.some(([e]) => e === 'budget_ocr.finished'));
});

Deno.test('runOnce: a claim the database refused (cap) calls no OCR and reports nothing', async () => {
  const { db, calls } = fakeDb([], 'cap');
  let ocrCalls = 0;
  const { deps, logs } = work(db, () => (ocrCalls++, Promise.resolve(result([0]))));
  await runOnce(deps);
  assertEquals(ocrCalls, 0);
  assertEquals(calls.map((c) => c[0]), ['claim']);
  assertEquals(logs[0], ['budget_ocr.refused', { reason: 'cap' }]);
});

Deno.test('runOnce: a claim that fails is logged, calls no OCR and does not reject', async () => {
  const db: BudgetOcrDb = {
    claim: () => Promise.reject(new Error(`rpc down ${API_KEY}`)),
    finish: () => Promise.reject(new Error('x')),
    fail: () => Promise.reject(new Error('x')),
  };
  let ocrCalls = 0;
  const { deps, logs } = work(db, () => (ocrCalls++, Promise.resolve(result([0]))));
  await runOnce(deps);
  assertEquals(ocrCalls, 0);
  assertEquals(logs[0][0], 'budget_ocr.claim_failed');
  assert(!JSON.stringify(logs).includes(API_KEY));
});

Deno.test('runOnce: pages that are not the ones asked for are stored as no text, with the pages processed (the money counts)', async () => {
  const { db, calls } = fakeDb([claimed(1, 2)]);
  const { deps, logs } = work(db, () => Promise.resolve(result([0, 5], 2)));
  await runOnce(deps);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 2, []]);
  assert(logs.some(([e]) => e === 'budget_ocr.page_mismatch'));
});

Deno.test('runOnce: a NUL character in the OCR text is removed before the text is stored (the database cannot hold it)', async () => {
  const { db, calls } = fakeDb([claimed(1, 2)]);
  const { deps } = work(db, () =>
    Promise.resolve({
      ...result([0, 1]),
      pages: [{ index: 1, markdown: 'b\u0000b' }, { index: 0, markdown: 'a\u0000\u0000a' }],
    }));
  await runOnce(deps);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 2, ['aa', 'bb']]);
});

Deno.test('runOnce: a finish that throws ends the request for good with its estimate counted, so it is never paid for again', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  db.finish = (id, token, pages, texts) => {
    calls.push(['finish', id, token, pages, texts]);
    return Promise.reject(new Error(`database said no ${API_KEY}`));
  };
  const { deps, logs } = work(db, () => Promise.resolve(result([0, 1])));
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish', 'fail']);
  // code, uncertain (the money was spent), permanent (no second paid attempt)
  assertEquals(calls[2], ['fail', 'id-1', 'tok-1', 'report_failed', true, true]);
  assert(logs.some(([e]) => e === 'budget_ocr.report_failed'));
  assert(!JSON.stringify(logs).includes(API_KEY));
});

Deno.test('runOnce: when the failure report itself fails too, nothing rejects and nothing leaks', async () => {
  const { db } = fakeDb([claimed(1)]);
  db.finish = () => Promise.reject(new Error('finish down'));
  db.fail = () => Promise.reject(new Error(`fail down ${API_KEY}`));
  const { deps, logs } = work(db, () => Promise.resolve(result([0, 1])));
  await runOnce(deps);
  assert(!JSON.stringify(logs).includes(API_KEY));
});

Deno.test('classify: what was possibly billed and what is final', () => {
  assertEquals(classify(new IngestError('mistral_rate_limited', 'x', false, 429)), {
    code: 'mistral_rate_limited',
    uncertain: false,
    permanent: false,
  });
  assertEquals(classify(new IngestError('mistral_rejected', 'x', true, 400)), {
    code: 'mistral_rejected',
    uncertain: false,
    permanent: true,
  });
  assertEquals(classify(new IngestError('mistral_unavailable', 'x', false, 503)), {
    code: 'mistral_unavailable',
    uncertain: true,
    permanent: false,
  });
  assertEquals(classify(new IngestError('Weird Code', 'x', false)), {
    code: 'ocr_failed',
    uncertain: true,
    permanent: false,
  });
  assertEquals(classify(new TypeError('boom')), { code: 'internal', uncertain: true, permanent: false });
});

Deno.test('runOnce: each kind of OCR failure is reported to the database with its billing flags', async () => {
  const cases: Array<[Error, unknown[]]> = [
    [new IngestError('mistral_rate_limited', 'slow down', false, 429), ['mistral_rate_limited', false, false]],
    [new IngestError('mistral_rejected', 'cannot fetch', true, 422), ['mistral_rejected', false, true]],
    [new IngestError('mistral_unavailable', 'timed out', false), ['mistral_unavailable', true, false]],
    [new RangeError('odd'), ['internal', true, false]],
  ];
  for (const [err, want] of cases) {
    const { db, calls } = fakeDb([claimed(1)]);
    const { deps } = work(db, () => Promise.reject(err));
    await runOnce(deps);
    assertEquals(calls[1], ['fail', 'id-1', 'tok-1', ...want]);
    assertEquals(calls.filter((c) => c[0] === 'finish').length, 0);
  }
});

Deno.test('runOnce: one request failing does not stop the other, and a failed report never rejects or leaks a key', async () => {
  const calls: string[] = [];
  const db: BudgetOcrDb = {
    claim: () => Promise.resolve({ claimed: [claimed(1), claimed(2)], refused: null }),
    finish: (id) => {
      calls.push(`finish ${id}`);
      return id === 'id-1' ? Promise.reject(new Error(`database said no ${API_KEY}`)) : Promise.resolve('done');
    },
    fail: () => Promise.resolve('queued'),
  };
  const { deps, logs } = work(db, () => Promise.resolve(result([0, 1])));
  await runOnce(deps);
  assertEquals(calls.sort(), ['finish id-1', 'finish id-2']);
  assert(logs.some(([e]) => e === 'budget_ocr.report_failed'));
  assert(!JSON.stringify(logs).includes(API_KEY));
});

// ─── The time limit ──────────────────────────────────────────────────────────

Deno.test('the OCR time limit is set and shorter than the claim lease', () => {
  assert(OCR_TIMEOUT_MS > 0 && OCR_TIMEOUT_MS < 300_000);
});

Deno.test('withTimeout: gives the call a signal and aborts a call that never returns', async () => {
  let seen: AbortSignal | undefined;
  const hang = ((_u: unknown, init?: RequestInit) => {
    seen = init?.signal ?? undefined;
    return new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
  }) as typeof fetch;
  const started = Date.now();
  await assertRejects(() => withTimeout(hang, 30)('https://x/y'));
  assert(seen !== undefined && seen.aborted);
  assert(Date.now() - started < 2000);
});

Deno.test('mistralOcr: a hung Mistral call becomes mistral_unavailable (uncertain) with no key in the message, and a good call maps its pages', async () => {
  const hang =
    ((_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) =>
        init?.signal?.addEventListener('abort', () => rej(new Error(`aborted ${API_KEY}`)))
      )) as typeof fetch;
  const err = await assertRejects(() => mistralOcr(hang, API_KEY, 30)(ocrRequestFor(URL1, 1)), IngestError);
  assertEquals(err.code, 'mistral_unavailable');
  assert(!err.message.includes(API_KEY));
  assertEquals(classify(err).uncertain, true);

  let sentBody: Record<string, unknown> = {};
  let sentHeaders: Headers | undefined;
  const ok = ((_u: unknown, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    sentHeaders = new Headers(init?.headers);
    assert(init?.signal instanceof AbortSignal);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'm',
          pages: [{ index: 0, markdown: 'a' }, { index: 1, markdown: 'b' }],
          usage_info: { pages_processed: 2 },
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  const got = await mistralOcr(ok, API_KEY, 1000)(ocrRequestFor(URL1, 2));
  assertEquals(got.pages.map((p) => p.markdown), ['a', 'b']);
  assertEquals(got.pagesProcessed, 2);
  assertEquals(sentBody.document, { type: 'document_url', document_url: URL1 });
  assertEquals(sentBody.pages, [0, 1]);
  assertEquals(sentBody.include_image_base64, false);
  assertEquals(sentHeaders?.get('authorization'), `Bearer ${API_KEY}`);
});
