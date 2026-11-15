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
    return { seq, text: '', seconds_left: secondsLeft };
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
  return { seq, text: outcome.payload.text.trim().slice(0, MAX_TEXT), seconds_left: left };
}
