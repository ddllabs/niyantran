// Web-page text route for the Regulators archive (F369, docs/specs/2026-11-23-regulatory-web-text-firecrawl.md). Two
// commands of the runner:
//
//   cli.ts web-enqueue --records <records.jsonl> --holds <holds.jsonl> [--limit N] [--offset N] [--budget-usd N]
//                      [--dry-run] [--psql <path>]
//   cli.ts web-collect --records <records.jsonl> --holds <holds.jsonl> [--limit N] [--offset N]
//                      --out <dir outside every checkout> [--min-identity F] [--psql <path>]
//
// `web-enqueue` reads the pack reader's records and the Regulatory screen's holds, picks the `html` records held for
// extraction_not_allowed and for nothing the new text cannot change, checks each record's own official page against the
// URL rule (never the blocked PDF, D2), and queues them in the database (public.web_text_enqueue, as corpus_ingest). One
// link outside the rule, or an estimate over --budget-usd, refuses the whole plan. The `web-text` Edge function, on
// Supabase, scrapes each page once with Firecrawl under the database's spend cap; no Firecrawl key is ever on this
// machine. `web-collect` reads the finished text back (public.web_text_read), refuses a row that is not the record's own
// request, normalises the markdown, checks it against the pack's own text of the same page (the identity check), and
// writes the pack's record with the new text and `extraction web_firecrawl`, with a receipt chained to the reader's. The
// normal `screen` and `run` then take that file, so the screen, the batch policy and the spend stops all apply.
// Neither command prints a URL, a source key or any document text: only counts and reasons.
import { createHash } from 'node:crypto';
import { join } from 'jsr:@std/path@1';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { billUrlSegmentsOk, canonical } from '../../supabase/functions/_shared/suppliedText.ts';
import REGULATORY from './screens/regulatory.json' with { type: 'json' };
import { gitCommonDir, refuseInCheckout, REPO_ROOT } from './pack.ts';
import { dollarQuote, type PsqlExec } from './psql_db.ts';
import { type HoldLine, readHolds, readRecords } from './ocr_route.ts';

type Rec = Record<string, unknown>;

/** The most records one command takes: the queue's own enqueue call takes at most 50. */
export const MAX_SELECTION = 50;
export const DEFAULT_BUDGET_USD = 1;
/**
 * The runner's estimate of one scrape: Firecrawl's top-up rate, the default of private.web_text_settings.usd_per_credit.
 * The database computes its own estimate from its setting; this one only lets the runner refuse a plan before sending it.
 */
export const USD_PER_CREDIT = 0.005;
/**
 * The identity check's threshold (D9, set from trial T7 on 2026-11-26): the share of the pack's own text's word 5-grams
 * that the new text has. Measured the other way (the new text's 5-grams in the pack's) it failed genuine pages: Firecrawl
 * and the pack's html-to-text pass break tables and headings differently, so about a tenth of the 5-grams differ either
 * way, and the new text is the side with extra words. All 20 genuine trial pages scored at least 0.82 this way.
 */
export const DEFAULT_MIN_IDENTITY = 0.8;
/**
 * The length guard that goes with it (D9): the new text may have at most this many times the pack text's words. A text
 * that contains the pack's text but is much longer (site chrome leaking back, or another page appended) is held.
 */
export const MAX_WORD_RATIO = 1.5;
export const WEB_EXTRACTION = 'web_firecrawl';
/** The pack's own text type of these records: the web page's text by a simple html-to-text pass. */
export const PACK_EXTRACTION = 'html';
/** The hold that makes a record eligible: its pack text type is not allowed. */
export const REQUIRED_REASON = 'extraction_not_allowed';
/**
 * Reasons the new text itself may change, and so may stand beside REQUIRED_REASON (length is judged on the text). Any
 * other reason (a duplicate key, already_live, publisher_unresolved, a host, the citation, no_page_spans under a policy
 * that requires a page count, an incomplete screen) is not changed by new text: such a record is not scraped.
 */
export const TEXT_REASONS: readonly string[] = [REQUIRED_REASON, 'too_short', 'too_long'];

/**
 * The scrape request the `web-text` function sends, as the spec fixes it (D3: basic proxy, default location). Hashed into
 * the collect receipt; the function owns the request itself, so a change there must be mirrored here (web_route_test.ts proves they match).
 */
export const REQUEST_OPTIONS = Object.freeze({
  formats: ['markdown'],
  onlyMainContent: true,
  excludeTags: [
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
  ],
  parsers: [],
  maxAge: 0,
  storeInCache: false,
  blockAds: true,
  removeBase64Images: true,
  timeout: 60_000,
  proxy: 'basic',
});
export const WEB_TEXT_ENGINE =
  `firecrawl v2/scrape markdown onlyMainContent excludeTags=rbi-chrome-v1 proxy=${REQUEST_OPTIONS.proxy}`;
const OUT_RECORDS = 'web-records.jsonl';
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_URL_BYTES = 2_000;
/** The queue's text limit (private.web_text_requests.text). */
const MAX_TEXT_CHARS = 2_000_000;

/** The official pages this route scrapes: exactly one of these, on one of the desk's file hosts. No rbidocs URL (D2). */
const PAGE_RULES: readonly RegExp[] = [
  /^https:\/\/www\.rbi\.org\.in\/Scripts\/BS_PressReleaseDisplay\.aspx\?prid=[0-9]{1,7}$/,
  /^https:\/\/www\.rbi\.org\.in\/Scripts\/NotificationUser\.aspx\?Id=[0-9]{1,7}$/,
  /^https:\/\/www\.sebi\.gov\.in\/[a-z0-9/_.-]{1,400}\.html$/,
];
const DESK_HOSTS: readonly string[] = REGULATORY.url_hosts;
const utf8 = new TextEncoder();
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The link itself when it is one of the record's official pages under the rule: a desk host, exactly one page form, the
 * URL segment rule, no credentials or port, at most 2,000 bytes, and already in the URL parser's own form (a link the
 * parser would rewrite would be scraped rewritten and refused at collect). Else null.
 */
export function officialPage(u: unknown): string | null {
  if (typeof u !== 'string' || utf8.encode(u).length > MAX_URL_BYTES) return null;
  if (PAGE_RULES.filter((r) => r.test(u)).length !== 1 || !billUrlSegmentsOk(u)) return null;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
  // The page forms name their hosts; the desk's list is checked too, as the spec states the rule (both, never rbidocs).
  if (!DESK_HOSTS.includes(url.hostname)) return null;
  return url.href === u ? u : null;
}

// ---- the plan ----

export interface SelectOptions {
  limit: number;
  offset: number;
  budgetUsd: number;
}

export interface EnqueueItem {
  source_key: string;
  official_url: string;
  pack_sha256: string;
}

export interface WebPlan {
  ok: boolean;
  items: EnqueueItem[];
  /** Refusal reasons with their counts; one refusal holds the whole plan. */
  refused: Record<string, number>;
  counts: { records: number; eligible: number; other_holds: number; selected: number };
  estimate_usd: number;
}

export function selectionError(o: SelectOptions): string | null {
  if (!Number.isInteger(o.limit) || o.limit < 1 || o.limit > MAX_SELECTION) {
    return `limit must be 1 to ${MAX_SELECTION}`;
  }
  if (!Number.isInteger(o.offset) || o.offset < 0) return 'offset must be 0 or more';
  if (!Number.isFinite(o.budgetUsd) || o.budgetUsd <= 0) return 'budget must be more than 0';
  return null;
}

/** Held for extraction_not_allowed and for nothing the new text cannot change. */
const eligibleHold = (h: HoldLine): boolean =>
  h.reasons.includes(REQUIRED_REASON) && h.reasons.every((r) => TEXT_REASONS.includes(r));

const noPages = (r: Rec): boolean =>
  r.page_split === 'none' && r.page_count == null &&
  (r.pages === undefined || (Array.isArray(r.pages) && r.pages.length === 0));

/** Which records go to the queue, and why a plan is refused. Nothing is read from the network or the database. */
export function planWeb(records: Rec[], holds: HoldLine[], o: SelectOptions): WebPlan {
  const bad = selectionError(o);
  if (bad) throw new Error(bad);
  const byKey = new Map(records.map((r) => [String(r.source_key), r]));
  const heldKeys = new Set(holds.map((h) => h.source_key));
  const eligibleKeys = [
    ...new Set(
      holds.filter((h) => eligibleHold(h) && byKey.get(h.source_key)?.extraction === PACK_EXTRACTION).map((h) =>
        h.source_key
      ),
    ),
  ].sort();
  const counts = { records: records.length, eligible: eligibleKeys.length, other_holds: 0, selected: 0 };
  counts.other_holds = heldKeys.size - eligibleKeys.length;
  const refused: Record<string, number> = {};
  const refuse = (reason: string) => (refused[reason] = (refused[reason] ?? 0) + 1);
  const items: EnqueueItem[] = [];
  const fail = (): WebPlan => ({ ok: false, items: [], refused, counts, estimate_usd: estimate(counts.selected) });
  const chosen = eligibleKeys.slice(o.offset, o.offset + o.limit);
  if (!chosen.length) {
    refuse('nothing_selected');
    return fail();
  }
  for (const k of chosen) {
    const r = byKey.get(k)!;
    const href = officialPage(r.file_url);
    const citation = isRec(r.citation) ? r.citation : {};
    if (!HEX40.test(k)) refuse('record_shape');
    else if (!href) refuse('file_url');
    else if (citation.page_url !== href) refuse('page_url_mismatch');
    else if (!noPages(r)) refuse('page_split');
    else if (typeof r.content_sha256 !== 'string' || !HEX64.test(r.content_sha256)) refuse('content_sha256');
    else if (typeof r.text !== 'string') refuse('pack_text');
    else items.push({ source_key: k, official_url: href, pack_sha256: r.content_sha256 });
  }
  counts.selected = items.length;
  if (Object.keys(refused).length) return fail();
  const estimate_usd = estimate(items.length);
  if (estimate_usd > o.budgetUsd) {
    refuse('over_budget');
    return fail();
  }
  return { ok: true, items, refused, counts, estimate_usd };
}

const estimate = (n: number) => Number((n * USD_PER_CREDIT).toFixed(6));

// ---- the text ----

// Control codes other than tab and line feed are not text (a carriage return included: CRLF becomes LF).
// deno-lint-ignore no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
/** A markdown link destination: <...>, or a run without spaces that may hold one level of balanced parentheses. */
const DEST = String.raw`(?:<[^<>\n]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?`;
const IMAGE = new RegExp(String.raw`!\[[^\]\n]*\]\(${DEST}\)`, 'g');
/** A link whose label may hold one level of brackets (`[see [1]](url)`). */
const LINK = new RegExp(String.raw`\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(${DEST}\)`, 'g');
const AUTOLINK = /<(https?:\/\/[^<>\s]+)>/g;

/**
 * Firecrawl's markdown as stored text: control codes removed (and counted), image links removed, `[label](url)` replaced
 * by its label, `<url>` by the url (a bare URL stays as text), trailing spaces of each line removed, runs of blank lines
 * collapsed to one, and the whole trimmed. Pure; the same input gives the same output.
 */
export function normaliseMarkdown(markdown: string): { text: string; controlCodesRemoved: number } {
  let removed = 0;
  let t = markdown.replace(CONTROL, () => (removed++, ''));
  // Images first, so a linked image `[![a](b)](c)` leaves an empty label, which the link rule then removes.
  t = t.replace(IMAGE, '');
  let before: string;
  do {
    before = t;
    t = t.replace(LINK, '$1');
  } while (t !== before);
  t = t.replace(AUTOLINK, '$1');
  t = t.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, controlCodesRemoved: removed };
}

const words = (t: string): string[] => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
function grams(t: string): Set<string> {
  const w = words(t);
  const out = new Set<string>();
  for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '));
  return out;
}

/**
 * The share of `of`'s distinct word 5-grams (letters and digits, lower case) that `in_` also has; 0 when `of` has fewer
 * than five words. The identity check calls it as identityShare(packText, newText): how much of the pack's own text of
 * the page the new text contains. It guards against a block or an error page answered with site status 200 in place of
 * the document; the length guard (MAX_WORD_RATIO) guards the other side.
 */
export function identityShare(of: string, in_: string): number {
  const mine = grams(of);
  if (mine.size === 0) return 0;
  const theirs = grams(in_);
  let hit = 0;
  for (const g of mine) if (theirs.has(g)) hit++;
  return hit / mine.size;
}

/** The new text's words over the pack text's words; Infinity when the pack text has none. */
export function wordRatio(newText: string, packText: string): number {
  const p = words(packText).length;
  return p === 0 ? Infinity : words(newText).length / p;
}

/** The receipt's identity distribution: fixed edges, so two receipts compare. */
export const IDENTITY_BUCKETS = ['0-0.5', '0.5-0.8', '0.8-0.9', '0.9-0.95', '0.95-1', '1'] as const;
export function identityBucket(s: number): (typeof IDENTITY_BUCKETS)[number] {
  if (s >= 1) return '1';
  if (s >= 0.95) return '0.95-1';
  if (s >= 0.9) return '0.9-0.95';
  if (s >= 0.8) return '0.8-0.9';
  if (s >= 0.5) return '0.5-0.8';
  return '0-0.5';
}

// ---- the record built from the web text ----

/** A row of public.web_text_read, as the spec names its columns; text only when done. */
export interface WebRow {
  source_key: string;
  official_url: string;
  pack_sha256: string;
  status: string;
  attempts?: number | null;
  credits?: number | null;
  cost_usd?: number | null;
  error_code?: string | null;
  source_status?: number | null;
  final_url_host?: string | null;
  content_type?: string | null;
  text?: string | null;
  text_sha256?: string | null;
}

export class WebRecordError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'WebRecordError';
  }
}

/**
 * The pack's own record with its text replaced by the normalised Firecrawl text: `extraction web_firecrawl`, the engine,
 * no pages (split none, no page_count), and the new text's hash and count. Every other field is the pack's own. The row
 * must be this record's own finished request (its key, its link and the pack's text hash), its text must be what the
 * queue says it stored, the site must have answered 200 from the requested host, and the text must pass the identity
 * check against the pack's own text; otherwise nothing is built.
 */
export async function buildWebRecord(
  orig: Rec,
  row: WebRow,
  minIdentity: number,
): Promise<{ record: Rec; controlCodesRemoved: number; identity: number }> {
  if (row.source_key !== orig.source_key) throw new WebRecordError('row_key_mismatch');
  if (row.status !== 'done') throw new WebRecordError('not_done');
  if (row.pack_sha256 !== orig.content_sha256) throw new WebRecordError('pack_hash_mismatch');
  if (row.official_url !== orig.file_url || officialPage(row.official_url) === null) {
    throw new WebRecordError('url_mismatch');
  }
  if (orig.extraction !== PACK_EXTRACTION || !noPages(orig)) throw new WebRecordError('not_a_page_record');
  if (row.source_status !== 200) throw new WebRecordError('source_status');
  if (row.final_url_host !== new URL(row.official_url).hostname) throw new WebRecordError('final_host');
  const raw = row.text;
  if (typeof raw !== 'string' || raw.length > MAX_TEXT_CHARS) throw new WebRecordError('text_not_string');
  if (typeof row.text_sha256 !== 'string' || row.text_sha256 !== await sha256Hex(raw)) {
    throw new WebRecordError('text_hash_mismatch');
  }
  if (typeof orig.text !== 'string') throw new WebRecordError('pack_text');
  const { text, controlCodesRemoved } = normaliseMarkdown(raw);
  if (!text) throw new WebRecordError('empty_text');
  if (!text.isWellFormed()) throw new WebRecordError('text_malformed');
  const identity = identityShare(orig.text, text);
  if (identity < minIdentity) throw new WebRecordError('web_text_unbound');
  if (wordRatio(text, orig.text) > MAX_WORD_RATIO) throw new WebRecordError('web_text_too_long');
  const record: Rec = {
    ...orig,
    text,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    extraction: WEB_EXTRACTION,
    text_engine: WEB_TEXT_ENGINE,
    page_split: 'none',
    pages: [],
  };
  delete record.page_count;
  return { record, controlCodesRemoved, identity };
}

// ---- the database (corpus_ingest, through psql) ----

export type EnqueueResult = Array<{ source_key: string | null; outcome: 'queued' | 'refused'; reason?: string }>;

export interface WebDb {
  session(): Promise<void>;
  enqueue(items: EnqueueItem[]): Promise<EnqueueResult>;
  read(keys: string[]): Promise<WebRow[]>;
  status(): Promise<unknown>;
}

const ROLE = 'corpus_ingest';
const SESSION = { lock_timeout_ms: 5_000, statement_timeout_ms: 60_000 };
const CLIENT_MARGIN_MS = 30_000;
const jsonLit = (v: unknown) => `${dollarQuote(JSON.stringify(v))}::jsonb`;

export class PsqlWebDb implements WebDb {
  constructor(private readonly exec: PsqlExec) {}

  private async call(body: string): Promise<string> {
    const script = [
      '\\set ON_ERROR_STOP on',
      `set lock_timeout = '${SESSION.lock_timeout_ms}ms';`,
      `set statement_timeout = '${SESSION.statement_timeout_ms}ms';`,
      body,
      '',
    ].join('\n');
    const r = await this.exec(script, SESSION.statement_timeout_ms + CLIENT_MARGIN_MS);
    if (r.timedOut) throw new Error('psql gave no answer within the client limit');
    if (r.code !== 0) throw new Error(`psql exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`);
    return r.stdout;
  }

  private async answer<T>(body: string): Promise<T> {
    const out = (await this.call(body)).trim();
    if (!out) throw new Error('psql returned an empty answer');
    return JSON.parse(out) as T;
  }

  async session(): Promise<void> {
    const who = (await this.call('select current_user;')).trim();
    if (who !== ROLE) throw new Error(`the runner connects only as ${ROLE}; this login is ${who || 'unknown'}`);
  }

  async enqueue(items: EnqueueItem[]): Promise<EnqueueResult> {
    const got = await this.answer<{ results: EnqueueResult }>(
      `select public.web_text_enqueue(${jsonLit(items)})::text;`,
    );
    return got.results;
  }

  async read(keys: string[]): Promise<WebRow[]> {
    // A key set with no row reads as SQL null; it is no rows.
    return await this.answer<WebRow[] | null>(
      `select coalesce(public.web_text_read(array(select jsonb_array_elements_text(${
        jsonLit(keys)
      }))), '[]'::jsonb)::text;`,
    ) ?? [];
  }

  async status(): Promise<unknown> {
    return await this.answer<unknown>('select public.web_text_status()::text;');
  }
}

// ---- the commands ----

export interface WebCliDeps {
  readText: (path: string) => Promise<string>;
  readBytes: (path: string) => Promise<Uint8Array>;
  writeText: (path: string, body: string) => Promise<void>;
  makeDir: (dir: string) => Promise<void>;
  commonDir?: () => Promise<string | null>;
  webDb?: (psql: string) => WebDb;
  log: (line: string) => void;
  now: () => number;
}

export type WebCommand =
  | {
    cmd: 'web-enqueue';
    records: string;
    holds: string;
    limit: number;
    offset: number;
    budgetUsd: number;
    dryRun: boolean;
    psql: string;
  }
  | {
    cmd: 'web-collect';
    records: string;
    holds: string;
    limit: number;
    offset: number;
    out: string;
    minIdentity: number;
    psql: string;
  };

const USAGE = 'usage: cli.ts web-enqueue|web-collect --records <file> --holds <file> [--limit <n>] [--offset <n>] ' +
  '[--budget-usd <n>] [--dry-run] [--out <dir>] [--min-identity <0..1>] [--psql <path>] ' +
  '(see scripts/bulk-runner/web_route.ts)';

export function parseWebArgs(argv: string[]): WebCommand {
  const [cmd, ...rest] = argv;
  if (cmd !== 'web-enqueue' && cmd !== 'web-collect') throw new Error(USAGE);
  const flags = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (k === '--dry-run') {
      if (dryRun) throw new Error('--dry-run given twice');
      dryRun = true;
      continue;
    }
    const v = rest[i + 1];
    if (!k?.startsWith('--') || v === undefined || v.startsWith('--')) throw new Error(`bad argument ${k}. ${USAGE}`);
    if (flags.has(k)) throw new Error(`${k} given twice`);
    flags.set(k, v);
    i++;
  }
  const allowed = cmd === 'web-enqueue'
    ? ['--records', '--holds', '--limit', '--offset', '--budget-usd', '--psql']
    : ['--records', '--holds', '--limit', '--offset', '--out', '--min-identity', '--psql'];
  for (const k of flags.keys()) if (!allowed.includes(k)) throw new Error(`unknown option ${k} for ${cmd}`);
  if (dryRun && cmd !== 'web-enqueue') throw new Error(`unknown option --dry-run for ${cmd}`);
  const need = (k: string) => {
    const v = flags.get(k);
    if (!v) throw new Error(`${k} is required. ${USAGE}`);
    return v;
  };
  const int = (k: string, dflt: number) => {
    const v = flags.get(k);
    if (v === undefined) return dflt;
    if (!/^\d{1,6}$/.test(v)) throw new Error(`${k} must be a whole number`);
    return Number(v);
  };
  const common = {
    records: need('--records'),
    holds: need('--holds'),
    limit: int('--limit', MAX_SELECTION),
    offset: int('--offset', 0),
    psql: flags.get('--psql') ?? 'psql',
  };
  if (cmd === 'web-enqueue') {
    const b = flags.get('--budget-usd');
    if (b !== undefined && !/^\d+(\.\d+)?$/.test(b)) throw new Error('--budget-usd must be a number');
    return { cmd, ...common, budgetUsd: b === undefined ? DEFAULT_BUDGET_USD : Number(b), dryRun };
  }
  const m = flags.get('--min-identity');
  if (m !== undefined && (!/^(0(\.\d+)?|1(\.0+)?)$/.test(m))) throw new Error('--min-identity must be 0 to 1');
  return { cmd, ...common, out: need('--out'), minIdentity: m === undefined ? DEFAULT_MIN_IDENTITY : Number(m) };
}

async function selection(c: WebCommand, deps: WebCliDeps, records: Rec[], budgetUsd: number): Promise<WebPlan> {
  const holds = readHolds(await deps.readText(c.holds));
  return planWeb(records, holds, { limit: c.limit, offset: c.offset, budgetUsd });
}

const tallyLine = (t: Record<string, number>) =>
  Object.entries(t).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${n} ${k}`).join(', ');

function describe(plan: WebPlan): string[] {
  const c = plan.counts;
  const lines = [
    `${c.records} records, ${c.eligible} html records held only for text reasons, ${c.other_holds} other holds`,
    `selected ${c.selected}: scrape estimate US$${plan.estimate_usd.toFixed(3)}`,
  ];
  if (Object.keys(plan.refused).length) lines.push(`refused: ${tallyLine(plan.refused)}`);
  return lines;
}

async function enqueueCommand(c: Extract<WebCommand, { cmd: 'web-enqueue' }>, deps: WebCliDeps): Promise<number> {
  const plan = await selection(c, deps, readRecords(await deps.readText(c.records)), c.budgetUsd);
  for (const l of describe(plan)) deps.log(l);
  if (!plan.ok) return 1;
  if (c.dryRun) {
    deps.log('dry run: nothing queued');
    return 0;
  }
  if (!deps.webDb) throw new Error('no database connection is available');
  const db = deps.webDb(c.psql);
  await db.session();
  const results = await db.enqueue(plan.items);
  const queued = results.filter((r) => r.outcome === 'queued').length;
  const reasons: Record<string, number> = {};
  for (const r of results) {
    if (r.outcome === 'refused') reasons[r.reason ?? 'unknown'] = (reasons[r.reason ?? 'unknown'] ?? 0) + 1;
  }
  deps.log(
    `queued ${queued} of ${plan.items.length}${Object.keys(reasons).length ? `; refused: ${tallyLine(reasons)}` : ''}`,
  );
  deps.log(`queue: ${JSON.stringify(await db.status())}`);
  return queued === plan.items.length || Object.keys(reasons).every((k) => k === 'duplicate') ? 0 : 1;
}

const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function collectCommand(c: Extract<WebCommand, { cmd: 'web-collect' }>, deps: WebCliDeps): Promise<number> {
  const out = await refuseInCheckout(c.out, '--out', {
    repoRoot: REPO_ROOT,
    commonDir: deps.commonDir ?? gitCommonDir,
  });
  if (!deps.webDb) throw new Error('no database connection is available');
  // The records file must be the reader's, as its receipt says: the text is replaced inside the pack's own records.
  const recordsBytes = await deps.readBytes(c.records);
  let receipt: Rec;
  try {
    const r = JSON.parse(await deps.readText(`${c.records}.receipt.json`));
    if (!isRec(r)) throw new Error('not an object');
    receipt = r;
  } catch {
    throw new Error(
      `${c.records}.receipt.json is missing or unreadable; the records must be the reader's output with its receipt`,
    );
  }
  if (receipt.output_sha256 !== hex(recordsBytes)) {
    throw new Error("the records file's sha256 is not the receipt's output_sha256; it is not the reader's output");
  }
  const records = readRecords(new TextDecoder('utf-8', { fatal: true }).decode(recordsBytes));
  const plan = await selection(c, deps, records, Number.MAX_SAFE_INTEGER);
  for (const l of describe(plan)) deps.log(l);
  if (!plan.ok) return 1;
  const byKey = new Map(records.map((r) => [String(r.source_key), r]));
  const db = deps.webDb(c.psql);
  await db.session();
  const rows: WebRow[] = [];
  const keys = plan.items.map((i) => i.source_key);
  for (let i = 0; i < keys.length; i += 10) rows.push(...await db.read(keys.slice(i, i + 10)));
  const rowOf = new Map<string, WebRow>();
  for (const r of rows) if (isRec(r) && typeof r.source_key === 'string') rowOf.set(r.source_key, r);
  const built: Rec[] = [];
  const tally = { done: 0, pending: 0, failed: 0, not_queued: 0, not_built: 0 };
  const failed: Record<string, number> = {}, notBuilt: Record<string, number> = {};
  const notBuiltKeys: Record<string, string[]> = {}, failedKeys: Record<string, string[]> = {};
  const identity: Record<string, number> = Object.fromEntries(IDENTITY_BUCKETS.map((b) => [b, 0]));
  let controlCodesRemoved = 0, credits = 0, costUsd = 0;
  const add = (m: Record<string, number>, keysOf: Record<string, string[]>, code: string, key: string) => {
    m[code] = (m[code] ?? 0) + 1;
    (keysOf[code] ??= []).push(key);
  };
  for (const item of plan.items) {
    const row = rowOf.get(item.source_key);
    if (!row) {
      tally.not_queued++;
      continue;
    }
    // Money is counted for every finished row, done or failed: a failed scrape may still have been billed.
    credits += typeof row.credits === 'number' && Number.isFinite(row.credits) ? row.credits : 0;
    costUsd += typeof row.cost_usd === 'number' && Number.isFinite(row.cost_usd) ? row.cost_usd : 0;
    if (row.status === 'queued' || row.status === 'running') tally.pending++;
    else if (row.status === 'failed') {
      tally.failed++;
      add(failed, failedKeys, typeof row.error_code === 'string' ? row.error_code : 'unknown', item.source_key);
    } else {
      try {
        const b = await buildWebRecord(byKey.get(item.source_key)!, row, c.minIdentity);
        built.push(b.record);
        identity[identityBucket(b.identity)]++;
        controlCodesRemoved += b.controlCodesRemoved;
        tally.done++;
      } catch (e) {
        tally.not_built++;
        const code = e instanceof WebRecordError ? e.code : 'error';
        add(notBuilt, notBuiltKeys, code, item.source_key);
        // An unbound or too long text still has an identity share; it is counted in the distribution too.
        if (code === 'web_text_unbound' || code === 'web_text_too_long') {
          const orig = byKey.get(item.source_key)!;
          identity[identityBucket(identityShare(String(orig.text), normaliseMarkdown(String(row.text)).text))]++;
        }
      }
    }
  }
  const complete = tally.pending === 0 && tally.not_queued === 0;
  deps.log(
    `done ${tally.done}, pending ${tally.pending}, failed ${tally.failed}, not queued ${tally.not_queued}, not built ${tally.not_built}`,
  );
  if (Object.keys(failed).length) deps.log(`failed by code: ${tallyLine(failed)}`);
  if (Object.keys(notBuilt).length) deps.log(`not built by code: ${tallyLine(notBuilt)}`);
  deps.log(
    `identity (share of the pack text's 5-grams in the new text, threshold ${c.minIdentity}; ` +
      `at most ${MAX_WORD_RATIO}x its words): ${tallyLine(identity)}`,
  );
  if (!built.length) {
    deps.log('nothing to write');
    return 1;
  }
  built.sort((a, b) => String(a.source_key).localeCompare(String(b.source_key)));
  const body = built.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const bytes = utf8.encode(body);
  await deps.makeDir(out);
  const recordsPath = join(out, OUT_RECORDS);
  await deps.writeText(recordsPath, body);
  const derived = {
    ...receipt,
    entry: `${String(receipt.entry)}+web-f369`,
    lines_read: built.length,
    lines_written: built.length,
    output_bytes: bytes.length,
    output_sha256: hex(bytes),
    limit: null,
    derived_from: {
      output_sha256: receipt.output_sha256,
      hold_reasons: [...TEXT_REASONS],
      limit: c.limit,
      offset: c.offset,
    },
    web: {
      extraction: WEB_EXTRACTION,
      text_engine: WEB_TEXT_ENGINE,
      request_options: REQUEST_OPTIONS,
      request_options_sha256: createHash('sha256').update(canonical(REQUEST_OPTIONS)).digest('hex'),
      selected: plan.items.length,
      outcomes: tally,
      failed_by_code: failed,
      not_built_by_code: notBuilt,
      // Source keys only (40 hex): never a URL or text.
      failed_keys: failedKeys,
      not_built_keys: notBuiltKeys,
      credits,
      cost_usd: Number(costUsd.toFixed(6)),
      identity: { threshold: c.minIdentity, distribution: identity },
      control_codes_removed: controlCodesRemoved,
      complete,
    },
    started_at: new Date(deps.now()).toISOString(),
    finished_at: new Date(deps.now()).toISOString(),
  };
  await deps.writeText(`${recordsPath}.receipt.json`, JSON.stringify(derived, null, 2) + '\n');
  deps.log(`wrote ${built.length} records (${credits} credits, US$${costUsd.toFixed(3)} counted)`);
  return complete ? 0 : 1;
}

/** Runs web-enqueue or web-collect; returns the process exit code. */
export async function webCommand(argv: string[], deps: WebCliDeps): Promise<number> {
  const c = parseWebArgs(argv);
  return c.cmd === 'web-enqueue' ? await enqueueCommand(c, deps) : await collectCommand(c, deps);
}
