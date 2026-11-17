import { assertAlmostEquals, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { MAX_WAV_BYTES, MIN_WAV_SECONDS, parseWav, SILENCE_RMS, WavError } from './wav.ts';
import { tone, wav } from './testkit.ts';

const refuses = (bytes: Uint8Array, why: string) => {
  const e = assertThrows(() => parseWav(bytes), WavError);
  assertEquals(typeof e.message, 'string', why);
};

Deno.test('a 16 kHz mono 16-bit PCM file is accepted, with its length and level measured from the samples', () => {
  const info = parseWav(wav({ seconds: 2 }));
  assertEquals(info.samples, 32000);
  assertAlmostEquals(info.seconds, 2, 1e-9);
  assertEquals(info.rms > 0.1 && info.rms < 0.3, true, `rms ${info.rms}`);
});

Deno.test('silence measures below the threshold and the threshold matches the browser (pieces.js isSilent: 0.005)', () => {
  assertEquals(SILENCE_RMS, 0.005);
  assertEquals(parseWav(wav({ samples: new Int16Array(16000) })).rms, 0);
  // an amplitude just under -46 dBFS (164 / 32768 = 0.005) is silent, just over is not
  const quiet = parseWav(wav({ samples: new Int16Array(16000).fill(150) })).rms;
  const audible = parseWav(wav({ samples: new Int16Array(16000).fill(180) })).rms;
  assertEquals(quiet < SILENCE_RMS, true);
  assertEquals(audible >= SILENCE_RMS, true);
});

Deno.test('a file with the wrong magic, wave tag, format, channels, rate or bit depth is refused', () => {
  refuses(wav({ magic: 'RIFX' }), 'magic');
  refuses(wav({ wave: 'AVI ' }), 'wave tag');
  refuses(wav({ format: 3 }), 'float');
  refuses(wav({ format: 0xfffe }), 'extensible');
  refuses(wav({ rate: 44100 }), 'rate');
  refuses(wav({ rate: 8000 }), 'rate 8k');
  refuses(wav({ channels: 2 }), 'stereo');
  refuses(wav({ bits: 8 }), '8-bit');
  refuses(wav({ bits: 24 }), '24-bit');
});

Deno.test('a truncated header, an empty file and text are refused', () => {
  refuses(new Uint8Array(0), 'empty');
  refuses(wav().slice(0, 11), 'cut in the riff header');
  refuses(wav().slice(0, 30), 'cut in the fmt chunk');
  refuses(wav().slice(0, 43), 'cut before the data size');
  refuses(new TextEncoder().encode('RIFF this is not audio at all, only text that is long enough'), 'text');
  refuses(wav({ samples: new Int16Array(0) }), 'no samples');
});

Deno.test('a header whose lengths lie about the data is refused', () => {
  refuses(wav({ dataSize: 10_000_000 }), 'data size beyond the file');
  refuses(wav({ dataSize: 100 }), 'data size smaller than the bytes that follow');
  refuses(wav({ riffSize: 12 }), 'riff size wrong');
  refuses(wav({ extraBytes: 40 }), 'trailing bytes');
  refuses(wav({ truncateTo: 5000 }), 'body cut short');
  refuses(wav({ dataSize: 3 }), 'odd data size');
});

Deno.test('more than 15 seconds of audio and more than 600 kB are refused; exactly 15 seconds is allowed', () => {
  refuses(wav({ seconds: 15.1 }), 'over 15 s');
  parseWav(wav({ seconds: 15 }));
  assertEquals(MAX_WAV_BYTES, 600_000);
  refuses(new Uint8Array(MAX_WAV_BYTES + 1), 'over 600 kB');
});

Deno.test('a chunk before the data chunk is skipped by its declared size', () => {
  const base = wav({ samples: tone(8000) });
  const list = new Uint8Array(12);
  new TextEncoder().encodeInto('LIST', list);
  new DataView(list.buffer).setUint32(4, 4, true);
  const out = new Uint8Array(base.length + 12);
  out.set(base.slice(0, 36), 0);
  out.set(list, 36);
  out.set(base.slice(36), 48);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  assertEquals(parseWav(out).samples, 8000);
});

Deno.test('a valid piece shorter than half a second parses (the caller treats it as silent); a malformed one is still refused', () => {
  assertEquals(parseWav(wav({ seconds: 0.3 })).seconds < MIN_WAV_SECONDS, true);
  parseWav(wav({ seconds: 0.5 }));
  refuses(wav({ seconds: 0.3, rate: 44100 }), 'short and malformed');
});
