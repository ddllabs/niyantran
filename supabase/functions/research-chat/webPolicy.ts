// Web search policy for research-chat (docs/specs/2026-10-13-web-search.md
// sections 1 and 4). Pure functions, no I/O: whether a turn is offered web
// search and why, which models may search, the server-side check that keeps an
// invented link out of an answer, and the list of pages shown under it.

import type { WebReason } from '../_shared/chatStream.ts';
import { normaliseUrl, type WebPage, type WebSource, webDomain } from '../_shared/webSearch.ts';
import type { Focus } from './validate.ts';

/** What the turn's scope says about indexed documents. Built by the handler. */
export interface WebScope {
  focus: Focus;
  /**
   * attached/selection: the rows and records in scope (uploaded files are not
   * records and are left out). `indexed`: its document_key resolves to a
   * document with indexed_at set. A missing key is `indexed: false`.
   */
  records: { key: string | null; indexed: boolean }[];
  /** An "Ask about this document" chip is in scope (indexed by construction). */
  documentAttached: boolean;
  /** desk focus: whether the open module is among document_modules(); null when no module is open. */
  moduleHasDocuments: boolean | null;
}

export interface WebDecision {
  offered: boolean;
  /** The reader's override, or 'auto' when there is none. */
  mode: 'auto' | 'on' | 'off';
  reason: WebReason;
}

/** Spec section 1: scope has no indexed document. */
function automatic(scope: WebScope): { on: boolean; reason: WebReason } {
  switch (scope.focus) {
    case 'broad':
      return { on: false, reason: 'broad' };
    case 'desk':
      if (scope.moduleHasDocuments === false) return { on: true, reason: 'module-without-documents' };
      if (scope.moduleHasDocuments === true) return { on: false, reason: 'documents-in-scope' };
      return { on: false, reason: 'no-record' };
    default: // 'attached' | 'selection'
      if (scope.records.some((r) => !r.indexed)) return { on: true, reason: 'record-without-document' };
      if (scope.records.length || scope.documentAttached) return { on: false, reason: 'documents-in-scope' };
      return { on: false, reason: 'no-record' };
  }
}

/**
 * The server's decision for one turn, made before the first model call.
 * `override` is the request's `web_search`, or the conversation's stored value
 * (null means automatic). The gates can only turn web search off: a
 * conversational turn, and a model that cannot take the tool.
 */
export function decideWebSearch(i: {
  scope: WebScope;
  override: boolean | null;
  conversational: boolean;
  modelAllowed: boolean;
}): WebDecision {
  const mode = i.override === true ? 'on' : i.override === false ? 'off' : 'auto';
  if (i.conversational) return { offered: false, mode, reason: 'conversational' };
  if (i.override === false) return { offered: false, mode, reason: 'override-off' };
  const auto = i.override === true ? null : automatic(i.scope);
  const wanted = i.override === true || auto!.on;
  if (wanted && !i.modelAllowed) return { offered: false, mode, reason: 'model-unsupported' };
  if (i.override === true) return { offered: true, mode, reason: 'override-on' };
  return { offered: auto!.on, mode, reason: auto!.reason };
}

/**
 * Whether a model may be given the paid server tool: never a `:free` model
 * (a paid tool on a free model is a surprising bill), and never one whose
 * `ai_models.params.web_search` is false.
 */
export function webModelAllowed(modelId: string, params?: unknown): boolean {
  if (String(modelId ?? '').toLowerCase().endsWith(':free')) return false;
  if (params && typeof params === 'object' && !Array.isArray(params) && (params as Record<string, unknown>).web_search === false) {
    return false;
  }
  return true;
}

// ---- markdown link scanning ----

interface Link {
  /** The destination as written (no title, no angle brackets). */
  url: string;
  image: boolean;
}

/** Lines of fenced code are returned untouched; everything else is scanned. */
function segments(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  let fence: { char: string; length: number } | null = null;
  const push = (code: boolean, line: string) => {
    const last = out[out.length - 1];
    if (last && last.code === code) last.text += line;
    else out.push({ code, text: line });
  };
  for (const line of text.split(/(?<=\n)/)) {
    if (fence) {
      push(true, line);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?\n?$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      push(true, line);
    } else {
      push(false, line);
    }
  }
  return out;
}

/** End index (exclusive) of a code span opening at `i`, or `i + run` when it never closes (the backticks are text). */
function codeSpanEnd(s: string, i: number): number {
  let n = 0;
  while (s[i + n] === '`') n++;
  let j = i + n;
  while (j < s.length) {
    if (s[j] !== '`') {
      j++;
      continue;
    }
    let m = 0;
    while (s[j + m] === '`') m++;
    if (m === n) return j + m;
    j += m;
  }
  return i + n;
}

/**
 * For each `[`, the index of the `]` that closes it (-1 when none), in one
 * pass, so a run of unmatched brackets cannot make link scanning quadratic.
 */
function bracketMatches(s: string, skipCode: boolean): Int32Array {
  const match = new Int32Array(s.length).fill(-1);
  const open: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === '`' && skipCode) i = codeSpanEnd(s, i) - 1;
    else if (c === '[') open.push(i);
    else if (c === ']' && open.length) match[open.pop()!] = i;
  }
  return match;
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** No real URL is longer (normaliseUrl refuses past 2,000); bounds the scan of a pathological one. */
const DESTINATION_MAX = 4_000;

/**
 * `(destination "title")` starting at the `(` at `p`: the destination and the
 * index after `)`, or null. A destination past DESTINATION_MAX stops the scan
 * there and is returned as is, so the caller removes it as an unusable URL.
 */
function parseDestination(s: string, p: number): { url: string; end: number } | null {
  let j = p + 1;
  while (isSpace(s[j])) j++;
  let url: string;
  if (s[j] === '<') {
    const start = ++j;
    while (j < s.length && j - start < DESTINATION_MAX && s[j] !== '>' && s[j] !== '\n' && s[j] !== '<') {
      j += s[j] === '\\' ? 2 : 1;
    }
    if (j - start >= DESTINATION_MAX) return { url: s.slice(start, j), end: j };
    if (s[j] !== '>') return null;
    url = s.slice(start, j);
    j++;
  } else {
    const start = j;
    let depth = 0;
    while (j < s.length && !isSpace(s[j])) {
      if (j - start >= DESTINATION_MAX) return { url: s.slice(start, j), end: j };
      if (s[j] === '\\') {
        j += 2;
        continue;
      }
      if (s[j] === '(') depth++;
      else if (s[j] === ')') {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    if (depth !== 0) return null;
    url = s.slice(start, j);
  }
  while (isSpace(s[j])) j++;
  const quote = s[j];
  if (quote === '"' || quote === "'" || quote === '(') {
    const closer = quote === '(' ? ')' : quote;
    j++;
    while (j < s.length && s[j] !== closer) j += s[j] === '\\' ? 2 : 1;
    if (s[j] !== closer) return null;
    j++;
    while (isSpace(s[j])) j++;
  }
  return s[j] === ')' ? { url, end: j + 1 } : null;
}

/** Link text nested deeper than this is not a real link; its markup is defused. */
const NESTING_MAX = 16;

/**
 * Walks `s[from, to)`, calling `visit` for each inline link or image (outer
 * before inner), and rebuilds it. `visit` returns false to drop the link,
 * keeping its text. Citation markers (`[1]`, `[1, 2]`) are not followed by `(`
 * and never match. Code spans are skipped unless `scanCode`.
 */
function rewrite(
  s: string,
  from: number,
  to: number,
  match: Int32Array,
  visit: (link: Link) => boolean,
  scanCode: boolean,
  depth: number,
): string {
  let out = '';
  let i = from;
  while (i < to) {
    const c = s[i];
    if (c === '\\') {
      out += s.slice(i, Math.min(i + 2, to));
      i += 2;
      continue;
    }
    if (c === '`' && !scanCode) {
      const end = Math.min(codeSpanEnd(s, i), to);
      out += s.slice(i, end);
      i = end;
      continue;
    }
    const image = c === '!' && s[i + 1] === '[';
    if (c === '[' || image) {
      const open = image ? i + 1 : i;
      const close = match[open];
      const dest = close >= 0 && close < to && s[close + 1] === '(' ? parseDestination(s, close + 1) : null;
      if (dest && dest.end <= to) {
        const keep = visit({ url: dest.url, image });
        const inner = depth >= NESTING_MAX
          ? s.slice(open + 1, close).replace(/\]\(/g, '] (')
          : rewrite(s, open + 1, close, match, visit, scanCode, depth + 1);
        out += keep ? `${s.slice(i, open + 1)}${inner}${s.slice(close, dest.end)}` : inner;
        i = dest.end;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

const scan = (s: string, visit: (link: Link) => boolean, scanCode: boolean): string =>
  rewrite(s, 0, s.length, bracketMatches(s, !scanCode), visit, scanCode, 0);

function rewriteText(text: string, visit: (link: Link) => boolean, scanCode: boolean): string {
  if (scanCode) return scan(text, visit, true);
  return segments(text).map((seg) => seg.code ? seg.text : scan(seg.text, visit, false)).join('');
}

/**
 * Keeps a markdown link only when its URL is a page searched this turn (or
 * another URL the caller grounded), compared by normalised URL. Any other
 * link keeps its text and loses the link; an image becomes its alt text.
 * `javascript:`, `data:` and every other non-http(s) destination are removed
 * even if listed, because they never normalise.
 *
 * Links inside code spans and fenced blocks are left alone, as the spec says.
 * The chat client's markdown renderer is not CommonMark, though, and renders a
 * link it finds in a fenced block or a double-backtick span; pass
 * `scanCode: true` to check those too.
 */
export function checkLinks(
  answer: string,
  allowed: Iterable<string>,
  options: { scanCode?: boolean } = {},
): { text: string; removed: number } {
  const ok = new Set<string>();
  for (const url of allowed) {
    const n = normaliseUrl(url);
    if (n) ok.add(n);
  }
  let removed = 0;
  const text = rewriteText(String(answer ?? ''), ({ url }) => {
    const n = normaliseUrl(url);
    if (n && ok.has(n)) return true;
    removed++;
    return false;
  }, options.scanCode === true);
  return { text, removed };
}

const SOURCES_MAX = 20;
const TITLE_MAX = 300;

/**
 * The list the reader sees under the answer: every page searched, from the
 * annotations rather than from the model. A page the answer links to is
 * `cited` and comes first, in order of first appearance; the rest follow in
 * page order. At most 20.
 */
export function webSourcesOf(pages: WebPage[], answer: string): WebSource[] {
  const cited: string[] = [];
  rewriteText(String(answer ?? ''), ({ url, image }) => {
    const n = image ? null : normaliseUrl(url);
    if (n && !cited.includes(n)) cited.push(n);
    return true;
  }, false);
  const byUrl = new Map<string, WebSource>();
  for (const page of pages) {
    const url = normaliseUrl(page?.url);
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, {
      url,
      title: (typeof page.title === 'string' ? page.title.trim() : '').slice(0, TITLE_MAX) || url,
      domain: webDomain(url),
      cited: cited.includes(url),
    });
  }
  const first = cited.flatMap((url) => byUrl.has(url) ? [byUrl.get(url)!] : []);
  const rest = [...byUrl.values()].filter((s) => !s.cited);
  return [...first, ...rest].slice(0, SOURCES_MAX);
}
