import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compareRuns,
  fingerprintCheck,
  judgeNoWorse,
  outcome,
  percentile,
  renderReport,
  summarise,
  summariseByFeature,
} from './retrievalEval.js';

const BILLS = 'Bill Passage Probability Index';
const REG = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
const PQ = 'Parliamentary Question Database';
const IND = 'Industry Updates (Ministry Data)';

/** A generated question line; only the fields scoring reads are meaningful. */
function line(id, over = {}) {
  return {
    id,
    question: `question ${id}`,
    desk_feature: BILLS,
    gold_document_ids: [`doc-${id}`],
    gold_chunk_id: `chunk-${id}`,
    gold_chunk_hash: `hash-${id}`,
    gold_content_sha256: `sha-${id}`,
    gold_char_from: 0,
    gold_char_to: 100,
    document_key: null,
    distractor_ids: [],
    ambiguous: false,
    source: 'generated',
    ...over,
  };
}

/** `n` filler rows from unrelated documents, ranks 1..n. */
function filler(n, prefix = 'other') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-c${i}`, document_id: `${prefix}-d${i}`, similarity: 0.5 }));
}

/** Filler rows with the gold chunk of `l` placed at 1-based `rank`. */
function rowsWithGoldAt(l, rank, total = 40) {
  const rows = filler(total);
  rows[rank - 1] = { id: l.gold_chunk_id, document_id: l.gold_document_ids[0], similarity: 0.5 };
  return rows;
}

const noKeys = new Map();

describe('outcome', () => {
  it('ranks by 1-based row position for document and chunk', () => {
    const l = line('1');
    const got = outcome(l, rowsWithGoldAt(l, 7), noKeys);
    expect(got).toMatchObject({ docRank: 7, keyRank: 7, chunkRank: 7 });
  });

  it('is null for every rank when nothing gold comes back', () => {
    expect(outcome(line('1'), filler(40), noKeys)).toMatchObject({ docRank: null, keyRank: null, chunkRank: null });
  });

  it('takes the first gold-document row, even when it is not the gold chunk', () => {
    const l = line('1');
    const rows = filler(10);
    rows[2] = { id: 'sibling-chunk', document_id: 'doc-1', similarity: 0.5 };
    rows[5] = { id: 'chunk-1', document_id: 'doc-1', similarity: 0.5 };
    expect(outcome(l, rows, noKeys)).toMatchObject({ docRank: 3, chunkRank: 6 });
  });

  // The RPC's unscoped branch orders by halfvec distance but reports
  // full-precision similarity, so similarity can disagree with row order.
  // A scorer that re-sorts by similarity would move the gold row from 12 to 1.
  it('uses array order, never a re-sort by similarity', () => {
    const l = line('1');
    const rows = filler(40).map((r, i) => ({ ...r, similarity: 0.9 - i * 0.01 }));
    rows[11] = { id: 'chunk-1', document_id: 'doc-1', similarity: 0.99 };
    expect(outcome(l, rows, noKeys)).toMatchObject({ docRank: 12, chunkRank: 12 });
  });

  it('accepts any of several gold documents', () => {
    const l = line('1', { gold_document_ids: ['doc-a', 'doc-b'], gold_chunk_id: null });
    const rows = filler(10);
    rows[4] = { id: 'x', document_id: 'doc-b' };
    expect(outcome(l, rows, noKeys)).toMatchObject({ docRank: 5, chunkRank: null, chunkScored: false });
  });

  it('counts a same-key hit when a different document shares the document_key', () => {
    const l = line('1', { document_key: 'bill:2021:116' });
    const rows = rowsWithGoldAt(l, 9);
    rows[3] = { id: 'twin-chunk', document_id: 'twin-doc' };
    const keyOf = new Map([['twin-doc', 'bill:2021:116'], ['other-d0', 'bill:1999:1']]);
    expect(outcome(l, rows, keyOf)).toMatchObject({ docRank: 9, keyRank: 4 });
  });

  it('does not treat two null keys as the same key', () => {
    const l = line('1', { document_key: null });
    const keyOf = new Map([['other-d0', null]]);
    expect(outcome(l, filler(5), keyOf).keyRank).toBeNull();
  });
});

describe('summarise', () => {
  const ranks = (docRank, chunkRank = docRank) => ({ docRank, keyRank: docRank, chunkRank, chunkScored: true });

  it('counts a hit at rank k and not at rank k+1', () => {
    const s = summarise([ranks(5), ranks(6), ranks(10), ranks(11), ranks(40), ranks(41)]);
    expect(s.n).toBe(6);
    expect(s.doc.hits).toEqual({ 5: 1, 10: 3, 40: 5 });
    expect(s.chunk.hits).toEqual({ 5: 1, 10: 3, 40: 5 });
    expect(s.doc.rate[10]).toBeCloseTo(3 / 6);
  });

  it('computes MRR@40 with misses and ranks beyond 40 contributing zero', () => {
    const s = summarise([ranks(1), ranks(4), ranks(null), ranks(41)]);
    expect(s.doc.mrr).toBeCloseTo((1 + 0.25) / 4);
    expect(s.chunk.mrr).toBeCloseTo((1 + 0.25) / 4);
  });

  it('scores the key figure separately from the document figure', () => {
    const s = summarise([{ docRank: 12, keyRank: 2, chunkRank: 12, chunkScored: true }]);
    expect(s.doc.hits[10]).toBe(0);
    expect(s.key.hits[10]).toBe(1);
  });

  it('leaves questions without a gold chunk out of the chunk denominator', () => {
    const s = summarise([ranks(1), { docRank: 1, keyRank: 1, chunkRank: null, chunkScored: false }]);
    expect(s.doc.n).toBe(2);
    expect(s.chunk.n).toBe(1);
    expect(s.chunk.rate[5]).toBe(1);
  });

  it('returns zero rates, not NaN, for an empty set', () => {
    const s = summarise([]);
    expect(s.n).toBe(0);
    expect(s.doc.rate[10]).toBe(0);
    expect(s.doc.mrr).toBe(0);
  });
});

describe('summariseByFeature', () => {
  const lines = [
    line('1'),
    line('2', { desk_feature: REG }),
    line('3', { desk_feature: REG, ambiguous: true }),
    line('4', { desk_feature: PQ }),
  ];
  const outcomes = [
    { docRank: 1, keyRank: 1, chunkRank: 1, chunkScored: true },
    { docRank: 20, keyRank: 20, chunkRank: null, chunkScored: true },
    { docRank: 2, keyRank: 2, chunkRank: 2, chunkScored: true },
    { docRank: null, keyRank: null, chunkRank: null, chunkScored: true },
  ];

  it('summarises every line overall and per feature by default', () => {
    const s = summariseByFeature(lines, outcomes);
    expect(s.overall.n).toBe(4);
    expect(s.features[REG].n).toBe(2);
    expect(s.features[REG].doc.hits[10]).toBe(1);
    expect(s.ambiguousExcluded).toBe(0);
  });

  it('can exclude ambiguous lines, and says how many it excluded', () => {
    const s = summariseByFeature(lines, outcomes, { excludeAmbiguous: true });
    expect(s.overall.n).toBe(3);
    expect(s.features[REG].n).toBe(1);
    expect(s.features[REG].doc.hits[10]).toBe(0);
    expect(s.ambiguousExcluded).toBe(1);
  });

  it('keeps a feature whose only lines are ambiguous, with n 0, when excluding them', () => {
    const s = summariseByFeature([line('a'), line('b', { desk_feature: IND, ambiguous: true })], [outcomes[0], outcomes[0]], { excludeAmbiguous: true });
    expect(Object.keys(s.features)).toEqual([BILLS, IND]);
    expect(s.features[IND].n).toBe(0);
  });

  // Canonical order differs from alphabetical here: Regulatory before Parliamentary.
  it('lists features in the canonical corpus order', () => {
    const s = summariseByFeature([line('a', { desk_feature: PQ }), line('b', { desk_feature: REG })], [outcomes[0], outcomes[0]]);
    expect(Object.keys(s.features)).toEqual([REG, PQ]);
  });

  it('accepts outcomes keyed by question id', () => {
    const byId = new Map(lines.map((l, i) => [l.id, outcomes[i]]));
    expect(summariseByFeature(lines, byId)).toEqual(summariseByFeature(lines, outcomes));
  });
});

describe('fingerprintCheck', () => {
  const lines = [line('1'), line('2'), line('3'), line('o', { source: 'owner', gold_chunk_id: null, gold_chunk_hash: null })];
  const intact = () => new Map([
    ['chunk-1', { chunk_hash: 'hash-1', document_id: 'doc-1' }],
    ['chunk-2', { chunk_hash: 'hash-2', document_id: 'doc-2' }],
    ['chunk-3', { chunk_hash: 'hash-3', document_id: 'doc-3' }],
  ]);

  it('passes when every gold chunk is present and unchanged, skipping owner lines', () => {
    expect(fingerprintCheck(lines, intact())).toEqual({ ok: true, missing: [], changed: [] });
  });

  it('aborts, listing every missing gold chunk', () => {
    const chunks = intact();
    chunks.delete('chunk-1');
    chunks.delete('chunk-3');
    const got = fingerprintCheck(lines, chunks);
    expect(got.ok).toBe(false);
    expect(got.missing.map((m) => m.id)).toEqual(['1', '3']);
    expect(got.missing[0]).toMatchObject({ id: '1', gold_chunk_id: 'chunk-1' });
    expect(got.changed).toEqual([]);
  });

  it('aborts, listing every gold chunk whose hash changed', () => {
    const chunks = intact();
    chunks.set('chunk-2', { chunk_hash: 'rechunked', document_id: 'doc-2' });
    const got = fingerprintCheck(lines, chunks);
    expect(got.ok).toBe(false);
    expect(got.changed).toEqual([{ id: '2', gold_chunk_id: 'chunk-2', expected: 'hash-2', actual: 'rechunked', reason: 'chunk_hash changed' }]);
  });

  it('aborts when a gold chunk now belongs to a document that is not gold', () => {
    const chunks = intact();
    chunks.set('chunk-2', { chunk_hash: 'hash-2', document_id: 'doc-elsewhere' });
    const got = fingerprintCheck(lines, chunks);
    expect(got.ok).toBe(false);
    expect(got.changed[0]).toMatchObject({ id: '2', reason: 'document_id not gold' });
  });
});

describe('percentile (nearest rank)', () => {
  it('returns the only value for a single-element list, at any p', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('takes the 19th of 20 sorted values for p95, whatever the input order', () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 10).reverse();
    expect(percentile(values, 95)).toBe(190);
    expect(percentile(values, 50)).toBe(100);
    expect(percentile(values, 100)).toBe(200);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });

  it('is null for no values and rejects p outside (0, 100]', () => {
    expect(percentile([], 95)).toBeNull();
    expect(() => percentile([1], 0)).toThrow();
    expect(() => percentile([1], 101)).toThrow();
  });
});

const at = (docRank) => ({ docRank, keyRank: docRank, chunkRank: docRank, chunkScored: true });

describe('compareRuns', () => {
  const lines = Array.from({ length: 12 }, (_, i) => line(`q${i}`, { desk_feature: i < 6 ? BILLS : REG }));

  it('catches 5 lost and 5 gained, nets them to 0, and still lists the 5 lost', () => {
    const before = lines.map((_, i) => at(i < 5 ? 3 : i < 10 ? 25 : 1));
    const after = lines.map((_, i) => at(i < 5 ? 25 : i < 10 ? 3 : 1));
    const c = compareRuns(lines, before, after);
    expect(c.overall).toEqual({ lost: 5, gained: 5, netLoss: 0 });
    expect(c.lost.map((q) => q.id)).toEqual(['q0', 'q1', 'q2', 'q3', 'q4']);
    expect(c.lost[0]).toEqual({ id: 'q0', desk_feature: BILLS, before: 3, after: 25 });
    expect(c.gained.map((q) => q.id)).toEqual(['q5', 'q6', 'q7', 'q8', 'q9']);
    expect(c.byFeature[BILLS]).toEqual({ lost: 5, gained: 1, netLoss: 4 });
    expect(c.byFeature[REG]).toEqual({ lost: 0, gained: 4, netLoss: -4 });
  });

  it('treats a move from rank 10 to 11 as a loss, and 10 to 10 as nothing', () => {
    const c = compareRuns(lines.slice(0, 2), [at(10), at(10)], [at(11), at(10)]);
    expect(c.lost.map((q) => q.id)).toEqual(['q0']);
    expect(c.gained).toEqual([]);
  });

  it('marks a top-10 hit that falls out of all 40 as a hard loss', () => {
    const c = compareRuns(lines.slice(0, 3), [at(2), at(9), at(2)], [at(null), at(30), at(2)]);
    expect(c.hardLosses).toEqual([{ id: 'q0', desk_feature: BILLS, before: 2, after: null }]);
    expect(c.lost).toHaveLength(2);
  });

  it('leaves ambiguous and owner questions out of every count', () => {
    const extra = [line('amb', { ambiguous: true }), line('own', { source: 'owner', gold_chunk_id: null })];
    const c = compareRuns(extra, [at(1), at(1)], [at(null), at(null)]);
    expect(c.n).toBe(0);
    expect(c.lost).toEqual([]);
    expect(c.hardLosses).toEqual([]);
  });

  it('refuses to compare when a question has no outcome on one side', () => {
    expect(() => compareRuns(lines.slice(0, 2), [at(1), at(1)], [at(1)])).toThrow(/q1/);
  });
});

describe('judgeNoWorse', () => {
  // 6 Bills, 6 Regulatory, 4 Parliamentary, 4 Industry; every question a
  // rank-3 hit everywhere, all calls full and fast. Tests perturb one bar.
  const features = [...Array(6).fill(BILLS), ...Array(6).fill(REG), ...Array(4).fill(PQ), ...Array(4).fill(IND)];
  const lines = features.map((f, i) => line(`q${String(i).padStart(2, '0')}`, { desk_feature: f }));
  const idsOf = (feature) => lines.filter((l) => l.desk_feature === feature).map((l) => l.id);
  const hitsEverywhere = () => new Map(lines.map((l) => [l.id, at(3)]));
  function input() {
    return {
      lines,
      baseline: { broad: hitsEverywhere(), focused: hitsEverywhere(), 'focused-multi': hitsEverywhere() },
      candidate: { broad: hitsEverywhere(), focused: hitsEverywhere(), 'focused-multi': hitsEverywhere(), feature: hitsEverywhere() },
      featureCalls: lines.map((l) => ({ id: l.id, returned: 40, expected: 40 })),
      latency: {
        broad: { baseline: Array(20).fill(100), candidate: Array(20).fill(100) },
        feature: { baseline: [], candidate: Array(20).fill(90) },
      },
    };
  }
  const lose = (outcomes, ids, after = 25) => { for (const id of ids) outcomes.set(id, at(after)); };

  it('passes when nothing moved', () => {
    expect(judgeNoWorse(input())).toMatchObject({ pass: true, failures: [], lost: [] });
  });

  it('passes at the limits: 2 lost in Bills, 1 in Parliamentary, overall net 2 after a gain', () => {
    const x = input();
    lose(x.candidate.broad, idsOf(BILLS).slice(0, 2));
    lose(x.candidate.broad, idsOf(PQ).slice(0, 1));
    x.baseline.broad.set(idsOf(REG)[0], at(30)); // gained in the candidate
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual([]);
    expect(got.pass).toBe(true);
    expect(got.lost).toHaveLength(3);
  });

  it('fails on an overall broad net loss of 3', () => {
    const x = input();
    lose(x.candidate.broad, [idsOf(BILLS)[0], idsOf(REG)[0], idsOf(PQ)[0]]);
    const got = judgeNoWorse(x);
    expect(got.pass).toBe(false);
    expect(got.failures).toEqual([expect.stringMatching(/^broad: overall document hit@10 net loss 3 > 2/)]);
  });

  it('fails on a single hard loss even when the net is within bounds', () => {
    const x = input();
    x.candidate.broad.set(idsOf(REG)[1], at(null));
    const got = judgeNoWorse(x);
    expect(got.pass).toBe(false);
    expect(got.failures).toEqual([expect.stringMatching(/hard loss.*q\d\d \(rank 3 → miss\)/)]);
  });

  it('fails Bills or Regulatory at a net loss of 3', () => {
    const x = input();
    lose(x.candidate.broad, idsOf(BILLS).slice(0, 3));
    x.baseline.broad.set(idsOf(REG)[0], at(30));
    x.baseline.broad.set(idsOf(PQ)[0], at(30));
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual([expect.stringMatching(new RegExp(`^broad: ${BILLS.replace(/[()]/g, '\\$&')} document hit@10 net loss 3 > 2`))]);
  });

  it('fails the small features at a net loss of 2', () => {
    const x = input();
    lose(x.candidate.broad, idsOf(IND).slice(0, 2));
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual([expect.stringMatching(/^broad: Industry Updates \(Ministry Data\) document hit@10 net loss 2 > 1/)]);
  });

  it('fails when feature mode hits fewer than the broad baseline in a feature', () => {
    const x = input();
    x.candidate.feature.set(idsOf(PQ)[0], at(12));
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual([expect.stringMatching(/^feature: Parliamentary Question Database document hit@10 3 < broad baseline 4/)]);
  });

  it('fails when a feature call returns fewer rows than it should', () => {
    const x = input();
    x.featureCalls[4] = { id: 'q04', returned: 17, expected: 40 };
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual([expect.stringMatching(/^feature: 1 call\(s\) returned fewer rows than match_count: q04 \(17\/40\)/)]);
  });

  it('fails when focused or focused-multi outcomes change at all', () => {
    const x = input();
    x.candidate.focused.set('q01', { ...at(3), chunkRank: 4 });
    x.candidate['focused-multi'].set('q02', at(2));
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual([
      expect.stringMatching(/^focused: 1 question\(s\) changed outcome: q01/),
      expect.stringMatching(/^focused-multi: 1 question\(s\) changed outcome: q02/),
    ]);
  });

  it('fails on p95 above 1.2 × baseline + 20 ms, and passes exactly at it', () => {
    const x = input();
    x.latency.broad.candidate = Array(20).fill(140);
    expect(judgeNoWorse(x).pass).toBe(true);
    x.latency.broad.candidate = Array(20).fill(141);
    expect(judgeNoWorse(x).failures).toEqual([expect.stringMatching(/^broad: p95 141 ms > 1\.2 × 100 \+ 20 = 140 ms/)]);
  });

  it('flags a call over 2 s and fails a call over 4 s', () => {
    const x = input();
    x.latency.feature.candidate = [...Array(19).fill(90), 2500];
    const flagged = judgeNoWorse(x);
    expect(flagged.pass).toBe(true);
    expect(flagged.flags).toEqual(expect.arrayContaining([expect.stringMatching(/^feature: 1 call\(s\) over 2000 ms/)]));
    x.latency.feature.candidate = [...Array(19).fill(90), 4001];
    expect(judgeNoWorse(x).failures).toEqual([expect.stringMatching(/^feature: 1 call\(s\) over 4000 ms/)]);
  });

  it('ignores ambiguous questions in every bar', () => {
    const x = input();
    const amb = line('amb', { ambiguous: true, desk_feature: IND });
    x.lines = [...lines, amb];
    for (const m of ['broad', 'focused', 'focused-multi']) x.baseline[m].set('amb', at(1));
    for (const m of ['focused', 'focused-multi']) x.candidate[m].set('amb', at(9));
    x.candidate.broad.set('amb', at(null));
    x.candidate.feature.set('amb', at(null));
    expect(judgeNoWorse(x)).toMatchObject({ pass: true, lost: [] });
  });

  it('gives the same verdict for outcome arrays aligned with lines as for Maps', () => {
    const x = input();
    x.lines = [line('amb', { ambiguous: true }), ...lines]; // shifts every index by one
    lose(x.candidate.broad, idsOf(IND).slice(0, 2));
    x.candidate.focused.set('q01', at(4));
    const asArrays = (m) => x.lines.map((l) => m.get(l.id));
    const y = {
      ...x,
      baseline: Object.fromEntries(Object.entries(x.baseline).map(([k, m]) => [k, asArrays(m)])),
      candidate: Object.fromEntries(Object.entries(x.candidate).map(([k, m]) => [k, asArrays(m)])),
    };
    const fromMaps = judgeNoWorse(x);
    expect(fromMaps.failures).toHaveLength(2);
    expect(judgeNoWorse(y)).toEqual(fromMaps);
  });

  it('fails when a required mode or the latency data is missing', () => {
    const x = input();
    delete x.candidate.feature;
    delete x.latency;
    const got = judgeNoWorse(x);
    expect(got.pass).toBe(false);
    expect(got.failures).toEqual(expect.arrayContaining([
      expect.stringMatching(/^feature: not run/),
      expect.stringMatching(/^latency: no measurements/),
    ]));
  });
});

describe('renderReport', () => {
  const lines = [
    line('q01'),
    line('q02'),
    line('q03', { desk_feature: REG }),
    line('q04', { desk_feature: REG, ambiguous: true }),
    line('q05', { desk_feature: PQ, distractor_ids: ['d1', 'd2', 'd3', 'd4'] }),
    line('o01', { source: 'owner', gold_chunk_id: null }),
  ];
  const outcomes = new Map([
    ['q01', at(1)], ['q02', at(12)], ['q03', at(null)], ['q04', at(2)], ['q05', at(4)], ['o01', { ...at(6), chunkRank: null, chunkScored: false }],
  ]);
  function run(over = {}) {
    return {
      setVersion: 'questions.v1',
      commit: 'abc1234',
      fingerprint: { documents: 2338, chunks: 54219, latestIndexedAt: '2026-09-29T10:00:00Z', migrationVersion: '20260929120100' },
      cost: { embeddingTokens: 0, usd: 0 },
      modes: {
        'focused-multi': { lines: [lines[4]], outcomes: new Map([['q05', at(4)]]), latencyMs: [50], networkMs: [20], responseBytes: [1000], skipped: 5 },
        broad: {
          lines,
          outcomes,
          latencyMs: Array.from({ length: 20 }, (_, i) => (i + 1) * 10),
          networkMs: [30, 40],
          responseBytes: [1000, 3000],
        },
      },
      ...over,
    };
  }

  it('records the set version, fingerprint, commit, migration and cost', () => {
    const md = renderReport(run());
    expect(md).toContain('questions.v1');
    expect(md).toContain('abc1234');
    expect(md).toContain('20260929120100');
    expect(md).toMatch(/2338 documents, 54219 chunks/);
    expect(md).toContain('2026-09-29T10:00:00Z');
    expect(md).toMatch(/Cost: \$0\.0000 \(0 embedding tokens\)/);
  });

  it('tabulates each mode overall and per feature, without ambiguous or owner questions', () => {
    const md = renderReport(run());
    const broad = md.slice(md.indexOf('## Mode: broad'), md.indexOf('## Mode: focused-multi'));
    expect(broad).toMatch(/\| Overall \| 4 \| 1 \| 2\/4 \(50\.0%\) \| 2\/4 \(50\.0%\) \| 3\/4 \(75\.0%\) \|/);
    expect(broad).toMatch(new RegExp(`\\| ${REG.replace(/[()]/g, '\\$&')} \\| 1 \\| 1 \\| 0/1 \\(0\\.0%\\)`));
    expect(broad).toMatch(/\| Owner questions \| 1 \| — \|/);
    expect(broad.indexOf(BILLS)).toBeLessThan(broad.indexOf(REG));
    expect(broad.indexOf(REG)).toBeLessThan(broad.indexOf(PQ));
  });

  it('reports latency p50/p95 with the network baseline and mean response size', () => {
    const md = renderReport(run());
    expect(md).toMatch(/broad.*RPC p50 100 ms, p95 190 ms.*network baseline p50 30 ms, p95 40 ms.*mean response 2000 bytes/);
  });

  it('states the capped chunk quota for focused-multi, and only when it ran', () => {
    expect(renderReport(run())).toMatch(/quota is ceil\(40\/5\) = 8 .*chunk hit@k for k > 8 is capped/);
    expect(renderReport(run())).toMatch(/5 question\(s\) skipped/);
    const withoutMulti = run();
    delete withoutMulti.modes['focused-multi'];
    expect(renderReport(withoutMulti)).not.toMatch(/ceil\(40\/5\)/);
  });

  it('lists modes in a fixed order whatever order they were given in', () => {
    const md = renderReport(run());
    expect(md.indexOf('## Mode: broad')).toBeGreaterThan(-1);
    expect(md.indexOf('## Mode: broad')).toBeLessThan(md.indexOf('## Mode: focused-multi'));
  });

  it('shows the verdict and every lost question with its before and after rank', () => {
    const verdict = {
      pass: false,
      failures: ['broad: 1 hard loss(es), top-10 to a miss beyond 40: q03 (rank 2 → miss)'],
      flags: ['feature: 1 call(s) over 2000 ms (max 2100 ms)'],
      lost: [
        { id: 'q03', desk_feature: REG, before: 2, after: null },
        { id: 'q02', desk_feature: BILLS, before: 7, after: 12 },
      ],
    };
    const md = renderReport(run({ verdict }));
    expect(md).toMatch(/Verdict: \*\*FAIL\*\*/);
    expect(md).toContain('- broad: 1 hard loss(es)');
    expect(md).toContain('- feature: 1 call(s) over 2000 ms');
    expect(md).toContain(`| q02 | ${BILLS} | 7 | 12 |`);
    expect(md).toContain(`| q03 | ${REG} | 2 | miss |`);
    expect(md.indexOf('| q02 |')).toBeLessThan(md.indexOf('| q03 |'));
  });

  it('omits the verdict section when there is no comparison', () => {
    expect(renderReport(run())).not.toMatch(/Verdict/);
  });

  it('is deterministic', () => {
    expect(renderReport(run())).toBe(renderReport(run()));
  });
});

// v1-shaped sets hold only generated and owner questions. These tests pin what the harness made of
// such a set before developer questions existed: the hashes were taken from the code as it was then,
// so any change in how a v1 set is judged or reported fails here.
describe('a v1-shaped set is judged and reported as it was before developer questions', () => {
  const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
  const v1Features = [...Array(8).fill(BILLS), ...Array(6).fill(REG), ...Array(5).fill(PQ), ...Array(3).fill(IND)];
  const v1Lines = [
    ...v1Features.map((f, i) => line(`q${String(i).padStart(2, '0')}`, { desk_feature: f, ambiguous: i % 7 === 3, distractor_ids: i % 2 ? ['d1', 'd2', 'd3', 'd4'] : [] })),
    line('o01', { source: 'owner', gold_chunk_id: null, desk_feature: BILLS }),
    line('o02', { source: 'owner', gold_chunk_id: null, desk_feature: PQ }),
  ];
  const base = () => new Map(v1Lines.map((l, i) => [l.id, at(1 + (i % 6))]));
  function candidate() {
    const m = base();
    m.set('q00', at(25)); // top-10 to rank 25: lost
    m.set('q01', at(null)); // hard loss
    m.set('q09', at(15)); // lost in Regulatory
    m.set('o01', at(null)); // owner: never counted in the bars
    m.set('q03', at(null)); // ambiguous: never counted in the bars
    return m;
  }
  const featureCalls = v1Lines.map((l, i) => ({ id: l.id, returned: i === 4 ? 12 : 40, expected: 40 }));
  const latency = { broad: { baseline: Array(20).fill(100), candidate: Array(20).fill(150) }, feature: { baseline: [], candidate: [...Array(19).fill(90), 2500] } };
  const input = () => ({
    lines: v1Lines,
    baseline: { broad: base(), focused: base(), 'focused-multi': base() },
    candidate: { broad: candidate(), focused: candidate(), 'focused-multi': base(), feature: candidate() },
    featureCalls,
    latency,
  });

  it('judges the same', () => {
    const got = judgeNoWorse(input());
    expect(got.pass).toBe(false);
    expect(Object.keys(got)).toEqual(['pass', 'failures', 'flags', 'lost']);
    expect(sha(got)).toBe('8a76f175159204a9198c77d1b965af6420af2946496039e32962f60c72c8188a');
  });

  it('compares the same', () => {
    expect(sha(compareRuns(v1Lines, base(), candidate()))).toBe('b06988bca9aa7b36fec814a80e556b13ef549c315d2a46e9cb9e20c6fe79dc3f');
  });

  it('reports the same', () => {
    const modes = {
      broad: { lines: v1Lines, outcomes: candidate(), latencyMs: [10, 20, 30], networkMs: [5], responseBytes: [100] },
      focused: { lines: v1Lines, outcomes: base(), latencyMs: [10], networkMs: [5], responseBytes: [100] },
    };
    const verdict = judgeNoWorse(input());
    const md = renderReport({ setVersion: 'questions.v1', commit: 'abc', fingerprint: { documents: 1, chunks: 2, latestIndexedAt: 'x', migrationVersion: 'm' }, modes, verdict });
    expect(sha(md)).toBe('7d6fb33ddf5c0c5d09577e105228a6baf087653a71daa6b1c74eaf28f3c467fa');
  });
});

describe('developer questions have their own figures and their own "no worse" judgement', () => {
  const dev = (id, over = {}) => line(id, { source: 'developer', gold_chunk_id: null, gold_chunk_hash: null, ...over });
  // 6 generated and 6 developer questions per feature, Bills and Regulatory; all rank-3 hits.
  const generated = [...Array(6).fill(BILLS), ...Array(6).fill(REG)].map((f, i) => line(`g${String(i).padStart(2, '0')}`, { desk_feature: f }));
  const developer = [...Array(6).fill(BILLS), ...Array(6).fill(REG)].map((f, i) => dev(`d${String(i).padStart(2, '0')}`, { desk_feature: f }));
  const lines = [...generated, ...developer];
  const hits = () => new Map(lines.map((l) => [l.id, at(3)]));
  const ids = (list, feature) => list.filter((l) => l.desk_feature === feature).map((l) => l.id);
  function input() {
    return {
      lines,
      baseline: { broad: hits(), focused: hits(), 'focused-multi': hits() },
      candidate: { broad: hits(), focused: hits(), 'focused-multi': hits(), feature: hits() },
      featureCalls: lines.map((l) => ({ id: l.id, returned: 40, expected: 40 })),
      latency: { broad: { baseline: Array(20).fill(100), candidate: Array(20).fill(100) }, feature: { baseline: [], candidate: Array(20).fill(90) } },
    };
  }
  const lose = (outcomes, idList, after = 25) => { for (const id of idList) outcomes.set(id, at(after)); };

  it('compareRuns counts generated questions by default and developer questions on request', () => {
    const b = hits();
    const c = hits();
    lose(c, ids(developer, BILLS).slice(0, 2));
    expect(compareRuns(lines, b, c).n).toBe(12);
    expect(compareRuns(lines, b, c).overall.lost).toBe(0);
    const d = compareRuns(lines, b, c, { source: 'developer' });
    expect(d.n).toBe(12);
    expect(d.overall.lost).toBe(2);
    expect(d.byFeature[BILLS]).toEqual({ lost: 2, gained: 0, netLoss: 2 });
  });

  it('passes when nothing moved, with no developer key in the result unless developer questions exist', () => {
    const got = judgeNoWorse(input());
    expect(got).toMatchObject({ pass: true, failures: [], lost: [], lostDeveloper: [] });
    const generatedOnly = judgeNoWorse({ ...input(), lines: generated });
    expect(Object.keys(generatedOnly)).toEqual(['pass', 'failures', 'flags', 'lost']);
  });

  it('does not let developer losses count against the generated bars', () => {
    const x = input();
    lose(x.candidate.broad, ids(developer, BILLS).slice(0, 2));
    const got = judgeNoWorse(x);
    expect(got.lost).toEqual([]);
    expect(got.failures.some((f) => /^broad: /.test(f))).toBe(false);
  });

  it('fails on a developer net loss over the limit, naming developer, and lists the lost questions apart', () => {
    const x = input();
    lose(x.candidate.broad, [...ids(developer, BILLS).slice(0, 2), ids(developer, REG)[0]]);
    const got = judgeNoWorse(x);
    expect(got.pass).toBe(false);
    expect(got.failures).toEqual([expect.stringMatching(/^developer broad: overall document hit@10 net loss 3 > 2/)]);
    expect(got.lost).toEqual([]);
    expect(got.lostDeveloper.map((q) => q.id)).toEqual([...ids(developer, BILLS).slice(0, 2), ids(developer, REG)[0]]);
  });

  it('applies the per-feature limits and hard-loss rule to developer questions as to generated ones', () => {
    const x = input();
    x.candidate.broad.set(ids(developer, REG)[0], at(null));
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual([expect.stringMatching(/^developer broad: 1 hard loss/)]);
    const y = input();
    lose(y.candidate.broad, ids(developer, REG).slice(0, 2));
    expect(judgeNoWorse(y).failures).toEqual([]);
  });

  it('judges developer questions in feature mode and in the focused modes', () => {
    const x = input();
    lose(x.candidate.feature, ids(developer, BILLS).slice(0, 1), 25);
    x.candidate.focused.set(ids(developer, REG)[1], at(4));
    const got = judgeNoWorse(x);
    expect(got.failures).toEqual(expect.arrayContaining([
      expect.stringMatching(/^developer feature: .* document hit@10 5 < broad baseline 6/),
      expect.stringMatching(/^developer focused: 1 question\(s\) changed outcome/),
    ]));
    expect(got.failures.some((f) => !f.startsWith('developer '))).toBe(false);
  });

  it('fails when either set fails', () => {
    const x = input();
    lose(x.candidate.broad, ids(generated, BILLS).slice(0, 3));
    const got = judgeNoWorse(x);
    expect(got.pass).toBe(false);
    expect(got.failures).toEqual(expect.arrayContaining([expect.stringMatching(/^broad: Bill Passage Probability Index document hit@10 net loss 3 > 2/)]));
    expect(got.failures.some((f) => f.startsWith('developer '))).toBe(false);
    expect(got.lost).toHaveLength(3);
  });

  it('leaves ambiguous developer questions out of the developer bars', () => {
    const x = { ...input(), lines: lines.map((l) => (l.id === 'd00' ? { ...l, ambiguous: true } : l)) };
    lose(x.candidate.broad, ['d00'], null);
    expect(judgeNoWorse(x).failures).toEqual([]);
  });

  it('reports latency and missing modes once, not once per set', () => {
    const x = input();
    delete x.candidate.feature;
    const got = judgeNoWorse({ ...x, latency: undefined });
    expect(got.failures.filter((f) => /^feature: not run/.test(f))).toHaveLength(1);
    expect(got.failures.filter((f) => /latency: no measurements/.test(f))).toHaveLength(1);
  });

  describe('renderReport', () => {
    const outcomes = new Map(lines.map((l) => [l.id, at(l.source === 'developer' ? 8 : 1)]));
    const md = () => renderReport({
      setVersion: 'questions.v2', commit: 'abc', fingerprint: { documents: 1, chunks: 2, latestIndexedAt: 'x', migrationVersion: 'm' },
      modes: { broad: { lines, outcomes, latencyMs: [1], networkMs: [1], responseBytes: [1] } },
    });

    it('keeps developer questions out of the generated rows', () => {
      const broad = md();
      expect(broad).toMatch(/\| Overall \| 12 \| 0 \| 12\/12 \(100\.0%\) \|/);
      expect(broad).toMatch(new RegExp(`\\| ${BILLS} \\| 6 \\| 0 \\| 6/6 \\(100\\.0%\\)`));
    });

    it('adds developer rows, overall and per feature, in feature order', () => {
      const out = md();
      expect(out).toMatch(/\| Developer: Overall \| 12 \| 0 \| 0\/12 \(0\.0%\) \| 12\/12 \(100\.0%\) \|/);
      expect(out).toMatch(new RegExp(`\\| Developer: ${BILLS} \\| 6 \\| 0 \\|`));
      expect(out).toMatch(new RegExp(`\\| Developer: ${REG.replace(/[()]/g, '\\$&')} \\| 6 \\| 0 \\|`));
      expect(out.indexOf(`Developer: ${BILLS}`)).toBeLessThan(out.indexOf(`Developer: ${REG}`));
    });

    it('adds no developer rows when there are none', () => {
      const generatedOnly = renderReport({
        setVersion: 'questions.v1', commit: 'abc', fingerprint: {},
        modes: { broad: { lines: generated, outcomes, latencyMs: [1], networkMs: [1], responseBytes: [1] } },
      });
      expect(generatedOnly).not.toMatch(/Developer/);
    });

    it('lists the developer lost questions apart in the comparison', () => {
      const verdict = { pass: false, failures: ['developer broad: x'], flags: [], lost: [], lostDeveloper: [{ id: 'd01', desk_feature: BILLS, before: 3, after: 25 }] };
      const out = renderReport({
        setVersion: 'questions.v2', commit: 'abc', fingerprint: {}, verdict,
        modes: { broad: { lines, outcomes, latencyMs: [1], networkMs: [1], responseBytes: [1] } },
      });
      expect(out).toContain('Lost developer questions (broad document hit@10): 1');
      expect(out).toContain(`| d01 | ${BILLS} | 3 | 25 |`);
    });
  });
});
