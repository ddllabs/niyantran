// desk-brief: organise ONE selected desk row into a short brief. Framework-free
// and dependency injected: nothing here reads Deno.env or opens a connection,
// so the same code runs under the edge runtime and under `deno test`.
//
// Order matters. The caller is verified and the request bounded before the
// registry or the provider is touched, and every provider attempt writes one
// model_call_logs row whose failure never fails the brief.
//
// Scope 'record' (F123) is the stored, platform-paid record brief; record.ts
// holds its prompt, identity and store contract, handleRecord below its flow.

import { requireUser, type Verify } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import { OPENROUTER_CHAT_URL, type Usage } from '../_shared/openrouterStream.ts';
import {
  buildRecordPrompt,
  catalogueFeature,
  DEFAULT_RECORD_BRIEF_MODEL,
  identify,
  normaliseRecordBrief,
  parseBrief,
  parseRecordRequest,
  RECORD_BRIEF_FORMAT,
  RECORD_LIMITS,
  RECORD_PROVIDER_TIMEOUT_MS,
  type BriefParts,
  type RecordBriefStore,
  recordRequestBody,
  type StoredBrief,
} from './record.ts';

export const DESK_ROLE = 'DEFAULT_ANALYST';
export const MAX_LABEL_CHARS = 64;
export const MAX_ROW_BYTES = 32_768;
export const MAX_SOURCE_EXTRACT_CHARS = 12_000;
export const MAX_SOURCE_NOTE_CHARS = 400;
export const MAX_HASH_CHARS = 128;
/** Whole request body; the row and extract bounds above fit well inside it. */
export const MAX_BODY_BYTES = 131_072;
/** Below the Vercel proxy's own timeout, so the proxy sees this function's answer. */
export const PROVIDER_TIMEOUT_MS = 50_000;
export const TELEMETRY_TIMEOUT_MS = 1_500;
const MAX_CELL = 220;
const MAX_FIELDS = 40;

const UNAVAILABLE = 'AI research service is temporarily unavailable.';

export interface RegistrySlice {
  models: { model_id: string }[];
  roles: { role_id: string; model_id: string }[];
}

/** Column names and meanings follow research-chat's telemetry row. */
export interface ModelCallRow {
  user_id: string;
  conversation_id: null;
  message_id: null;
  caller: 'desk-brief';
  /** record_brief is platform-paid: credit_charge_turn charges only chat_answer and embedding. */
  purpose: 'desk_brief' | 'record_brief';
  model_requested: string;
  model_served: string | null;
  provider: string | null;
  status: 'success' | 'error';
  error_message: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_prompt_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  openrouter_generation_id: string | null;
  raw_usage: Record<string, unknown> | null;
}

export interface DeskBriefDeps {
  verify?: Verify;
  registry(): Promise<RegistrySlice>;
  /** OPENROUTER_DESK_MODEL, honoured only when it names an enabled model. */
  deskModel?: string | null;
  apiKey: string | null | undefined;
  fetch: typeof fetch;
  /** Inserts the row; may return its id, which a record brief keeps. */
  logModelCall(row: ModelCallRow): Promise<string | null | void>;
  /** Scope 'record' (F123). Absent, that scope answers unavailable. */
  recordStore?: RecordBriefStore;
  /** RECORD_BRIEF_MODEL, honoured when model_pricing lists it as available. */
  recordModel?: string | null;
  now?: () => number;
  origins?: string[];
  providerTimeoutMs?: number;
  telemetryTimeoutMs?: number;
}

const SYSTEM = `You are the Niyantran Terminal record analyst.
The analyst selected ONE row in a desk tab. Organise and explain THAT entry's fields only.
Do not summarise the whole desk, feed volume, or other rows.
Chart numbers are computed on the server from this row — you write narrative and may rename chart titles.

Hard rules:
- Never buy / sell / hold / accumulate / avoid language. No price targets or predicted moves.
- Never use the word "correlation". Prefer connections, linkages, pathways, what this touches.
- Evidence first: base every claim on the attached row fields. If a field is missing, say so.
- Confidence only as labelled bands: strong / moderate / weak / speculative.
- Market cap is market data — do not use it as materiality.
- Do not invent chart series. Do not talk about "25 stories" or desk-wide totals.
- Prefer summary bullets shaped as "Label: detail" (Facility:, Status:, Source:, etc.).
- Return ONLY valid JSON matching the schema. No markdown fences.`;

// ---- request --------------------------------------------------------------

type Scope = 'entry' | 'substance';

interface BriefRequest {
  feature: string;
  tier: string;
  hash: string;
  scope: Scope;
  row: Record<string, unknown>;
  sourceNote: string;
  sourceExtract: string;
}

function label(value: unknown, name: string, required: boolean): string {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string`);
  const text = value.trim();
  if (required && !text) throw new HttpError(400, `${name} is required`);
  if (text.length > MAX_LABEL_CHARS) throw new HttpError(400, `${name} is limited to ${MAX_LABEL_CHARS} characters`);
  return text;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

export function parseRequest(raw: unknown): BriefRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'body must be a JSON object');
  const body = raw as Record<string, unknown>;
  const feature = label(body.feature, 'feature', true);
  const tier = label(body.tier, 'tier', false);
  const row = body.row;
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new HttpError(400, 'row must be an object');
  if ((row as Record<string, unknown>).status === 'source_status') throw new HttpError(400, 'Select a row to organise');
  if (bytes(JSON.stringify(row)) > MAX_ROW_BYTES) {
    throw new HttpError(413, `row is limited to ${MAX_ROW_BYTES} bytes`);
  }
  return {
    feature,
    tier,
    hash: typeof body.hash === 'string' ? body.hash.slice(0, MAX_HASH_CHARS) : '',
    scope: body.scope === 'substance' ? 'substance' : 'entry',
    row: row as Record<string, unknown>,
    sourceNote: typeof body.sourceNote === 'string' ? body.sourceNote.slice(0, MAX_SOURCE_NOTE_CHARS) : '',
    sourceExtract: typeof body.sourceExtract === 'string'
      ? body.sourceExtract.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_EXTRACT_CHARS)
      : '',
  };
}

// ---- model ----------------------------------------------------------------

/** The override when it is enabled, else the role's model when that is enabled, else null. */
export function chooseModel(registry: RegistrySlice, override?: string | null): string | null {
  const enabled = new Set(registry.models.map((m) => m.model_id));
  const wanted = String(override ?? '').trim();
  if (wanted && enabled.has(wanted)) return wanted;
  const role = registry.roles.find((r) => r.role_id === DESK_ROLE);
  return role && enabled.has(role.model_id) ? role.model_id : null;
}

// ---- prompt ---------------------------------------------------------------

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_CELL);
}

function slimEntry(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(row)) {
    if (/^__|backup_/i.test(k)) continue;
    out[k] = cell(v);
    if (++n >= MAX_FIELDS) break;
  }
  return out;
}

function entryTitle(entry: Record<string, string>): string {
  return entry.bill_name || entry.policy_name || entry.title || entry.record_title || entry.name || entry.subject ||
    entry.case_title || entry.conflict_name || 'Untitled entry';
}

function nounFor(feature: string, entry: Record<string, string>): string {
  if (/bill|act|amendment/i.test(feature) || entry.bill_name) return 'bill / Act';
  if (/question/i.test(feature)) return 'parliamentary question';
  if (/regulator|circular|notice/i.test(feature)) return 'regulatory notice';
  if (/policy/i.test(feature)) return 'policy';
  return 'record';
}

/** The prompts the Vercel route used before it stopped calling the provider. */
export function buildPrompt(req: BriefRequest): { title: string; prompt: string } {
  const entry = slimEntry(req.row);
  const title = entryTitle(entry);
  const source = req.sourceExtract;
  if (req.scope === 'substance') {
    const noun = nounFor(req.feature, entry);
    return {
      title,
      prompt: `You write the "What this ${noun} does" panel for Niyantran Terminal.
Title: ${title}
Desk: ${req.tier || '—'} / ${req.feature}

Row fields (context only — do NOT turn these into the summary):
${JSON.stringify(entry)}

${
        source
          ? `Source document text (PRIMARY evidence — base the summary on this):\n${source}`
          : 'No source document text was extracted. Infer only what the title and fields clearly state; say if substance is thin.'
      }

Return ONLY valid JSON:
{
  "headline": "one plain sentence: what this ${noun} is about",
  "summary": [
    "Purpose: …",
    "What it changes / provides: …",
    "Who / what it covers: …",
    "optional Mechanism: …",
    "optional Why it exists: …"
  ],
  "findings": [],
  "kpis": [],
  "confidence": "strong|moderate|weak|speculative",
  "caveats": ["optional limits of the source text"]
}

Hard rules:
- Summary must explain SUBSTANCE (what the law/notice/policy is about), not registry metadata.
- FORBIDDEN labels in summary: Facility, Status, Source, Source and Verification, Bill Category, House, Sector, Ministry, Stage, Date, Verification, Adapter.
- Prefer Purpose / What it changes / Scope / Mechanism / Context.
- 3–5 short bullets. Plain English. No buy/sell/hold language. Never say "correlation".
- Do not paste raw PDF preamble, Act number lines, or "WHEREAS" blocks.
- Evidence first from the source text; if the extract is thin, say so in caveats — do not invent clauses.`,
    };
  }
  return {
    title,
    prompt: `Desk tab: ${req.tier || '—'} / ${req.feature}
Selected entry only (do NOT summarise other feed rows):
Title: ${title}
Source note: ${req.sourceNote}
Entry fingerprint: ${req.hash}

Full field map for THIS entry:
${JSON.stringify(entry)}
${
      source
        ? `\nReadable text extracted from the source document / page for THIS entry (prefer this over thin row fields when they conflict):\n${source}\n`
        : ''
    }
Produce JSON with this exact shape:
{
  "headline": "one short line naming what THIS entry is about",
  "summary": ["Facility: …", "Status: …", "Source: …", "3-6 Label: detail bullets for THIS entry only"],
  "findings": [{"title":"...","detail":"...","band":"strong|moderate|weak|speculative"}],
  "kpis": [{"label":"...","value":"...","sub":"...","tone":"ok|warn|bad|"}],
  "confidence": "strong|moderate|weak|speculative",
  "caveats": ["missing fields or limits of this single record"]
}

Rules for this response:
- Organise the selected entry only. Never quote feed totals or other headlines.
- When source document text is present, write a short substance brief of what the document / notice does — not a field dump.
- Every summary bullet MUST start with a short Label then a colon (e.g. "Facility:", "Status:", "Source and Verification:").
- KPIs must come from fields on this row (source, date, verification, category, capacity, etc.).
- Do NOT include a "charts" array with invented numbers.`,
  };
}

// ---- model output ---------------------------------------------------------

// parseBrief lives in record.ts (dependency-free, so scripts/measure-record-briefs.ts can import it).
export { parseBrief };

const BAND = /^(strong|moderate|weak|speculative)$/i;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const field = (v: unknown, key: string): unknown =>
  v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;

function normalise(raw: Record<string, unknown>, feature: string) {
  const confidence = cell(raw.confidence).toLowerCase();
  return {
    headline: cell(raw.headline).slice(0, 160) || feature,
    summary: list(raw.summary).map(cell).filter(Boolean).slice(0, 6),
    findings: list(raw.findings).slice(0, 5).map((f) => {
      const band = cell(field(f, 'band'));
      return {
        title: cell(field(f, 'title')).slice(0, 80),
        detail: cell(typeof f === 'string' ? f : field(f, 'detail')).slice(0, 280),
        band: BAND.test(band) ? band.toLowerCase() : 'moderate',
      };
    }),
    kpis: list(raw.kpis).slice(0, 4).map((k) => {
      const tone = field(k, 'tone');
      return {
        label: cell(field(k, 'label')).slice(0, 40) || 'KPI',
        value: cell(field(k, 'value')).slice(0, 48) || '—',
        sub: cell(field(k, 'sub')).slice(0, 80),
        tone: typeof tone === 'string' && ['ok', 'warn', 'bad', ''].includes(tone) ? tone : '',
      };
    }),
    confidence: BAND.test(confidence) ? confidence : '',
    caveats: list(raw.caveats).map(cell).filter(Boolean).slice(0, 4),
  };
}

// ---- telemetry ------------------------------------------------------------

function known(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function scalar(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v) ? v : null;
}

function usageOf(u: unknown): Usage | null {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const r = u as Record<string, unknown>;
  const details = (r.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cdetails = (r.completion_tokens_details ?? {}) as Record<string, unknown>;
  const out: Usage = {
    prompt_tokens: known(r.prompt_tokens),
    completion_tokens: known(r.completion_tokens),
    total_tokens: known(r.total_tokens),
  };
  if (known(details.cached_tokens) !== null) out.cached_prompt_tokens = known(details.cached_tokens)!;
  if (known(cdetails.reasoning_tokens) !== null) out.reasoning_tokens = known(cdetails.reasoning_tokens)!;
  if (known(r.cost) !== null) out.cost = known(r.cost)!;
  return out;
}

interface Attempt {
  userId: string;
  requested: string;
  status: 'success' | 'error';
  /** Server-authored only; provider text never reaches the row. */
  reason: string | null;
  latencyMs: number;
  payload: Record<string, unknown> | null;
  purpose?: ModelCallRow['purpose'];
}

export function modelCallRow(a: Attempt): ModelCallRow {
  const usage = usageOf(a.payload?.usage);
  return {
    user_id: a.userId,
    conversation_id: null,
    message_id: null,
    caller: 'desk-brief',
    purpose: a.purpose ?? 'desk_brief',
    model_requested: a.requested,
    model_served: scalar(a.payload?.model),
    provider: scalar(a.payload?.provider),
    status: a.status,
    error_message: a.status === 'success' ? null : a.reason ?? 'Provider attempt failed.',
    latency_ms: Math.max(0, Math.round(a.latencyMs)),
    prompt_tokens: known(usage?.prompt_tokens),
    completion_tokens: known(usage?.completion_tokens),
    total_tokens: known(usage?.total_tokens),
    cached_prompt_tokens: known(usage?.cached_prompt_tokens),
    reasoning_tokens: known(usage?.reasoning_tokens),
    cost_usd: known(usage?.cost),
    openrouter_generation_id: scalar(a.payload?.id),
    raw_usage: usage ? { ...usage, cost_source: known(usage.cost) === null ? 'none' : 'provider' } : null,
  };
}

/** Never throws and never waits longer than the bound. Returns the row id when the writer gives one. */
async function record(deps: DeskBriefDeps, row: ModelCallRow): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = await Promise.race([
      Promise.resolve().then(() => deps.logModelCall(row)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          log('desk_brief.telemetry_failed', { reason: 'timeout' });
          resolve(null);
        }, deps.telemetryTimeoutMs ?? TELEMETRY_TIMEOUT_MS);
      }),
    ]);
    return typeof id === 'string' && id ? id : null;
  } catch {
    log('desk_brief.telemetry_failed', { reason: 'write_failed' });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- provider -------------------------------------------------------------

interface ProviderResult {
  ok: boolean;
  payload: Record<string, unknown> | null;
}

async function callProvider(deps: DeskBriefDeps, apiKey: string, model: string, prompt: string): Promise<ProviderResult> {
  return await postProvider(deps, apiKey, {
    model,
    temperature: 0.25,
    response_format: { type: 'json_object' },
    usage: { include: true },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt },
    ],
  }, deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS);
}

async function postProvider(
  deps: DeskBriefDeps,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await deps.fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://niyantran.local',
        'X-Title': 'Niyantran Terminal Desk Brief',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    const payload = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
    return { ok: res.ok, payload };
  } catch {
    return { ok: false, payload: null };
  } finally {
    clearTimeout(timer);
  }
}

// ---- record scope (F123) ---------------------------------------------------

type RecordAnswer =
  | { state: 'ready'; format: number; brief: string; why: string; watch: string; tags: string[]; model: string | null; writtenAt: string }
  | { state: 'ready'; format: 1; headline: string; points: string[]; model: string | null; writtenAt: string }
  | { state: 'pending' | 'failed' | 'unavailable' };

/** record_briefs keeps token counts as integer columns: rounded, or null outside 0..2^31-1. */
function tokenCount(v: number | null): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 0 && n <= 2_147_483_647 ? n : null;
}

/**
 * A stored brief in the shape it was written: format 2 as {brief, why, watch, tags}, an older
 * format-1 brief (stored before migration 20261015240000) as {headline, points} until it is
 * regenerated. The points' shape decides, so a claim answered without a format reads the same.
 */
const served = (b: StoredBrief): RecordAnswer => {
  const at = { model: b.model, writtenAt: b.written_at };
  if (Array.isArray(b.points)) return { state: 'ready', format: 1, headline: b.headline, points: b.points, ...at };
  const p = (b.points ?? {}) as Partial<BriefParts>;
  return {
    state: 'ready',
    format: typeof b.format === 'number' && b.format >= 2 ? b.format : 2,
    brief: b.headline,
    why: typeof p.why === 'string' ? p.why : '',
    watch: typeof p.watch === 'string' ? p.watch : '',
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
    ...at,
  };
};

/**
 * Reads, or claims and writes, the stored brief for one record. The answer never carries cost
 * or tokens. Only the claim's winner calls the provider; every attempt it makes writes one
 * model_call_logs row with purpose record_brief, which is never charged to the user.
 */
async function handleRecord(deps: DeskBriefDeps, userId: string, body: Record<string, unknown>): Promise<RecordAnswer> {
  const parsed = parseRecordRequest(body, MAX_LABEL_CHARS, MAX_ROW_BYTES);
  const store = deps.recordStore;
  if (!store) return { state: 'unavailable' };
  // Only the desk's modules are briefed, keyed by the catalogue's spelling of the name.
  const feature = catalogueFeature(parsed.tier, parsed.feature);
  if (!feature) return { state: 'unavailable' };
  const input = { ...parsed, feature };
  const now = deps.now ?? Date.now;

  let id;
  let claim;
  try {
    id = await identify(input, store);
    claim = await store.claim({
      tier: input.tier,
      feature: input.feature,
      rowKey: id.rowKey,
      hash: id.hash,
      source: id.source,
      userId,
      limits: RECORD_LIMITS,
      format: RECORD_BRIEF_FORMAT,
    });
  } catch (err) {
    log('record_brief.store_failed', { message: String((err as Error)?.message ?? err).slice(0, 300) });
    throw new HttpError(503, UNAVAILABLE);
  }
  if (claim.state === 'ready') return served(claim);
  if (claim.state !== 'claimed') return { state: claim.state };

  // This caller generates. Whatever happens, the claim is finished, so the row never waits
  // out its 90-second staleness window.
  const previous = claim.previous;
  const finish = async (brief: Parameters<RecordBriefStore['finish']>[0]['brief']) => {
    try {
      await store.finish({ tier: input.tier, feature: input.feature, rowKey: id.rowKey, token: claim.token, brief });
    } catch (err) {
      log('record_brief.finish_failed', { message: String((err as Error)?.message ?? err).slice(0, 300) });
    }
  };
  const fallback = (state: 'failed' | 'unavailable'): RecordAnswer => (previous ? served(previous) : { state });

  const model = String(deps.recordModel ?? '').trim() || DEFAULT_RECORD_BRIEF_MODEL;
  const apiKey = String(deps.apiKey ?? '').trim();
  const available = apiKey ? await store.modelAvailable(model).catch(() => false) : false;
  if (!available) {
    log('record_brief.unconfigured', { model, key: Boolean(apiKey) });
    await finish(null);
    return fallback('unavailable');
  }

  const { prompt } = buildRecordPrompt({ ...input, row: id.row });
  const started = now();
  const result = await postProvider(deps, apiKey, recordRequestBody(model, prompt), RECORD_PROVIDER_TIMEOUT_MS);
  const latencyMs = now() - started;
  const message = field(list(result.payload?.choices)[0], 'message');
  const text = result.ok ? field(message, 'content') : null;
  const brief = normaliseRecordBrief(typeof text === 'string' ? parseBrief(text) : null);

  const status = result.ok && brief ? 'success' : 'error';
  const reason = !result.ok ? 'Provider attempt failed.' : brief ? null : 'Model returned malformed JSON.';
  const logRow = modelCallRow({ userId, requested: model, status, reason, latencyMs, payload: result.payload, purpose: 'record_brief' });
  const logId = await record(deps, logRow);

  if (!brief) {
    await finish(null);
    return fallback('failed');
  }
  const servedModel = logRow.model_served ?? model;
  await finish({
    headline: brief.brief,
    points: { why: brief.why, watch: brief.watch, tags: brief.tags },
    format: RECORD_BRIEF_FORMAT,
    model: servedModel,
    prompt_tokens: tokenCount(logRow.prompt_tokens),
    completion_tokens: tokenCount(logRow.completion_tokens),
    reasoning_tokens: tokenCount(logRow.reasoning_tokens),
    cost_usd: logRow.cost_usd,
    model_call_log_id: logId,
  });
  return { state: 'ready', format: RECORD_BRIEF_FORMAT, ...brief, model: servedModel, writtenAt: new Date().toISOString() };
}

// ---- handler --------------------------------------------------------------

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text().catch(() => '');
  if (bytes(text) > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export async function handleDeskBrief(req: Request, deps: DeskBriefDeps): Promise<Response> {
  const pre = preflight(req, deps.origins);
  if (pre) return pre;
  const cors = corsHeaders(req, deps.origins);
  const now = deps.now ?? Date.now;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const { userId } = await requireUser(req, deps.verify);
    const raw = await readBody(req);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).scope === 'record') {
      return json({ ok: true, ...(await handleRecord(deps, userId, raw as Record<string, unknown>)) }, 200, cors);
    }
    const input = parseRequest(raw);

    let model: string | null = null;
    try {
      model = chooseModel(await deps.registry(), deps.deskModel);
    } catch (err) {
      log('desk_brief.registry_failed', { message: String((err as Error)?.message ?? err).slice(0, 300) });
    }
    if (!model) throw new HttpError(503, UNAVAILABLE);
    const apiKey = String(deps.apiKey ?? '').trim();
    if (!apiKey) throw new HttpError(503, UNAVAILABLE);

    const { title, prompt } = buildPrompt(input);
    const started = now();
    const result = await callProvider(deps, apiKey, model, prompt);
    const latencyMs = now() - started;
    const content = field(list(result.payload?.choices)[0], 'message');
    const text = result.ok ? field(content, 'content') : null;
    const brief = typeof text === 'string' ? parseBrief(text) : null;

    const status = result.ok && brief ? 'success' : 'error';
    const reason = !result.ok ? 'Provider attempt failed.' : brief ? null : 'Model returned malformed JSON.';
    await record(deps, modelCallRow({ userId, requested: model, status, reason, latencyMs, payload: result.payload }));

    if (!result.ok) throw new HttpError(503, UNAVAILABLE);
    if (!brief) throw new HttpError(502, 'Malformed AI brief response');

    return json(
      {
        ok: true,
        ...normalise(brief, input.feature),
        hash: input.hash,
        model: scalar(result.payload?.model) ?? model,
        generatedAt: new Date().toISOString(),
        scope: input.scope,
        entryTitle: title.slice(0, 160),
      },
      200,
      cors,
    );
  } catch (err) {
    return errorResponse(err, cors);
  }
}
