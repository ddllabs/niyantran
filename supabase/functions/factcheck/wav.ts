// Parses a RIFF/WAVE header by hand. The browser sends 16 kHz mono 16-bit PCM pieces of about 10 s
// (src/lib/factcheck/pieces.js encodeWav); nothing else is accepted, whatever the content type says.
// The declared sizes must agree with the bytes received, so a header cannot describe less audio than
// the file carries. The level is measured from the samples, not taken from the client.

export const MAX_WAV_BYTES = 600_000;
export const MAX_WAV_SECONDS = 15;
/** Shorter pieces are valid but never sent to the provider (the caller treats them as silent). */
export const MIN_WAV_SECONDS = 0.5;
export const WAV_RATE = 16_000;
/** RMS (full scale 1.0) under which a piece is silent: -46 dBFS, the same as pieces.js isSilent. */
export const SILENCE_RMS = 0.005;

export class WavError extends Error {}

export interface WavInfo {
  samples: number;
  seconds: number;
  rms: number;
}

const fourcc = (v: DataView, at: number) =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

export function parseWav(bytes: Uint8Array): WavInfo {
  if (bytes.length > MAX_WAV_BYTES) throw new WavError('Audio is too large.');
  if (bytes.length < 44) throw new WavError('Not a WAV file.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourcc(v, 0) !== 'RIFF' || fourcc(v, 8) !== 'WAVE') throw new WavError('Not a WAV file.');
  if (v.getUint32(4, true) !== bytes.length - 8) throw new WavError('The WAV header size is wrong.');

  let at = 12;
  let fmt = false;
  let dataAt = -1;
  let dataLen = 0;
  while (at + 8 <= bytes.length) {
    const id = fourcc(v, at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (body + size > bytes.length) throw new WavError('A WAV chunk runs past the end of the file.');
    if (id === 'fmt ') {
      if (size !== 16) throw new WavError('Unsupported WAV format chunk.');
      const rate = v.getUint32(body + 4, true);
      const ok = v.getUint16(body, true) === 1 && v.getUint16(body + 2, true) === 1 && rate === WAV_RATE &&
        v.getUint32(body + 8, true) === WAV_RATE * 2 && v.getUint16(body + 12, true) === 2 &&
        v.getUint16(body + 14, true) === 16;
      if (!ok) throw new WavError('Audio must be 16 kHz mono 16-bit PCM.');
      fmt = true;
    } else if (id === 'data') {
      if (!fmt) throw new WavError('The WAV data comes before its format.');
      dataAt = body;
      dataLen = size;
      at = body + size;
      break;
    }
    at = body + size + (size & 1);
  }
  if (dataAt < 0) throw new WavError('The WAV file has no audio data.');
  if (at !== bytes.length) throw new WavError('The WAV file has bytes beyond its audio data.');
  if (dataLen === 0 || dataLen % 2 !== 0) throw new WavError('The WAV audio data is empty or incomplete.');
  const samples = dataLen / 2;
  const seconds = samples / WAV_RATE;
  if (seconds > MAX_WAV_SECONDS) throw new WavError('Audio is too long.');

  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = v.getInt16(dataAt + i * 2, true) / 32768;
    sum += s * s;
  }
  return { samples, seconds, rms: Math.sqrt(sum / samples) };
}
