import { ApiError, sessionNotFound } from './apiError.ts';
import { log } from '../_shared/logging.ts';
import { clip } from './claimText.ts';
import { chatCompletion, ProviderError } from './modelCall.ts';
import { CHECK_MODEL } from './models.ts';
import { CHECK_SYSTEM, checkUser } from './prompts.ts';
import { touch } from './touch.ts';
import type { CheckResult, ClaimRow, Ctx, FailReason, SessionRow, Source, Verdict } from './types.ts';
import { isObject, type Obj, uuid } from './validate.ts';

/** A check that started longer ago than this is presumed dead, and another request may take over. */
export const CHECK_LEASE_MS = 90_000;
const MAX_SOURCES = 8;
const MAX_URL = 2000;
const IN_PROGRESS_RETRY_S = 3;
const IST_OFFSET_MS = 5.5 * 3_600_000;

const VERDICTS = new Map<string, Verdict>([
  ['Supported', 'supported'],
  ['Contradicted', 'contradicted'],
  ['Partly true', 'partly_true'],
  ['No evidence found', 'no_evidence'],
  ['Opinion', 'opinion'],
]);

const norm = (label: string) => label.replace(/[*_`"'.]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const BY_NORMALISED = new Map([...VERDICTS].map(([label, v]) => [norm(label), v]));

const readLabels = (reply: string) =>
  [...reply.matchAll(/^[\s*_#>-]*label[\s*_]*:[\s*_]*(.+)$/gim)].map((m) => BY_NORMALISED.get(norm(m[1])));

/**
 * Why a reply cannot be saved as a verdict, as exactly one code (null when it can). Beside parseVerdict and
 * agreeing with it: the label rules are the same, then a label other than "No evidence found" needs a source.
 * Looks at the reply only; nothing of it is returned.
 */
export function replyFailure(reply: string | null, sourceCount: number): FailReason | null {
  const labels = readLabels(reply ?? '');
  if (!labels.length) return 'no_label';
  if (labels.some((l) => l === undefined)) return 'bad_label';
  if (new Set(labels).size !== 1) return 'label_conflict';
  return labels[0] !== 'no_evidence' && sourceCount === 0 ? 'no_sources' : null;
}

/**
 * The label and reason from the fixed two-line reply. Read leniently (case, markdown, a trailing full stop,
 * "[1]" citation marks, an extra SOURCES line) but accepted only when every LABEL line names the same one of
 * the five labels. Anything else is undefined.
 */
export function parseVerdict(reply: string): { verdict: Verdict; reason: string | null } | undefined {
  const labels = readLabels(reply);
  if (!labels.length || labels.some((l) => l === undefined) || new Set(labels).size !== 1) return undefined;
  const m = /^[\s*_#>-]*reason[\s*_]*:[\s*_]*([\s\S]*?)(?=^[\s*_#>-]*(?:sources?|label)[\s*_]*:|$(?![\s\S]))/im.exec(
    reply,
  );
  const reason = m ? clip(m[1].replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' '), 400) : '';
  return { verdict: labels[0]!, reason: reason || null };
}

function addSource(out: Source[], seen: Set<string>, rawUrl: unknown, rawTitle: unknown): void {
  if (out.length >= MAX_SOURCES || typeof rawUrl !== 'string' || rawUrl.length > MAX_URL) return;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return; // relative or malformed
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return;
  url.hash = '';
  if (seen.has(url.href)) return;
  seen.add(url.href);
  const title = typeof rawTitle === 'string' ? clip(rawTitle, 200) : '';
  out.push({ url: url.href, title: title || url.hostname });
}

/** Sources from the provider's own annotations and citations: http(s) only, de-duplicated, at most 8. */
export function parseSources(payload: Obj): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  const choice = Array.isArray(payload.choices) && isObject(payload.choices[0]) ? payload.choices[0] : null;
  const annotations = isObject(choice?.message) && Array.isArray(choice.message.annotations)
    ? choice.message.annotations
    : [];
  for (const a of annotations) {
    if (!isObject(a)) continue;
    const c = isObject(a.url_citation) ? a.url_citation : a;
    addSource(out, seen, c.url, c.title);
  }
  if (Array.isArray(payload.citations)) { for (const url of payload.citations) addSource(out, seen, url, null); }
  return out;
}

/** 'aaj-tak' -> 'Aaj Tak'. The channel's own name is not stored with the session; the id's words are. */
const channelName = (id: string) =>
  id.split(/[-_.:]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || id;

const stored = (c: ClaimRow): Obj => ({
  id: c.id,
  status: c.status,
  verdict: c.verdict,
  reason: c.reason,
  sources: c.sources ?? [],
  checked_at: c.checked_at,
  fail_reason: c.fail_reason ?? null,
});

/**
 * The model call, parsing and source rules shared by check and recheck: asks sonar about the claim's stored
 * text and returns what to save. Throws ProviderError (502) when the provider fails, times out or the client
 * goes away; every other outcome is a result. `citations` is how many sources the provider gave (kept for the
 * log: an error result stores none).
 */
export async function verdictFor(
  ctx: Ctx,
  p: { purpose: 'claim_check' | 'claim_recheck'; claim: ClaimRow; session: SessionRow; detached?: boolean },
): Promise<{ result: CheckResult; citations: number }> {
  const now = ctx.now();
  const { payload, text } = await chatCompletion(ctx, {
    purpose: p.purpose,
    detached: p.detached,
    model: CHECK_MODEL,
    sessionId: p.session.id,
    system: CHECK_SYSTEM,
    user: checkUser({
      date: new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10),
      claim: p.claim.claim_en,
      claimant: p.claim.claimant,
      reportedBy: p.claim.reported_by,
      channel: channelName(p.session.channel_id),
      kind: p.session.video_kind,
    }),
    maxTokens: 700,
    // The call is logged as an error row ("unusable: <code>") when the reply cannot be saved, not as a success.
    unusable: (payload, reply) => replyFailure(reply, parseSources(payload).length),
    // No provider block: perplexity/sonar returns 404 under require_parameters (live probe 2026-11-16),
    // and data_collection: 'deny' for it was not probed. The claim text sent is already public speech.
  });
  const parsed = text === null ? undefined : parseVerdict(text);
  const sources = parseSources(payload);
  const at = new Date(now).toISOString();
  // Anything but one of the five labels is an error, never a verdict, and its text is not kept. So is a
  // verdict with no source, unless it says no evidence was found. The error carries one reason code.
  const fail = replyFailure(text, sources.length);
  const result: CheckResult = parsed && !fail
    ? { status: 'checked', verdict: parsed.verdict, reason: parsed.reason, sources, checked_at: at, fail_reason: null }
    : {
      status: 'error',
      verdict: null,
      reason: null,
      sources: [],
      checked_at: at,
      fail_reason: fail ?? 'no_label',
    };
  return { result, citations: sources.length };
}

/**
 * Checks one pending claim. The text sent to the model is read from the database by claim, session and
 * user; nothing but the two ids is taken from the request. A conditional update claims the row before the
 * model is called, so two simultaneous requests cannot both spend. The reply is plain text in a fixed format
 * (see CHECK_SYSTEM); sources come from the provider's citations.
 */
export async function checkAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const sessionId = uuid(body.session_id, 'session_id');
  const claimId = uuid(body.claim_id, 'claim_id');
  if (!ctx.deps.apiKey) throw new ApiError(503, 'Fact-check is not configured yet.', { reason: 'unavailable' });

  await touch(ctx, sessionId, 'check');
  const store = ctx.deps.store;
  const claim = await store.claim(ctx.userId, sessionId, claimId);
  if (!claim) throw new ApiError(404, 'Claim not found.', { reason: 'claim_not_found' });
  // Whatever state it is in, a claim that is not pending returns as stored: the browser shows it as it is
  // (a 409 would end the whole session in the browser).
  if (claim.status !== 'pending') return stored(claim);
  const session = await store.session(ctx.userId, sessionId);
  if (!session) throw sessionNotFound();

  const now = ctx.now();
  const at = new Date(now).toISOString();
  if (!await store.lockForCheck(ctx.userId, sessionId, claimId, at, new Date(now - CHECK_LEASE_MS).toISOString())) {
    const again = await store.claim(ctx.userId, sessionId, claimId);
    if (again && (again.status === 'checked' || again.status === 'error')) return stored(again);
    // The browser retries a 429 after Retry-After, and then reads the stored result.
    throw new ApiError(429, 'This claim is already being checked.', { reason: 'in_progress' }, {
      'Retry-After': String(IN_PROGRESS_RETRY_S),
    });
  }

  let row: ClaimRow | null;
  let citations: number | null = null;
  try {
    const outcome = await verdictFor(ctx, { purpose: 'claim_check', claim, session });
    citations = outcome.citations;
    row = await store.finishCheck(ctx.userId, sessionId, claimId, outcome.result);
  } catch (error) {
    // A client that went away keeps the lease: the provider may well have been paid, and a retry within
    // the lease must not pay again. Every other failure hands the claim back so a retry can run; a failed
    // release only means the lease expires.
    if (!(error instanceof ProviderError && error.aborted)) {
      try {
        await store.releaseCheck(ctx.userId, sessionId, claimId);
      } catch { /* the lease will expire */ }
    }
    throw error;
  }
  log('factcheck.check', {
    session_id: sessionId,
    claim_id: claimId,
    status: row?.status ?? 'unknown',
    fail_reason: row?.fail_reason ?? null,
    citations,
  });
  if (row) return stored(row);
  const current = await store.claim(ctx.userId, sessionId, claimId);
  if (!current) throw new ApiError(404, 'Claim not found.', { reason: 'claim_not_found' });
  return stored(current);
}
