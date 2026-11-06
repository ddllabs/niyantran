-- F290: registration must not scan the corpus once per document. Disposable fixture. run.sh uses the
-- ingest_register_batch chain, then 20261106120000_admission_scans (as a non-superuser). Spec:
-- docs/specs/2026-11-06-admission-scans.md.
--
-- It first runs every ingest_register_batch case on the rewritten function, so the refusals are proved
-- unchanged, then measures rows read by any route, which is what the rewrite exists to limit.
\i supabase/tests/ingest_register_batch.sql

set local track_functions = 'all';

insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
select repeat('a',8) || md5('scan' || g), 'Seed ' || g,
       'https://sansad.in/getFile/loksabhaquestions/annex/187/AU' || (5000+g) || '_fx.pdf?source=pqals',
       'national','Parliamentary Question Database',md5('text' || g) || md5('more' || g),'x',
       jsonb_build_object('source_path','PDFs/187_AU' || (5000+g) || '_fx.pdf','document_key_suggested','pq:ls:187:AU' || (5000+g))
  from generate_series(1,3000) g;
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database','seed-' || g,
       jsonb_build_object('source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU' || (5000+g) || '_fx.pdf?source=pqals'),
       'Seed ' || g, now()
  from generate_series(1,3000) g;

-- Rows of one table a registration call reads by any route. A primary-key walk reads through an index, so
-- seq_tup_read alone misses it: this counts tuples fetched by index as well.
create function pg_temp.reads(t text) returns bigint language sql as $$
 select coalesce(seq_tup_read,0) + coalesce(idx_tup_fetch,0) from pg_stat_xact_user_tables where relname = t $$;
create function pg_temp.cost_of_registration(g int, n int, want text) returns jsonb language plpgsql as $$
declare qs jsonb := (select jsonb_agg(pg_temp.pq(x)) from generate_series(g, g+n-1) x);
  b uuid := pg_temp.batch('national-pq', qs);
  docs0 bigint := pg_temp.reads('documents'); rows0 bigint := pg_temp.reads('desk_rows'); res jsonb;
begin
 res := pg_temp.i_reg(b, qs);
 if exists(select 1 from jsonb_array_elements(res->'results') e where coalesce(e->>'reason', e->>'outcome') <> want) then
   raise exception 'FAIL expected %: got %', want, left((res->'results')::text, 300); end if;
 return jsonb_build_object('documents', pg_temp.reads('documents') - docs0, 'desk_rows', pg_temp.reads('desk_rows') - rows0);
end $$;

-- Question rows for the admitted call, shaped as the rows above.
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database','adm-' || g,
  jsonb_build_object('id','adm-' || g,'house','Lok Sabha','date','2026-04-02','ministry','MINISTRY OF FIXTURES','subject','Subject ' || g,
   'mp_name','Member','source_url',pg_temp.pq_url(g)), 'Subject ' || g, now()
  from generate_series(3001,3100) g;

-- Analyzed first, as production tables are: a never-analyzed table can seq-scan for reasons of its own. The
-- second pass runs after another analyze, since an analyze is what flipped the plan in the F287 load.
analyze public.documents;
analyze public.desk_rows;
create temp table scan_cost as select 'refused, 100 documents' stage, pg_temp.cost_of_registration(3201, 100, 'no_desk_row') c;
insert into scan_cost select 'admitted, 50 documents', pg_temp.cost_of_registration(3001, 50, 'admitted');
analyze public.documents;
analyze public.desk_rows;
insert into scan_cost select 'admitted, after a further analyze', pg_temp.cost_of_registration(3051, 50, 'admitted');
-- Each document costs a few rows. Any walk or scan of 3,000 rows, even once a call, is over these bounds.
select pg_temp.ok((c->>'documents')::bigint < 1500, 'documents read by lookups, not walked: ' || stage || ' ' || c::text) from scan_cost;
select pg_temp.ok((c->>'desk_rows')::bigint < 1500, 'desk_rows read by lookups, not walked: ' || stage || ' ' || c::text) from scan_cost;

-- The primary-key walk needs a larger table than this fixture can afford, so the shape is checked directly:
-- at 40,000 documents ORDER BY id LIMIT 1 next to the scan walked the whole key, and only outside a CTE is it safe.
select pg_temp.ok(pg_get_functiondef('public.ingest_admit_document(jsonb,jsonb)'::regprocedure) !~* 'x\.id\s+limit\s+1',
  'no lookup orders and limits in the same query as its scan');
select pg_temp.ok((select count(*) from regexp_matches(pg_get_functiondef('public.ingest_admit_document(jsonb,jsonb)'::regprocedure),
  'with m as materialized', 'g')) = 3, 'the three holder lookups each read through a materialized CTE');

-- Holders: each lookup orders outside its CTE, and the lowest id across every match must still be named.
create function pg_temp.holder(g int) returns jsonb language plpgsql as $$
declare q jsonb := pg_temp.pq(g); begin
 return pg_temp.i_reg(pg_temp.batch('national-pq', jsonb_build_array(q)), jsonb_build_array(q))#>'{results,0}';
end $$;
create temp table ids as select gen_random_uuid() a, gen_random_uuid() b;

-- One answer key, two URLs: the plain URL and the listing URL.
insert into public.documents(id,source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
select least(a,b), repeat('b',40), 'Plain URL', replace(pg_temp.pq_url(1970),'?source=pqals',''), 'national','Parliamentary Question Database',repeat('1',64),'x' from ids
union all
select greatest(a,b), repeat('c',40), 'Listing URL', pg_temp.pq_url(1970), 'national','Parliamentary Question Database',repeat('2',64),'x' from ids;
select pg_temp.ok(pg_temp.holder(1970)->>'reason' = 'file_url_held', 'a held answer is refused');
select pg_temp.ok((select count(*) from public.ingest_batch_items i, ids where i.reason='file_url_held'
   and i.detail->>'holder_document_id' = least(a,b)::text) = 1, 'the answer key lookup names the lowest id');

-- Older pack copies: one found only by its key, one only by its file name.
update ids set a = gen_random_uuid(), b = gen_random_uuid();
insert into public.documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
select least(a,b), repeat('d',40), 'Keyed copy', 'national','Parliamentary Question Database',repeat('3',64),'x',
       jsonb_build_object('document_key_suggested','pq:ls:187:AU2971_fx') from ids
union all
select greatest(a,b), repeat('e',39) || 'f', 'Named copy', 'national','Parliamentary Question Database',repeat('4',64),'x',
       jsonb_build_object('source_path','PDFs/187_AU2971_fx.pdf') from ids;
select pg_temp.ok(pg_temp.holder(1971)->>'reason' = 'answer_held', 'an older copy holds the answer, found by key');
select pg_temp.ok((select count(*) from public.ingest_batch_items i, ids where i.reason='answer_held'
   and i.detail->>'holder_document_id' = least(a,b)::text) = 1, 'the older-copy lookup names the lowest id');
delete from public.documents where source_key = repeat('d',40);
select pg_temp.ok(pg_temp.holder(1971)->>'reason' = 'answer_held', 'an older copy holds the answer, found by file name');

-- Duplicate text: two legacy rows may share a hash.
update ids set a = gen_random_uuid(), b = gen_random_uuid();
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database','dup-1972',
  jsonb_build_object('id','dup-1972','house','Lok Sabha','date','2026-04-02','ministry','MINISTRY OF FIXTURES','subject','Subject 1972',
   'mp_name','Member','source_url',pg_temp.pq_url(1972)), 'Subject 1972', now();
insert into public.documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text)
select least(a,b), repeat('f',40), 'First text', 'national','Budget Utilisation & Schemes',
       (pg_temp.pq(1972)->>'payload')::jsonb->>'text_sha256','x' from ids
union all
select greatest(a,b), repeat('f',39) || 'e', 'Second text', 'national','Budget Utilisation & Schemes',
       (pg_temp.pq(1972)->>'payload')::jsonb->>'text_sha256','x' from ids;
select pg_temp.ok(pg_temp.holder(1972)->>'reason' = 'duplicate_text', 'duplicate text is refused');
select pg_temp.ok((select count(*) from public.ingest_batch_items i, ids where i.reason='duplicate_text'
   and i.detail->>'holder_document_id' = least(a,b)::text) >= 1, 'the duplicate text lookup names the lowest id');

rollback;
