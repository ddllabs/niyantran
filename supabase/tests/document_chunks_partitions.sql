-- Disposable local fixture (F278 step 3, plan docs/plans/2026-11-01-chunk-partitions.md task B1).
-- Chain: pq_admission_links + admin_corpus_readiness + unscoped_ef_search + feature_search_recovery
-- + 20261101120000_document_chunks_partitioned, the migrations applied as a non-superuser.
--
--   Part 1  the migrated schema: partitions, columns, keys, indexes, triggers, policies, grants and
--           the properties of every function that reads chunks.
--   Part 2  chunks written after the swap, then the header's rollback (copies them back); an
--           unpartitioned corpus seeded into the restored table, then the migration applied again
--           over it (run.sh expands the \i line), and the copy compared row by row and by digest.
--           Parts 1 and 2 are committed there, because the migration is its own transaction;
--           part 3 rolls back. The database is disposable either way.
--   Part 3  routing, facets, date parsing, the sync trigger, uniqueness, chunk_commit, RLS and
--           privileges, match_documents in every mode against the same query on the unpartitioned
--           copy (an exact oracle; the approximate passes are made deterministic as in F280: the
--           fixture repeats the pass and rebuilds the index until it equals the oracle), the
--           iterative scan, the recovery safety net, and the four functions not recreated.
--
-- Vacuity: run.sh rebuilds the chain without the migration and this file must fail. It fails in
-- part 1 (document_chunks is not partitioned), before the \i in part 2 could apply the migration
-- itself; keep part 1's assertions first.
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
set local jit = off;

create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- q must fail with SQLSTATE state (and, when given, a message containing pattern).
create function pg_temp.fails(q text, state text, label text, pattern text default null) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate <> state or (pattern is not null and position(pattern in sqlerrm) = 0) then
      raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', label, state, sqlstate, sqlerrm;
    end if;
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL: % (accepted: %)', label, q;
end $$;
-- A unit vector on axis, offset by r in the next two axes so its cosine distance to the axis is d.
-- k turns the offset (golden angle), so neighbours are spread around the axis.
create function pg_temp.cone(axis int, d float8, k int) returns vector language sql immutable as $$
  select (array_fill(0::real, array[axis - 1])
          || array[1::real, (r * cos(k * 2.39996323))::real, (r * sin(k * 2.39996323))::real]
          || array_fill(0::real, array[1536 - axis - 2]))::vector(1536)
    from (select sqrt(1 / (1 - d) ^ 2 - 1) as r) x
$$;
create function pg_temp.e(axis int) returns vector language sql immutable as $$ select pg_temp.cone(axis, 0, 0) $$;
-- The migration's digest: row count and two 64-bit sums of each row's md5 over every old column,
-- the vector byte for byte.
create function pg_temp.digest(t regclass) returns text language plpgsql as $$
declare r record;
begin
  execute format($q$
    select count(*) as n, coalesce(sum(('x' || substr(h, 1, 16))::bit(64)::bigint), 0) as a,
           coalesce(sum(('x' || substr(h, 17, 16))::bit(64)::bigint), 0) as b
      from (select md5(row(c.id, c.document_id, c.chunk_hash, c.chunk_index, c.source_kind, c.page_number,
                           c.char_from, c.char_to, c.content, c.token_count, c.chunker_version, c.metadata,
                           c.created_at, c.block_ids, c.image_ids, c.embed_hash)::text
                       || coalesce(md5(extensions.vector_send(c.embedding)), '-')) as h from %s c) r$q$, t) into r;
  return format('%s/%s/%s', r.n, r.a, r.b);
end $$;
-- Scans of a table and of all its indexes in this transaction.
create function pg_temp.scans(t regclass) returns bigint language sql as $$
  select pg_stat_get_xact_numscans(t)
       + coalesce((select sum(pg_stat_get_xact_numscans(indexrelid)) from pg_index where indrelid = t), 0)::bigint
$$;
-- F280: an approximate pass is deterministic on a fixed graph but the graph is random. Run the
-- pass as authenticated with the function's settings; while it differs from the oracle, rebuild
-- the indexes and run it again (at most 10 times), so the function is compared with an exact
-- oracle on a graph whose pass is known to be exact, never on luck.
create function pg_temp.settle(label text, ann text, oracle uuid[], indexes regclass[], ef text, iterative text)
returns void language plpgsql as $$
declare got uuid[]; i regclass;
begin
  for attempt in 1..10 loop
    perform set_config('hnsw.ef_search', ef, true);
    perform set_config('hnsw.iterative_scan', iterative, true);
    perform set_config('role', 'authenticated', true);
    execute ann into got;
    perform set_config('role', 'postgres', true);
    perform set_config('hnsw.ef_search', '40', true);
    perform set_config('hnsw.iterative_scan', 'off', true);
    exit when got is not distinct from oracle;
    raise notice 'F280: % approximate pass differs on attempt %; rebuilding', label, attempt;
    foreach i in array indexes loop execute format('reindex index %s', i); end loop;
  end loop;
  perform pg_temp.ok(got is not distinct from oracle, label || ': the approximate pass equals the exact oracle on this graph');
end $$;

-- ===========================================================================================
-- Part 1. The migrated schema.

select pg_temp.ok((select relkind from pg_class where oid = to_regclass('public.document_chunks')) = 'p',
  'document_chunks is a partitioned table');
select pg_temp.ok(pg_get_partkeydef('public.document_chunks'::regclass) = 'LIST (desk_feature)', 'partitioned by list on desk_feature');
select pg_temp.ok((select array_agg(c.relname || ' ' || pg_get_expr(c.relpartbound, c.oid) order by c.relname)
                     from pg_inherits i join pg_class c on c.oid = i.inhrelid
                    where i.inhparent = 'public.document_chunks'::regclass)
  = array['document_chunks_default DEFAULT', 'document_chunks_nclt FOR VALUES IN (''NCLT / NCLAT (Insolvency)'')'],
  'two partitions: NCLT and default');
select pg_temp.ok((select relkind from pg_class where oid = to_regclass('public.document_chunks_unpartitioned')) = 'r',
  'the old table is kept, renamed');

create temp table cols as
  select a.attrelid, a.attnum, a.attname::text as name, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid in ('public.document_chunks'::regclass, 'public.document_chunks_unpartitioned'::regclass)
     and a.attnum > 0 and not a.attisdropped;
select pg_temp.ok(
  (select array_agg(row(name, typ, attnotnull, def)::text order by attnum) from cols
    where attrelid = 'public.document_chunks'::regclass and name not in ('desk_tier', 'desk_feature', 'doc_date', 'language'))
  = (select array_agg(row(name, typ, attnotnull, def)::text order by attnum) from cols
      where attrelid = 'public.document_chunks_unpartitioned'::regclass),
  'same columns as the old table, in order, with the same types, nullability and defaults');
select pg_temp.ok((select array_agg(row(name, typ, attnotnull)::text order by attnum) from cols
                    where attrelid = 'public.document_chunks'::regclass and name in ('desk_tier', 'desk_feature', 'doc_date', 'language'))
  = array['(desk_tier,text,f)', '(desk_feature,text,f)', '(doc_date,date,f)', '(language,text,f)'],
  'four nullable facet columns');

create temp table cons as
  select conrelid, contype, conname::text, pg_get_constraintdef(oid) as def, conparentid
    from pg_constraint where conrelid in ('public.document_chunks'::regclass, 'public.document_chunks_unpartitioned'::regclass);
select pg_temp.ok((select array_agg(def order by def) from cons where conrelid = 'public.document_chunks'::regclass and contype in ('c', 'f'))
  = (select array_agg(def order by def) from cons where conrelid = 'public.document_chunks_unpartitioned'::regclass and contype in ('c', 'f')),
  'the source_kind check and the cascading foreign key to documents, as before');
select pg_temp.ok((select array_agg(conname || ': ' || def order by conname) from cons
                    where conrelid = 'public.document_chunks'::regclass and contype in ('p', 'u'))
  = array['document_chunks_document_id_chunk_hash_desk_feature_key: UNIQUE NULLS NOT DISTINCT (document_id, chunk_hash, desk_feature)',
          'document_chunks_id_desk_feature_key: UNIQUE NULLS NOT DISTINCT (id, desk_feature)'],
  'unique keys include the partition key, nulls not distinct');

create temp table idx as
  select t.relname::text as tab, c.relname::text as name, regexp_replace(pg_get_indexdef(c.oid), '^.* USING ', 'USING ') as def,
         c.reloptions, i.indisvalid, (select p.relname::text from pg_inherits h join pg_class p on p.oid = h.inhparent where h.inhrelid = c.oid) as parent
    from pg_index i join pg_class c on c.oid = i.indexrelid join pg_class t on t.oid = i.indrelid
   where t.relname in ('document_chunks', 'document_chunks_nclt', 'document_chunks_default', 'document_chunks_unpartitioned')
     and t.relnamespace = 'public'::regnamespace;
select pg_temp.ok((select count(*) from idx h, idx o
                    where o.name = 'document_chunks_unpartitioned_embedding_halfvec_hnsw' and h.tab in ('document_chunks_nclt', 'document_chunks_default')
                      and h.name = h.tab || '_embedding_halfvec_hnsw' and h.def = o.def and h.reloptions is not distinct from o.reloptions
                      and h.indisvalid and h.parent = 'document_chunks_embedding_halfvec_hnsw') = 2,
  'each partition has the old HNSW definition (halfvec cosine, default parameters), attached to the parent index');
select pg_temp.ok((select def from idx where name = 'document_chunks_embedding_halfvec_hnsw')
  = (select def from idx where name = 'document_chunks_unpartitioned_embedding_halfvec_hnsw'), 'the parent HNSW index keeps the old name and definition');
select pg_temp.ok((select count(*) from idx where tab in ('document_chunks_nclt', 'document_chunks_default') and def = 'USING btree (document_id, chunk_index)'
                      and parent = 'document_chunks_document_order') = 2
  and (select def from idx where name = 'document_chunks_document_order') = 'USING btree (document_id, chunk_index)',
  'document_order index on each partition, under the old name');
select pg_temp.ok((select array_agg(name || ' ' || def order by name) from idx where tab = 'document_chunks' and name like 'document_chunks_feature_%')
  = array['document_chunks_feature_date USING btree (desk_feature, doc_date)', 'document_chunks_feature_language USING btree (desk_feature, language)',
          'document_chunks_feature_tier USING btree (desk_feature, desk_tier)'],
  'facet indexes');
select pg_temp.ok((select array_agg(name order by name) from idx where tab = 'document_chunks_unpartitioned')
  = array['document_chunks_unpartitioned_document_id_chunk_hash_key', 'document_chunks_unpartitioned_document_order',
          'document_chunks_unpartitioned_embedding_halfvec_hnsw', 'document_chunks_unpartitioned_pkey'],
  'the old table keeps its indexes under renamed names');

select pg_temp.ok((select array_agg(c.relname::text || ':' || t.tgname || ':' || t.tgtype order by c.relname)
                     from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where not t.tgisinternal and c.relname in ('document_chunks', 'document_chunks_nclt', 'document_chunks_default', 'document_chunks_unpartitioned'))
  = array['document_chunks:document_chunks_fill_facets:23', 'document_chunks_default:document_chunks_fill_facets:23',
          'document_chunks_nclt:document_chunks_fill_facets:23'],
  'the facet trigger (BEFORE INSERT OR UPDATE, row) on the parent and both partitions; none on the old table');
select pg_temp.ok((select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.documents'::regclass and not tgisinternal)
  = array['documents_chunk_facets', 'documents_updated_at', 'law_indexed_publication', 'protect_supplied_text'],
  'documents keeps its three triggers and gains the facet sync');
select pg_temp.ok((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'documents_chunk_facets')
  = 'CREATE TRIGGER documents_chunk_facets AFTER UPDATE OF desk_feature, desk_tier, metadata ON public.documents FOR EACH ROW EXECUTE FUNCTION documents_sync_chunk_facets()',
  'the sync fires after updates of desk_feature, desk_tier or metadata');

select pg_temp.ok((select bool_and(relrowsecurity and not relforcerowsecurity) from pg_class
                    where oid in ('public.document_chunks'::regclass, 'public.document_chunks_nclt'::regclass,
                                  'public.document_chunks_default'::regclass, 'public.document_chunks_unpartitioned'::regclass)),
  'RLS on the parent, both partitions and the old table');
create temp table pols as
  select polrelid::regclass::text as tab, polname::text, polpermissive, polcmd,
         (select array_agg(rolname::text order by rolname) from pg_roles where oid = any (polroles)) as roles,
         replace(pg_get_expr(polqual, polrelid), 'document_chunks_unpartitioned.', 'document_chunks.') as qual
    from pg_policy where polrelid in ('public.document_chunks'::regclass, 'public.document_chunks_unpartitioned'::regclass,
                                      'public.document_chunks_nclt'::regclass, 'public.document_chunks_default'::regclass);
select pg_temp.ok((select array_agg(row(polname, polpermissive, polcmd, roles, qual)::text order by polname) from pols where tab = 'document_chunks')
  = (select array_agg(row(polname, polpermissive, polcmd, roles, qual)::text order by polname) from pols where tab = 'document_chunks_unpartitioned')
  and (select count(*) from pols where tab = 'document_chunks') = 2,
  'the parent has the old two policies: document_chunks_read (permissive) and law_chunks_serving (restrictive)');
select pg_temp.ok(not exists (select 1 from pols where tab in ('document_chunks_nclt', 'document_chunks_default')), 'no policy on a partition');

create temp table expected_grants(role text, rel text, privs text);
insert into expected_grants values
  ('anon', 'document_chunks', ''), ('authenticated', 'document_chunks', 'SELECT'),
  ('service_role', 'document_chunks', 'SELECT,INSERT,UPDATE,DELETE');
insert into expected_grants select r, t, '' from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['document_chunks_nclt', 'document_chunks_default', 'document_chunks_unpartitioned']) t;
create function pg_temp.privs(r text, t text) returns text language sql as $$
  select coalesce(string_agg(p, ',' order by o), '')
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) with ordinality x(p, o)
   where has_table_privilege(r, 'public.' || t, p)
$$;
select pg_temp.ok((select bool_and(pg_temp.privs(role, rel) = privs) from expected_grants),
  'table privileges: authenticated select on the parent only, service_role writes on the parent only, nothing on partitions or the old table');
select pg_temp.ok(not exists (select 1 from expected_grants where privs = '' and has_any_column_privilege(role, 'public.' || rel, 'SELECT,INSERT,UPDATE,REFERENCES')),
  'no column privilege on a partition or the old table either');
select pg_temp.ok(not exists (select 1 from pg_class c, aclexplode(c.relacl) a where a.grantee = 0
                                and c.oid in ('public.document_chunks'::regclass, 'public.document_chunks_nclt'::regclass,
                                              'public.document_chunks_default'::regclass, 'public.document_chunks_unpartitioned'::regclass)),
  'nothing granted to PUBLIC');

create temp table fns(sig text, secdef boolean, vol "char", config text, anon boolean, authn boolean, service boolean);
insert into fns values
  ('public.chunk_commit(uuid,jsonb,text[])', true, 'v', '{"search_path=public, extensions"}', false, false, true),
  ('public.match_documents(extensions.vector,integer,uuid[],text,text)', false, 's', '{"search_path=public, extensions"}', false, true, true),
  ('public.match_documents_feature_hnsw(extensions.vector,integer,text,text)', false, 's', '{"search_path=public, extensions"}', false, true, true),
  ('public.admin_readiness_document(uuid)', true, 's', '{"search_path=\"\""}', false, false, false),
  ('public.ingest_text_activate_unmapped(uuid,uuid,bigint,numeric)', true, 'v', '{"search_path=public, extensions"}', false, false, false),
  ('public.record_mapping_fingerprint(text,text,text,uuid)', true, 's', '{"search_path=public, extensions"}', false, false, true),
  ('public.record_resolve_document_keys(text[])', false, 's', '{"search_path=public, extensions"}', false, true, true),
  ('public.document_date_facet(text,jsonb)', false, 'i', '{search_path=pg_catalog}', false, false, true),
  ('public.document_chunks_fill_facets()', true, 'v', '{search_path=public}', false, false, false),
  ('public.documents_sync_chunk_facets()', true, 'v', '{search_path=public}', false, false, false);
create temp table fn_check as
  select f.sig, p.oid is not null and p.prosecdef = f.secdef and p.provolatile = f.vol and p.proconfig::text = f.config
         and has_function_privilege('anon', p.oid, 'execute') = f.anon
         and has_function_privilege('authenticated', p.oid, 'execute') = f.authn
         and has_function_privilege('service_role', p.oid, 'execute') = f.service
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
         and (select count(*) from pg_proc q where q.proname = p.proname and q.pronamespace = 'public'::regnamespace) = 1 as good
    from fns f left join pg_proc p on p.oid = to_regprocedure(f.sig);
select pg_temp.ok(not exists (select 1 from fn_check where good is not true),
  'every function that reads chunks keeps its signature, definer/invoker, volatility, search_path and grants; one overload each: '
  || coalesce((select string_agg(sig, ', ') from fn_check where good is not true), 'all good'));

-- ===========================================================================================
-- Part 2. Writes after the swap, the rollback, a seeded unpartitioned corpus and the migration again.

insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('c0000000-0000-4000-8000-00000000000a', 'pt-rollback-a', 'Rollback A', 'national', 'Bill Passage Probability Index', 'x', 'aaaa', 4, now(), '{}'),
  ('c0000000-0000-4000-8000-00000000000b', 'pt-rollback-b', 'Rollback B', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'bbbb', 4, now(), '{}');
set local role service_role;
select chunk_commit('c0000000-0000-4000-8000-00000000000a', jsonb_agg(jsonb_build_object('chunk_hash', 'rb-a' || i, 'chunk_index', i,
         'char_from', 0, 'char_to', 4, 'content', 'aaaa', 'chunker_version', 4, 'embedding', pg_temp.cone(50, 0.1 * i, i)::text::jsonb)),
       array['rb-a1', 'rb-a2', 'rb-a3']) from generate_series(1, 3) i;
select chunk_commit('c0000000-0000-4000-8000-00000000000b', jsonb_agg(jsonb_build_object('chunk_hash', 'rb-b' || i, 'chunk_index', i,
         'char_from', 0, 'char_to', 4, 'content', 'bbbb', 'chunker_version', 4, 'embedding', pg_temp.cone(50, 0.1 * i, 10 + i)::text::jsonb)),
       array['rb-b1', 'rb-b2']) from generate_series(1, 2) i;
reset role;
select pg_temp.ok((select array_agg(tableoid::regclass::text order by chunk_hash) from document_chunks where chunk_hash like 'rb-%')
  = array['document_chunks_default', 'document_chunks_default', 'document_chunks_default', 'document_chunks_nclt', 'document_chunks_nclt'],
  'chunk_commit after the swap routes by the document''s feature');
-- What the old table may hold by then: a row deleted since the swap and a row changed since.
insert into document_chunks_unpartitioned (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version)
  values ('c0000000-0000-4000-8000-00000000000a', 'rb-stale', 9, 0, 4, 'gone', 4);
insert into document_chunks_unpartitioned (id, document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version)
  select id, document_id, chunk_hash, chunk_index, 0, 3, 'old', 3 from document_chunks where chunk_hash = 'rb-a1';
create temp table before_rollback as select pg_temp.digest('public.document_chunks') as d;

-- The header's rollback, as written (its function restores are done by applying the migration again below).
set local lock_timeout = '30s';
lock table public.documents, public.document_chunks, public.document_chunks_unpartitioned in share row exclusive mode;
delete from public.document_chunks_unpartitioned o where not exists (select 1 from public.document_chunks n where n.id = o.id);
insert into public.document_chunks_unpartitioned
  (id, document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, token_count,
   embedding, chunker_version, metadata, created_at, block_ids, image_ids, embed_hash)
select id, document_id, chunk_hash, chunk_index, source_kind, page_number, char_from, char_to, content, token_count,
       embedding, chunker_version, metadata, created_at, block_ids, image_ids, embed_hash
  from public.document_chunks
on conflict (id) do update set
  document_id = excluded.document_id, chunk_hash = excluded.chunk_hash, chunk_index = excluded.chunk_index,
  source_kind = excluded.source_kind, page_number = excluded.page_number, char_from = excluded.char_from,
  char_to = excluded.char_to, content = excluded.content, token_count = excluded.token_count,
  embedding = excluded.embedding, chunker_version = excluded.chunker_version, metadata = excluded.metadata,
  created_at = excluded.created_at, block_ids = excluded.block_ids, image_ids = excluded.image_ids,
  embed_hash = excluded.embed_hash;
lock table public.document_chunks, public.document_chunks_unpartitioned in access exclusive mode;
drop trigger documents_chunk_facets on public.documents;
drop table public.document_chunks;
alter table public.document_chunks_unpartitioned rename to document_chunks;
alter index public.document_chunks_unpartitioned_pkey rename to document_chunks_pkey;
alter index public.document_chunks_unpartitioned_document_id_chunk_hash_key rename to document_chunks_document_id_chunk_hash_key;
alter index public.document_chunks_unpartitioned_document_order rename to document_chunks_document_order;
alter index public.document_chunks_unpartitioned_embedding_halfvec_hnsw rename to document_chunks_embedding_halfvec_hnsw;
grant select on table public.document_chunks to authenticated;
grant select, insert, update, delete on table public.document_chunks to service_role;
drop function public.documents_sync_chunk_facets();
drop function public.document_chunks_fill_facets();
drop function public.document_date_facet(text, jsonb);

select pg_temp.ok((select relkind from pg_class where oid = 'public.document_chunks'::regclass) = 'r'
  and to_regclass('public.document_chunks_unpartitioned') is null and to_regclass('public.document_chunks_nclt') is null,
  'rollback: the unpartitioned table is document_chunks again');
select pg_temp.ok(pg_temp.digest('public.document_chunks') = (select d from before_rollback),
  'rollback: every row written after the swap is back, the deleted row is gone and the changed row is current');
select pg_temp.ok(pg_temp.privs('authenticated', 'document_chunks') = 'SELECT'
  and pg_temp.privs('service_role', 'document_chunks') = 'SELECT,INSERT,UPDATE,DELETE' and pg_temp.privs('anon', 'document_chunks') = '',
  'rollback: grants restored');

-- The seeded corpus, in the old shape. Default-partition chunks are spread round-robin across
-- documents at cosine distance 0.001 + 0.004 g from axis 10; NCLT chunks at 0.004 k from axis 1
-- (k <= 150, then denser and farther). No two rows a query ranks are tied.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata)
select ('c1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'pt-nclt-' || n, 'NCLT ' || n, 'law', 'NCLT / NCLAT (Insolvency)',
       'x', 'nnnn', 4, now(), jsonb_build_object('citation', jsonb_build_object('order_date', '2024-01-' || lpad(n::text, 2, '0'), 'case_number', 'CP/' || n),
                                               'language', case when n % 2 = 0 then 'hi' else 'en' end)
  from generate_series(1, 31) n;
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('c2000000-0000-4000-8000-000000000001', 'law:trib:IBBI_NCLT:pt-hidden', 'Hidden NCLT', 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'hhhh', 4, now(),
   '{"origin": "supplied-text", "citation": {"order_date": "2024-05-06"}}'),
  ('c3000000-0000-4000-8000-000000000001', 'pt-bill-1', 'Bill 1', 'national', 'Bill Passage Probability Index', 'x', 'bbbb', 4, now(),
   '{"citation": {"introduced_on": "2023-07-20"}, "language": "en"}'),
  ('c3000000-0000-4000-8000-000000000002', 'pt-bill-2', 'Bill 2', 'national', 'Bill Passage Probability Index', 'x', 'bbbb', 4, now(), '{}'),
  ('c3000000-0000-4000-8000-000000000003', 'pt-bill-state', 'State bill', 'state', 'Bill Passage Probability Index', 'x', 'ssss', 4, now(),
   '{"citation": {"introduced_on": "2022-02-28"}}'),
  ('c3000000-0000-4000-8000-000000000004', 'pt-bill-unindexed', 'Unindexed bill', 'national', 'Bill Passage Probability Index', 'x', 'uuuu', 4, null, '{}'),
  ('c4000000-0000-4000-8000-000000000001', 'pt-pq-1', 'PQ 1', 'national', 'Parliamentary Question Database', 'x', 'pppp', 4, now(),
   '{"citation": {"answered_on": "05.08.2024"}, "language": "hi"}'),
  ('c4000000-0000-4000-8000-000000000002', 'pt-pq-2', 'PQ 2', 'national', 'Parliamentary Question Database', 'x', 'pppp', 4, now(),
   '{"citation": {"answered_on": " 7.2.2025 "}}'),
  ('c4000000-0000-4000-8000-000000000003', 'pt-pq-3', 'PQ 3', 'national', 'Parliamentary Question Database', 'x', 'pppp', 4, now(),
   '{"citation": {"answered_on": "31.02.2025"}}'),
  ('c5000000-0000-4000-8000-000000000001', 'pt-reg-1', 'Regulatory 1', 'national', 'Regulatory Body Watch (RBI SEBI TRAI CCI)', 'x', 'rrrr', 4, now(),
   '{"citation": {"order_date": "2024-01-01"}}'),
  ('c6000000-0000-4000-8000-000000000001', 'pt-nofeature', 'No feature', null, null, 'x', 'xxxx', 4, now(), '{"language": "en"}');
insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version, metadata, token_count)
select ('c1000000-0000-4000-8000-0000000000' || lpad((1 + (k - 1) / 500)::text, 2, '0'))::uuid, 'n' || k, k, 0, 4, 'nnnn',
       pg_temp.cone(1, case when k <= 150 then 0.004 * k else 0.6 + (k - 150) * 0.39 / 14900 end, k), 4,
       jsonb_build_object('section', 'S' || k % 7), k % 50
  from generate_series(1, 15050) k;
insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version)
select 'c2000000-0000-4000-8000-000000000001', 'h' || i, i, 0, 4, 'hhhh', pg_temp.cone(1, 0.002 + 0.004 * i, 1000 + i), 4
  from generate_series(0, 19) i;
insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version, page_number, block_ids)
select doc, 'g' || g, i, 0, 4, 'dddd', case when doc = 'c3000000-0000-4000-8000-000000000001' and i = 30 then null else pg_temp.cone(10, 0.001 + 0.004 * g, g::int) end,
       4, nullif(i % 3, 0), case when i % 5 = 0 then array[gen_random_uuid()] end
  from (select doc::uuid, i, row_number() over (order by i, o) as g
          from (values ('c3000000-0000-4000-8000-000000000001', 30, 1), ('c3000000-0000-4000-8000-000000000002', 30, 2),
                       ('c3000000-0000-4000-8000-000000000003', 10, 3), ('c3000000-0000-4000-8000-000000000004', 5, 4),
                       ('c4000000-0000-4000-8000-000000000001', 40, 5), ('c4000000-0000-4000-8000-000000000002', 10, 6),
                       ('c4000000-0000-4000-8000-000000000003', 5, 7), ('c5000000-0000-4000-8000-000000000001', 40, 8),
                       ('c6000000-0000-4000-8000-000000000001', 10, 9)) v(doc, n, o),
               generate_series(1, n) i) s;
insert into desk_rows (tier, feature, row_key, row, record_text, snapshot_at)
  values ('national', 'Bill Passage Probability Index', 'pt-row-1', '{"title": "Bill 1"}', 'Bill 1', now());

-- The four functions that are not recreated, on the unpartitioned table, for comparison after.
create temp table fn_before as select
  record_mapping_fingerprint('national', 'Bill Passage Probability Index', 'pt-row-1', 'c3000000-0000-4000-8000-000000000001') as fingerprint,
  admin_readiness_document('c3000000-0000-4000-8000-000000000001') as readiness_bill,
  admin_readiness_document('c1000000-0000-4000-8000-000000000001') as readiness_nclt;
set local role authenticated;
create temp table resolve_before as select * from record_resolve_document_keys(array[
  'document-id:c3000000-0000-4000-8000-000000000001', 'document-id:c3000000-0000-4000-8000-000000000002',
  'document-id:c3000000-0000-4000-8000-000000000004', 'document-id:c1000000-0000-4000-8000-000000000001']);
reset role;

create temp table before_copy as select pg_temp.digest('public.document_chunks') as d, (select count(*) from document_chunks) as n;
create temp table old_rows as select * from document_chunks;
analyze documents; analyze document_chunks;

-- The migration is its own transaction (begin ... commit), as on NTER, so this one ends here; the
-- database is disposable. It is applied as the non-superuser migrating role, as in the chain.
commit;
set role nter_migrator;
\i supabase/migrations/20261101120000_document_chunks_partitioned.sql
reset role;
begin;
set local search_path = public, extensions;
set local jit = off;

select pg_temp.ok((select relkind from pg_class where oid = 'public.document_chunks'::regclass) = 'p', 'the migration applies again over a seeded corpus');
select pg_temp.ok(pg_temp.digest('public.document_chunks') = (select d from before_copy)
  and pg_temp.digest('public.document_chunks_unpartitioned') = (select d from before_copy),
  'copy: same row count and digest (vectors byte for byte) in the new table, and the old table unchanged: ' || (select d from before_copy));
select pg_temp.ok(not exists (
    select 1 from old_rows o full join document_chunks n using (id)
     where o.id is null or n.id is null
        or row(o.document_id, o.chunk_hash, o.chunk_index, o.source_kind, o.page_number, o.char_from, o.char_to, o.content,
               o.token_count, o.chunker_version, o.metadata, o.created_at, o.block_ids, o.image_ids, o.embed_hash)
           is distinct from
           row(n.document_id, n.chunk_hash, n.chunk_index, n.source_kind, n.page_number, n.char_from, n.char_to, n.content,
               n.token_count, n.chunker_version, n.metadata, n.created_at, n.block_ids, n.image_ids, n.embed_hash)
        or extensions.vector_send(o.embedding) is distinct from extensions.vector_send(n.embedding)),
  'copy: every row equal to its original, column by column, ids kept');
select pg_temp.ok((select count(*) from document_chunks_nclt) = 15050 + 20 + 2
  and (select count(*) from document_chunks_default) = (select n from before_copy) - 15072,
  'copy: NCLT chunks in the NCLT partition, everything else in the default partition');

-- ===========================================================================================
-- Part 3. Behaviour.

-- Routing and facets.
select pg_temp.ok(not exists (
    select 1 from document_chunks c join documents d on d.id = c.document_id
     where c.tableoid <> case when d.desk_feature = 'NCLT / NCLAT (Insolvency)' then 'document_chunks_nclt'::regclass else 'document_chunks_default'::regclass end
        or (c.desk_feature, c.desk_tier, c.doc_date, c.language)
           is distinct from (d.desk_feature, d.desk_tier, document_date_facet(d.desk_feature, d.metadata), d.metadata->>'language')),
  'every chunk is in its feature''s partition (null feature: default) and its facets equal its document''s');
select pg_temp.ok((select array_agg(f order by f) from (select distinct d.source_key || '=' || coalesce(c.doc_date::text, 'null') || '/' || coalesce(c.language, 'null') as f
                     from document_chunks c join documents d on d.id = c.document_id
                    where d.source_key in ('pt-nclt-1', 'pt-nclt-2', 'pt-bill-1', 'pt-bill-2', 'pt-pq-1', 'pt-pq-2', 'pt-pq-3', 'pt-reg-1', 'pt-nofeature')) x)
  = array['pt-bill-1=2023-07-20/en', 'pt-bill-2=null/null', 'pt-nclt-1=2024-01-01/en', 'pt-nclt-2=2024-01-02/hi', 'pt-nofeature=null/en',
          'pt-pq-1=2024-08-05/hi', 'pt-pq-2=2025-02-07/null', 'pt-pq-3=null/null', 'pt-reg-1=null/null'],
  'backfilled facets: NCLT order_date, Bills introduced_on, PQ answered_on parsed from D.M.YYYY; impossible or unparsed dates null');
select pg_temp.ok((select max(n) from (select count(distinct tableoid) n from document_chunks group by document_id) x) = 1,
  'all chunks of a document share one partition');

-- The date parser, case by case.
create temp table date_cases(feature text, metadata jsonb, expected date);
insert into date_cases values
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2024-03-05"}}', '2024-03-05'),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": " 2024-03-05\n"}}', '2024-03-05'),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2024-02-29"}}', '2024-02-29'),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2023-02-29"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "1900-02-29"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2000-02-29"}}', '2000-02-29'),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2024-04-31"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2024-13-01"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2024-00-10"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "0000-01-01"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2024-3-5"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "05.03.2024"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "2024-03-05T10:00:00Z"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": "٢٠٢٤-٠٣-٠٥"}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": 20240305}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"order_date": null}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {}}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": "2024-03-05"}', null),
  ('NCLT / NCLAT (Insolvency)', '{"order_date": "2024-03-05"}', null),
  ('NCLT / NCLAT (Insolvency)', '{"citation": {"introduced_on": "2024-03-05"}}', null),
  ('NCLT / NCLAT (Insolvency)', null, null),
  ('Bill Passage Probability Index', '{"citation": {"introduced_on": "2023-12-31"}}', '2023-12-31'),
  ('Bill Passage Probability Index', '{"citation": {"introduced_on": "31.12.2023"}}', null),
  ('Bill Passage Probability Index', '{"citation": {"order_date": "2023-12-31"}}', null),
  ('Bill Passage Probability Index', '{"citation": {"introduced_on": ""}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "05.08.2024"}}', '2024-08-05'),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "5.8.2024"}}', '2024-08-05'),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "05/08/2024"}}', '2024-08-05'),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "05-08-2024"}}', '2024-08-05'),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "\t05.08.2024 "}}', '2024-08-05'),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "2024-08-05"}}', '2024-08-05'),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "05.08.24"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "29.02.2023"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "29.02.2024"}}', '2024-02-29'),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "31.04.2024"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "13.13.2024"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "00.08.2024"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "105.08.2024"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "05.08.2024 (Monday)"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "5 Aug 2024"}}', null),
  ('Parliamentary Question Database', '{"citation": {"answered_on": "05.08/2024"}}', '2024-08-05'),
  ('Regulatory Body Watch (RBI SEBI TRAI CCI)', '{"citation": {"order_date": "2024-01-01", "answered_on": "01.01.2024"}}', null),
  (null, '{"citation": {"order_date": "2024-01-01"}}', null);
select pg_temp.ok(not exists (select 1 from date_cases where document_date_facet(feature, metadata) is distinct from expected),
  'document_date_facet: ' || coalesce((select string_agg(coalesce(feature, 'null') || ' ' || coalesce(metadata::text, 'null')
                                               || ' -> ' || coalesce(document_date_facet(feature, metadata)::text, 'null'), '; ')
                                         from date_cases where document_date_facet(feature, metadata) is distinct from expected), 'every case'));

-- Uniqueness across the new keys, and the trigger's refusal of a foreign feature.
select pg_temp.fails($q$insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version, desk_feature)
  values ('c3000000-0000-4000-8000-000000000001', 'g1', 99, 0, 4, 'dup', 4, 'Bill Passage Probability Index')$q$, '23505',
  '(document_id, chunk_hash) stays unique');
select pg_temp.fails($q$insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version, desk_feature)
  values ('c6000000-0000-4000-8000-000000000001', (select chunk_hash from document_chunks where document_id = 'c6000000-0000-4000-8000-000000000001' limit 1),
          99, 0, 4, 'dup', 4, null)$q$, '23505', '(document_id, chunk_hash) stays unique for a document without a feature');
select pg_temp.fails($q$insert into document_chunks (id, document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version, desk_feature)
  values ((select id from document_chunks where chunk_hash = 'g1'), 'c3000000-0000-4000-8000-000000000002', 'new-hash', 99, 0, 4, 'dup', 4,
          'Bill Passage Probability Index')$q$, '23505', 'a chunk id stays unique within its feature');
select pg_temp.fails($q$insert into document_chunks (id, document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version, desk_feature)
  values ((select id from document_chunks where chunk_hash = 'g9'), 'c6000000-0000-4000-8000-000000000001', 'new-hash', 99, 0, 4, 'dup', 4, null)$q$,
  '23505', 'a chunk id stays unique for a document without a feature');
select pg_temp.fails($q$insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version, desk_feature)
  values ('c3000000-0000-4000-8000-000000000001', 'wrong', 99, 0, 4, 'x', 4, 'Parliamentary Question Database')$q$, '23514',
  'a chunk whose feature is not its document''s is refused', 'is not its document''s');
select pg_temp.fails($q$insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version)
  values ('c1000000-0000-4000-8000-000000000001', 'unset', 99, 0, 4, 'x', 4)$q$, '23514',
  'a writer that does not set the feature (an older chunk_commit) is refused, not misplaced');
select pg_temp.fails($q$update document_chunks set desk_feature = 'NCLT / NCLAT (Insolvency)' where chunk_hash = 'g1'$q$, '23514',
  'a chunk cannot be moved away from its document''s feature');
update document_chunks set desk_tier = 'forged', doc_date = '1999-01-01', language = 'xx' where chunk_hash = 'g1';
select pg_temp.ok((select (desk_tier, doc_date, language) = ('national', '2023-07-20'::date, 'en') from document_chunks where chunk_hash = 'g1'),
  'a written facet is replaced by the document''s value');

-- chunk_commit, as before: inserted / kept / deleted, ids kept on a hit, the embed_hash guard, the foreign key.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('c7000000-0000-4000-8000-000000000001', 'pt-commit', 'Commit', 'national', 'Parliamentary Question Database', 'x', 'cccc', 4, now(),
   '{"citation": {"answered_on": "01.01.2020"}, "language": "en"}'),
  ('c7000000-0000-4000-8000-000000000002', 'pt-commit-nofeature', 'Commit, no feature', null, null, 'x', 'cccc', 4, now(), '{}');
create function pg_temp.row(h text, content text, axis int, embed_hash text default null) returns jsonb language sql as $$
  select jsonb_build_object('chunk_hash', h, 'chunk_index', 0, 'char_from', 0, 'char_to', 4, 'content', content,
    'chunker_version', 4, 'embed_hash', embed_hash, 'embedding', pg_temp.cone(axis, 0.2, 1)::text::jsonb)
$$;
set local role service_role;
create temp table commits(step int, result jsonb);
insert into commits select 1, chunk_commit('c7000000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.row('h1', 'one', 60, 'e1'), pg_temp.row('h2', 'two', 61, 'e2'), pg_temp.row('h3', 'three', 62, 'e3')), array['h1', 'h2', 'h3']);
create temp table h2_before as select id from document_chunks where chunk_hash = 'h2' and document_id = 'c7000000-0000-4000-8000-000000000001';
insert into commits select 2, chunk_commit('c7000000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.row('h2', 'two again', 61, 'e2b'), pg_temp.row('h4', 'four', 63, 'e4')), array['h2', 'h4']);
insert into commits select 3, chunk_commit('c7000000-0000-4000-8000-000000000002', jsonb_build_array(pg_temp.row('z1', 'none', 64)), array['z1']);
reset role;
select pg_temp.ok((select array_agg(result order by step) from commits)
  = array['{"kept": 0, "deleted": 0, "inserted": 3}', '{"kept": 1, "deleted": 2, "inserted": 1}', '{"kept": 0, "deleted": 0, "inserted": 1}']::jsonb[],
  'chunk_commit counts inserted, kept and deleted as before');
select pg_temp.ok((select array_agg(chunk_hash || ':' || content || ':' || embed_hash order by chunk_hash) from document_chunks
                    where document_id = 'c7000000-0000-4000-8000-000000000001') = array['h2:two again:e2b', 'h4:four:e4']
  and (select id from document_chunks where chunk_hash = 'h2' and document_id = 'c7000000-0000-4000-8000-000000000001') = (select id from h2_before),
  'chunk_commit keeps the id of a hit and replaces its text and vector');
select pg_temp.ok((select bool_and((desk_feature, desk_tier, doc_date, language, tableoid)
                                   = ('Parliamentary Question Database', 'national', '2020-01-01'::date, 'en', 'document_chunks_default'::regclass))
                     from document_chunks where document_id = 'c7000000-0000-4000-8000-000000000001')
  and (select (desk_feature is null and desk_tier is null and tableoid = 'document_chunks_default'::regclass) from document_chunks
        where document_id = 'c7000000-0000-4000-8000-000000000002'),
  'chunk_commit writes the document''s facets; a document without a feature goes to the default partition');
select pg_temp.fails($q$select chunk_commit('c7000000-0000-4000-8000-000000000001', jsonb_build_array(pg_temp.row('h2', 'two again', 61, 'changed') - 'embedding'), array['h2', 'h4'])$q$,
  'P0001', 'chunk_commit still refuses a changed embed_hash without a vector', 'changed embed_hash without a new embedding');
select pg_temp.fails($q$select chunk_commit('c7000000-0000-4000-8000-0000000000ff', jsonb_build_array(pg_temp.row('q1', 'x', 65)), array['q1'])$q$,
  '23503', 'chunk_commit for a missing document still fails on the foreign key');

-- The sync trigger: facets follow the document, and a feature change moves the chunks.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at, metadata) values
  ('c8000000-0000-4000-8000-000000000001', 'pt-sync', 'Sync', 'national', 'Bill Passage Probability Index', 'x', 'ssss', 4, now(),
   '{"citation": {"introduced_on": "2021-03-04"}, "language": "en"}');
set local role service_role;
select chunk_commit('c8000000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.row('s1', 'a', 70), pg_temp.row('s2', 'b', 71), pg_temp.row('s3', 'c', 72)), array['s1', 's2', 's3']);
reset role;
create function pg_temp.sync_state() returns text language sql as $$
  select string_agg(distinct coalesce(tableoid::regclass::text, '-') || '|' || coalesce(desk_feature, 'null') || '|' || coalesce(desk_tier, 'null')
                    || '|' || coalesce(doc_date::text, 'null') || '|' || coalesce(language, 'null'), ' ; ') || ' x' || count(*)
    from document_chunks where document_id = 'c8000000-0000-4000-8000-000000000001'
$$;
create temp table sync_rows as select ctid::text as t, xmin::text as x from document_chunks where document_id = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.sync_state() = 'document_chunks_default|Bill Passage Probability Index|national|2021-03-04|en x3', 'sync: start');
update documents set title = 'Sync, renamed', metadata = metadata where id = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.ok((select array_agg(row(ctid::text, xmin::text)::text order by ctid::text) from document_chunks where document_id = 'c8000000-0000-4000-8000-000000000001')
  = (select array_agg(row(t, x)::text order by t) from sync_rows), 'sync: an update that changes no facet leaves the chunks untouched');
update documents set metadata = '{"citation": {"introduced_on": "2020-12-31"}, "language": "fr"}' where id = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.sync_state() = 'document_chunks_default|Bill Passage Probability Index|national|2020-12-31|fr x3', 'sync: metadata change updates doc_date and language');
update documents set desk_tier = 'law', desk_feature = 'NCLT / NCLAT (Insolvency)', metadata = '{"citation": {"order_date": "2019-09-09"}}'
 where id = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.sync_state() = 'document_chunks_nclt|NCLT / NCLAT (Insolvency)|law|2019-09-09|null x3', 'sync: a feature change moves the chunks to the NCLT partition');
set local role service_role;
select chunk_commit('c8000000-0000-4000-8000-000000000001',
  jsonb_build_array(pg_temp.row('s1', 'a', 70), pg_temp.row('s2', 'b', 71), pg_temp.row('s3', 'c', 72), pg_temp.row('s4', 'd', 73)), array['s1', 's2', 's3', 's4']);
reset role;
select pg_temp.ok(pg_temp.sync_state() = 'document_chunks_nclt|NCLT / NCLAT (Insolvency)|law|2019-09-09|null x4', 'sync: chunk_commit after the move writes the new feature');
update documents set desk_tier = null, desk_feature = null where id = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.sync_state() = 'document_chunks_default|null|null|null|null x4', 'sync: a null feature moves the chunks to the default partition');
update documents set desk_tier = 'national', desk_feature = 'Parliamentary Question Database', metadata = '{"citation": {"answered_on": "05.08.2024"}}'
 where id = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.sync_state() = 'document_chunks_default|Parliamentary Question Database|national|2024-08-05|null x4', 'sync: back to a default-partition feature, date parsed');
delete from documents where id = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.ok(not exists (select 1 from document_chunks where document_id = 'c8000000-0000-4000-8000-000000000001'), 'deleting a document still cascades to its chunks');

-- RLS and privileges, read for real. The law listing is active and the supplied-text NCLT order is
-- unpublished, so the restrictive policies hide it and its chunks.
update law_listing_settings set seeded = true, active = true;
select pg_temp.ok((select count(*) from document_chunks where document_id = 'c2000000-0000-4000-8000-000000000001') = 20, 'the owner sees the hidden order''s chunks');
create temp table totals as select count(*) as n from document_chunks;
grant select on totals to authenticated;
set local role authenticated;
select pg_temp.ok((select count(*) from document_chunks where document_id = 'c2000000-0000-4000-8000-000000000001') = 0,
  'authenticated: the restrictive law policy hides the unpublished order''s chunks through the parent');
select pg_temp.ok((select count(*) from document_chunks) = (select n - 20 from totals), 'authenticated: every other chunk is read through the parent');
select pg_temp.fails('select count(*) from document_chunks_nclt', '42501', 'authenticated cannot read the NCLT partition directly');
select pg_temp.fails('select count(*) from document_chunks_default', '42501', 'authenticated cannot read the default partition directly');
select pg_temp.fails('select count(*) from document_chunks_unpartitioned', '42501', 'authenticated cannot read the old table');
select pg_temp.fails('insert into document_chunks_default (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version) values (gen_random_uuid(), $$x$$, 0, 0, 1, $$x$$, 1)',
  '42501', 'authenticated cannot write a partition');
reset role;
set local role anon;
select pg_temp.fails('select count(*) from document_chunks', '42501', 'anon cannot read the parent');
select pg_temp.fails('select count(*) from document_chunks_nclt', '42501', 'anon cannot read a partition');
select pg_temp.fails('select count(*) from document_chunks_unpartitioned', '42501', 'anon cannot read the old table');
select pg_temp.fails($q$select * from match_documents(pg_temp.e(1))$q$, '42501', 'anon cannot search');
reset role;
-- Even a stray grant on a partition reads nothing: RLS is on there with no policy.
grant select on document_chunks_nclt to authenticated;
set local role authenticated;
select pg_temp.ok((select count(*) from document_chunks_nclt) = 0, 'a partition read directly returns no row even if granted');
reset role;
revoke select on document_chunks_nclt from authenticated;

-- match_documents in every mode against the same query on the unpartitioned copy of the same rows.
-- The oracles run as authenticated on document_chunks_unpartitioned, under its own (old) policies.
analyze documents; analyze document_chunks;
grant select on document_chunks_unpartitioned to authenticated;
create temp table q(name text primary key, v vector);
insert into q values ('nclt', pg_temp.e(1)), ('default', pg_temp.e(10)),
  ('mixed', (array_fill(0::real, array[0]) || array[1::real] || array_fill(0::real, array[8]) || array[1::real] || array_fill(0::real, array[1526]))::vector);
grant select on q to authenticated;
create temp table oracle(mode text primary key, ids uuid[], sims float8[]);
create temp table got(mode text primary key, ids uuid[], sims float8[], nclt bigint, dflt bigint);
grant all on oracle, got to authenticated;
set local role authenticated;
-- Document ids: the old branch's statement verbatim on the old table (quota 8 per document).
insert into oracle select 'ids', array_agg(id order by ord), array_agg(sim order by ord) from (
  select s.id, (1 - s.dist)::float8 as sim, row_number() over (order by s.dist) as ord
    from (select c.id, c.document_id, (c.embedding <=> (select v from q where name = 'mixed')) as dist,
                 row_number() over (partition by c.document_id order by c.embedding <=> (select v from q where name = 'mixed')) as rn
            from document_chunks_unpartitioned c
           where c.document_id = any (array['c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
                                            'c3000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001']::uuid[])
             and c.embedding is not null) s
    join documents d on d.id = s.document_id
   where s.rn <= 8 and d.indexed_at is not null
   order by s.dist limit 40) x;
-- Unscoped, tier, feature (helper and exact) and the helper alone: exact top 40.
insert into oracle select 'unscoped-nclt', array_agg(id order by ord), null from (
  select c.id, row_number() over (order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'nclt')::halfvec(1536)), c.id) ord
    from document_chunks_unpartitioned c join documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null
   order by ord limit 40) x;
insert into oracle select 'unscoped-default', array_agg(id order by ord), null from (
  select c.id, row_number() over (order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'default')::halfvec(1536)), c.id) ord
    from document_chunks_unpartitioned c join documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null
   order by ord limit 40) x;
insert into oracle select 'tier', array_agg(id order by ord), null from (
  select c.id, row_number() over (order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'default')::halfvec(1536)), c.id) ord
    from document_chunks_unpartitioned c join documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null and d.desk_tier = 'national'
   order by ord limit 40) x;
insert into oracle select 'feature-nclt', array_agg(id order by ord), null from (
  select c.id, row_number() over (order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'nclt')::halfvec(1536)), c.id) ord
    from document_chunks_unpartitioned c join documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null and d.desk_feature = 'NCLT / NCLAT (Insolvency)'
   order by ord limit 40) x;
insert into oracle select 'feature-bills', array_agg(id order by ord), array_agg(sim order by ord) from (
  select c.id, (1 - (c.embedding <=> (select v from q where name = 'default')))::float8 as sim,
         row_number() over (order by c.embedding <=> (select v from q where name = 'default')) ord
    from document_chunks_unpartitioned c join documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null and d.desk_feature = 'Bill Passage Probability Index'
   order by ord limit 40) x;
insert into oracle select 'feature-bills-state', array_agg(id order by ord), null from (
  select c.id, row_number() over (order by c.embedding <=> (select v from q where name = 'default')) ord
    from document_chunks_unpartitioned c join documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null and d.desk_feature = 'Bill Passage Probability Index' and d.desk_tier = 'state'
   order by ord limit 40) x;
insert into oracle select 'helper-bills', array_agg(id order by ord), null from (
  select c.id, row_number() over (order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'default')::halfvec(1536)), c.id) ord
    from document_chunks_unpartitioned c join documents d on d.id = c.document_id
   where c.embedding is not null and d.indexed_at is not null and d.desk_feature = 'Bill Passage Probability Index'
   order by ord limit 40) x;
reset role;
revoke select on document_chunks_unpartitioned from authenticated;
select pg_temp.ok((select count(*) from oracle where cardinality(ids) > 0) = 8
  and (select cardinality(ids) from oracle where mode = 'ids') = 24 and (select cardinality(ids) from oracle where mode = 'feature-bills-state') = 10
  and (select cardinality(ids) from oracle where mode = 'feature-nclt') = 40,
  'oracles: every mode has rows (document ids: 3 visible documents x 8; state bills: 10)');
select pg_temp.ok(not exists (select 1 from oracle o, document_chunks c where c.id = any (o.ids) and c.document_id = 'c2000000-0000-4000-8000-000000000001'),
  'oracles: the old policies hide the unpublished order too');

-- Make the approximate passes deterministic: the same statements as the functions, as authenticated.
select pg_temp.settle('unscoped (NCLT query)', $q$select array_agg(id) from (
    select c.id from document_chunks c join documents d on d.id = c.document_id
     where c.embedding is not null and d.indexed_at is not null
     order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'nclt')::halfvec(1536)) limit 40) x$q$,
  (select ids from oracle where mode = 'unscoped-nclt'),
  array['document_chunks_nclt_embedding_halfvec_hnsw', 'document_chunks_default_embedding_halfvec_hnsw']::regclass[], '200', 'off');
select pg_temp.settle('unscoped (default query)', $q$select array_agg(id) from (
    select c.id from document_chunks c join documents d on d.id = c.document_id
     where c.embedding is not null and d.indexed_at is not null
     order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'default')::halfvec(1536)) limit 40) x$q$,
  (select ids from oracle where mode = 'unscoped-default'),
  array['document_chunks_nclt_embedding_halfvec_hnsw', 'document_chunks_default_embedding_halfvec_hnsw']::regclass[], '200', 'off');
select pg_temp.settle('tier', $q$select array_agg(id) from (
    select c.id from document_chunks c join documents d on d.id = c.document_id
     where c.embedding is not null and d.indexed_at is not null and d.desk_tier = 'national'
     order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'default')::halfvec(1536)) limit 40) x$q$,
  (select ids from oracle where mode = 'tier'),
  array['document_chunks_nclt_embedding_halfvec_hnsw', 'document_chunks_default_embedding_halfvec_hnsw']::regclass[], '200', 'off');
select pg_temp.settle('feature NCLT (helper)', $q$select array_agg(id order by dist, id) from (
    select c.id, (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'nclt')::halfvec(1536)) as dist
      from document_chunks c join documents d on d.id = c.document_id
     where c.embedding is not null and d.indexed_at is not null and c.desk_feature = 'NCLT / NCLAT (Insolvency)'
     order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'nclt')::halfvec(1536)) limit 40) x$q$,
  (select ids from oracle where mode = 'feature-nclt'),
  array['document_chunks_nclt_embedding_halfvec_hnsw']::regclass[], '400', 'relaxed_order');
select pg_temp.settle('feature Bills (helper)', $q$select array_agg(id order by dist, id) from (
    select c.id, (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'default')::halfvec(1536)) as dist
      from document_chunks c join documents d on d.id = c.document_id
     where c.embedding is not null and d.indexed_at is not null and c.desk_feature = 'Bill Passage Probability Index'
     order by (c.embedding::halfvec(1536)) <=> ((select v from q where name = 'default')::halfvec(1536)) limit 40) x$q$,
  (select ids from oracle where mode = 'helper-bills'),
  array['document_chunks_default_embedding_halfvec_hnsw']::regclass[], '400', 'relaxed_order');

-- The functions, as authenticated, counting the scans of each partition per call.
create function pg_temp.call(mode text, q text) returns void language plpgsql as $$
declare n0 bigint := pg_temp.scans('document_chunks_nclt'); d0 bigint := pg_temp.scans('document_chunks_default'); r record;
begin
  execute format('select array_agg(id order by ord) ids, array_agg(similarity order by ord) sims from (select id, similarity, row_number() over () ord from (%s) f) x', q) into r;
  insert into got values (mode, r.ids, r.sims, pg_temp.scans('document_chunks_nclt') - n0, pg_temp.scans('document_chunks_default') - d0);
end $$;
set local hnsw.ef_search = 40;
set local hnsw.iterative_scan = 'strict_order';
set local role authenticated;
select pg_temp.call('ids', $q$select * from match_documents((select v from q where name = 'mixed'), 40, array['c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001']::uuid[])$q$);
select pg_temp.call('unscoped-nclt', $q$select * from match_documents((select v from q where name = 'nclt'), 40)$q$);
select pg_temp.call('unscoped-default', $q$select * from match_documents((select v from q where name = 'default'), 40)$q$);
select pg_temp.call('tier', $q$select * from match_documents((select v from q where name = 'default'), 40, null, 'national')$q$);
select pg_temp.call('feature-nclt', $q$select * from match_documents((select v from q where name = 'nclt'), 40, null, null, 'NCLT / NCLAT (Insolvency)')$q$);
select pg_temp.call('feature-bills', $q$select * from match_documents((select v from q where name = 'default'), 40, null, null, 'Bill Passage Probability Index')$q$);
select pg_temp.call('feature-bills-state', $q$select * from match_documents((select v from q where name = 'default'), 40, null, 'state', 'Bill Passage Probability Index')$q$);
select pg_temp.call('helper-bills', $q$select * from match_documents_feature_hnsw((select v from q where name = 'default'), 40, null, 'Bill Passage Probability Index')$q$);
select pg_temp.call('feature-pq-state', $q$select * from match_documents((select v from q where name = 'default'), 40, null, 'state', 'Parliamentary Question Database')$q$);
select pg_temp.ok(current_setting('hnsw.ef_search') = '40' and current_setting('hnsw.iterative_scan') = 'strict_order',
  'the caller''s ef_search and iterative_scan are restored after every search');
reset role;
select pg_temp.ok((select ids from got where mode = 'ids') = (select ids from oracle where mode = 'ids')
  and (select sims from got where mode = 'ids') = (select sims from oracle where mode = 'ids'),
  'document ids: the same rows, order and similarities as the old branch on the unpartitioned copy');
select pg_temp.ok((select ids from got where mode = 'unscoped-nclt') = (select ids from oracle where mode = 'unscoped-nclt'),
  'unscoped (NCLT query): the same rows and order as exact search on the unpartitioned copy');
select pg_temp.ok((select ids from got where mode = 'unscoped-default') = (select ids from oracle where mode = 'unscoped-default'),
  'unscoped (default query): the same rows and order as exact search on the unpartitioned copy');
select pg_temp.ok((select ids from got where mode = 'tier') = (select ids from oracle where mode = 'tier'),
  'tier: the same rows and order as exact search on the unpartitioned copy');
select pg_temp.ok((select ids from got where mode = 'feature-nclt') = (select ids from oracle where mode = 'feature-nclt'),
  'feature NCLT (over 15,000 chunks, the HNSW helper): the same rows and order as exact search on the unpartitioned copy');
select pg_temp.ok((select ids from got where mode = 'feature-bills') = (select ids from oracle where mode = 'feature-bills')
  and (select sims from got where mode = 'feature-bills') = (select sims from oracle where mode = 'feature-bills'),
  'feature Bills (exact path): the same rows, order and similarities');
select pg_temp.ok((select ids from got where mode = 'feature-bills-state') = (select ids from oracle where mode = 'feature-bills-state'),
  'feature and tier: the same rows');
select pg_temp.ok((select ids from got where mode = 'helper-bills') = (select ids from oracle where mode = 'helper-bills'),
  'the helper on a default-partition feature: the same rows and order as exact search');
select pg_temp.ok((select ids is null from got where mode = 'feature-pq-state'), 'a feature and tier with no chunk: no rows');
select pg_temp.ok((select nclt > 0 and dflt = 0 from got where mode = 'feature-nclt'), 'feature NCLT reads only the NCLT partition');
select pg_temp.ok((select bool_and(nclt = 0 and dflt > 0) from got where mode in ('feature-bills', 'feature-bills-state', 'helper-bills', 'feature-pq-state')),
  'a default-partition feature reads only the default partition');
select pg_temp.ok((select bool_and(nclt > 0 and dflt > 0) from got where mode in ('unscoped-nclt', 'unscoped-default', 'tier')),
  'unscoped and tier searches read both partitions');

-- The four functions that were not recreated give the same answers as on the unpartitioned table.
select pg_temp.ok((select fingerprint from fn_before)
    = record_mapping_fingerprint('national', 'Bill Passage Probability Index', 'pt-row-1', 'c3000000-0000-4000-8000-000000000001')
  and (select readiness_bill from fn_before) = admin_readiness_document('c3000000-0000-4000-8000-000000000001')
  and (select readiness_nclt from fn_before) = admin_readiness_document('c1000000-0000-4000-8000-000000000001'),
  'record_mapping_fingerprint and admin_readiness_document: unchanged answers (stored fingerprints stay valid)');
set local role authenticated;
create temp table resolve_after as select * from record_resolve_document_keys(array[
  'document-id:c3000000-0000-4000-8000-000000000001', 'document-id:c3000000-0000-4000-8000-000000000002',
  'document-id:c3000000-0000-4000-8000-000000000004', 'document-id:c1000000-0000-4000-8000-000000000001']);
reset role;
select pg_temp.ok((select array_agg(row(r.*)::text order by row(r.*)::text) from resolve_after r)
    = (select array_agg(row(r.*)::text order by row(r.*)::text) from resolve_before r)
  and (select array_agg(coverage order by document_key) from resolve_after) = array['full', 'incomplete', 'full', 'registered'],
  'record_resolve_document_keys: unchanged answers (NCLT full; bill with an unembedded chunk incomplete; bill full; unindexed registered)');
-- ingest_text_activate_unmapped checks the committed chunks of a supplied-text job.
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, metadata) values
  ('c9000000-0000-4000-8000-000000000001', 'law:hc:pt/1', 'Supplied', 'law', 'Order Archive by Topic (Cross-Court)',
   encode(sha256(convert_to('A court order.', 'UTF8')), 'hex'), 'A court order.', '{"origin": "supplied-text"}');
insert into ingest_text_inputs (document_id, payload, payload_sha256, expected) values
  ('c9000000-0000-4000-8000-000000000001',
   jsonb_build_object('text', 'A court order.', 'text_sha256', encode(sha256(convert_to('A court order.', 'UTF8')), 'hex'))::text, 'p',
   jsonb_build_array(jsonb_build_object('chunk_hash', repeat('a', 64), 'embed_hash', repeat('b', 64), 'chunk_index', 0, 'source_kind', 'document',
     'char_from', 0, 'char_to', 14, 'content', 'A court order.', 'token_count', 4, 'chunker_version', 4)));
insert into ingest_jobs (id, document_id, input_kind, status, stage, file_sha256, pages_total, claim_token, lease_until) values
  ('c9100000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'supplied_text', 'running', 'index', 'x', 0,
   'c9200000-0000-4000-8000-000000000001', now() + interval '5 minutes');
select pg_temp.fails($q$select ingest_text_activate_unmapped('c9100000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000001', 0, 0)$q$,
  'P0001', 'ingest_text_activate_unmapped still refuses missing chunks', 'incomplete chunks');
select chunk_commit('c9000000-0000-4000-8000-000000000001', jsonb_build_array(jsonb_build_object('chunk_hash', repeat('a', 64), 'embed_hash', repeat('b', 64),
  'chunk_index', 0, 'source_kind', 'document', 'char_from', 0, 'char_to', 14, 'content', 'A court order.', 'token_count', 4, 'chunker_version', 4,
  'embedding', pg_temp.e(80)::text::jsonb)), array[repeat('a', 64)]);
create temp table activated as
  select ingest_text_activate_unmapped('c9100000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000001', 0, 0) as r;
select pg_temp.ok((select r->>'status' from activated) = 'succeeded'
  and (select indexed_at is not null from documents where id = 'c9000000-0000-4000-8000-000000000001'),
  'ingest_text_activate_unmapped activates once the chunks are in the partitioned table');

-- The iterative scan, and the recovery bound kept as a safety net. In the default partition, 500
-- chunks of another feature lie nearer to the query than the target feature's 40 indexed chunks;
-- the target feature also holds 99,962 zero vectors (eligible, but not in a cosine HNSW index),
-- so it has 100,002 eligible chunks: without an in-walk filter its search underfills and
-- recovery must refuse (FEATURE_SEARCH_RECOVERY_LIMIT).
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, chunker_version, indexed_at) values
  ('ca000000-0000-4000-8000-000000000001', 'pt-target', 'Target', 'national', 'Industry Updates (Ministry Data)', 'x', 'tttt', 4, now()),
  ('ca000000-0000-4000-8000-000000000002', 'pt-distractor', 'Distractor', 'national', 'Budget Utilisation & Schemes', 'x', 'dddd', 4, now());
insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, embedding, chunker_version, desk_feature)
select 'ca000000-0000-4000-8000-000000000002'::uuid, 'dist' || i, i, 0, 4, 'dddd', pg_temp.cone(30, 0.0005 * i, i), 4, 'Budget Utilisation & Schemes'
  from generate_series(1, 500) i
union all
select 'ca000000-0000-4000-8000-000000000001', 'target' || i, i, 0, 4, 'tttt', pg_temp.cone(30, 0.3 + 0.004 * i, i), 4, 'Industry Updates (Ministry Data)'
  from generate_series(1, 40) i
union all
select 'ca000000-0000-4000-8000-000000000001', 'zero' || i, 100 + i, 0, 4, 'tttt', array_fill(0::real, array[1536])::vector, 4, 'Industry Updates (Ministry Data)'
  from generate_series(1, 99962) i;
analyze document_chunks;
create temp table targets as select array_agg(id order by chunk_index) as ids from document_chunks where chunk_hash like 'target%';
grant select on targets to authenticated;
create function pg_temp.walk(iterative text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('hnsw.ef_search', '400', true);
  perform set_config('hnsw.iterative_scan', iterative, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from (select c.id from document_chunks c join documents d on d.id = c.document_id
    where c.embedding is not null and d.indexed_at is not null and c.desk_feature = 'Industry Updates (Ministry Data)'
    order by (c.embedding::halfvec(1536)) <=> (pg_temp.e(30)::halfvec(1536)) limit 40) x;
  perform set_config('role', 'postgres', true);
  perform set_config('hnsw.ef_search', '40', true);
  perform set_config('hnsw.iterative_scan', 'off', true);
  return n;
end $$;
select pg_temp.ok(pg_temp.walk('off') < 40, 'control: without the iterative scan the walk underfills (ef_search 400 holds only nearer chunks of another feature)');
select pg_temp.settle('iterative walk', $q$select array_agg(id order by dist, id) from (
    select c.id, (c.embedding::halfvec(1536)) <=> (pg_temp.e(30)::halfvec(1536)) as dist
      from document_chunks c join documents d on d.id = c.document_id
     where c.embedding is not null and d.indexed_at is not null and c.desk_feature = 'Industry Updates (Ministry Data)'
     order by (c.embedding::halfvec(1536)) <=> (pg_temp.e(30)::halfvec(1536)) limit 40) x$q$,
  (select ids from targets), array['document_chunks_default_embedding_halfvec_hnsw']::regclass[], '400', 'relaxed_order');
set local hnsw.iterative_scan = off;
set local role authenticated;
select pg_temp.ok((select array_agg(id) from match_documents_feature_hnsw(pg_temp.e(30), 40, 'national', 'Industry Updates (Ministry Data)')) = (select ids from targets),
  'the helper sets the iterative scan itself: 40 rows from a 100,002-chunk feature without recovery (the session had it off)');
select pg_temp.ok((select array_agg(id) from match_documents(pg_temp.e(30), 40, null, null, 'Industry Updates (Ministry Data)')) = (select ids from targets),
  'match_documents in feature mode reaches the same 40');
select pg_temp.ok(current_setting('hnsw.iterative_scan') = 'off', 'the session''s iterative_scan is restored');
reset role;
-- With 39 indexed chunks the walk cannot fill 40, and recovery over 100,001 eligible chunks refuses.
delete from document_chunks where chunk_hash = 'target40';
set local role authenticated;
select pg_temp.fails($q$select * from match_documents_feature_hnsw(pg_temp.e(30), 40, 'national', 'Industry Updates (Ministry Data)')$q$, '54000',
  'recovery still refuses an underfilled search over more than 100,000 eligible chunks', 'FEATURE_SEARCH_RECOVERY_LIMIT');
select pg_temp.ok(current_setting('hnsw.iterative_scan') = 'off' and current_setting('hnsw.ef_search') = '40', 'settings restored after the refusal');
reset role;
delete from document_chunks where chunk_hash = 'zero99962';
set local role authenticated;
select pg_temp.ok((select count(*) from match_documents_feature_hnsw(pg_temp.e(30), 40, 'national', 'Industry Updates (Ministry Data)')) = 40,
  'at exactly 100,000 eligible chunks recovery runs and fills');
reset role;

rollback;
