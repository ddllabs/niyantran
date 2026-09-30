/**
 * Run the retrieval evaluation (docs/specs/2026-09-30-rag-v2-eval.md; plan task T4).
 *
 *   npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- \
 *     --set eval/retrieval/questions.v1.jsonl [--modes broad,focused,focused-multi] \
 *     [--out eval/retrieval/results] [--compare <baseline.json>] [--required broad] [--limit 5] [--label baseline] \
 *     [--target live|replica] [--rpc match_documents] [--modes …,feature]
 *
 * --target replica runs against the local replica (scripts/eval-replica/load.mjs) through psql in
 * its container, as `authenticated` under RLS and the 8 s timeout; --rpc names a candidate
 * function there. The feature mode passes the question's own desk_feature as p_desk_feature.
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
import { execSync, spawnSync } from 'node:child_process';
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
  const out = { set: null, modes: ['broad', 'focused', 'focused-multi'], out: 'eval/retrieval/results', compare: null, required: null, limit: 0, label: 'run', target: 'live', rpc: 'match_documents' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') out.set = argv[++i];
    else if (a === '--modes') out.modes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--compare') out.compare = argv[++i];
    else if (a === '--required') out.required = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') out.limit = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--label') out.label = argv[++i].replace(/[^a-z0-9-]/gi, '-');
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--rpc') out.rpc = argv[++i];
  }
  if (!out.set) throw new Error('--set is required');
  for (const m of out.modes) if (!['broad', 'focused', 'focused-multi', 'feature'].includes(m)) throw new Error(`unknown mode ${m}`);
  if (!['live', 'replica'].includes(out.target)) throw new Error('--target must be live or replica');
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

/** Live NTER through PostgREST, as service_role. */
function liveBackend(url, secret) {
  const db = createClient(url, secret, { auth: { persistSession: false } });
  return {
    name: 'live',
    async counts() {
      const documents = ok(await db.from('documents').select('id', { count: 'exact', head: true }).not('indexed_at', 'is', null), 'document count').count;
      const chunks = ok(await db.from('document_chunks').select('id', { count: 'exact', head: true }), 'chunk count').count;
      const latest = ok(await db.from('documents').select('indexed_at').not('indexed_at', 'is', null).order('indexed_at', { ascending: false }).limit(1), 'latest indexed_at').data[0]?.indexed_at ?? null;
      return { documents, chunks, latestIndexedAt: latest, migrationVersion: `${repoMatchDocumentsMigration()} (repo)` };
    },
    async goldChunks(ids) {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = ok(await db.from('document_chunks').select('id,chunk_hash,document_id').in('id', ids.slice(i, i + 100)), 'gold chunks');
        for (const r of data) out.set(r.id, { chunk_hash: r.chunk_hash, document_id: r.document_id });
      }
      return out;
    },
    async documents() {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const { data } = ok(await db.from('documents').select('id,desk_feature,document_key:metadata->>document_key').order('id').range(from, from + 999), 'documents');
        out.push(...data);
        if (data.length < 1000) return out;
      }
    },
    async featureChunkCounts() {
      // Indexed, embedded chunks per feature, through an inner join (one head count per feature).
      const features = [...new Set((await this.documents()).map((d) => d.desk_feature).filter(Boolean))];
      const out = new Map();
      for (const f of features) {
        const { count } = ok(await db.from('document_chunks').select('id, documents!inner(desk_feature, indexed_at)', { count: 'exact', head: true })
          .eq('documents.desk_feature', f).not('documents.indexed_at', 'is', null).not('embedding', 'is', null), `chunk count (${f})`);
        out.set(f, count);
      }
      return out;
    },
    async rpc(fn, params) {
      return ok(await db.rpc(fn, params), fn).data;
    },
    async ping() {
      ok(await db.from('documents').select('id').limit(1), 'network baseline');
    },
  };
}

/** The local replica (scripts/eval-replica), through psql in the container, as `authenticated`. */
function replicaBackend() {
  const CONTAINER = 'niyantran-corpus-test-db';
  const DATABASE = 'niyantran_retrieval_replica';
  const psql = (sql) => {
    const res = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-q', '-At'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (res.status !== 0) throw new Error(`replica psql failed: ${res.stderr || res.stdout}`);
    return res.stdout.trim();
  };
  const asUser = (sql) => `set role authenticated;\n${sql}`;
  const json = (sql) => JSON.parse(psql(asUser(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t;`)) || '[]');
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const uuidArray = (ids) => (ids ? `array[${ids.map(lit).join(',')}]::uuid[]` : 'null::uuid[]');
  return {
    name: 'replica',
    async counts() {
      const [meta] = json('select source_migration, copied_at from public.replica_meta');
      const [c] = json(`select (select count(*) from public.documents where indexed_at is not null) as documents,
        (select count(*) from public.document_chunks) as chunks,
        (select max(indexed_at) from public.documents) as latest`);
      return { documents: Number(c.documents), chunks: Number(c.chunks), latestIndexedAt: c.latest, migrationVersion: `${meta?.source_migration} (replica copied ${meta?.copied_at})` };
    },
    async goldChunks(ids) {
      const rows = json(`select id, chunk_hash, document_id from public.document_chunks where id = any(${uuidArray(ids)})`);
      return new Map(rows.map((r) => [r.id, { chunk_hash: r.chunk_hash, document_id: r.document_id }]));
    },
    async documents() {
      return json(`select id, desk_feature, metadata->>'document_key' as document_key from public.documents`);
    },
    async featureChunkCounts() {
      const rows = json(`select d.desk_feature, count(*) as n from public.document_chunks c join public.documents d on d.id = c.document_id
        where d.indexed_at is not null and c.embedding is not null group by 1`);
      return new Map(rows.map((r) => [r.desk_feature, Number(r.n)]));
    },
    async rpc(fn, params) {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`bad function name ${fn}`);
      const args = [
        `${lit(JSON.stringify(params.query_embedding))}::extensions.vector`,
        String(params.match_count),
        uuidArray(params.p_document_ids ?? null),
        params.p_desk_tier ? lit(params.p_desk_tier) : 'null',
      ];
      if ('p_desk_feature' in params) args.push(params.p_desk_feature ? lit(params.p_desk_feature) : 'null');
      return json(`select * from public.${fn}(${args.join(', ')})`);
    },
    async ping() {
      psql(asUser('select 1;'));
    },
  };
}

async function main(argv) {
  loadDotEnv(resolve(ROOT, '.env.local'));
  const args = parseArgs(argv);
  let backend;
  if (args.target === 'replica') backend = replicaBackend();
  else {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY must be set');
    if (!secret.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');
    backend = liveBackend(url, secret);
  }

  const setPath = resolve(ROOT, args.set);
  const { lines: allLines, vectorOf } = loadSet(setPath);
  const lines = args.limit ? allLines.slice(0, args.limit) : allLines;

  // Fingerprint: counts, freshness, and every gold chunk unchanged.
  const fingerprint = { target: backend.name, rpc: args.rpc, ...(await backend.counts()) };
  const goldIds = [...new Set(lines.map((l) => l.gold_chunk_id).filter(Boolean))];
  const check = fingerprintCheck(lines, await backend.goldChunks(goldIds));
  if (!check.ok) {
    console.error('Corpus fingerprint check failed; no scores reported.');
    console.error(JSON.stringify({ missing: check.missing, changed: check.changed }, null, 1));
    process.exit(2);
  }
  console.log('fingerprint', fingerprint);

  // document_key per document, for the same-key variant.
  const docs = await backend.documents();
  const keyOf = new Map(docs.map((d) => [d.id, d.document_key ?? null]));
  const featureChunks = args.modes.includes('feature') ? await backend.featureChunkCounts() : null;

  const paramsFor = (mode, line) => {
    const base = { query_embedding: vectorOf.get(line.id), match_count: MATCH_COUNT };
    if (mode === 'broad') return base;
    if (mode === 'focused') return { ...base, p_document_ids: line.gold_document_ids };
    if (mode === 'focused-multi') return line.distractor_ids.length ? { ...base, p_document_ids: [...line.gold_document_ids, ...line.distractor_ids] } : null;
    if (mode === 'feature') return { ...base, p_document_ids: null, p_desk_tier: null, p_desk_feature: line.desk_feature };
    throw new Error(`unknown mode ${mode}`);
  };
  const timed = async (fn) => {
    const t0 = performance.now();
    const res = await fn();
    return { res, ms: performance.now() - t0 };
  };

  const run = { setVersion: basename(args.set), label: args.label, commit: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(), fingerprint, cost: { embeddingTokens: 0, usd: 0 }, modes: {} };
  const results = { ...run, modes: {} };
  const featureCalls = [];
  for (const mode of args.modes) {
    const active = lines.filter((l) => paramsFor(mode, l));
    for (const l of active.slice(0, WARMUPS)) await backend.rpc(args.rpc, paramsFor(mode, l));
    const outcomes = new Map();
    const ranked = {};
    const latencyMs = [];
    const networkMs = [];
    const responseBytes = [];
    for (const line of shuffled(active, SEED)) {
      const { res: rows, ms } = await timed(() => backend.rpc(args.rpc, paramsFor(mode, line)));
      latencyMs.push(ms);
      responseBytes.push(Buffer.byteLength(JSON.stringify(rows)));
      outcomes.set(line.id, outcome(line, rows, keyOf));
      ranked[line.id] = rows.map((r) => r.id);
      if (mode === 'feature') featureCalls.push({ id: line.id, returned: rows.length, expected: Math.min(MATCH_COUNT, featureChunks?.get(line.desk_feature) ?? MATCH_COUNT) });
      const net = await timed(() => backend.ping());
      networkMs.push(net.ms);
    }
    run.modes[mode] = { lines: active, outcomes, latencyMs, networkMs, responseBytes, skipped: lines.length - active.length };
    results.modes[mode] = { outcomes: Object.fromEntries(outcomes), ranked, latencyMs, networkMs, responseBytes, skipped: lines.length - active.length };
    console.log(`${mode}: ${active.length} questions`);
  }
  if (featureCalls.length) results.featureCalls = featureCalls;

  if (args.compare) {
    const before = JSON.parse(readFileSync(resolve(ROOT, args.compare), 'utf8'));
    const toMap = (o) => new Map(Object.entries(o));
    const baseline = Object.fromEntries(Object.entries(before.modes).map(([m, r]) => [m, toMap(r.outcomes)]));
    const candidate = Object.fromEntries(Object.entries(run.modes).map(([m, r]) => [m, r.outcomes]));
    const latency = Object.fromEntries(Object.entries(run.modes).map(([m, r]) => [m, { baseline: before.modes[m]?.latencyMs, candidate: r.latencyMs }]));
    run.verdict = judgeNoWorse({ lines, baseline, candidate, featureCalls, latency, required: args.required ?? args.modes });
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
