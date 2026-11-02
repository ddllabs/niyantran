/**
 * The steps of the replica load (docs/specs/2026-09-30-rag-v2-retrieval-scope.md, "The local
 * replica"; plan task T6), separated from load.mjs's credentials and command line so
 * loader-selftest.mjs can run them against a fake source and a throwaway database.
 *
 * Every function takes a `copier` (copy.mjs), which is bound to one database, and a PostgREST-shaped
 * `db` (supabase-js, or the selftest's fake). Nothing here reads credentials or the environment.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCounts, countReportLines } from '../../src/lib/replicaCopy.js';
import { installScript, sourceMigrationLabel } from './functions.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const sqlFile = (name) => readFileSync(resolve(HERE, name), 'utf8');

/** { name, kind } per column; see src/lib/replicaCopy.js for the kinds. */
export const DOC_COLUMNS = [
  'id', 'title', 'file_name', 'file_url', 'desk_tier', 'desk_feature', 'content_sha256', 'indexed_at', 'source_key',
  { name: 'metadata', kind: 'json' },
];
export const CHUNK_COLUMNS = [
  'id', 'document_id', 'chunk_hash', 'chunk_index', 'source_kind', 'page_number', 'char_from', 'char_to', 'content', 'token_count',
  { name: 'embedding', kind: 'vector' },
  'chunker_version',
  { name: 'metadata', kind: 'json' },
  'created_at',
  { name: 'block_ids', kind: 'array' },
  { name: 'image_ids', kind: 'array' },
];
// The three small tables the restrictive RLS policies read (search-path.sql).
export const LAW_RECORD_COLUMNS = ['id', 'visible'];
export const LAW_LINK_COLUMNS = ['document_id', 'record_id'];
export const LAW_SETTINGS_COLUMNS = ['singleton', 'seeded', 'active'];

const names = (columns) => columns.map((c) => (typeof c === 'string' ? c : c.name));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rows of a table, keyset-paged on `key` after `after`, at most `rate` requests a second. */
export async function* pages(db, table, columns, pageSize, rate, { key = 'id', after = null } = {}) {
  let last = after;
  for (;;) {
    const started = Date.now();
    let q = db.from(table).select(names(columns).join(',')).order(key).limit(pageSize);
    if (last) q = q.gt(key, last);
    const { data, error } = await q;
    if (error) throw new Error(`${table} read after ${last}: ${error.message}`);
    if (!data.length) return;
    yield data;
    last = data[data.length - 1][key];
    if (data.length < pageSize) return;
    await sleep(Math.max(0, 1000 / rate - (Date.now() - started)));
  }
}

/** The base tables, roles and RLS (schema.sql). Not idempotent: for a database just created. */
export function createSchema(copier) {
  copier.psql(null, { input: sqlFile('schema.sql') });
}

/**
 * The live search path, in one transaction: the columns, tables, RLS policies and policy function it
 * needs (search-path.sql), then the latest match_documents and its helper from their migrations.
 * Idempotent, so it serves a fresh load, a resume and --functions-only alike.
 */
export function installFunctions(copier) {
  copier.psql(null, { input: installScript() });
}

/** A load that is neither a resume nor explicitly fresh must not replace a database that exists. */
export function assertMayCreate({ resume, fresh }, replicaExists) {
  if (!resume && !fresh && replicaExists) {
    throw new Error('niyantran_retrieval_replica already exists. Pass --fresh to drop and rebuild it, or --resume to continue a load that stopped.');
  }
}

/** The replica's database exists and holds the base tables (a precondition of --resume and --functions-only). */
export function assertReplicaExists(copier) {
  let present;
  try {
    present = copier.psql("select to_regclass('public.documents') is not null and to_regclass('public.document_chunks') is not null");
  } catch (e) {
    throw new Error(`the replica database is not there to continue: ${String(e.message).split('\n')[0]}`);
  }
  if (present !== 't') throw new Error('the replica database has no documents or document_chunks table; run a full load');
}

/**
 * Documents. A fresh load copies straight in. A resume upserts the whole table through a staging
 * table, so rows copied before a column existed (source_key) are filled in and new documents are
 * added; documents are about one request per thousand rows.
 */
export async function loadDocuments({ db, copier, args, log, resume }) {
  let docs = 0;
  if (resume) copier.psql('drop table if exists public.documents_stage; create table public.documents_stage (like public.documents including defaults)');
  const assignments = names(DOC_COLUMNS).filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
  for await (const batch of pages(db, 'documents', DOC_COLUMNS, 1000, args.rate)) {
    if (resume) {
      copier.psql('truncate public.documents_stage');
      await copier.copyInto('documents_stage', DOC_COLUMNS, batch);
      copier.psql(`insert into public.documents (${names(DOC_COLUMNS).join(', ')}) select ${names(DOC_COLUMNS).join(', ')} from public.documents_stage on conflict (id) do update set ${assignments}`);
    } else {
      await copier.copyInto('documents', DOC_COLUMNS, batch);
    }
    docs += batch.length;
  }
  if (resume) copier.psql('drop table public.documents_stage');
  log(`documents: ${docs}`);
  return docs;
}

/** Chunks, in id order. With `resume`, from the largest id already in the replica. */
export async function loadChunks({ db, copier, args, log, resume, t0 = Date.now() }) {
  let after = null;
  if (resume) {
    after = copier.psql('select id::text from public.document_chunks order by id desc limit 1') || null;
    log(`resuming chunks after id ${after ?? '(none: the table is empty)'}`);
  }
  let chunks = 0;
  for await (const batch of pages(db, 'document_chunks', CHUNK_COLUMNS, args.page, args.rate, { after })) {
    await copier.copyInto('document_chunks', CHUNK_COLUMNS, batch);
    chunks += batch.length;
    if (chunks % 5000 < args.page) log(`chunks: ${chunks} this run (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  log(`chunks: ${chunks} copied this run`);
  return chunks;
}

/** The listing switch and the two small tables the RLS policies read; replaced whole every run. */
export async function loadLawTables({ db, copier, args, log }) {
  copier.psql('truncate public.law_document_links, public.law_records, public.law_listing_settings');
  const { data, error } = await db.from('law_listing_settings').select(LAW_SETTINGS_COLUMNS.join(','));
  if (error) throw new Error(`law_listing_settings read: ${error.message}`);
  if (data.length !== 1) throw new Error(`law_listing_settings should hold one row, found ${data.length}`);
  await copier.copyInto('law_listing_settings', LAW_SETTINGS_COLUMNS, data, { idColumn: 'singleton' });
  let records = 0;
  for await (const batch of pages(db, 'law_records', LAW_RECORD_COLUMNS, 1000, args.rate)) {
    await copier.copyInto('law_records', LAW_RECORD_COLUMNS, batch);
    records += batch.length;
  }
  let links = 0;
  for await (const batch of pages(db, 'law_document_links', LAW_LINK_COLUMNS, 1000, args.rate, { key: 'document_id' })) {
    await copier.copyInto('law_document_links', LAW_LINK_COLUMNS, batch, { idColumn: 'document_id' });
    links += batch.length;
  }
  log(`law listing: active=${data[0].active}, ${records} records, ${links} document links`);
}

/** Every table the loader copies, with a column to count on (PostgREST needs one). */
export const COUNTED_TABLES = {
  documents: 'id',
  document_chunks: 'id',
  law_records: 'id',
  law_document_links: 'document_id',
  law_listing_settings: 'singleton',
};

/** One exact-count request per copied table on NTER (read-only). A failed request gives null and a log line. */
export async function countSource(db, log) {
  const out = {};
  for (const [table, key] of Object.entries(COUNTED_TABLES)) {
    const { count, error } = await db.from(table).select(key, { count: 'exact', head: true });
    if (error || typeof count !== 'number') {
      log(`WARNING: could not count ${table} on NTER: ${error?.message ?? 'no count returned'}`);
      out[table] = null;
    } else {
      out[table] = count;
    }
  }
  return out;
}

export function countReplica(copier) {
  return Object.fromEntries(Object.keys(COUNTED_TABLES).map((t) => [t, Number(copier.psql(`select count(*) from public.${t}`))]));
}

/**
 * The index, the planner statistics and replica_meta. `mode` is 'full' or 'resumed' and is recorded,
 * with NTER's counts and the replica's, so a resumed or short replica never looks like a complete one.
 * Returns the comparison; a difference is a warning in the log, not an error.
 */
export async function finish({ db, copier, project, log, mode }) {
  if (mode !== 'full' && mode !== 'resumed') throw new Error(`load mode must be full or resumed, not ${mode}`);
  log('building the halfvec HNSW index and analysing');
  copier.psql(null, { input: sqlFile('index.sql') });
  const indexed = Number(copier.psql('select count(*) from public.documents where indexed_at is not null'));
  const replica = countReplica(copier);
  const source = await countSource(db, log);
  const comparison = compareCounts(source, replica);
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  copier.psql('delete from public.replica_meta');
  copier.psql(`insert into public.replica_meta (source_project, source_migration, copied_at, doc_count, chunk_count, load_mode, source_counts, replica_counts, counts_match)
    values (${lit(project)}, ${lit(sourceMigrationLabel())}, now(), ${replica.documents}, ${replica.document_chunks}, ${lit(mode)}, ${lit(JSON.stringify(source))}::jsonb, ${lit(JSON.stringify(replica))}::jsonb, ${comparison.match})`);
  log(`replica ready: ${indexed} indexed documents of ${replica.documents}, ${replica.document_chunks} chunks (${mode} load)`);
  log('row counts, NTER against the replica:');
  for (const line of countReportLines(comparison, { mode })) log(line);
  return { indexed, comparison, replica, source };
}
