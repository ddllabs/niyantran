import { log } from '../_shared/logging.ts';
import { sessionNotFound, sqlError } from './apiError.ts';
import type { Ctx } from './types.ts';
import { isObject, type Obj, uuid } from './validate.ts';

const END_REASONS = new Set([
  'user_stop',
  'modal_close',
  'channel_change',
  'sharing_stopped',
  'time_up',
  'silence',
  'server',
  'error',
  'other',
]);

/** Why the browser ended the session. Logged only; an unknown or malformed value is ignored, never a 400. */
const endReason = (v: unknown): string | null => (typeof v === 'string' && END_REASONS.has(v) ? v : null);

/** Settles the session (idempotent in SQL: a repeat returns the same figures). */
export async function stopAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const sessionId = uuid(body.session_id, 'session_id');
  const { data, error } = await ctx.deps.rpc('factcheck_settle', { p_user: ctx.userId, p_session: sessionId });
  if (error) throw sqlError(error);
  if (isObject(data)) {
    if (
      data.ok === true && typeof data.minutes_used === 'number' && typeof data.credits_charged === 'number' &&
      (typeof data.balance === 'number' || data.balance === null)
    ) {
      log('factcheck.stop', {
        session_id: sessionId,
        end_reason: endReason(body.end_reason),
        minutes_used: data.minutes_used,
      });
      return { minutes_used: data.minutes_used, credits_charged: data.credits_charged, balance: data.balance };
    }
    if (data.ok === false && data.reason === 'not_found') throw sessionNotFound();
  }
  throw new Error('unexpected factcheck_settle answer');
}
