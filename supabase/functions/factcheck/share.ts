// The three actions of shared results on recorded videos (slice 2). None of them is part of a session's
// time or budget, so none calls factcheck_touch; all of them pass the common gate. The admin flag is asked
// with the caller's own token, never read from a request.

import { ApiError, sqlError } from './apiError.ts';
import { clip } from './claimText.ts';
import { secondsToNextMinute } from './touch.ts';
import type { Ctx } from './types.ts';
import { badRequest, isObject, type Obj, uuid } from './validate.ts';

const VIDEO_ID = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_REASON = 300;
const MAX_EXPECTED = 10_000_000;

async function isAdmin(ctx: Ctx): Promise<boolean> {
  try {
    return (await ctx.deps.isAdmin(ctx.token)) === true;
  } catch {
    throw new ApiError(503, 'Account verification unavailable.', { reason: 'unavailable' });
  }
}

const unexpected = (name: string) => new Error(`unexpected ${name} answer`);

/** The shared stretches of one recorded video, and what the caller may see of each. */
export async function videoViewAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const videoId = body.video_id;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) throw badRequest('video_id is not valid.');
  const { data, error } = await ctx.deps.rpc('factcheck_video_view', {
    p_user: ctx.userId,
    p_video_id: videoId,
    p_is_admin: await isAdmin(ctx),
  });
  if (error) throw sqlError(error);
  if (!isObject(data)) throw unexpected('factcheck_video_view');
  if (data.ok === true && Array.isArray(data.stretches) && typeof data.unlock_credits_per_minute === 'number') {
    return { unlock_credits_per_minute: data.unlock_credits_per_minute, stretches: data.stretches };
  }
  if (data.ok === false && (data.reason === 'off' || data.reason === 'not_allowed')) {
    throw new ApiError(403, 'Shared results are not available.', { reason: data.reason });
  }
  throw unexpected('factcheck_video_view');
}

/** Unlocks one stretch for its price (charged in SQL, once: a repeat charges nothing). */
export async function unlockAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const stretch = uuid(body.stretch_id, 'stretch_id');
  const expected = body.expected_credits;
  if (typeof expected !== 'number' || !Number.isFinite(expected) || expected <= 0 || expected > MAX_EXPECTED) {
    throw badRequest('expected_credits must be a number above 0.');
  }
  const { data, error } = await ctx.deps.rpc('factcheck_unlock', {
    p_user: ctx.userId,
    p_stretch: stretch,
    p_is_admin: await isAdmin(ctx),
    p_expected_credits: expected,
  });
  if (error) throw sqlError(error);
  if (!isObject(data)) throw unexpected('factcheck_unlock');
  if (data.ok === true) {
    return {
      repeated: data.repeated === true,
      ...(typeof data.credits_charged === 'number' ? { credits_charged: data.credits_charged } : {}),
      ...(typeof data.balance === 'number' ? { balance: data.balance } : {}),
    };
  }
  switch (data.reason) {
    case 'off':
    case 'not_allowed':
      throw new ApiError(403, 'Shared results are not available.', { reason: data.reason });
    case 'not_found':
      throw new ApiError(404, 'Stretch not found.', { reason: 'not_found' });
    case 'own':
      throw new ApiError(409, 'You ran this stretch yourself.', { reason: 'own' });
    case 'price_changed':
      if (typeof data.price === 'number') {
        throw new ApiError(409, 'The price has changed.', { reason: 'price_changed', price: data.price });
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
      throw new ApiError(429, 'Too many unlocks.', { reason: 'rate_limited' }, {
        'Retry-After': String(secondsToNextMinute(ctx.now())),
      });
  }
  throw unexpected('factcheck_unlock');
}

/** Reports a verdict the caller can read. The reason is optional and clipped. */
export async function reportAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const claim = uuid(body.claim_id, 'claim_id');
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
    throw badRequest('reason must be text.');
  }
  const { data, error } = await ctx.deps.rpc('factcheck_report', {
    p_user: ctx.userId,
    p_claim: claim,
    p_reason: typeof body.reason === 'string' ? clip(body.reason, MAX_REASON) : '',
  });
  if (error) throw sqlError(error);
  if (!isObject(data)) throw unexpected('factcheck_report');
  if (data.ok === true) return { reported: true };
  switch (data.reason) {
    case 'off':
      throw new ApiError(403, 'Reporting is not available.', { reason: 'off' });
    case 'not_found':
      throw new ApiError(404, 'Claim not found.', { reason: 'claim_not_found' });
    case 'already':
      throw new ApiError(409, 'You have already reported this verdict.', { reason: 'already' });
    case 'rate_limited':
      // A daily limit: no Retry-After, the browser must not retry it within the minute.
      throw new ApiError(429, 'Too many reports today.', { reason: 'rate_limited' });
  }
  throw unexpected('factcheck_report');
}
