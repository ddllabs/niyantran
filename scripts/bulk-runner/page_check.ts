// Text per page (F307, S3; docs/specs/2026-11-10-screening-stage.md, "Text per page"). A check, not a repair: for each
// record it fetches the official PDF, reads its page count and the text layer of each page, and compares them with the
// pack: page by page for a record whose page_split is 'exact', as a whole document otherwise (supervisor, 2026-11-10).
// What disagrees is held with a named reason; nothing is changed.
//
// Fetching is polite and serial: at most one request per second per host, robots.txt obeyed (RFC 9309, the `*` group),
// a fixed User-Agent naming the project, retries with growing waits as drive.ts does, and every PDF cached by the
// sha256 of its URL outside the repository. `fetch`, the clock, sleep and the PDF reader are injected, so tests run
// offline. Findings hold reasons, counts and page numbers only: never record text, PDF text or the URL.

import { createHash } from 'node:crypto';
import { dirname, fromFileUrl, join, resolve } from 'jsr:@std/path@1';
import { refuseInCheckout } from './pack.ts';
import type { Rec } from './prepare.ts';
import type { Check, Finding } from './screen_types.ts';

export const USER_AGENT = 'NiyantranTerminal-PageCheck/1 (screening official public documents for a research index)';
/** pdfjs-dist as package.json pins it. A variable, so the module graph does not fetch it until a PDF is read. */
export const PDFJS_SPECIFIER = 'npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs';

const NAME = 'text_per_page';
const MIN_INTERVAL_MS = 1000;
const RETRIES = 3;
const BACKOFF_MS = 500;
const MAX_REDIRECTS = 5;
const MAX_DETAIL_PAGES = 20;

/** The text of each page of a PDF, in order; a page without a text layer gives ''. Throws when it cannot be read. */
export type PdfReader = (bytes: Uint8Array) => Promise<string[]>;

export interface PageCheckDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Where PDFs are cached (default ~/niyantran-pdf-cache). Refused when inside any checkout of this repository. */
  cacheDir?: string;
  /** Home directory for the default cache (default $HOME). */
  home?: string;
  /** Reads a PDF's pages (default: pdfjs-dist). */
  readPdf?: PdfReader;
  /** This repository's root (default: two levels above this file). */
  repoRoot?: string;
  /** The repository's git common directory (default: asked of git), to recognise the main checkout from a worktree. */
  commonDir?: () => Promise<string | null>;
  /** One attempt's limit, response body included (default 60 s). */
  timeoutMs?: number;
  /** The largest PDF accepted (default 256 MiB). */
  maxBytes?: number;
}

export interface PageCheckStats {
  /** PDFs fetched from their host in this run. */
  fetched: number;
  /** PDFs served from the cache. */
  cached: number;
  /** Source keys whose PDF has no text layer on any page (compared by page count only, not held). */
  scans: string[];
}

/** The page check: a `Check`, plus counts for the screen's receipt. */
export interface PageCheck extends Check {
  stats: PageCheckStats;
}

/** Letters and decimal digits, any script. Spaces, punctuation and marks are not counted. */
export function lettersAndDigits(s: string): number {
  let n = 0;
  for (const _ of s.matchAll(/[\p{L}\p{Nd}]/gu)) n++;
  return n;
}

// ---- robots.txt (RFC 9309), the group for user agent `*` ----

interface Rule {
  allow: boolean;
  pattern: string;
}

function rulesForStar(text: string): Rule[] {
  const rules: Rule[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      inRules = true;
      if (agents.includes('*') && value !== '') rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return rules;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}${anchored ? '$' : ''}`).test(path);
}

/** Whether robots.txt lets user agent `*` fetch this path (with its query): the longest match wins, Allow on a tie. */
export function robotsAllows(robotsText: string, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of rulesForStar(robotsText)) {
    if (!matches(r.pattern, pathAndQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) {
      best = r;
    }
  }
  return best ? best.allow : true;
}

// ---- the cache directory: outside every checkout of this repository (pack.ts's refuseInCheckout) ----

async function gitCommonDir(repoRoot: string): Promise<string | null> {
  try {
    const out = await new Deno.Command('git', {
      args: ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      stdout: 'piped',
      stderr: 'null',
    }).output();
    return out.code === 0 ? new TextDecoder().decode(out.stdout).trim() || null : null;
  } catch {
    return null;
  }
}

// ---- the default PDF reader ----

interface PdfJs {
  getDocument(src: Rec): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Rec[] }>; cleanup(): void }>;
      destroy(): Promise<void>;
    }>;
  };
}

/** The text of each page through pdfjs-dist (as scripts/f281-repair/pdfRuns.mjs opens PDFs). */
export const defaultPdfReader: PdfReader = async (bytes) => {
  const pdfjs: PdfJs = await import(PDFJS_SPECIFIER);
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    verbosity: 0,
    useSystemFonts: false,
  }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((i) => (typeof i.str === 'string' ? i.str : '')).join(''));
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
};

// ---- the check ----

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const isPdf = (b: Uint8Array) =>
  b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

/** A transfer failure worth another attempt. */
class Retry extends Error {}
/** A response that is final and wrong (not a PDF, too large). */
class Refuse extends Error {
  constructor(readonly reason: 'pdf_unavailable' | 'pdf_unreadable', message: string) {
    super(message);
  }
}

type Failure = { reason: 'pdf_unavailable' | 'pdf_unreadable'; detail: string };
type Got<T> = { ok: true; value: T } | { ok: false; status: number | null; detail: string };

/** The pack's page texts by page number, or why there are none. */
function packPages(r: Rec): Map<number, string> | string {
  if (!Array.isArray(r.pages) || r.pages.length === 0) return 'no page list';
  let points: string[] | null = null;
  const out = new Map<number, string>();
  for (const p of r.pages) {
    if (!p || typeof p !== 'object') return 'a page entry is not an object';
    const s = p as Rec;
    if (!Number.isSafeInteger(s.page_number) || (s.page_number as number) < 1) return 'a page has no page number';
    if (typeof s.text === 'string') {
      out.set(s.page_number as number, s.text);
      continue;
    }
    const a = s.char_from;
    const b = s.char_to;
    if (typeof r.text !== 'string' || !Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
      return `page ${s.page_number} has no text`;
    }
    points ??= [...r.text];
    if ((a as number) < 0 || (b as number) < (a as number) || (b as number) > points.length) {
      return `page ${s.page_number} has no text`;
    }
    out.set(s.page_number as number, points.slice(a as number, b as number).join(''));
  }
  return out;
}

function officialUrl(v: unknown): URL | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

const listPages = (ns: number[]) =>
  `pages ${ns.slice(0, MAX_DETAIL_PAGES).join(', ')}${
    ns.length > MAX_DETAIL_PAGES ? ` and ${ns.length - MAX_DETAIL_PAGES} more` : ''
  }`;

export function makePageCheck(deps: PageCheckDeps): PageCheck {
  const readPdf = deps.readPdf ?? defaultPdfReader;
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const maxBytes = deps.maxBytes ?? 256 * 1024 * 1024;
  const stats: PageCheckStats = { fetched: 0, cached: 0, scans: [] };
  const lastRequest = new Map<string, number>();
  const robots = new Map<string, { text: string | null } | { failed: string }>();

  /** At most one request per second to each host. */
  async function gate(host: string): Promise<void> {
    const last = lastRequest.get(host);
    if (last !== undefined) {
      const wait = last + MIN_INTERVAL_MS - deps.now();
      if (wait > 0) await deps.sleep(wait);
    }
    lastRequest.set(host, deps.now());
  }

  /**
   * One GET, retried up to RETRIES times with growing waits for a transfer failure: a network error, a timeout, a 5xx,
   * 408 or 429, or a body shorter than its Content-Length. Other statuses are final. Redirects are followed by hand
   * (each hop rate-limited and, for PDFs, checked against its host's robots.txt).
   */
  async function get<T>(
    start: URL,
    consume: (res: Response, signal: AbortSignal) => Promise<T>,
    hop?: (u: URL) => Promise<string | null>,
  ): Promise<Got<T>> {
    let at = start;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      let last = 'unknown';
      let next: URL | null = null;
      let done: Got<T> | null = null;
      for (let attempt = 0; attempt <= RETRIES && !done && !next; attempt++) {
        if (attempt > 0) await deps.sleep(BACKOFF_MS * 2 ** (attempt - 1));
        await gate(at.host);
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const res = await deps.fetch(at.href, {
            headers: { 'user-agent': USER_AGENT },
            redirect: 'manual',
            signal: ctl.signal,
          });
          if (res.status >= 200 && res.status < 300) {
            done = { ok: true, value: await consume(res, ctl.signal) };
          } else if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            await res.body?.cancel();
            next = new URL(res.headers.get('location')!, at);
          } else {
            await res.body?.cancel();
            last = `HTTP ${res.status}`;
            if (!(res.status >= 500 || res.status === 408 || res.status === 429)) {
              done = { ok: false, status: res.status, detail: last };
            }
          }
        } catch (e) {
          if (e instanceof Refuse) throw e;
          if (ctl.signal.aborted) last = 'timeout';
          else if (e instanceof Retry) last = e.message;
          else if (e instanceof TypeError) last = 'network error';
          else throw e;
        } finally {
          clearTimeout(timer);
        }
      }
      if (done) return done;
      if (!next) return { ok: false, status: null, detail: `${last} after ${RETRIES + 1} attempts` };
      if (next.protocol !== 'https:' && next.protocol !== 'http:') {
        return { ok: false, status: null, detail: 'redirected away from http' };
      }
      const blocked = hop ? await hop(next) : null;
      if (blocked) return { ok: false, status: null, detail: blocked };
      at = next;
    }
    return { ok: false, status: null, detail: 'too many redirects' };
  }

  /** The body, whole; short of its Content-Length is a transfer failure; over maxBytes or not `%PDF-` is refused. */
  async function body(res: Response, signal: AbortSignal, pdf: boolean): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let n = 0;
    try {
      for await (const chunk of res.body ?? new ReadableStream<Uint8Array>()) {
        if (signal.aborted) throw new Retry('timeout');
        parts.push(chunk);
        n += chunk.length;
        if (n > maxBytes) throw new Refuse('pdf_unavailable', `larger than ${maxBytes} bytes`);
        if (pdf && n >= 5 && parts.length === 1 && !isPdf(chunk)) throw new Refuse('pdf_unreadable', 'not a PDF');
      }
    } catch (e) {
      await res.body?.cancel().catch(() => {});
      if (e instanceof Refuse || e instanceof Retry) throw e;
      throw new Retry('body read failed');
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    const declared = Number(res.headers.get('content-length'));
    if (res.headers.has('content-length') && Number.isSafeInteger(declared) && n < declared) {
      throw new Retry(`body short: ${n} of ${declared} bytes`);
    }
    if (pdf && !isPdf(out)) throw new Refuse('pdf_unreadable', 'not a PDF');
    return out;
  }

  /** null when the URL may be fetched, otherwise why not. robots.txt is fetched once per host and run. */
  async function robotsBlock(u: URL): Promise<string | null> {
    if (!robots.has(u.origin)) {
      let got: Got<string>;
      try {
        got = await get(new URL('/robots.txt', u.origin), async (res, signal) => {
          return new TextDecoder().decode(await body(res, signal, false));
        });
      } catch (e) {
        if (!(e instanceof Refuse)) throw e;
        got = { ok: false, status: null, detail: e.message };
      }
      if (got.ok) robots.set(u.origin, { text: got.value });
      else if (got.status !== null && got.status >= 400 && got.status < 500) robots.set(u.origin, { text: null });
      else robots.set(u.origin, { failed: `robots.txt unavailable: ${got.detail}` });
    }
    const r = robots.get(u.origin)!;
    if ('failed' in r) return r.failed;
    if (r.text !== null && !robotsAllows(r.text, u.pathname + u.search)) return 'disallowed by robots.txt';
    return null;
  }

  async function obtain(u: URL, cacheDir: string): Promise<Uint8Array | Failure> {
    const path = join(cacheDir, `${sha256(u.href)}.pdf`);
    try {
      const cached = await Deno.readFile(path);
      if (isPdf(cached)) {
        stats.cached++;
        return cached;
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    const blocked = await robotsBlock(u);
    if (blocked) return { reason: 'pdf_unavailable', detail: blocked };
    let got: Got<Uint8Array>;
    try {
      got = await get(u, (res, signal) => body(res, signal, true), robotsBlock);
    } catch (e) {
      if (e instanceof Refuse) return { reason: e.reason, detail: e.message };
      throw e;
    }
    if (!got.ok) return { reason: 'pdf_unavailable', detail: got.detail };
    stats.fetched++;
    const part = `${path}.part-${crypto.randomUUID().slice(0, 8)}`;
    try {
      await Deno.writeFile(part, got.value, { createNew: true });
      await Deno.rename(part, path);
    } catch (e) {
      await Deno.remove(part).catch(() => {});
      throw e;
    }
    return got.value;
  }

  async function judge(r: Rec, cacheDir: string): Promise<Finding[]> {
    const finding = (reason: string, detail?: string): Finding => ({
      check: NAME,
      covers: ['completeness'],
      reason,
      ...(detail === undefined ? {} : { detail }),
    });
    const u = officialUrl(r.file_url);
    const pages = packPages(r);
    // Page by page only for a record split exactly into pages; any other is compared as a whole document: its text,
    // or failing that its pages together.
    const perPage = r.page_split === 'exact' && typeof pages !== 'string' ? pages : null;
    const whole = perPage
      ? null
      : typeof r.text === 'string'
      ? r.text
      : typeof pages !== 'string'
      ? [...pages.values()].join('\f')
      : null;
    const early: Finding[] = [];
    if (!u) early.push(finding('no_pdf_url'));
    if (!perPage && whole === null) early.push(finding('no_pages', typeof pages === 'string' ? pages : 'no text'));
    if (early.length || !u) return early;

    const bytes = await obtain(u, cacheDir);
    if (!(bytes instanceof Uint8Array)) return [finding(bytes.reason, bytes.detail)];
    let pdfPages: string[];
    try {
      pdfPages = await readPdf(bytes);
    } catch {
      return [finding('pdf_unreadable', 'the PDF reader failed')];
    }
    const given = Number.isSafeInteger(r.page_count) ? r.page_count as number : null;
    const packCount = given ?? perPage?.size ?? null;
    if (packCount !== null && pdfPages.length !== packCount) {
      return [finding('page_count_mismatch', `pdf ${pdfPages.length}, pack ${packCount}`)];
    }
    const pdfCounts = pdfPages.map(lettersAndDigits);
    if (pdfCounts.every((c) => c === 0)) {
      stats.scans.push(String(r.source_key));
      return [];
    }
    if (!perPage) {
      const pdf = pdfCounts.reduce((a, b) => a + b, 0);
      const pack = lettersAndDigits(whole ?? '');
      return pack * 2 < pdf ? [finding('thin_text', `pack ${pack}, pdf ${pdf}`)] : [];
    }
    const thin: number[] = [];
    pdfCounts.forEach((c, i) => {
      if (c > 0 && lettersAndDigits(perPage.get(i + 1) ?? '') * 2 < c) thin.push(i + 1);
    });
    return thin.length ? [finding('thin_page', listPages(thin))] : [];
  }

  return {
    name: NAME,
    covers: ['completeness'],
    needs: 'pages',
    stats,
    async all(records) {
      const repoRoot = deps.repoRoot ?? resolve(dirname(fromFileUrl(import.meta.url)), '../..');
      let dir = deps.cacheDir;
      if (dir === undefined) {
        const home = deps.home ?? Deno.env.get('HOME');
        if (!home) throw new Error('HOME is not set; give the PDF cache directory');
        dir = join(home, 'niyantran-pdf-cache');
      }
      const commonDir = deps.commonDir ? await deps.commonDir() : await gitCommonDir(repoRoot);
      const cacheDir = await refuseInCheckout(dir, 'the PDF cache', {
        repoRoot,
        commonDir: () => Promise.resolve(commonDir),
      });
      await Deno.mkdir(cacheDir, { recursive: true });
      const out = new Map<string, Finding[]>();
      for (const r of records) {
        const found = await judge(r, cacheDir);
        if (found.length) out.set(String(r.source_key), found);
      }
      return out;
    },
  };
}
