/**
 * Retrieval evaluation: scoring, the gold-chunk fingerprint, the "no worse"
 * comparator and the Markdown report (spec docs/specs/2026-09-30-rag-v2-eval.md,
 * plan task T2). Pure functions: the runner (scripts/eval-retrieval.mjs) does
 * every read and passes plain data in.
 *
 * Ranking is the row order `match_documents` returns. Nothing here sorts rows
 * by `similarity`: the unscoped branch ranks by halfvec distance but reports
 * full-precision similarity, so the two can disagree.
 *
 * Outcomes are passed either as an array aligned with `lines` or as a
 * `Map<question id, outcome>`.
 */

export const KS = [5, 10, 40];
export const MRR_CUTOFF = 40;

/** The exact `documents.desk_feature` values, in the order reports list them. */
export const FEATURES = [
  'NCLT / NCLAT (Insolvency)',
  'Bill Passage Probability Index',
  'Regulatory Body Watch (RBI SEBI TRAI CCI)',
  'Parliamentary Question Database',
  'Industry Updates (Ministry Data)',
  'Budget Utilisation & Schemes',
];

/** 1-based rank of the first row satisfying `test`, or null. */
function firstRank(rows, test) {
  const i = rows.findIndex(test);
  return i === -1 ? null : i + 1;
}

/**
 * One question's result in one mode.
 * - docRank: first row whose document is gold.
 * - keyRank: first row whose document is gold or shares the line's non-null
 *   `document_key` (bill-key collisions, open-work P14).
 * - chunkRank: the row whose id is `gold_chunk_id`; null when there is none.
 * - chunkScored: false when the line has no gold chunk (owner questions), so
 *   summaries leave it out of the chunk denominator.
 */
export function outcome(line, rows, keyOf = new Map()) {
  const gold = new Set(line.gold_document_ids);
  const key = line.document_key ?? null;
  const isGold = (row) => gold.has(row.document_id);
  const chunkScored = line.gold_chunk_id != null;
  return {
    docRank: firstRank(rows, isGold),
    keyRank: firstRank(rows, (row) => isGold(row) || (key !== null && keyOf.get(row.document_id) === key)),
    chunkRank: chunkScored ? firstRank(rows, (row) => row.id === line.gold_chunk_id) : null,
    chunkScored,
  };
}

function scoreRanks(ranks, ks) {
  const n = ranks.length;
  const hits = {};
  const rate = {};
  for (const k of ks) {
    hits[k] = ranks.filter((r) => r !== null && r <= k).length;
    rate[k] = n ? hits[k] / n : 0;
  }
  const rr = ranks.reduce((sum, r) => sum + (r !== null && r <= MRR_CUTOFF ? 1 / r : 0), 0);
  return { n, hits, rate, mrr: n ? rr / n : 0 };
}

/** hit@k counts and rates and MRR@40, for document, same-key and chunk. */
export function summarise(outcomes, ks = KS) {
  const list = [...outcomes];
  return {
    n: list.length,
    doc: scoreRanks(list.map((o) => o.docRank), ks),
    key: scoreRanks(list.map((o) => o.keyRank), ks),
    chunk: scoreRanks(list.filter((o) => o.chunkScored !== false).map((o) => o.chunkRank), ks),
  };
}

function outcomeFor(outcomes, line, i) {
  return outcomes instanceof Map ? outcomes.get(line.id) : outcomes[i];
}

/** Pairs each line with its outcome, dropping lines that have none. */
function paired(lines, outcomes) {
  return lines.map((line, i) => ({ line, outcome: outcomeFor(outcomes, line, i) })).filter((p) => p.outcome);
}

function featureOrder(a, b) {
  const ia = FEATURES.indexOf(a);
  const ib = FEATURES.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedFeatures(lines) {
  return [...new Set(lines.map((l) => l.desk_feature))].sort(featureOrder);
}

/**
 * Overall and per-feature summaries. `excludeAmbiguous` drops ambiguous lines,
 * as the "no worse" bars do; `ambiguousExcluded` says how many it dropped.
 */
export function summariseByFeature(lines, outcomes, { excludeAmbiguous = false, ks = KS } = {}) {
  const all = paired(lines, outcomes);
  const kept = excludeAmbiguous ? all.filter((p) => !p.line.ambiguous) : all;
  const features = {};
  for (const feature of sortedFeatures(all.map((p) => p.line))) {
    features[feature] = summarise(kept.filter((p) => p.line.desk_feature === feature).map((p) => p.outcome), ks);
  }
  return {
    overall: summarise(kept.map((p) => p.outcome), ks),
    features,
    ambiguousExcluded: all.length - kept.length,
  };
}

/**
 * Whether every gold chunk still exists as it was when the set was built.
 * `currentChunks` is `Map<chunk_id, { chunk_hash, document_id }>`, read by the
 * runner. Lines without a gold chunk (owner questions) are skipped. The runner
 * aborts on `!ok` and reports no scores: a re-chunk would otherwise score
 * correct answers as misses.
 */
export function fingerprintCheck(lines, currentChunks) {
  const missing = [];
  const changed = [];
  for (const line of lines) {
    if (line.gold_chunk_id == null) continue;
    const current = currentChunks.get(line.gold_chunk_id);
    const where = { id: line.id, gold_chunk_id: line.gold_chunk_id };
    if (!current) {
      missing.push(where);
    } else if (current.chunk_hash !== line.gold_chunk_hash) {
      changed.push({ ...where, expected: line.gold_chunk_hash, actual: current.chunk_hash, reason: 'chunk_hash changed' });
    } else if (!line.gold_document_ids.includes(current.document_id)) {
      changed.push({ ...where, expected: line.gold_document_ids.join(','), actual: current.document_id, reason: 'document_id not gold' });
    }
  }
  return { ok: missing.length === 0 && changed.length === 0, missing, changed };
}

/**
 * The questions a "no worse" bar counts: those of one source (generated, or developer-written)
 * that are not ambiguous. Owner questions are never counted.
 */
function barLines(lines, source = 'generated') {
  return lines.filter((l) => !l.ambiguous && l.source === source);
}

const within = (rank, k) => rank !== null && rank !== undefined && rank <= k;

/**
 * Per-question document hit@k flips between two runs of one mode, on the
 * bar lines only (generated questions, or those of `source`). lost: a hit at ≤ k becomes > k or a miss; gained: the
 * reverse. A hard loss is a top-k hit that falls out of all 40 rows.
 * netLoss = lost − gained, overall and per feature (every feature present
 * is listed, with zeros when nothing moved).
 */
export function compareRuns(lines, baselineOutcomes, candidateOutcomes, { k = 10, source = 'generated' } = {}) {
  const lost = [];
  const gained = [];
  const hardLosses = [];
  const counted = barLines(lines, source);
  const byFeature = {};
  for (const feature of sortedFeatures(counted)) byFeature[feature] = { lost: 0, gained: 0, netLoss: 0 };
  for (const line of counted) {
    const i = lines.indexOf(line);
    const before = outcomeFor(baselineOutcomes, line, i);
    const after = outcomeFor(candidateOutcomes, line, i);
    if (!before || !after) throw new Error(`compareRuns: ${line.id} has no ${before ? 'candidate' : 'baseline'} outcome`);
    const flip = { id: line.id, desk_feature: line.desk_feature, before: before.docRank, after: after.docRank };
    const f = byFeature[line.desk_feature];
    if (within(before.docRank, k) && !within(after.docRank, k)) {
      lost.push(flip);
      f.lost += 1;
      if (!within(after.docRank, MRR_CUTOFF)) hardLosses.push(flip);
    } else if (!within(before.docRank, k) && within(after.docRank, k)) {
      gained.push(flip);
      f.gained += 1;
    }
  }
  for (const f of Object.values(byFeature)) f.netLoss = f.lost - f.gained;
  return {
    k,
    n: counted.length,
    lost,
    gained,
    hardLosses,
    overall: { lost: lost.length, gained: gained.length, netLoss: lost.length - gained.length },
    byFeature,
  };
}

/** The spec's per-feature net-loss allowance for broad document hit@10. */
export const FEATURE_NET_LOSS_LIMIT = {
  'Bill Passage Probability Index': 2,
  'Regulatory Body Watch (RBI SEBI TRAI CCI)': 2,
};
const DEFAULT_FEATURE_LIMIT = 1;
export const OVERALL_NET_LOSS_LIMIT = 2;
export const LATENCY = { factor: 1.2, jitterMs: 20, flagMs: 2000, failMs: 4000 };
const REQUIRED_MODES = ['broad', 'feature', 'focused', 'focused-multi'];

const fmtRank = (r) => (r === undefined ? 'not run' : r === null ? 'miss' : String(r));
const fmtMs = (ms) => String(Math.round(ms * 10) / 10);

/** Outcomes as a Map keyed by question id, whichever form they came in. */
function byId(lines, outcomes) {
  if (!outcomes || outcomes instanceof Map) return outcomes;
  return new Map(lines.map((l, i) => [l.id, outcomes[i]]).filter(([, o]) => o));
}

function hitCount(lines, outcomes, k) {
  return lines.filter((l) => within(outcomes.get(l.id)?.docRank, k)).length;
}

/** Questions whose doc, key or chunk rank differ between two runs. */
function changedOutcomes(lines, before, after) {
  const changed = [];
  for (const line of lines) {
    const b = before.get(line.id);
    const a = after.get(line.id);
    if (!b && !a) continue;
    const parts = ['docRank', 'keyRank', 'chunkRank'].filter((f) => b?.[f] !== a?.[f]);
    if (parts.length) changed.push(`${line.id} (${parts.map((f) => `${f} ${fmtRank(b?.[f])} → ${fmtRank(a?.[f])}`).join(', ')})`);
  }
  return changed;
}

/**
 * The spec's "no worse" bars ("No worse: the bar `retrieval-scope` must
 * meet"), on non-ambiguous questions:
 * 1. broad: overall document hit@10 net loss ≤ 2, and no hard loss.
 * 2. broad, per feature: net loss ≤ 2 for Bills and Regulatory, ≤ 1 otherwise.
 * 3. feature: per feature, document hit@10 ≥ that feature's broad baseline;
 *    every call in `featureCalls` ({ id, returned, expected }) returned
 *    `expected` rows (the runner sets expected = match_count when the feature
 *    holds at least that many chunks, else the feature's chunk count).
 * 4. focused and focused-multi: identical per-question outcomes.
 * 5. latency, per mode in `latency` ({ baseline: ms[], candidate: ms[] }):
 *    candidate p95 ≤ 1.2 × baseline p95 + 20 ms; any call > 4000 ms fails,
 *    > 2000 ms is flagged. A mode with no baseline gets only the absolute bars.
 *
 * Bars 1 to 4 are judged on the generated questions, and again, with the same rules, on the
 * developer-written ones when there are any; their failures begin "developer " and their lost
 * questions are `lostDeveloper`. Owner questions are never counted. The call checks in bar 3 and
 * bar 5 are made once, over every call. The verdict fails when either set fails.
 *
 * `baseline` holds outcomes for broad, focused and focused-multi; `candidate`
 * adds feature. Outcomes are best passed as Maps keyed by question id, since
 * focused-multi skips questions without distractors. A mode in `required`
 * (default: all four) that was not run fails, as does missing latency data.
 */
export function judgeNoWorse({ lines, baseline: rawBaseline = {}, candidate: rawCandidate = {}, featureCalls = [], latency, required = REQUIRED_MODES }) {
  const normalise = (runs) => Object.fromEntries(Object.entries(runs).map(([mode, o]) => [mode, byId(lines, o)]));
  const baseline = normalise(rawBaseline);
  const candidate = normalise(rawCandidate);
  const failures = [];
  const flags = [];
  const ran = (mode) => candidate[mode] && (mode === 'feature' || baseline[mode]);
  for (const mode of required) if (!ran(mode)) failures.push(`${mode}: not run (candidate or baseline outcomes missing)`);

  /** Bars 1 to 4 for the non-ambiguous questions of one source; returns the broad hit@10 losses. */
  function judgeSource(source, { checkCalls }) {
    const prefix = source === 'generated' ? '' : `${source} `;
    const fail = (message) => failures.push(`${prefix}${message}`);
    const counted = barLines(lines, source);
    let lost = [];
    if (ran('broad')) {
      const c = compareRuns(counted, baseline.broad, candidate.broad, { source });
      lost = c.lost;
      if (c.overall.netLoss > OVERALL_NET_LOSS_LIMIT) {
        fail(`broad: overall document hit@10 net loss ${c.overall.netLoss} > ${OVERALL_NET_LOSS_LIMIT} (lost ${c.overall.lost}, gained ${c.overall.gained})`);
      }
      if (c.hardLosses.length) {
        fail(`broad: ${c.hardLosses.length} hard loss(es), top-10 to a miss beyond 40: ${c.hardLosses.map((q) => `${q.id} (rank ${fmtRank(q.before)} → ${fmtRank(q.after)})`).join(', ')}`);
      }
      for (const [feature, f] of Object.entries(c.byFeature)) {
        const limit = FEATURE_NET_LOSS_LIMIT[feature] ?? DEFAULT_FEATURE_LIMIT;
        if (f.netLoss > limit) fail(`broad: ${feature} document hit@10 net loss ${f.netLoss} > ${limit} (lost ${f.lost}, gained ${f.gained})`);
      }
    }

    if (candidate.feature && baseline.broad) {
      for (const feature of sortedFeatures(counted)) {
        const inFeature = counted.filter((l) => l.desk_feature === feature);
        const got = hitCount(inFeature, candidate.feature, 10);
        const floor = hitCount(inFeature, baseline.broad, 10);
        if (got < floor) fail(`feature: ${feature} document hit@10 ${got} < broad baseline ${floor}`);
      }
    }
    if (checkCalls && candidate.feature) {
      const short = featureCalls.filter((c) => c.returned < c.expected);
      if (short.length) {
        fail(`feature: ${short.length} call(s) returned fewer rows than match_count: ${short.map((c) => `${c.id} (${c.returned}/${c.expected})`).join(', ')}`);
      }
    }

    for (const mode of ['focused', 'focused-multi']) {
      if (!ran(mode)) continue;
      const changed = changedOutcomes(counted, baseline[mode], candidate[mode]);
      if (changed.length) fail(`${mode}: ${changed.length} question(s) changed outcome: ${changed.join('; ')}`);
    }
    return lost;
  }

  const lost = judgeSource('generated', { checkCalls: true });
  const hasDeveloper = barLines(lines, 'developer').length > 0;
  const lostDeveloper = hasDeveloper ? judgeSource('developer', { checkCalls: false }) : null;

  if (!latency || !Object.keys(latency).length) {
    failures.push('latency: no measurements');
  } else {
    for (const mode of Object.keys(latency).sort()) {
      const { baseline: before = [], candidate: after = [] } = latency[mode];
      const p95 = percentile(after, 95);
      const p95Before = percentile(before, 95);
      if (p95Before === null) {
        flags.push(`${mode}: no baseline latency; only the 2 s / 4 s bars apply`);
      } else if (p95 !== null) {
        const limit = LATENCY.factor * p95Before + LATENCY.jitterMs;
        if (p95 > limit) failures.push(`${mode}: p95 ${fmtMs(p95)} ms > ${LATENCY.factor} × ${fmtMs(p95Before)} + ${LATENCY.jitterMs} = ${fmtMs(limit)} ms`);
      }
      const over = (ms) => after.filter((v) => v > ms);
      if (over(LATENCY.failMs).length) {
        failures.push(`${mode}: ${over(LATENCY.failMs).length} call(s) over ${LATENCY.failMs} ms (max ${fmtMs(Math.max(...after))} ms)`);
      } else if (over(LATENCY.flagMs).length) {
        flags.push(`${mode}: ${over(LATENCY.flagMs).length} call(s) over ${LATENCY.flagMs} ms (max ${fmtMs(Math.max(...after))} ms)`);
      }
    }
  }

  return { pass: failures.length === 0, failures, flags, lost, ...(lostDeveloper ? { lostDeveloper } : {}) };
}

/**
 * The process exit code for a run's verdict (scripts/eval-retrieval.mjs): 0 when there is no
 * verdict (no --compare) or it passes, 3 when it does not. 1 (error) and 2 (corpus fingerprint
 * check failed) are the script's own. Anything but an explicit `pass: true` fails.
 */
export const EXIT_VERDICT_WORSE = 3;
export function exitCodeFor(verdict) {
  if (verdict === null || verdict === undefined) return 0;
  return verdict.pass === true ? 0 : EXIT_VERDICT_WORSE;
}

/**
 * Nearest-rank percentile: sort ascending and take the value at 1-based rank
 * ceil(p/100 × n). It always returns an observed value (no interpolation), so
 * p95 of 20 values is the 19th smallest. Null for an empty list.
 */
export function percentile(values, p) {
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile p must be in (0, 100], got ${p}`);
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}

/** Report order for modes; any other mode follows, alphabetically. */
export const MODE_ORDER = ['broad', 'focused', 'focused-multi', 'feature'];
const MATCH_COUNT = 40;
const MULTI_DOCS = 5;

function modeOrder(a, b) {
  const ia = MODE_ORDER.indexOf(a);
  const ib = MODE_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a < b ? -1 : a > b ? 1 : 0;
}

const pct = (hits, n) => `${hits}/${n} (${(n ? (100 * hits) / n : 0).toFixed(1)}%)`;

function tableRow(label, s, ambiguous) {
  const cells = [label, s.n, ambiguous];
  for (const part of ['doc', 'key', 'chunk']) for (const k of KS) cells.push(pct(s[part].hits[k], s[part].n));
  cells.push(s.doc.mrr.toFixed(3), s.chunk.mrr.toFixed(3));
  return `| ${cells.join(' | ')} |`;
}

function modeTable(lines, outcomes) {
  const ids = byId(lines, outcomes);
  const generated = lines.filter((l) => l.source === 'generated');
  const developer = lines.filter((l) => l.source === 'developer');
  const owner = lines.filter((l) => l.source === 'owner' && ids.get(l.id));
  const s = summariseByFeature(generated, ids, { excludeAmbiguous: true });
  const ambiguousIn = (feature) => generated.filter((l) => l.ambiguous && ids.get(l.id) && (!feature || l.desk_feature === feature)).length;
  const header = ['Scope', 'n', 'Ambiguous excluded'];
  for (const part of ['Doc', 'Key', 'Chunk']) for (const k of KS) header.push(`${part}@${k}`);
  header.push('Doc MRR@40', 'Chunk MRR@40');
  const rows = [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => ' --- ').join('|')}|`,
    tableRow('Overall', s.overall, s.ambiguousExcluded),
  ];
  for (const [feature, fs] of Object.entries(s.features)) rows.push(tableRow(feature, fs, ambiguousIn(feature)));
  const withAmbiguous = summariseByFeature(generated, ids);
  if (s.ambiguousExcluded) rows.push(tableRow('Overall incl. ambiguous', withAmbiguous.overall, '—'));
  if (developer.some((l) => ids.get(l.id))) {
    const d = summariseByFeature(developer, ids, { excludeAmbiguous: true });
    const developerAmbiguous = (feature) => developer.filter((l) => l.ambiguous && ids.get(l.id) && (!feature || l.desk_feature === feature)).length;
    rows.push(tableRow('Developer: Overall', d.overall, d.ambiguousExcluded));
    for (const [feature, fs] of Object.entries(d.features)) rows.push(tableRow(`Developer: ${feature}`, fs, developerAmbiguous(feature)));
  }
  if (owner.length) rows.push(tableRow('Owner questions', summarise(owner.map((l) => ids.get(l.id))), '—'));
  return rows.join('\n');
}

function latencyLine(mode, m, networkMs) {
  const ms = (values, p) => (values?.length ? `${fmtMs(percentile(values, p))} ms` : 'n/a');
  const bytes = m.responseBytes?.length
    ? `${Math.round(m.responseBytes.reduce((a, b) => a + b, 0) / m.responseBytes.length)} bytes`
    : 'n/a';
  return `- ${mode}: RPC p50 ${ms(m.latencyMs, 50)}, p95 ${ms(m.latencyMs, 95)} (${m.latencyMs?.length ?? 0} calls); ` +
    `network baseline p50 ${ms(networkMs, 50)}, p95 ${ms(networkMs, 95)}; mean response ${bytes}`;
}

/**
 * The Markdown report for one run. `run`:
 * { setVersion, commit, fingerprint: { documents, chunks, latestIndexedAt,
 *   migrationVersion }, cost: { embeddingTokens, usd },
 *   modes: { [mode]: { lines, outcomes, latencyMs, networkMs, responseBytes, skipped } },
 *   networkMs (used when a mode has none), verdict (a judgeNoWorse result, optional) }.
 * Tables exclude ambiguous, owner and developer questions from the generated bar figures and show
 * the owner and developer ones on their own rows (developer rows only when there are developer questions). The output depends only on `run`: no clock reads.
 */
export function renderReport(run) {
  const fp = run.fingerprint ?? {};
  const cost = run.cost ?? {};
  const out = [
    '# Retrieval evaluation',
    '',
    `- Set: ${run.setVersion}`,
    `- Commit: ${run.commit}`,
    `- Migration version: ${fp.migrationVersion}`,
    `- Corpus fingerprint: ${fp.documents} documents, ${fp.chunks} chunks, latest indexed_at ${fp.latestIndexedAt}`,
    `- Cost: $${Number(cost.usd ?? 0).toFixed(4)} (${cost.embeddingTokens ?? 0} embedding tokens)`,
    '',
    'Ranking is the row order returned by match_documents. Bar figures exclude ambiguous and owner questions.',
  ];
  const modes = Object.keys(run.modes ?? {}).sort(modeOrder);
  if (modes.some((mode) => run.modes[mode].lines.some((l) => l.source === 'developer'))) {
    out.push('Developer-written questions are left out of those figures and tabulated, and judged, on their own rows.');
  }
  for (const mode of modes) {
    const m = run.modes[mode];
    out.push('', `## Mode: ${mode}`, '');
    if (mode === 'focused-multi') {
      const perDoc = Math.ceil(MATCH_COUNT / MULTI_DOCS);
      out.push(`Gold plus four distractors: the per-document quota is ceil(${MATCH_COUNT}/${MULTI_DOCS}) = ${perDoc} rows, so chunk hit@k for k > ${perDoc} is capped.`);
      if (m.skipped) out.push(`${m.skipped} question(s) skipped: no distractors.`);
      out.push('');
    }
    out.push(modeTable(m.lines, m.outcomes));
  }
  out.push('', '## Latency', '');
  for (const mode of modes) out.push(latencyLine(mode, run.modes[mode], run.modes[mode].networkMs ?? run.networkMs));

  const v = run.verdict;
  if (v) {
    out.push('', '## Comparison with the baseline', '', `Verdict: **${v.pass ? 'PASS' : 'FAIL'}**`, '');
    out.push('Failures:', ...(v.failures.length ? v.failures.map((f) => `- ${f}`) : ['- none']), '');
    out.push('Flags:', ...(v.flags.length ? v.flags.map((f) => `- ${f}`) : ['- none']), '');
    out.push(`Lost questions (broad document hit@10): ${v.lost.length}`, '');
    if (v.lost.length) {
      out.push('| Question | Feature | Before | After |', '| --- | --- | --- | --- |');
      const lost = [...v.lost].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const q of lost) out.push(`| ${q.id} | ${q.desk_feature} | ${fmtRank(q.before)} | ${fmtRank(q.after)} |`);
    }
    if (v.lostDeveloper) {
      out.push('', `Lost developer questions (broad document hit@10): ${v.lostDeveloper.length}`, '');
      if (v.lostDeveloper.length) {
        out.push('| Question | Feature | Before | After |', '| --- | --- | --- | --- |');
        const lostDeveloper = [...v.lostDeveloper].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const q of lostDeveloper) out.push(`| ${q.id} | ${q.desk_feature} | ${fmtRank(q.before)} | ${fmtRank(q.after)} |`);
      }
    }
  }
  return `${out.join('\n')}\n`;
}
