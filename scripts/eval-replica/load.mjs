/**
 * Build the local retrieval replica (docs/specs/2026-09-30-rag-v2-retrieval-scope.md,
 * "The local replica"; plan task T6).
 *
 *   node scripts/eval-replica/load.mjs [--fresh] [--rate 2] [--page 250]
 *                                                                  full load: drops and rebuilds
 *                                                                  (--fresh is required if the replica exists)
 *   node scripts/eval-replica/load.mjs --resume [--rate 2] ...     continue a load that stopped
 *   node scripts/eval-replica/load.mjs --functions-only            reinstall the search functions
 *
 * Reads NTER read-only through PostgREST (documents without ocr_text, every chunk with its
 * embedding, and the three small law-listing tables the RLS policies read), keyset-paged and
 * rate-limited, and streams it into database niyantran_retrieval_replica in the local
 * niyantran-corpus-test-db container as COPY text (src/lib/replicaCopy.js). Then it builds the halfvec
 * HNSW index, installs the live search functions from their migration files (functions.mjs), and
 * records replica_meta for the eval fingerprint.
 *
 * A full load drops and rebuilds the database, so it needs --fresh when the replica already exists.
 * At the end, it counts each copied table on NTER (one read-only request per table) and records the
 * load mode and both sets of counts in replica_meta, warning if they differ. If a load fails, the error names the failing row's id
 * (never its content); fix the cause and run with --resume, which keeps what was copied, upserts
 * documents (so newly added columns are filled in), and continues chunks after the largest id
 * copied. A resume assumes the source's already-copied range did not change; chunks added to NTER
 * meanwhile with a smaller id than the largest copied are missed, so run a full load when the
 * snapshot must be exact.
 *
 * --functions-only needs no credentials and no network: it re-applies search-path.sql and the
 * latest match_documents and match_documents_feature_hnsw to the existing replica, leaving data alone.
 * Compare the result with live by running function-fingerprint.sql on both.
 *
 * Environment (load and resume only): SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SECRET_KEY
 * (sb_secret_…), read from .env.local. Needs Docker; run outside the Claude Code sandbox.
 * Nothing is written to NTER.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { REPLICA_DATABASE, makeCopier } from './copy.mjs';
import { assertMayCreate, assertReplicaExists, createSchema, finish, installFunctions, loadChunks, loadDocuments, loadLawTables } from './loader.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

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
  const out = { rate: 2, page: 250, resume: false, functionsOnly: false, fresh: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rate') out.rate = Number(argv[++i]);
    else if (argv[i] === '--page') out.page = Number(argv[++i]);
    else if (argv[i] === '--resume') out.resume = true;
    else if (argv[i] === '--functions-only') out.functionsOnly = true;
    else if (argv[i] === '--fresh') out.fresh = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (out.resume && out.functionsOnly) throw new Error('--resume and --functions-only cannot be combined');
  if (out.fresh && (out.resume || out.functionsOnly)) throw new Error('--fresh drops the replica; it cannot be combined with --resume or --functions-only');
  if (!(out.rate > 0 && out.rate <= 5)) throw new Error('--rate must be between 0 and 5 requests per second');
  if (!(out.page >= 50 && out.page <= 1000)) throw new Error('--page must be between 50 and 1000');
  return out;
}

function scriptArgs() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  return dash === -1 ? argv : argv.slice(dash + 1);
}

const log = (line) => console.log(line);

async function main() {
  const args = parseArgs(scriptArgs());
  const copier = makeCopier({ database: REPLICA_DATABASE });

  if (args.functionsOnly) {
    // Deliberately before any .env read: this mode touches only the local container.
    assertReplicaExists(copier);
    installFunctions(copier);
    log(`search functions installed in ${REPLICA_DATABASE}; compare with live using scripts/eval-replica/function-fingerprint.sql`);
    return;
  }

  assertMayCreate(args, copier.databaseExists());

  loadDotEnv(resolve(ROOT, '.env.local'));
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY must be set');
  if (!secret.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');
  const db = createClient(url, secret, { auth: { persistSession: false } });
  const project = new URL(url).hostname.split('.')[0];

  if (args.resume) {
    log(`resuming the load into ${REPLICA_DATABASE}`);
    assertReplicaExists(copier);
  } else {
    log(`(re)creating ${REPLICA_DATABASE}`);
    copier.dropDatabase();
    copier.createDatabase();
    createSchema(copier);
  }
  installFunctions(copier);

  const t0 = Date.now();
  const ctx = { db, copier, args, log, resume: args.resume, t0 };
  try {
    await loadDocuments(ctx);
    await loadLawTables(ctx);
    await loadChunks(ctx);
  } catch (e) {
    console.error(`${e.message ?? e}\nWhat was copied is kept: fix the cause, then run again with --resume.`);
    process.exit(1);
  }
  await finish({ db, copier, project, log, mode: args.resume ? 'resumed' : 'full' });
  log(`total ${Math.round((Date.now() - t0) / 1000)} s`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
