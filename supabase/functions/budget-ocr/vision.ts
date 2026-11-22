// budget-ocr: the production vision call (F409, docs/specs/2026-11-21-budget-ocr-text.md, decision 2026-11-22). A claimed
// request of 1 to VISION_MAX_PAGES pages (engine.ts) is read by GPT-5 mini through OpenRouter with the trial's proven
// request (trial.ts): the official PDF fetched into memory with the same checks (no redirect, time and size limits, the
// %PDF- signature), sent as a base64 file part with the native PDF engine, temperature 0, usage included, the same prompts
// (`=== PAGE n ===` before each page). Only max_tokens is larger. The bytes are held for the call only, never stored.
//
// The answer is split into exactly the expected page texts here; handler.ts decides finish or fail. A failure is a
// VisionFailure: its code, whether it may have been billed (uncertain: the estimate counts as spent) and whether it is final.

import { VISION_MODEL } from './engine.ts';
import { callOpenRouter, fetchPdf, officialUrlOk, TrialError, trialRequestBody } from './trial.ts';

/** The OpenRouter call's limit, response included: the trial's (TRIAL_TIMEOUT_MS). */
export const VISION_TIMEOUT_MS = 120_000;
/** The official PDF's fetch limit: the trial's (TRIAL_PDF_TIMEOUT_MS), applied inside fetchPdf. */
export const VISION_PDF_TIMEOUT_MS = 20_000;
/** gpt-5-mini allows 128k completion tokens; the densest trial document (3 pages) used about 11k, reasoning included. */
export const VISION_MAX_TOKENS = 32_000;

export interface VisionDeps {
  /** For the official PDF and for OpenRouter. */
  fetch: typeof fetch;
  /** OPENROUTER_API_KEY. */
  apiKey: string;
  /** The OpenRouter call's limit; VISION_TIMEOUT_MS unless a test sets it. */
  timeoutMs?: number;
}

export interface VisionAnswer {
  text: string;
  finish_reason: string | null;
  usage: { prompt_tokens: number | null; completion_tokens: number | null; cost: number | null };
}

/** A vision failure as the database is told it. `detail` is safe to log (an HTTP status at most). */
export class VisionFailure extends Error {
  constructor(
    readonly code: string,
    readonly uncertain: boolean,
    readonly permanent: boolean,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'VisionFailure';
  }
}

/** The trial's request body for the vision model, with the production max_tokens. */
export function visionRequestBody(sourceKey: string, pdf: Uint8Array): Record<string, unknown> {
  return { ...trialRequestBody(VISION_MODEL, sourceKey, pdf), max_tokens: VISION_MAX_TOKENS };
}

/**
 * What a trial error means for the queue. Not billed (uncertain false): nothing reached OpenRouter, or it refused before
 * any work (a rate limit, a 4xx). Possibly billed (uncertain true): a timeout, a 5xx, a dropped connection, an unreadable or
 * empty answer. Final (permanent): the same request would get the same refusal (not a PDF, too large, a bad link, a 4xx).
 */
function failureOf(e: TrialError): VisionFailure {
  const status = typeof e.detail.http_status === 'number' ? e.detail.http_status : null;
  const detail = status === null ? {} : { http_status: status };
  switch (e.code) {
    case 'pdf_fetch_failed':
    case 'openrouter_rate_limited':
      return new VisionFailure(e.code, false, false, detail);
    case 'pdf_too_large':
    case 'not_pdf':
      return new VisionFailure(e.code, false, true, detail);
    case 'openrouter_failed':
      // A 4xx (bad request, key, credits, moderation) was refused before any work; a 5xx or no answer may have been billed.
      return status !== null && status >= 400 && status < 500
        ? new VisionFailure('openrouter_rejected', false, true, detail)
        : new VisionFailure('openrouter_unavailable', true, false, detail);
    case 'openrouter_timeout':
    case 'openrouter_unreadable':
      return new VisionFailure(e.code, true, false, detail);
    case 'openrouter_empty':
      return new VisionFailure('vision_empty', true, false, detail);
    default:
      return new VisionFailure('internal', true, false, detail);
  }
}

/** Reads one document with the vision model. Throws only a VisionFailure. Never logs; the caller logs the outcome. */
export async function callVision(
  deps: VisionDeps,
  request: { source_key: string; official_url: string },
): Promise<VisionAnswer> {
  try {
    if (!officialUrlOk(request.official_url)) throw new VisionFailure('official_url_invalid', false, true);
    const pdf = await fetchPdf(deps, request.official_url);
    return await callOpenRouter(deps, visionRequestBody(request.source_key, pdf));
  } catch (e) {
    if (e instanceof VisionFailure) throw e;
    if (e instanceof TrialError) throw failureOf(e);
    throw new VisionFailure('internal', true, false);
  }
}

/** A marker line exactly as the prompt asks for it, alone on its line. */
const PAGE_MARKER = /^[ \t]*=== PAGE (\d+) ===[ \t\r]*$/gm;

/**
 * The answer split into exactly `expected` page texts, the marker lines removed and each page trimmed; or null when the
 * answer does not have exactly `expected` markers numbered 1 to `expected` in order, or has text before the first one.
 */
export function splitVisionPages(text: string, expected: number): string[] | null {
  const marks = [...text.matchAll(PAGE_MARKER)];
  if (!Number.isInteger(expected) || expected < 1 || marks.length !== expected) return null;
  if (text.slice(0, marks[0].index).trim()) return null;
  const pages: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    if (Number(marks[i][1]) !== i + 1) return null;
    const from = marks[i].index! + marks[i][0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    pages.push(text.slice(from, to).trim());
  }
  return pages;
}
