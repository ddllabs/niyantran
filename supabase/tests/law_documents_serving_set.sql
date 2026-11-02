-- Disposable local fixture for 20261101110000_law_documents_serving_set. Chain: pq_admission_links
-- (the law listing tables, functions and policies of 20261023184450) + the migration, as a
-- non-superuser.
--
-- The rewritten law_documents_serving must admit exactly the rows the 20261023184450 expression
-- admitted. The old expression is kept below, verbatim, as the oracle, and evaluated by the owner
-- (RLS does not apply to the owner); `authenticated` then reads documents, chunks and pages through
-- the policies, for every kind of document and every listing state, and the two id sets must be
-- equal, with the expected number refused in each state so no comparison is vacuous.
--
-- Vacuity: run.sh rebuilds the chain without the migration and this file must fail. Without it the
-- old expression is still in place and the equivalence holds trivially, so the first assertions are
-- the ones that only the migration makes true: the published set function exists, the policy uses it,
-- and a full read of documents calls law_document_is_published zero times.
\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;

create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.fails(q text, state text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlstate <> state then raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', label, state, sqlstate, sqlerrm; end if;
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL: % (accepted: %)', label, q;
end $$;

-- ---------------------------------------------------------------------------------------------
-- What only the migration makes true.

select pg_temp.ok(to_regprocedure('public.law_published_document_ids()') is not null, 'law_published_document_ids() exists');
select pg_temp.ok((select prosecdef and provolatile = 's' and proconfig = '{search_path=public}' and proretset
                     from pg_proc where oid = 'public.law_published_document_ids()'::regprocedure),
  'it is a stable, set-returning security definer function with a fixed search_path');
select pg_temp.ok(not has_function_privilege('anon', 'public.law_published_document_ids()', 'execute')
  and has_function_privilege('authenticated', 'public.law_published_document_ids()', 'execute')
  and has_function_privilege('service_role', 'public.law_published_document_ids()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.law_published_document_ids()'::regprocedure and a.grantee = 0),
  'executable by authenticated and service_role, not by anon or PUBLIC');
select pg_temp.ok((select format('%s %s %s', polpermissive, polcmd, polroles::regrole[]) from pg_policy
                    where polrelid = 'public.documents'::regclass and polname = 'law_documents_serving') = 'f r {authenticated}'
  and (select array_agg(polname::text order by polname) from pg_policy where polrelid = 'public.documents'::regclass)
      = array['documents_read', 'law_documents_serving'],
  'law_documents_serving is still restrictive, SELECT, to authenticated; documents has the same two policies');
select pg_temp.ok((select regexp_replace(pg_get_expr(polqual, polrelid), '\s+|public\.', '', 'g') from pg_policy
                    where polrelid = 'public.documents'::regclass and polname = 'law_documents_serving')
  = '((NOTstarts_with(source_key,''law:trib:IBBI_NCLT:''::text))OR(NOT(EXISTS(SELECT1FROMlaw_listing_settingsWHERElaw_listing_settings.active)))OR(idIN(SELECTlaw_published_document_ids()ASlaw_published_document_ids))OR(NOT((metadata->>''origin''::text)=''supplied-text''::text)))',
  'the policy is the rewritten expression');
select pg_temp.ok((select array_agg(format('%s %s %s %s', polname, polpermissive, polcmd, regexp_replace(pg_get_expr(polqual, polrelid), '\s+|public\.', '', 'g')) order by polname)
                     from pg_policy where polrelid in ('public.document_chunks'::regclass, 'public.document_pages'::regclass))
  = array['document_chunks_read t r true', 'document_pages_read t r true',
          'law_chunks_serving f r (EXISTS(SELECT1FROMdocumentsdWHERE(d.id=document_chunks.document_id)))',
          'law_pages_serving f r (EXISTS(SELECT1FROMdocumentsdWHERE(d.id=document_pages.document_id)))'],
  'the chunk and page policies are unchanged');

-- ---------------------------------------------------------------------------------------------
-- The matrix: every kind of document the expression distinguishes.

insert into law_records (id, row_key, record_type, forum, order_date, source_url, row_data, visible) values
  ('e1000000-0000-4000-8000-000000000001', 'fx-visible', 'tribunal_order', 'NCLT', '2026-07-08', 'https://ibbi.gov.in/uploads/order/v.pdf', '{}', true),
  ('e1000000-0000-4000-8000-000000000002', 'fx-hidden', 'tribunal_order', 'NCLT', '2026-07-08', 'https://ibbi.gov.in/uploads/order/h.pdf', '{}', false),
  ('e1000000-0000-4000-8000-000000000003', 'fx-visible-2', 'tribunal_order', 'NCLT', '2026-07-08', 'https://ibbi.gov.in/uploads/order/v2.pdf', '{}', true);
create temp table kinds(n int primary key, source_key text, tier text, metadata jsonb, record uuid, about text);
insert into kinds values
  (1,  'fx-national',                       'national', '{}',                              null, 'non-law document'),
  (2,  'law:hc:fx/2',                       'law',      '{"origin": "supplied-text"}',     null, 'law supplied text, not an NCLT order'),
  (3,  'law:trib:IBBI_NCLT:fx-3',           'law',      '{"origin": "supplied-text"}',     'e1000000-0000-4000-8000-000000000001', 'NCLT supplied text, published'),
  (4,  'law:trib:IBBI_NCLT:fx-4',           'law',      '{"origin": "supplied-text"}',     'e1000000-0000-4000-8000-000000000002', 'NCLT supplied text, linked to a hidden record'),
  (5,  'law:trib:IBBI_NCLT:fx-5',           'law',      '{"origin": "supplied-text"}',     null, 'NCLT supplied text, unpublished'),
  (6,  'law:trib:IBBI_NCLT:fx-6',           'law',      '{"origin": "pdf"}',               null, 'NCLT order of another origin'),
  (7,  'law:trib:IBBI_NCLT:fx-7',           'law',      '{}',                              null, 'NCLT order without an origin (the expression is null)'),
  (8,  'law:trib:IBBI_NCLT:fx-8',           'law',      '{"origin": null}',                null, 'NCLT order whose origin is JSON null'),
  (9,  'x-law:trib:IBBI_NCLT:fx-9',         'law',      '{"origin": "supplied-text"}',     null, 'the prefix not at the start'),
  (10, 'law:trib:IBBI_NCLT:fx-10',          'law',      '{"origin": "Supplied-Text"}',     null, 'origin in another case'),
  (11, 'law:trib:IBBI_NCLT:fx-11',          'law',      '{}',                              'e1000000-0000-4000-8000-000000000003', 'NCLT order without an origin, published'),
  (12, 'law:trib:ibbi_nclt:fx-12',          'law',      '{"origin": "supplied-text"}',     null, 'the prefix in another case');
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, indexed_at, metadata)
select ('e2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, source_key, about, tier,
       case when tier = 'law' then 'NCLT / NCLAT (Insolvency)' else 'Bill Passage Probability Index' end, 'x', 'text', now(), metadata
  from kinds;
insert into law_document_links (document_id, record_id, text_sha256, evidence_sha256)
select ('e2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, record, 'x', repeat('c', 64) from kinds where record is not null;
insert into document_chunks (document_id, chunk_hash, chunk_index, char_from, char_to, content, chunker_version)
select d.id, 'c' || i, i, 0, 4, 'text', 4 from documents d, generate_series(1, 2) i where d.source_key in (select source_key from kinds);
insert into document_pages (document_id, extract_hash, page_number, text, char_from, char_to)
select d.id, 'x', 1, 'text', 0, 4 from documents d where d.source_key in (select source_key from kinds);

-- The 20261023184450 expression, verbatim: the oracle.
create function pg_temp.old_admits(p_id uuid) returns boolean language sql as $$
  select (not (starts_with(source_key,'law:trib:IBBI_NCLT:') and metadata->>'origin'='supplied-text')
          or not exists(select 1 from public.law_listing_settings where active)
          or public.law_document_is_published(id)) is true
    from public.documents where id = p_id
$$;
create temp table seen(state text, role text, rel text, ids uuid[]);
grant insert, select on seen to authenticated, service_role;
-- One state: the ids each role reads from documents, document_chunks and document_pages, against the oracle.
create function pg_temp.check_state(state text, hidden int) returns void language plpgsql as $$
declare
  v_docs uuid[]; v_chunks uuid[]; v_pages uuid[];
  r text;
begin
  select array_agg(id order by id) into v_docs from documents where pg_temp.old_admits(id);
  select array_agg(c.id order by c.id) into v_chunks from document_chunks c where pg_temp.old_admits(c.document_id);
  select array_agg(p.id order by p.id) into v_pages from document_pages p where pg_temp.old_admits(p.document_id);
  foreach r in array array['authenticated', 'service_role'] loop
    perform set_config('role', r, true);
    insert into seen select state, r, 'documents', array_agg(id order by id) from documents;
    insert into seen select state, r, 'chunks', array_agg(id order by id) from document_chunks;
    insert into seen select state, r, 'pages', array_agg(id order by id) from document_pages;
    perform set_config('role', 'postgres', true);
  end loop;
  perform pg_temp.ok((select ids from seen s where s.state = check_state.state and role = 'authenticated' and rel = 'documents') = v_docs
    and (select ids from seen s where s.state = check_state.state and role = 'authenticated' and rel = 'chunks') = v_chunks
    and (select ids from seen s where s.state = check_state.state and role = 'authenticated' and rel = 'pages') = v_pages,
    state || ': authenticated reads exactly the documents, chunks and pages the old expression admits');
  perform pg_temp.ok((select count(*) from documents) - cardinality(v_docs) = hidden
    and (select count(*) from document_chunks) - cardinality(v_chunks) = 2 * hidden
    and (select count(*) from document_pages) - cardinality(v_pages) = hidden,
    state || ': ' || hidden || ' documents refused (with their chunks and pages): '
      || coalesce((select string_agg(k.n::text, ',' order by k.n) from kinds k
                    where not pg_temp.old_admits(('e2000000-0000-4000-8000-' || lpad(k.n::text, 12, '0'))::uuid)), 'none'));
  perform pg_temp.ok((select ids from seen s where s.state = check_state.state and role = 'service_role' and rel = 'documents')
                       = (select array_agg(id order by id) from documents)
    and (select ids from seen s where s.state = check_state.state and role = 'service_role' and rel = 'chunks')
                       = (select array_agg(id order by id) from document_chunks),
    state || ': service_role still reads every document and chunk');
  perform set_config('role', 'anon', true);
  perform pg_temp.fails('select count(*) from public.documents', '42501', state || ': anon cannot read documents');
  perform pg_temp.fails('select count(*) from public.document_chunks', '42501', state || ': anon cannot read chunks');
  perform pg_temp.fails('select public.law_published_document_ids()', '42501', state || ': anon cannot call the published set');
  perform set_config('role', 'postgres', true);
end $$;

update law_listing_settings set seeded = false, active = false;
select pg_temp.check_state('listing inactive', 0);
update law_listing_settings set seeded = true, active = true;
select pg_temp.check_state('listing active', 4);
update law_records set visible = false where id = 'e1000000-0000-4000-8000-000000000001';
select pg_temp.check_state('active, a published order''s record hidden', 5);
delete from law_document_links where record_id = 'e1000000-0000-4000-8000-000000000003';
select pg_temp.check_state('active, an origin-less order''s link removed', 6);
update law_records set visible = true where id = 'e1000000-0000-4000-8000-000000000002';
select pg_temp.check_state('active, a hidden record made visible', 5);
update law_listing_settings set active = false;
select pg_temp.check_state('listing deactivated again', 0);
select pg_temp.ok((select count(distinct ids) from seen where role = 'authenticated' and rel = 'documents') = 5,
  'the six states produce five different visible sets, so the matrix exercises both directions');

-- ---------------------------------------------------------------------------------------------
-- The cost: a full read of documents builds the published set once and calls the per-row function
-- never (the old policy called it once per NCLT supplied-text order).
update law_listing_settings set active = true;
insert into documents (id, source_key, title, desk_tier, desk_feature, content_sha256, ocr_text, indexed_at, metadata)
select gen_random_uuid(), 'law:trib:IBBI_NCLT:bulk-' || i, 'Bulk ' || i, 'law', 'NCLT / NCLAT (Insolvency)', 'x', 'text', now(), '{"origin": "supplied-text"}'
  from generate_series(1, 200) i;
set local track_functions = 'all';
create temp table calls_before as
  select pg_stat_get_xact_function_calls('public.law_document_is_published(uuid)'::regprocedure) as per_row,
         pg_stat_get_xact_function_calls('public.law_published_document_ids()'::regprocedure) as set_calls;
set local role authenticated;
select count(*) from documents;
select count(*) from document_chunks;
reset role;
select pg_temp.ok(coalesce(pg_stat_get_xact_function_calls('public.law_document_is_published(uuid)'::regprocedure), 0)
                    = coalesce((select per_row from calls_before), 0),
  'reading documents and chunks calls law_document_is_published zero times');
select pg_temp.ok(coalesce(pg_stat_get_xact_function_calls('public.law_published_document_ids()'::regprocedure), 0)
                    - coalesce((select set_calls from calls_before), 0) between 1 and 2,
  'and builds the published set once per query (two queries: at most two calls)');

rollback;
