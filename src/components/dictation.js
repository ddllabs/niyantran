import { accessToken, functionsUrl } from '../lib/supabaseClient.js';

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_RECORD_MS = 60000;

export async function transcribeAudio(blob, signal) {
  const token = await accessToken();
  if (!token) throw new Error('Sign in to use dictation.');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const body = new FormData();
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  body.append('file', blob, `dictation.${extension}`);
  const response = await fetch(functionsUrl('transcribe-audio'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body, signal,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in again to use dictation.');
    if (response.status === 413) throw new Error('Recording is too large. Try a shorter recording.');
    if (response.status === 503) throw new Error('Dictation is not configured yet.');
    throw new Error('Transcription failed. Try again.');
  }
  const result = await response.json();
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('No speech recognized. Try again.');
  return result.text.trim();
}

/** Owns every track, timer and request; cancel invalidates even non-cancellable late results. */
export function createDictation({ media = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
  transcribe = transcribeAudio, onState, onTranscript, onError = () => {}, onAudio = () => {} }) {
  let generation = 0;
  let recorder, stream, timer, request, requestTimer, visualStop;
  let state = 'idle';
  function release() { visualStop?.(); visualStop = null; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); stream = null; }
  function update(next) { state = next; onState(next); }
  function cancel() {
    generation++;
    request?.abort(); clearTimeout(requestTimer);
    if (recorder?.state === 'recording') recorder.stop();
    release(); update('idle');
  }
  function fail(error) {
    cancel(); update('error');
    onError(error?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow access and try again.'
      : error?.message || 'Could not record audio. Try again.');
  }
  async function start() {
    if (state === 'recording' || state === 'transcribing' || state === 'requesting') return;
    const run = ++generation;
    update('requesting');
    try {
      if (!media?.getUserMedia || !Recorder) throw new Error('Dictation is not supported in this browser.');
      const acquired = await media.getUserMedia({ audio: true });
      if (run !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => Recorder.isTypeSupported(type));
      recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      let bytes = 0;
      recorder.ondataavailable = event => {
        if (run !== generation || !event.data?.size) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) { fail(new Error('Recording is too large. Try a shorter recording.')); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => { if (run === generation) fail(new Error('Could not record audio. Try again.')); };
      recorder.onstop = async () => {
        if (run !== generation) return;
        release();
        if (!bytes) { fail(new Error('No audio recorded. Try again.')); return; }
        update('transcribing'); request = new AbortController();
        requestTimer = setTimeout(() => request.abort(), 45000);
        try {
          const text = await transcribe(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }), request.signal);
          if (run !== generation) return;
          onTranscript(text); update('idle');
        } catch (error) { if (run === generation) fail(error); }
        finally { clearTimeout(requestTimer); }
      };
      recorder.start(1000); update('recording'); visualStop = onAudio(stream);
      timer = setTimeout(stop, MAX_RECORD_MS);
    } catch (error) { if (run === generation) fail(error); }
  }
  function stop() { if (recorder?.state === 'recording') recorder.stop(); }
  return { start, stop, cancel };
}
