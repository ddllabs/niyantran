import { requireUser, type Verify } from '../_shared/auth.ts';
import { allowedOrigins, corsHeaders, originAllowed, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 16384;
const TYPES = new Set(['audio/webm', 'video/webm', 'audio/mp4', 'video/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg']);
const MODEL = 'openai/whisper-large-v3-turbo';
const FAILED = 'Transcription failed. Try again.';
/** A log write may delay the answer by at most this long, then is abandoned. */
export const TELEMETRY_TIMEOUT_MS = 1_500;

/**
 * One public.model_call_logs row per provider call; columns follow
 * desk-brief's and research-chat's rows.
 *
 * Dictation is FREE (owner decision 2026-10-14, AI credits spec section 6).
 * These rows exist so its cost is visible, never to bill it: credits settle
 * reads only caller = 'research-chat' rows by message id, and these rows carry
 * message_id null. Do not give a dictation row a message id.
 */
export interface ModelCallRow {
  user_id: string;
  conversation_id: null;
  message_id: null;
  caller: 'transcribe-audio';
  purpose: 'transcription';
  model_requested: string;
  model_served: string | null;
  provider: string | null;
  status: 'success' | 'error' | 'aborted';
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

export interface TranscriptionDeps {
  verify?: Verify;
  active(token: string, userId: string): Promise<boolean>;
  apiKey: string;
  fetch(input: string, init: RequestInit): Promise<Response>;
  /** Inserts the row with the service client. May throw or hang; see record(). */
  logModelCall(row: ModelCallRow): Promise<void>;
  now?: () => number;
  telemetryTimeoutMs?: number;
  origins?: string[];
}

function known(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * OpenRouter's transcription response carries `usage` with `cost` (USD) and,
 * depending on how the model is priced, `seconds` or a token breakdown
 * (input_tokens, output_tokens, total_tokens). Only reported values are kept;
 * a missing cost stays null and is never estimated.
 */
function usageOf(payload: Record<string, unknown> | null): Record<string, number> | null {
  const raw = payload?.usage;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'seconds', 'cost']) {
    const value = known(r[key]);
    if (value !== null) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

interface Attempt {
  userId: string;
  status: ModelCallRow['status'];
  /** Server-authored only; provider text never reaches the row. */
  reason: string | null;
  latencyMs: number;
  payload: Record<string, unknown> | null;
}

export function modelCallRow(a: Attempt): ModelCallRow {
  const usage = usageOf(a.payload);
  return {
    user_id: a.userId,
    conversation_id: null,
    message_id: null,
    caller: 'transcribe-audio',
    purpose: 'transcription',
    model_requested: MODEL,
    model_served: null,
    provider: null,
    status: a.status,
    error_message: a.status === 'success' ? null : a.reason ?? 'Provider attempt failed.',
    latency_ms: Math.max(0, Math.round(a.latencyMs)),
    prompt_tokens: usage?.input_tokens ?? null,
    completion_tokens: usage?.output_tokens ?? null,
    total_tokens: usage?.total_tokens ?? null,
    cached_prompt_tokens: null,
    reasoning_tokens: null,
    cost_usd: usage?.cost ?? null,
    openrouter_generation_id: null,
    raw_usage: usage ? { ...usage, cost_source: usage.cost === undefined ? 'none' : 'provider' } : null,
  };
}

/** Never throws and never waits longer than the bound. */
async function record(deps: TranscriptionDeps, row: ModelCallRow): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => deps.logModelCall(row)),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          log('transcribe_audio.telemetry_failed', { reason: 'timeout' });
          resolve();
        }, deps.telemetryTimeoutMs ?? TELEMETRY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    log('transcribe_audio.telemetry_failed', { reason: 'write_failed' });
  } finally {
    clearTimeout(timer);
  }
}
async function audioFile(req: Request): Promise<File> {
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new HttpError(400, 'Expected an audio recording.');
  const declared = Number(req.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'Recording is too large.');
  if (!req.body) throw new HttpError(400, 'No audio recorded.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, 'Recording is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'content-type': req.headers.get('content-type')! } }).formData(); }
  catch { throw new HttpError(400, 'Invalid audio recording.'); }
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || !TYPES.has(file.type.split(';')[0])) throw new HttpError(400, 'Invalid audio recording.');
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'Recording is too large.');
  return file;
}

export async function handleTranscription(req: Request, deps: TranscriptionDeps): Promise<Response> {
  const origins = deps.origins ?? allowedOrigins();
  const pre = preflight(req, origins);
  if (pre) return pre;
  const cors = { ...corsHeaders(req, origins), 'Cache-Control': 'no-store' };
  try {
    const origin = req.headers.get('origin');
    if (origin && !originAllowed(origin, origins)) throw new HttpError(403, 'Origin not allowed.');
    if (req.method !== 'POST') throw new HttpError(405, 'POST only.');
    const { token, userId } = await requireUser(req, deps.verify);
    if (!await deps.active(token, userId)) throw new HttpError(403, 'An active account is required.');
    if (!deps.apiKey) throw new HttpError(503, 'Dictation is not configured yet.');
    const file = await audioFile(req);
    const body = new FormData();
    const extension = file.type.includes('mp4') ? 'mp4' : file.type.includes('webm') ? 'webm' : file.type.includes('ogg') ? 'ogg' : file.type.includes('mpeg') ? 'mp3' : 'wav';
    body.append('file', file, `dictation.${extension}`);
    body.append('model', MODEL); body.append('response_format', 'json');
    const now = deps.now ?? Date.now;
    const started = now();
    let status: Attempt['status'] = 'error';
    let reason: string | null = 'Provider attempt failed.';
    let payload: Record<string, unknown> | null = null;
    let text: string | null = null;
    try {
      const response = await deps.fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${deps.apiKey}` }, body,
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(40000)]),
      });
      if (!response.ok) { await response.body?.cancel(); reason = `Provider returned HTTP ${response.status}.`; }
      else {
        try { payload = await response.json(); } catch { reason = 'Provider response was not JSON.'; }
        if (payload && typeof payload.text === 'string') { status = 'success'; reason = null; text = payload.text.trim(); }
        else if (payload) reason = 'Provider response had no transcript.';
      }
    } catch (error) {
      if (req.signal.aborted) { status = 'aborted'; reason = 'Provider attempt aborted.'; }
      else reason = (error as Error)?.name === 'TimeoutError' ? 'Provider attempt timed out.' : 'Provider request failed.';
    }
    await record(deps, modelCallRow({ userId, status, reason, latencyMs: now() - started, payload }));
    if (text === null) throw new HttpError(502, FAILED);
    return json({ text }, 200, cors);
  } catch (error) { return errorResponse(error, cors); }
}
