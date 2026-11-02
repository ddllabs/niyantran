-- C3b review B1: a temporary type and cast of corpus_ingest must never run as the functions' owner.
-- corpus_ingest has TEMP through PUBLIC (it cannot be withheld from one role), so with a login it
-- can shadow a type name in pg_temp. A security definer function whose search_path leaves pg_temp
-- implicit searches it first for types, and would run the caller's cast as its owner.
--
-- This must be a fresh session: plans cached by earlier calls keep the types they resolved, so the
-- setup writes the ledger rows directly and the first call of every runner function is the attack.
-- Disposable fixture; run.sh uses the ingest_register_batch chain (Phase B, the corpus_ingest
-- bootstrap, 20261102130000 as a non-superuser).
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
create function pg_temp.try(q text, b uuid, d jsonb, k text[]) returns void language plpgsql as $$
begin begin execute q using b, d, k; exception when others then null; end; end $$;

-- One admitted collection, one sealed batch of one answer, one open batch, written directly.
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values ('national','Parliamentary Question Database','atk',
 jsonb_build_object('house','Lok Sabha','date','2026-04-02','ministry','M','subject','Attack','source_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU9001_at.pdf?source=pqals'),'x',now());
create temp table doc as
 with r as (select jsonb_build_object('source_key',repeat('a',40),'title','Attack','text','ATTACK TEXT','text_sha256',encode(sha256(convert_to('ATTACK TEXT','UTF8')),'hex'),
   'desk_tier','national','desk_feature','Parliamentary Question Database','file_url','https://sansad.in/getFile/loksabhaquestions/annex/187/AU9001_at.pdf?source=pqals',
   'licence_class','gov_open','citation',jsonb_build_object('house','Lok Sabha','subject','Attack','ministry','M','answered_on','02.04.2026'),
   'review',jsonb_build_object('status','eligible'),'pages','[]'::jsonb) r)
 select jsonb_build_object('payload',r::text,'payload_sha256',encode(sha256(convert_to(r::text,'UTF8')),'hex'),
   'expected',jsonb_build_array(jsonb_build_object('chunk_hash',repeat('c',64),'embed_hash',repeat('d',64))),'pages','[]'::jsonb,'sections','[]'::jsonb) q,
   r->>'text_sha256' t, '11111111-1111-4111-8111-000000000001'::uuid b, '11111111-1111-4111-8111-000000000002'::uuid ob from r;
insert into public.ingest_collection_policies(collection,policy_sha256,admitted,licence_classes,min_chars_per_page,min_pages_for_density,require_page_count,
  budget_usd,chunk_ceiling,stop_thresholds,decision_id,approver,evidence_sha256,active)
 values ('atk',repeat('1',64),'[{"desk_tier":"national","desk_feature":"Parliamentary Question Database","adapter":"lok_sabha_answers"}]',array['gov_open'],0,5,false,
  100,100000,'{"refusal_share":1,"failure_rate":1,"uncertain_max":1,"min_decided":1}','d','a',repeat('e',64),true);
insert into public.ingest_batches(id,collection,manifest_sha256,policy_sha256,policy,state,items_planned,chunks_planned,est_tokens,est_cost_usd,runner_commit,sealed_at)
 select b,'atk',repeat('2',64),repeat('1',64),(select to_jsonb(p) from public.ingest_collection_policies p where collection='atk'),'sealed',1,1,1,1,'abcdef1',now() from doc
 union all select ob,'atk',repeat('3',64),repeat('1',64),(select to_jsonb(p) from public.ingest_collection_policies p where collection='atk'),'open',2,2,2,1,'abcdef1',null from doc;
insert into public.ingest_batch_items(batch_id,source_key,payload_sha256,content_sha256,chunks,est_tokens) select b,repeat('a',40),q->>'payload_sha256',t,1,1 from doc;
grant select on doc to corpus_ingest;
create temp table settings0 as select to_jsonb(s) v from public.ingest_settings s;
create temp sequence escalations;
grant usage, select, update on sequence escalations to public;

-- The attack, as corpus_ingest: uuid (the reviewer's probe), date and timestamptz shadowed, each
-- cast counting a call made as another role. (Shadowing a type the functions declare variables of,
-- such as jsonb, makes them fail to compile instead: a denial of service the same fix removes.)
set local role corpus_ingest;
create temp table uuid(a text);
create temp table date(a text);
create temp table timestamptz(a text);
create function pg_temp.mark() returns void language plpgsql as $$
begin if current_user <> 'corpus_ingest' then perform nextval('pg_temp.escalations'); update public.ingest_settings set max_running = 64; end if; end $$;
create function pg_temp.to_uuid(text) returns pg_temp.uuid language plpgsql as $$ begin perform pg_temp.mark(); return row($1)::pg_temp.uuid; end $$;
create function pg_temp.from_uuid(pg_temp.uuid) returns pg_catalog.uuid language sql as $$ select nullif(($1).a,'')::pg_catalog.uuid $$;
create function pg_temp.to_date(text) returns pg_temp.date language plpgsql as $$ begin perform pg_temp.mark(); return row($1)::pg_temp.date; end $$;
create function pg_temp.from_date(pg_temp.date) returns pg_catalog.date language sql as $$ select (($1).a)::pg_catalog.date $$;
create function pg_temp.to_tstz(text) returns pg_temp.timestamptz language plpgsql as $$ begin perform pg_temp.mark(); return row($1)::pg_temp.timestamptz; end $$;
create function pg_temp.from_tstz(pg_temp.timestamptz) returns pg_catalog.timestamptz language sql as $$ select (($1).a)::pg_catalog.timestamptz $$;
create cast (text as pg_temp.uuid) with function pg_temp.to_uuid(text) as implicit;
create cast (pg_temp.uuid as pg_catalog.uuid) with function pg_temp.from_uuid(pg_temp.uuid) as implicit;
create cast (text as pg_temp.date) with function pg_temp.to_date(text) as implicit;
create cast (pg_temp.date as pg_catalog.date) with function pg_temp.from_date(pg_temp.date) as implicit;
create cast (text as pg_temp.timestamptz) with function pg_temp.to_tstz(text) as implicit;
create cast (pg_temp.timestamptz as pg_catalog.timestamptz) with function pg_temp.from_tstz(pg_temp.timestamptz) as implicit;
select pg_temp.try('select public.ingest_register_batch($1, $2, true)', b, pg_catalog.jsonb_build_array(q), null) from doc;
select pg_temp.try('select public.ingest_register_batch($1, $2)', b, pg_catalog.jsonb_build_array(q), null) from doc;
select pg_temp.try('select public.ingest_batch_status($1, $3)', b, null, array[repeat('a',40)]) from doc;
select pg_temp.try('select public.ingest_batch_add_items($1, $2)', ob, pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('source_key','x','payload_sha256',repeat('a',64),
  'content_sha256',repeat('b',64),'chunks',1,'est_tokens',1)), null) from doc;
select pg_temp.try('select public.ingest_batch_seal($1)', ob, null, null) from doc;
select pg_temp.try('select public.ingest_batch_open($2)', null, pg_catalog.jsonb_build_object('collection','atk','manifest_sha256',repeat('7',64),'items_planned',1,
  'chunks_planned',1,'est_tokens',1,'est_cost_usd',1,'runner_commit','abcdef1'), null) from doc;
select pg_temp.try('select public.ingest_batch_requeue($1, array[$1])', b, null, null) from doc;
select pg_temp.try('select count(*) from public.ingest_text_holders($3)', null, null, array[repeat('a',64)]) from doc;
select pg_temp.try('select public.ingest_batch_stop($1, ''attack'')', b, null, null) from doc;
reset role;

select pg_temp.ok((select not is_called from pg_temp.escalations), 'no cast of corpus_ingest''s ran as another role');
select pg_temp.ok((select v from settings0) = (select to_jsonb(s) from public.ingest_settings s), 'ingest_settings unchanged');
select pg_temp.ok((select count(*) from public.documents where source_key = repeat('a',40)) = 1, 'the registration itself still worked');
rollback;
