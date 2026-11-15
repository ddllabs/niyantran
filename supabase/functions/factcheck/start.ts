import { ApiError, sqlError } from './apiError.ts';
import type { Ctx } from './types.ts';
import { badRequest, isObject, type Obj, position } from './validate.ts';

const VIDEO_ID = /^[A-Za-z0-9_-]{1,32}$/;
const CHANNEL_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Starts a block: validates, asks the SQL function (which holds the credits), returns the session. */
export async function startAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const { video_id, channel_id, video_kind, minutes } = body;
  if (typeof video_id !== 'string' || !VIDEO_ID.test(video_id)) throw badRequest('video_id is not valid.');
  if (typeof channel_id !== 'string' || !CHANNEL_ID.test(channel_id)) throw badRequest('channel_id is not valid.');
  if (video_kind !== 'live' && video_kind !== 'recorded') throw badRequest('video_kind must be live or recorded.');
  if (minutes !== 5 && minutes !== 10 && minutes !== 15) throw badRequest('minutes must be 5, 10 or 15.');
  const startPosition = position(body.start_position_s, 'start_position_s');
  // The price the browser showed; the SQL function refuses with price_changed if the flag now differs.
  const expected = body.expected_credits_per_minute;
  if (
    expected !== undefined && expected !== null &&
    (typeof expected !== 'number' || !Number.isFinite(expected) || expected <= 0 || expected > 5000)
  ) {
    throw badRequest('expected_credits_per_minute must be a number above 0 and at most 5000.');
  }

  // Asked with the caller's own token, so the answer is about this bearer. Never read from the request.
  let isAdmin: boolean;
  try {
    isAdmin = await ctx.deps.isAdmin(ctx.token);
  } catch {
    throw new ApiError(503, 'Account verification unavailable.', { reason: 'unavailable' });
  }

  const { data, error } = await ctx.deps.rpc('factcheck_start', {
    p_user: ctx.userId,
    p_video_id: video_id,
    p_channel_id: channel_id,
    p_video_kind: video_kind,
    p_start_position_s: startPosition,
    p_minutes: minutes,
    p_is_admin: isAdmin === true,
    p_expected_cpm: expected ?? null,
  });
  if (error) throw sqlError(error);
  if (!isObject(data)) throw new Error('unexpected factcheck_start answer');
  if (data.ok === true) {
    const { session_id, credits_per_minute, credits_held, ends_at } = data;
    if (
      typeof session_id !== 'string' || typeof credits_per_minute !== 'number' || typeof credits_held !== 'number' ||
      typeof ends_at !== 'string'
    ) {
      throw new Error('unexpected factcheck_start answer');
    }
    return { session_id, credits_per_minute, credits_held, ends_at };
  }
  switch (data.reason) {
    case 'off':
      throw new ApiError(403, 'Fact-check is not available.', { reason: 'off' });
    case 'not_allowed':
      throw new ApiError(403, 'Fact-check is not available for this account.', { reason: 'not_allowed' });
    case 'bad_minutes':
      throw new ApiError(400, 'minutes must be 5, 10 or 15.', { reason: 'bad_minutes' });
    case 'already_active':
      throw new ApiError(409, 'A fact-check session is already running.', {
        reason: 'already_active',
        ...(typeof data.session_id === 'string' ? { session_id: data.session_id } : {}),
      });
    case 'price_changed':
      if (typeof data.credits_per_minute === 'number') {
        throw new ApiError(409, 'The price has changed.', {
          reason: 'price_changed',
          credits_per_minute: data.credits_per_minute,
        });
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
  }
  throw new Error('unexpected factcheck_start answer');
}
