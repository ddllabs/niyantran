// F344 T5: pure helpers for the live fact-check browser pipeline. No browser
// APIs here, so everything is testable in Node.
//
// Audio arrives as 16 kHz mono frames and leaves as pieces of about 10 s, each
// posted to the factcheck Edge Function. Transcripts come back as text that
// has to be cleaned (sound tags), joined (overlap de-duplication) and grouped
// into turns for claim extraction.

export const RATE = 16000;

// ---- cutting -------------------------------------------------------------

const FRAME_MS = 20;
export const PIECE_DEFAULTS = Object.freeze({
  targetMs: 10000,   // aim for a piece about this long
  minMs: 8000,       // a pause is only used when it lies between minMs ...
  maxMs: 12000,      // ... and maxMs; at maxMs the piece is cut regardless
  overlapMs: 1000,   // each piece starts this long before the previous cut
  pauseMs: 300,      // a pause is at least this much low-energy audio
  pauseRms: 0.01,    // frame RMS below this (about -40 dBFS) is quiet
  minTailMs: 250,    // flush drops a final tail with less new audio than this
  quietWindowMs: 200,  // fallback: the quietest window of this length in [minMs, maxMs] ...
  quietRatio: 0.5,     // ... is used when its mean energy is under this times the median
});

/** Piece length is measured from the previous cut (new audio), overlap excluded. */
function toFloat(frame) {
  if (frame instanceof Float32Array) return frame;
  const out = new Float32Array(frame.length);
  if (frame instanceof Int16Array) for (let i = 0; i < frame.length; i++) out[i] = frame[i] / 32768;
  else for (let i = 0; i < frame.length; i++) out[i] = frame[i];
  return out;
}

/**
 * Incremental piece cutter for live audio. push(samples) returns the pieces
 * completed by those samples; flush() returns the last partial piece.
 *
 * Rules: a cut is made in the middle of the quiet run (>= pauseMs) whose
 * midpoint lies in [minMs, maxMs] from the previous cut and is nearest
 * targetMs; the check starts once targetMs of audio is held, so the first pause
 * heard from then on is used as soon as it is long enough. With no pause the
 * absolute pause exists (news audio under a music bed), the middle of the quietest
 * 200 ms window is used when it is clearly quieter than the median energy (ratio
 * quietRatio); otherwise the piece is cut at maxMs. Each piece after the first begins overlapMs before
 * the previous cut. All cuts fall on 20 ms frame boundaries, so results do not
 * depend on how the caller chunks the samples.
 */
export function createPieceCutter(options = {}) {
  const o = { ...PIECE_DEFAULTS, ...options };
  const frameLen = Math.round((RATE * FRAME_MS) / 1000);
  const overlapSamples = Math.round((o.overlapMs / FRAME_MS)) * frameLen;
  const targetFrames = Math.round(o.targetMs / FRAME_MS);
  const minFrames = Math.round(o.minMs / FRAME_MS);
  const maxFrames = Math.round(o.maxMs / FRAME_MS);
  const pauseFrames = Math.ceil(o.pauseMs / FRAME_MS);
  const toMs = sample => Math.round((sample * 1000) / RATE);

  let seq = 0;
  let buf = new Float32Array(RATE * 20);
  let bufStart = 0;       // global sample index of buf[0]; also the next piece's start
  let received = 0;       // global samples pushed
  let nextFrame = 0;      // next global frame to analyse
  let cutFrame = 0;       // global frame of the previous cut (0 before the first)
  let energy = [];        // RMS of frames cutFrame, cutFrame+1, ...

  function emit(startSample, endSample, endPauseMs, cutKind) {
    const samples = buf.slice(startSample - bufStart, endSample - bufStart);
    const overlapped = seq === 0 ? 0 : Math.min(overlapSamples, endSample - startSample);
    return {
      seq: seq++, startMs: toMs(startSample), endMs: toMs(endSample),
      overlapMs: toMs(overlapped), endPauseMs, cutKind, samples,
    };
  }

  function dropBefore(sample) {
    const keep = received - sample;
    buf.copyWithin(0, sample - bufStart, received - bufStart);
    bufStart = sample;
    return keep;
  }

  // Looks for a usable pause among the frames since the last cut.
  function findPause() {
    let best = null;
    let i = 0;
    while (i < energy.length) {
      if (energy[i] >= o.pauseRms) { i++; continue; }
      let j = i;
      while (j < energy.length && energy[j] < o.pauseRms) j++;
      const run = j - i;
      const mid = i + Math.floor(run / 2);
      if (run >= pauseFrames && mid >= minFrames && mid <= maxFrames
        && (!best || Math.abs(mid - targetFrames) < Math.abs(best.mid - targetFrames))) best = { mid, run };
      i = j;
    }
    return best;
  }

  // Fallback when no absolute pause exists: the quietest short window, if clearly quiet.
  function findQuiet() {
    const w = Math.round(o.quietWindowMs / FRAME_MS);
    const half = Math.floor(w / 2);
    const head = energy.slice(0, maxFrames);
    const sorted = [...head].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    let best = null;
    let sum = 0;
    for (let i = 0; i < head.length; i++) {
      sum += head[i];
      if (i >= w) sum -= head[i - w];
      if (i < w - 1) continue;
      const start = i - w + 1;
      const mid = start + half;
      if (mid < minFrames || mid > maxFrames) continue;
      const mean = sum / w;
      if (!best || mean < best.mean - 1e-9
        || (Math.abs(mean - best.mean) <= 1e-9 && Math.abs(mid - targetFrames) < Math.abs(best.mid - targetFrames))) {
        best = { mid, mean };
      }
    }
    return best && best.mean <= o.quietRatio * median ? best.mid : null;
  }

  function push(input) {
    const samples = toFloat(input);
    if (received + samples.length - bufStart > buf.length) {
      const grown = new Float32Array(Math.max(buf.length * 2, received + samples.length - bufStart));
      grown.set(buf.subarray(0, received - bufStart));
      buf = grown;
    }
    buf.set(samples, received - bufStart);
    received += samples.length;

    const pieces = [];
    while ((nextFrame + 1) * frameLen <= received) {
      const from = nextFrame * frameLen - bufStart;
      let sum = 0;
      for (let i = from; i < from + frameLen; i++) sum += buf[i] * buf[i];
      energy.push(Math.sqrt(sum / frameLen));
      nextFrame++;
      if (energy.length < targetFrames) continue;
      const pause = findPause();
      let at = null;
      let endPauseMs = 0;
      let kind = 'pause';
      if (pause) { at = pause.mid; endPauseMs = pause.run * FRAME_MS; }
      else if (energy.length >= maxFrames) {
        const quiet = findQuiet();
        if (quiet !== null) { at = quiet; kind = 'quiet'; } else { at = maxFrames; kind = 'hard'; }
      }
      if (at === null) continue;
      const cutSample = (cutFrame + at) * frameLen;
      pieces.push(emit(bufStart, cutSample, endPauseMs, kind));
      cutFrame += at;
      energy = energy.slice(at);
      dropBefore(Math.max(cutSample - overlapSamples, bufStart));
    }
    return pieces;
  }

  function flush() {
    const lastCut = cutFrame * frameLen;
    const fresh = received - lastCut;
    const out = [];
    if (fresh >= Math.round((o.minTailMs * RATE) / 1000)) out.push(emit(bufStart, received, 0, 'flush'));
    energy = []; nextFrame = 0; cutFrame = 0; bufStart = 0; received = 0;
    return out;
  }

  return { push, flush };
}

/** Cuts a whole recording at once (tests, offline use). */
export function cutPieces(samples, options) {
  const cutter = createPieceCutter(options);
  return [...cutter.push(samples), ...cutter.flush()];
}

/** True when a piece holds no audible sound (RMS under about -46 dBFS). */
export function isSilent(samples, threshold = 0.005) {
  const n = samples?.length || 0;
  if (!n) return true;
  const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = samples[i] * scale; sum += v * v; }
  return Math.sqrt(sum / n) < threshold;
}

/** 16-bit PCM mono WAV with a 44-byte header. */
export function encodeWav(samples, sampleRate = RATE) {
  const n = samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const tag = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, n * 2, true);
  const isInt = samples instanceof Int16Array;
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    if (!isInt) { s = Math.max(-1, Math.min(1, s)); s = s < 0 ? s * 32768 : s * 32767; s = Math.round(s); }
    v.setInt16(44 + i * 2, s, true);
  }
  return bytes;
}

// ---- text ----------------------------------------------------------------

/** Removes bracketed sound tags in any script: [संगीत], [background music]. */
export function stripSoundTags(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\[[^[\]\n]{1,80}\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([.,;:!?।])/gu, '$1')
    .trim();
}

const MAX_OVERLAP_WORDS = 8;
// Lower-case, NFC, nukta removed (हज़ार = हजार), everything but letters, marks and digits dropped.
const norm = word => word.normalize('NFD').replace(/\u093C/gu, '').normalize('NFC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const cpLength = s => [...s].length;

// Words are split on whitespace and hyphens, so "second-hand" is two words.
function words(text) {
  const out = [];
  for (const m of text.matchAll(/[^\s\u2010-\u2015-]+/gu)) {
    const key = norm(m[0]);
    if (key) out.push({ key, start: m.index });
  }
  return out;
}

// A repeat needs at least two consecutive matching words. A trailing half word
// counts as one of the two only when a whole word before it also matches. A run
// of one repeated word ("no no") is never removed: it may be what was said.
function findOverlap(prevW, nextW) {
  const maxK = Math.min(MAX_OVERLAP_WORDS, prevW.length, nextW.length);
  const last = prevW.length - 1;
  for (let k = maxK; k >= 2; k--) {
    let lead = true;
    for (let i = 0; i < k - 1; i++) if (prevW[last - k + 1 + i].key !== nextW[i].key) { lead = false; break; }
    if (!lead) continue;
    const a = prevW[last].key;
    const b = nextW[k - 1].key;
    if (a === b) {
      if (nextW.slice(0, k).every(w => w.key === a)) continue;
      return { kind: 'whole', k };
    }
    if (b.startsWith(a) && cpLength(a) >= 3) return { kind: 'half', k };
  }
  return null;
}

/**
 * Joins two consecutive transcripts that overlap by about a second of audio.
 * Returns { prev, next }: a repeated run of words is removed from the start of
 * next; a half word at the end of prev (whole at the start of next) is removed
 * from prev together with the words before it that next repeats, so the whole
 * text shows once. At least two consecutive words must match; anything doubtful
 * is kept.
 */
export function mergeOverlap(prevText, nextText) {
  const prev = typeof prevText === 'string' ? prevText : '';
  const next = typeof nextText === 'string' ? nextText : '';
  const prevW = words(prev);
  const nextW = words(next);
  if (!prevW.length || !nextW.length) return { prev, next };
  const hit = findOverlap(prevW, nextW);
  if (!hit) return { prev, next };
  if (hit.kind === 'half') {
    return { prev: prev.slice(0, prevW[prevW.length - hit.k].start).trimEnd(), next };
  }
  return { prev, next: hit.k >= nextW.length ? '' : next.slice(nextW[hit.k].start) };
}

/** The next transcript with the words repeated from the end of prev removed. */
export function dedupeOverlap(prevText, nextText) {
  return mergeOverlap(prevText, nextText).next;
}

// ---- turns ---------------------------------------------------------------

export const LONG_PAUSE_MS = 700;

/**
 * Groups piece texts into turns of at most two pieces. A turn closes early
 * after a piece that ended at a long pause; an empty piece closes the turn
 * before it and is skipped. Pieces are { seq, text, startMs, endMs, endPauseMs? }.
 */
export function createTurnBuilder() {
  let pending = [];
  const close = () => {
    if (!pending.length) return [];
    const turn = {
      text: pending.map(p => p.text).join(' '),
      startMs: pending[0].startMs, endMs: pending[pending.length - 1].endMs,
      seqs: pending.map(p => p.seq),
    };
    pending = [];
    return [turn];
  };
  return {
    add(piece) {
      const text = typeof piece.text === 'string' ? piece.text.trim() : '';
      if (!text) return close();
      pending.push({ ...piece, text });
      if (pending.length >= 2 || (piece.endPauseMs || 0) >= LONG_PAUSE_MS) return close();
      return [];
    },
    flush: close,
    /** Replaces the text of a piece still in the open turn (a trimmed half word). */
    amend(seq, text) {
      const at = pending.findIndex(p => p.seq === seq);
      if (at < 0) return;
      const clean = typeof text === 'string' ? text.trim() : '';
      if (clean) pending[at] = { ...pending[at], text: clean };
      else pending.splice(at, 1);
    },
  };
}

export function groupTurns(pieces) {
  const builder = createTurnBuilder();
  const turns = [];
  for (const piece of pieces) turns.push(...builder.add(piece));
  turns.push(...builder.flush());
  return turns;
}
