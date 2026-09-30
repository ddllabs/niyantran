import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  buildOcrRequest,
  callMistralOcr,
  checkIndexes,
  mapOcrPage,
  MISTRAL_OCR_URL,
  OCR_USD_PER_1000_PAGES,
  ocrCostUsd,
} from './mistral.ts';
import { IngestError, type MistralOcrPage, OCR_FLAGS, type OcrRequest } from './types.ts';

const FIXTURE_TEXT = await Deno.readTextFile(new URL('../_shared/__fixtures__/mistral-bill-12p.json', import.meta.url));
const FIXTURE = JSON.parse(FIXTURE_TEXT);

const API_KEY = 'test-mistral-key-0123456789abcdef';
const SIGNED = 'https://proj.supabase.co/storage/v1/object/sign/corpus/files/abc.pdf?token=SIGNED-SECRET-TOKEN';

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(respond(String(input), init ?? {}));
  }) as typeof fetch;
  return { fetch: f, calls };
}

function clock(...times: number[]) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

const request = (pages = [0, 1, 2]): OcrRequest => buildOcrRequest('mistral-ocr-4-1', SIGNED, pages);

// ─── Request builder ─────────────────────────────────────────────────────────

Deno.test('buildOcrRequest: document_url, 0-based page list and the approved flags', () => {
  assertEquals(buildOcrRequest('mistral-ocr-4-1', 'https://x/y.pdf', [3, 4]), {
    model: 'mistral-ocr-4-1',
    document: { type: 'document_url', document_url: 'https://x/y.pdf' },
    pages: [3, 4],
    table_format: 'markdown',
    extract_header: true,
    extract_footer: true,
    include_blocks: true,
    include_image_base64: true,
  });
  for (const [k, v] of Object.entries(OCR_FLAGS)) assertEquals((request() as unknown as Record<string, unknown>)[k], v);
});

Deno.test('buildOcrRequest refuses an empty, negative or fractional page list', () => {
  for (const bad of [[], [-1], [0.5], [1, 1]]) assertThrows(() => buildOcrRequest('m', 'https://x', bad));
});

// ─── The call and response mapping ───────────────────────────────────────────

Deno.test('callMistralOcr POSTs the request with the bearer key and maps the real fixture response', async () => {
  const { fetch, calls } = fakeFetch(() => new Response(FIXTURE_TEXT, { status: 200 }));
  const req = request([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const result = await callMistralOcr({ fetch, apiKey: API_KEY, now: clock(1_000, 1_750) }, req);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, MISTRAL_OCR_URL);
  assertEquals(MISTRAL_OCR_URL, 'https://api.mistral.ai/v1/ocr');
  assertEquals(calls[0].init.method, 'POST');
  const headers = new Headers(calls[0].init.headers);
  assertEquals(headers.get('authorization'), `Bearer ${API_KEY}`);
  assertEquals(headers.get('content-type'), 'application/json');
  assertEquals(JSON.parse(String(calls[0].init.body)), req);

  assertEquals(result.pages.length, 12);
  assertEquals(result.pages.map((p) => p.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assertEquals(result.pages[0].markdown, FIXTURE.pages[0].markdown);
  assertEquals(result.model, 'mistral-ocr-latest'); // an alias echoed back: recorded, not rejected
  assertEquals(result.pagesProcessed, 12);
  assertEquals(result.docSizeBytes, 159325);
  assertEquals(result.bytes, new TextEncoder().encode(FIXTURE_TEXT).length);
  assertEquals(result.latencyMs, 750);
});

Deno.test('callMistralOcr counts the body in bytes, not UTF-16 units', async () => {
  const body = JSON.stringify({
    model: 'm',
    pages: [{ index: 0, markdown: 'क्षेत्र ₹' }],
    usage_info: { pages_processed: 1 },
  });
  const { fetch } = fakeFetch(() => new Response(body));
  const result = await callMistralOcr({ fetch, apiKey: API_KEY }, request([0]));
  assertEquals(result.bytes, new TextEncoder().encode(body).length);
  assert(result.bytes > body.length);
  assertEquals(result.docSizeBytes, null);
});

Deno.test('callMistralOcr: without usage_info.pages_processed, the pages returned are billed', async () => {
  const body = JSON.stringify({ model: 'm', pages: [{ index: 0, markdown: 'a' }, { index: 1, markdown: 'b' }] });
  const { fetch } = fakeFetch(() => new Response(body));
  assertEquals((await callMistralOcr({ fetch, apiKey: API_KEY }, request([0, 1]))).pagesProcessed, 2);
});

async function failure(respond: () => Response | Promise<Response>): Promise<IngestError> {
  const { fetch } = fakeFetch(respond);
  const err = await assertRejects(() => callMistralOcr({ fetch, apiKey: API_KEY }, request()), IngestError);
  return err as IngestError;
}

Deno.test('callMistralOcr: 429 is mistral_rate_limited, not permanent', async () => {
  const e = await failure(() => new Response('{"message":"rate limited"}', { status: 429 }));
  assertEquals([e.code, e.permanent, e.status], ['mistral_rate_limited', false, 429]);
});

Deno.test('callMistralOcr: 5xx is mistral_unavailable, not permanent', async () => {
  for (const status of [500, 502, 503]) {
    const e = await failure(() => new Response('upstream error', { status }));
    assertEquals([e.code, e.permanent, e.status], ['mistral_unavailable', false, status]);
  }
});

Deno.test('callMistralOcr: any other 4xx is mistral_rejected, permanent', async () => {
  for (const status of [400, 401, 403, 404, 413, 422]) {
    const e = await failure(() => new Response('{"message":"bad"}', { status }));
    assertEquals([e.code, e.permanent, e.status], ['mistral_rejected', true, status]);
  }
});

Deno.test('callMistralOcr: a network failure is mistral_unavailable, not permanent', async () => {
  const e = await failure(() => Promise.reject(new TypeError('error sending request: connection reset')));
  assertEquals([e.code, e.permanent], ['mistral_unavailable', false]);
});

Deno.test('callMistralOcr: an unparsable or malformed 200 body is mistral_unavailable, not permanent', async () => {
  for (const body of ['<html>gateway</html>', '{"model":"m"}', '{"pages":[{"index":"0","markdown":"x"}]}', 'null']) {
    const e = await failure(() => new Response(body, { status: 200 }));
    assertEquals([e.code, e.permanent, e.status], ['mistral_unavailable', false, 200]);
  }
});

Deno.test('callMistralOcr: error messages never carry the API key or the signed URL query string', async () => {
  const echo = JSON.stringify({ message: `could not fetch ${SIGNED}`, detail: `auth ${API_KEY}` });
  const cases: Array<() => Response | Promise<Response>> = [
    () => new Response(echo, { status: 400 }),
    () => new Response(echo, { status: 503 }),
    () => new Response(echo, { status: 429 }),
    () => Promise.reject(new TypeError(`failed ${SIGNED} with ${API_KEY}`)),
  ];
  for (const respond of cases) {
    const e = await failure(respond);
    assert(!e.message.includes(API_KEY), e.message);
    assert(!e.message.includes('SIGNED-SECRET-TOKEN'), e.message);
    assert(!e.message.includes('token='), e.message);
  }
  // Still useful: the object path survives without its query.
  const e = await failure(cases[0]);
  assert(e.message.includes('/storage/v1/object/sign/corpus/files/abc.pdf'), e.message);
});

Deno.test('callMistralOcr refuses to call without a key', async () => {
  const { fetch, calls } = fakeFetch(() => new Response(FIXTURE_TEXT));
  const e = await assertRejects(() => callMistralOcr({ fetch, apiKey: '' }, request()), IngestError);
  assertEquals((e as IngestError).permanent, true);
  assertEquals(calls.length, 0);
});

// ─── Index check, cost, page mapping ─────────────────────────────────────────

Deno.test('checkIndexes accepts exactly the requested indexes', () => {
  checkIndexes([3, 4, 5], [3, 4, 5]);
  checkIndexes([3, 4, 5], [5, 3, 4]);
});

Deno.test('checkIndexes: missing, extra, duplicated or renumbered pages are ocr_page_mismatch', () => {
  for (const returned of [[3, 4], [3, 4, 5, 6], [3, 4, 4, 5], [3, 3, 5], [0, 1, 2], []]) {
    const e = assertThrows(() => checkIndexes([3, 4, 5], returned), IngestError);
    assertEquals((e as IngestError).code, 'ocr_page_mismatch');
  }
});

Deno.test('ocrCostUsd: $4 per 1,000 pages processed', () => {
  assertEquals(OCR_USD_PER_1000_PAGES, 4);
  assertEquals(ocrCostUsd(1000), 4);
  assertEquals(ocrCostUsd(12), 0.048);
  assertEquals(ocrCostUsd(1), 0.004);
  assertEquals(ocrCostUsd(0), 0);
});

Deno.test('mapOcrPage rewrites the part-local index to the global page and keeps the approved fields', () => {
  const src = FIXTURE.pages[2] as MistralOcrPage & Record<string, unknown>;
  const raw = mapOcrPage(src, 40, []);
  assertEquals(raw.index, 42);
  assertEquals(raw.markdown, src.markdown);
  assertEquals(raw.header, src.header ?? null);
  assertEquals(raw.footer, src.footer ?? null);
  assertEquals(raw.dimensions, src.dimensions);
  assertEquals(raw.blocks, src.blocks);
  assertEquals(raw.tables, src.tables);
  assertEquals(raw.images, []);
  assertEquals(Object.keys(raw).sort(), [
    'blocks',
    'dimensions',
    'footer',
    'header',
    'images',
    'index',
    'markdown',
    'tables',
  ]);
});

Deno.test('mapOcrPage fills absent optional fields with null or []', () => {
  assertEquals(mapOcrPage({ index: 0, markdown: 'x' }, 0, []), {
    index: 0,
    markdown: 'x',
    header: null,
    footer: null,
    dimensions: null,
    blocks: [],
    tables: [],
    images: [],
  });
});
