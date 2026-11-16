import { log } from '../_shared/logging.ts';
import { ApiError, sqlError } from './apiError.ts';
import { verdictFor } from './check.ts';
import { secondsToNextMinute } from './touch.ts';
import type { CheckResult, ClaimRow, Ctx } from './types.ts';
import { badRequest, isObject, type Obj, uuid } from './validate.ts';

const IN_PROGRESS_RETRY_S = 3;
const MAX_PRICE = 1000;

/** Opens a re-check: the SQL function decides who may, and inserts the new pending row. Charges nothing. */
async function begin(ctx: Ctx, claimId: string, expected: number): Promise<{ id: string }> {
  let isAdmin: boolean;
  try {
    isAdmin = await ctx.deps.isAdmin(ctx.token);
  } catch {
    throw new ApiError(503, 'Account verification unavailable.', { reason: 'unavailable' });
  }
  const { data, error } = await ctx.deps.rpc('factcheck_recheck_begin', {
    p_user: ctx.userId,
    p_claim: claimId,
    p_is_admin: isAdmin === true,
    p_expected_credits: expected,
  });
  if (error) throw sqlError(error);
  if (!isObject(data)) throw new Error('unexpected factcheck_recheck_begin answer');
  if (data.ok === true) {
    if (typeof data.claim_id !== 'string') throw new Error('unexpected factcheck_recheck_begin answer');
    return { id: uuid(data.claim_id, 'claim_id') };
  }
  const price = typeof data.recheck_credits === 'number' ? { recheck_credits: data.recheck_credits } : {};
  switch (data.reason) {
    case 'off':
      throw new ApiError(403, 'Re-check is not available.', { reason: 'off' });
    case 'not_allowed':
      throw new ApiError(403, 'Re-check is not available for this account.', { reason: 'not_allowed' });
    case 'not_found':
      throw new ApiError(404, 'Claim not found.', { reason: 'claim_not_found' });
    case 'not_recheckable':
      throw new ApiError(409, 'This claim cannot be checked again.', { reason: 'not_recheckable', ...price });
    case 'price_changed':
      if ('recheck_credits' in price) {
        throw new ApiError(409, 'The price has changed.', { reason: 'price_changed', ...price });
      }
      break;
    case 'insufficient':
      if (typeof data.needed === 'number' && typeof data.available === 'number') {
        throw new ApiError(402, 'Not enough credits.', {
          reason: 'insufficient',
          needed: data.needed,
          available: data.available,
        });
      }
      break;
    case 'rate_limited':
      throw new ApiError(429, 'Too many re-checks.', { reason: 'rate_limited' }, {
        'Retry-After': String(secondsToNextMinute(ctx.now())),
      });
    case 'in_progress':
      throw new ApiError(429, 'This claim is already being checked again.', { reason: 'in_progress' }, {
        'Retry-After': String(IN_PROGRESS_RETRY_S),
      });
  }
  throw new Error('unexpected factcheck_recheck_begin answer');
}

/** The charge is idempotent in SQL. A failure is logged by claim id and code only; nothing here retries it. */
async function charge(ctx: Ctx, claimId: string): Promise<{ credits_charged: number | null; balance: number | null }> {
  const none = { credits_charged: null, balance: null };
  try {
    const { data, error } = await ctx.deps.rpc('factcheck_recheck_charge', { p_user: ctx.userId, p_claim: claimId });
    if (!error && isObject(data) && data.ok === true && typeof data.credits_charged === 'number') {
      return { credits_charged: data.credits_charged, balance: typeof data.balance === 'number' ? data.balance : null };
    }
    log('factcheck.recheck_charge_failed', { claim_id: claimId, code: error?.code ?? 'unusable_answer' });
  } catch {
    log('factcheck.recheck_charge_failed', { claim_id: claimId, code: 'call_failed' });
  }
  return none;
}

const shown = (c: ClaimRow): Obj => ({
  id: c.id,
  supersedes: c.supersedes ?? null,
  status: c.status,
  verdict: c.verdict,
  reason: c.reason,
  sources: c.sources ?? [],
  checked_at: c.checked_at,
});

const failed = (): CheckResult => ({
  status: 'error',
  verdict: null,
  reason: null,
  sources: [],
  checked_at: new Date().toISOString(),
});

/**
 * Checks a claim again, as a new row that supersedes the old one. The claim text is read from the database
 * (the new row copied it from the old). The model call, parsing and source rules are check's (verdictFor).
 * Charged only when a verdict was saved with status 'checked'.
 */
export async function recheckAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const claimId = uuid(body.claim_id, 'claim_id');
  const expected = body.expected_recheck_credits;
  if (typeof expected !== 'number' || !Number.isFinite(expected) || expected <= 0 || expected > MAX_PRICE) {
    throw badRequest('expected_recheck_credits must be a number above 0 and at most 1000.');
  }
  if (!ctx.deps.apiKey) throw new ApiError(503, 'Fact-check is not configured yet.', { reason: 'unavailable' });

  const created = await begin(ctx, claimId, expected);
  const store = ctx.deps.store;
  const fresh = await store.claimById(ctx.userId, created.id);
  if (!fresh) throw new Error('re-check row missing');
  const session = await store.session(ctx.userId, fresh.session_id);
  if (!session) throw new Error('re-check session missing');

  const save = (result: CheckResult) => store.finishCheck(ctx.userId, fresh.session_id, fresh.id, result);
  let saved: ClaimRow | null;
  try {
    saved = await save(await verdictFor(ctx, { purpose: 'claim_recheck', claim: fresh, session }));
  } catch (error) {
    // The new row must not stay pending: a provider failure, a timeout, a client that went away (the provider
    // call may have been paid for, and nothing will be charged) or a failed save all end as 'error'.
    // Best effort; if even that fails, the SQL treats a pending re-check row older than 90 s as abandoned.
    try {
      await save(failed());
    } catch { /* abandoned after 90 s */ }
    throw error;
  }
  const row = saved ?? await store.claimById(ctx.userId, fresh.id);
  if (!row) throw new Error('re-check row missing');
  log('factcheck.recheck', { claim_id: row.id, status: row.status });
  const paid = row.status === 'checked' ? await charge(ctx, row.id) : { credits_charged: 0, balance: null };
  return { claim: shown(row), ...paid };
}
