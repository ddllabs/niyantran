import { ApiError, sqlError } from './apiError.ts';
import type { Ctx } from './types.ts';
import { badRequest, isObject, type Obj, position } from './validate.ts';

const VIDEO_ID = /^[A-Za-z0-9_-]{1,32}$/;
const CHANNEL_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
/** The session lengths, in minutes, that a user may buy (the same list as the SQL function and the table CHECK). */
const SESSION_MINUTES: readonly number[] = [1, 2, 5, 10, 15];

const CONFIRM_TIMEOUT_MS = 4000;
const MAX_CONFIRM_BYTES = 1_000_000;

/** True when the app's uploads list holds this video and says it is neither live nor upcoming. Never throws. */
/** The body as text, or null as soon as it passes the byte cap (the rest is never read). */
async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CONFIRM_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function confirmVideo(ctx: Ctx, videoId: string, channelId: string): Promise<boolean> {
  try {
    const base = (ctx.deps.livetvApiBase ?? '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) return false;
    const res = await ctx.deps.fetch(`${base}/api/livetv/videos?channelId=${encodeURIComponent(channelId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      return false;
    }
    const raw = await readCapped(res);
    if (raw === null) return false;
    // Untrusted data: only the fields below are read. The answer must say it came from the YouTube API
    // itself ('youtube-api'); the curated fallback, a stale cache and a plain 'cache' (which can hold the
    // fallback, see liveTvApi.mjs) are refused. Both flags must be exactly false.
    const body = JSON.parse(raw) as Obj | null;
    if (!isObject(body) || body.ok !== true || body.dataOrigin !== 'youtube-api') return false;
    const list = body.recentVideos;
    if (!Array.isArray(list)) return false;
    return list.some((v) =>
      isObject(v) && (v.videoId ?? v.id) === videoId && v.isLive === false && v.isUpcoming === false
    );
  } catch {
    return false;
  }
}

/** Asks SQL whether sharing is on for this caller, so a start with sharing off costs no fetch and no quota. */
async function sharingOn(ctx: Ctx, isAdmin: boolean): Promise<boolean> {
  try {
    const { data, error } = await ctx.deps.rpc('factcheck_share_on', { p_is_admin: isAdmin === true });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function confirmAndMark(ctx: Ctx, videoId: string, channelId: string, sessionId: string): Promise<boolean> {
  if (!await confirmVideo(ctx, videoId, channelId)) return false;
  try {
    const { data, error } = await ctx.deps.rpc('factcheck_mark_shareable', {
      p_user: ctx.userId,
      p_session: sessionId,
    });
    return !error && isObject(data) && data.ok === true;
  } catch {
    return false;
  }
}

/** Starts a block: validates, asks the SQL function (which holds the credits), returns the session. */
export async function startAction(ctx: Ctx, body: Obj): Promise<Obj> {
  const { video_id, channel_id, video_kind, minutes } = body;
  if (typeof video_id !== 'string' || !VIDEO_ID.test(video_id)) throw badRequest('video_id is not valid.');
  if (typeof channel_id !== 'string' || !CHANNEL_ID.test(channel_id)) throw badRequest('channel_id is not valid.');
  if (video_kind !== 'live' && video_kind !== 'recorded') throw badRequest('video_kind must be live or recorded.');
  if (typeof minutes !== 'number' || !SESSION_MINUTES.includes(minutes)) {
    throw badRequest('minutes must be 1, 2, 5, 10 or 15.');
  }
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
    const answer: Obj = { session_id, credits_per_minute, credits_held, ends_at };
    // Sharing (slice 2): only a recorded video the app's own server confirms is shared; any failure leaves
    // the session private and the start unchanged. The field is present only when a confirmation was tried.
    if (video_kind === 'recorded' && ctx.deps.livetvApiBase && await sharingOn(ctx, isAdmin)) {
      answer.shareable = await confirmAndMark(ctx, video_id, channel_id, session_id);
    }
    return answer;
  }
  switch (data.reason) {
    case 'off':
      throw new ApiError(403, 'Fact-check is not available.', { reason: 'off' });
    case 'not_allowed':
      throw new ApiError(403, 'Fact-check is not available for this account.', { reason: 'not_allowed' });
    case 'bad_minutes':
      throw new ApiError(400, 'minutes must be 1, 2, 5, 10 or 15.', { reason: 'bad_minutes' });
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
