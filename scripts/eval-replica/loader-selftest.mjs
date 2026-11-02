/**
 * End-to-end self-test of the replica loader against a fake PostgREST source and the throwaway
 * database niyantran_replica_copy_test (never the replica, never NTER, no network, no credentials).
 *
 *   node scripts/eval-replica/loader-selftest.mjs
 *
 * It builds the schema and the live search path, loads synthetic documents, law-listing rows and
 * chunks through the loader's own functions, then checks: a load that stops on a bad row names the
 * row's id and keeps what was copied; --resume completes it with no duplicates and fills in a column
 * added after the first load; the restrictive law RLS policies hide an unpublished supplied-text NCLT
 * document from `authenticated` exactly when the listing is active; match_documents works in each
 * mode; and the staleness guard fails when a newer migration redefines a search function.
 * Needs Docker; run outside the Claude Code sandbox. Exit 0 when every check holds.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOADER_TEST_DATABASE, makeCopier } from './copy.mjs';
import { MIGRATIONS_DIR, POLICIES, assertSearchFunctionsCurrent } from './functions.mjs';
import { ReplicaCopyError } from '../../src/lib/replicaCopy.js';
import { CHUNK_COLUMNS, assertMayCreate, createSchema, finish, installFunctions, loadChunks, loadDocuments, loadLawTables } from './loader.mjs';

const copier = makeCopier({ database: LOADER_TEST_DATABASE });
const log = () => {};
const args = { rate: 5, page: 50 };

const uuid = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DIM = 1536;
const vec = (i) => `[${Array.from({ length: DIM }, (_, k) => (k === i % DIM ? 1 : k === (i + 1) % DIM ? 0.5 : 0)).join(',')}]`;

const FEATURE_A = 'Feature A';
const FEATURE_LAW = 'NCLT / NCLAT (Insolvency)';

/** Synthetic corpus: ordinary documents, plus two supplied-text NCLT orders, one of them published. */
function syntheticSource() {
  const documents = [];
  const chunks = [];
  const add = (id, feature, extra = {}) => {
    documents.push({
      id, title: `Document ${id.slice(0, 8)}`, file_name: 'f.pdf', file_url: null, desk_tier: feature === FEATURE_LAW ? 'law' : 'national', desk_feature: feature,
      content_sha256: 'sha', indexed_at: '2026-11-01T00:00:00+00:00', source_key: `key:${id}`, metadata: {}, ...extra,
    });
  };
  for (let d = 0; d < 20; d++) add(uuid('a', d), FEATURE_A);
  const published = uuid('b', 1);
  const unpublished = uuid('b', 2);
  const lawMeta = { origin: 'supplied-text' };
  add(published, FEATURE_LAW, { source_key: 'law:trib:IBBI_NCLT:published', metadata: lawMeta });
  add(unpublished, FEATURE_LAW, { source_key: 'law:trib:IBBI_NCLT:unpublished', metadata: lawMeta });
  documents.sort((x, y) => (x.id < y.id ? -1 : 1));
  let n = 0;
  for (const d of documents) {
    for (let c = 0; c < 15; c++, n++) {
      chunks.push({
        id: uuid('c', n), document_id: d.id, chunk_hash: `h${n}`, chunk_index: c, source_kind: 'document', page_number: c, char_from: 0, char_to: 10,
        content: n === 200 ? 'before\n\\.\nafter, the 2026-11-01 case' : `chunk ${n} of ${d.title}`, token_count: 5, embedding: vec(n), chunker_version: 1,
        metadata: { section: { heading: 'H' } }, created_at: '2026-11-01T00:00:00+00:00', block_ids: n % 2 ? [uuid('d', n)] : null, image_ids: null,
      });
    }
  }
  chunks.sort((x, y) => (x.id < y.id ? -1 : 1));
  const recordId = uuid('e', 1);
  return {
    published, unpublished,
    tables: {
      documents, document_chunks: chunks,
      law_listing_settings: [{ singleton: true, seeded: true, active: true }],
      law_records: [{ id: recordId, visible: true }],
      law_document_links: [{ document_id: published, record_id: recordId }],
    },
  };
}

/** Enough of supabase-js's query builder for loader.mjs: select, order, limit, gt, await. */
function fakeDb(tables) {
  return {
    from(table) {
      let rows = tables[table];
      let limit = Infinity;
      let key = null;
      let head = false;
      const q = {
        select(_cols, opts) { if (opts?.head) head = true; return q; },
        order(k) { key = k; rows = [...rows].sort((x, y) => (x[k] < y[k] ? -1 : 1)); return q; },
        limit(n) { limit = n; return q; },
        gt(k, v) { rows = rows.filter((r) => r[k] > v); return q; },
        then(resolve, reject) {
          const result = head ? { data: null, count: rows.length, error: null } : { data: rows.slice(0, limit).map((r) => ({ ...r })), error: null, key };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
const count = (sql) => Number(copier.psql(sql));
const asUser = (sql) => copier.psql(`set role authenticated; ${sql}`).split('\n').pop();

async function main() {
  console.log(`creating throwaway database ${LOADER_TEST_DATABASE}`);
  copier.dropDatabase();
  copier.createDatabase();
  const tmp = mkdtempSync(join(tmpdir(), 'replica-selftest-'));
  try {
    const src = syntheticSource();
    const total = src.tables.document_chunks.length;
    createSchema(copier);
    installFunctions(copier);
    installFunctions(copier);
    check('installing the search path twice is harmless', count("select count(*) from pg_proc where proname like 'match\\_documents%' and pronamespace = 'public'::regnamespace") === 2);

    // 1. A load that meets a NUL stops, names the row, keeps what came before.
    const bad = src.tables.document_chunks[120];
    const keptContent = bad.content;
    bad.content = 'secret\u0000text';
    let error = null;
    const ctx = (resume) => ({ db: fakeDb(src.tables), copier, args, log, resume });
    try {
      await loadDocuments(ctx(false));
      await loadLawTables(ctx(false));
      await loadChunks(ctx(false));
    } catch (e) { error = e; }
    check('a NUL in a chunk stops the load and names the chunk id, not its content', error !== null && error.message.includes(bad.id) && !error.message.includes('secret'), error?.message);
    const partial = count('select count(*) from public.document_chunks');
    check('the batches before the bad one were kept', partial === 100, `${partial} chunks`);

    // 2. Resume. First make the documents look like a load from before source_key existed.
    bad.content = keptContent;
    copier.psql('update public.documents set source_key = null');
    await loadDocuments(ctx(true));
    await loadLawTables(ctx(true));
    await loadChunks(ctx(true));
    check('resume copies every chunk exactly once', count('select count(*) from public.document_chunks') === total && count('select count(distinct id) from public.document_chunks') === total, `${total} expected`);
    check('resume fills in source_key on documents loaded before', count('select count(*) from public.documents where source_key is null') === 0);
    check('the chunk with an end-of-data line is intact', copier.psql(`select content = 'before' || chr(10) || '\\.' || chr(10) || 'after, the 2026-11-01 case' from public.document_chunks where id = '${src.tables.document_chunks[200].id}'`) === 't');
    check('block_ids arrays arrived', count('select count(*) from public.document_chunks where block_ids is not null') === src.tables.document_chunks.filter((c) => c.block_ids).length);
    const lines = [];
    const meta = await finish({ db: fakeDb(src.tables), copier, project: 'selftest', log: (l) => lines.push(l), mode: 'resumed' });
    check('finish reports the replica counts', meta.replica.document_chunks === total && meta.replica.documents === 22, JSON.stringify(meta.replica));
    check('finish counted every copied table on the source and they match', meta.comparison.match && Object.keys(meta.source).length === 5, JSON.stringify(meta.source));
    const row = JSON.parse(copier.psql('select row_to_json(m) from public.replica_meta m'));
    check('replica_meta records the load mode, both sets of counts and the match', row.load_mode === 'resumed' && row.counts_match === true && row.source_counts.document_chunks === total && row.replica_counts.document_chunks === total && row.doc_count === 22 && row.chunk_count === total, JSON.stringify(row).slice(0, 160));
    check('a resumed load says so in its report, without a warning when counts match', lines.some((l) => /resumed/.test(l)) && !lines.some((l) => /WARNING/.test(l)));
    // A source that gained a chunk and lost a document since the copy: the report warns and the row says so.
    const grown = { ...src.tables, document_chunks: [...src.tables.document_chunks, { id: uuid('f', 1) }], documents: src.tables.documents.slice(1) };
    const lines2 = [];
    const meta2 = await finish({ db: fakeDb(grown), copier, project: 'selftest', log: (l) => lines2.push(l), mode: 'full' });
    const row2 = JSON.parse(copier.psql('select row_to_json(m) from public.replica_meta m'));
    check('differing counts warn and are recorded', !meta2.comparison.match && row2.load_mode === 'full' && row2.counts_match === false && lines2.some((l) => /WARNING.*document_chunks.*short/.test(l)) && lines2.some((l) => /WARNING.*documents.*more rows/.test(l)), lines2.filter((l) => /WARNING/.test(l)).join(' | ').slice(0, 200));
    check('replica_meta holds one row', count('select count(*) from public.replica_meta') === 1);
    // A source whose count request fails: unknown, never a match.
    const brokenDb = { from: (t) => (t === 'law_records' ? { select: async () => ({ data: null, count: null, error: { message: 'boom' } }) } : fakeDb(src.tables).from(t)) };
    const lines3 = [];
    const meta3 = await finish({ db: brokenDb, copier, project: 'selftest', log: (l) => lines3.push(l), mode: 'full' });
    check('a failed count on NTER is a warning, not a match', !meta3.comparison.match && lines3.some((l) => /WARNING.*law_records.*could not be counted/.test(l)));
    await finish({ db: fakeDb(src.tables), copier, project: 'selftest', log, mode: 'resumed' });
    check('replica_meta names the migration of each function', copier.psql('select source_migration from public.replica_meta').includes('match_documents@20261015130000_unscoped_ef_search.sql'));
    check('the halfvec HNSW index exists', count("select count(*) from pg_indexes where indexname = 'document_chunks_embedding_halfvec_hnsw'") === 1);

    // 3. The restrictive law policies, through the role search runs as.
    const lawChunks = (doc) => Number(asUser(`select count(*) from public.document_chunks where document_id = '${doc}'`));
    check('listing active: the published NCLT document is visible, the unpublished one is not', lawChunks(src.published) === 15 && lawChunks(src.unpublished) === 0, `${lawChunks(src.published)} / ${lawChunks(src.unpublished)}`);
    const viaSearch = Number(asUser(`select count(distinct document_id) from public.match_documents('${src.tables.document_chunks[0].embedding}'::extensions.vector, 200, null, null, '${FEATURE_LAW}')`));
    check('match_documents (feature) returns only the published NCLT document', viaSearch === 1, `${viaSearch}`);
    copier.psql('update public.law_listing_settings set active = false');
    check('listing inactive: both are visible', lawChunks(src.published) === 15 && lawChunks(src.unpublished) === 15);
    copier.psql('update public.law_listing_settings set active = true');

    // 4. Each mode of match_documents, as authenticated.
    const q = src.tables.document_chunks[3].embedding;
    const modes = {
      unscoped: `match_documents('${q}'::extensions.vector, 10)`,
      'document ids': `match_documents('${q}'::extensions.vector, 10, array['${src.tables.document_chunks[3].document_id}']::uuid[])`,
      'tier only': `match_documents('${q}'::extensions.vector, 10, null, 'national')`,
      feature: `match_documents('${q}'::extensions.vector, 10, null, null, '${FEATURE_A}')`,
    };
    for (const [mode, call] of Object.entries(modes)) {
      const n = Number(asUser(`select count(*) from public.${call}`));
      check(`match_documents, ${mode}`, n === 10, `${n} rows`);
    }

    // 5. The fingerprint query returns the three functions.
    check('the function fingerprint lists the three search-path functions', count("select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'match\\_documents%' or proname = 'law_document_is_published')") === 3);

    // 5b. The fingerprint file: three statements, run as written.
    const fp = copier.psql(null, { input: readFileSync(new URL('./function-fingerprint.sql', import.meta.url), 'utf8') });
    const policyNames = POLICIES.map((p) => p.name);
    check('the fingerprint lists every search policy', policyNames.every((n) => fp.includes(n)), policyNames.filter((n) => !fp.includes(n)).join(','));
    check('the fingerprint shows the function ACLs', /authenticated=X\/postgres/.test(fp) && /service_role=X\/postgres/.test(fp));
    check('the fingerprint reports RLS enabled on documents and document_chunks', /document_chunks\|t\|f/.test(fp) && /documents\|t\|f/.test(fp));

    // 5c. A chunk whose document is missing (indexed on NTER after the documents were copied).
    let fkError = null;
    try {
      await copier.copyInto('document_chunks', CHUNK_COLUMNS, [
        { ...src.tables.document_chunks[0], id: uuid('f', 2), chunk_hash: 'fk-a' },
        { ...src.tables.document_chunks[0], id: uuid('f', 3), chunk_hash: 'fk-b', document_id: uuid('9', 9) },
      ]);
    } catch (e) { fkError = e; }
    check('a foreign-key failure is traced to the row and says to --resume', fkError instanceof ReplicaCopyError && fkError.rowId === uuid('f', 3) && /--resume/.test(fkError.message), fkError?.message.slice(0, 200));
    check('the row before it was kept', count(`select count(*) from public.document_chunks where id = '${uuid('f', 2)}'`) === 1);
    copier.psql(`delete from public.document_chunks where id = '${uuid('f', 2)}'`);

    // 5d. --fresh.
    check('the replica database check sees a database that exists', copier.databaseExists() === true);
    let refused = null;
    try { assertMayCreate({ resume: false, fresh: false }, true); } catch (e) { refused = e; }
    check('a plain load refuses to replace an existing replica', refused !== null && /--fresh/.test(refused.message));
    let ok1 = true;
    try { assertMayCreate({ resume: false, fresh: true }, true); assertMayCreate({ resume: true, fresh: false }, true); assertMayCreate({ resume: false, fresh: false }, false); } catch { ok1 = false; }
    check('--fresh, --resume, or no replica yet is allowed', ok1);

    // 6. The staleness guard.
    assertSearchFunctionsCurrent();
    cpSync(MIGRATIONS_DIR, tmp, { recursive: true });
    assertSearchFunctionsCurrent(tmp);
    writeFileSync(join(tmp, '20271231000000_later.sql'), 'create or replace function public.match_documents(query_embedding extensions.vector) returns int language sql as $$ select 1 $$;\n');
    let stale = null;
    try { assertSearchFunctionsCurrent(tmp); } catch (e) { stale = e; }
    check('a newer migration that redefines match_documents fails the staleness guard', stale !== null && /20271231000000_later\.sql/.test(stale.message), stale?.message.slice(0, 120));
    writeFileSync(join(tmp, '20271231000000_later.sql'), 'drop policy law_chunks_serving on public.document_chunks;\ncreate policy law_chunks_serving on public.document_chunks as restrictive for select to authenticated using (true);\n');
    let stalePolicy = null;
    try { assertSearchFunctionsCurrent(tmp); } catch (e) { stalePolicy = e; }
    check('a newer migration that recreates a search policy fails the staleness guard', stalePolicy !== null && /policy law_chunks_serving/.test(stalePolicy.message), stalePolicy?.message.slice(0, 120));
    writeFileSync(join(tmp, '20271231000000_later.sql'), '-- drop function public.match_documents(extensions.vector);\n-- create policy law_chunks_serving on public.document_chunks\n');
    let commentOnly = null;
    try { assertSearchFunctionsCurrent(tmp); } catch (e) { commentOnly = e; }
    check('a mention in a comment does not', commentOnly === null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    copier.dropDatabase();
    console.log(`\ndropped ${LOADER_TEST_DATABASE}`);
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  try { copier.dropDatabase(); } catch { /* best effort */ }
  process.exit(1);
});
