import { requireUser, type Verify } from '../_shared/auth.ts';
import { allowedOrigins, corsHeaders, originAllowed, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 16384;
const TYPES = new Set(['audio/webm', 'video/webm', 'audio/mp4', 'video/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg']);
export interface TranscriptionDeps {
  verify?: Verify;
  active(token: string, userId: string): Promise<boolean>;
  apiKey: string;
  fetch(input: string, init: RequestInit): Promise<Response>;
  origins?: string[];
}
async function audioFile(req: Request): Promise<File> {
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new HttpError(400, 'Expected an audio recording.');
  const declared = Number(req.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'Recording is too large.');
  if (!req.body) throw new HttpError(400, 'No audio recorded.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, 'Recording is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'content-type': req.headers.get('content-type')! } }).formData(); }
  catch { throw new HttpError(400, 'Invalid audio recording.'); }
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || !TYPES.has(file.type.split(';')[0])) throw new HttpError(400, 'Invalid audio recording.');
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'Recording is too large.');
  return file;
}

export async function handleTranscription(req: Request, deps: TranscriptionDeps): Promise<Response> {
  const origins = deps.origins ?? allowedOrigins();
  const pre = preflight(req, origins);
  if (pre) return pre;
  const cors = { ...corsHeaders(req, origins), 'Cache-Control': 'no-store' };
  try {
    const origin = req.headers.get('origin');
    if (origin && !originAllowed(origin, origins)) throw new HttpError(403, 'Origin not allowed.');
    if (req.method !== 'POST') throw new HttpError(405, 'POST only.');
    const { token, userId } = await requireUser(req, deps.verify);
    if (!await deps.active(token, userId)) throw new HttpError(403, 'An active account is required.');
    if (!deps.apiKey) throw new HttpError(503, 'Dictation is not configured yet.');
    const file = await audioFile(req);
    const body = new FormData();
    const extension = file.type.includes('mp4') ? 'mp4' : file.type.includes('webm') ? 'webm' : file.type.includes('ogg') ? 'ogg' : file.type.includes('mpeg') ? 'mp3' : 'wav';
    body.append('file', file, `dictation.${extension}`);
    body.append('model', 'openai/whisper-large-v3-turbo'); body.append('response_format', 'json');
    let response: Response;
    try {
      response = await deps.fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${deps.apiKey}` }, body,
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(40000)]),
      });
    } catch { throw new HttpError(502, 'Transcription failed. Try again.'); }
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, 'Transcription failed. Try again.'); }
    let result;
    try { result = await response.json(); }
    catch { throw new HttpError(502, 'Transcription failed. Try again.'); }
    if (typeof result.text !== 'string') throw new HttpError(502, 'Transcription failed. Try again.');
    return json({ text: result.text.trim() }, 200, cors);
  } catch (error) { return errorResponse(error, cors); }
}
