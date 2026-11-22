// OCR text route for held Budget records (F391, docs/specs/2026-11-21-budget-ocr-text.md). Two commands of the runner:
//
//   cli.ts ocr-enqueue --records <records.jsonl> --holds <holds.jsonl> [--reason control_codes_excess] [--limit N]
//                      [--offset N] [--budget-usd N] [--dry-run] [--psql <path>]
//   cli.ts ocr-collect --records <records.jsonl> --holds <holds.jsonl> [--reason ...] [--limit N] [--offset N]
//                      --out <dir outside every checkout> [--psql <path>]
//
// `ocr-enqueue` reads the screen's records and holds, picks the records held only for one reason (control codes in the
// pack's text), checks each against the Budget desk's official hosts and the limits, and queues them in the database
// (public.budget_ocr_enqueue, as corpus_ingest). The `budget-ocr` Edge function, on Supabase, gives Mistral each official
// URL and stores the page text; no PDF, OCR key or model key is ever on this machine, and no PDF is stored or served.
// `ocr-collect` reads the finished text back (public.budget_ocr_read) and writes a records file in the pack's record format
// (the original record with the OCR text, its spans and hashes, extraction `ocr_mistral`) with a receipt, which the normal `screen`
// and `run` commands then take, so the screen, the batch policy and the spend stops all apply. Neither command prints a
// URL or any document text: only counts, reasons and source keys.
import { createHash } from 'node:crypto';
import { join } from 'jsr:@std/path@1';
import { ocrCostUsd } from '../../supabase/functions/ingest-worker/mistral.ts';
import { OCR_MODEL } from '../../supabase/functions/ingest-worker/types.ts';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import BUDGET from './screens/budget.json' with { type: 'json' };
import { gitCommonDir, refuseInCheckout, REPO_ROOT } from './pack.ts';
import { dollarQuote, type PsqlExec } from './psql_db.ts';

type Rec = Record<string, unknown>;

export const DEFAULT_REASON = 'control_codes_excess';
/** The most records one command takes: the first batch is attended, and the queue's own call takes at most 50. */
export const MAX_SELECTION = 50;
export const DEFAULT_BUDGET_USD = 2;
const MAX_PAGES = 1000;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** The text type of text OCRed by Mistral from the official PDF: not the pack's own `ocr` (tesseract), which the desk still holds. */
export const OCR_EXTRACTION = 'ocr_mistral';
export const OCR_TEXT_ENGINE = OCR_MODEL;
const OUT_RECORDS = 'ocr-records.jsonl';

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- the plan ----

export interface HoldLine {
  source_key: string;
  reasons: string[];
}

export interface SelectOptions {
  reason: string;
  limit: number;
  offset: number;
  budgetUsd: number;
  /** The hosts a file link may name, exactly: the Budget desk's own list. */
  hosts: string[];
}

export interface EnqueueItem {
  source_key: string;
  official_url: string;
  expected_pages: number;
  pack_sha256: string;
}

export interface Refusal {
  source_key: string;
  reason: string;
}

export interface OcrPlan {
  ok: boolean;
  items: EnqueueItem[];
  refused: Refusal[];
  counts: { records: number; eligible: number; other_holds: number; selected: number; pages: number };
  ocr_usd: number;
}

/** The screen's holds.jsonl reduced to the key and the reasons: the findings (which carry detail) are not read. */
export function readHolds(text: string): HoldLine[] {
  const out: HoldLine[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let h: unknown;
    try {
      h = JSON.parse(line);
    } catch {
      throw new Error('a holds line is not JSON');
    }
    if (
      !isRec(h) || typeof h.source_key !== 'string' || !Array.isArray(h.reasons) ||
      !h.reasons.every((x) => typeof x === 'string')
    ) {
      throw new Error('a holds line has no source_key or reasons');
    }
    out.push({ source_key: h.source_key, reasons: h.reasons as string[] });
  }
  return out;
}

export function readRecords(text: string): Rec[] {
  const out: Rec[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      throw new Error(`records line ${i + 1} is not JSON`);
    }
    if (!isRec(r)) throw new Error(`records line ${i + 1} is not an object`);
    out.push(r);
  });
  return out;
}

export function selectionError(o: Pick<SelectOptions, 'limit' | 'offset' | 'budgetUsd'>): string | null {
  if (!Number.isInteger(o.limit) || o.limit < 1 || o.limit > MAX_SELECTION) {
    return `limit must be 1 to ${MAX_SELECTION}`;
  }
  if (!Number.isInteger(o.offset) || o.offset < 0) return 'offset must be 0 or more';
  if (!Number.isFinite(o.budgetUsd) || o.budgetUsd <= 0) return 'budget must be more than 0';
  return null;
}

/**
 * The link itself when it is plain https on one of the hosts (no credentials, no port, no query), a lower-case .pdf path (as
 * the database checks), and already in the URL parser's own form; else null. A link the parser would rewrite (a space, a
 * non-ASCII character, an upper-case host, a dot segment) would be queued rewritten, paid for, and then refused at collect
 * as a url_mismatch against the pack's link, so it is not queued at all.
 */
function officialHref(u: unknown, hosts: string[]): string | null {
  if (typeof u !== 'string') return null;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
  if (!hosts.includes(url.hostname) || !/\.pdf$/.test(url.pathname)) return null;
  return url.href === u ? u : null;
}

const positive = (n: unknown, max: number): n is number =>
  Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;

/** Which records go to the queue, and why a plan is refused. Nothing is read from the network or the database. */
export function planOcr(records: Rec[], holds: HoldLine[], o: SelectOptions): OcrPlan {
  const bad = selectionError(o);
  if (bad) throw new Error(bad);
  const byKey = new Map(records.map((r) => [String(r.source_key), r]));
  const eligibleKeys = [
    ...new Set(holds.filter((h) => h.reasons.length === 1 && h.reasons[0] === o.reason).map((h) => h.source_key)),
  ].sort();
  const counts = {
    records: records.length,
    eligible: eligibleKeys.length,
    other_holds: holds.length - eligibleKeys.length,
    selected: 0,
    pages: 0,
  };
  const refused: Refusal[] = [];
  const items: EnqueueItem[] = [];
  const chosen = eligibleKeys.slice(o.offset, o.offset + o.limit);
  const fail = (): OcrPlan => ({ ok: false, items: [], refused, counts, ocr_usd: ocrCostUsd(counts.pages) });
  if (!chosen.length) {
    refused.push({ source_key: '', reason: 'nothing_selected' });
    return fail();
  }
  for (const k of chosen) {
    const r = byKey.get(k);
    const href = r ? officialHref(r.file_url, o.hosts) : null;
    if (!r) refused.push({ source_key: k, reason: 'record_missing' });
    else if (!HEX40.test(k)) refused.push({ source_key: k, reason: 'record_shape' });
    else if (!href) refused.push({ source_key: k, reason: 'file_url' });
    else if (!positive(r.page_count, MAX_PAGES)) refused.push({ source_key: k, reason: 'page_count' });
    else if (typeof r.content_sha256 !== 'string' || !HEX64.test(r.content_sha256)) {
      refused.push({ source_key: k, reason: 'content_sha256' });
    } else {
      items.push({ source_key: k, official_url: href, expected_pages: r.page_count, pack_sha256: r.content_sha256 });
      counts.pages += r.page_count;
    }
  }
  counts.selected = items.length;
  if (refused.length) return fail();
  const ocr_usd = ocrCostUsd(counts.pages);
  if (ocr_usd > o.budgetUsd) {
    refused.push({ source_key: '', reason: 'over_budget' });
    return fail();
  }
  return { ok: true, items, refused, counts, ocr_usd };
}

// ---- the record built from the OCR text ----

// Control codes other than tab, line feed and carriage return are not text; a page break inside a page would break the spans.
// deno-lint-ignore no-control-regex
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export interface QueueRow {
  source_key: string;
  official_url: string;
  expected_pages: number;
  pack_sha256: string;
  status: string;
  pages: number | null;
  cost_usd: number | null;
  error_code: string | null;
  attempts: number;
  page_texts: string[] | null;
}

export class OcrRecordError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OcrRecordError';
  }
}

/**
 * The original record with its text replaced by the OCR text: one page per queued page text, joined by form feeds, with the
 * spans, the hash and the counts the pack's record format has. Every other field is the pack's own. The row must be this
 * record's own request (its link, its page count and the pack's text hash), or nothing is built.
 */
export async function buildOcrRecord(orig: Rec, row: QueueRow): Promise<{ record: Rec; controlCodesRemoved: number }> {
  if (row.source_key !== orig.source_key) throw new OcrRecordError('row_key_mismatch');
  if (row.status !== 'done' || !Array.isArray(row.page_texts)) throw new OcrRecordError('not_done');
  if (row.pack_sha256 !== orig.content_sha256) throw new OcrRecordError('pack_hash_mismatch');
  if (row.official_url !== orig.file_url) throw new OcrRecordError('url_mismatch');
  if (
    !positive(orig.page_count, MAX_PAGES) || row.expected_pages !== orig.page_count ||
    row.page_texts.length !== orig.page_count
  ) {
    throw new OcrRecordError('page_count_mismatch');
  }
  let removed = 0;
  const texts = row.page_texts.map((t) => {
    if (typeof t !== 'string') throw new OcrRecordError('page_text_not_string');
    return t.replace(CONTROL, () => (removed++, ''));
  });
  const text = texts.join('\f');
  let at = 0;
  const pages = texts.map((t, i) => {
    const n = [...t].length;
    const span = { page_number: i + 1, char_from: at, char_to: at + n, text: t };
    at += n + 1;
    return span;
  });
  const record: Rec = {
    ...orig,
    text,
    pages,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: texts.length,
    page_split: 'exact',
    pages_with_text: texts.filter((t) => /\S/u.test(t)).length,
    extraction: OCR_EXTRACTION,
    text_engine: OCR_TEXT_ENGINE,
    ocr_quality: null,
  };
  return { record, controlCodesRemoved: removed };
}

// ---- the database (corpus_ingest, through psql) ----

export type EnqueueResult = Array<{ source_key: string | null; outcome: 'queued' | 'refused'; reason?: string }>;

export interface OcrDb {
  session(): Promise<void>;
  enqueue(items: EnqueueItem[]): Promise<EnqueueResult>;
  read(keys: string[]): Promise<QueueRow[]>;
  status(): Promise<unknown>;
}

const ROLE = 'corpus_ingest';
const SESSION = { lock_timeout_ms: 5_000, statement_timeout_ms: 60_000 };
const CLIENT_MARGIN_MS = 30_000;
const jsonLit = (v: unknown) => `${dollarQuote(JSON.stringify(v))}::jsonb`;

export class PsqlOcrDb implements OcrDb {
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
      `select public.budget_ocr_enqueue(${jsonLit(items)})::text;`,
    );
    return got.results;
  }

  async read(keys: string[]): Promise<QueueRow[]> {
    return await this.answer<QueueRow[]>(
      `select public.budget_ocr_read(array(select jsonb_array_elements_text(${jsonLit(keys)})))::text;`,
    );
  }

  async status(): Promise<unknown> {
    return await this.answer<unknown>('select public.budget_ocr_status()::text;');
  }
}

// ---- the commands ----

export interface OcrCliDeps {
  readText: (path: string) => Promise<string>;
  readBytes: (path: string) => Promise<Uint8Array>;
  writeText: (path: string, body: string) => Promise<void>;
  makeDir: (dir: string) => Promise<void>;
  commonDir?: () => Promise<string | null>;
  ocrDb?: (psql: string) => OcrDb;
  log: (line: string) => void;
  now: () => number;
}

export type OcrCommand =
  | {
    cmd: 'ocr-enqueue';
    records: string;
    holds: string;
    reason: string;
    limit: number;
    offset: number;
    budgetUsd: number;
    dryRun: boolean;
    psql: string;
  }
  | {
    cmd: 'ocr-collect';
    records: string;
    holds: string;
    reason: string;
    limit: number;
    offset: number;
    out: string;
    psql: string;
  };

const USAGE = 'usage: cli.ts ocr-enqueue|ocr-collect --records <file> --holds <file> [--reason <r>] [--limit <n>] ' +
  '[--offset <n>] [--budget-usd <n>] [--dry-run] [--out <dir>] [--psql <path>] (see scripts/bulk-runner/ocr_route.ts)';

export function parseOcrArgs(argv: string[]): OcrCommand {
  const [cmd, ...rest] = argv;
  if (cmd !== 'ocr-enqueue' && cmd !== 'ocr-collect') throw new Error(USAGE);
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
  const allowed = cmd === 'ocr-enqueue'
    ? ['--records', '--holds', '--reason', '--limit', '--offset', '--budget-usd', '--psql']
    : ['--records', '--holds', '--reason', '--limit', '--offset', '--out', '--psql'];
  for (const k of flags.keys()) if (!allowed.includes(k)) throw new Error(`unknown option ${k} for ${cmd}`);
  if (dryRun && cmd !== 'ocr-enqueue') throw new Error(`unknown option --dry-run for ${cmd}`);
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
    reason: flags.get('--reason') ?? DEFAULT_REASON,
    limit: int('--limit', MAX_SELECTION),
    offset: int('--offset', 0),
    psql: flags.get('--psql') ?? 'psql',
  };
  if (!/^[a-z0-9_]{1,64}$/.test(common.reason)) throw new Error('bad --reason');
  if (cmd === 'ocr-enqueue') {
    const b = flags.get('--budget-usd');
    const budgetUsd = b === undefined ? DEFAULT_BUDGET_USD : Number(b);
    if (b !== undefined && !/^\d+(\.\d+)?$/.test(b)) throw new Error('--budget-usd must be a number');
    return { cmd, ...common, budgetUsd, dryRun };
  }
  return { cmd, ...common, out: need('--out') };
}

const BUDGET_HOSTS: string[] = BUDGET.url_hosts;

async function selection(
  c: OcrCommand,
  deps: OcrCliDeps,
  budgetUsd: number,
): Promise<{ records: Rec[]; plan: OcrPlan }> {
  const records = readRecords(await deps.readText(c.records));
  const holds = readHolds(await deps.readText(c.holds));
  const plan = planOcr(records, holds, {
    reason: c.reason,
    limit: c.limit,
    offset: c.offset,
    budgetUsd,
    hosts: BUDGET_HOSTS,
  });
  return { records, plan };
}

function describe(plan: OcrPlan, reason: string): string[] {
  const c = plan.counts;
  const lines = [
    `${c.records} records, ${c.eligible} held only for ${reason}, ${c.other_holds} other holds`,
    `selected ${c.selected}: ${c.pages} pages, OCR estimate US$${plan.ocr_usd.toFixed(3)}`,
  ];
  for (const r of plan.refused) lines.push(`  refused ${r.source_key || '(plan)'}: ${r.reason}`);
  return lines;
}

async function enqueueCommand(c: Extract<OcrCommand, { cmd: 'ocr-enqueue' }>, deps: OcrCliDeps): Promise<number> {
  const { plan } = await selection(c, deps, c.budgetUsd);
  for (const l of describe(plan, c.reason)) deps.log(l);
  if (!plan.ok) return 1;
  if (c.dryRun) {
    deps.log('dry run: nothing queued');
    return 0;
  }
  if (!deps.ocrDb) throw new Error('no database connection is available');
  const db = deps.ocrDb(c.psql);
  await db.session();
  const results = await db.enqueue(plan.items);
  const queued = results.filter((r) => r.outcome === 'queued').length;
  const reasons = new Map<string, number>();
  for (const r of results) {
    if (r.outcome === 'refused') reasons.set(r.reason ?? 'unknown', (reasons.get(r.reason ?? 'unknown') ?? 0) + 1);
  }
  deps.log(`queued ${queued} of ${plan.items.length}${[...reasons].map(([k, n]) => `; ${n} refused: ${k}`).join('')}`);
  deps.log(`queue: ${JSON.stringify(await db.status())}`);
  return queued === plan.items.length || [...reasons.keys()].every((k) => k === 'duplicate') ? 0 : 1;
}

function hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function collectCommand(c: Extract<OcrCommand, { cmd: 'ocr-collect' }>, deps: OcrCliDeps): Promise<number> {
  const out = await refuseInCheckout(c.out, '--out', {
    repoRoot: REPO_ROOT,
    commonDir: deps.commonDir ?? gitCommonDir,
  });
  if (!deps.ocrDb) throw new Error('no database connection is available');
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
  const holds = readHolds(await deps.readText(c.holds));
  const plan = planOcr(records, holds, {
    reason: c.reason,
    limit: c.limit,
    offset: c.offset,
    budgetUsd: Number.MAX_SAFE_INTEGER,
    hosts: BUDGET_HOSTS,
  });
  for (const l of describe(plan, c.reason)) deps.log(l);
  if (!plan.ok) return 1;
  const byKey = new Map(records.map((r) => [String(r.source_key), r]));
  const db = deps.ocrDb(c.psql);
  await db.session();
  const rows: QueueRow[] = [];
  const keys = plan.items.map((i) => i.source_key);
  for (let i = 0; i < keys.length; i += 10) rows.push(...await db.read(keys.slice(i, i + 10)));
  const rowOf = new Map(rows.map((r) => [r.source_key, r]));
  const built: Rec[] = [];
  const tally = { done: 0, pending: 0, failed: 0, not_queued: 0, not_built: 0 };
  let controlCodesRemoved = 0, pages = 0, costUsd = 0;
  const problems: string[] = [];
  for (const item of plan.items) {
    const row = rowOf.get(item.source_key);
    if (!row) tally.not_queued++;
    else if (row.status === 'queued' || row.status === 'running') tally.pending++;
    else if (row.status === 'failed') {
      tally.failed++;
      problems.push(`${item.source_key} failed: ${row.error_code ?? 'unknown'}`);
    } else {
      try {
        const b = await buildOcrRecord(byKey.get(item.source_key)!, row);
        built.push(b.record);
        controlCodesRemoved += b.controlCodesRemoved;
        pages += row.pages ?? 0;
        costUsd += row.cost_usd ?? 0;
        tally.done++;
      } catch (e) {
        tally.not_built++;
        problems.push(`${item.source_key} not built: ${e instanceof OcrRecordError ? e.code : 'error'}`);
      }
    }
  }
  deps.log(
    `done ${tally.done}, pending ${tally.pending}, failed ${tally.failed}, not queued ${tally.not_queued}, not built ${tally.not_built}`,
  );
  for (const p of problems) deps.log(`  ${p}`);
  if (!built.length) {
    deps.log('nothing to write');
    return 1;
  }
  built.sort((a, b) => String(a.source_key).localeCompare(String(b.source_key)));
  const body = built.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const bytes = new TextEncoder().encode(body);
  await deps.makeDir(out);
  const recordsPath = join(out, OUT_RECORDS);
  await deps.writeText(recordsPath, body);
  const derived = {
    ...receipt,
    entry: `${String(receipt.entry)}+ocr-f391`,
    lines_read: built.length,
    lines_written: built.length,
    output_bytes: bytes.length,
    output_sha256: hex(bytes),
    limit: null,
    derived_from: { output_sha256: receipt.output_sha256, hold_reason: c.reason },
    ocr: {
      model: OCR_MODEL,
      records: built.length,
      pages,
      cost_usd: Number(costUsd.toFixed(6)),
      control_codes_removed: controlCodesRemoved,
      complete: tally.done === plan.items.length,
    },
    started_at: new Date(deps.now()).toISOString(),
    finished_at: new Date(deps.now()).toISOString(),
  };
  await deps.writeText(`${recordsPath}.receipt.json`, JSON.stringify(derived, null, 2) + '\n');
  deps.log(`wrote ${built.length} records (${pages} pages, US$${costUsd.toFixed(3)} spent) to ${recordsPath}`);
  return tally.done === plan.items.length ? 0 : 1;
}

/** Runs ocr-enqueue or ocr-collect; returns the process exit code. */
export async function ocrCommand(argv: string[], deps: OcrCliDeps): Promise<number> {
  const c = parseOcrArgs(argv);
  return c.cmd === 'ocr-enqueue' ? await enqueueCommand(c, deps) : await collectCommand(c, deps);
}
