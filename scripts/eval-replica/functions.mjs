/**
 * The search functions the replica must carry, taken from their migration files (the latest
 * definition of each), and the statements that install them. The replica's search path equals live's
 * when `function-fingerprint.sql`, run on both, returns the same rows.
 *
 * Each migration listed here is installed as a whole file: it holds one function plus its
 * revoke/grant lines and comments, nothing else. If a newer migration redefines, alters or drops
 * one of these functions, assertSearchFunctionsCurrent() fails, so the list cannot go stale unseen.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
export const MIGRATIONS_DIR = resolve(HERE, '../../supabase/migrations');

/**
 * Dependency order: the helper first, then the function that calls it.
 *  - match_documents: all modes (ids, unscoped, feature, tier). Its unscoped branch sets
 *    hnsw.ef_search 200; its feature branch counts the feature's chunks (exact scan up to 15,000)
 *    and otherwise calls the helper.
 *  - match_documents_feature_hnsw: ef_search 400, with exact recovery up to 100,000 chunks and
 *    FEATURE_SEARCH_RECOVERY_LIMIT above.
 */
export const SEARCH_FUNCTIONS = [
  { name: 'match_documents_feature_hnsw', args: 'extensions.vector, integer, text, text', migration: '20261027185840_feature_search_recovery.sql' },
  { name: 'match_documents', args: 'extensions.vector, integer, uuid[], text, text', migration: '20261015130000_unscoped_ef_search.sql' },
];

/**
 * Called by the restrictive RLS policy law_documents_serving, so it runs on every search. Its text is
 * lifted out of its migration (a file with much else in it) rather than copied, so it cannot drift.
 */
export const POLICY_FUNCTION = { name: 'law_document_is_published', args: 'uuid', migration: '20261023184450_law_listing_publication.sql' };

/**
 * The RLS policies every authenticated search runs under. documents_read and document_chunks_read are
 * created by schema.sql; the others by search-path.sql. function-fingerprint.sql's policy query selects
 * these by table (documents, document_chunks, law_*).
 */
export const POLICIES = [
  { name: 'documents_read', table: 'documents', migration: '20260921000003_corpus_and_desk.sql' },
  { name: 'document_chunks_read', table: 'document_chunks', migration: '20260921000003_corpus_and_desk.sql' },
  { name: 'law_documents_serving', table: 'documents', migration: '20261023184450_law_listing_publication.sql' },
  { name: 'law_chunks_serving', table: 'document_chunks', migration: '20261023184450_law_listing_publication.sql' },
  { name: 'law_settings_read', table: 'law_listing_settings', migration: '20261023184450_law_listing_publication.sql' },
  { name: 'law_records_read', table: 'law_records', migration: '20261023184450_law_listing_publication.sql' },
  { name: 'law_links_read', table: 'law_document_links', migration: '20261023184450_law_listing_publication.sql' },
];

/** Names the fingerprint query reports on; keep function-fingerprint.sql in step. */
export const FINGERPRINTED_NAMES = [...SEARCH_FUNCTIONS.map((f) => f.name), POLICY_FUNCTION.name];

const read = (file, dir = MIGRATIONS_DIR) => readFileSync(resolve(dir, file), 'utf8');
const stripLineComments = (sql) => sql.replace(/^\s*--.*$/gm, '');

const touchesPolicy = (name, table) => new RegExp(`\\b(?:create|drop|alter)\\s+policy\\s+(?:if\\s+exists\\s+)?${name}\\s+on\\s+(?:public\\.)?${table}\\b`, 'i');

const touches = (name) => new RegExp(`\\b(?:create(?:\\s+or\\s+replace)?|drop|alter)\\s+function\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${name}\\s*\\(`, 'i');

/**
 * Throws unless each listed migration is the newest file that creates, alters or drops its function or
 * policy. (A policy dropped and recreated under the same name in a newer file is caught the same way.)
 */
export function assertSearchFunctionsCurrent(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const subjects = [
    ...[...SEARCH_FUNCTIONS, POLICY_FUNCTION].map((fn) => ({ ...fn, kind: 'function', re: touches(fn.name) })),
    ...POLICIES.map((p) => ({ ...p, kind: 'policy', re: touchesPolicy(p.name, p.table) })),
  ];
  const bodies = new Map(files.map((f) => [f, stripLineComments(read(f, dir))]));
  for (const fn of subjects) {
    const hits = files.filter((f) => fn.re.test(bodies.get(f)));
    if (!hits.length) throw new Error(`no migration defines ${fn.kind} ${fn.name}`);
    const latest = hits[hits.length - 1];
    if (latest !== fn.migration) {
      throw new Error(`stale search path: ${fn.kind} ${fn.name} is last defined in ${latest}, but scripts/eval-replica expects ${fn.migration}. Update functions.mjs (SEARCH_FUNCTIONS or POLICIES), schema.sql / search-path.sql, and function-fingerprint.sql.`);
    }
  }
}

/** Lift the policy function's create, revoke and grant out of the law publication migration. */
export function policyFunctionSql(dir = MIGRATIONS_DIR) {
  const text = read(POLICY_FUNCTION.migration, dir);
  const m = /create function public\.law_document_is_published[\s\S]*?grant execute on function public\.law_document_is_published\(uuid\) to authenticated,service_role;/.exec(text);
  if (!m) throw new Error(`could not find ${POLICY_FUNCTION.name} in ${POLICY_FUNCTION.migration}`);
  return m[0].replace(/^create function/, 'create or replace function');
}

/** search-path.sql with the policy function's text in place of its marker line. */
export function searchPathSql(dir = MIGRATIONS_DIR) {
  const base = readFileSync(resolve(HERE, 'search-path.sql'), 'utf8');
  const marker = '-- @@LAW_DOCUMENT_IS_PUBLISHED@@';
  if (!base.includes(marker)) throw new Error('search-path.sql lost its @@LAW_DOCUMENT_IS_PUBLISHED@@ marker');
  // A replacer function: the text holds $$, which a replacement string would collapse to $.
  return base.replace(marker, () => policyFunctionSql(dir));
}

/** Drops every overload of each search function, so none of an older signature survives. */
const DROP_OVERLOADS = `
do $drop$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname in (${SEARCH_FUNCTIONS.map((f) => `'${f.name}'`).join(', ')})
  loop execute format('drop function %s', r.sig); end loop;
end $drop$;
`;

/**
 * One transaction: the schema the functions need, then the functions. It either installs
 * everything or leaves the replica as it was.
 */
export function installScript(dir = MIGRATIONS_DIR) {
  assertSearchFunctionsCurrent(dir);
  return [
    'begin;',
    searchPathSql(dir),
    DROP_OVERLOADS,
    ...SEARCH_FUNCTIONS.map((f) => `-- ${f.name}: ${f.migration}\n${read(f.migration, dir)}`),
    'commit;',
  ].join('\n');
}

/** What replica_meta.source_migration records: the migration of each installed function. */
export const sourceMigrationLabel = () => SEARCH_FUNCTIONS.map((f) => `${f.name}@${f.migration}`).join('; ');
