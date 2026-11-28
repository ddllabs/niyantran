import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  FIRECRAWL_SCRAPE_URL,
  FIRECRAWL_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  officialUrlOk,
  outcomeOfAnswer,
  outcomeOfStatus,
  PROXY_MODE,
  RBI_CHROME_SELECTORS,
  REQUEST_OPTIONS,
  scrape,
  scrapeBody,
  type ScrapeOutcome,
  storableText,
  TEXT_ENGINE,
} from './firecrawl.ts';

const KEY = 'fc-0123456789abcdef0123456789abcdef';
const PR = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59012';
const NOTE = 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12919';
const SEBI = 'https://www.sebi.gov.in/legal/circulars/nov-2024/master-circular_88012.html';

/** A Firecrawl 200 answer; `meta` and `data` override the defaults of a good page. */
const answer = (meta: Record<string, unknown> = {}, data: Record<string, unknown> = {}, url = PR) => ({
  success: true,
  data: {
    markdown: '# Press release\n\nThe Reserve Bank today announced.',
    metadata: { title: 'x', sourceURL: url, url, statusCode: 200, contentType: 'text/html; charset=utf-8', ...meta },
    ...data,
  },
});

type Sent = { url: string; init: RequestInit };
function fakeFetch(respond: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    const s = { url: String(input), init: init ?? {} };
    sent.push(s);
    return Promise.resolve(respond(s));
  }) as typeof fetch;
  return { f, sent };
}
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const run = (respond: (sent: Sent) => Response | Promise<Response>, url = PR, timeoutMs = 5_000) => {
  const { f, sent } = fakeFetch(respond);
  return scrape({ fetch: f, apiKey: KEY, timeoutMs }, url, 'row-id-1').then((o) => ({ o, sent }));
};
const failOf = (o: ScrapeOutcome) => {
  assertEquals(o.kind, 'fail');
  return o as Extract<ScrapeOutcome, { kind: 'fail' }>;
};

// ─── The request ─────────────────────────────────────────────────────────────

Deno.test('scrapeBody: exactly the options of the spec, the page URL, and nothing that adds credits', () => {
  assertEquals(scrapeBody(PR), {
    url: PR,
    formats: ['markdown'],
    onlyMainContent: true,
    excludeTags: [...EXCLUDE],
    parsers: [],
    maxAge: 0,
    storeInCache: false,
    blockAds: true,
    removeBase64Images: true,
    timeout: 60_000,
    proxy: 'basic',
  });
  assertEquals(PROXY_MODE, 'basic');
  assertEquals(FIRECRAWL_TIMEOUT_MS, 60_000);
  assertEquals(TEXT_ENGINE, 'firecrawl v2/scrape markdown onlyMainContent excludeTags=rbi-chrome-v2 proxy=basic');
  // No location (Firecrawl's default), no actions, no JSON format, no change tracking.
  for (const k of ['location', 'actions', 'jsonOptions', 'changeTrackingOptions', 'headers', 'mobile']) {
    assert(!(k in scrapeBody(PR)), k);
  }
  assert(
    Object.isFrozen(REQUEST_OPTIONS) && Object.isFrozen(REQUEST_OPTIONS.formats) &&
      Object.isFrozen(REQUEST_OPTIONS.parsers) && Object.isFrozen(REQUEST_OPTIONS.excludeTags),
  );
});

const EXCLUDE = [
  '.grid_subtree',
  '#treeYearMonth_PR',
  '.accordionContent',
  '.menu',
  '.centermenu',
  '.footer',
  'footer',
  'nav',
  '.top_setting',
  '.logo',
  '#UsrFontCntr_tblThemes',
  '.search_label',
  '#backDiv',
];

Deno.test('scrape: the request body the fetch receives carries the RBI chrome selectors in excludeTags, in order', async () => {
  const { sent } = await run(() => jsonResponse(answer()));
  const body = JSON.parse(String(sent[0].init.body));
  assertEquals(body.excludeTags, EXCLUDE);
  assertEquals([...RBI_CHROME_SELECTORS], EXCLUDE);
  assert(!('includeTags' in body));
});

Deno.test('scrape: POST to v2/scrape with the bearer key, JSON, the row id as x-request-id and the exact body', async () => {
  const { o, sent } = await run(() => jsonResponse(answer()));
  assertEquals(o.kind, 'done');
  assertEquals(sent.length, 1);
  assertEquals(sent[0].url, FIRECRAWL_SCRAPE_URL);
  assertEquals(FIRECRAWL_SCRAPE_URL, 'https://api.firecrawl.dev/v2/scrape');
  assertEquals(sent[0].init.method, 'POST');
  assertEquals(sent[0].init.headers, {
    'authorization': `Bearer ${KEY}`,
    'content-type': 'application/json',
    'x-request-id': 'row-id-1',
  });
  assertEquals(JSON.parse(String(sent[0].init.body)), scrapeBody(PR));
  assert(sent[0].init.signal instanceof AbortSignal, 'the call carries a time limit');
  // L2: a redirect of the API call itself is an error, never followed (the bearer key goes to Firecrawl only).
  assertEquals(sent[0].init.redirect, 'error');
});

Deno.test('scrape: a redirect of the API call (fetch rejects under redirect: error) is firecrawl_unavailable', async () => {
  const { o } = await run((s) => {
    if (s.init.redirect === 'error') throw new TypeError('redirect was not allowed');
    return jsonResponse(answer());
  });
  const f = failOf(o);
  assertEquals([f.code, f.uncertain, f.permanent, f.billed], ['firecrawl_unavailable', true, false, false]);
});

Deno.test('scrape: a URL that is not an official page is never sent, and scrape still resolves', async () => {
  for (
    const url of [
      'not a url',
      '',
      'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR12345.PDF',
      'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1#x',
      'https://WWW.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
      'https://evil.example/x.html',
    ]
  ) {
    const { o, sent } = await run(() => jsonResponse(answer({}, {}, url)), url);
    assertEquals(sent.length, 0, url);
    const f = failOf(o);
    assertEquals([f.code, f.uncertain, f.permanent, f.billed], ['official_url_invalid', false, true, false], url);
  }
});

// ─── The outcome table ───────────────────────────────────────────────────────

Deno.test('outcome: 200, success, site status 200, HTML, same host, text: done with the text, the host and the type', async () => {
  for (const url of [PR, NOTE, SEBI]) {
    const { o } = await run(() => jsonResponse(answer({}, {}, url)), url);
    assertEquals(o, {
      kind: 'done',
      text: '# Press release\n\nThe Reserve Bank today announced.',
      sourceStatus: 200,
      finalHost: new URL(url).host,
      contentType: 'text/html; charset=utf-8',
    });
  }
  // XHTML is HTML; parameters and case do not matter.
  assertEquals((await run(() => jsonResponse(answer({ contentType: 'Application/XHTML+XML' })))).o.kind, 'done');
  assertEquals((await run(() => jsonResponse(answer({ contentType: 'text/html' })))).o.kind, 'done');
});

Deno.test('outcome: a site status other than 200 is source_status_<nnn>, billed, tried again', async () => {
  for (const s of [403, 404, 418, 500, 503, 301]) {
    const f = failOf((await run(() => jsonResponse(answer({ statusCode: s })))).o);
    assertEquals(f, {
      kind: 'fail',
      code: `source_status_${s}`,
      uncertain: false,
      permanent: false,
      billed: true,
      sourceStatus: s,
    });
  }
});

Deno.test('outcome: a content type that is not HTML is not_html, billed, final', async () => {
  for (const ct of ['application/pdf', 'text/plain', 'text/htmlx', '', undefined]) {
    const f = failOf((await run(() => jsonResponse(answer({ contentType: ct })))).o);
    assertEquals([f.code, f.billed, f.permanent, f.uncertain], ['not_html', true, true, false]);
  }
});

Deno.test('outcome: a final URL that is missing or not exactly the requested one is redirected, billed, final', async () => {
  const cases: Array<Record<string, unknown>> = [
    { url: 'https://rbidocs.rbi.org.in/rdocs/x.pdf', sourceURL: PR },
    { url: 'https://www.rbi.org.in.evil.example/x', sourceURL: PR },
    { url: 'http://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59012' },
    { url: 'https://www.rbi.org.in:8443/Scripts/BS_PressReleaseDisplay.aspx?prid=59012' },
    { url: 'not a url' },
    { url: 12 },
    { url: undefined, sourceURL: undefined },
    // No fallback to sourceURL: it is the URL we asked for, not where the page ended up.
    { url: undefined, sourceURL: PR },
    // The same host is not enough: another page of the site (a login or an error page) is not the record's page.
    { url: 'https://www.rbi.org.in/Scripts/Other.aspx' },
    { url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59013' },
    { url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=59012&x=1' },
  ];
  for (const meta of cases) {
    const f = failOf((await run(() => jsonResponse(answer(meta)))).o);
    assertEquals(
      [f.code, f.billed, f.permanent, f.uncertain, f.sourceStatus],
      ['redirected', true, true, false, 200],
      JSON.stringify(meta),
    );
  }
  // Equal after URL normalisation (scheme and host case, the default port) is the same page.
  for (
    const url of [
      PR,
      'HTTPS://WWW.RBI.ORG.IN/Scripts/BS_PressReleaseDisplay.aspx?prid=59012',
      'https://www.rbi.org.in:443/Scripts/BS_PressReleaseDisplay.aspx?prid=59012',
    ]
  ) {
    const { o } = await run(() => jsonResponse(answer({ url, sourceURL: PR })));
    assertEquals(o.kind, 'done', url);
  }
});

Deno.test('outcome: a 2xx body over 10 MB is firecrawl_too_large, billed, final, and is not read to the end', async () => {
  const LIMIT = 10 * 1024 * 1024;
  assertEquals(MAX_RESPONSE_BYTES, LIMIT);
  // Refused on the declared length alone.
  let pulled = 0;
  const big = (declared?: number) => {
    pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulled++ >= 40) return c.close();
        c.enqueue(chunk);
      },
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (declared !== undefined) headers['content-length'] = String(declared);
    return new Response(stream, { status: 200, headers });
  };
  const declared = failOf((await run(() => big(LIMIT + 1))).o);
  assertEquals([declared.code, declared.billed, declared.permanent, declared.uncertain], [
    'firecrawl_too_large',
    true,
    true,
    false,
  ]);
  // No length, or a false small one: the stream is cut at the limit.
  for (const d of [undefined, 100]) {
    const streamed = failOf((await run(() => big(d))).o);
    assertEquals([streamed.code, streamed.billed, streamed.permanent], ['firecrawl_too_large', true, true], String(d));
    assert(pulled <= 14, `read ${pulled} MB of 40`);
  }
  // Just under the limit is read and parsed.
  const body = JSON.stringify(answer());
  const padded = body.slice(0, -1) + ' '.repeat(LIMIT - body.length - 1) + '}';
  assertEquals(new TextEncoder().encode(padded).length, LIMIT - 1);
  assertEquals((await run(() => new Response(padded, { status: 200 }))).o.kind, 'done');
});

Deno.test('outcome: empty or blank markdown is empty_text, billed, final', async () => {
  for (const markdown of ['', '  \n\t ', '\u0000', undefined, 12]) {
    const f = failOf((await run(() => jsonResponse(answer({}, { markdown })))).o);
    assertEquals([f.code, f.billed, f.permanent], ['empty_text', true, true]);
  }
});

Deno.test('outcome: Firecrawl 400 rejected, 401 and 403 forbidden, 402 no credits: not billed, final', async () => {
  const want: Record<number, string> = {
    400: 'firecrawl_rejected',
    401: 'firecrawl_forbidden',
    403: 'firecrawl_forbidden',
    402: 'firecrawl_no_credits',
  };
  for (const [s, code] of Object.entries(want)) {
    const f = failOf((await run(() => jsonResponse({ success: false, error: 'x' }, Number(s)))).o);
    assertEquals(f, { kind: 'fail', code, uncertain: false, permanent: true, billed: false, sourceStatus: undefined });
  }
});

Deno.test('outcome: 409 duplicate (may be billed) and 429 rate limited (not billed) are tried again', async () => {
  const dup = failOf((await run(() => jsonResponse({}, 409))).o);
  assertEquals([dup.code, dup.uncertain, dup.permanent, dup.billed], ['firecrawl_duplicate', true, false, false]);
  const rl = failOf((await run(() => jsonResponse({}, 429))).o);
  assertEquals([rl.code, rl.uncertain, rl.permanent, rl.billed], ['firecrawl_rate_limited', false, false, false]);
});

Deno.test('outcome: 500, 503, any other status and a dropped connection are firecrawl_unavailable, uncertain, tried again', async () => {
  for (const s of [500, 502, 503, 404, 408]) {
    const f = failOf((await run(() => jsonResponse({ success: false }, s))).o);
    assertEquals([f.code, f.uncertain, f.permanent], ['firecrawl_unavailable', true, false], String(s));
  }
  const { f } = fakeFetch(() => Promise.reject(new TypeError('connection reset')));
  const dropped = failOf(await scrape({ fetch: f, apiKey: KEY, timeoutMs: 5_000 }, PR, 'id'));
  assertEquals([dropped.code, dropped.uncertain, dropped.permanent], ['firecrawl_unavailable', true, false]);
});

Deno.test('outcome: our time limit is firecrawl_timeout, uncertain, tried again (headers or body)', async () => {
  // No answer at all until the signal fires.
  const hang = ((_: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as typeof fetch;
  const t0 = Date.now();
  const f = failOf(await scrape({ fetch: hang, apiKey: KEY, timeoutMs: 30 }, PR, 'id'));
  assertEquals([f.code, f.uncertain, f.permanent], ['firecrawl_timeout', true, false]);
  assert(Date.now() - t0 < 2_000);
  // Headers arrive, the body never finishes.
  const slowBody = ((_: unknown, init?: RequestInit) => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"success":'));
        init?.signal?.addEventListener('abort', () => c.error(init.signal!.reason));
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  }) as typeof fetch;
  const g = failOf(await scrape({ fetch: slowBody, apiKey: KEY, timeoutMs: 30 }, PR, 'id'));
  assertEquals([g.code, g.uncertain], ['firecrawl_timeout', true]);
});

Deno.test('outcome: a body that does not parse, or not a success, is firecrawl_unreadable, uncertain, tried again', async () => {
  const bodies: Array<() => Response> = [
    () => new Response('<html>not json</html>', { status: 200 }),
    () => jsonResponse({ success: false }),
    () => jsonResponse({ success: true }),
    () => jsonResponse(null),
    () => jsonResponse(answer({ statusCode: undefined })),
    () => jsonResponse(answer({ statusCode: '200' })),
    () => jsonResponse(answer({ statusCode: 99 })),
  ];
  for (const b of bodies) {
    const f = failOf((await run(b)).o);
    assertEquals([f.code, f.uncertain, f.permanent, f.billed], ['firecrawl_unreadable', true, false, false]);
  }
});

Deno.test('outcomeOfStatus: a 2xx goes on to the body', () => {
  assertEquals(outcomeOfStatus(200), null);
  assertEquals(outcomeOfStatus(201), null);
  assertEquals(outcomeOfStatus(199)?.kind, 'fail');
  assertEquals(outcomeOfStatus(300)?.kind, 'fail');
});

Deno.test('text: NUL removed and lone surrogates made well formed before storing; the content type cut to 200', () => {
  const o = outcomeOfAnswer(
    PR,
    answer({ contentType: 'text/html;' + 'x'.repeat(300) }, { markdown: 'a\u0000b\uD800c' }),
  );
  assertEquals(o.kind, 'done');
  const d = o as Extract<ScrapeOutcome, { kind: 'done' }>;
  assertEquals(d.text, 'ab�c');
  assert(!d.text.includes('\u0000'));
  assertEquals(d.contentType.length, 200);
  assertEquals(storableText('x\u0000\u0000y'), 'xy');
});

// ─── The URL rule, function side (mirrors private.web_text_url_ok; the cases are the SQL fixture's section 2) ────────

Deno.test('officialUrlOk: the forms the database admits', () => {
  for (
    const url of [
      PR,
      NOTE,
      SEBI,
      'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1234567',
      'https://www.sebi.gov.in/legal/a..b_1.html',
      'https://www.sebi.gov.in/' + 'a'.repeat(400) + '.html',
    ]
  ) assert(officialUrlOk(url), url);
});

Deno.test('officialUrlOk: every way around the rule the SQL fixture refuses, refused here too', () => {
  const refused = [
    'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR12345.PDF',
    'https://rbidocs.rbi.org.in/rdocs/notification/PDFs/NT123.pdf',
    'https://www.sebi.gov.in/legal/circulars/nov-2024/a_1.html?x=1',
    'https://www.sebi.gov.in/legal/circulars/nov-2024/a_1.html#top',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1&x=2',
    'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=1&prid=2',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?x=2&prid=1',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?Id=1',
    'https://www.rbi.org.in/Scripts/NotificationUser.aspx?prid=1',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?PRID=1',
    'https://www.rbi.org.in/scripts/bs_pressreleasedisplay.aspx?prid=1',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=12345678',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1a',
    'https://user@www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://www.rbi.org.in@evil.example/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://www.rbi.org.in:443/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://www.sebi.gov.in:8443/legal/a_1.html',
    'http://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://www.rbi.org.in.evil.example/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://www.sebi.gov.in.evil.example/a_1.html',
    'https://www.sebi.gov.in/legal/a%2fb.html',
    'https://www.sebi.gov.in/legal/a%5cb.html',
    'https://www.sebi.gov.in/legal/a\\b.html',
    'https://www.sebi.gov.in/legal/../x.html',
    'https://www.sebi.gov.in/legal/./x.html',
    'https://www.sebi.gov.in/../x.html',
    'https://www.sebi.gov.in/legal/%2e%2e/x.html',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1\n',
    'https://www.sebi.gov.in/legal/a\tb.html',
    'https://www.sebi.gov.in/legal/a\x7fb.html',
    'https://www.sebi.gov.in/legal/a\x00b.html',
    'https://www.sebi.gov.in/legal/Circulars/a_1.html',
    'https://www.sebi.gov.in/legal/a_1.pdf',
    'https://www.sebi.gov.in/legal/a_1.htm',
    'https://www.sebi.gov.in/.html',
    'https://www.sebi.gov.in/' + 'a'.repeat(401) + '.html',
    'https://www.rbi.org.in/Scripts/AnnualReportPublications.aspx?Id=1',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx',
    'https://www.indiabudget.gov.in/doc/x.html',
    '',
    'not a url',
  ];
  for (const url of refused) assert(!officialUrlOk(url), JSON.stringify(url));
  for (const v of [12, null, undefined, {}, ['x']]) assert(!officialUrlOk(v), String(v));
});

Deno.test('officialUrlOk: a dot segment the URL parser would quietly remove is refused, not normalised', () => {
  for (const url of ['https://www.sebi.gov.in/legal/a/../b_1.html', 'https://www.sebi.gov.in/legal/./b_1.html']) {
    assert(new URL(url).href !== url, url);
    assert(!officialUrlOk(url), url);
  }
});
