-- Read-only. What the retrieval search path is made of, so live and the replica can be compared.
-- Run each of the three statements on NTER (read-only queries: nothing is changed) and on
-- niyantran_retrieval_replica, and diff each result set. The search path is equal when no row differs.
-- (Run them one at a time if your SQL client returns only the last statement's result.)
--
-- 1. FUNCTIONS: one row per function on the search path.
--   name, identity_arguments, result : the signature (overloads of the same name are separate rows)
--   prosrc_md5       : md5 of the body exactly as stored, comments and whitespace included
--   prosrc_code_md5  : md5 of the body with -- comments and all whitespace removed. Live's body was
--                      checked on 2026-10-15 to be a migration's "without some of its comments"
--                      (20261015130000_unscoped_ef_search.sql), so a prosrc_md5 difference with an
--                      equal prosrc_code_md5 is comment-only; any difference in prosrc_code_md5 is real.
--   proconfig        : per-function settings (search_path = public, extensions)
--   prosecdef        : true for security definer
--   provolatile      : i immutable, s stable, v volatile
--   proacl           : who may execute it, as stored. Role names in it can differ legitimately between
--                      a hosted project and the local container; compare the grantee list (anon must
--                      not appear for match_documents*; authenticated and service_role must).
-- The set: match_documents and match_documents_feature_hnsw (the search itself), and
-- law_document_is_published (called by the restrictive RLS policy law_documents_serving on every
-- search). The LIKE catches stray overloads and replica-only experiments (match_documents_x ...),
-- which the replica should not carry and live does not have. Keep in step with FINGERPRINTED_NAMES
-- in scripts/eval-replica/functions.mjs.
select p.proname                                   as name,
       pg_get_function_identity_arguments(p.oid)   as identity_arguments,
       pg_get_function_result(p.oid)               as result,
       md5(p.prosrc)                               as prosrc_md5,
       md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')) as prosrc_code_md5,
       p.proconfig                                 as proconfig,
       p.prosecdef                                 as prosecdef,
       p.provolatile                               as provolatile,
       p.proacl::text                              as proacl
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and (p.proname like 'match\_documents%' or p.proname = 'law_document_is_published')
 order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 2. POLICIES: every row-level-security policy on documents, document_chunks and the law_* tables,
-- which every `authenticated` search runs under. qual_md5 / with_check_md5 are md5 of the deparsed
-- expressions; qual is shown in full so a difference can be read.
-- Known, deliberate differences on the replica: the live law_* tables law_source_memberships and
-- law_publications, and the law_*_serving policies on document_pages, document_page_blocks,
-- document_page_images and desk_rows, are not replicated (see search-path.sql); live's law_* tables
-- have more columns. The policies on the tables below must be equal.
select p.tablename, p.policyname, p.permissive, p.roles::text as roles, p.cmd,
       md5(coalesce(p.qual, ''))       as qual_md5,
       md5(coalesce(p.with_check, '')) as with_check_md5,
       p.qual
  from pg_policies p
 where p.schemaname = 'public'
   and (p.tablename in ('documents', 'document_chunks') or p.tablename like 'law\_%')
 order by p.tablename, p.policyname;

-- 3. RLS SWITCHES: whether row-level security is enabled (and forced) on those tables.
select c.relname as tablename, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
   and (c.relname in ('documents', 'document_chunks') or c.relname like 'law\_%')
 order by c.relname;
