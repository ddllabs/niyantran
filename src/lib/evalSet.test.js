import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGETS,
  MIN_NON_AMBIGUOUS,
  V2_TARGETS,
  carryOver,
  checkDeveloperLines,
  isCandidateChunk,
  isValidRate,
  keysetNext,
  isTableRow,
  leaks,
  md5Hex,
  needsMore,
  nonAmbiguousCounts,
  nonAmbiguousShortfalls,
  normaliseTokens,
  pageDelayMs,
  parseBuildArgs,
  parseDeveloperLines,
  pickDistractors,
  planSample,
  readAllKeyset,
  renumberLines,
  tagDeveloperRefs,
  takeAccepted,
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

describe('targets', () => {
  it('keeps the v1 targets unchanged', () => {
    expect(DEFAULT_TARGETS).toEqual({
      'Bill Passage Probability Index': 80,
      'Regulatory Body Watch (RBI SEBI TRAI CCI)': 60,
      'Parliamentary Question Database': 40,
      'Industry Updates (Ministry Data)': 12,
      'Budget Utilisation & Schemes': 3,
    });
    expect(Object.isFrozen(DEFAULT_TARGETS)).toBe(true);
  });

  it('sets v2 to 60 for each of the four features above 10,000 chunks, and nothing else', () => {
    expect(V2_TARGETS).toEqual({
      'NCLT / NCLAT (Insolvency)': 60,
      'Bill Passage Probability Index': 60,
      'Parliamentary Question Database': 60,
      'Regulatory Body Watch (RBI SEBI TRAI CCI)': 60,
    });
    expect(Object.isFrozen(V2_TARGETS)).toBe(true);
  });

  it('plans a sample for a feature that only v2 names, whatever its desk tier', () => {
    const plan = planSample({ 'NCLT / NCLAT (Insolvency)': [doc('n1', 2), doc('n2', 2)], 'Budget Utilisation & Schemes': [doc('b1', 3)] }, V2_TARGETS);
    expect(Object.keys(plan)).toEqual(Object.keys(V2_TARGETS));
    expect(plan['NCLT / NCLAT (Insolvency)'].picks).toHaveLength(4);
    expect(plan['Bill Passage Probability Index'].picks).toEqual([]);
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

  it('does not count a shared sequence that is part of the document title', () => {
    const act = 'The Computer Training Centres (Regulation) Bill, 2004 prescribes a penalty of three years.';
    const title = 'The Computer Training Centres (Regulation) Bill, 2004';
    expect(leaks('What penalty does the Computer Training Centres (Regulation) Bill, 2004 set?', act, 5, title)).toBe(false);
    expect(leaks('What penalty does the Computer Training Centres (Regulation) Bill, 2004 set?', act)).toBe(true);
    expect(leaks('Does it prescribe a penalty of three years?', act, 5, title)).toBe(true);
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

  const developer = () => ({ ...owner(), source: 'developer' });

  it('accepts a developer line like an owner line: several gold documents, null chunk and characters', () => {
    expect(validateQuestionLine(developer())).toEqual({ ok: true });
  });

  it.each([
    ['gold_document_ids', { gold_document_ids: [] }],
    ['gold_char', { gold_char_to: 5 }],
    ['gold_chunk_id', { gold_chunk_id: 'nope' }],
  ])('rejects a developer line with a bad %s: %j', (field, patch) => {
    expect(errorsFor({ ...developer(), ...patch })).toContain(field);
  });

  it('still rejects an unknown source and a generated line with a null chunk', () => {
    expect(errorsFor({ ...developer(), source: 'writer' })).toContain('source');
    expect(errorsFor({ ...generated(), gold_chunk_id: null })).toContain('gold_chunk_id');
  });

  it('accepts carried_from when it is a question id and rejects anything else', () => {
    expect(validateQuestionLine({ ...generated(), carried_from: 'q-0007' })).toEqual({ ok: true });
    expect(errorsFor({ ...generated(), carried_from: 'q-7' })).toContain('carried_from');
    expect(errorsFor({ ...generated(), carried_from: 7 })).toContain('carried_from');
  });

  it('accepts developer_ref like carried_from, and rejects anything else', () => {
    expect(validateQuestionLine({ ...developer(), developer_ref: 'q-0003' })).toEqual({ ok: true });
    expect(errorsFor({ ...developer(), developer_ref: 'x' })).toContain('developer_ref');
    expect(errorsFor({ ...developer(), developer_ref: 3 })).toContain('developer_ref');
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

describe('renumberLines', () => {
  it('numbers lines in order from the given start, leaving their other fields alone', () => {
    const out = renumberLines([{ id: 'q-0009', question: 'a' }, { id: 'q-0002', question: 'b' }], 61);
    expect(out).toEqual([{ id: 'q-0061', question: 'a' }, { id: 'q-0062', question: 'b' }]);
  });
});

describe('carryOver', () => {
  const FEATURE_KEPT = 'Industry Updates (Ministry Data)';
  const v1 = (id, feature, chunk, hash) => ({ id, desk_feature: feature, gold_chunk_id: chunk, gold_chunk_hash: hash, question: `question ${id}` });
  const hashes = new Map([['c1', 'h1'], ['c2', 'h2'], ['c3', 'h3']]);

  it('keeps a line whose gold chunk still has the same id and hash, noting the id it had', () => {
    const r = carryOver([v1('q-0010', FEATURE_KEPT, 'c1', 'h1')], hashes);
    expect(r.kept).toEqual([{ ...v1('q-0010', FEATURE_KEPT, 'c1', 'h1'), carried_from: 'q-0010' }]);
    expect(r.drifted).toEqual([]);
    expect(r.superseded).toBe(0);
  });

  it('drops a line whose chunk hash changed, and one whose chunk is gone, and says why', () => {
    const lines = [v1('q-0001', FEATURE_KEPT, 'c1', 'old'), v1('q-0002', FEATURE_KEPT, 'gone', 'h9'), v1('q-0003', FEATURE_KEPT, 'c2', 'h2')];
    const r = carryOver(lines, hashes);
    expect(r.kept.map((l) => l.carried_from)).toEqual(['q-0003']);
    expect(r.drifted).toEqual([
      { id: 'q-0001', gold_chunk_id: 'c1', reason: 'chunk hash changed' },
      { id: 'q-0002', gold_chunk_id: 'gone', reason: 'chunk not found' },
    ]);
  });

  it('drops a line with no gold chunk, because there is nothing to compare', () => {
    const r = carryOver([v1('q-0001', FEATURE_KEPT, null, null)], hashes);
    expect(r.kept).toEqual([]);
    expect(r.drifted).toEqual([{ id: 'q-0001', gold_chunk_id: null, reason: 'no gold chunk to compare' }]);
  });

  it('does not carry a feature that the targets regenerate, even when its chunk is unchanged', () => {
    const lines = [v1('q-0001', 'Bill Passage Probability Index', 'c1', 'h1'), v1('q-0002', FEATURE_KEPT, 'c2', 'h2')];
    const r = carryOver(lines, hashes, { targets: V2_TARGETS });
    expect(r.kept.map((l) => l.carried_from)).toEqual(['q-0002']);
    expect(r.superseded).toBe(1);
    expect(r.drifted).toEqual([]);
  });

  it('keeps input order, and leaves numbering to renumberLines', () => {
    const lines = [v1('q-0050', FEATURE_KEPT, 'c1', 'h1'), v1('q-0051', FEATURE_KEPT, 'c1', 'stale'), v1('q-0052', FEATURE_KEPT, 'c3', 'h3')];
    const r = carryOver(lines, hashes);
    expect(r.kept.map((l) => l.id)).toEqual(['q-0050', 'q-0052']);
    expect(renumberLines(r.kept, 241).map((l) => [l.id, l.carried_from])).toEqual([['q-0241', 'q-0050'], ['q-0242', 'q-0052']]);
  });

  it('defaults to the v2 targets', () => {
    const r = carryOver([v1('q-0001', 'NCLT / NCLAT (Insolvency)', 'c1', 'h1')], hashes);
    expect(r.superseded).toBe(1);
  });

  it('does not change its input', () => {
    const line = v1('q-0001', FEATURE_KEPT, 'c1', 'h1');
    carryOver([line], hashes);
    expect(line).toEqual(v1('q-0001', FEATURE_KEPT, 'c1', 'h1'));
  });

  it('produces lines that still validate once renumbered', () => {
    const base = {
      id: 'q-0001', question: 'What?', desk_feature: FEATURE_KEPT,
      gold_document_ids: ['11111111-1111-4111-8111-111111111111'], gold_chunk_id: '22222222-2222-4222-8222-222222222222',
      gold_chunk_hash: 'h', gold_content_sha256: 's', gold_char_from: 0, gold_char_to: 10, document_key: null,
      distractor_ids: [], ambiguous: false, source: 'generated', generator_model: 'm', created_at: '2026-09-30T10:15:00.000Z',
    };
    const r = carryOver([base], new Map([[base.gold_chunk_id, 'h']]));
    const [line] = renumberLines(r.kept, 200);
    expect(line.id).toBe('q-0200');
    expect(validateQuestionLine(line)).toEqual({ ok: true });
  });
});

describe('parseDeveloperLines', () => {
  const GOLD = '11111111-1111-4111-8111-111111111111';
  const line = (patch = {}) => JSON.stringify({
    id: 'q-0001', question: 'Which tribunal bench heard the appeal?', desk_feature: 'NCLT / NCLAT (Insolvency)',
    gold_document_ids: [GOLD], gold_chunk_id: null, gold_chunk_hash: null, gold_content_sha256: null,
    gold_char_from: null, gold_char_to: null, document_key: null, distractor_ids: [], ambiguous: false,
    source: 'developer', generator_model: null, created_at: '2026-11-01T10:00:00.000Z', ...patch,
  });

  it('returns the parsed lines of a valid file, ignoring blank lines', () => {
    const r = parseDeveloperLines(`${line()}\n\n${line({ id: 'q-0002', question: 'Which member wrote the order?' })}\n`);
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => l.id)).toEqual(['q-0001', 'q-0002']);
  });

  it('names the file line and the field of every invalid line', () => {
    const r = parseDeveloperLines(`${line()}\n${line({ gold_document_ids: [] })}\n{oops`);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/^line 2: .*gold_document_ids/);
    expect(r.errors[1]).toMatch(/^line 3: .*JSON/);
  });

  it('rejects a line whose source is not developer', () => {
    const r = parseDeveloperLines(line({ source: 'owner' }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/source: must be 'developer'/);
  });

  it('rejects an empty file', () => {
    expect(parseDeveloperLines('\n').errors).toEqual(['no questions in the file']);
  });
});

describe('keysetNext', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

  it('continues from the last id of a full page', () => {
    expect(keysetNext(rows(1000), 1000)).toEqual({ cursor: 'id-999', done: false });
  });

  it('is done after a short page, and keeps its last id', () => {
    expect(keysetNext(rows(3), 1000)).toEqual({ cursor: 'id-2', done: true });
  });

  it('is done after an empty page, with no cursor', () => {
    expect(keysetNext([], 1000)).toEqual({ cursor: null, done: true });
  });

  it('treats a page that is exactly full as not done, so the next read finds the end', () => {
    expect(keysetNext(rows(1), 1).done).toBe(false);
  });
});

describe('pageDelayMs', () => {
  it('spaces requests 1000 / rate ms apart, less the time the request took', () => {
    expect(pageDelayMs(2, 0)).toBe(500);
    expect(pageDelayMs(2, 120)).toBe(380);
    expect(pageDelayMs(5, 0)).toBe(200);
  });

  it('never waits a negative time when the request was slower than the interval', () => {
    expect(pageDelayMs(2, 900)).toBe(0);
  });
});

describe('isValidRate', () => {
  it.each([[2, true], [0.5, true], [5, true], [0, false], [-1, false], [5.1, false], [Number.NaN, false], [Infinity, false], ['2', false]])(
    'rate %j -> %j',
    (rate, expected) => expect(isValidRate(rate)).toBe(expected),
  );
});

describe('parseDeveloperLines, duplicates', () => {
  const GOLD = '11111111-1111-4111-8111-111111111111';
  const line = (patch = {}) => JSON.stringify({
    id: 'q-0001', question: 'Which tribunal bench heard the appeal?', desk_feature: 'NCLT / NCLAT (Insolvency)',
    gold_document_ids: [GOLD], gold_chunk_id: null, gold_chunk_hash: null, gold_content_sha256: null,
    gold_char_from: null, gold_char_to: null, document_key: null, distractor_ids: [], ambiguous: false,
    source: 'developer', generator_model: null, created_at: '2026-11-01T10:00:00.000Z', ...patch,
  });

  it('rejects a repeated id, naming both file lines', () => {
    const r = parseDeveloperLines(`${line()}\n${line({ question: 'A different question?' })}`);
    expect(r.errors).toEqual(['line 2: id q-0001 repeats line 1']);
  });

  it('rejects the same question text after collapsing whitespace and case', () => {
    const r = parseDeveloperLines(`${line()}\n${line({ id: 'q-0002', question: '  WHICH tribunal   bench\theard the appeal?  ' })}`);
    expect(r.errors).toEqual(['line 2: question repeats line 1']);
  });

  it('accepts distinct ids and questions', () => {
    const r = parseDeveloperLines(`${line()}\n${line({ id: 'q-0002', question: 'Who was the resolution professional?' })}`);
    expect(r.errors).toEqual([]);
  });
});

describe('tagDeveloperRefs', () => {
  it('copies each line id into developer_ref, replacing any value already there, without changing the input', () => {
    const input = [{ id: 'q-0007', developer_ref: 'q-0001', question: 'a' }, { id: 'q-0003', question: 'b' }];
    expect(tagDeveloperRefs(input)).toEqual([
      { id: 'q-0007', developer_ref: 'q-0007', question: 'a' },
      { id: 'q-0003', developer_ref: 'q-0003', question: 'b' },
    ]);
    expect(input[0].developer_ref).toBe('q-0001');
  });

  it('survives renumbering: the new id is the sequence number, the old one is the reference', () => {
    const [line] = renumberLines(tagDeveloperRefs([{ id: 'q-0004', question: 'a' }]), 301);
    expect(line).toMatchObject({ id: 'q-0301', developer_ref: 'q-0004' });
  });
});

describe('checkDeveloperLines (against the corpus as read)', () => {
  const NCLT = 'NCLT / NCLAT (Insolvency)';
  const D1 = '11111111-1111-4111-8111-111111111111';
  const D2 = '33333333-3333-4333-8333-333333333333';
  const BILL = '44444444-4444-4444-8444-444444444444';
  const X = ['a', 'b', 'c', 'd'].map((ch) => `${ch.repeat(8)}-${ch.repeat(4)}-4${ch.repeat(3)}-8${ch.repeat(3)}-${ch.repeat(12)}`);
  const C1 = '22222222-2222-4222-8222-222222222222';
  const documents = new Map([[D1, { desk_feature: NCLT }], [D2, { desk_feature: NCLT }], [BILL, { desk_feature: 'Bill Passage Probability Index' }], ...X.map((id) => [id, { desk_feature: NCLT }])]);
  const chunks = new Map([[C1, { chunk_hash: 'h1', document_id: D1 }]]);
  const dev = (over = {}) => ({
    id: 'q-0001', desk_feature: NCLT, gold_document_ids: [D1], gold_chunk_id: null, gold_chunk_hash: null, distractor_ids: [], ...over,
  });
  const check = (lines) => checkDeveloperLines(lines, { documents, chunks });

  it('passes a line whose gold documents are in its feature', () => {
    expect(check([dev(), dev({ id: 'q-0002', gold_document_ids: [D1, D2], distractor_ids: X })])).toEqual([]);
  });

  it('flags a gold document that is not indexed', () => {
    expect(check([dev({ gold_document_ids: ['99999999-9999-4999-8999-999999999999'] })])).toEqual([
      'q-0001: gold document 99999999-9999-4999-8999-999999999999 is not indexed',
    ]);
  });

  it('flags a gold document from another desk_feature', () => {
    expect(check([dev({ gold_document_ids: [D1, BILL] })])).toEqual([
      `q-0001: gold document ${BILL} is in "Bill Passage Probability Index", not "${NCLT}"`,
    ]);
  });

  it('flags a gold chunk that does not exist', () => {
    expect(check([dev({ gold_chunk_id: '55555555-5555-4555-8555-555555555555' })])).toEqual([
      'q-0001: gold chunk 55555555-5555-4555-8555-555555555555 not found',
    ]);
  });

  it('flags a gold chunk whose hash differs, but not when the line gives no hash', () => {
    expect(check([dev({ gold_chunk_id: C1, gold_chunk_hash: 'old' })])).toEqual(['q-0001: gold chunk hash changed (line old, now h1)']);
    expect(check([dev({ gold_chunk_id: C1, gold_chunk_hash: 'h1' })])).toEqual([]);
    expect(check([dev({ gold_chunk_id: C1, gold_chunk_hash: null })])).toEqual([]);
  });

  it('flags a gold chunk that belongs to a document that is not gold', () => {
    expect(check([dev({ gold_document_ids: [D2], gold_chunk_id: C1 })])).toEqual([`q-0001: gold chunk ${C1} belongs to ${D1}, not a gold document`]);
  });

  it('flags a distractor that is not indexed or is a gold document', () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    expect(check([dev({ distractor_ids: [missing, X[1], X[2], X[3]] })])).toEqual([`q-0001: distractor ${missing} is not indexed`]);
    expect(check([dev({ distractor_ids: [D1, X[1], X[2], X[3]] })])).toEqual([`q-0001: distractor ${D1} is a gold document`]);
  });

  it('reports every problem of every line', () => {
    expect(check([dev({ gold_document_ids: [BILL] }), dev({ id: 'q-0002', gold_chunk_id: '55555555-5555-4555-8555-555555555555' })])).toHaveLength(2);
  });
});

describe('parseBuildArgs', () => {
  it('defaults to a v1 build at 2 requests a second', () => {
    expect(parseBuildArgs([])).toEqual({
      args: { setVersion: 'v1', out: null, maxUsd: 2, dryRun: false, carryOver: null, developer: null, rate: 2 },
      warnings: [],
    });
  });

  it('reads every option', () => {
    const { args, warnings } = parseBuildArgs(['--set-version', 'v2', '--out', 'x.jsonl', '--max-usd', '5', '--dry-run', '--carry-over', 'v1.jsonl', '--developer', 'dev.jsonl', '--rate', '3']);
    expect(args).toEqual({ setVersion: 'v2', out: 'x.jsonl', maxUsd: 5, dryRun: true, carryOver: 'v1.jsonl', developer: 'dev.jsonl', rate: 3 });
    expect(warnings).toEqual([]);
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    expect(() => parseBuildArgs(['--max-usd', '5', '--dry-runn'])).toThrow(/unknown argument: --dry-runn/);
    expect(() => parseBuildArgs(['--carryover', 'a'])).toThrow(/unknown argument: --carryover/);
  });

  it('rejects a stray positional argument', () => {
    expect(() => parseBuildArgs(['v2'])).toThrow(/unknown argument: v2/);
  });

  it('rejects an option that is missing its value', () => {
    expect(() => parseBuildArgs(['--out'])).toThrow(/--out needs a value/);
    expect(() => parseBuildArgs(['--max-usd', '--dry-run'])).toThrow(/--max-usd needs a value/);
  });

  it('keeps the earlier checks: cost cap, rate, set version, v2-only options', () => {
    expect(() => parseBuildArgs(['--max-usd', '0'])).toThrow(/--max-usd must be a positive number/);
    expect(() => parseBuildArgs(['--max-usd', 'abc'])).toThrow(/--max-usd must be a positive number/);
    expect(() => parseBuildArgs(['--rate', '6'])).toThrow(/--rate must be above 0 and at most 5/);
    expect(() => parseBuildArgs(['--rate', 'x'])).toThrow(/--rate must be above 0 and at most 5/);
    expect(() => parseBuildArgs(['--set-version', 'v3'])).toThrow(/--set-version must be one of v1, v2/);
    expect(() => parseBuildArgs(['--carry-over', 'a.jsonl'])).toThrow(/v2 only/);
    expect(() => parseBuildArgs(['--developer', 'a.jsonl'])).toThrow(/v2 only/);
  });

  it('warns when v2 runs without --carry-over, and not otherwise', () => {
    expect(parseBuildArgs(['--set-version', 'v2']).warnings).toEqual([expect.stringMatching(/without --carry-over/)]);
    expect(parseBuildArgs(['--set-version', 'v2', '--carry-over', 'v1.jsonl']).warnings).toEqual([]);
    expect(parseBuildArgs([]).warnings).toEqual([]);
  });
});

describe('ambiguity-aware acceptance', () => {
  const acc = (...flags) => flags.map((ambiguous, index) => ({ index, ambiguous }));

  it('counts every acceptance toward the target for v1', () => {
    expect(needsMore(acc(false, true), 3)).toBe(true);
    expect(needsMore(acc(false, true, true), 3)).toBe(false);
  });

  it('counts only non-ambiguous acceptances toward the target when asked', () => {
    const o = { countAmbiguous: false };
    expect(needsMore(acc(false, true, true), 3, o)).toBe(true);
    expect(needsMore(acc(false, true, true, false, false), 3, o)).toBe(false);
  });

  it('takes the lowest target acceptances in queue order for v1, whatever order they finished in', () => {
    const finished = [{ index: 5, ambiguous: false }, { index: 1, ambiguous: true }, { index: 3, ambiguous: false }, { index: 9, ambiguous: false }];
    expect(takeAccepted(finished, 2).map((a) => a.index)).toEqual([1, 3]);
  });

  it('keeps the ambiguous acceptances met on the way to the target-th non-ambiguous one, and no more', () => {
    const finished = [
      { index: 0, ambiguous: false }, { index: 2, ambiguous: true }, { index: 3, ambiguous: false },
      { index: 4, ambiguous: true }, { index: 6, ambiguous: false }, { index: 7, ambiguous: true },
    ];
    const got = takeAccepted(finished, 3, { countAmbiguous: false });
    expect(got.map((a) => a.index)).toEqual([0, 2, 3, 4, 6]);
    expect(got.filter((a) => !a.ambiguous)).toHaveLength(3);
  });

  it('returns what it has when there are fewer than the target', () => {
    expect(takeAccepted(acc(false, true), 5, { countAmbiguous: false })).toHaveLength(2);
  });

  it('counts the generated, non-ambiguous questions of each feature', () => {
    const lines = [
      { desk_feature: 'A', source: 'generated', ambiguous: false },
      { desk_feature: 'A', source: 'generated', ambiguous: true },
      { desk_feature: 'A', source: 'developer', ambiguous: false },
      { desk_feature: 'B', source: 'generated', ambiguous: false },
    ];
    expect(nonAmbiguousCounts(lines, ['A', 'B', 'C'])).toEqual({ A: 1, B: 1, C: 0 });
  });

  it('lists the features under the floor of 50', () => {
    expect(MIN_NON_AMBIGUOUS).toBe(50);
    expect(nonAmbiguousShortfalls({ A: 50, B: 49, C: 0 })).toEqual([{ feature: 'B', count: 49 }, { feature: 'C', count: 0 }]);
    expect(nonAmbiguousShortfalls({ A: 60 })).toEqual([]);
    expect(nonAmbiguousShortfalls({ A: 5 }, 5)).toEqual([]);
  });
});

describe('readAllKeyset', () => {
  /**
   * A PostgREST-like select builder over `n` rows with ids id-00000.., recording what each request
   * asked for. It throws after `maxRequests`, which is what an implementation that forgets `.gt`
   * would hit: it would re-read the first page for ever.
   */
  function fakeTable(n, { maxRequests = 20, failAt = null } = {}) {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(5, '0')}`, n: i }));
    const requests = [];
    const build = () => {
      const req = { order: null, limit: null, gt: null };
      const api = {
        order(column) { req.order = column; return api; },
        limit(count) { req.limit = count; return api; },
        gt(column, value) { req.gt = [column, value]; return api; },
        then(resolve, reject) {
          try {
            requests.push(req);
            if (requests.length > maxRequests) throw new Error(`runaway: more than ${maxRequests} requests`);
            if (failAt === requests.length) return resolve({ data: null, error: { message: 'boom' } });
            let out = rows;
            if (req.order !== 'id') throw new Error('request was not ordered by id');
            if (req.gt) out = out.filter((r) => r[req.gt[0]] > req.gt[1]);
            return resolve({ data: out.slice(0, req.limit), error: null });
          } catch (e) {
            return reject(e);
          }
        },
      };
      return api;
    };
    return { build, requests, rows };
  }
  const noSleep = { sleep: async () => {}, now: () => 0 };

  it('reads every row in id order, continuing after the last id of each page', async () => {
    const t = fakeTable(7);
    const got = await readAllKeyset(t.build, { what: 't', rate: 2, pageSize: 3, ...noSleep });
    expect(got).toEqual(t.rows);
    expect(t.requests.map((r) => r.gt)).toEqual([null, ['id', 'id-00002'], ['id', 'id-00005']]);
    expect(t.requests.every((r) => r.limit === 3 && r.order === 'id')).toBe(true);
  });

  it('ends on a short page without asking again', async () => {
    const t = fakeTable(4);
    await readAllKeyset(t.build, { what: 't', rate: 2, pageSize: 3, ...noSleep });
    expect(t.requests).toHaveLength(2);
  });

  it('asks once more after an exactly full last page, and gets nothing', async () => {
    const t = fakeTable(6);
    const got = await readAllKeyset(t.build, { what: 't', rate: 2, pageSize: 3, ...noSleep });
    expect(got).toHaveLength(6);
    expect(t.requests).toHaveLength(3);
  });

  it('returns nothing for an empty table after one request', async () => {
    const t = fakeTable(0);
    expect(await readAllKeyset(t.build, { what: 't', rate: 2, pageSize: 3, ...noSleep })).toEqual([]);
    expect(t.requests).toHaveLength(1);
  });

  it('uses a page size of 1000 by default', async () => {
    const t = fakeTable(1500);
    const got = await readAllKeyset(t.build, { what: 't', rate: 5, ...noSleep });
    expect(got).toHaveLength(1500);
    expect(t.requests.map((r) => r.limit)).toEqual([1000, 1000]);
  });

  it('sleeps between pages for the rest of the interval, and not after the last page', async () => {
    const t = fakeTable(7);
    const sleeps = [];
    let clock = 0;
    const now = () => clock;
    const sleep = async (ms) => { sleeps.push(ms); clock += ms; };
    // each request takes 100 ms of the fake clock
    const build = () => { clock += 100; return t.build(); };
    await readAllKeyset(build, { what: 't', rate: 2, pageSize: 3, sleep, now });
    expect(sleeps).toEqual([400, 400]);
  });

  it('names the read and the cursor when a page fails', async () => {
    const t = fakeTable(7, { failAt: 2 });
    await expect(readAllKeyset(t.build, { what: 'document_chunks', rate: 2, pageSize: 3, ...noSleep })).rejects.toThrow(/document_chunks \(after id-00002\): boom/);
  });
});
