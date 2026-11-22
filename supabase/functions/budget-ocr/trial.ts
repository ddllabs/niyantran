// budget-ocr: the vision-model trial (F409, docs/specs/2026-11-21-budget-ocr-text.md, Live run 2026-11-22). Mistral OCR
// reads 6 of the 7 columns of the Demand for Grants tables in both markdown and HTML; the developer approved a trial of two
// vision models through OpenRouter on two documents, compared against the tables' own totals. This route is that trial and
// nothing more: it is inert for the production queue.
//
// Selected only by a JSON body {"trial":"vision","model":"<allowlisted id>","source_key":"<40 hex>"} behind the same
// secret check as the cron mode (handler.ts). It reads the request's row with the read-only public.budget_ocr_read, fetches
// the official PDF from the row's URL (validated against the Budget desk's official hosts when it was queued; no redirect
// is followed), sends it to OpenRouter as a base64 data URL with the native PDF engine, and answers the text and the usage.
// The bytes are held in memory for the call only, never stored. NO database write: no claim, finish or fail, no spend
// against the cap, no cron work.
//
// Why bytes and not the URL: OpenRouter's PDF documentation (checked 2026-11-22) shows a plain URL only for the Responses
// API (`input_file.file_url`); every Chat Completions `file.file_data` example is a base64 data URL, and the repository has
// no evidence that a URL is accepted there.

import { json } from '../_shared/http.ts';
import { OPENROUTER_CHAT_URL } from '../_shared/openrouterStream.ts';
import { withTimeout } from './handler.ts';

/** The models the trial may call, exact strings. */
export const TRIAL_MODELS: readonly string[] = ['google/gemini-2.5-flash', 'openai/gpt-5-mini'];
/** The trial bound: documents of at most this many pages. */
export const TRIAL_MAX_PAGES = 5;
/** The OpenRouter call's limit, response included; with the PDF fetch it stays under the function's 150 s request limit. */
export const TRIAL_TIMEOUT_MS = 120_000;
/** The official PDF's fetch limit. */
export const TRIAL_PDF_TIMEOUT_MS = 20_000;
/** A 5-page PDF larger than this is not a Demand for Grants document. */
export const TRIAL_MAX_PDF_BYTES = 20 * 1024 * 1024;
export const TRIAL_MAX_TOKENS = 16_000;

export const TRIAL_SYSTEM_PROMPT = [
  'You transcribe PDF documents exactly. Output only the transcription, with no commentary.',
  'Keep Hindi and English text as printed.',
  'Write every table as a markdown table with EVERY column of the original, one row per printed row.',
  'Leave empty cells empty. Copy numbers exactly: no rounding, no reformatting. Keep "..." as printed.',
].join('\n');

export const TRIAL_USER_PROMPT = [
  'Transcribe every page of this document exactly, keeping Hindi and English text.',
  'Every table: a markdown table with every column of the original, one row per printed row, empty cells empty,',
  'numbers copied exactly, "..." kept as printed.',
  'Before each page write a line `=== PAGE n ===` (n from 1). No commentary.',
].join('\n');

/** One row of public.budget_ocr_read; only these fields are used (never page_texts). */
export interface TrialRow {
  source_key: string;
  official_url: string;
  expected_pages: number;
}

export interface TrialDeps {
  /** public.budget_ocr_read(text[]): read only. The trial has no other database access. */
  read(keys: string[]): Promise<TrialRow[]>;
  /** For the official PDF and for OpenRouter. */
  fetch: typeof fetch;
  /** OPENROUTER_API_KEY. */
  apiKey: string;
  log(event: string, fields: Record<string, unknown>): void;
  /** The OpenRouter call's limit; TRIAL_TIMEOUT_MS unless a test sets it. */
  timeoutMs?: number;
}

export interface TrialBody {
  trial: unknown;
  model?: unknown;
  source_key?: unknown;
}

/** The body selects the trial only when it is a JSON object with a `trial` field; anything else is the cron mode. */
export function trialBodyOf(text: string): TrialBody | null {
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.hasOwn(parsed, 'trial')) return null;
  return parsed as TrialBody;
}

class TrialError extends Error {
  constructor(readonly code: string, readonly status: number, readonly detail: Record<string, unknown> = {}) {
    super(code);
  }
}

/** The queue checked the host when the row was made; this re-checks its shape (https, no port or user, a .pdf path). */
function officialUrlOk(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length > 2000 || !/^https:\/\/[^/@:?#]+\/[^?#]+\.pdf$/.test(raw)) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchPdf(deps: TrialDeps, url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await withTimeout(deps.fetch, TRIAL_PDF_TIMEOUT_MS)(url, { method: 'GET', redirect: 'error' });
  } catch {
    // The message can hold the URL: it is not reported.
    throw new TrialError('pdf_fetch_failed', 502);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new TrialError('pdf_fetch_failed', 502, { http_status: res.status });
  }
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > TRIAL_MAX_PDF_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new TrialError('pdf_too_large', 502);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new TrialError('pdf_fetch_failed', 502);
  }
  if (bytes.length > TRIAL_MAX_PDF_BYTES) throw new TrialError('pdf_too_large', 502);
  // %PDF-
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length < magic.length || magic.some((b, i) => bytes[i] !== b)) throw new TrialError('not_pdf', 502);
  return bytes;
}

/** The Chat Completions body: the PDF as a file part, the native PDF engine, deterministic, with the cost returned. */
export function trialRequestBody(model: string, sourceKey: string, pdf: Uint8Array): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: 'system', content: TRIAL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: TRIAL_USER_PROMPT },
          {
            type: 'file',
            file: { filename: `${sourceKey}.pdf`, file_data: `data:application/pdf;base64,${base64(pdf)}` },
          },
        ],
      },
    ],
    plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
    temperature: 0,
    max_tokens: TRIAL_MAX_TOKENS,
    usage: { include: true },
    stream: false,
  };
}

const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;

async function callOpenRouter(deps: TrialDeps, body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await withTimeout(deps.fetch, deps.timeoutMs ?? TRIAL_TIMEOUT_MS)(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.apiKey}`,
        'content-type': 'application/json',
        'x-title': 'Niyantran Terminal',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new TrialError('openrouter_timeout', 504);
    throw new TrialError('openrouter_failed', 502);
  }
  // The error body can echo the request or a key: it is not read into the answer or the log.
  if (res.status === 429) {
    await res.body?.cancel().catch(() => {});
    throw new TrialError('openrouter_rate_limited', 502, { http_status: 429 });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new TrialError('openrouter_failed', 502, { http_status: res.status });
  }
  let got: {
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
    usage?: Record<string, unknown>;
  };
  try {
    got = await res.json();
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new TrialError('openrouter_timeout', 504);
    throw new TrialError('openrouter_unreadable', 502);
  }
  const choice = got?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text) throw new TrialError('openrouter_empty', 502);
  const finish = typeof choice?.finish_reason === 'string' && choice.finish_reason.length <= 32
    ? choice.finish_reason
    : null;
  return {
    text,
    finish_reason: finish,
    usage: {
      prompt_tokens: num(got.usage?.prompt_tokens),
      completion_tokens: num(got.usage?.completion_tokens),
      cost: num(got.usage?.cost),
    },
  };
}

function safeLog(deps: TrialDeps, event: string, fields: Record<string, unknown>): void {
  try {
    deps.log(event, fields);
  } catch {
    // A broken log sink must not break the trial.
  }
}

/** Validates the body before any dependency is built: 400 with a code, or the model and key to use. */
export function checkTrialBody(body: TrialBody): Response | { model: string; sourceKey: string } {
  if (body.trial !== 'vision') return json({ error: 'trial_unknown' }, 400);
  if (typeof body.model !== 'string' || !TRIAL_MODELS.includes(body.model)) {
    return json({ error: 'model_not_allowed' }, 400);
  }
  if (typeof body.source_key !== 'string' || !/^[0-9a-f]{40}$/.test(body.source_key)) {
    return json({ error: 'source_key_invalid' }, 400);
  }
  return { model: body.model, sourceKey: body.source_key };
}

/** Runs one trial call. Answers 200 with the text and usage, or a bare JSON error code. Never writes. */
export async function runTrial(deps: TrialDeps, model: string, sourceKey: string): Promise<Response> {
  const started = Date.now();
  const ids = { source_key: sourceKey, model };
  try {
    let rows: TrialRow[];
    try {
      rows = await deps.read([sourceKey]);
    } catch {
      throw new TrialError('read_failed', 502);
    }
    const row = (Array.isArray(rows) ? rows : []).find((r) => r?.source_key === sourceKey);
    if (!row) throw new TrialError('not_found', 400);
    const pages = row.expected_pages;
    if (!Number.isInteger(pages) || pages < 1 || pages > TRIAL_MAX_PAGES) {
      throw new TrialError('too_many_pages', 400, { expected_pages: Number.isInteger(pages) ? pages : null });
    }
    if (!officialUrlOk(row.official_url)) throw new TrialError('official_url_invalid', 400);
    const pdf = await fetchPdf(deps, row.official_url);
    const got = await callOpenRouter(deps, trialRequestBody(model, sourceKey, pdf));
    safeLog(deps, 'budget_ocr.trial_finished', {
      ...ids,
      outcome: 'ok',
      expected_pages: pages,
      pdf_bytes: pdf.length,
      prompt_tokens: got.usage.prompt_tokens,
      completion_tokens: got.usage.completion_tokens,
      cost: got.usage.cost,
      finish_reason: got.finish_reason,
      latency_ms: Date.now() - started,
    });
    return json({ model, source_key: sourceKey, text: got.text, usage: got.usage });
  } catch (e) {
    const err = e instanceof TrialError ? e : new TrialError('internal', 500);
    safeLog(deps, 'budget_ocr.trial_failed', {
      ...ids,
      outcome: err.code,
      ...err.detail,
      latency_ms: Date.now() - started,
    });
    return json({ error: err.code }, err.status);
  }
}
