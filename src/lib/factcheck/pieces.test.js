// F344 T5: piece cutting, WAV encoding, sound tags, overlap de-duplication and
// turn grouping. Pure functions, no browser APIs. Audio is synthetic: a sine
// tone stands for speech and zeros for a pause.
import { describe, expect, it } from 'vitest';
import {
  RATE, createPieceCutter, cutPieces, isSilent, encodeWav, stripSoundTags,
  dedupeOverlap, mergeOverlap, groupTurns, createTurnBuilder,
} from './pieces.js';

const ms = n => Math.round((n / 1000) * RATE);
function tone(durationMs, amp = 0.3) {
  const out = new Float32Array(ms(durationMs));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return out;
}
const quiet = durationMs => new Float32Array(ms(durationMs));
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function runCutter(audio, chunk = 1000, flush = false) {
  const cutter = createPieceCutter();
  const pieces = [];
  for (let i = 0; i < audio.length; i += chunk) pieces.push(...cutter.push(audio.subarray(i, i + chunk)));
  if (flush) pieces.push(...cutter.flush());
  return pieces;
}

describe('piece cutting', () => {
  it('cuts in the middle of a pause found near the target length', () => {
    const [first, second] = runCutter(concat(tone(9000), quiet(600), tone(8000)), 1000, true);
    expect(first.seq).toBe(0);
    expect(first.startMs).toBe(0);
    expect(first.overlapMs).toBe(0);
    expect(first.endMs).toBeGreaterThanOrEqual(9200);
    expect(first.endMs).toBeLessThanOrEqual(9400);
    expect(first.endPauseMs).toBeGreaterThanOrEqual(300);
    expect(second.seq).toBe(1);
    expect(second.overlapMs).toBe(1000);
    expect(second.startMs).toBe(first.endMs - 1000);
  });

  it('hard-cuts at 12 s when there is no pause, and overlaps 1 s', () => {
    const pieces = runCutter(tone(30000));
    expect(pieces.map(p => [p.startMs, p.endMs, p.overlapMs])).toEqual([
      [0, 12000, 0], [11000, 24000, 1000],
    ]);
    expect(pieces[0].endPauseMs).toBe(0);
  });

  it('ignores a pause before 8 s', () => {
    const [first] = runCutter(concat(tone(5000), quiet(600), tone(20000)));
    expect(first.endMs).toBe(12000);
  });

  it('a gap shorter than 300 ms is not a pause: it is used only as a quiet window, at the 12 s check', () => {
    const [first] = runCutter(concat(tone(10000), quiet(200), tone(10000)));
    expect(first.cutKind).toBe('quiet');
    expect(first.endMs).toBeGreaterThanOrEqual(10000);
    expect(first.endMs).toBeLessThanOrEqual(10300);
  });

  it('chooses, among the pauses heard by 10 s, the one nearest the target', () => {
    const [first] = runCutter(concat(tone(8400), quiet(400), tone(900), quiet(400), tone(8000)));
    expect(first.endMs).toBeGreaterThanOrEqual(9700);
    expect(first.endMs).toBeLessThanOrEqual(10000);
  });

  it('cuts a pause that appears after 10 s as soon as it is long enough', () => {
    const [first] = runCutter(concat(tone(10500), quiet(600), tone(8000)));
    expect(first.endMs).toBeGreaterThanOrEqual(10600);
    expect(first.endMs).toBeLessThanOrEqual(10950);
  });

  it('gives the same boundaries whatever the chunk size', () => {
    const audio = concat(tone(9000), quiet(600), tone(7000), quiet(500), tone(14000));
    const shape = pieces => pieces.map(p => [p.seq, p.startMs, p.endMs, p.overlapMs]);
    const reference = shape(runCutter(audio, 1000, true));
    for (const chunk of [128, 317, 4096, 100000]) expect(shape(runCutter(audio, chunk, true))).toEqual(reference);
  });

  it('carries exactly the samples between startMs and endMs', () => {
    const pieces = runCutter(tone(30000));
    for (const p of pieces) expect(p.samples.length).toBe(Math.round(((p.endMs - p.startMs) * RATE) / 1000));
    // The overlap really is the tail of the previous piece.
    const tail = pieces[0].samples.subarray(pieces[0].samples.length - ms(1000));
    expect(Array.from(pieces[1].samples.subarray(0, ms(1000)))).toEqual(Array.from(tail));
  });

  it('flush returns the final partial piece, with its overlap', () => {
    const pieces = runCutter(tone(15000), 1000, true);
    expect(pieces.map(p => [p.startMs, p.endMs])).toEqual([[0, 12000], [11000, 15000]]);
  });

  it('flush drops a tail with under 250 ms of new audio, and nothing is lost for a short first piece', () => {
    expect(runCutter(tone(12100), 1000, true).map(p => p.endMs)).toEqual([12000]);
    expect(runCutter(tone(3000), 1000, true).map(p => [p.startMs, p.endMs])).toEqual([[0, 3000]]);
    expect(runCutter(tone(100), 1000, true)).toEqual([]);
  });

  it('is empty after flush and can be reused for nothing', () => {
    const cutter = createPieceCutter();
    cutter.push(tone(3000));
    expect(cutter.flush()).toHaveLength(1);
    expect(cutter.flush()).toEqual([]);
  });

  it('accepts Int16 frames', () => {
    const f = concat(tone(9000), quiet(600), tone(4000));
    const i16 = Int16Array.from(f, v => Math.round(v * 32767));
    const cutter = createPieceCutter();
    const out = [];
    for (let i = 0; i < i16.length; i += 1000) out.push(...cutter.push(i16.subarray(i, i + 1000)));
    expect(out[0].endMs).toBeGreaterThanOrEqual(9200);
    expect(out[0].samples).toBeInstanceOf(Float32Array);
  });

  it('cutPieces cuts a whole recording at once', () => {
    const pieces = cutPieces(tone(15000));
    expect(pieces.map(p => [p.startMs, p.endMs])).toEqual([[0, 12000], [11000, 15000]]);
  });
});

describe('quiet-window cuts (music bed: no absolute pause)', () => {
  // A bed of music at amplitude 0.3 never falls below the absolute pause level.
  const bed = (durationMs, amp = 0.3) => tone(durationMs, amp);
  it('cuts in the middle of the quietest 200 ms window when it is clearly quieter than the median', () => {
    const [first] = runCutter(concat(bed(9400), tone(400, 0.05), bed(10000)));
    expect(first.cutKind).toBe('quiet');
    expect(first.endMs).toBeGreaterThanOrEqual(9500);
    expect(first.endMs).toBeLessThanOrEqual(9700);
    expect(first.endPauseMs).toBe(0);
  });
  it('hard-cuts at 12 s when the dip is not clearly quieter', () => {
    const [first] = runCutter(concat(bed(9400), tone(400, 0.2), bed(10000)));
    expect(first.cutKind).toBe('hard');
    expect(first.endMs).toBe(12000);
  });
  it('hard-cuts at 12 s on steady sound', () => {
    expect(runCutter(bed(30000))[0].cutKind).toBe('hard');
  });
  it('ignores a quiet window outside 8 s to 12 s', () => {
    const [first] = runCutter(concat(bed(4000), tone(400, 0.05), bed(20000)));
    expect(first.endMs).toBe(12000);
  });
  it('still prefers a true pause, and labels it', () => {
    const [first] = runCutter(concat(tone(9000), quiet(600), tone(8000)));
    expect(first.cutKind).toBe('pause');
  });
  it('is independent of the chunk size', () => {
    const audio = concat(bed(9400), tone(400, 0.05), bed(15000));
    const ends = c => runCutter(audio, c, true).map(p => p.endMs);
    for (const c of [128, 317, 4096]) expect(ends(c)).toEqual(ends(1000));
  });
});

describe('heldMs: audio still held after the cut', () => {
  it('is the audio received after the piece last sample, at the end of the push that emitted it', () => {
    const cutter = createPieceCutter();
    const out = cutter.push(concat(tone(9000), quiet(600), tone(1000)));
    expect(out).toHaveLength(1);
    // the cut is in the middle of the pause (about 9300 ms); 10600 ms were received
    expect(out[0].heldMs).toBe(10600 - out[0].endMs);
    expect(out[0].heldMs).toBeGreaterThan(1000);
  });
  it('is 0 for the flushed tail', () => {
    const cutter = createPieceCutter();
    cutter.push(tone(3000));
    expect(cutter.flush()[0].heldMs).toBe(0);
  });
  it('is small when the cut is a hard cut on a chunk boundary', () => {
    const pieces = runCutter(tone(14000), 2048);
    expect(pieces[0].heldMs).toBeLessThan(130);
  });
});

describe('isSilent', () => {
  it('is true for zeros, an empty piece and room hiss', () => {
    expect(isSilent(quiet(1000))).toBe(true);
    expect(isSilent(new Float32Array(0))).toBe(true);
    expect(isSilent(tone(1000, 0.001))).toBe(true);
  });
  it('is false for audible sound', () => {
    expect(isSilent(tone(1000, 0.1))).toBe(false);
  });
  it('reads Int16 samples', () => {
    expect(isSilent(new Int16Array(1600))).toBe(true);
    expect(isSilent(Int16Array.from(tone(100, 0.2), v => v * 32767))).toBe(false);
  });
});

describe('encodeWav', () => {
  const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));
  it('writes a 44-byte PCM header and little-endian 16-bit samples', () => {
    const bytes = encodeWav(Float32Array.of(0, 1, -1, 2, -2, 0.5), 16000);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(44 + 12);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 12);
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(12);
    expect([0, 1, 2, 3, 4, 5].map(i => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
  it('uses the given sample rate and encodes an empty piece', () => {
    const v = new DataView(encodeWav(new Float32Array(0), 8000).buffer);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(28, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(0);
  });
  it('passes Int16 samples through unchanged', () => {
    const v = new DataView(encodeWav(Int16Array.of(-5, 7), 16000).buffer);
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([-5, 7]);
  });
});

describe('stripSoundTags', () => {
  it.each([
    ['[संगीत]', ''],
    ['[background music]', ''],
    ['[outro jingle] [applause]', ''],
    ['आज [संगीत] बारिश हुई', 'आज बारिश हुई'],
    ['The vote [applause] passed.', 'The vote passed.'],
    ['The vote passed [music].', 'The vote passed.'],
    ['[संगीत] नमस्कार', 'नमस्कार'],
    ['no tags here', 'no tags here'],
    ['', ''],
    ['[ موسيقى ] أهلا', 'أهلا'],
  ])('%j -> %j', (input, expected) => {
    expect(stripSoundTags(input)).toBe(expected);
  });
  it('is safe on non-strings and leaves an unmatched bracket alone', () => {
    expect(stripSoundTags(undefined)).toBe('');
    expect(stripSoundTags('price [rising')).toBe('price [rising');
  });
});

describe('dedupeOverlap', () => {
  // A repeat is removed only when at least two consecutive words match (a trailing
  // half word counts as one of them only when a whole word before it matches).
  // A single matching word is never removed: a missed duplicate is acceptable,
  // a deleted piece of real speech is not.
  it('G2a case 1: a repeated run of words is dropped from the next piece', () => {
    const prev = 'The council voted for the resolution while supporting the adoption';
    const next = 'the adoption of the resolution, India distanced itself from the text';
    expect(dedupeOverlap(prev, next)).toBe('of the resolution, India distanced itself from the text');
    expect(`${prev} ${dedupeOverlap(prev, next)}`).not.toMatch(/adoption.*adoption/i);
  });

  it('G2a case 1 with a single repeated word keeps all text (one-word matches are never removed)', () => {
    const prev = 'The council voted while supporting the adoption';
    const next = 'adoption of the resolution, India distanced itself from the text';
    expect(dedupeOverlap(prev, next)).toBe(next);
  });

  it('G2a case 2: a half word at the end of the previous piece becomes one whole word', () => {
    const prev = 'The council voted for the resolution while supporting the adop';
    const next = 'the adoption of the resolution, India distanced itself';
    const merged = mergeOverlap(prev, next);
    expect(merged.prev).toBe('The council voted for the resolution while supporting');
    expect(merged.next).toBe(next);
    const joined = `${merged.prev} ${merged.next}`;
    expect(joined.match(/adop/g)).toHaveLength(1);
    expect(joined).toContain('supporting the adoption of the resolution');
    // dedupeOverlap alone leaves the next text whole: the whole word is kept.
    expect(dedupeOverlap(prev, next)).toBe(next);
  });

  it('G2a case 3 (Hindi): a half word before the next piece', () => {
    const prev = 'आज दिल्ली में भारी बारिश से त्रा';
    const next = 'बारिश से त्राहिमाम मच गया है और सड़कें बंद हैं';
    const merged = mergeOverlap(prev, next);
    expect(merged.prev).toBe('आज दिल्ली में भारी');
    expect(merged.next).toBe(next);
    expect(`${merged.prev} ${merged.next}`.match(/त्रा/g)).toHaveLength(1);
  });

  it('a half word alone (no whole word before it matching) is kept', () => {
    const prev = 'They said the adop';
    const next = 'adoption of the resolution';
    expect(mergeOverlap(prev, next)).toEqual({ prev, next });
  });

  it('drops several repeated words, with different case and punctuation', () => {
    expect(dedupeOverlap('We will win, Said the Minister.', 'said the minister, and that is final')).toBe('and that is final');
    expect(dedupeOverlap('and the bill, passed in 2019!', 'The bill passed in 2019 and then lapsed')).toBe('and then lapsed');
  });

  it('works on Devanagari with a danda and different punctuation', () => {
    expect(dedupeOverlap('सरकार ने कहा कि बारिश से राहत मिलेगी।', 'बारिश से राहत मिलेगी, और बाढ़ रुकेगी')).toBe('और बाढ़ रुकेगी');
  });

  it('works when the repeated words are mixed Hindi and English', () => {
    expect(dedupeOverlap('यह bill संसद में पास हुआ', 'संसद में पास हुआ और अब कानून है')).toBe('और अब कानून है');
  });

  it('matches across hyphen and nukta spelling differences', () => {
    expect(dedupeOverlap('a well-known fact', 'well known fact is clear')).toBe('is clear');
    expect(dedupeOverlap('आज हज़ार करोड़', 'हजार करोड़ रुपये मिले')).toBe('रुपये मिले');
  });

  it('returns the next text unchanged when nothing overlaps', () => {
    const next = 'completely different words follow here';
    expect(dedupeOverlap('the minister spoke at length', next)).toBe(next);
    expect(mergeOverlap('the minister spoke at length', next)).toEqual({ prev: 'the minister spoke at length', next });
  });

  it('handles empty input without throwing', () => {
    expect(dedupeOverlap('', 'hello there')).toBe('hello there');
    expect(dedupeOverlap('hello there', '')).toBe('');
    expect(dedupeOverlap(undefined, undefined)).toBe('');
  });

  // False-positive traps: never delete text that is not a repetition.
  it.each([
    ['support from India', 'Indian officials said'],
    ['the warning came from Trump', 'Trump said again'],
    ['यह मामला भारत', 'भारतीय सेना ने'],
    ['first second', 'second-hand cars'],
    ['he said no', 'no one came'],
    ['यह बहुत', 'बहुत अच्छा है'],
    ['मैं कहूंगा बहुत', 'बहुत बहुत धन्यवाद'],
    ['the number was 2024', '2024 elections'],
    ['यह 20', '20 हज़ार'],
    ['Delhi Delhi', 'Delhi is the capital'],
    ['चुनाव चुनाव', 'चुनाव होंगे'],
    ['the market is very very', 'very big today'],
    ['no no', 'no no no stop'],
    ['he was in', 'india won the match'],
    ['see the', 'there is a problem'],
    ['talks about adoption', 'India and adoption of the rule'],
  ])('keeps all text: %j + %j', (prev, next) => {
    expect(mergeOverlap(prev, next)).toEqual({ prev, next });
  });

  it('removes at most 8 words; a longer coincidence is kept rather than guessed at', () => {
    expect(dedupeOverlap('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10', 'c3 d4 e5 f6 g7 h8 i9 j10 k11 l12')).toBe('k11 l12');
    const nine = 'b2 c3 d4 e5 f6 g7 h8 i9 j10 k11';
    expect(dedupeOverlap('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10', nine)).toBe(nine);
  });
});

describe('groupTurns', () => {
  const p = (seq, text, extra = {}) => ({ seq, text, startMs: seq * 10000, endMs: seq * 10000 + 10000, ...extra });
  it('groups two consecutive pieces into a turn of at most two pieces', () => {
    const turns = groupTurns([p(0, 'a'), p(1, 'b'), p(2, 'c'), p(3, 'd'), p(4, 'e')]);
    expect(turns.map(t => t.text)).toEqual(['a b', 'c d', 'e']);
    expect(turns[0]).toMatchObject({ startMs: 0, endMs: 20000, seqs: [0, 1] });
  });
  it('closes a turn early after a piece that ended at a long pause', () => {
    const turns = groupTurns([p(0, 'a', { endPauseMs: 900 }), p(1, 'b'), p(2, 'c')]);
    expect(turns.map(t => t.text)).toEqual(['a', 'b c']);
  });
  it('does not close at a short pause', () => {
    expect(groupTurns([p(0, 'a', { endPauseMs: 300 }), p(1, 'b')]).map(t => t.text)).toEqual(['a b']);
  });
  it('skips empty pieces, and an empty piece closes the turn before it', () => {
    const turns = groupTurns([p(0, 'a'), p(1, ''), p(2, 'b'), p(3, '   '), p(4, 'c'), p(5, 'd')]);
    expect(turns.map(t => t.text)).toEqual(['a', 'b', 'c d']);
  });
  it('returns nothing for no text', () => {
    expect(groupTurns([])).toEqual([]);
    expect(groupTurns([p(0, ''), p(1, '')])).toEqual([]);
  });
  it('the incremental builder closes on the second piece and flushes the rest', () => {
    const b = createTurnBuilder();
    expect(b.add(p(0, 'a'))).toEqual([]);
    expect(b.add(p(1, 'b')).map(t => t.text)).toEqual(['a b']);
    expect(b.add(p(2, 'c'))).toEqual([]);
    expect(b.flush().map(t => t.text)).toEqual(['c']);
    expect(b.flush()).toEqual([]);
  });
  it('amend replaces the text of a piece still waiting in the open turn, and drops it if emptied', () => {
    const b = createTurnBuilder();
    b.add(p(0, 'see the adop'));
    b.amend(0, 'see the');
    expect(b.add(p(1, 'adoption of it')).map(t => t.text)).toEqual(['see the adoption of it']);
    b.add(p(2, 'x'));
    b.amend(2, '');
    expect(b.flush()).toEqual([]);
    b.amend(99, 'nothing pending');
    expect(b.flush()).toEqual([]);
  });
});
