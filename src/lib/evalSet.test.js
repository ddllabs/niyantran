import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGETS,
  isCandidateChunk,
  isTableRow,
  leaks,
  md5Hex,
  normaliseTokens,
  pickDistractors,
  planSample,
  validateQuestionLine,
} from './evalSet.js';

const PROSE_LINE = 'The Board may, by notification, specify the manner in which the intermediary shall maintain records.';

/** `n` distinct prose lines, each long enough that three of them pass the length rule. */
function prose(n, tag = 'p') {
  return Array.from({ length: n }, (_, i) => `${PROSE_LINE} (${tag}${i})`).join('\n');
}

/** A document with `n` candidate chunks, ids `<doc>-c<i>`. */
function doc(id, n) {
  return { document_id: id, chunks: Array.from({ length: n }, (_, i) => ({ id: `${id}-c${i}`, content: prose(4, `${id}${i}`) })) };
}

const byMd5 = (ids) => [...ids].sort((a, b) => (md5Hex(a) < md5Hex(b) ? -1 : 1));

describe('md5Hex', () => {
  it('matches the RFC 1321 test vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
});

describe('isTableRow (mirrors _shared/chunking.ts)', () => {
  it('accepts a pipe-delimited row with a non-empty cell, after trimming', () => {
    expect(isTableRow('| Year | Amount |')).toBe(true);
    expect(isTableRow('   | x |   ')).toBe(true);
    expect(isTableRow('| | x |')).toBe(true);
  });

  it('rejects bare OCR pipes, short lines and rows missing a closing pipe', () => {
    expect(isTableRow('|')).toBe(false);
    expect(isTableRow('||')).toBe(false);
    expect(isTableRow('|||')).toBe(false);
    expect(isTableRow('| |')).toBe(false);
    expect(isTableRow('|   |   |')).toBe(false);
    expect(isTableRow('| THE SCHEDULE')).toBe(false);
    expect(isTableRow('plain text')).toBe(false);
  });
});

describe('isCandidateChunk', () => {
  it('excludes 299 characters and keeps 300', () => {
    expect(isCandidateChunk('x'.repeat(299))).toBe(false);
    expect(isCandidateChunk('x'.repeat(300))).toBe(true);
  });

  it('excludes a chunk whose non-empty lines are exactly 60% table rows', () => {
    const row = '| Scheme | Allocation in crore | Utilised in crore | Percentage utilised |';
    const content = [row, PROSE_LINE, row, PROSE_LINE, row].join('\n\n');
    expect(content.length).toBeGreaterThanOrEqual(300);
    expect(isCandidateChunk(content)).toBe(false);
  });

  it('keeps a chunk just under 60% table rows (4 of 7)', () => {
    const row = '| Scheme | Allocation in crore | Utilised in crore | Percentage utilised |';
    const content = [row, row, row, row, PROSE_LINE, PROSE_LINE, PROSE_LINE].join('\n');
    expect(isCandidateChunk(content)).toBe(true);
  });

  it('does not count bare OCR pipes as table rows', () => {
    const content = ['| |', '|', '| |', PROSE_LINE, PROSE_LINE, PROSE_LINE, '| |', '| |'].join('\n');
    expect(isCandidateChunk(content)).toBe(true);
  });

  it('excludes an enacting formula followed by nothing substantial', () => {
    const content = `BE it enacted by Parliament in the Seventy-fifth Year of the Republic of India as follows:—\n\n${'.'.repeat(220)}\n\n2`;
    expect(content.length).toBeGreaterThanOrEqual(300);
    expect(isCandidateChunk(content)).toBe(false);
  });

  it('keeps an enacting formula followed by the operative text', () => {
    const content = `BE it enacted by Parliament in the Seventy-fifth Year of the Republic of India as follows:—\n\n1. (1) This Act may be called the Banking Laws (Amendment) Act, 2024.\n(2) It shall come into force on such date as the Central Government may, by notification in the Official Gazette, appoint; and different dates may be appointed for different provisions.`;
    expect(isCandidateChunk(content)).toBe(true);
  });

  it('excludes a signature block', () => {
    const content = [
      'NEW DELHI;',
      'The 5th August, 2024.',
      'ARJUN RAM MEGHWAL,',
      'MINISTER OF LAW AND JUSTICE.',
      '(UTPAL KUMAR SINGH)',
      'Secretary-General, Lok Sabha.',
      'Dated: 12/08/2024',
      '(Name)',
      'Joint Secretary to the Government of India.',
      'PRESIDENT',
      'SHRI PANKAJ CHAUDHARY',
      'Under Secretary, Ministry of Finance.',
      'By order and in the name of the President,',
      'Deputy Secretary to the Government of India.',
    ].join('\n');
    expect(content.length).toBeGreaterThanOrEqual(300);
    expect(isCandidateChunk(content)).toBe(false);
  });

  it('excludes an enacting formula followed only by a signature block (the formula is not counted as a line)', () => {
    // Three signature lines after the formula: 3 of 4 lines (75%) if the formula were counted, 3 of 3 once it is stripped.
    const content = [
      'BE it enacted by Parliament in the Seventy-fifth Year of the Republic of India as follows:—',
      'MINISTER OF STATE IN THE MINISTRY OF FINANCE (SHRI PANKAJ CHAUDHARY).',
      'Joint Secretary to the Government of India, Ministry of Law and Justice.',
      'By order and in the name of the President of India, Secretary-General.',
    ].join('\n');
    expect(content.length).toBeGreaterThanOrEqual(300);
    expect(isCandidateChunk(content)).toBe(false);
  });

  it('keeps prose that merely ends with a signature', () => {
    const content = [
      PROSE_LINE,
      'The Committee examined the Bill clause by clause and recommended amendments to clauses 3, 7 and 12.',
      'The Government accepted the recommendations and moved the amendments at the consideration stage.',
      'NEW DELHI;',
      'The 5th August, 2024.',
      'MINISTER OF LAW AND JUSTICE.',
    ].join('\n');
    expect(isCandidateChunk(content)).toBe(true);
  });
});

describe('planSample', () => {
  it('has the spec targets, 195 in all', () => {
    expect(DEFAULT_TARGETS).toEqual({
      'Bill Passage Probability Index': 80,
      'Regulatory Body Watch (RBI SEBI TRAI CCI)': 60,
      'Parliamentary Question Database': 40,
      'Industry Updates (Ministry Data)': 12,
      'Budget Utilisation & Schemes': 3,
    });
    expect(Object.values(DEFAULT_TARGETS).reduce((a, b) => a + b, 0)).toBe(195);
  });

  it('cycles round-robin: 6 documents and a target of 12 take 2 per document', () => {
    const docs = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((id) => doc(id, 3));
    const { picks } = planSample({ F: docs }, { F: 12 }).F;
    expect(picks).toHaveLength(12);
    const docOrder = byMd5(docs.map((d) => d.document_id));
    expect(picks.slice(0, 6).map((p) => p.document_id)).toEqual(docOrder);
    expect(picks.slice(6).map((p) => p.document_id)).toEqual(docOrder);
    for (const d of docs) {
      const chunkOrder = byMd5(d.chunks.map((c) => c.id));
      expect(picks.filter((p) => p.document_id === d.document_id).map((p) => p.chunk_id)).toEqual(chunkOrder.slice(0, 2));
    }
    expect(picks.every((p) => p.desk_feature === 'F')).toBe(true);
  });

  it('keeps the remaining candidates as a reserve in the same round-robin order', () => {
    const docs = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((id) => doc(id, 3));
    const { reserve } = planSample({ F: docs }, { F: 12 }).F;
    const docOrder = byMd5(docs.map((d) => d.document_id));
    expect(reserve.map((r) => r.document_id)).toEqual(docOrder);
    for (const r of reserve) {
      const d = docs.find((x) => x.document_id === r.document_id);
      expect(r.chunk_id).toBe(byMd5(d.chunks.map((c) => c.id))[2]);
    }
  });

  it('takes a single document\'s candidates in md5 order (Budget: one document gives 3)', () => {
    const d = doc('budget', 5);
    const { picks, reserve } = planSample({ B: [d] }, { B: 3 }).B;
    const order = byMd5(d.chunks.map((c) => c.id));
    expect(picks.map((p) => p.chunk_id)).toEqual(order.slice(0, 3));
    expect(reserve.map((r) => r.chunk_id)).toEqual(order.slice(3));
  });

  it('skips chunks that fail the candidate rules and stops when candidates run out', () => {
    const good = doc('g', 1);
    const bad = { document_id: 'b', chunks: [{ id: 'b-short', content: 'too short' }] };
    const { picks, reserve } = planSample({ F: [good, bad] }, { F: 5 }).F;
    expect(picks).toEqual([{ desk_feature: 'F', document_id: 'g', chunk_id: 'g-c0' }]);
    expect(reserve).toEqual([]);
  });

  it('is deterministic and independent of input order', () => {
    const docs = ['a', 'b', 'c', 'd'].map((id) => doc(id, 4));
    const reversed = docs.map((d) => ({ ...d, chunks: [...d.chunks].reverse() })).reverse();
    const first = planSample({ F: docs }, { F: 6 });
    expect(planSample({ F: docs }, { F: 6 })).toEqual(first);
    expect(planSample({ F: reversed }, { F: 6 })).toEqual(first);
  });

  it('plans every targeted feature, empty when the feature has no documents', () => {
    const plan = planSample({ 'Budget Utilisation & Schemes': [doc('x', 4)] });
    expect(Object.keys(plan).sort()).toEqual(Object.keys(DEFAULT_TARGETS).sort());
    expect(plan['Budget Utilisation & Schemes'].picks).toHaveLength(3);
    expect(plan['Bill Passage Probability Index']).toEqual({ picks: [], reserve: [] });
  });
});

describe('normaliseTokens', () => {
  it('applies NFKC, lowercases and splits on anything that is not a letter, mark or number', () => {
    expect(normaliseTokens('ＲＢＩ circular—No. 12/2024: “ﬁnal”')).toEqual(['rbi', 'circular', 'no', '12', '2024', 'final']);
    expect(normaliseTokens('  ')).toEqual([]);
  });

  it('keeps Devanagari words whole, combining marks included', () => {
    expect(normaliseTokens('संसद में नया विधेयक, पेश किया।')).toEqual(['संसद', 'में', 'नया', 'विधेयक', 'पेश', 'किया']);
  });

  it('removes zero-width joiners instead of splitting a word on them', () => {
    expect(normaliseTokens('क्\u200Dष विधे\u200Cयक a\u200Bb')).toEqual(['क्ष', 'विधेयक', 'ab']);
  });
});

describe('leaks', () => {
  const passage = 'The Reserve Bank of India shall, by regulation, specify the capital adequacy norms for payment banks.';

  it('detects a shared 5-token sequence regardless of case and punctuation', () => {
    expect(leaks('Which body, BY REGULATION, specify the capital norms?', passage)).toBe(true);
  });

  it('ignores a 4-token overlap', () => {
    expect(leaks('Who can specify the capital requirement?', passage)).toBe(false);
    expect(leaks('What does regulation specify the capital for?', passage)).toBe(false);
  });

  it('returns false when the question is shorter than n tokens', () => {
    expect(leaks('Reserve Bank', passage)).toBe(false);
  });

  const hindi = 'भारत सरकार ने आज संसद में नया विधेयक पेश किया जो किसानों की आय बढ़ाने के लिए है।';

  it('detects a 5-word Hindi overlap', () => {
    expect(leaks('क्या संसद में नया विधेयक पेश हुआ?', hindi)).toBe(true);
  });

  it('ignores a 4-word Hindi overlap', () => {
    expect(leaks('क्या संसद में नया विधेयक आया?', hindi)).toBe(false);
  });
});

describe('pickDistractors', () => {
  const ids = ['g', 'a', 'b', 'c', 'd', 'e', 'f'];

  it('orders the other documents by md5(gold:id) and takes four', () => {
    const expected = ['a', 'b', 'c', 'd', 'e', 'f']
      .sort((x, y) => (md5Hex(`g:${x}`) < md5Hex(`g:${y}`) ? -1 : 1))
      .slice(0, 4);
    expect(pickDistractors('g', ids)).toEqual(expected);
  });

  it('never includes the gold document and is independent of input order', () => {
    const picked = pickDistractors('g', ids);
    expect(picked).not.toContain('g');
    expect(pickDistractors('g', [...ids].reverse())).toEqual(picked);
  });

  it('returns [] when the feature has fewer than five documents', () => {
    expect(pickDistractors('g', ['g', 'a', 'b', 'c'])).toEqual([]);
    expect(pickDistractors('g', ['g', 'a', 'b', 'c', 'd'])).toHaveLength(4);
  });
});

describe('validateQuestionLine', () => {
  const GOLD = '11111111-1111-4111-8111-111111111111';
  const CHUNK = '22222222-2222-4222-8222-222222222222';
  const D = ['a', 'b', 'c', 'd'].map((ch) => `${ch.repeat(8)}-${ch.repeat(4)}-4${ch.repeat(3)}-8${ch.repeat(3)}-${ch.repeat(12)}`);

  const generated = () => ({
    id: 'q-0001',
    question: 'What capital must a payment bank hold?',
    desk_feature: 'Regulatory Body Watch (RBI SEBI TRAI CCI)',
    gold_document_ids: [GOLD],
    gold_chunk_id: CHUNK,
    gold_chunk_hash: 'abc',
    gold_content_sha256: 'def',
    gold_char_from: 0,
    gold_char_to: 812,
    document_key: 'rbi:2024:12',
    distractor_ids: D,
    ambiguous: false,
    source: 'generated',
    generator_model: 'google/gemini-3.8-flash',
    created_at: '2026-09-30T10:15:00.000Z',
  });

  const owner = () => ({
    ...generated(),
    gold_document_ids: [GOLD, CHUNK],
    gold_chunk_id: null,
    gold_chunk_hash: null,
    gold_content_sha256: null,
    gold_char_from: null,
    gold_char_to: null,
    document_key: null,
    distractor_ids: [],
    source: 'owner',
    generator_model: null,
  });

  const errorsFor = (line) => {
    const r = validateQuestionLine(line);
    expect(r.ok).toBe(false);
    return r.errors.join('\n');
  };

  it('accepts a valid generated line, as an object or as a JSON string', () => {
    expect(validateQuestionLine(generated())).toEqual({ ok: true });
    expect(validateQuestionLine(JSON.stringify(generated()))).toEqual({ ok: true });
  });

  it('accepts a valid owner line with nulls', () => {
    expect(validateQuestionLine(owner())).toEqual({ ok: true });
  });

  it('rejects a line that is not JSON', () => {
    expect(errorsFor('{not json')).toMatch(/JSON/);
  });

  it.each([
    ['id', { id: 'q-1' }],
    ['id', { id: 'q-00001' }],
    ['question', { question: '   ' }],
    ['desk_feature', { desk_feature: '' }],
    ['gold_document_ids', { gold_document_ids: [] }],
    ['gold_document_ids', { gold_document_ids: ['not-a-uuid'] }],
    ['gold_document_ids', { gold_document_ids: [GOLD, CHUNK] }],
    ['gold_chunk_id', { gold_chunk_id: 'nope' }],
    ['gold_chunk_id', { gold_chunk_id: null }],
    ['gold_chunk_hash', { gold_chunk_hash: 42 }],
    ['gold_content_sha256', { gold_content_sha256: undefined }],
    ['gold_char', { gold_char_from: 10, gold_char_to: 10 }],
    ['gold_char', { gold_char_from: -1 }],
    ['gold_char', { gold_char_to: 1.5 }],
    ['gold_char', { gold_char_from: null, gold_char_to: null }],
    ['document_key', { document_key: 7 }],
    ['distractor_ids', { distractor_ids: [GOLD, ...D.slice(1)] }],
    ['distractor_ids', { distractor_ids: [D[0], D[0], D[1], D[2]] }],
    ['distractor_ids', { distractor_ids: ['x', ...D.slice(1)] }],
    ['distractor_ids', { distractor_ids: D.slice(0, 3) }],
    ['ambiguous', { ambiguous: 'false' }],
    ['source', { source: 'llm' }],
    ['generator_model', { generator_model: null }],
    ['generator_model', { generator_model: '' }],
    ['created_at', { created_at: '30/09/2026' }],
    ['created_at', { created_at: '2026-13-45T99:00:00Z' }],
  ])('rejects a generated line with a bad %s: %j', (field, patch) => {
    expect(errorsFor({ ...generated(), ...patch })).toContain(field);
  });

  it.each([
    ['gold_char', { gold_char_to: 5 }],
    ['gold_document_ids', { gold_document_ids: [] }],
  ])('rejects an owner line with a bad %s: %j', (field, patch) => {
    expect(errorsFor({ ...owner(), ...patch })).toContain(field);
  });

  it('reports every error at once', () => {
    const r = validateQuestionLine({ ...generated(), id: 'x', ambiguous: 1 });
    expect(r.errors).toHaveLength(2);
  });
});
