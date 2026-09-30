/**
 * Run the retrieval evaluation (docs/specs/2026-09-30-rag-v2-eval.md; plan task T4).
 *
 *   npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- \
 *     --set eval/retrieval/questions.v1.jsonl [--modes broad,focused,focused-multi] \
 *     [--out eval/retrieval/results] [--compare <baseline.json>] [--required broad] [--limit 5] [--label baseline]
 *
 * Read-only against live NTER: it checks the corpus fingerprint (and aborts when any gold
 * chunk is missing or changed), then sends every question's frozen vector to
 * match_documents in each mode, as service_role. Calls run after 5 unscored warm-ups in a
 * seeded shuffle; a trivial PostgREST read is timed alongside as the network baseline.
 * Results hold ids and ranks only, never chunk content. `--compare` judges this run against
 * an earlier one with the spec's "no worse" bar.
 *
 * Environment: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SECRET_KEY (sb_secret_…).
 * Node fetch needs to run outside the Claude Code sandbox.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { fingerprintCheck, judgeNoWorse, outcome, renderReport } from '../src/lib/retrievalEval.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const MATCH_COUNT = 40;
const WARMUPS = 5;
const SEED = 20260930;

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(["'])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function parseArgs(argv) {
  const out = { set: null, modes: ['broad', 'focused', 'focused-multi'], out: 'eval/retrieval/results', compare: null, required: null, limit: 0, label: 'run' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') out.set = argv[++i];
    else if (a === '--modes') out.modes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--required') out.required = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--label') out.label = argv[++i].replace(/[^a-z0-9-]/gi, '-');
    else if (a === '--target' && argv[++i] !== 'live') throw new Error('only --target live exists yet; the replica target comes with retrieval-scope');
  }
  if (!out.set) throw new Error('--set is required');
  for (const m of out.modes) if (!['broad', 'focused', 'focused-multi'].includes(m)) throw new Error(`mode ${m} is not available yet`);
  return out;
}

function scriptArgs() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  if (dash !== -1) return argv.slice(dash + 1);
  const i = argv.findIndex((a) => /eval-retrieval\.mjs$/.test(a));
  return i === -1 ? argv : argv.slice(i + 1);
}

function ok(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
}

/** A small seeded PRNG (mulberry32), so the call order is the same on every run. */
function shuffled(items, seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function loadSet(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const vectorsPath = path.replace(/\.jsonl$/, '.vectors.json');
  const { vectors } = JSON.parse(readFileSync(vectorsPath, 'utf8'));
  const byId = new Map();
  for (const v of vectors) {
    const actual = createHash('sha256').update(JSON.stringify(v.vector), 'utf8').digest('hex');
    if (actual !== v.sha256) throw new Error(`${v.id}: stored vector does not match its hash`);
    byId.set(v.id, v.vector);
  }
  for (const l of lines) if (!byId.has(l.id)) throw new Error(`${l.id}: no stored vector`);
  return { lines, vectorOf: byId };
}

/** The newest migration file in the repo that defines match_documents (not read from the live history). */
function repoMatchDocumentsMigration() {
  const dir = resolve(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const defining = files.filter((f) => /create\s+(or\s+replace\s+)?function\s+(public\.)?match_documents/i.test(readFileSync(resolve(dir, f), 'utf8')));
  return defining.at(-1) ?? null;
}

async function main(argv) {
  loadDotEnv(resolve(ROOT, '.env.local'));
  const args = parseArgs(argv);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY must be set');
  if (!secret.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');
  const db = createClient(url, secret, { auth: { persistSession: false } });

  const setPath = resolve(ROOT, args.set);
  const { lines: allLines, vectorOf } = loadSet(setPath);
  const lines = args.limit ? allLines.slice(0, args.limit) : allLines;

  // Fingerprint: counts, freshness, and every gold chunk unchanged.
  const docCount = ok(await db.from('documents').select('id', { count: 'exact', head: true }).not('indexed_at', 'is', null), 'document count').count;
  const chunkCount = ok(await db.from('document_chunks').select('id', { count: 'exact', head: true }), 'chunk count').count;
  const latest = ok(await db.from('documents').select('indexed_at').not('indexed_at', 'is', null).order('indexed_at', { ascending: false }).limit(1), 'latest indexed_at').data[0]?.indexed_at ?? null;
  const goldIds = [...new Set(lines.map((l) => l.gold_chunk_id).filter(Boolean))];
  const current = new Map();
  for (let i = 0; i < goldIds.length; i += 100) {
    const { data } = ok(await db.from('document_chunks').select('id,chunk_hash,document_id').in('id', goldIds.slice(i, i + 100)), 'gold chunks');
    for (const r of data) current.set(r.id, { chunk_hash: r.chunk_hash, document_id: r.document_id });
  }
  const check = fingerprintCheck(lines, current);
  if (!check.ok) {
    console.error('Corpus fingerprint check failed; no scores reported.');
    console.error(JSON.stringify({ missing: check.missing, changed: check.changed }, null, 1));
    process.exit(2);
  }
  const fingerprint = { documents: docCount, chunks: chunkCount, latestIndexedAt: latest, migrationVersion: `${repoMatchDocumentsMigration()} (repo)` };
  console.log('fingerprint', fingerprint);

  // document_key per document, for the same-key variant.
  const keyOf = new Map();
  for (let from = 0; ; from += 1000) {
    const { data } = ok(await db.from('documents').select('id,document_key:metadata->>document_key').order('id').range(from, from + 999), 'document keys');
    for (const r of data) keyOf.set(r.id, r.document_key ?? null);
    if (data.length < 1000) break;
  }

  const paramsFor = (mode, line) => {
    const base = { query_embedding: vectorOf.get(line.id), match_count: MATCH_COUNT };
    if (mode === 'broad') return base;
    if (mode === 'focused') return { ...base, p_document_ids: line.gold_document_ids };
    if (mode === 'focused-multi') return line.distractor_ids.length ? { ...base, p_document_ids: [...line.gold_document_ids, ...line.distractor_ids] } : null;
    throw new Error(`unknown mode ${mode}`);
  };
  const timed = async (fn) => {
    const t0 = performance.now();
    const res = await fn();
    return { res, ms: performance.now() - t0 };
  };

  const run = { setVersion: basename(args.set), label: args.label, commit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(), fingerprint, cost: { embeddingTokens: 0, usd: 0 }, modes: {} };
  const results = { ...run, modes: {} };
  for (const mode of args.modes) {
    const active = lines.filter((l) => paramsFor(mode, l));
    for (const l of active.slice(0, WARMUPS)) ok(await db.rpc('match_documents', paramsFor(mode, l)), `${mode} warm-up`);
    const outcomes = new Map();
    const ranked = {};
    const latencyMs = [];
    const networkMs = [];
    const responseBytes = [];
    for (const line of shuffled(active, SEED)) {
      const { res, ms } = await timed(() => db.rpc('match_documents', paramsFor(mode, line)));
      ok(res, `${mode} ${line.id}`);
      latencyMs.push(ms);
      responseBytes.push(Buffer.byteLength(JSON.stringify(res.data)));
      outcomes.set(line.id, outcome(line, res.data, keyOf));
      ranked[line.id] = res.data.map((r) => r.id);
      const net = await timed(() => db.from('documents').select('id').limit(1));
      ok(net.res, 'network baseline');
      networkMs.push(net.ms);
    }
    run.modes[mode] = { lines: active, outcomes, latencyMs, networkMs, responseBytes, skipped: lines.length - active.length };
    results.modes[mode] = { outcomes: Object.fromEntries(outcomes), ranked, latencyMs, networkMs, responseBytes, skipped: lines.length - active.length };
    console.log(`${mode}: ${active.length} questions`);
  }

  if (args.compare) {
    const before = JSON.parse(readFileSync(resolve(ROOT, args.compare), 'utf8'));
    const toMap = (o) => new Map(Object.entries(o));
    const baseline = Object.fromEntries(Object.entries(before.modes).map(([m, r]) => [m, toMap(r.outcomes)]));
    const candidate = Object.fromEntries(Object.entries(run.modes).map(([m, r]) => [m, r.outcomes]));
    const latency = Object.fromEntries(Object.entries(run.modes).map(([m, r]) => [m, { baseline: before.modes[m]?.latencyMs, candidate: r.latencyMs }]));
    run.verdict = judgeNoWorse({ lines, baseline, candidate, latency, required: args.required ?? args.modes });
    results.verdict = run.verdict;
    results.comparedWith = args.compare;
  }

  const outDir = resolve(ROOT, args.out);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = resolve(outDir, `${stamp}-${args.label}.json`);
  writeFileSync(jsonPath, JSON.stringify({ ...results, ranAt: new Date().toISOString() }, null, 1));
  const md = renderReport(run);
  writeFileSync(jsonPath.replace(/\.json$/, '.md'), md);
  console.log(`wrote ${jsonPath} and its .md`);
  if (run.verdict) console.log(run.verdict.pass ? 'VERDICT: no worse' : `VERDICT: worse\n${run.verdict.failures.join('\n')}`);
}

main(scriptArgs()).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
