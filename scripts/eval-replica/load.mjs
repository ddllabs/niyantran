/**
 * Build the local retrieval replica (docs/specs/2026-09-30-rag-v2-retrieval-scope.md,
 * "The local replica"; plan task T6).
 *
 *   node scripts/eval-replica/load.mjs [--rate 2] [--page 250]
 *
 * Reads NTER read-only through PostgREST (documents without ocr_text, and every chunk with
 * its embedding), keyset-paged and rate-limited, and streams it into database
 * niyantran_retrieval_replica in the local niyantran-corpus-test-db container. The database
 * is dropped and rebuilt on every run. Then it builds the halfvec HNSW index, loads the live
 * match_documents from its migration file, and records replica_meta for the eval fingerprint.
 *
 * Environment: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SECRET_KEY (sb_secret_…), read
 * from .env.local. Needs Docker; run outside the Claude Code sandbox. Nothing is written to NTER.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const CONTAINER = 'niyantran-corpus-test-db';
const DATABASE = 'niyantran_retrieval_replica';
const MATCH_DOCUMENTS_MIGRATION = '20260929120100_match_documents_halfvec.sql';
const DOC_COLUMNS = ['id', 'title', 'file_name', 'file_url', 'desk_tier', 'desk_feature', 'content_sha256', 'indexed_at', 'metadata'];
const CHUNK_COLUMNS = ['id', 'document_id', 'chunk_hash', 'chunk_index', 'source_kind', 'page_number', 'char_from', 'char_to', 'content', 'token_count', 'embedding', 'chunker_version', 'metadata', 'created_at'];

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
  const out = { rate: 2, page: 250 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rate') out.rate = Number(argv[++i]);
    else if (argv[i] === '--page') out.page = Number(argv[++i]);
  }
  if (!(out.rate > 0 && out.rate <= 5)) throw new Error('--rate must be between 0 and 5 requests per second');
  if (!(out.page >= 50 && out.page <= 1000)) throw new Error('--page must be between 50 and 1000');
  return out;
}

/** psql inside the container. Only ever the replica database, or postgres to (re)create it. */
function psql(database, sql, { input } = {}) {
  if (database !== DATABASE && database !== 'postgres') throw new Error(`refusing to touch database ${database}`);
  const args = ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-At'];
  if (sql) args.push('-c', sql);
  const res = spawnSync('docker', args, { input: input ?? '', encoding: 'utf8', maxBuffer: 1 << 30 });
  if (res.status !== 0) throw new Error(`psql (${database}) failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
const csvRows = (rows, columns) => rows.map((r) => columns.map((c) => csvField(r[c])).join(',')).join('\n') + '\n';

function copyInto(table, columns, rows) {
  if (!rows.length) return;
  psql(DATABASE, `\\copy public.${table} (${columns.join(', ')}) from stdin with (format csv)`, { input: csvRows(rows, columns) });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every row of a table, keyset-paged on id, at most `rate` requests a second. */
async function* pages(db, table, columns, pageSize, rate) {
  let last = null;
  for (;;) {
    const started = Date.now();
    let q = db.from(table).select(columns.join(',')).order('id').limit(pageSize);
    if (last) q = q.gt('id', last);
    const { data, error } = await q;
    if (error) throw new Error(`${table} read after ${last}: ${error.message}`);
    if (!data.length) return;
    yield data;
    last = data[data.length - 1].id;
    if (data.length < pageSize) return;
    await sleep(Math.max(0, 1000 / rate - (Date.now() - started)));
  }
}

function scriptArgs() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  return dash === -1 ? argv : argv.slice(dash + 1);
}

async function main() {
  loadDotEnv(resolve(ROOT, '.env.local'));
  const args = parseArgs(scriptArgs());
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY must be set');
  if (!secret.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');
  const db = createClient(url, secret, { auth: { persistSession: false } });
  const project = new URL(url).hostname.split('.')[0];

  console.log(`(re)creating ${DATABASE} in ${CONTAINER}`);
  psql('postgres', `drop database if exists ${DATABASE}`);
  psql('postgres', `create database ${DATABASE}`);
  psql(DATABASE, null, { input: readFileSync(resolve(ROOT, 'scripts/eval-replica/schema.sql'), 'utf8') });

  const t0 = Date.now();
  let docs = 0;
  for await (const batch of pages(db, 'documents', DOC_COLUMNS, 1000, args.rate)) {
    copyInto('documents', DOC_COLUMNS, batch);
    docs += batch.length;
  }
  console.log(`documents: ${docs}`);
  let chunks = 0;
  for await (const batch of pages(db, 'document_chunks', CHUNK_COLUMNS, args.page, args.rate)) {
    copyInto('document_chunks', CHUNK_COLUMNS, batch);
    chunks += batch.length;
    if (chunks % 5000 < args.page) console.log(`chunks: ${chunks} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  console.log(`chunks: ${chunks}; copied in ${Math.round((Date.now() - t0) / 1000)} s`);

  console.log('building the halfvec HNSW index and analysing');
  psql(DATABASE, null, { input: readFileSync(resolve(ROOT, 'scripts/eval-replica/index.sql'), 'utf8') });
  psql(DATABASE, null, { input: readFileSync(resolve(ROOT, 'supabase/migrations', MATCH_DOCUMENTS_MIGRATION), 'utf8') });
  psql(DATABASE, `insert into public.replica_meta values ('${project}', '${MATCH_DOCUMENTS_MIGRATION}', now(), ${docs}, ${chunks})`);
  const check = psql(DATABASE, null, { input: 'select count(*) from public.documents where indexed_at is not null;\nselect count(*) from public.document_chunks;\n' });
  console.log(`replica ready: ${check.split('\n').join(' indexed documents, ')} chunks; total ${Math.round((Date.now() - t0) / 1000)} s`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
