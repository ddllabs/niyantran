// web-text: the Firecrawl call and how its answer maps to an outcome (F369, docs/specs/2026-11-23-regulatory-web-text-firecrawl.md).
//
// One request per official web page: POST https://api.firecrawl.dev/v2/scrape with the options below, fixed in code (the
// runner hashes REQUEST_OPTIONS into its receipt). Only the page itself is fetched, never the blocked PDF (D2), with the
// basic proxy only (D3: no escalation past the host's handling of automated clients). `parsers: []` makes a URL that turns
// out to serve a PDF cost one credit and fail not_html, instead of paying per PDF page. No actions, no JSON format and no
// other paid option. The answer is untrusted data: only its markdown and three metadata fields (statusCode, contentType,
// url) are read, from a body of at most MAX_RESPONSE_BYTES.

/** Firecrawl's scrape endpoint (v2). */
export const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';

/** The proxy mode (decision D3, 2026-11-23): basic only. */
export const PROXY_MODE = 'basic';

/** Firecrawl's own time limit for a scrape, in the request body. */
export const FIRECRAWL_TIMEOUT_MS = 60_000;

/** The most of a 2xx answer's body that is read: a larger one fails firecrawl_too_large (the stored text is capped at
 * 2,000,000 characters, so a good page's JSON is well under this). */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// The RBI site chrome the scrape removes before conversion (Firecrawl v2 `excludeTags`: CSS selectors). The 20-page trial
// showed that every RBI page's markdown carried about 600-800 words of chrome above and below the document: the year/month
// archive tree (.grid_subtree with #treeYearMonth_PR and .accordionContent), the site menus (.menu, .centermenu), the footer
// (.footer, footer), navigation (nav) and the page tools (.top_setting, .logo, #UsrFontCntr_tblThemes). Measured on RBI
// pages on 2026-11-26: these containers have 0% 5-gram overlap with the document, which lives in #doublescroll (98-99% of
// its 5-grams are in the pack's own text). They match nothing on SEBI pages. The second trial (2026-11-26) left about 15
// words a page: the search box label (.search_label) and a back link (#backDiv), added for the full scrape as
// rbi-chrome-v2 (the trial pages keep rbi-chrome-v1, the request that scraped them). The scripts/bulk-runner/web_route.ts
// copy must list the same selectors in the same order.
export const RBI_CHROME_SELECTORS: readonly string[] = Object.freeze([
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
]);

/** Every option of the request but the URL. Frozen: a change is a code change, and changes the runner's receipt hash. */
export const REQUEST_OPTIONS = Object.freeze({
  formats: Object.freeze(['markdown']),
  onlyMainContent: true,
  excludeTags: RBI_CHROME_SELECTORS,
  parsers: Object.freeze([]),
  maxAge: 0,
  storeInCache: false,
  blockAds: true,
  removeBase64Images: true,
  timeout: FIRECRAWL_TIMEOUT_MS,
  proxy: PROXY_MODE,
});

/** The engine label the runner stores as text_engine. */
export const TEXT_ENGINE = `firecrawl v2/scrape markdown onlyMainContent excludeTags=rbi-chrome-v2 proxy=${PROXY_MODE}`;

/** The request body for one page. */
export function scrapeBody(url: string): Record<string, unknown> {
  return { url, ...REQUEST_OPTIONS };
}

/** What a scrape produced. `done` is stored by public.web_text_finish; every other outcome by public.web_text_fail. */
export type ScrapeOutcome =
  | { kind: 'done'; text: string; sourceStatus: 200; finalHost: string; contentType: string }
  | {
    kind: 'fail';
    code: string;
    /** The attempt may have been billed: its estimate counts as spent. */
    uncertain: boolean;
    /** Do not try again. */
    permanent: boolean;
    /** Firecrawl returned a document: one credit (the database counts it by the code). */
    billed: boolean;
    sourceStatus?: number;
  };

const fail = (
  code: string,
  { uncertain = false, permanent = false, billed = false, sourceStatus }: {
    uncertain?: boolean;
    permanent?: boolean;
    billed?: boolean;
    sourceStatus?: number;
  } = {},
): ScrapeOutcome => ({ kind: 'fail', code, uncertain, permanent, billed, sourceStatus });

/** A content type the done rule accepts: HTML or XHTML, any parameters. */
const HTML_TYPE = /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i;

// The URL rule, mirroring the migration's private.web_text_url_ok exactly (the host list is the enqueue's own check; the
// three forms below admit only those hosts). The database holds the same rule in the table's check; this copy keeps a row
// that somehow broke it from ever reaching Firecrawl.
const RBI_PRESS_RELEASE = /^https:\/\/www\.rbi\.org\.in\/Scripts\/BS_PressReleaseDisplay\.aspx\?prid=[0-9]{1,7}$/;
const RBI_NOTIFICATION = /^https:\/\/www\.rbi\.org\.in\/Scripts\/NotificationUser\.aspx\?Id=[0-9]{1,7}$/;
const SEBI_PAGE = /^https:\/\/www\.sebi\.gov\.in\/[a-z0-9/_.-]+\.html$/;
/** 'https://www.sebi.gov.in/' (24 characters) and '.html' (5): the SEBI path between them is 1 to 400 characters. */
const SEBI_FIXED_CHARS = 29;
// deno-lint-ignore no-control-regex
const CONTROL_OR_BACKSLASH = /[\x00-\x1f\x7f\\]/;
const ENCODED_SEPARATOR = /%2f|%5c/i;
const DOT_SEGMENT = /(^|\/)(\.|%2e){1,2}((;|%3b)[^/]*)?(\/|$)/i;

/** True when `url` is an official page the queue admits (private.web_text_url_ok), in its canonical form. */
export function officialUrlOk(url: unknown): boolean {
  if (typeof url !== 'string' || new TextEncoder().encode(url).length > 2000) return false;
  const sebiOk = SEBI_PAGE.test(url) && url.length - SEBI_FIXED_CHARS >= 1 && url.length - SEBI_FIXED_CHARS <= 400;
  if (!(RBI_PRESS_RELEASE.test(url) || RBI_NOTIFICATION.test(url) || sebiOk)) return false;
  if (CONTROL_OR_BACKSLASH.test(url)) return false;
  // Before any ? or #: no encoded separator and no . or .. path segment (plain, encoded or with a path parameter).
  const path = url.split('?')[0].split('#')[0];
  if (ENCODED_SEPARATOR.test(path) || DOT_SEGMENT.test(path)) return false;
  try {
    return new URL(url).href === url;
  } catch {
    return false;
  }
}

/** The text as stored: no NUL (a text value cannot hold one) and no lone surrogate (jsonb refuses one). */
export function storableText(text: string): string {
  return text.replaceAll('\u0000', '').toWellFormed();
}

/** Firecrawl's HTTP status, before the body is read: the outcome table's error rows. Null for a 2xx. */
export function outcomeOfStatus(status: number): ScrapeOutcome | null {
  if (status >= 200 && status < 300) return null;
  if (status === 400) return fail('firecrawl_rejected', { permanent: true });
  // A wrong key, or a feature not allowed: not billed; the database switches the run off.
  if (status === 401 || status === 403) return fail('firecrawl_forbidden', { permanent: true });
  // No credits left: not billed; the database switches the run off.
  if (status === 402) return fail('firecrawl_no_credits', { permanent: true });
  // A duplicate or in-flight x-request-id: the first may have been billed.
  if (status === 409) return fail('firecrawl_duplicate', { uncertain: true });
  if (status === 429) return fail('firecrawl_rate_limited');
  // 5xx and anything else unexpected: it may have been processed and billed. Tried again.
  return fail('firecrawl_unavailable', { uncertain: true });
}

/** `u` normalised by the URL parser, or null when it does not parse. */
function hrefOf(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    return new URL(u).href;
  } catch {
    return null;
  }
}

/** A 2xx answer's body (already parsed) for the page at `requested`: the outcome table's 200 rows, in its order. */
export function outcomeOfAnswer(requested: string, body: unknown): ScrapeOutcome {
  const b = body as { success?: unknown; data?: unknown } | null;
  if (!b || typeof b !== 'object' || b.success !== true || !b.data || typeof b.data !== 'object') {
    return fail('firecrawl_unreadable', { uncertain: true });
  }
  const data = b.data as { markdown?: unknown; metadata?: unknown };
  const meta = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>;
  const status = meta.statusCode;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    return fail('firecrawl_unreadable', { uncertain: true });
  }
  // A document came back: every outcome from here on was billed one credit.
  if (status !== 200) return fail(`source_status_${status}`, { billed: true, sourceStatus: status });
  const contentType = typeof meta.contentType === 'string' ? meta.contentType : '';
  if (!HTML_TYPE.test(contentType)) return fail('not_html', { billed: true, permanent: true, sourceStatus: status });
  // The final URL (metadata.url, after redirects) must be the requested page itself, equal after URL normalisation: a
  // redirect to another page, even on the same host (a login or an error page), is not the record's page. No final URL
  // cannot be checked, so it fails too; sourceURL is only the URL we asked for and is never a stand-in for it.
  const requestedHref = hrefOf(requested);
  const finalHref = hrefOf(meta.url);
  if (requestedHref === null || finalHref === null || finalHref !== requestedHref) {
    return fail('redirected', { billed: true, permanent: true, sourceStatus: status });
  }
  const finalHost = new URL(finalHref).host;
  const text = typeof data.markdown === 'string' ? storableText(data.markdown) : '';
  if (!/\S/.test(text)) return fail('empty_text', { billed: true, permanent: true, sourceStatus: status });
  return { kind: 'done', text, sourceStatus: 200, finalHost, contentType: contentType.slice(0, 200) };
}

export interface ScrapeDeps {
  fetch: typeof fetch;
  apiKey: string;
  /** Our own limit on the whole call, body included. */
  timeoutMs: number;
}

const isTimeout = (e: unknown) => e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');

/** A body over the byte limit (declared or streamed). */
class TooLarge extends Error {}

/** The response body as text, refusing more than `max` bytes: on the declared length alone, or while streaming. */
async function readLimited(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new TooLarge();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** One scrape. Never rejects: every failure is an outcome. `requestId` is sent as x-request-id (the request row's id and
 * the attempt). A URL the function-side rule refuses is never sent. */
export async function scrape(deps: ScrapeDeps, url: string, requestId: string): Promise<ScrapeOutcome> {
  try {
    return await scrapeOnce(deps, url, requestId);
  } catch {
    // Not expected (every step below maps its own errors); whatever it was, the call may have been billed.
    return fail('firecrawl_unavailable', { uncertain: true });
  }
}

async function scrapeOnce(deps: ScrapeDeps, url: string, requestId: string): Promise<ScrapeOutcome> {
  if (!officialUrlOk(url)) return fail('official_url_invalid', { permanent: true });
  const signal = AbortSignal.timeout(deps.timeoutMs);
  let res: Response;
  try {
    res = await deps.fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${deps.apiKey}`,
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      body: JSON.stringify(scrapeBody(url)),
      // A redirect of the API call itself is refused (fetch rejects: firecrawl_unavailable), never followed.
      redirect: 'error',
      signal,
    });
  } catch (e) {
    return isTimeout(e) || signal.aborted
      ? fail('firecrawl_timeout', { uncertain: true })
      : fail('firecrawl_unavailable', { uncertain: true });
  }
  const byStatus = outcomeOfStatus(res.status);
  if (byStatus) {
    await res.body?.cancel().catch(() => {});
    return byStatus;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readLimited(res, MAX_RESPONSE_BYTES));
  } catch (e) {
    // A 2xx with a document too large to read was still a scrape: billed, and not tried again.
    if (e instanceof TooLarge) return fail('firecrawl_too_large', { billed: true, permanent: true });
    return isTimeout(e) || signal.aborted
      ? fail('firecrawl_timeout', { uncertain: true })
      : fail('firecrawl_unreadable', { uncertain: true });
  }
  return outcomeOfAnswer(url, body);
}
