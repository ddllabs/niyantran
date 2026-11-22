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
import {
  IngestError,
  type MistralOcrPage,
  OCR_FLAGS,
  OCR_MODEL,
  type OcrCallResult,
  type StoredOcrPage,
} from '../ingest-worker/types.ts';
import { buildOcrRequest, mapOcrPage } from '../ingest-worker/mistral.ts';
import { planIndex } from '../ingest-worker/index-step.ts';

const SECRET = 'budget-secret-0123456789-abcdefghij';
const API_KEY = 'mistral-key-0123456789abcdef';
const URL1 = 'https://www.indiabudget.gov.in/doc/bh1.pdf';

/** A claim; the default 5 pages is the smallest document Mistral reads (engine rule, 2026-11-22). */
const claimed = (n: number, pages = 5): Claimed => ({
  id: `id-${n}`,
  token: `tok-${n}`,
  source_key: n.toString(16).padStart(40, '0'),
  official_url: `https://www.indiabudget.gov.in/doc/bh${n}.pdf`,
  expected_pages: pages,
});

const page = (index: number, markdown = `text ${index}`) => ({ index, markdown });
/** The page indexes of a 5-page Mistral request. */
const P5 = [0, 1, 2, 3, 4];
/** The given Mistral pages, with `page(i)` added for each index below `n` they leave out. */
const fill = <T extends { index: number }>(pages: T[], n = 5) => [
  ...pages,
  ...Array.from({ length: n }, (_, i) => i).filter((i) => !pages.some((p) => p.index === i)).map((i) => page(i)),
];
/** The texts `fill` adds for pages 2 to 4. */
const FILLED = ['text 2', 'text 3', 'text 4'];
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

/** A vision dependency for the Mistral-only tests: any call to it is recorded and refused. */
const noVision = (seen: string[] = []): WorkDeps['vision'] => ({
  fetch: ((
    input: unknown,
  ) => (seen.push(String(input)), Promise.reject(new Error('no vision call expected')))) as typeof fetch,
  apiKey: 'sk-or-v1-unused0123456789abcdef',
});

function work(db: BudgetOcrDb, ocr: WorkDeps['ocr'], vision: WorkDeps['vision'] = noVision()) {
  const logs: Array<[string, Record<string, unknown>]> = [];
  const deps: WorkDeps = { db, ocr, vision, log: (e, f) => logs.push([e, f]), secrets: [API_KEY, SECRET] };
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
    work: () => (built++, work(fakeDb([claimed(1)]).db, () => Promise.resolve(result(P5))).deps),
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
  const w = work(db, () => Promise.resolve(result(P5)));
  const { deps, ran } = handlerDeps({ work: () => w.deps });
  const res = await handleBudgetOcr(post({ 'x-budget-ocr-secret': SECRET }), deps);
  assertEquals(res.status, 202);
  await Promise.all(ran);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
});

// ─── One run ─────────────────────────────────────────────────────────────────

/** The OCR flags of a request or a sent body: the keys of the ingest worker's OCR_FLAGS, nothing else. */
const flagsOf = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(OCR_FLAGS).map((k) => [k, o[k]]));

Deno.test('ocrRequestFor: the official URL as document_url, exactly the expected pages, the OCR flags of the ingest worker with markdown tables', () => {
  const r = ocrRequestFor(URL1, 3);
  assertEquals(r.document, { type: 'document_url', document_url: URL1 });
  assertEquals(r.pages, [0, 1, 2]);
  // Markdown tables again (2026-11-22): HTML gave the same loss (F409), so the request is the worker's exactly.
  assertEquals(flagsOf(r as unknown as Record<string, unknown>), { ...OCR_FLAGS, table_format: 'markdown' });
  assertEquals(r.include_blocks, true);
  assertEquals(r.include_image_base64, true);
  assertEquals(r, buildOcrRequest(OCR_MODEL, URL1, [0, 1, 2]));
  // The ingest worker's own flags are not changed by this.
  assertEquals(OCR_FLAGS.table_format, 'markdown');
  assertEquals(buildOcrRequest(OCR_MODEL, URL1, [0]).table_format, 'markdown');
});

Deno.test('runOnce: claims CLAIM_LIMIT, calls OCR with each URL, stores the pages in order with the pages processed', async () => {
  const { db, calls } = fakeDb([claimed(1, 5), claimed(2, 6)]);
  const seen: unknown[] = [];
  const { deps, logs } = work(db, (req) => {
    seen.push(req);
    // Mistral returns pages in any order.
    return Promise.resolve(req.pages.length === 5 ? result([4, 1, 0, 3, 2]) : result([5, 2, 0, 1, 4, 3]));
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
  assertEquals(one.slice(2), ['tok-1', 5, ['text 0', 'text 1', ...FILLED]]);
  assertEquals(fin.find((c) => c[1] === 'id-2')!.slice(2), ['tok-2', 6, ['text 0', 'text 1', ...FILLED, 'text 5']]);
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
  const { db, calls } = fakeDb([claimed(1, 5)]);
  const { deps, logs } = work(db, () => Promise.resolve(result([0, 1, 2, 3, 9], 5)));
  await runOnce(deps);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 5, []]);
  assert(logs.some(([e]) => e === 'budget_ocr.page_mismatch'));
});

Deno.test('runOnce: a NUL character in the OCR text is removed before the text is stored (the database cannot hold it)', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const { deps } = work(db, () =>
    Promise.resolve({
      ...result(P5),
      pages: fill([{ index: 1, markdown: 'b\u0000b' }, { index: 0, markdown: 'a\u0000\u0000a' }]),
    }));
  await runOnce(deps);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 5, ['aa', 'bb', ...FILLED]]);
});

Deno.test('runOnce: each table Mistral returns apart is put back in its page, in place of its placeholder (F408)', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const { deps } = work(db, () =>
    Promise.resolve({
      ...result(P5),
      pages: fill([
        { index: 1, markdown: 'no table here' },
        {
          index: 0,
          markdown: 'Demand\n\n[tbl-0.md](tbl-0.md)\n\nNotes\n\n[tbl-1.md](tbl-1.md)',
          tables: [
            { id: 'tbl-0.md', content: '| a | b |\n|---|---|\n| 1 | 2 |', format: 'markdown' },
            { id: 'tbl-1.md', content: '| c |\n|---|\n| 3\u0000 |', format: 'markdown' },
          ],
        },
      ]),
    }));
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 5, [
    'Demand\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nNotes\n\n| c |\n|---|\n| 3 |',
    'no table here',
    ...FILLED,
  ]]);
  assert(!JSON.stringify(calls[1]).includes('tbl-'));
});

Deno.test('runOnce: a table placeholder with no table is a failed request (billed, final), never stored as text (F408)', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const { deps, logs } = work(db, () =>
    Promise.resolve({
      ...result(P5),
      pages: fill([
        { index: 0, markdown: 'fine', tables: [] },
        {
          index: 1,
          markdown: '[tbl-0.md](tbl-0.md) and [tbl-1.md](tbl-1.md)',
          tables: [{ id: 'tbl-0.md', content: '| x |' }],
        },
      ]),
    }));
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'fail']);
  // code, uncertain (the call was billed), permanent (OCR again gives the same answer)
  assertEquals(calls[1], ['fail', 'id-1', 'tok-1', 'ocr_table_unresolved', true, true]);
  const logged = logs.find(([e]) => e === 'budget_ocr.table_unresolved');
  assert(logged);
  assertEquals(logged[1].unresolved, 1);
  assert(!JSON.stringify(logs).includes('fine'));
});

// The two HTML-table runOnce tests went with BUDGET_TABLE_FORMAT 'html' (2026-11-22: markdown tables again). With markdown
// tables the composition is the ingest worker's own, with no html option; the html path itself stays covered in
// _shared/pageText_test.ts (htmlTables: true) and comes back by changing the one constant.

Deno.test('runOnce: a header or footer line that differs between pages is kept, one repeated on every page is dropped (F408)', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const { deps } = work(db, () =>
    Promise.resolve({
      ...result(P5),
      pages: [
        { index: 2, markdown: 'third body', header: 'Union Budget 2024-2025', footer: 'Page 3\nSee the annex' },
        { index: 0, markdown: 'first body', header: 'Union Budget 2024-2025\nDemand for Grants', footer: 'Page 1' },
        { index: 4, markdown: 'fifth body', header: 'Union Budget 2024-2025', footer: 'Page 5' },
        { index: 1, markdown: 'second body', header: 'Union Budget 2024-2025\nReceipt Budget', footer: 'Page 2' },
        { index: 3, markdown: 'fourth body', header: 'Union Budget 2024-2025', footer: 'Page 4' },
      ],
    }));
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 5, [
    'Demand for Grants\n\nfirst body',
    'Receipt Budget\n\nsecond body',
    'third body\n\nSee the annex',
    'fourth body',
    'fifth body',
  ]]);
});

Deno.test('runOnce: an image placeholder is rewritten as the ingest worker writes it, and an image-only page has no text (F408)', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  const { deps } = work(db, () =>
    Promise.resolve({
      ...result(P5),
      pages: fill([
        { index: 0, markdown: 'Chart of receipts\n\n![img-0.jpeg](img-0.jpeg)', images: [{ id: 'img-0.jpeg' }] },
        { index: 1, markdown: '![img-0.jpeg](img-0.jpeg)', images: [{ id: 'img-0.jpeg' }] },
      ]),
    }));
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 5, [
    'Chart of receipts\n\n![img:1-0](img:1-0)',
    '',
    ...FILLED,
  ]]);
  assert(!JSON.stringify(calls[1]).includes('img-0'));
});

Deno.test('runOnce: the page texts equal the ingest worker composition of the same Mistral answer (F408)', async () => {
  // The real 12-page bill (headers and footers per page), with a table on page 3 and an image on page 4 added, so all
  // three differences between page.markdown and the composed text are exercised.
  const bill = JSON.parse(
    await Deno.readTextFile(new URL('../_shared/__fixtures__/mistral-bill-12p.json', import.meta.url)),
  ) as { pages: MistralOcrPage[] };
  const pages: MistralOcrPage[] = bill.pages.map((p) => ({ ...p }));
  pages[2] = {
    ...pages[2],
    markdown: `${pages[2].markdown}\n\n[tbl-0.md](tbl-0.md)`,
    tables: [{ id: 'tbl-0.md', content: '| head |\n|---|\n| cell |', format: 'markdown' }],
  };
  pages[3] = {
    ...pages[3],
    markdown: `${pages[3].markdown}\n\n![img-0.jpeg](img-0.jpeg)`,
    images: [{ id: 'img-0.jpeg' }],
  };
  const n = pages.length;

  // The worker: Mistral page → stored raw page (mapOcrPage) → planIndex, whose page rows hold the composed texts.
  const stored: StoredOcrPage[] = pages.map((p) => ({
    page_number: p.index + 1,
    raw: mapOcrPage(
      p,
      0,
      (p.images ?? []).map((im) => ({ id: im.id, sha256: null, mime: null, byte_size: null, skipped: 'no_data' })),
    ),
  }));
  const plan = await planIndex('doc-1', 'hash-1', n, stored);
  const worker = plan.pages.map((p) => p.text);

  // Not vacuous: the composition differs from the raw markdown, holds the table and the rewritten image, and restores
  // or drops header and footer lines.
  assert(worker.some((t, i) => t !== pages[i].markdown.trim()));
  assert(worker[2].includes('| cell |') && !worker[2].includes('tbl-0'));
  assert(worker[3].includes('![img:4-0](img:4-0)'));
  assert(plan.document.pages.some((p) => p.header_in_text || p.footer_in_text));

  const { db, calls } = fakeDb([claimed(1, n)]);
  const { deps } = work(
    db,
    () => Promise.resolve({ ...result(pages.map((p) => p.index)), pages: [...pages].reverse() }),
  );
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
  assertEquals(calls[1][4], worker);
});

Deno.test('runOnce: a finish that throws ends the request for good with its estimate counted, so it is never paid for again', async () => {
  const { db, calls } = fakeDb([claimed(1)]);
  db.finish = (id, token, pages, texts) => {
    calls.push(['finish', id, token, pages, texts]);
    return Promise.reject(new Error(`database said no ${API_KEY}`));
  };
  const { deps, logs } = work(db, () => Promise.resolve(result(P5)));
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
  const { deps, logs } = work(db, () => Promise.resolve(result(P5)));
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
  const { deps, logs } = work(db, () => Promise.resolve(result(P5)));
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
  // The body Mistral receives carries the ingest worker's flags (blocks and image data included, markdown tables), and
  // nothing more.
  assertEquals(flagsOf(sentBody), { ...OCR_FLAGS, table_format: 'markdown' });
  assertEquals(sentBody.include_blocks, true);
  assertEquals(sentBody.include_image_base64, true);
  assertEquals(sentBody, {
    model: OCR_MODEL,
    document: { type: 'document_url', document_url: URL1 },
    pages: [0, 1],
    ...OCR_FLAGS,
  });
  assertEquals(sentHeaders?.get('authorization'), `Bearer ${API_KEY}`);
});

// ─── The vision trial (F409) ─────────────────────────────────────────────────

const OR_KEY = 'sk-or-v1-trialkey0123456789abcdef';
const TRIAL_KEY = 'ab'.repeat(20);
const TRIAL_URL = 'https://www.indiabudget.gov.in/doc/eb/sbe42.pdf';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nfake two-page budget document\n%%EOF');
const PDF_DATA_URL = `data:application/pdf;base64,${btoa(String.fromCharCode(...PDF_BYTES))}`;
const DOC_TEXT = '=== PAGE 1 ===\n| a | b |\n|---|---|\n| 1 | 2 |\n=== PAGE 2 ===\nNotes';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const trialPost = (body: unknown, headers: Record<string, string> = { 'x-budget-ocr-secret': SECRET }) =>
  new Request('https://x/budget-ocr', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const trialBody = (over: Record<string, unknown> = {}) => ({
  trial: 'vision',
  model: 'google/gemini-2.5-flash',
  source_key: TRIAL_KEY,
  ...over,
});

interface Sent {
  url: string;
  init: RequestInit;
}

/** The trial's dependencies: a read-only lookup and one fetch, routed by URL (the official PDF, then OpenRouter). */
function trialSetup(opts: {
  rows?: Array<Record<string, unknown>>;
  pdf?: (init: RequestInit) => Promise<Response>;
  chat?: (init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
} = {}) {
  const reads: string[][] = [];
  const sent: Sent[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const rows = opts.rows ?? [{ source_key: TRIAL_KEY, official_url: TRIAL_URL, expected_pages: 2, status: 'done' }];
  const fetchImpl = ((input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    sent.push({ url, init });
    if (url === CHAT_URL) {
      return opts.chat?.(init) ?? Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'google/gemini-2.5-flash',
            choices: [{ message: { role: 'assistant', content: DOC_TEXT }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540, cost: 0.00123 },
          }),
          { status: 200 },
        ),
      );
    }
    return opts.pdf?.(init) ?? Promise.resolve(new Response(PDF_BYTES, { status: 200 }));
  }) as typeof fetch;
  let built = 0;
  const trial = () => {
    built++;
    return {
      read: (keys: string[]) => (reads.push(keys), Promise.resolve(rows)),
      fetch: fetchImpl,
      apiKey: OR_KEY,
      log: (e: string, f: Record<string, unknown>) => void logs.push([e, f]),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    };
  };
  // The cron path's database: any call to it in trial mode is a failure.
  const cron = fakeDb([claimed(1)]);
  let workBuilt = 0;
  const h = handlerDeps({
    trial,
    work: () => (workBuilt++, work(cron.db, () => Promise.resolve(result(P5))).deps),
  } as unknown as Partial<HandlerDeps>);
  return {
    ...h,
    reads,
    sent,
    trialLogs: logs,
    cronCalls: cron.calls,
    built: () => built,
    workBuilt: () => workBuilt,
  };
}

/** Nothing of the document, its URL or a key in a response or a log. */
function assertNothingLeaks(text: string) {
  for (const s of [DOC_TEXT, 'Notes', TRIAL_URL, 'indiabudget', OR_KEY, SECRET, PDF_DATA_URL.slice(30, 60)]) {
    assert(!text.includes(s), `leaked ${s.slice(0, 20)}`);
  }
}

Deno.test('trial: a missing or wrong secret is the same bare 401 for a trial body, and nothing is read or called', async () => {
  for (const headers of [{} as Record<string, string>, { 'x-budget-ocr-secret': 'wrong' }]) {
    const t = trialSetup();
    const res = await handleBudgetOcr(trialPost(trialBody(), headers), t.deps);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'unauthorized' });
    assertEquals(t.built(), 0);
    assertEquals(t.reads.length, 0);
    assertEquals(t.sent.length, 0);
    assertEquals(t.ran.length, 0);
  }
  // An unset secret refuses a trial body too.
  const t = trialSetup();
  const res = await handleBudgetOcr(trialPost(trialBody(), { 'x-budget-ocr-secret': '' }), { ...t.deps, secret: '' });
  assertEquals(res.status, 401);
  assertEquals(t.built(), 0);
});

Deno.test('trial: a model outside the allowlist, an unknown trial or a malformed key is 400 before any lookup or call', async () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ model: 'google/gemini-2.5-pro' }, 'model_not_allowed'],
    [{ model: 'openai/gpt-5-mini ' }, 'model_not_allowed'],
    [{ model: 'GOOGLE/GEMINI-2.5-FLASH' }, 'model_not_allowed'],
    [{ model: undefined }, 'model_not_allowed'],
    [{ trial: 'text' }, 'trial_unknown'],
    [{ source_key: 'AB'.repeat(20) }, 'source_key_invalid'],
    [{ source_key: 'ab'.repeat(19) }, 'source_key_invalid'],
    [{ source_key: 42 }, 'source_key_invalid'],
  ];
  for (const [over, code] of bad) {
    const t = trialSetup();
    const res = await handleBudgetOcr(trialPost(trialBody(over)), t.deps);
    assertEquals(res.status, 400, code);
    assertEquals(await res.json(), { error: code });
    assertEquals(t.reads.length, 0);
    assertEquals(t.sent.length, 0);
    assertEquals(t.workBuilt(), 0);
  }
});

Deno.test('trial: an unknown source key or a document over 5 pages is 400, with no fetch and no model call', async () => {
  const cases: Array<[Array<Record<string, unknown>>, string]> = [
    [[], 'not_found'],
    [[{ source_key: 'cd'.repeat(20), official_url: TRIAL_URL, expected_pages: 2, status: 'done' }], 'not_found'],
    [[{ source_key: TRIAL_KEY, official_url: TRIAL_URL, expected_pages: 6, status: 'queued' }], 'too_many_pages'],
    [[{ source_key: TRIAL_KEY, official_url: TRIAL_URL, expected_pages: 62, status: 'done' }], 'too_many_pages'],
  ];
  for (const [rows, code] of cases) {
    const t = trialSetup({ rows });
    const res = await handleBudgetOcr(trialPost(trialBody()), t.deps);
    assertEquals(res.status, 400, code);
    assertEquals(await res.json(), { error: code });
    assertEquals(t.reads, [[TRIAL_KEY]]);
    assertEquals(t.sent.length, 0);
  }
  // Exactly 5 pages is within the trial bound.
  const t = trialSetup({
    rows: [{ source_key: TRIAL_KEY, official_url: TRIAL_URL, expected_pages: 5, status: 'done' }],
  });
  assertEquals((await handleBudgetOcr(trialPost(trialBody()), t.deps)).status, 200);
});

Deno.test('trial: OpenRouter gets the model, the PDF as a file part, the native PDF engine, temperature 0, max_tokens and usage', async () => {
  for (const model of ['google/gemini-2.5-flash', 'openai/gpt-5-mini']) {
    const t = trialSetup();
    const res = await handleBudgetOcr(trialPost(trialBody({ model })), t.deps);
    assertEquals(res.status, 200);
    // The official PDF is fetched once, from the queue row's URL, without following a redirect, under a time limit.
    assertEquals(t.sent.map((s) => s.url), [TRIAL_URL, CHAT_URL]);
    assertEquals(t.sent[0].init.method ?? 'GET', 'GET');
    assertEquals(t.sent[0].init.redirect, 'error');
    assert(t.sent[0].init.signal instanceof AbortSignal);
    const chat = t.sent[1];
    assertEquals(chat.init.method, 'POST');
    assert(chat.init.signal instanceof AbortSignal);
    assertEquals(new Headers(chat.init.headers).get('authorization'), `Bearer ${OR_KEY}`);
    const body = JSON.parse(String(chat.init.body));
    assertEquals(body.model, model);
    assertEquals(body.temperature, 0);
    assertEquals(body.max_tokens, 16000);
    assertEquals(body.usage, { include: true });
    assertEquals(body.plugins, [{ id: 'file-parser', pdf: { engine: 'native' } }]);
    assert(body.stream !== true);
    assertEquals(body.messages.length, 2);
    assertEquals(body.messages[0].role, 'system');
    assertEquals(body.messages[1].role, 'user');
    const parts = body.messages[1].content as Array<Record<string, unknown>>;
    const file = parts.find((p) => p.type === 'file');
    assertEquals(file, { type: 'file', file: { filename: `${TRIAL_KEY}.pdf`, file_data: PDF_DATA_URL } });
    const prompt = [body.messages[0].content, ...parts.filter((p) => p.type === 'text').map((p) => p.text)].join('\n');
    for (const needle of ['=== PAGE', 'markdown', 'Hindi', 'column', '...']) assert(prompt.includes(needle), needle);
  }
});

Deno.test('trial: the answer carries the model, the key, the text and the usage with its cost; the log carries no text, URL or key', async () => {
  const t = trialSetup();
  const res = await handleBudgetOcr(trialPost(trialBody({ model: 'openai/gpt-5-mini' })), t.deps);
  assertEquals(res.status, 200);
  const got = await res.json();
  assertEquals(got.model, 'openai/gpt-5-mini');
  assertEquals(got.source_key, TRIAL_KEY);
  assertEquals(got.text, DOC_TEXT);
  assertEquals(got.usage, { prompt_tokens: 1200, completion_tokens: 340, cost: 0.00123 });
  const done = t.trialLogs.find(([e]) => e === 'budget_ocr.trial_finished');
  assert(done);
  assertEquals(done[1].source_key, TRIAL_KEY);
  assertEquals(done[1].model, 'openai/gpt-5-mini');
  assertEquals(done[1].prompt_tokens, 1200);
  assertEquals(done[1].completion_tokens, 340);
  assertEquals(done[1].cost, 0.00123);
  assert(typeof done[1].latency_ms === 'number');
  assertNothingLeaks(JSON.stringify([t.trialLogs, t.logs]));
});

Deno.test('trial: nothing touches the queue, the cap or the cron path (no work built, no claim, finish or fail, no waitUntil)', async () => {
  const t = trialSetup();
  assertEquals((await handleBudgetOcr(trialPost(trialBody()), t.deps)).status, 200);
  assertEquals(t.workBuilt(), 0);
  assertEquals(t.cronCalls, []);
  assertEquals(t.ran.length, 0);
  // The only database call is the read-only lookup.
  assertEquals(t.reads, [[TRIAL_KEY]]);
});

Deno.test('trial: failures answer a bare JSON error code, never the text, the URL or a key', async () => {
  const cases: Array<[Parameters<typeof trialSetup>[0], number, string]> = [
    [{ pdf: () => Promise.resolve(new Response('gone', { status: 404 })) }, 502, 'pdf_fetch_failed'],
    [{ pdf: () => Promise.reject(new TypeError(`redirect to ${TRIAL_URL}`)) }, 502, 'pdf_fetch_failed'],
    [{ pdf: () => Promise.resolve(new Response('<html>not a pdf</html>', { status: 200 })) }, 502, 'not_pdf'],
    [{ chat: () => Promise.resolve(new Response(`bad key ${OR_KEY}`, { status: 401 })) }, 502, 'openrouter_failed'],
    [{ chat: () => Promise.resolve(new Response('slow', { status: 429 })) }, 502, 'openrouter_rate_limited'],
    [{ chat: () => Promise.resolve(new Response('not json', { status: 200 })) }, 502, 'openrouter_unreadable'],
    [
      { chat: () => Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 })) },
      502,
      'openrouter_empty',
    ],
    [
      {
        rows: [{ source_key: TRIAL_KEY, official_url: 'https://www.indiabudget.gov.in:8443/x.pdf', expected_pages: 2 }],
      },
      400,
      'official_url_invalid',
    ],
  ];
  for (const [opts, status, code] of cases) {
    const t = trialSetup(opts);
    const res = await handleBudgetOcr(trialPost(trialBody()), t.deps);
    assertEquals(res.status, status, code);
    const text = await res.text();
    assertEquals(JSON.parse(text), { error: code });
    assertNothingLeaks(text + JSON.stringify([t.trialLogs, t.logs]));
    assertEquals(t.cronCalls, []);
  }
});

Deno.test('trial: an OpenRouter call that does not answer is aborted under the time limit and reported as a timeout', async () => {
  const t = trialSetup({
    timeoutMs: 30,
    chat: (init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason))),
  });
  const started = Date.now();
  const res = await handleBudgetOcr(trialPost(trialBody()), t.deps);
  assertEquals(res.status, 504);
  assertEquals(await res.json(), { error: 'openrouter_timeout' });
  assert(Date.now() - started < 2000);
});

Deno.test('trial: a trial request on a function with no trial configured (no OpenRouter key) is 503, nothing called', async () => {
  const t = trialSetup();
  const res = await handleBudgetOcr(trialPost(trialBody()), {
    ...t.deps,
    trial: () => {
      throw new Error(`OPENROUTER_API_KEY is not set ${SECRET}`);
    },
  } as unknown as HandlerDeps);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: 'not configured' });
  assertEquals(t.sent.length, 0);
  assertEquals(t.workBuilt(), 0);
});

Deno.test('cron mode: an empty JSON body, no body or a body without `trial` runs the queue exactly as before', async () => {
  for (const body of ['{}', '', undefined, '{"foo":1}', 'not json']) {
    const t = trialSetup();
    const req = body === undefined
      ? post({ 'x-budget-ocr-secret': SECRET })
      : trialPost(body, { 'x-budget-ocr-secret': SECRET });
    const res = await handleBudgetOcr(req, t.deps);
    assertEquals(res.status, 202, String(body));
    assertEquals(await res.json(), { accepted: true });
    await Promise.all(t.ran);
    assertEquals(t.cronCalls.map((c) => c[0]), ['claim', 'finish']);
    assertEquals(t.cronCalls[0], ['claim', CLAIM_LIMIT, 300]);
    assertEquals(t.built(), 0);
    assertEquals(t.sent.length, 0);
  }
});

// ─── The engine by page count (developer decision 2026-11-22, F409) ──────────

const PROD_OR_KEY = 'sk-or-v1-prodkey0123456789abcdefgh';
const VISION_TEXT = (n: number, body = (i: number) => `| row ${i} | 1 | 2 |`) =>
  Array.from({ length: n }, (_, i) => `=== PAGE ${i + 1} ===\n${body(i + 1)}\n`).join('');

/** The production vision path's fetch: the official PDF, then OpenRouter, routed by URL; every call recorded. */
function visionSetup(opts: {
  content?: unknown;
  finish?: string;
  chat?: (init: RequestInit) => Promise<Response>;
  pdf?: () => Promise<Response>;
  timeoutMs?: number;
} = {}) {
  const sent: Sent[] = [];
  const fetchImpl = ((input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    sent.push({ url, init });
    if (url === CHAT_URL) {
      return opts.chat?.(init) ?? Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'openai/gpt-5-mini',
            choices: [{
              message: { role: 'assistant', content: 'content' in opts ? opts.content : VISION_TEXT(4) },
              finish_reason: opts.finish ?? 'stop',
            }],
            usage: { prompt_tokens: 5100, completion_tokens: 9800, total_tokens: 14900, cost: 0.0213 },
          }),
          { status: 200 },
        ),
      );
    }
    return opts.pdf?.() ?? Promise.resolve(new Response(PDF_BYTES, { status: 200 }));
  }) as typeof fetch;
  const vision = {
    fetch: fetchImpl,
    apiKey: PROD_OR_KEY,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  } as WorkDeps['vision'];
  return { vision, sent };
}

/** Nothing of the page text, the official URL or a key in the logs. */
function assertLogsClean(logs: unknown) {
  const text = JSON.stringify(logs);
  for (const s of ['row 1', 'indiabudget', PROD_OR_KEY, API_KEY, SECRET, PDF_DATA_URL.slice(30, 60)]) {
    assert(!text.includes(s), `leaked ${s.slice(0, 20)}`);
  }
}

Deno.test('engine: a claim of 4 pages goes to GPT-5 mini through OpenRouter with the proven request, never to Mistral', async () => {
  const { db, calls } = fakeDb([claimed(1, 4)]);
  const v = visionSetup();
  let ocrCalls = 0;
  const { deps } = work(db, () => (ocrCalls++, Promise.resolve(result(P5))), v.vision);
  await runOnce(deps);
  assertEquals(ocrCalls, 0);
  // The official PDF from the claim, fetched once with no redirect and a time limit, then OpenRouter.
  assertEquals(v.sent.map((s) => s.url), ['https://www.indiabudget.gov.in/doc/bh1.pdf', CHAT_URL]);
  assertEquals(v.sent[0].init.redirect, 'error');
  assert(v.sent[0].init.signal instanceof AbortSignal);
  const chat = v.sent[1];
  assertEquals(chat.init.method, 'POST');
  assert(chat.init.signal instanceof AbortSignal);
  assertEquals(new Headers(chat.init.headers).get('authorization'), `Bearer ${PROD_OR_KEY}`);
  const body = JSON.parse(String(chat.init.body));
  assertEquals(body.model, 'openai/gpt-5-mini');
  assertEquals(body.temperature, 0);
  assertEquals(body.max_tokens, 32000);
  assertEquals(body.usage, { include: true });
  assertEquals(body.plugins, [{ id: 'file-parser', pdf: { engine: 'native' } }]);
  assert(body.stream !== true);
  const parts = body.messages[1].content as Array<Record<string, unknown>>;
  assertEquals(parts.find((p) => p.type === 'file'), {
    type: 'file',
    file: { filename: `${claimed(1).source_key}.pdf`, file_data: PDF_DATA_URL },
  });
  const prompt = [body.messages[0].content, ...parts.filter((p) => p.type === 'text').map((p) => p.text)].join('\n');
  assert(prompt.includes('=== PAGE n ==='));
  // Split into exactly the expected pages, the marker lines removed, and finished with the expected page count.
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 4, [
    '| row 1 | 1 | 2 |',
    '| row 2 | 1 | 2 |',
    '| row 3 | 1 | 2 |',
    '| row 4 | 1 | 2 |',
  ]]);
});

Deno.test('engine: a claim of 1 page is vision too; a claim of 5 pages is Mistral with markdown tables, never OpenRouter', async () => {
  const one = fakeDb([claimed(1, 1)]);
  const v1 = visionSetup({ content: VISION_TEXT(1) });
  await runOnce(work(one.db, () => Promise.reject(new Error('no Mistral call expected')), v1.vision).deps);
  assertEquals(one.calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 1, ['| row 1 | 1 | 2 |']]);

  const five = fakeDb([claimed(2, 5)]);
  const seenVision: string[] = [];
  const seen: Array<Record<string, unknown>> = [];
  const ocr: WorkDeps['ocr'] = (
    req,
  ) => (seen.push(req as unknown as Record<string, unknown>), Promise.resolve(result(P5)));
  await runOnce(work(five.db, ocr, noVision(seenVision)).deps);
  assertEquals(seenVision, []);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].table_format, 'markdown');
  assertEquals(seen[0].pages, P5);
  assertEquals(five.calls[1].slice(0, 4), ['finish', 'id-2', 'tok-2', 5]);
});

Deno.test('engine: one claim of each kind in the same run goes to its own engine, and both run at the same time', async () => {
  const { db, calls } = fakeDb([claimed(1, 3), claimed(2, 6)]);
  // The OpenRouter answer waits until Mistral has been called: run one after the other, this would time out.
  let mistralCalled!: () => void;
  const mistralStarted = new Promise<void>((r) => (mistralCalled = r));
  const v = visionSetup({
    timeoutMs: 2000,
    chat: async () => {
      await mistralStarted;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: VISION_TEXT(3) }, finish_reason: 'stop' }], usage: {} }),
        { status: 200 },
      );
    },
  });
  const { deps } = work(db, () => (mistralCalled(), Promise.resolve(result([0, 1, 2, 3, 4, 5]))), v.vision);
  await runOnce(deps);
  const fin = calls.filter((c) => c[0] === 'finish');
  assertEquals(fin.map((c) => [c[1], c[3], (c[4] as string[]).length]).sort(), [['id-1', 3, 3], ['id-2', 6, 6]]);
});

Deno.test('engine: a vision answer that cannot be split into the expected pages, truncated or empty is failed (billed), never finished', async () => {
  const cases: Array<[Parameters<typeof visionSetup>[0], string, boolean]> = [
    // the code, then permanent; uncertain is always true (the call was billed)
    [{ content: VISION_TEXT(3) }, 'vision_page_split', false],
    [{ content: VISION_TEXT(5) }, 'vision_page_split', false],
    [
      { content: '=== PAGE 1 ===\na\n=== PAGE 3 ===\nb\n=== PAGE 2 ===\nc\n=== PAGE 4 ===\nd' },
      'vision_page_split',
      false,
    ],
    [{ content: `Here is the transcription.\n${VISION_TEXT(4)}` }, 'vision_page_split', false],
    [{ content: VISION_TEXT(4), finish: 'length' }, 'vision_truncated', true],
    [{ content: VISION_TEXT(2), finish: 'length' }, 'vision_truncated', true],
    [{ content: '  \n\n ' }, 'vision_empty', false],
    [{ content: '' }, 'vision_empty', false],
    [{ content: null }, 'vision_empty', false],
  ];
  for (const [opts, code, permanent] of cases) {
    const { db, calls } = fakeDb([claimed(1, 4)]);
    const v = visionSetup(opts);
    const { deps, logs } = work(db, () => Promise.reject(new Error('no Mistral call expected')), v.vision);
    await runOnce(deps);
    assertEquals(calls.map((c) => c[0]), ['claim', 'fail'], code);
    assertEquals(calls[1], ['fail', 'id-1', 'tok-1', code, true, permanent], code);
    assertLogsClean(logs);
  }
});

Deno.test('engine: a vision failure before or at OpenRouter is failed with what may have been billed, never finished', async () => {
  const hang = (init: RequestInit) =>
    new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
  const cases: Array<[Parameters<typeof visionSetup>[0], unknown[]]> = [
    // the code, uncertain (possibly billed), permanent
    [{ pdf: () => Promise.resolve(new Response('gone', { status: 404 })) }, ['pdf_fetch_failed', false, false]],
    [{ pdf: () => Promise.reject(new TypeError('network down')) }, ['pdf_fetch_failed', false, false]],
    [{ pdf: () => Promise.resolve(new Response('<html></html>', { status: 200 })) }, ['not_pdf', false, true]],
    [{ chat: () => Promise.resolve(new Response('slow', { status: 429 })) }, ['openrouter_rate_limited', false, false]],
    [
      { chat: () => Promise.resolve(new Response(`no ${PROD_OR_KEY}`, { status: 402 })) },
      ['openrouter_rejected', false, true],
    ],
    [{ chat: () => Promise.resolve(new Response('bad', { status: 400 })) }, ['openrouter_rejected', false, true]],
    [{ chat: () => Promise.resolve(new Response('down', { status: 502 })) }, ['openrouter_unavailable', true, false]],
    [{ chat: () => Promise.reject(new TypeError('reset')) }, ['openrouter_unavailable', true, false]],
    [{ chat: () => Promise.resolve(new Response('not json', { status: 200 })) }, [
      'openrouter_unreadable',
      true,
      false,
    ]],
    [{ timeoutMs: 30, chat: hang }, ['openrouter_timeout', true, false]],
  ];
  for (const [opts, want] of cases) {
    const { db, calls } = fakeDb([claimed(1, 2)]);
    const v = visionSetup(opts);
    const { deps, logs } = work(db, () => Promise.reject(new Error('no Mistral call expected')), v.vision);
    await runOnce(deps);
    assertEquals(calls.map((c) => c[0]), ['claim', 'fail'], String(want[0]));
    assertEquals(calls[1], ['fail', 'id-1', 'tok-1', ...want], String(want[0]));
    assertLogsClean(logs);
  }
});

Deno.test('engine: a NUL in the vision text is removed before the text is stored', async () => {
  const { db, calls } = fakeDb([claimed(1, 2)]);
  const v = visionSetup({ content: '=== PAGE 1 ===\na\u0000a\n=== PAGE 2 ===\nb\u0000' });
  await runOnce(work(db, () => Promise.reject(new Error('no')), v.vision).deps);
  assertEquals(calls[1].slice(0, 5), ['finish', 'id-1', 'tok-1', 2, ['aa', 'b']]);
});

Deno.test('engine: a vision finish that throws ends the request for good with its estimate counted', async () => {
  const { db, calls } = fakeDb([claimed(1, 4)]);
  db.finish = (id, token, pages, texts) => {
    calls.push(['finish', id, token, pages, texts]);
    return Promise.reject(new Error(`database said no ${PROD_OR_KEY}`));
  };
  const v = visionSetup();
  const { deps, logs } = work(db, () => Promise.reject(new Error('no')), v.vision);
  await runOnce(deps);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish', 'fail']);
  assertEquals(calls[2], ['fail', 'id-1', 'tok-1', 'report_failed', true, true]);
  assertLogsClean(logs);
});

Deno.test('engine: each request logs its ids, engine, model, pages, tokens, cost, finish reason, latency and outcome, and no text, URL or key', async () => {
  const { db } = fakeDb([claimed(1, 4), claimed(2, 5)]);
  const v = visionSetup();
  const { deps, logs } = work(db, () => Promise.resolve(result(P5)), v.vision);
  await runOnce(deps);
  const done = logs.filter(([e]) => e === 'budget_ocr.finished').map(([, f]) => f);
  const vision = done.find((f) => f.request_id === 'id-1');
  assert(vision);
  assertEquals(vision.source_key, claimed(1).source_key);
  assertEquals(vision.engine, 'vision');
  assertEquals(vision.model, 'openai/gpt-5-mini');
  assertEquals(vision.expected_pages, 4);
  assertEquals(vision.prompt_tokens, 5100);
  assertEquals(vision.completion_tokens, 9800);
  assertEquals(vision.cost, 0.0213);
  assertEquals(vision.finish_reason, 'stop');
  assert(typeof vision.latency_ms === 'number');
  assertEquals(vision.outcome, 'done');
  const mistral = done.find((f) => f.request_id === 'id-2');
  assert(mistral);
  assertEquals(mistral.engine, 'mistral');
  assertEquals(mistral.model, OCR_MODEL);
  assertEquals(mistral.outcome, 'done');
  // A rejected vision answer logs the same fields, with its code as the outcome.
  const bad = fakeDb([claimed(3, 4)]);
  const short = visionSetup({ content: VISION_TEXT(3) });
  const w = work(bad.db, () => Promise.reject(new Error('no')), short.vision);
  await runOnce(w.deps);
  const rejected = w.logs.find(([, f]) => f.outcome === 'vision_page_split');
  assert(rejected);
  assertEquals(rejected[1].engine, 'vision');
  assertEquals(rejected[1].completion_tokens, 9800);
  assertEquals(rejected[1].cost, 0.0213);
  assertLogsClean([logs, w.logs]);
});

Deno.test('cron mode through the handler: a 3-page claim is read by the vision model and finished', async () => {
  const { db, calls } = fakeDb([claimed(1, 3)]);
  const v = visionSetup({ content: VISION_TEXT(3) });
  const { deps, ran } = handlerDeps({ work: () => work(db, () => Promise.reject(new Error('no')), v.vision).deps });
  const res = await handleBudgetOcr(post({ 'x-budget-ocr-secret': SECRET }), deps);
  assertEquals(res.status, 202);
  await Promise.all(ran);
  assertEquals(calls.map((c) => c[0]), ['claim', 'finish']);
  assertEquals(v.sent.map((s) => s.url), ['https://www.indiabudget.gov.in/doc/bh1.pdf', CHAT_URL]);
});
