/**
 * Build the frozen retrieval evaluation set (docs/specs/2026-09-30-rag-v2-eval.md,
 * "How the set is built"; plan task T3).
 *
 *   npx vite-node --config vitest.config.js scripts/build-eval-set.mjs -- [--out eval/retrieval/questions.v1.jsonl] [--max-usd 2] [--dry-run]
 *
 * Reads NTER read-only (documents, chunks, match_documents), asks the live default
 * chat model for one question per sampled chunk, has a second-vendor model grade it,
 * marks near-duplicate passages ambiguous, embeds the questions, and writes the set,
 * its vectors and a build log. Progress is cached under eval/retrieval/.cache/ so a
 * rerun resumes without paying twice. Stops once spend passes --max-usd.
 *
 * Environment: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SECRET_KEY (sb_secret_…),
 * OPENROUTER_API_KEY. A .env.local beside package.json is read when present. Nothing
 * is written to the database. Node fetch needs to run outside the Claude Code sandbox.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_TARGETS, leaks, pickDistractors, planSample, validateQuestionLine,
} from '../src/lib/evalSet.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OPENROUTER = 'https://openrouter.ai/api/v1';
const EMBED_MODEL = 'openai/text-embedding-3-small';
const JUDGE_MODEL = 'anthropic/claude-sonnet-5';
const AMBIGUOUS_SIMILARITY = 0.98;

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
  const out = { out: 'eval/retrieval/questions.v1.jsonl', maxUsd: 2, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--max-usd') out.maxUsd = Number(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
  }
  if (!(out.maxUsd > 0)) throw new Error('--max-usd must be a positive number');
  return out;
}

// vite-node drops the script from process.argv; see scripts/load-desk-rows.mjs.
function scriptArgs() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  if (dash !== -1) return argv.slice(dash + 1);
  const i = argv.findIndex((a) => /build-eval-set\.mjs$/.test(a));
  return i === -1 ? argv : argv.slice(i + 1);
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Every row of a select, paged: PostgREST returns at most 1,000 rows a request. */
async function readAll(build, what) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const data = ok(await build().range(from, from + 999), `${what} (from ${from})`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

/** Spend tracking. OpenRouter reports each call's cost when usage accounting is requested. */
function makeBudget(maxUsd) {
  let spent = 0;
  return {
    add(usd) { spent += Number(usd) || 0; },
    get spent() { return spent; },
    check() { if (spent > maxUsd) throw new Error(`spend $${spent.toFixed(4)} passed the cap of $${maxUsd}; stopping`); },
  };
}

async function openrouter(path, body, key, budget) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${OPENROUTER}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, usage: { include: true } }),
    });
    if (res.ok) {
      const json = await res.json();
      budget.add(json.usage?.cost);
      budget.check();
      return json;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    await sleep(1000 * 2 ** attempt);
  }
}

const GENERATE_SYSTEM = [
  'You write evaluation questions for a research search engine over Indian parliamentary, legislative and regulatory documents.',
  'You are given one passage and the title of the document it comes from.',
  'Write ONE question that a policy researcher might ask and that this passage answers specifically.',
  'Paraphrase: never copy four or more consecutive words from the passage.',
  'You may name the Act, Bill, ministry or regulator when a researcher would, but never a file name, an id, "this passage" or "the document".',
  'Reply with the question only, on one line.',
].join(' ');

const JUDGE_SYSTEM = [
  'You grade evaluation questions for a document search engine. You are given the title of a document, one passage from it, and a question.',
  'Decide whether the question is (1) answerable from the passage (details taken from the title, such as the name or year of the Act or Bill, are allowed),',
  '(2) specific to what this passage says rather than generic, and (3) not trivial.',
  'Reply with JSON only: {"pass": true|false, "reason": "<one short sentence>"}.',
].join(' ');
const WORKERS = 6;

async function generateQuestion(model, title, passage, key, budget) {
  const json = await openrouter('/chat/completions', {
    model,
    temperature: 0.3,
    reasoning: { effort: 'low' },
    messages: [
      { role: 'system', content: GENERATE_SYSTEM },
      { role: 'user', content: `Document title: ${title}\n\nPassage:\n${passage}` },
    ],
  }, key, budget);
  return String(json.choices?.[0]?.message?.content ?? '').trim().split('\n')[0].trim();
}

async function judgeQuestion(title, question, passage, key, budget) {
  const json = await openrouter('/chat/completions', {
    model: JUDGE_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: `Document title: ${title}\n\nPassage:\n${passage}\n\nQuestion:\n${question}` },
    ],
  }, key, budget);
  const text = String(json.choices?.[0]?.message?.content ?? '');
  const m = /\{[\s\S]*\}/.exec(text);
  try {
    const v = JSON.parse(m ? m[0] : text);
    return { pass: v.pass === true, reason: String(v.reason ?? '') };
  } catch {
    return { pass: false, reason: `unparseable judge reply: ${text.slice(0, 80)}` };
  }
}

function parseVector(v) {
  const arr = typeof v === 'string' ? JSON.parse(v) : v;
  if (!Array.isArray(arr) || arr.length !== 1536) throw new Error('stored embedding is not 1536 wide');
  return arr.map(Number);
}

async function main(argv) {
  loadDotEnv(resolve(ROOT, '.env.local'));
  const args = parseArgs(argv);
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!url || !secret) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY must be set');
  if (!secret.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');
  if (!orKey && !args.dryRun) throw new Error('OPENROUTER_API_KEY must be set');
  const db = createClient(url, secret, { auth: { persistSession: false } });

  const outPath = resolve(ROOT, args.out);
  const vectorsPath = outPath.replace(/\.jsonl$/, '.vectors.json');
  const logPath = outPath.replace(/\.jsonl$/, '.build-log.json');
  const cachePath = resolve(ROOT, 'eval/retrieval/.cache/build-progress.json');
  if (existsSync(outPath)) throw new Error(`${args.out} exists; a frozen set is never rewritten`);
  mkdirSync(dirname(cachePath), { recursive: true });
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { chunks: {} };
  const saveCache = () => writeFileSync(cachePath, JSON.stringify(cache, null, 1));

  // The generator is the live default chat model.
  const models = ok(await db.from('ai_models').select('model_id').eq('is_default', true).eq('enabled', true), 'ai_models');
  if (models.length !== 1) throw new Error(`expected one default model, found ${models.length}`);
  const generator = models[0].model_id;
  if (generator.split('/')[0] === JUDGE_MODEL.split('/')[0]) throw new Error('the judge must be from a different vendor than the generator');

  const documents = await readAll(
    () => db.from('documents')
      .select('id,title,desk_feature,content_sha256,document_key:metadata->>document_key')
      .not('indexed_at', 'is', null).order('id'),
    'documents',
  );
  const docById = new Map(documents.map((d) => [d.id, d]));
  const chunks = await readAll(
    () => db.from('document_chunks')
      .select('id,document_id,content,chunk_hash,char_from,char_to')
      .not('embedding', 'is', null).order('id'),
    'document_chunks',
  );
  console.log(`read ${documents.length} indexed documents and ${chunks.length} embedded chunks`);

  const featureDocs = {};
  const docsOfFeature = {};
  const chunkById = new Map();
  const byDoc = new Map();
  for (const c of chunks) {
    if (!docById.has(c.document_id)) continue;
    chunkById.set(c.id, c);
    if (!byDoc.has(c.document_id)) byDoc.set(c.document_id, []);
    byDoc.get(c.document_id).push(c);
  }
  for (const [docId, list] of byDoc) {
    const f = docById.get(docId).desk_feature;
    (featureDocs[f] ??= []).push({ document_id: docId, chunks: list });
    (docsOfFeature[f] ??= []).push(docId);
  }
  const plan = planSample(featureDocs, DEFAULT_TARGETS);
  for (const [f, p] of Object.entries(plan)) console.log(`${f}: ${p.picks.length} picks, ${p.reserve.length} in reserve`);
  if (args.dryRun) return;

  const budget = makeBudget(args.maxUsd);
  const log = { generator, judge: JUDGE_MODEL, rejected: [], judged: [], ambiguous: [] };
  const accepted = [];

  /** One candidate through generation, leakage, judging and the ambiguity check. True when accepted. */
  async function processPick(pick) {
    const chunk = chunkById.get(pick.chunk_id);
    const doc = docById.get(pick.document_id);
    const state = (cache.chunks[pick.chunk_id] ??= {});
    if (state.rejected) return false;
    if (!state.question) {
      for (let attempt = 1; attempt <= 2 && !state.question; attempt++) {
        const q = await generateQuestion(generator, doc.title, chunk.content, orKey, budget);
        if (!q || leaks(q, chunk.content, 5, doc.title)) { log.rejected.push({ chunk_id: pick.chunk_id, attempt, reason: q ? 'leaks 5 words' : 'empty' }); continue; }
        state.question = q;
      }
      if (!state.question) { state.rejected = 'generation failed twice'; saveCache(); return false; }
    }
    if (!state.judge) state.judge = await judgeQuestion(doc.title, state.question, chunk.content, orKey, budget);
    log.judged.push({ chunk_id: pick.chunk_id, ...state.judge });
    if (!state.judge.pass) { state.rejected = `judge: ${state.judge.reason}`; saveCache(); return false; }
    if (state.ambiguous === undefined) {
      const row = ok(await db.from('document_chunks').select('embedding').eq('id', pick.chunk_id).single(), 'gold embedding');
      const near = ok(await db.rpc('match_documents', { query_embedding: parseVector(row.embedding), match_count: 5 }), 'ambiguity check');
      state.ambiguous = near.some((r) => r.document_id !== pick.document_id && r.similarity >= AMBIGUOUS_SIMILARITY);
    }
    saveCache();
    return true;
  }

  for (const [feature, { picks, reserve }] of Object.entries(plan)) {
    const queue = [...picks, ...reserve];
    const target = DEFAULT_TARGETS[feature];
    const acceptedAt = [];
    let next = 0;
    // WORKERS candidates in flight; the set keeps the first `target` accepted in queue
    // order, so the result doesn't depend on which call finished first.
    const worker = async () => {
      while (next < queue.length && acceptedAt.length < target) {
        const i = next++;
        if (await processPick(queue[i])) acceptedAt.push(i);
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    // Every index below `next` has been processed, so the lowest `target` accepted indices
    // are exactly the first `target` acceptances in queue order.
    for (const i of acceptedAt.sort((a, b) => a - b).slice(0, target)) {
      const pick = queue[i];
      const state = cache.chunks[pick.chunk_id];
      if (state.ambiguous) log.ambiguous.push(pick.chunk_id);
      accepted.push({ feature, pick, chunk: chunkById.get(pick.chunk_id), doc: docById.get(pick.document_id), question: state.question, ambiguous: state.ambiguous });
    }
    console.log(`${feature}: ${Math.min(acceptedAt.length, target)} accepted of ${next} tried; spent so far $${budget.spent.toFixed(4)}`);
  }

  const createdAt = new Date().toISOString();
  const lines = accepted.map((a, i) => ({
    id: `q-${String(i + 1).padStart(4, '0')}`,
    question: a.question,
    desk_feature: a.feature,
    gold_document_ids: [a.pick.document_id],
    gold_chunk_id: a.chunk.id,
    gold_chunk_hash: a.chunk.chunk_hash,
    gold_content_sha256: a.doc.content_sha256,
    gold_char_from: a.chunk.char_from,
    gold_char_to: a.chunk.char_to,
    document_key: a.doc.document_key ?? null,
    distractor_ids: pickDistractors(a.pick.document_id, docsOfFeature[a.feature]),
    ambiguous: a.ambiguous,
    source: 'generated',
    generator_model: generator,
    created_at: createdAt,
  }));
  for (const line of lines) {
    const v = validateQuestionLine(line);
    if (!v.ok) throw new Error(`${line.id}: ${v.errors.join('; ')}`);
  }

  // Question vectors, embedded once and frozen with the set.
  const vectors = [];
  for (let i = 0; i < lines.length; i += 96) {
    const batch = lines.slice(i, i + 96);
    const json = await openrouter('/embeddings', { model: EMBED_MODEL, input: batch.map((l) => l.question), encoding_format: 'float' }, orKey, budget);
    const served = String(json.model ?? '');
    if (served !== EMBED_MODEL && served !== EMBED_MODEL.split('/')[1]) throw new Error(`embedded by ${served}, expected ${EMBED_MODEL}`);
    for (const d of [...json.data].sort((a, b) => a.index - b.index)) {
      if (d.embedding.length !== 1536) throw new Error('question embedding is not 1536 wide');
      const line = batch[d.index];
      vectors.push({ id: line.id, sha256: sha256(JSON.stringify(d.embedding)), vector: d.embedding });
    }
  }

  writeFileSync(outPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(vectorsPath, JSON.stringify({ model: EMBED_MODEL, dims: 1536, vectors }));
  const counts = {};
  for (const l of lines) counts[l.desk_feature] = (counts[l.desk_feature] ?? 0) + 1;
  writeFileSync(logPath, JSON.stringify({ ...log, created_at: createdAt, counts, spent_usd: budget.spent }, null, 1));
  console.log(`wrote ${lines.length} questions (${log.ambiguous.length} ambiguous); spent $${budget.spent.toFixed(4)}`);
  console.log(counts);
}

main(scriptArgs()).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
