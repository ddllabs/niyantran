// factcheck_touch is the session check and the rate limiter for every piece of work. Its refusals map
// to statuses the browser already understands (src/lib/factcheck/session.js).

import { ApiError, sessionNotFound, sqlError } from './apiError.ts';
import type { Ctx } from './types.ts';
import { isObject } from './validate.ts';

/** Whole seconds left in the current calendar minute (1 to 60): the SQL limiter counts per minute. */
export function secondsToNextMinute(nowMs: number): number {
  return 60 - Math.floor((nowMs % 60_000) / 1000);
}

/** Resolves to seconds left in the block, or throws the ApiError for the refusal. */
export async function touch(ctx: Ctx, sessionId: string, action: 'transcribe' | 'extract' | 'check'): Promise<number> {
  const { data, error } = await ctx.deps.rpc('factcheck_touch', {
    p_user: ctx.userId,
    p_session: sessionId,
    p_action: action,
  });
  if (error) throw sqlError(error);
  if (isObject(data)) {
    if (data.ok === true) {
      return typeof data.seconds_left === 'number' && Number.isFinite(data.seconds_left) ? data.seconds_left : 0;
    }
    switch (data.reason) {
      case 'not_found':
        throw sessionNotFound();
      case 'settled':
      case 'ended':
        throw new ApiError(409, 'The session is over.', { reason: data.reason });
      case 'off':
        // The flag was switched off while the session ran.
        throw new ApiError(403, 'Fact-check is not available.', { reason: 'off' });
      case 'budget':
        // The session's extract and check budget is used up. No Retry-After: the browser must not retry it.
        throw new ApiError(429, 'This session has used its analysis budget.', { reason: 'budget' });
      case 'rate_limited':
        throw new ApiError(429, 'Too many requests.', { reason: 'rate_limited' }, {
          'Retry-After': String(secondsToNextMinute(ctx.now())),
        });
    }
  }
  throw new Error('unexpected factcheck_touch answer');
}
