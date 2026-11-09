import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { dirname, fromFileUrl, join, resolve } from 'jsr:@std/path@1';
import { createHash } from 'node:crypto';
import {
  defaultPdfReader,
  lettersAndDigits,
  makePageCheck,
  type PageCheckDeps,
  PDFJS_SPECIFIER,
  robotsAllows,
  USER_AGENT,
} from './page_check.ts';
import type { Rec } from './prepare.ts';
import type { Finding, ScreenContext } from './screen_types.ts';

// Everything here is offline: a fake fetch serves synthetic PDFs, a fake clock stands in for time, and the cache is a
// temporary directory. The fake reader takes `%PDF-fake\n` followed by the JSON list of page texts.
const enc = new TextEncoder();
const REPO = resolve(dirname(fromFileUrl(import.meta.url)), '../..');
const HOST = 'https://docs.example.test';
const OTHER = 'https://other.example.test';
const url = (n: number | string, host = HOST) => `${host}/getFile/BillsTexts/${n}.pdf`;
/** The tests' official hosts (the default rule admits only sansad.in Bills files, tested on its own below). */
const TEST_URLS = /^https:\/\/(docs|other)\.example\.test\/getFile\//;

const fakePdf = (pages: string[]) => enc.encode(`%PDF-fake\n${JSON.stringify(pages)}`);
const fakeReader = (bytes: Uint8Array): Promise<string[]> => {
  const s = new TextDecoder().decode(bytes);
  if (!s.startsWith('%PDF-fake\n')) return Promise.reject(new Error('not a fake PDF'));
  return Promise.resolve(JSON.parse(s.slice(10)));
};

/** A pack record split exactly into pages holding these texts (joined by form feeds, as the pack does). */
function rec(key: string, pages: string[] | null, fileUrl: string | null, extra: Rec = {}): Rec {
  const r: Rec = { source_key: key, ...extra };
  if (fileUrl !== null) r.file_url = fileUrl;
  if (pages !== null) {
    const text = pages.join('\f');
    let at = 0;
    r.text = text;
    r.page_split ??= 'exact';
    r.page_count = pages.length;
    r.pages = pages.map((t, i) => {
      const n = [...t].length;
      const span = { page_number: i + 1, char_from: at, char_to: at + n, text: t };
      at += n + 1;
      return span;
    });
  }
  return r;
}

type Route = (n: number, init: RequestInit) => Response | Promise<Response>;
interface Call {
  url: string;
  t: number;
  init: RequestInit;
}

/** A fake network and clock. Unrouted robots.txt answers 404; any other unrouted URL fails the test. */
function net(routes: Record<string, Route | Uint8Array>, start = 1_000_000) {
  let t = start;
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const counts = new Map<string, number>();
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = String(input instanceof Request ? input.url : input);
    calls.push({ url: u, t, init });
    const n = (counts.get(u) ?? 0) + 1;
    counts.set(u, n);
    const r = routes[u];
    if (r instanceof Uint8Array) return new Response(r as BodyInit, { status: 200 });
    if (r) return await r(n, init);
    if (u.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    throw new Error(`unrouted fetch ${u}`);
  };
  return {
    calls,
    sleeps,
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    fetch: fetch as typeof globalThis.fetch,
    pdfCalls: () => calls.filter((c) => !c.url.endsWith('/robots.txt')),
  };
}

const CTX: ScreenContext = {
  live: {
    documents: () => Promise.reject(new Error('the page check must not read NTER')),
    deskRows: () => Promise.reject(new Error('the page check must not read NTER')),
    identity: () => Promise.reject(new Error('the page check must not read NTER')),
  },
  settings: {},
};

const made: string[] = [];
globalThis.addEventListener('unload', () => {
  for (const d of made) Deno.removeSync(d, { recursive: true });
});
async function tmpCache(): Promise<string> {
  const d = await Deno.makeTempDir({ prefix: 'page-check-test-' });
  made.push(d);
  return d;
}

async function run(
  records: Rec[],
  n: ReturnType<typeof net>,
  over: Partial<PageCheckDeps> = {},
) {
  const cacheDir = over.cacheDir ?? await tmpCache();
  const check = makePageCheck({
    fetch: n.fetch,
    sleep: n.sleep,
    now: n.now,
    cacheDir,
    readPdf: fakeReader,
    commonDir: () => Promise.resolve(null),
    urlRule: TEST_URLS,
    log: () => {},
    ...over,
  });
  const out = await check.all!(records, CTX);
  return { out, check, cacheDir };
}

const reasons = (fs: Finding[] | undefined) => (fs ?? []).map((f) => f.reason);

// ---- the check's shape ----

Deno.test('makePageCheck: a whole-set check named text_per_page covering completeness, needing pages', () => {
  const n = net({});
  const c = makePageCheck({ fetch: n.fetch, sleep: n.sleep, now: n.now, cacheDir: '/nowhere', readPdf: fakeReader });
  assertEquals(c.name, 'text_per_page');
  assertEquals(c.covers, ['completeness']);
  assertEquals(c.needs, 'pages');
  assertEquals(c.onlyIfClean, true, 'runs only on records no earlier check held');
  assertEquals(typeof c.all, 'function');
  assertEquals(c.one, undefined);
});

// ---- comparison rules ----

Deno.test('lettersAndDigits counts Unicode letters, decimal digits and combining marks only', () => {
  assertEquals(lettersAndDigits('Ab 12, -- !! ..'), 4);
  assertEquals(lettersAndDigits('कख १२'), 4, 'Devanagari letters and digits count');
  assertEquals(lettersAndDigits('कि स्त्रीं'), 9, 'vowel signs, virama and anusvara count as marks');
  assertEquals(lettersAndDigits('   \n\t\f.,;()'), 0);
});

Deno.test('a genuine Devanagari page is not held when its PDF text layer carries one glyph per code point', async () => {
  // Legacy Hindi fonts extract one Latin letter per glyph, vowel signs and viramas included, so the PDF page counts
  // every glyph. The pack's Unicode page has fewer letters than marks; counted without marks it looked thin.
  const hindi = 'स्त्रीं '.repeat(10); // 3 letters and 4 marks each: 30 letters, 40 marks
  const glyphs = 'abcdefg '.repeat(10); // 70 letters
  const n = net({ [url(1)]: fakePdf([glyphs]) });
  const { out } = await run([rec('k1', [hindi], url(1))], n);
  assertEquals(out.has('k1'), false, JSON.stringify(out.get('k1')));
});

Deno.test('a PDF whose pages match the pack passes: the key is absent from the map', async () => {
  const pages = ['Bill No. 12 of 2025, page one.', 'Clause 2 on page two.'];
  const n = net({ [url(1)]: fakePdf(pages) });
  const { out } = await run([rec('k1', pages, url(1))], n);
  assertEquals(out.has('k1'), false);
});

Deno.test('page_count_mismatch names both counts and skips the per-page comparison', async () => {
  const n = net({ [url(1)]: fakePdf(['one page', 'two page', 'three page']) });
  const { out } = await run([rec('k1', ['x', 'y'], url(1))], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'page_count_mismatch', detail: 'pdf 3, pack 2' },
  ]);
});

Deno.test('the pack count is page_count when given, so a short pages list is not hidden by it', async () => {
  const n = net({ [url(1)]: fakePdf(['one', 'two']) });
  const r = rec('k1', ['one', 'two'], url(1), {});
  r.page_count = 3;
  const { out } = await run([r], n);
  assertEquals(out.get('k1')?.[0].detail, 'pdf 2, pack 3');
});

Deno.test('thin_page: a pack page with fewer than half the PDF page letters and digits, named by number', async () => {
  const pdf = ['abcdefghij', 'abcdefghij', 'abcdefghij', 'abcdefghij'];
  // page 1: 5 of 10 (half: passes); page 2: 4 of 10 (thin); page 3: punctuation only (thin); page 4 equal.
  const pack = ['abcde', 'abcd', '.... ,,,, ;;;; ----', 'abcdefghij'];
  const n = net({ [url(1)]: fakePdf(pdf) });
  const { out } = await run([rec('k1', pack, url(1))], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'thin_page', detail: 'pages 2, 3' },
  ]);
});

Deno.test('thin_page: a PDF page with no text layer is not compared; the others still are', async () => {
  const n = net({ [url(1)]: fakePdf(['', 'abcdefghij']) });
  const { out } = await run([rec('k1', ['', 'abc'], url(1))], n);
  assertEquals(reasons(out.get('k1')), ['thin_page']);
  assertEquals(out.get('k1')?.[0].detail, 'pages 2');
});

Deno.test('a pack page held only as a span is read from the record text by code points', async () => {
  const pages = ['कखग page one', 'second page text'];
  const r = rec('k1', pages, url(1));
  for (const p of r.pages as Rec[]) delete p.text;
  const n = net({ [url(1)]: fakePdf(pages) });
  const { out } = await run([r], n);
  assertEquals(out.has('k1'), false);
});

const OCR = 'Clause 1 of the Bill as read from the scan.';

Deno.test('a scan whose pack pages hold text passes on its page count, counted as a scan', async () => {
  const n = net({ [url(1)]: fakePdf(['', ' ', '\n']), [url(2)]: fakePdf(['', '']) });
  const { out, check } = await run([rec('k1', [OCR, OCR, OCR], url(1)), rec('k2', ['a', 'b', 'c'], url(2))], n);
  assertEquals(out.has('k1'), false);
  assertEquals(reasons(out.get('k2')), ['page_count_mismatch']);
  assertEquals(check.stats.scans, ['k1']);
});

Deno.test('a scan whose pack pages are empty is held unverified_empty_pages, not passed as a scan', async () => {
  const n = net({ [url(1)]: fakePdf(['', '', '']) });
  const { out, check } = await run([rec('k1', ['', 'short', OCR], url(1))], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'unverified_empty_pages', detail: '2 of 3 pages' },
  ]);
  assertEquals(check.stats.scans, []);
  assertEquals(check.stats.unverifiedPages, 2);
});

Deno.test('unverified_empty_pages: at least 2 such pages and at least 10% of the pages', async () => {
  const pdf = (pages: number, scanned: number[]) =>
    fakePdf(Array.from({ length: pages }, (_, i) => scanned.includes(i + 1) ? '' : OCR));
  const pack = (pages: number, empty: number[]) =>
    Array.from({ length: pages }, (_, i) => empty.includes(i + 1) ? 'p. 3' : OCR);
  const n = net({
    [url(1)]: pdf(20, [4, 9]), // 2 of 20: held
    [url(2)]: pdf(30, [4, 9]), // 2 of 30, under 10%: passes
    [url(3)]: pdf(20, [4]), // 1 of 20: passes
    [url(4)]: pdf(20, [4, 9, 12]), // three scanned pages, but the pack holds text on two of them: passes
    [url(5)]: pdf(40, [1, 2, 3, 4]), // 4 of 40: held
    [url(6)]: pdf(5, [2]), // 1 of 5: a fifth of the pages, but one page only: passes
  });
  const { out, check } = await run([
    rec('k1', pack(20, [4, 9]), url(1)),
    rec('k2', pack(30, [4, 9]), url(2)),
    rec('k3', pack(20, [4]), url(3)),
    rec('k4', pack(20, [4]), url(4)),
    rec('k5', pack(40, [1, 2, 3, 4]), url(5)),
    rec('k6', pack(5, [2]), url(6)),
  ], n);
  assertEquals(out.get('k1')?.map((f) => [f.reason, f.detail]), [['unverified_empty_pages', '2 of 20 pages']]);
  assertEquals(out.has('k2'), false);
  assertEquals(out.has('k3'), false);
  assertEquals(out.has('k4'), false);
  assertEquals(out.get('k5')?.map((f) => [f.reason, f.detail]), [['unverified_empty_pages', '4 of 40 pages']]);
  assertEquals(out.has('k6'), false);
  assertEquals(check.stats.unverifiedPages, 2 + 2 + 1 + 1 + 4 + 1, 'every unverified page is counted, held or not');
  assertEquals(check.stats.unverifiedRecords, 2);
});

Deno.test('a record without file_url or pages is held by name, never passed, and nothing is fetched', async () => {
  const n = net({});
  const noUrl = rec('k1', ['a'], null);
  const noPages = rec('k2', null, url(2));
  const neither = rec('k3', null, null);
  const emptyPages = { ...rec('k4', ['a'], url(4)), pages: [], text: undefined };
  const badUrl = rec('k5', ['a'], 7 as unknown as string);
  const noSpanText = rec('k6', ['abc'], url(6));
  (noSpanText.pages as Rec[])[0] = { page_number: 1, char_from: 0, char_to: 3 };
  delete noSpanText.text;
  const { out } = await run([noUrl, noPages, neither, emptyPages, badUrl, noSpanText], n);
  assertEquals(reasons(out.get('k1')), ['no_pdf_url']);
  assertEquals(reasons(out.get('k2')), ['no_pages']);
  assertEquals(reasons(out.get('k3')), ['no_pdf_url', 'no_pages']);
  assertEquals(reasons(out.get('k4')), ['no_pages']);
  assertEquals(reasons(out.get('k5')), ['no_pdf_url']);
  assertEquals(reasons(out.get('k6')), ['no_pages']);
  assertEquals(n.calls.length, 0);
});

Deno.test('a body that is not a PDF is refused as pdf_unreadable and is not cached', async () => {
  const n = net({ [url(1)]: enc.encode('<html>please log in</html>') });
  const { out, cacheDir } = await run([rec('k1', ['a'], url(1))], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'pdf_unreadable', detail: 'not a PDF' },
  ]);
  assertEquals([...Deno.readDirSync(cacheDir)].length, 0);
});

Deno.test('a PDF the reader cannot open is pdf_unreadable, named by the error class only', async () => {
  const n = net({ [url(1)]: enc.encode('%PDF-1.7 damaged'), [url(2)]: fakePdf(['a']) });
  const crash = (b: Uint8Array) =>
    new TextDecoder().decode(b).startsWith('%PDF-1.7') ? Promise.reject(new TypeError('x of y')) : fakeReader(b);
  const { out } = await run([rec('k1', ['a'], url(1)), rec('k2', ['a'], url(2))], n, { readPdf: crash });
  assertEquals(out.get('k1'), [
    {
      check: 'text_per_page',
      covers: ['completeness'],
      reason: 'pdf_unreadable',
      detail: 'the PDF reader failed (TypeError)',
    },
  ]);
  assertEquals(out.has('k2'), false, 'the run goes on');
});

Deno.test('a reader that does not finish in time is pdf_unreadable, and the run goes on', async () => {
  const n = net({ [url(1)]: fakePdf(['a']), [url(2)]: fakePdf(['b']) });
  let aborted = false;
  const slow = (b: Uint8Array, signal?: AbortSignal) =>
    JSON.parse(new TextDecoder().decode(b).slice(10))[0] === 'a'
      ? new Promise<string[]>((_, reject) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('stopped'));
        });
      })
      : fakeReader(b);
  const { out } = await run([rec('k1', ['a'], url(1)), rec('k2', ['b'], url(2))], n, {
    readPdf: slow,
    readTimeoutMs: 5,
  });
  assertEquals(out.get('k1')?.map((f) => [f.reason, f.detail]), [['pdf_unreadable', 'the PDF reader timed out']]);
  assertEquals(out.has('k2'), false);
  assert(aborted, 'the reader is told to stop');
});

Deno.test('an unexpected error on one record (a cache it cannot use, a fetch that throws) holds that record only', async () => {
  const cacheDir = await tmpCache();
  await Deno.mkdir(join(cacheDir, `${sha(url(1))}.pdf`)); // the cache entry is a directory: reading it fails
  const n = net({
    [url(1)]: fakePdf(['a']),
    [url(2)]: () => Promise.reject(new RangeError('boom')),
    [url(3)]: fakePdf(['c']),
  });
  const { out } = await run([rec('k1', ['a'], url(1)), rec('k2', ['b'], url(2)), rec('k3', ['c'], url(3))], n, {
    cacheDir,
  });
  assertEquals(out.get('k1')?.map((f) => f.reason), ['pdf_unavailable']);
  assert(/^error: [A-Za-z]+$/.test(String(out.get('k1')?.[0].detail)), out.get('k1')?.[0].detail);
  assertEquals(out.get('k2')?.map((f) => [f.reason, f.detail]), [['pdf_unavailable', 'error: RangeError']]);
  assertEquals(out.has('k3'), false, 'the run goes on');
});

Deno.test('findings never carry record text or PDF text', async () => {
  const SECRET = 'ZZSECRETRECORDTEXTZZ'; // a word the reader errors would never name
  const n = net({
    [url(1)]: fakePdf([`${SECRET} one two three four five`, 'b']),
    [url(2)]: fakePdf([`${SECRET} abcdefghijklmnop`]),
    [url(3)]: enc.encode(`<html>${SECRET}</html>`),
    [url(4)]: enc.encode(`%PDF-1.7 ${SECRET}`),
  });
  const { out } = await run([
    rec('k1', [SECRET], url(1)),
    rec('k2', [SECRET.slice(0, 3)], url(2)),
    rec('k3', [SECRET], url(3)),
    rec('k4', [SECRET], url(4)),
  ], n);
  assertEquals(out.size, 4);
  const all = JSON.stringify([...out.values()]);
  assert(!all.includes('ZZSECRET') && !all.includes('html') && !all.includes('example.test'), all);
});

// ---- robots.txt ----

Deno.test('robotsAllows: the * group, longest match wins, Allow on a tie, wildcards and $', () => {
  const txt = [
    '# comment',
    'User-agent: SomeBot',
    'Disallow: /',
    '',
    'User-agent: *',
    'Disallow: /getFile/ # private',
    'Allow: /getFile/BillsTexts/',
    'Disallow: /*.zip$',
    'Disallow:',
  ].join('\n');
  assertEquals(robotsAllows(txt, '/getFile/BillsTexts/1.pdf'), true);
  assertEquals(robotsAllows(txt, '/getFile/Other/1.pdf'), false);
  assertEquals(robotsAllows(txt, '/a/b.zip'), false);
  assertEquals(robotsAllows(txt, '/a/b.zip?x=1'), true, '$ anchors the end');
  assertEquals(robotsAllows(txt, '/index.html'), true);
  assertEquals(robotsAllows('User-agent: *\nDisallow: /x\nAllow: /x', '/x/1'), true, 'Allow wins a tie');
  assertEquals(robotsAllows('User-agent: SomeBot\nDisallow: /', '/x'), true, 'another agent group does not bind');
  assertEquals(
    robotsAllows('User-agent: a\nUser-agent: *\nDisallow: /p', '/p/1'),
    false,
    'a group may name several agents',
  );
  assertEquals(robotsAllows('', '/x'), true);
});

Deno.test('a PDF disallowed by robots.txt is never requested: pdf_unavailable', async () => {
  const n = net({
    [`${HOST}/robots.txt`]: () => new Response('User-agent: *\nDisallow: /getFile/\n'),
    [url(1)]: fakePdf(['a']),
  });
  const { out } = await run([rec('k1', ['a'], url(1))], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'pdf_unavailable', detail: 'disallowed by robots.txt' },
  ]);
  assertEquals(n.pdfCalls().length, 0);
});

Deno.test('robots.txt is fetched once per host and a 4xx allows everything (RFC 9309)', async () => {
  const n = net({
    [`${HOST}/robots.txt`]: () => new Response('gone', { status: 410 }),
    [url(1)]: fakePdf(['a']),
    [url(2)]: fakePdf(['b']),
    [url(3, OTHER)]: fakePdf(['c']),
  });
  const { out } = await run([rec('k1', ['a'], url(1)), rec('k2', ['b'], url(2)), rec('k3', ['c'], url(3, OTHER))], n);
  assertEquals(out.size, 0);
  assertEquals(n.calls.filter((c) => c.url === `${HOST}/robots.txt`).length, 1);
  assertEquals(n.calls.filter((c) => c.url === `${OTHER}/robots.txt`).length, 1);
});

Deno.test('robots.txt answering 5xx after every retry stops that host: no PDF request, pdf_unavailable', async () => {
  const n = net({
    [`${HOST}/robots.txt`]: () => new Response('down', { status: 503 }),
    [url(1)]: fakePdf(['a']),
    [url(2)]: fakePdf(['b']),
  });
  const { out } = await run([rec('k1', ['a'], url(1)), rec('k2', ['b'], url(2))], n);
  assertEquals(reasons(out.get('k1')), ['pdf_unavailable']);
  assertEquals(out.get('k1')?.[0].detail, 'robots.txt unavailable: HTTP 503 after 4 attempts');
  assertEquals(reasons(out.get('k2')), ['pdf_unavailable']);
  assertEquals(n.pdfCalls().length, 0);
  assertEquals(n.calls.length, 8, 'robots.txt tried four times, and four more at the end, once for the host');
});

// ---- requests: User-Agent, retries, timeouts, short bodies, redirects ----

Deno.test('every request carries the fixed project User-Agent and asks not to follow redirects blindly', async () => {
  const n = net({ [url(1)]: fakePdf(['a']) });
  await run([rec('k1', ['a'], url(1))], n);
  assertEquals(n.calls.length, 2);
  for (const c of n.calls) {
    assertEquals(new Headers(c.init.headers).get('user-agent'), USER_AGENT);
    assertEquals(c.init.redirect, 'manual');
  }
  assert(/Niyantran/.test(USER_AGENT) && !/@/.test(USER_AGENT), USER_AGENT);
});

Deno.test('a 404 is final: one request, pdf_unavailable', async () => {
  const n = net({ [url(1)]: () => new Response('no', { status: 404 }) });
  const { out } = await run([rec('k1', ['a'], url(1))], n);
  assertEquals(out.get('k1')?.[0], {
    check: 'text_per_page',
    covers: ['completeness'],
    reason: 'pdf_unavailable',
    detail: 'HTTP 404',
  });
  assertEquals(n.pdfCalls().length, 1);
});

Deno.test('a 500 is retried with growing waits, then pdf_unavailable', async () => {
  const n = net({ [url(1)]: () => new Response('err', { status: 500 }) });
  const { out } = await run([rec('k1', ['a'], url(1))], n);
  assertEquals(out.get('k1')?.[0].detail, 'HTTP 500 after 4 attempts');
  assertEquals(n.pdfCalls().length, 4);
  // Waits of 500, 1000 and 2000 ms before the retries; the first two are lifted to the one-second spacing.
  const t = n.pdfCalls().map((c) => c.t);
  assertEquals([t[1] - t[0], t[2] - t[1], t[3] - t[2]], [1000, 1000, 2000]);
  assert(n.sleeps.includes(500) && n.sleeps.includes(2000), String(n.sleeps));
});

Deno.test('a 503 then a PDF passes on the retry', async () => {
  const n = net({ [url(1)]: (k) => k === 1 ? new Response('busy', { status: 503 }) : new Response(fakePdf(['a'])) });
  const { out } = await run([rec('k1', ['a'], url(1))], n);
  assertEquals(out.size, 0);
  assertEquals(n.pdfCalls().length, 2);
});

Deno.test('a network error is retried, then pdf_unavailable', async () => {
  const n = net({ [url(1)]: () => Promise.reject(new TypeError('connection reset')) });
  const { out } = await run([rec('k1', ['a'], url(1))], n);
  assertEquals(out.get('k1')?.[0].detail, 'network error after 4 attempts');
  assertEquals(n.pdfCalls().length, 4);
});

Deno.test('an attempt that outlives the timeout is aborted and retried, then pdf_unavailable', async () => {
  const hang = (_: number, init: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const n = net({ [url(1)]: hang });
  const { out } = await run([rec('k1', ['a'], url(1))], n, { timeoutMs: 5 });
  assertEquals(out.get('k1')?.[0].detail, 'timeout after 4 attempts');
  assertEquals(n.pdfCalls().length, 4);
});

Deno.test('a body shorter than its Content-Length is retried; a whole one then passes', async () => {
  const good = fakePdf(['abc']);
  const n = net({
    [url(1)]: (k) =>
      k === 1
        ? new Response(good.slice(0, 8), { headers: { 'content-length': String(good.length) } })
        : new Response(good),
  });
  const { out } = await run([rec('k1', ['abc'], url(1))], n);
  assertEquals(out.size, 0);
  assertEquals(n.pdfCalls().length, 2);
});

Deno.test('a body that fails while being read is retried', async () => {
  const good = fakePdf(['abc']);
  const broken = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(good.slice(0, 6));
          c.error(new Error('reset'));
        },
      }),
    );
  const n = net({ [url(1)]: (k) => k < 3 ? broken() : new Response(good) });
  const { out } = await run([rec('k1', ['abc'], url(1))], n);
  assertEquals(out.size, 0);
  assertEquals(n.pdfCalls().length, 3);
});

Deno.test('a PDF larger than the limit is refused', async () => {
  const n = net({ [url(1)]: fakePdf(['a'.repeat(100)]) });
  const { out } = await run([rec('k1', ['a'], url(1))], n, { maxBytes: 50 });
  assertEquals(out.get('k1')?.[0].reason, 'pdf_unavailable');
  assertEquals(out.get('k1')?.[0].detail, 'larger than 50 bytes');
});

Deno.test('redirects are followed by hand, only to https on the same host, each hop checked against robots.txt', async () => {
  const moved = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
  const n = net({
    [`${HOST}/robots.txt`]: () => new Response('User-agent: *\nDisallow: /private/\n'),
    [url(1)]: moved('/getFile/BillsTexts/1-new.pdf'),
    [`${HOST}/getFile/BillsTexts/1-new.pdf`]: fakePdf(['a']),
    [url(2)]: moved(url(2, OTHER)),
    [url(2, OTHER)]: fakePdf(['b']),
    [url(3)]: moved('ftp://files.example.test/3.pdf'),
    [url(4)]: moved(url(4)),
    [url(5)]: moved(url(5).replace('https:', 'http:')),
    [url(6)]: moved('/private/6.pdf'),
  });
  const { out } = await run([
    rec('k1', ['a'], url(1)),
    rec('k2', ['b'], url(2)),
    rec('k3', ['c'], url(3)),
    rec('k4', ['d'], url(4)),
    rec('k5', ['e'], url(5)),
    rec('k6', ['f'], url(6)),
  ], n);
  assertEquals(out.has('k1'), false);
  assertEquals(out.get('k2')?.[0].detail, 'redirected off https on the same host');
  assertEquals(n.calls.some((c) => c.url.startsWith(OTHER)), false, 'another host is never asked');
  assertEquals(out.get('k3')?.[0].detail, 'redirected off https on the same host');
  assertEquals(out.get('k4')?.[0].detail, 'too many redirects');
  assertEquals(out.get('k5')?.[0].detail, 'redirected off https on the same host');
  assertEquals(out.get('k6')?.[0].detail, 'disallowed by robots.txt');
  assertEquals(n.calls.some((c) => c.url.includes('/private/')), false);
});

Deno.test('the default URL rule fetches only sansad.in Bills files; anything else is never fetched', async () => {
  const ok = 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/12.pdf?source=legislation';
  const ok2 = 'https://sansad.in/getFile/BillsPDFFiles/RS/34.pdf';
  const bad = [
    'https://sansad.in/getFile/loksabhaquestions/annex/1.pdf',
    'http://sansad.in/getFile/BillsTexts/1.pdf',
    'https://sansad.in/getFile/BillsTexts/../loksabhaquestions/1.pdf',
    'https://sansad.in/getFile/BillsTexts/x/../1.pdf', // still under BillsTexts once resolved, but holds ..
    'HTTPS://SANSAD.IN/getFile/BillsTexts/1.pdf', // matches only once parsed; admission tests the string as given
    'https://sansad.in/getFile/BillsTexts/%2e%2e/loksabhaquestions/1.pdf', // matches only as given
    'https://sansad.in.example.test/getFile/BillsTexts/1.pdf',
    url(9),
    'not a url',
  ];
  const n = net({ [ok]: fakePdf(['a']), [ok2]: fakePdf(['b']) });
  const records = [rec('ok', ['a'], ok), rec('ok2', ['b'], ok2), ...bad.map((u, i) => rec(`bad${i}`, ['a'], u))];
  const { out } = await run(records, n, { urlRule: undefined });
  assertEquals(out.has('ok'), false);
  assertEquals(out.has('ok2'), false);
  for (let i = 0; i < bad.length; i++) {
    assertEquals(out.get(`bad${i}`), [
      { check: 'text_per_page', covers: ['completeness'], reason: 'pdf_unavailable', detail: 'not an official url' },
    ]);
  }
  assertEquals(n.pdfCalls().map((c) => c.url), [ok, ok2]);
});

// ---- rate limit ----

Deno.test('at most one request per second per host, robots.txt and retries included (fake clock)', async () => {
  const n = net({
    [url(1)]: (k) => k === 1 ? new Response('busy', { status: 503 }) : new Response(fakePdf(['a'])),
    [url(2)]: fakePdf(['b']),
    [url(3, OTHER)]: fakePdf(['c']),
    [url(4)]: fakePdf(['d']),
  });
  await run([
    rec('k1', ['a'], url(1)),
    rec('k2', ['b'], url(2)),
    rec('k3', ['c'], url(3, OTHER)),
    rec('k4', ['d'], url(4)),
  ], n);
  for (const host of [HOST, OTHER]) {
    const times = n.calls.filter((c) => c.url.startsWith(host)).map((c) => c.t);
    for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] >= 1000, `${host}: ${times}`);
  }
  assertEquals(n.calls.filter((c) => c.url.startsWith(HOST)).length, 5);
  const firstOther = n.calls.find((c) => c.url.startsWith(OTHER))!;
  const prevHost = n.calls[n.calls.indexOf(firstOther) - 1];
  assertEquals(firstOther.t, prevHost.t, 'a different host does not wait for the first');
});

// ---- the cache ----

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

Deno.test('each PDF is cached by the sha256 of its URL and reused: a second run makes no request at all', async () => {
  const cacheDir = await tmpCache();
  const first = net({ [url(1)]: fakePdf(['a']) });
  const r1 = await run([rec('k1', ['a'], url(1))], first, { cacheDir });
  assertEquals(r1.check.stats.fetched, 1);
  const pdfs = [...Deno.readDirSync(cacheDir)].map((e) => e.name).filter((f) => f.endsWith('.pdf'));
  assertEquals(pdfs, [`${sha(url(1))}.pdf`]);
  assertEquals(await Deno.readFile(join(cacheDir, `${sha(url(1))}.pdf`)), fakePdf(['a']));
  const second = net({});
  const r2 = await run([rec('k1', ['a'], url(1)), rec('k1b', ['a'], url(1))], second, { cacheDir });
  assertEquals(r2.out.size, 0);
  assertEquals(second.calls.length, 0);
  assertEquals(r2.check.stats, { fetched: 0, cached: 2, scans: [], unverifiedPages: 0, unverifiedRecords: 0 });
});

Deno.test('a cached file that is not a PDF is fetched again and replaced', async () => {
  const cacheDir = await tmpCache();
  await Deno.writeFile(join(cacheDir, `${sha(url(1))}.pdf`), enc.encode('junk'));
  const n = net({ [url(1)]: fakePdf(['a']) });
  const { out } = await run([rec('k1', ['a'], url(1))], n, { cacheDir });
  assertEquals(out.size, 0);
  assertEquals(n.pdfCalls().length, 1);
  assertEquals(await Deno.readFile(join(cacheDir, `${sha(url(1))}.pdf`)), fakePdf(['a']));
});

Deno.test('a failed fetch leaves nothing in the cache, not even a partial file', async () => {
  const n = net({ [url(1)]: () => new Response('err', { status: 500 }), [url(2)]: enc.encode('<html>') });
  const { cacheDir } = await run([rec('k1', ['a'], url(1)), rec('k2', ['a'], url(2))], n);
  assertEquals([...Deno.readDirSync(cacheDir)], []);
});

Deno.test('the cache directory is refused inside this checkout, the main checkout, or under any .git', async () => {
  const n = net({ [url(1)]: fakePdf(['a']) });
  const records = [rec('k1', ['a'], url(1))];
  const inRepo = join(REPO, 'tmp-page-check-cache-test');
  assertEquals(await Deno.lstat(inRepo).then(() => true, () => false), false, `${inRepo} must not exist before`);
  try {
    await assertRejects(() => run(records, n, { cacheDir: inRepo }), Error, 'outside the repository');
  } finally {
    // Only a broken guard creates it; remove it so a failing run leaves the checkout clean.
    await Deno.remove(inRepo, { recursive: true }).catch(() => {});
  }
  const other = await tmpCache();
  await Deno.mkdir(join(other, '.git'));
  await assertRejects(() => run(records, n, { cacheDir: join(other, 'a', 'b') }), Error, 'holds a .git entry');
  const main = await tmpCache();
  await assertRejects(
    () => run(records, n, { cacheDir: join(main, 'cache'), commonDir: () => Promise.resolve(join(main, '.git')) }),
    Error,
    'inside a checkout',
  );
  const linked = join(await tmpCache(), 'link');
  await Deno.symlink(REPO, linked);
  await assertRejects(() => run(records, n, { cacheDir: join(linked, 'x') }), Error, 'outside the repository');
  assertEquals(n.calls.length, 0, 'refused before any request');
});

Deno.test("the cache guard is pack.ts's refuseInCheckout, not a copy of it", async () => {
  const src = await Deno.readTextFile(join(REPO, 'scripts/bulk-runner/page_check.ts'));
  assert(!/function\s+refuseInCheckout/.test(src), 'page_check.ts defines its own refuseInCheckout');
  assert(
    /import[^;]*refuseInCheckout[^;]*from\s+'\.\/pack\.ts'/.test(src),
    'page_check.ts must import it from pack.ts',
  );
});

Deno.test('the default cache is ~/niyantran-pdf-cache under the given home', async () => {
  const home = await tmpCache();
  const n = net({ [url(1)]: fakePdf(['a']) });
  const check = makePageCheck({
    fetch: n.fetch,
    sleep: n.sleep,
    now: n.now,
    home,
    readPdf: fakeReader,
    commonDir: () => Promise.resolve(null),
    urlRule: TEST_URLS,
  });
  await check.all!([rec('k1', ['a'], url(1))], CTX);
  const names = [...Deno.readDirSync(join(home, 'niyantran-pdf-cache'))].map((e) => e.name);
  assertEquals(names.filter((f) => f.endsWith('.pdf')).length, 1);
});

// ---- the real reader: one test, on PDFs generated here ----

/** A minimal PDF: a page per entry, a line of Helvetica text, or (null) only a 1x1 image, so no text layer. */
function makePdf(pages: (string | null)[]): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\n' +
    'stream\n\x80\nendstream',
  ];
  pages.forEach((t, i) => {
    const content = t === null ? 'q 100 0 0 100 72 600 cm /Im1 Do Q' : `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ` +
        `/XObject << /Im1 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`,
    );
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

/** Whether pdfjs-dist 4.10.38 is in Deno's local npm cache, so the real-reader test runs without the network. */
async function pdfjsCached(): Promise<boolean> {
  try {
    const out = await new Deno.Command(Deno.execPath(), { args: ['info', '--json'], stdout: 'piped', stderr: 'null' })
      .output();
    const npmCache = JSON.parse(new TextDecoder().decode(out.stdout)).npmCache;
    return typeof npmCache === 'string' &&
      (await Deno.stat(join(npmCache, 'registry.npmjs.org', 'pdfjs-dist', '4.10.38')).then(() => true, () => false));
  } catch {
    return false;
  }
}
const PDFJS_CACHED = await pdfjsCached();
if (!PDFJS_CACHED) {
  console.log(`page_check_test: SKIPPING the real pdfjs reader test: ${PDFJS_SPECIFIER} is not in the local cache`);
}

Deno.test({
  name: 'the real pdfjs reader: page texts of a generated PDF, and a scan read as pages without text',
  ignore: !PDFJS_CACHED,
  async fn() {
    assertEquals(await defaultPdfReader(makePdf(['Bill No 12 of 2025', null, 'Clause 3'])), [
      'Bill No 12 of 2025',
      '',
      'Clause 3',
    ]);
    assertEquals(await defaultPdfReader(makePdf([null, null])), ['', '']);
    await assertRejects(() => defaultPdfReader(enc.encode('%PDF-1.4\nnothing else')));
    // And through the check, end to end with the fake network.
    const n = net({ [url(1)]: makePdf(['Bill No 12 of 2025', 'Clause 3']), [url(2)]: makePdf([null, null]) });
    const { out, check } = await run(
      [rec('k1', ['Bill No 12 of 2025', 'Cl'], url(1)), rec('k2', [OCR, OCR], url(2))],
      n,
      { readPdf: defaultPdfReader },
    );
    assertEquals(out.get('k1')?.[0].detail, 'pages 2');
    assertEquals(out.has('k2'), false);
    assertEquals(check.stats.scans, ['k2']);
  },
});

// ---- records not split exactly into pages: page count, then the whole document ----

/** A record whose whole text is one span over every page (page_split 'none'), as an unsplit pack record is. */
function unsplit(key: string, text: string, pageCount: number | null, fileUrl: string): Rec {
  const r: Rec = {
    source_key: key,
    file_url: fileUrl,
    text,
    page_split: 'none',
    pages: [{ page_number: 1, char_from: 0, char_to: [...text].length, text }],
  };
  if (pageCount !== null) r.page_count = pageCount;
  return r;
}

const PDF3 = ['abcdefghij', 'klmnopqrst', 'uvwxyz0123']; // 30 letters and digits

Deno.test('an unsplit record (one span over several pages) passes when its whole text is full', async () => {
  const n = net({ [url(1)]: fakePdf(PDF3) });
  const { out } = await run([unsplit('k1', PDF3.join(' '), 3, url(1))], n);
  assertEquals(out.has('k1'), false);
});

Deno.test('an unsplit record holding fewer than half the letters and digits of all PDF pages is thin_text', async () => {
  const n = net({ [url(1)]: fakePdf(PDF3), [url(2)]: fakePdf(PDF3) });
  const { out } = await run([
    unsplit('k1', 'abcdefghij klmn ,,,, ....', 3, url(1)), // 14 of 30: thin
    unsplit('k2', 'abcdefghij klmno', 3, url(2)), // 15 of 30: half, passes
  ], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'thin_text', detail: 'pack 14, pdf 30' },
  ]);
  assertEquals(out.has('k2'), false);
});

Deno.test('an unsplit record still has its page count compared when it gives one; without one, only the text', async () => {
  const n = net({ [url(1)]: fakePdf(PDF3), [url(2)]: fakePdf(PDF3), [url(3)]: fakePdf(PDF3) });
  const { out } = await run([
    unsplit('k1', PDF3.join(' '), 2, url(1)),
    unsplit('k2', PDF3.join(' '), null, url(2)),
    unsplit('k3', 'abc', null, url(3)),
  ], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'page_count_mismatch', detail: 'pdf 3, pack 2' },
  ]);
  assertEquals(out.has('k2'), false);
  assertEquals(out.get('k3')?.[0].detail, 'pack 3, pdf 30');
});

Deno.test('a record with text but no pages, or pages not split exactly, is compared as a whole document', async () => {
  const n = net({ [url(1)]: fakePdf(PDF3), [url(2)]: fakePdf(PDF3), [url(3)]: fakePdf(PDF3) });
  const noPages = { ...unsplit('k1', 'abc', 3, url(1)), pages: undefined, page_split: 'exact' };
  const noSplit = rec('k2', ['abcdefghij', 'klmnopqrst', 'uvw'], url(2), { page_split: undefined });
  delete noSplit.page_split;
  const full = rec('k3', ['abcdefghij', 'klmnopqrst', 'uvwxyz0123'], url(3), { page_split: 'none' });
  const { out } = await run([noPages, noSplit, full], n);
  assertEquals(reasons(out.get('k1')), ['thin_text']);
  assertEquals(out.has('k2'), false, '23 of 30 in all: page 3 alone would be thin, the whole is not');
  assertEquals(out.has('k3'), false);
});

Deno.test('an exact record is still compared page by page, not as a whole', async () => {
  const n = net({ [url(1)]: fakePdf(PDF3) });
  const { out } = await run([rec('k1', ['abcdefghij', 'klmnopqrst', 'uvw'], url(1))], n);
  assertEquals(out.get('k1'), [
    { check: 'text_per_page', covers: ['completeness'], reason: 'thin_page', detail: 'pages 3' },
  ]);
});

Deno.test('an unsplit scan passes when each span holds text, and is held when its spans are empty', async () => {
  const n = net({ [url(1)]: fakePdf(['', '']), [url(2)]: fakePdf(['', '']) });
  const full = unsplit('k1', `${OCR}\f${OCR}`, 2, url(1));
  full.pages = [
    { page_number: 1, char_from: 0, char_to: OCR.length, text: OCR },
    { page_number: 2, char_from: OCR.length + 1, char_to: 2 * OCR.length + 1, text: OCR },
  ];
  const { out, check } = await run([full, unsplit('k2', 'short', 2, url(2))], n);
  assertEquals(out.has('k1'), false);
  assertEquals(check.stats.scans, ['k1']);
  assertEquals(reasons(out.get('k2')), ['unverified_empty_pages']);
});

Deno.test('thin_text carries counts only, never text', async () => {
  const SECRET = 'ZZSECRETWHOLETEXTZZ';
  const n = net({ [url(1)]: fakePdf([`${SECRET} ${'q'.repeat(200)}`]) });
  const { out } = await run([unsplit('k1', SECRET, 1, url(1))], n);
  assertEquals(reasons(out.get('k1')), ['thin_text']);
  assert(!JSON.stringify(out.get('k1')).includes('ZZSECRET'));
});

Deno.test('a rule that admits http still fetches https only', async () => {
  const n = net({});
  const http = url(1).replace('https:', 'http:');
  const { out } = await run([rec('k1', ['a'], http)], n, { urlRule: /^https?:\/\/docs\.example\.test\// });
  assertEquals(out.get('k1')?.map((f) => [f.reason, f.detail]), [['pdf_unavailable', 'not an official url']]);
  assertEquals(n.calls.length, 0);
});

Deno.test('page counts that cannot be cached hold that record only', async () => {
  const cacheDir = await tmpCache();
  const pdf = fakePdf(['a']);
  await Deno.mkdir(join(cacheDir, `${createHash('sha256').update(pdf).digest('hex')}.pages.json`));
  const n = net({ [url(1)]: pdf, [url(2)]: fakePdf(['b']) });
  const { out } = await run([rec('k1', ['a'], url(1)), rec('k2', ['b'], url(2))], n, { cacheDir });
  assertEquals(out.get('k1')?.map((f) => f.reason), ['pdf_unreadable']);
  assert(/^error: [A-Za-z]+$/.test(String(out.get('k1')?.[0].detail)), out.get('k1')?.[0].detail);
  assertEquals(out.has('k2'), false);
});

// ---- a long run: robots.txt tried again later, page counts cached, progress logged ----

Deno.test('a robots.txt that failed is tried once more after 10 minutes of other work, and its records then judged', async () => {
  const tenMinutes = 10 * 60 * 1000;
  let robotsUp = false;
  const n = net({
    [`${HOST}/robots.txt`]: () =>
      robotsUp ? new Response('User-agent: *\nAllow: /\n') : new Response('', { status: 503 }),
    [url(1)]: fakePdf(['a']),
    [url(2)]: fakePdf(['b']),
    [url(3, OTHER)]: fakePdf(['c']),
    [url(4, OTHER)]: fakePdf(['d']),
    [url(5, OTHER)]: fakePdf(['e']),
  });
  // Each record on the other host takes six minutes of the fake clock; the host comes back meanwhile.
  const reader = async (b: Uint8Array) => {
    await n.sleep(tenMinutes * 0.6);
    robotsUp = true;
    return await fakeReader(b);
  };
  const { out } = await run(
    [
      rec('k1', ['a'], url(1)),
      rec('k2', ['b'], url(2)),
      rec('k3', ['c'], url(3, OTHER)),
      rec('k4', ['d'], url(4, OTHER)),
      rec('k5', ['e'], url(5, OTHER)),
    ],
    n,
    { readPdf: reader },
  );
  assertEquals(out.size, 0, JSON.stringify([...out]));
  const order = n.calls.map((c) => c.url);
  const robotsCalls = order.filter((u) => u === `${HOST}/robots.txt`);
  assertEquals(robotsCalls.length, 5, 'four attempts, then one more ten minutes later');
  assert(order.indexOf(url(1)) < order.indexOf(url(5, OTHER)), 'judged as soon as ten minutes passed, not at the end');
  assert(order.indexOf(url(1)) > order.indexOf(url(4, OTHER)), 'not before ten minutes of other work');
});

Deno.test('a robots.txt that failed is tried once more at the end; still failing, its records are pdf_unavailable', async () => {
  const n = net({
    [`${HOST}/robots.txt`]: () => new Response('', { status: 503 }),
    [url(1)]: fakePdf(['a']),
    [url(3, OTHER)]: fakePdf(['c']),
  });
  const { out } = await run([rec('k1', ['a'], url(1)), rec('k3', ['c'], url(3, OTHER))], n);
  assertEquals(out.get('k1')?.map((f) => [f.reason, f.detail]), [
    ['pdf_unavailable', 'robots.txt unavailable: HTTP 503 after 4 attempts'],
  ]);
  assertEquals(out.has('k3'), false);
  assertEquals(n.calls.filter((c) => c.url === `${HOST}/robots.txt`).length, 8, 'two rounds of four');
  assertEquals(n.pdfCalls().map((c) => c.url), [url(3, OTHER)]);
});

Deno.test('page counts are cached by PDF sha256 next to the PDF: a rerun does not parse again', async () => {
  const cacheDir = await tmpCache();
  let reads = 0;
  const counting = (b: Uint8Array) => {
    reads++;
    return fakeReader(b);
  };
  const pdf = fakePdf([OCR, OCR]);
  await run([rec('k1', [OCR, OCR], url(1))], net({ [url(1)]: pdf }), { cacheDir, readPdf: counting });
  assertEquals(reads, 1);
  const pdfSha = createHash('sha256').update(pdf).digest('hex');
  const counts = JSON.parse(await Deno.readTextFile(join(cacheDir, `${pdfSha}.pages.json`)));
  assertEquals(counts.pdf_sha256, pdfSha);
  assertEquals(counts.counts, [lettersAndDigits(OCR), lettersAndDigits(OCR)]);
  assertEquals(counts.text_layer, [true, true]);
  assert(!JSON.stringify(counts).includes('Clause'), 'counts only, no text');

  const again = await run([rec('k1', [OCR, OCR], url(1))], net({}), { cacheDir, readPdf: counting });
  assertEquals(reads, 1, 'served from the counts cache');
  assertEquals(again.out.size, 0);
});

Deno.test('cached page counts are not used when the PDF changed, or the file is damaged or of another rule', async () => {
  const cacheDir = await tmpCache();
  let reads = 0;
  const counting = (b: Uint8Array) => {
    reads++;
    return fakeReader(b);
  };
  const first = fakePdf([OCR, OCR]);
  await run([rec('k1', [OCR, OCR], url(1))], net({ [url(1)]: first }), { cacheDir, readPdf: counting });
  // The cached PDF changes (as a refetch would make it): its sha256 differs, so the counts are read again.
  const second = fakePdf([OCR, '']);
  await Deno.writeFile(join(cacheDir, `${sha(url(1))}.pdf`), second);
  const r2 = await run([rec('k1', [OCR, OCR], url(1))], net({}), { cacheDir, readPdf: counting });
  assertEquals(reads, 2);
  assertEquals(r2.check.stats.unverifiedPages, 0, 'page 2 now has no text layer but the pack holds text there');
  const countsPath = join(cacheDir, `${createHash('sha256').update(second).digest('hex')}.pages.json`);
  await Deno.writeTextFile(countsPath, '{ damaged');
  await run([rec('k1', [OCR, OCR], url(1))], net({}), { cacheDir, readPdf: counting });
  assertEquals(reads, 3);
  const c = JSON.parse(await Deno.readTextFile(countsPath));
  await Deno.writeTextFile(countsPath, JSON.stringify({ ...c, rule: 'an older rule' }));
  await run([rec('k1', [OCR, OCR], url(1))], net({}), { cacheDir, readPdf: counting });
  assertEquals(reads, 4);
});

Deno.test('progress goes to the log every 100 records, counts only', async () => {
  const lines: string[] = [];
  const records = Array.from({ length: 250 }, (_, i) => rec(`key-${i}`, ['a'], null));
  await run(records, net({}), { log: (l) => lines.push(l) });
  assertEquals(lines.length, 2);
  assert(lines[0].includes('100 of 250') && lines[1].includes('200 of 250'), lines.join('\n'));
  assert(!lines.join('').includes('key-') && !lines.join('').includes('example'), lines.join('\n'));
});
