import { ApiError } from './apiError.ts';
import { log } from '../_shared/logging.ts';
import { callProvider } from './modelCall.ts';
import { OPENROUTER_TRANSCRIPTIONS_URL, TRANSCRIPTION_MODEL } from './models.ts';
import { touch } from './touch.ts';
import type { Ctx } from './types.ts';
import { badRequest, type Obj, uuid } from './validate.ts';
import { MIN_WAV_SECONDS, parseWav, SILENCE_RMS, WavError } from './wav.ts';

const FAILED = 'Transcription failed. Try again.';
const MAX_TEXT = 5000;

/**
 * One piece of audio. The WAV header is parsed here (not trusted from the content type), the session is
 * touched before any provider call, and a silent piece never reaches the provider. The audio lives only
 * in this request: it is not written to storage, a table or a log.
 */
export async function transcribeAction(ctx: Ctx, form: FormData): Promise<Obj> {
  const sessionId = uuid(form.get('session_id'), 'session_id');
  const seqText = form.get('seq');
  if (typeof seqText !== 'string' || !/^\d{1,9}$/.test(seqText)) {
    throw badRequest('seq must be a non-negative integer.');
  }
  const seq = Number(seqText);
  // Optional, for a shareable session: where in the video this piece sits. All three, well formed, or the
  // fields are ignored and this is a slice 1 piece: a bad position must never fail a transcription.
  const num = (v: FormDataEntryValue | null) =>
    typeof v === 'string' && /^\d{1,8}(\.\d{1,3})?$/.test(v) ? Number(v) : NaN;
  const no = form.get('piece_no');
  const start = num(form.get('pos_start_s'));
  const end = num(form.get('pos_end_s'));
  const place = typeof no === 'string' && /^\d{1,9}$/.test(no) && start <= 10_000_000 && end <= 10_000_000
    ? { pieceNo: Number(no), start, end }
    : null;
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('An audio file is required.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let info;
  try {
    info = parseWav(bytes);
  } catch (error) {
    if (error instanceof WavError) throw badRequest(error.message);
    throw error;
  }
  if (!ctx.deps.apiKey) throw new ApiError(503, 'Fact-check is not configured yet.', { reason: 'unavailable' });

  const secondsLeft = await touch(ctx, sessionId, 'transcribe');
  const touchedAt = ctx.now();
  // A silent piece, or one under half a second (a short final piece), is not worth a provider call but
  // still counts as activity.
  if (info.rms < SILENCE_RMS || info.seconds < MIN_WAV_SECONDS) {
    log('factcheck.transcribe', { session_id: sessionId, seq, seconds: info.seconds, silent: true });
    return { seq, text: '', seconds_left: secondsLeft, ...(place ? { stored: false } : {}) };
  }

  const body = new FormData();
  body.append('file', new Blob([bytes as BlobPart], { type: 'audio/wav' }), 'piece.wav');
  body.append('model', TRANSCRIPTION_MODEL);
  body.append('response_format', 'json');
  const outcome = await callProvider(
    ctx,
    { purpose: 'transcription', model: TRANSCRIPTION_MODEL, sessionId },
    (signal) =>
      ctx.deps.fetch(OPENROUTER_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.deps.apiKey}` },
        body,
        signal,
      }),
    (payload) => typeof payload.text === 'string',
  );
  log('factcheck.transcribe', {
    session_id: sessionId,
    seq,
    seconds: info.seconds,
    silent: false,
    status: outcome.status,
  });
  if (!outcome.ok || typeof outcome.payload?.text !== 'string') {
    throw new ApiError(502, FAILED, { reason: 'model_failed' });
  }
  // The touch counted the block from its own clock; the provider call has used part of what it reported.
  const left = Math.max(0, Math.ceil(secondsLeft - (ctx.now() - touchedAt) / 1000));
  const text = outcome.payload.text.trim().slice(0, MAX_TEXT);
  const answer: Obj = { seq, text, seconds_left: left };
  // Stored only when the declared length matches the audio actually sent (within 1.5 s), so a position
  // range cannot inflate or shrink what a stretch costs to unlock.
  const honest = place !== null && Math.abs(place.end - place.start - info.seconds) <= 1.5;
  if (place) answer.stored = text && honest ? await storePiece(ctx, sessionId, place, text) : false;
  return answer;
}

/** A refusal or a failure to store is not an error: the piece was transcribed, it is simply not shared. */
async function storePiece(
  ctx: Ctx,
  sessionId: string,
  place: { pieceNo: number; start: number; end: number },
  text: string,
): Promise<boolean> {
  try {
    const { data, error } = await ctx.deps.rpc('factcheck_piece_store', {
      p_user: ctx.userId,
      p_session: sessionId,
      p_piece_no: place.pieceNo,
      p_pos_start_s: place.start,
      p_pos_end_s: place.end,
      p_text: text,
    });
    return !error && !!data && typeof data === 'object' && (data as Obj).ok === true;
  } catch {
    return false;
  }
}
