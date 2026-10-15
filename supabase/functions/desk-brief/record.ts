// desk-brief scope 'record' (open-work F123; owner decisions 2026-10-15): one short, stored,
// platform-paid brief per desk record, written the first time anyone opens its panel and read
// by every later viewer. Framework-free like handler.ts: the store, the provider and the clock
// are injected, so the whole flow runs under `deno test`.
//
// The server, not the browser, decides which record a brief belongs to: the module must be one
// the desks show (deskModules.json), the row key is deskRowKey(row) and the content hash the v7 entry
// fingerprint. Where the briefed content comes from decides how the brief is shared:
//
//   * source 'desk_rows': desk_rows holds the record, and that stored copy, never the browser's
//     row, is hashed and briefed. Its brief is the key's one shared brief (regenerated at most
//     once a day when the copy changes). desk_rows is a snapshot, so the brief describes the
//     snapshot's copy, which can lag the live row the panel shows.
//   * source 'client': desk_rows does not hold the record (live rows, or a module not in the
//     snapshot), so the browser's row is briefed. Nothing proves it genuine, so its brief is
//     content-addressed: stored under its content hash and served only to a request whose row
//     hashes the same. A forged row with a real id gets a brief only an identical forgery reads;
//     it never reaches an honest viewer and never replaces or stands in for a desk_rows brief.
//
// public.record_brief_claim (migration 20261015220000, format-aware since 20261015240000) decides,
// in one statement, whether this caller generates; it also applies the kill switch and the limits,
// which count generations only.
//
// Format (owner decision 2026-10-15): the brief takes the shape of the blue "Niyantran analysis" box,
// {brief, why, watch, tags} (RECORD_BRIEF_FORMAT 2). record_briefs keeps the lead brief in headline
// and {why, watch, tags} in points. A brief stored in the earlier shape (format 1: a headline and
// three points) is still served, labelled format 1, and the claim regenerates it once on its next
// open, because the claim is asked for format 2. The global limit (5,000 a day) can be used up by about 25 accounts at their daily limit;
// stored briefs are still served after that, new ones wait for the next UTC day.

import { HttpError } from '../_shared/http.ts';
import { normaliseName } from '../_shared/deskCatalog.ts';
import deskModules from '../_shared/deskModules.json' with { type: 'json' };
import { deskRowKey } from '../_shared/deskRows.ts';
import { entryFingerprint } from '../_shared/entryFingerprint.ts';

/**
 * The default when RECORD_BRIEF_MODEL is unset, chosen by the 20-record measurement
 * (docs/research/2026-10-15-record-brief-measurement.md): no invented fact in 20 briefs, at
 * about $0.00016 a brief. google/gemini-2.5-flash-lite is half the price and switchable by the
 * secret alone.
 */
export const DEFAULT_RECORD_BRIEF_MODEL = 'anthropic/claude-haiku-5.5';
/**
 * The stored brief's shape: 1 was {headline, points[3]}, 2 is {brief, why, watch, tags}. A stored
 * brief of an older format is regenerated once on its next open (record_brief_claim, p_format).
 * Bump it when the prompt or the shape changes enough that stored briefs should be rewritten.
 */
export const RECORD_BRIEF_FORMAT = 2;
/** The four parts total at most 150 words and four tags (about 250 tokens): room without a cut-off. */
export const RECORD_MAX_TOKENS = 450;
export const RECORD_TEMPERATURE = 0.2;
/** Well inside the claim's 90-second staleness window. */
export const RECORD_PROVIDER_TIMEOUT_MS = 30_000;
/**
 * Generations (never reads) per user per minute and per UTC day, and for everyone per UTC day.
 * 25 accounts at 200 a day use up the global 5,000; after that no new brief is written until the
 * next UTC day, while every stored brief is still served.
 */
export const RECORD_LIMITS = Object.freeze({ userPerMinute: 10, userPerDay: 200, globalPerDay: 5_000 });

/** Each of brief, why and watch; record_brief_finish re-checks these in SQL. */
const MAX_PART = 600;
const MAX_TAGS = 4;
const MAX_TAG = 40;
const MAX_CELL = 220;
const MAX_FIELDS = 40;
/** A field name is cut to this, and the field list to MAX_FIELDS_TEXT (security re-review 2026-10-15). */
const MAX_KEY = 64;
const MAX_FIELDS_TEXT = 6000;

/** Desk tab ids, as desk_rows and the catalogue use them, from either naming the browser sends. */
const TIER_ALIAS: Record<string, string> = {
  global: 'global',
  geopolitics: 'global',
  national: 'national',
  state: 'state',
  local: 'state',
  law: 'law',
  judiciary: 'law',
  economics: 'economics',
  finance: 'economics',
  carbon: 'carbon',
  climate: 'carbon',
  sports: 'sports',
  entertainment: 'entertainment',
};

const TIER_LABEL: Record<string, string> = {
  global: 'Global',
  national: 'National',
  state: 'State',
  law: 'Law',
  economics: 'Economics',
  carbon: 'Carbon',
  sports: 'Sports',
  entertainment: 'Entertainment',
};

export function normaliseTier(tier: unknown): string | null {
  return TIER_ALIAS[String(tier ?? '').trim().toLowerCase()] ?? null;
}

/**
 * Every module the desks show, planned modules excluded, by desk tab id (deskModules.json,
 * generated from the app's DESK_CATALOGUE by scripts/build-desk-modules.mjs; a Vitest test fails
 * when it is stale). Not deskCatalog.json: that lists only modules with stored desk_rows, and
 * live and composite modules (State Governance Brief, the news wires, the Morning Brief) have none.
 */
const DESK_MODULES: readonly { tier: string; feature: string }[] = (deskModules as { modules: { tier: string; feature: string }[] }).modules;

/**
 * The module's name as the desk spells it, matched exactly and then case-, dash- and space-
 * insensitively within the tier; null when the tier has no such module. This only refuses names
 * that are not desk modules; whether desk_rows holds the record is decided later.
 */
export function catalogueFeature(tier: string, feature: string): string | null {
  const inTier = DESK_MODULES.filter((m) => m.tier === tier);
  const want = String(feature ?? '').trim();
  if (!want) return null;
  return (inTier.find((m) => m.feature === want) ?? inTier.find((m) => normaliseName(m.feature) === normaliseName(want)))?.feature ?? null;
}

// ---- store ----------------------------------------------------------------------------------

/** The parts of a format-2 brief after the lead, as record_briefs.points keeps them. */
export interface BriefParts {
  why: string;
  watch: string;
  tags: string[];
}

export interface StoredBrief {
  /** The lead brief (format 2) or the headline (format 1). */
  headline: string;
  /** {why, watch, tags} (format 2) or the three points (format 1). */
  points: string[] | BriefParts;
  model: string | null;
  written_at: string;
  /** Absent from a claim answered before migration 20261015240000; the points' shape tells. */
  format?: number;
}

export type ClaimResult =
  | ({ state: 'ready' } & StoredBrief)
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'unavailable'; reason?: string }
  | { state: 'claimed'; token: string; previous: StoredBrief | null };

/** The key a claim reads by: a client brief is addressed by its content hash, a desk_rows brief by ''. */
export interface PeekArgs {
  tier: string;
  feature: string;
  rowKey: string;
  hash: string;
  source: RecordSource;
}

/** The record_briefs columns peekDecision reads. */
export interface StoredRow {
  status: 'pending' | 'ready' | 'failed';
  content_hash: string;
  brief_format: number;
  headline: string | null;
  points: unknown;
  model: string | null;
  written_at: string | null;
  claimed_at: string | null;
  retry_after: string | null;
  attempts: number;
}

export type PeekDecision =
  | { state: 'ready'; brief: StoredBrief }
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'missing' };

const HOURS_24 = 24 * 3600 * 1000;
const SECONDS_90 = 90 * 1000;
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * Owner 2026-10-16: the panel shows the writing animation only while a brief is really written, so
 * it first asks what a claim would do without claiming. This mirrors record_brief_claim's "not
 * claimable" test (migration 20261015240000) exactly: when the claim would generate, the answer is
 * 'missing' and the browser then asks for the write; otherwise it is what the claim would serve.
 * Keep it equal to that test if the claim changes.
 */
export function peekDecision(b: StoredRow | null, hash: string, format: number, now: number): PeekDecision {
  if (!b) return { state: 'missing' };
  const claimable = (b.status === 'ready' && b.brief_format < format)
    || (b.status === 'ready' && b.content_hash !== hash && (b.written_at === null || ms(b.written_at) < now - HOURS_24))
    || (b.status === 'pending' && ms(b.claimed_at) < now - SECONDS_90 && (b.content_hash !== hash || b.attempts < 5))
    || (b.status === 'failed' && ms(b.retry_after) <= now && (b.content_hash !== hash || b.attempts < 5));
  if (claimable) return { state: 'missing' };
  if (b.written_at && b.headline) {
    return { state: 'ready', brief: { headline: b.headline, points: b.points as StoredBrief['points'], model: b.model, written_at: b.written_at, format: b.brief_format } };
  }
  return { state: b.status === 'pending' && ms(b.claimed_at) >= now - SECONDS_90 ? 'pending' : 'failed' };
}

/** Where the briefed row came from; see the head of this file. */
export type RecordSource = 'desk_rows' | 'client';

export interface ClaimArgs {
  tier: string;
  feature: string;
  rowKey: string;
  hash: string;
  /** 'client' briefs are stored and served per hash; 'desk_rows' briefs per key. */
  source: RecordSource;
  userId: string;
  limits: typeof RECORD_LIMITS;
  /** The format this function writes; a stored brief of an older one is regenerated once. */
  format: number;
}

export interface FinishedBrief {
  /** The lead brief. */
  headline: string;
  points: BriefParts;
  format: number;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  model_call_log_id: string | null;
}

export interface FinishArgs {
  tier: string;
  feature: string;
  rowKey: string;
  /** Names the claimed row among the key's desk_rows and client briefs. */
  token: string;
  /**
   * null marks the claim failed, keeping any previous brief: retried after 10 minutes, doubling
   * per failure, and not again for the same content after five failures.
   */
  brief: FinishedBrief | null;
}

export interface RecordBriefStore {
  /** desk_rows.row for the record, or null when desk_rows does not hold it. */
  storedRow(tier: string, feature: string, rowKey: string): Promise<Record<string, unknown> | null>;
  claim(a: ClaimArgs): Promise<ClaimResult>;
  /** The record_briefs row a claim would read, without claiming (read mode), or null. */
  peek(a: PeekArgs): Promise<StoredRow | null>;
  finish(a: FinishArgs): Promise<boolean>;
  /** model_pricing lists the model as available (the platform's model, not the chat allowlist). */
  modelAvailable(model: string): Promise<boolean>;
}

// ---- request --------------------------------------------------------------------------------

export interface RecordRequest {
  tier: string;
  feature: string;
  row: Record<string, unknown>;
}

/** Only tier, feature and row are read; any key, hash or extract in the body is ignored. */
export function parseRecordRequest(
  body: Record<string, unknown>,
  maxLabel: number,
  maxRowBytes: number,
): RecordRequest {
  const tier = normaliseTier(body.tier);
  if (!tier) throw new HttpError(400, 'tier must be a desk');
  if (typeof body.feature !== 'string' || !body.feature.trim()) throw new HttpError(400, 'feature is required');
  const feature = body.feature.trim();
  if (feature.length > maxLabel) throw new HttpError(400, `feature is limited to ${maxLabel} characters`);
  const row = body.row;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new HttpError(400, 'row must be an object');
  if ((row as Record<string, unknown>).status === 'source_status') throw new HttpError(400, 'Select a row to organise');
  if (new TextEncoder().encode(JSON.stringify(row)).length > maxRowBytes) {
    throw new HttpError(413, `row is limited to ${maxRowBytes} bytes`);
  }
  return { tier, feature, row: row as Record<string, unknown> };
}

// ---- prompt ---------------------------------------------------------------------------------

export const RECORD_SYSTEM =
  `You write the AI analysis shown on one record's panel in Niyantran Terminal, an Indian policy and geopolitics intelligence desk.
Use only the record fields you are given. Do not add any fact, number, date, name, place, cause or consequence that is not in the fields, and do not use outside knowledge.
If the fields are thin, say plainly what the record is and what it does not state.
Do not interpret or characterise: no "suggests", "indicates", "signals" or "implies", and no describing a thing the fields only name.
Do not repeat bookkeeping fields (provenance, confidence, verification or review status, source type) unless the record is about them.
No advice: do not tell the reader to check, read or follow anything. No buy / sell / hold language, no predictions or price targets. Never use the word "correlation".
Plain English, Indian spelling, short sentences.
Return ONLY a JSON object: {"brief": "...", "why": "...", "watch": "...", "tags": ["...", "..."]}
- brief: at most 60 words: what this record is, and its current status or figures as the fields give them.
- why: at most 50 words: why it matters, only from what the fields state (its scale, stage, parties or figures). Where the fields do not show why it matters, say what the record does not state.
- watch: at most 40 words: what to watch for, only a pending stage, date or next step the fields name. Where they name none, say that the record states no next step.
- tags: up to 4 short labels of one to three words, each taken from the fields (such as the region, ministry, stage or type).`;

const SKIP_KEY =
  /^(id|record_id|row_key|uuid|members_json|agenda_json|sources_json|attached_sources|attached_documents|provenance_hubs|record_text|document_status|related_records|timeline)$/i;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_CELL);
}

const scalar = (v: unknown) => v === null || typeof v !== 'object';

/** The fields the model reads: scalars and lists of scalars, no identifiers, no internal keys, at most 40. */
export function recordFields(row: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(row)) {
    if (/^_|backup_/i.test(k) || SKIP_KEY.test(k)) continue;
    if (Array.isArray(v) ? !v.every(scalar) : !scalar(v)) continue;
    const text = cell(Array.isArray(v) ? v.filter((x) => x !== null && x !== '').join(', ') : v);
    if (!text) continue;
    out.push([k.replace(/\s+/g, ' ').trim().slice(0, MAX_KEY), text]);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** The field lines the model reads, at most MAX_FIELDS_TEXT characters in all. */
function fieldLines(row: Record<string, unknown>): string {
  let text = '';
  for (const [k, v] of recordFields(row)) {
    const line = `${k}: ${v}`;
    if (text.length + line.length + 1 > MAX_FIELDS_TEXT) break;
    text += (text ? '\n' : '') + line;
  }
  return text;
}

const TITLE_KEYS = [
  'bill_name',
  'policy_name',
  'conflict_name',
  'case_title',
  'title',
  'record_title',
  'program_name',
  'project_name',
  'name',
  'mp_name',
  'entity',
  'topic',
  'subject',
  'headline',
  'question',
];

/** The record's name from its usual title columns; '' when it has none (the prompt then names none). */
function titleOf(row: Record<string, unknown>): string {
  for (const k of TITLE_KEYS) {
    const t = cell(row[k]);
    if (t) return t;
  }
  return '';
}

export function buildRecordPrompt(req: RecordRequest): { title: string; prompt: string } {
  const title = titleOf(req.row);
  const fields = fieldLines(req.row);
  return {
    title,
    prompt: `Desk: ${TIER_LABEL[req.tier] ?? req.tier} / ${req.feature}
Record: ${title || '(no title field)'}

Fields of this record (the only evidence you may use):
${fields || '(no fields)'}`,
  };
}

/** The OpenRouter request body. No tools, no web plugin, reasoning off. */
export function recordRequestBody(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    temperature: RECORD_TEMPERATURE,
    max_tokens: RECORD_MAX_TOKENS,
    response_format: { type: 'json_object' },
    reasoning: { enabled: false },
    usage: { include: true },
    messages: [
      { role: 'system', content: RECORD_SYSTEM },
      { role: 'user', content: prompt },
    ],
  };
}

/** The model's JSON object, tolerating a fence or prose around it; null when there is none. */
export function parseBrief(text: string): Record<string, unknown> | null {
  const raw = String(text ?? '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const part = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_PART) : '');

/** Up to four distinct tags (case-insensitively) of at most 40 characters; others are dropped, not cut. */
function tagsOf(v: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(v) ? v : []) {
    if (typeof t !== 'string') continue;
    const tag = t.replace(/\s+/g, ' ').trim();
    if (!tag || tag.length > MAX_TAG || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export interface RecordBrief extends BriefParts {
  brief: string;
}

/**
 * {brief, why, watch, tags} from the model's JSON, bounded; null when the lead brief or why is
 * missing. watch may be empty and tags none: the card then leaves them out.
 */
export function normaliseRecordBrief(raw: Record<string, unknown> | null): RecordBrief | null {
  if (!raw) return null;
  const brief = part(raw.brief);
  const why = part(raw.why);
  return brief && why ? { brief, why, watch: part(raw.watch), tags: tagsOf(raw.tags) } : null;
}

// ---- identity -------------------------------------------------------------------------------

export interface RecordIdentity {
  rowKey: string;
  hash: string;
  /** The row that is hashed and briefed: desk_rows' copy when it holds the record. */
  row: Record<string, unknown>;
  /** 'desk_rows' when that copy was used, else 'client' (the brief is then served per hash). */
  source: RecordSource;
}

export async function identify(req: RecordRequest, store: RecordBriefStore): Promise<RecordIdentity> {
  const rowKey = deskRowKey(req.row).slice(0, 300);
  const stored = await store.storedRow(req.tier, req.feature, rowKey);
  const held = Boolean(stored && typeof stored === 'object' && !Array.isArray(stored));
  const row = held ? stored as Record<string, unknown> : req.row;
  return {
    rowKey,
    row,
    source: held ? 'desk_rows' : 'client',
    // A browser-supplied row is hashed by exactly what the model reads (title and field lines), so a
    // row that hides fields from the prompt cannot share the honest row's hash (security re-review
    // 2026-10-15). desk_rows' own copy keeps the entry fingerprint.
    hash: held ? await entryFingerprint(row, req.feature, req.tier) : await briefedHash(req, rowKey, row),
  };
}

async function briefedHash(req: RecordRequest, rowKey: string, row: Record<string, unknown>): Promise<string> {
  const text = JSON.stringify([req.tier, req.feature, rowKey, titleOf(row), fieldLines(row)]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
