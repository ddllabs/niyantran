-- F278 step 8 (C3b): set-based registration. Disposable fixture; run.sh uses the pq_admission_links
-- chain, the corpus_ingest bootstrap, then 20261102130000_batch_registration (as a non-superuser).
-- Design: docs/research/2026-11-02-batch-registration-design.md, section 8.1.
\set ON_ERROR_STOP on
begin;
set search_path = public, extensions;
create function pg_temp.ok(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %', label; end if; raise notice 'PASS %', label; end$$;
create function pg_temp.refused(q text, pattern text) returns void language plpgsql as $$begin
 begin execute q; exception when others then
 if position(pattern in sqlerrm)=0 then raise exception 'wrong refusal: %',sqlerrm; end if; return; end;
 raise exception 'accepted unsafe operation: %',q; end$$;

-- ═══ Authorization ═══════════════════════════════════════════════════════════

select pg_temp.ok((select not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolbypassrls
  and rolpassword is null from pg_authid where rolname='corpus_ingest'), 'corpus_ingest: no login, no password, no attribute');
select pg_temp.ok(not exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='corpus_ingest'),
  'corpus_ingest belongs to no role');

create temp table new_tables(t text);
insert into new_tables values ('public.ingest_settings'),('public.ingest_collection_policies'),('public.ingest_batches'),
 ('public.ingest_batch_items'),('public.ingest_batch_events'),('public.ingest_batch_acceptance');
select pg_temp.ok(not exists(select 1 from new_tables, unnest(array['anon','authenticated','corpus_ingest']) r,
   unnest(array['select','insert','update','delete','truncate','references','trigger']) pr where has_table_privilege(r, t, pr)),
  'anon, authenticated and corpus_ingest have no privilege on any ledger table');
select pg_temp.ok((select bool_and(has_table_privilege('service_role', t, 'select') and not has_table_privilege('service_role', t, 'insert')
   and not has_table_privilege('service_role', t, 'update') and not has_table_privilege('service_role', t, 'delete')) from new_tables),
  'service_role reads the ledger and writes it only through the functions');
select pg_temp.ok((select bool_and(c.relrowsecurity) from new_tables join pg_class c on c.oid = t::regclass), 'RLS on every ledger table');
select pg_temp.ok(not has_table_privilege('corpus_ingest','public.documents','select') and not has_table_privilege('corpus_ingest','public.ingest_jobs','select')
  and not has_table_privilege('corpus_ingest','public.ingest_text_inputs','select') and not has_table_privilege('corpus_ingest','public.document_chunks','select'),
  'corpus_ingest cannot read the corpus tables');

create temp table runner_fns(f text);
insert into runner_fns values ('public.ingest_batch_open(jsonb)'),('public.ingest_batch_add_items(uuid,jsonb)'),('public.ingest_batch_seal(uuid)'),
 ('public.ingest_register_batch(uuid,jsonb,boolean,boolean)'),('public.ingest_batch_status(uuid,text[])'),('public.ingest_batch_stop(uuid,text)'),
 ('public.ingest_batch_requeue(uuid,uuid[])'),('public.ingest_text_holders(text[])');
create temp table internal_fns(f text);
insert into internal_fns values ('public.ingest_policy_approve(jsonb)'),('public.ingest_batch_resume(uuid,jsonb)'),
 ('public.ingest_admit_parse(jsonb)'),('public.ingest_admit_tier(jsonb)'),('public.ingest_admit_adapter(jsonb)'),('public.ingest_admit_shape(jsonb,jsonb)'),
 ('public.ingest_admit_law(jsonb,text)'),('public.ingest_admit_message(text,jsonb)'),('public.ingest_admit_lock(boolean,text[],text[],text[],jsonb)'),
 ('public.ingest_admit_document(jsonb,jsonb)'),('public.ingest_batch_manifest_sha256(uuid)'),('public.ingest_batch_mark_stopped(uuid,text,boolean)'),
 ('public.ingest_batch_block_reason(uuid)');
select pg_temp.ok(not exists(select 1 from (select f from runner_fns union all select f from internal_fns) x, unnest(array['anon','authenticated']) r
   where has_function_privilege(r, f, 'execute')), 'anon and authenticated are denied every new function');
select pg_temp.ok((select bool_and(has_function_privilege('corpus_ingest', f, 'execute') and has_function_privilege('service_role', f, 'execute')) from runner_fns),
  'corpus_ingest and service_role may run the runner functions');
select pg_temp.ok(not exists(select 1 from internal_fns where has_function_privilege('corpus_ingest', f, 'execute')), 'corpus_ingest is denied approval, resume and every helper');
select pg_temp.ok(has_function_privilege('service_role','public.ingest_policy_approve(jsonb)','execute') and has_function_privilege('service_role','public.ingest_batch_resume(uuid,jsonb)','execute')
  and not exists(select 1 from internal_fns where f not in ('public.ingest_policy_approve(jsonb)','public.ingest_batch_resume(uuid,jsonb)') and has_function_privilege('service_role', f, 'execute')),
  'service_role approves and resumes; helpers are owner-only');
select pg_temp.ok(not exists(select 1 from unnest(array['public.chunk_commit(uuid,jsonb,text[])','public.ingest_register(jsonb)','public.ingest_text_commit(uuid,uuid,jsonb)',
   'public.ingest_text_activate(uuid,uuid,bigint,numeric)','public.law_publish(jsonb)','public.record_mapping_apply(jsonb)','public.ingest_register_text(jsonb)',
   'public.ingest_register_text_unmapped(jsonb)','public.ingest_claim(integer,interval)','public.ingest_retry(uuid)','public.ingest_discard(uuid,uuid)']) f
   where has_function_privilege('corpus_ingest', f, 'execute')), 'corpus_ingest cannot reach chunks, uploads, publication, mapping or the queue');
-- Every privileged function corpus_ingest can execute, PUBLIC grants included, is one of the eight.
select pg_temp.ok((select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef and has_function_privilege('corpus_ingest', p.oid, 'execute'))
  = (select array_agg(f::regprocedure::text order by f::regprocedure::text) from runner_fns), 'corpus_ingest executes exactly the runner functions among definer functions');
set local role authenticated;
select pg_temp.refused($q$select public.ingest_batch_open('{}')$q$, 'permission denied');
reset role;
set local role corpus_ingest;
select pg_temp.refused($q$select public.ingest_policy_approve('{}')$q$, 'permission denied');
select pg_temp.refused($q$select count(*) from public.ingest_batches$q$, 'permission denied');
reset role;
select pg_temp.ok((select max_running=2 and claim_batch=1 from public.ingest_settings), 'settings default to today''s behaviour');
select pg_temp.ok(public.ingest_batch_manifest_sha256(null) = encode(sha256(''::bytea),'hex'), 'manifest of nothing is the empty hash');

-- ═══ Helpers ═════════════════════════════════════════════════════════════════

-- corpus_ingest's calls, as corpus_ingest.
create function pg_temp.i_open(p jsonb) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_open(p); reset role; return v; end$$;
create function pg_temp.i_add(b uuid, items jsonb) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_add_items(b, items); reset role; return v; end$$;
create function pg_temp.i_seal(b uuid) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_seal(b); reset role; return v; end$$;
create function pg_temp.i_reg(b uuid, docs jsonb, dry boolean default false, aon boolean default false) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_register_batch(b, docs, dry, aon); reset role; return v; end$$;
create function pg_temp.i_status(b uuid, keys text[] default null) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_status(b, keys); reset role; return v; end$$;
create function pg_temp.i_stop(b uuid, r text) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_stop(b, r); reset role; return v; end$$;
create function pg_temp.i_requeue(b uuid, ids uuid[]) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; v := public.ingest_batch_requeue(b, ids); reset role; return v; end$$;
create function pg_temp.i_holders(h text[]) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role corpus_ingest; select coalesce(jsonb_agg(to_jsonb(x) order by x.source_key),'[]') into v from public.ingest_text_holders(h) x; reset role; return v; end$$;
create function pg_temp.svc(q text) returns jsonb language plpgsql as $$declare v jsonb; begin
 set local role service_role; execute q into v; reset role; return v; end$$;

create function pg_temp.policy(c text, over jsonb default '{}') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.ingest_policy_approve(%L::jsonb)', (jsonb_build_object('collection',c,
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Parliamentary Question Database','adapter','lok_sabha_answers'))
  ,'licence_classes',jsonb_build_array('gov_open'),'min_chars_per_page',600,'min_pages_for_density',5,'require_page_count',false,
  'budget_usd',100,'chunk_ceiling',100000,'stop_thresholds',jsonb_build_object('refusal_share',1,'failure_rate',1,'uncertain_max',1,'min_decided',1),
  'decision_id','fixture-decision','approver','Fixture Owner','evidence_sha256',repeat('e',64)) || over)::text))
$$;

create function pg_temp.pq_url(g int) returns text language sql immutable as $$
 select 'https://sansad.in/getFile/loksabhaquestions/annex/187/AU' || (1000+g) || '_fx.pdf?source=pqals' $$;
create function pg_temp.pq_key(g int) returns text language sql immutable as $$
 select left(encode(sha256(convert_to('pq-key-' || g, 'UTF8')), 'hex'), 40) $$;
-- A request in admin-ingest's shape: payload, its hash, the chunk plan, pages and sections.
create function pg_temp.req(r jsonb) returns jsonb language sql as $$
 select jsonb_build_object('payload',r::text,'payload_sha256',encode(sha256(convert_to(r::text,'UTF8')),'hex'),
  'expected',jsonb_build_array(jsonb_build_object('chunk_hash',encode(sha256(convert_to('c'||(r->>'source_key')||(r->>'text'),'UTF8')),'hex'),
    'embed_hash',encode(sha256(convert_to('e'||(r->>'source_key')||(r->>'text'),'UTF8')),'hex'),'chunk_index',0,'source_kind','document',
    'char_from',0,'char_to',length(r->>'text'),'content',r->>'text','token_count',4,'chunker_version',4)),
  'pages','[]'::jsonb,'sections','[]'::jsonb) $$;
-- A Lok Sabha answer for question row g; t replaces the text (its hash follows), pages its page spans.
create function pg_temp.pq(g int, over jsonb default '{}', t text default null, pages int default 1) returns jsonb language plpgsql as $$
declare txt text := coalesce(t, 'LOK SABHA UNSTARRED QUESTION ' || g || '. ANSWER. A written answer.'); r jsonb;
begin
 r := jsonb_build_object('source_key',pg_temp.pq_key(g),'title','Subject ' || g,'text',txt,
   'text_sha256',encode(sha256(convert_to(txt,'UTF8')),'hex'),'desk_tier','national','desk_feature','Parliamentary Question Database',
   'file_name','AU' || (1000+g) || '_fx.pdf','file_url',pg_temp.pq_url(g),'document_key_suggested','pq:ls:187:AU' || (1000+g) || '_fx',
   'licence_class','gov_open',
   'citation',jsonb_build_object('kind','parliamentary_question','house','Lok Sabha','session','187','subject','Subject ' || g,
     'ministry','MINISTRY OF FIXTURES','answered_on','02.04.2026'),
   'review',jsonb_build_object('status','eligible','checks',jsonb_build_object('identity',true,'completeness',true,'sensitivity',true,'dedupe',true,'rights',true)),
   'pages',(select coalesce(jsonb_agg(jsonb_build_object('page_number',x,'char_from',0,'char_to',0) order by x),'[]') from generate_series(1,pages) x)
 ) || over;
 return pg_temp.req(r);
end $$;
create function pg_temp.item(q jsonb) returns jsonb language sql as $$
 select jsonb_build_object('source_key',(q->>'payload')::jsonb->>'source_key','payload_sha256',q->>'payload_sha256',
  'content_sha256',(q->>'payload')::jsonb->>'text_sha256','chunks',jsonb_array_length(q->'expected'),'est_tokens',10) $$;
-- The manifest hash, written out independently of the migration's ingest_batch_manifest_sha256.
create function pg_temp.manifest(items jsonb) returns text language sql as $$
 select encode(sha256(convert_to(coalesce(string_agg(concat_ws(E'\t', e->>'source_key', e->>'payload_sha256', e->>'content_sha256',
   e->>'chunks', e->>'est_tokens') || E'\n', '' order by e->>'source_key' collate "C"), ''), 'UTF8')), 'hex')
 from jsonb_array_elements(items) e $$;
create function pg_temp.open(c text, items jsonb, cost numeric default 1) returns uuid language plpgsql as $$
declare v jsonb;
begin
 v := pg_temp.i_open(jsonb_build_object('collection',c,'manifest_sha256',pg_temp.manifest(items),'items_planned',jsonb_array_length(items),
   'chunks_planned',(select sum((e->>'chunks')::int) from jsonb_array_elements(items) e),
   'est_tokens',(select sum((e->>'est_tokens')::int) from jsonb_array_elements(items) e),'est_cost_usd',cost,'runner_commit','abcdef1'));
 if v->>'state' is distinct from 'open' or (v->>'existing')::boolean then raise exception 'FAIL open: %', v; end if;
 perform pg_temp.i_add((v->>'batch_id')::uuid, items);
 return (v->>'batch_id')::uuid;
end $$;
-- A sealed batch of one collection over these requests.
-- Each batch's estimates differ (salt), so no two fixture batches share a manifest.
create temp sequence salt start 11;
create function pg_temp.batch(c text, reqs jsonb, cost numeric default 1) returns uuid language plpgsql as $$
declare b uuid; v jsonb;
begin
 b := pg_temp.open(c, (select jsonb_agg(pg_temp.item(q) || jsonb_build_object('est_tokens', nextval('pg_temp.salt'))) from jsonb_array_elements(reqs) q), cost);
 v := pg_temp.i_seal(b);
 if v->>'state' is distinct from 'sealed' then raise exception 'FAIL seal: %', v; end if;
 return b;
end $$;
-- Everything registration may write, and the listing rows it must never change.
create function pg_temp.corpus() returns text language sql as $$
 select concat_ws('/', (select count(*) from public.documents), (select count(*) from public.ingest_text_inputs), (select count(*) from public.ingest_jobs),
  (select count(*) from public.record_document_links), (select count(*) from public.law_publications), (select count(*) from public.law_document_links),
  (select count(*) from public.document_chunks)) $$;
create function pg_temp.listing() returns text language sql as $$
 select md5(coalesce(string_agg(to_jsonb(q)::text, '|' order by tier, feature, row_key), '')) from public.desk_rows q $$;
-- One document of one fresh batch, refused with this reason, writing nothing; recorded unless the
-- verdict is not about the manifest's document. sent (if given) is what is sent instead of q.
create function pg_temp.refusal(c text, q jsonb, want text, recorded boolean default true, sent jsonb default null) returns void language plpgsql as $$
declare before text := pg_temp.corpus(); b uuid := pg_temp.batch(c, jsonb_build_array(q)); res jsonb; it record;
begin
 res := pg_temp.i_reg(b, jsonb_build_array(coalesce(sent, q)));
 if res#>>'{results,0,outcome}' is distinct from 'refused' or res#>>'{results,0,reason}' is distinct from want then
   raise exception 'FAIL refusal %: got %', want, res->'results'; end if;
 if pg_temp.corpus() <> before then raise exception 'FAIL refusal % wrote to the corpus', want; end if;
 select outcome, reason into it from public.ingest_batch_items where batch_id = b;
 if recorded and (it.outcome, it.reason) is distinct from ('refused', want) then raise exception 'FAIL refusal % not recorded: %', want, it; end if;
 if not recorded and it.outcome <> 'planned' then raise exception 'FAIL refusal % recorded a verdict on another document', want; end if;
 raise notice 'PASS refusal % (nothing written)', want;
end $$;

-- ═══ Data ════════════════════════════════════════════════════════════════════

insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database','q' || g,
  jsonb_build_object('id','q' || g,'house','Lok Sabha','date','2026-04-02','ministry','MINISTRY OF FIXTURES','subject','Subject ' || g,
   'mp_name','Member','source_url',pg_temp.pq_url(g)), 'Subject ' || g, now()
from generate_series(1, 80) g;
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at) values
 ('national','Parliamentary Question Database','q1b',jsonb_build_object('id','q1b','house','Lok Sabha','date','2026-04-02','ministry','MINISTRY OF FIXTURES',
   'subject','Subject 1','mp_name','Second Member','source_url',pg_temp.pq_url(1)),'Subject 1',now()),
 ('law','NCLT / NCLAT (Insolvency)','legacy-order','{"title":"Existing Company","court":"NCLT","date":"2026-07-08","source_url":"https://ibbi.gov.in/uploads/order/one.pdf"}','Existing Company',now());
select public.law_seed_listings();
create temp table listing0 as select pg_temp.listing() h;

select pg_temp.ok((pg_temp.policy('national-pq')->>'active')::boolean, 'policy approved by service_role');
select pg_temp.policy('national-pq-strict', jsonb_build_object('require_page_count',true,'licence_classes',jsonb_build_array('gov_open',''),
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','national','desk_feature','Parliamentary Question Database','adapter','lok_sabha_answers','required_checks',jsonb_build_array('title_guard')))));
select pg_temp.policy('national-pq-tight', jsonb_build_object('stop_thresholds',jsonb_build_object('refusal_share',0.4,'failure_rate',1,'uncertain_max',1,'min_decided',2)));
select pg_temp.policy('national-pq-tiny', jsonb_build_object('budget_usd',0.5));
select pg_temp.policy('national-pq-off', jsonb_build_object('active',false));
select pg_temp.policy('law-nclt', jsonb_build_object('licence_classes',jsonb_build_array(''),
  'admitted',jsonb_build_array(jsonb_build_object('desk_tier','law','desk_feature','NCLT / NCLAT (Insolvency)','adapter','law'))));
select pg_temp.refused($q$select pg_temp.policy('mixed', jsonb_build_object('admitted',jsonb_build_array(
  jsonb_build_object('desk_tier','law','desk_feature','NCLT / NCLAT (Insolvency)','adapter','law'),
  jsonb_build_object('desk_tier','national','desk_feature','Parliamentary Question Database','adapter','lok_sabha_answers'))))$q$, 'one adapter');
select pg_temp.refused($q$select pg_temp.policy('personal', jsonb_build_object('licence_classes',jsonb_build_array('eci_govt_PERSONAL_DATA_G02')))$q$, 'personal-data');
select pg_temp.refused($q$select pg_temp.policy('bills', jsonb_build_object('admitted',jsonb_build_array(
  jsonb_build_object('desk_tier','national','desk_feature','Bill Passage Probability Index','adapter','lok_sabha_answers'))))$q$, 'invalid admitted desk');
select pg_temp.refused($q$select pg_temp.policy('nodecision', jsonb_build_object('evidence_sha256','x'))$q$, 'decision_id, approver and evidence_sha256');
select pg_temp.refused($q$select pg_temp.policy('nostop', jsonb_build_object('stop_thresholds',jsonb_build_object('refusal_share',0.5)))$q$, 'stop_thresholds');

-- ═══ The manifest: one definition for the runner and the database ═══════════

-- The vector src/lib/batchManifest.test.js asserts for the runner's manifestSha256.
create temp table vector as select jsonb_build_array(
 jsonb_build_object('source_key','law:é','payload_sha256',repeat('a',64),'content_sha256',repeat('b',64),'chunks',3,'est_tokens',40),
 jsonb_build_object('source_key','law:b','payload_sha256',repeat('c',64),'content_sha256',repeat('d',64),'chunks',1,'est_tokens',0),
 jsonb_build_object('source_key','Law:Z','payload_sha256',repeat('e',64),'content_sha256',repeat('f',64),'chunks',800,'est_tokens',12345),
 jsonb_build_object('source_key','law:😀','payload_sha256',repeat('1',64),'content_sha256',repeat('2',64),'chunks',2,'est_tokens',7),
 jsonb_build_object('source_key','law:Ａ','payload_sha256',repeat('3',64),'content_sha256',repeat('4',64),'chunks',2,'est_tokens',7)) items;
create temp table vb as select pg_temp.open('national-pq', items) b from vector;
select pg_temp.ok((select public.ingest_batch_manifest_sha256(b) from vb) = '06910be15a15ab724eb843bc55e62251dbe7e24879ee6293838ca10f89310a8a',
  'manifest hash equals the runner''s (byte order, astral characters)');
select pg_temp.ok((select pg_temp.i_seal(b)->>'state' from vb) = 'sealed', 'a manifest whose hash matches seals');
select pg_temp.ok((select pg_temp.i_seal(b)->>'already' from vb) = 'true', 'sealing twice is idempotent');
select pg_temp.refused($q$select pg_temp.i_add((select b from vb), '[{"source_key":"x","payload_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","content_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","chunks":1,"est_tokens":1}]')$q$, 'not open');

-- Open: a policy is required and active; one manifest is one batch.
select pg_temp.ok(pg_temp.i_open(jsonb_build_object('collection','nobody','manifest_sha256',repeat('1',64),'items_planned',1,'chunks_planned',1,'est_tokens',1,'est_cost_usd',1,'runner_commit','abcdef1'))->>'refused' = 'no_collection_policy', 'open refuses no_collection_policy');
select pg_temp.ok(pg_temp.i_open(jsonb_build_object('collection','national-pq-off','manifest_sha256',repeat('1',64),'items_planned',1,'chunks_planned',1,'est_tokens',1,'est_cost_usd',1,'runner_commit','abcdef1'))->>'refused' = 'policy_inactive', 'open refuses policy_inactive');
select pg_temp.ok((select pg_temp.i_open(jsonb_build_object('collection','national-pq','manifest_sha256',pg_temp.manifest(items),'items_planned',5,'chunks_planned',808,'est_tokens',12399,'est_cost_usd',1,'runner_commit','abcdef1'))
   = jsonb_build_object('batch_id',(select b from vb),'state','sealed','existing',true) from vector), 'the same manifest returns its batch');
select pg_temp.ok((select pg_temp.i_open(jsonb_build_object('collection','law-nclt','manifest_sha256',pg_temp.manifest(items),'items_planned',5,'chunks_planned',808,'est_tokens',12399,'est_cost_usd',1,'runner_commit','abcdef1'))->>'refused' from vector) = 'manifest_exists',
  'open refuses manifest_exists for another collection');
select pg_temp.refused($q$select pg_temp.i_open('{"collection":"national-pq","manifest_sha256":"bad","items_planned":1,"chunks_planned":1,"est_tokens":1,"est_cost_usd":1,"runner_commit":"abcdef1"}')$q$, 'required');
select pg_temp.refused($q$select pg_temp.i_open(jsonb_build_object('collection','national-pq','manifest_sha256',repeat('2',64),'items_planned',10001,'chunks_planned',1,'est_tokens',1,'est_cost_usd',1,'runner_commit','abcdef1'))$q$, 'items_planned 1-10000');

-- Seal refusals write nothing and leave the batch open.
create temp table seal_cases(label text, b uuid);
insert into seal_cases select 'hash', (pg_temp.i_open(jsonb_build_object('collection','national-pq','manifest_sha256',repeat('3',64),'items_planned',1,'chunks_planned',1,'est_tokens',10,'est_cost_usd',1,'runner_commit','abcdef1'))->>'batch_id')::uuid;
select pg_temp.i_add(b, jsonb_build_array(pg_temp.item(pg_temp.pq(70)))) from seal_cases where label='hash';
select pg_temp.ok((select pg_temp.i_seal(b)->>'refused' from seal_cases where label='hash') = 'manifest_hash_mismatch', 'seal refuses manifest_hash_mismatch');
insert into seal_cases select 'dup', pg_temp.open('national-pq', jsonb_build_array(pg_temp.item(pg_temp.pq(71)),
  pg_temp.item(pg_temp.pq(72, '{}', 'LOK SABHA UNSTARRED QUESTION 71. ANSWER. A written answer.'))));
select pg_temp.ok((select pg_temp.i_seal(b)->>'refused' from seal_cases where label='dup') = 'manifest_duplicate_text', 'seal refuses manifest_duplicate_text');
insert into seal_cases select 'ceiling', pg_temp.open('national-pq-tiny', jsonb_build_array(pg_temp.item(pg_temp.pq(73))), 1);
select pg_temp.ok((select pg_temp.i_seal(b)->>'refused' from seal_cases where label='ceiling') = 'over_policy_ceiling', 'seal refuses over_policy_ceiling');
select pg_temp.ok((select bool_and(state='open') from public.ingest_batches where id in (select b from seal_cases)), 'refused seals stay open');

-- ═══ Admission and the named refusals ════════════════════════════════════════

create temp table first_call as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(1), pg_temp.pq(2))) b;
create temp table first_res as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(1), pg_temp.pq(2))) r from first_call;
select pg_temp.ok((select r#>>'{results,0,outcome}'='admitted' and r#>>'{results,1,outcome}'='admitted' and (r#>>'{results,0,links}')::int=2
   and (r#>>'{results,1,links}')::int=1 and (r->>'written')::boolean from first_res), 'two answers admitted with their links');
select pg_temp.ok((select count(*) from public.record_document_links)=3 and (select count(*) from public.documents)=2, 'documents and links committed together');
select pg_temp.ok((select bool_and(j.batch_id = (select b from first_call) and j.status='queued' and j.input_kind='supplied_text' and j.stage='index' and j.requested_by is null)
   from public.ingest_jobs j), 'jobs queued with their batch and no person behind them');
select pg_temp.ok((select r#>>'{batch,state}' from first_res) = 'registered', 'every item decided: registered');
select pg_temp.ok((select string_agg(outcome || ':' || (document_id is not null) || ':' || (job_id is not null), ',' order by source_key) from public.ingest_batch_items where batch_id=(select b from first_call))
  = 'admitted:true:true,admitted:true:true', 'ledger records each admission with its document and job');

-- Carried-over refusals (design 2).
select pg_temp.refusal('national-pq', pg_temp.pq(3), 'bad_payload', false, (pg_temp.pq(3) - 'payload') || jsonb_build_object('payload',repeat('x',10),'payload_sha256',encode(sha256(convert_to(repeat('x',10),'UTF8')),'hex')));
select pg_temp.refusal('national-pq', pg_temp.pq(3), 'bad_payload', false, '[1]'::jsonb);
select pg_temp.refusal('national-pq', pg_temp.pq(3), 'payload_hash_mismatch', false, pg_temp.pq(3) || '{"payload_sha256":"bad"}');
select pg_temp.refusal('national-pq', pg_temp.pq(3, jsonb_build_object('text_sha256',repeat('0',64))), 'invalid_source_or_text_hash');
select pg_temp.refusal('national-pq', pg_temp.pq(3, '{"review":{"status":"held"}}'), 'invalid_source_or_text_hash');
select pg_temp.refusal('national-pq', pg_temp.pq(3, '{"file_url":"https://example.org/AU1003_fx.pdf"}'), 'invalid_source_or_text_hash');
select pg_temp.refusal('national-pq', pg_temp.pq(3), 'bad_chunks', true, pg_temp.pq(3) || '{"expected":{}}');
select pg_temp.refusal('national-pq', pg_temp.pq(3), 'duplicate_or_invalid_chunks', true,
  jsonb_set(pg_temp.pq(3), '{expected,0,chunk_hash}', '"not-a-hash"'));
-- Same key: the same payload is existing; another payload is immutable; a non-supplied row is legacy.
create temp table again as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(1))) b;
create temp table again_r as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(1))) r from again;
select pg_temp.ok((select r#>>'{results,0,outcome}'='existing' and r#>>'{results,0,document_id}'=(select r#>>'{results,0,document_id}' from first_res)
    and r#>>'{results,0,job_status}'='queued' from again_r)
  and (select outcome from public.ingest_batch_items where batch_id=(select b from again))='existing', 'same key, same payload: existing, recorded');
select pg_temp.refusal('national-pq', pg_temp.pq(1, '{"title":"Another title"}'), 'immutable_conflict');
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text)
 values (pg_temp.pq_key(4),'Imported by ingest-documents','national','Parliamentary Question Database',repeat('5',64),'legacy text');
select pg_temp.refusal('national-pq', pg_temp.pq(4), 'legacy_source');
create temp table no_job as select pg_temp.pq(5) q;
insert into public.documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 select 'b0000000-0000-4000-8000-000000000005',pg_temp.pq_key(5),'No job','national','Parliamentary Question Database',(q->>'payload')::jsonb->>'text_sha256',
  (q->>'payload')::jsonb->>'text','{"origin":"supplied-text"}' from no_job;
insert into public.ingest_text_inputs(document_id,payload,payload_sha256,expected)
 select 'b0000000-0000-4000-8000-000000000005',q->>'payload',q->>'payload_sha256',q->'expected' from no_job;
select pg_temp.refusal('national-pq', (select q from no_job), 'missing_job');
-- F266 (pq_admission_links), each a named reason.
select pg_temp.refusal('national-pq', pg_temp.pq(6, '{"document_key_suggested":"pq:ls:187:AU9999_other"}'), 'answer_key_conflict');
select pg_temp.refusal('national-pq', pg_temp.pq(7, jsonb_build_object('citation',jsonb_build_object('house','Rajya Sabha','subject','Subject 7','ministry','MINISTRY OF FIXTURES','answered_on','02.04.2026'))), 'house_conflict');
select pg_temp.refusal('national-pq', pg_temp.pq(8, jsonb_build_object('citation',jsonb_build_object('house','Lok Sabha','subject','Other','ministry','MINISTRY OF FIXTURES','answered_on','02.04.2026'))), 'subject_conflict');
select pg_temp.refusal('national-pq', pg_temp.pq(9, jsonb_build_object('citation',jsonb_build_object('house','Lok Sabha','subject','Subject 9','ministry','MINISTRY OF FIXTURES','answered_on','03.04.2026'))), 'date_conflict');
select pg_temp.refusal('national-pq', pg_temp.pq(10, jsonb_build_object('citation',jsonb_build_object('house','Lok Sabha','subject','Subject 10','ministry','OTHER','answered_on','02.04.2026'))), 'ministry_conflict');
insert into public.documents(source_key,title,file_url,desk_tier,desk_feature,content_sha256,ocr_text)
 values (repeat('9',40),'URL variant copy',replace(pg_temp.pq_url(11),'?source=pqals',''),'national','Parliamentary Question Database',repeat('8',64),'x');
select pg_temp.refusal('national-pq', pg_temp.pq(11), 'file_url_held');
insert into public.documents(source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,metadata)
 values (repeat('e',40),'Older pack copy','national','Parliamentary Question Database',repeat('f',64),'x',
  '{"source_path":"01 Legislative & Policy Intelligence/Parliamentary Question Database/PDFs/187_AU1012_fx.pdf"}');
select pg_temp.refusal('national-pq', pg_temp.pq(12), 'answer_held');
select pg_temp.refusal('national-pq', pg_temp.pq(99), 'no_desk_row');
-- The manifest, the adapter and the collection.
select pg_temp.refusal('national-pq', pg_temp.pq(13), 'not_in_manifest', false, pg_temp.pq(14));
select pg_temp.refusal('national-pq', pg_temp.pq(13), 'manifest_mismatch', false, pg_temp.pq(13, '{"title":"Changed after sealing"}'));
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"desk_feature":"Bill Passage Probability Index"}'), 'no_adapter');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"desk_tier":"law","source_key":"law:hc:in-a-question-batch","desk_feature":"NCLT / NCLAT (Insolvency)"}'), 'collection_not_admitted');
-- Policy and text-quality gates (design 2, 6).
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"licence_class":"eci_govt_PERSONAL_DATA_G02"}'), 'licence_not_admitted');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"licence_class":"not_listed"}'), 'licence_not_admitted');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"servable":false}'), 'not_servable');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"n_chars":1}'), 'n_chars_mismatch');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"n_pages":3}'), 'page_count_mismatch');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{"page_count":0}'), 'page_count_mismatch');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{}', E'ANSWER with a shifted \x01 font'), 'control_codes');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{}', E'ANSWER with a delete \x7F code'), 'control_codes');
select pg_temp.refusal('national-pq', pg_temp.pq(13, '{}', repeat('t', 2999), 5), 'thin_text');
select pg_temp.refusal('national-pq-strict', pg_temp.pq(13), 'review_incomplete');
select pg_temp.refusal('national-pq-strict', pg_temp.pq(13, jsonb_build_object('pages','[]'::jsonb,'review',jsonb_build_object('status','eligible',
  'checks',jsonb_build_object('identity',true,'completeness',true,'sensitivity',true,'dedupe',true,'rights',true,'title_guard',true)))), 'no_page_count');
-- At the boundary: exactly 600 characters a page over 5 pages passes; tab, LF and CR are not control codes.
create temp table gates as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(15, '{}', repeat('t', 3000), 5),
  pg_temp.pq(16, '{}', E'ANSWER\twith\nordinary\r\nwhitespace'), pg_temp.pq(17, '{"servable":true,"n_chars":12,"n_pages":4}', 'ANSWER ok 17', 4))) b;
select pg_temp.ok((select r->'totals'->>'admitted' from (select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(15, '{}', repeat('t', 3000), 5),
  pg_temp.pq(16, '{}', E'ANSWER\twith\nordinary\r\nwhitespace'), pg_temp.pq(17, '{"servable":true,"n_chars":12,"n_pages":4}', 'ANSWER ok 17', 4))) r from gates) x) = '3',
  'gate boundaries admit: 600 a page, whitespace, servable true, declared counts equal');
-- Batch state refusals.
create temp table unsealed as select pg_temp.open('national-pq', jsonb_build_array(pg_temp.item(pg_temp.pq(18)))) b;
select pg_temp.ok((select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(18)))#>>'{results,0,reason}' from unsealed) = 'batch_not_sealed', 'register refuses batch_not_sealed');
create temp table stopped as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(19))) b;
select pg_temp.ok((select pg_temp.i_stop(b, 'operator_hold')->>'state' from stopped) = 'stopped', 'the runner can stop its batch');
select pg_temp.ok((select pg_temp.i_stop(b, 'again')->>'stop_reason' from stopped) = 'operator_hold', 'stop is idempotent and keeps the first reason');
create temp table stopped_r as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(19))) r from stopped;
select pg_temp.ok((select r#>>'{results,0,reason}' from stopped_r) = 'batch_stopped'
  and not exists(select 1 from public.documents where source_key = pg_temp.pq_key(19)), 'register refuses batch_stopped and writes nothing');
select pg_temp.refused($q$select pg_temp.i_reg((select b from first_call), jsonb_build_array(pg_temp.pq(1), pg_temp.pq(1)))$q$, 'more than once');

-- Law (law_listing): admitted with its publication intent, held, and stale.
create function pg_temp.law(k text, u text, over jsonb default '{}', fp text default null) returns jsonb language plpgsql as $$
declare t text := 'A court order for ' || k || '.'; r jsonb; q jsonb;
begin
 r := jsonb_build_object('source_key',k,'title','Future Company','text',t,'text_sha256',encode(sha256(convert_to(t,'UTF8')),'hex'),
  'file_url',u,'desk_tier','law','desk_feature','NCLT / NCLAT (Insolvency)',
  'citation',jsonb_build_object('kind','tribunal_order','forum','NCLT','source','IBBI_NCLT','case_number','CP/1/2026','order_date','2026-07-08'),
  'review',jsonb_build_object('status','eligible','source_key',k,'text_sha256',encode(sha256(convert_to(t,'UTF8')),'hex'),
   'rules_sha256',repeat('c',64),'package_id','fixture-pack','mapping_version','1','decision_id','fixture-approved',
   'checks','{"identity":true,"completeness":true,"sensitivity":true,"dedupe":true,"rights":true}'::jsonb)) || over;
 q := pg_temp.req(r);
 return q || jsonb_build_object('mapping_fingerprint',coalesce(fp, public.law_reconcile(jsonb_build_object('record',r))->>'fingerprint'));
end $$;
create temp table law_b as select pg_temp.batch('law-nclt', jsonb_build_array(pg_temp.law('law:trib:IBBI_NCLT:one','https://ibbi.gov.in/uploads/order/one.pdf'),
  pg_temp.law('law:hc:unsupported','https://ibbi.gov.in/uploads/order/unsupported.pdf'),
  pg_temp.law('law:trib:IBBI_NCLT:two','https://ibbi.gov.in/uploads/order/two.pdf', '{}', repeat('0',64)))) b;
create temp table law_before as select pg_temp.corpus() c;
create temp table law_res as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.law('law:trib:IBBI_NCLT:one','https://ibbi.gov.in/uploads/order/one.pdf'),
  pg_temp.law('law:hc:unsupported','https://ibbi.gov.in/uploads/order/unsupported.pdf'),
  pg_temp.law('law:trib:IBBI_NCLT:two','https://ibbi.gov.in/uploads/order/two.pdf', '{}', repeat('0',64)))) r from law_b;
select pg_temp.ok((select r#>>'{results,0,outcome}' from law_res)='admitted'
  and (select status from public.law_publications where document_id=(select (r#>>'{results,0,document_id}')::uuid from law_res))='pending', 'Law admitted with its publication intent');
select pg_temp.ok((select r#>>'{results,1,reason}'='law_admission_held' and r#>'{results,1,detail}' ? 'unsupported_or_incomplete_identity' from law_res), 'refusal law_admission_held, with law_reconcile''s reasons');
select pg_temp.ok((select r#>>'{results,2,reason}' from law_res)='stale_mapping', 'refusal stale_mapping');
select pg_temp.ok((select count(*) from public.documents where source_key in ('law:hc:unsupported','law:trib:IBBI_NCLT:two'))=0
  and (select count(*) from public.law_publications)=1, 'held and stale Law documents wrote nothing');
-- An alias of an admitted order (same file, another key) in a later call is held, not admitted.
create temp table law_alias as select pg_temp.batch('law-nclt', jsonb_build_array(pg_temp.law('law:trib:IBBI_NCLT:alias','https://ibbi.gov.in/uploads/order/one.pdf'))) b;
select pg_temp.ok((select pg_temp.i_reg(b, jsonb_build_array(pg_temp.law('law:trib:IBBI_NCLT:alias','https://ibbi.gov.in/uploads/order/one.pdf')))#>>'{results,0,reason}' from law_alias) = 'law_admission_held',
  'a second key for one Law file is held');

-- ═══ Duplicate text (design 3) ═══════════════════════════════════════════════

-- Holders of three texts under other keys, in three states: indexed, queued and failed.
insert into public.documents(id,source_key,title,desk_tier,desk_feature,content_sha256,ocr_text,indexed_at) values
 ('c0000000-0000-4000-8000-000000000001','legacy:indexed','Indexed holder','law','Order Archive by Topic (Cross-Court)',
   encode(sha256(convert_to('HELD TEXT indexed','UTF8')),'hex'),'HELD TEXT indexed',now()),
 ('c0000000-0000-4000-8000-000000000002','legacy:queued','Queued holder','law','Order Archive by Topic (Cross-Court)',
   encode(sha256(convert_to('HELD TEXT queued','UTF8')),'hex'),'HELD TEXT queued',null),
 ('c0000000-0000-4000-8000-000000000003','legacy:failed','Failed holder','law','Order Archive by Topic (Cross-Court)',
   encode(sha256(convert_to('HELD TEXT failed','UTF8')),'hex'),'HELD TEXT failed',null),
 ('c0000000-0000-4000-8000-000000000004','upload:placeholder','PDF placeholder','national','Parliamentary Question Database',
   encode(sha256(''::bytea),'hex'),'',null);
insert into public.ingest_jobs(document_id,status,stage,file_sha256,pages_total) values
 ('c0000000-0000-4000-8000-000000000002','queued','ocr',repeat('a',64),1),
 ('c0000000-0000-4000-8000-000000000003','failed','ocr',repeat('a',64),1);
select pg_temp.refusal('national-pq', pg_temp.pq(20, '{}', 'HELD TEXT indexed'), 'duplicate_text');
select pg_temp.refusal('national-pq', pg_temp.pq(20, '{}', 'HELD TEXT queued'), 'duplicate_text');
select pg_temp.refusal('national-pq', pg_temp.pq(20, '{}', 'HELD TEXT failed'), 'duplicate_text');
create temp table dup_b as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(20, '{}', 'HELD TEXT indexed'))) b;
select pg_temp.ok((select r#>>'{results,0,detail,holder_document_id}'='c0000000-0000-4000-8000-000000000001'
    and r#>>'{results,0,detail,holder_source_key}'='legacy:indexed' and r::text not like '%HELD TEXT%'
  from (select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(20, '{}', 'HELD TEXT indexed'))) r from dup_b) x), 'duplicate_text names its holder, never the text');
-- Against an admitted batch document under another key (a text of the first call).
select pg_temp.refusal('national-pq', pg_temp.pq(21, '{}', 'LOK SABHA UNSTARRED QUESTION 2. ANSWER. A written answer.'), 'duplicate_text');
-- The empty-text hash of pending uploads holds nothing.
select pg_temp.ok((select jsonb_array_length(pg_temp.i_holders(array[encode(sha256(''::bytea),'hex')])))=0, 'empty-text placeholders are not holders');
select pg_temp.ok(pg_temp.i_holders(array[encode(sha256(convert_to('HELD TEXT queued','UTF8')),'hex'), repeat('0',64)])
  = jsonb_build_array(jsonb_build_object('content_sha256',encode(sha256(convert_to('HELD TEXT queued','UTF8')),'hex'),'source_key','legacy:queued',
    'document_id','c0000000-0000-4000-8000-000000000002')), 'ingest_text_holders returns hashes, keys and ids only');
select pg_temp.refused($q$select pg_temp.i_holders(array_fill('x'::text, array[10001]))$q$, 'at most 10000');

-- ═══ Dry run, replay, all-or-nothing ═════════════════════════════════════════

create temp table mixed as select jsonb_build_array(pg_temp.pq(22), pg_temp.pq(23, jsonb_build_object('citation',jsonb_build_object('house','Rajya Sabha',
  'subject','Subject 23','ministry','MINISTRY OF FIXTURES','answered_on','02.04.2026'))), pg_temp.pq(1), pg_temp.pq(24, '{}', 'HELD TEXT failed')) docs;
create temp table mixed_b as select pg_temp.batch('national-pq', docs) b from mixed;
create temp table snap as select pg_temp.corpus() c, (select string_agg(outcome, ',' order by source_key) from public.ingest_batch_items where batch_id=(select b from mixed_b)) l;
create temp table dry as select pg_temp.i_reg(b, (select docs from mixed), true) r from mixed_b;
select pg_temp.ok((select pg_temp.corpus() from snap) = (select c from snap)
  and (select string_agg(outcome, ',' order by source_key) from public.ingest_batch_items where batch_id=(select b from mixed_b)) = (select l from snap)
  and (select state from public.ingest_batches where id=(select b from mixed_b)) = 'sealed', 'a dry run writes nothing: no document, job, link or ledger change');
select pg_temp.ok((select (r->>'dry_run')::boolean and not (r->>'written')::boolean from dry), 'a dry run says so');
create temp table real as select pg_temp.i_reg(b, (select docs from mixed)) r from mixed_b;
select pg_temp.ok((select string_agg(coalesce(nullif(d->>'outcome','would_admit'),'admitted') || ':' || coalesce(d->>'reason',''), ',' order by n)
                     from dry, jsonb_array_elements(r->'results') with ordinality x(d, n))
  = (select string_agg((d->>'outcome') || ':' || coalesce(d->>'reason',''), ',' order by n) from real, jsonb_array_elements(r->'results') with ordinality x(d, n)),
  'dry-run outcomes equal the real ones, document by document');
select pg_temp.ok((select string_agg(d->>'outcome' || ':' || coalesce(d->>'reason',''), ',' order by n) from real, jsonb_array_elements(r->'results') with ordinality x(d, n))
  = 'admitted:,refused:house_conflict,existing:,refused:duplicate_text', 'the mixed call: admitted, refused, existing, refused');
create temp table snap2 as select pg_temp.corpus() c, (select string_agg(outcome || coalesce(reason,'') || coalesce(document_id::text,''), ',' order by source_key)
  from public.ingest_batch_items where batch_id=(select b from mixed_b)) l, (select r->'batch' from real) bt;
create temp table replay as select pg_temp.i_reg(b, (select docs from mixed)) r from mixed_b;
select pg_temp.ok((select string_agg(d->>'outcome' || ':' || coalesce(d->>'reason',''), ',' order by n) from replay, jsonb_array_elements(r->'results') with ordinality x(d, n))
  = 'existing:,refused:house_conflict,existing:,refused:duplicate_text'
  and (select (r#>>'{results,1,replayed}')::boolean from replay), 'replaying the whole call: existing, and the recorded refusals');
select pg_temp.ok((select pg_temp.corpus() from snap2) = (select c from snap2)
  and (select string_agg(outcome || coalesce(reason,'') || coalesce(document_id::text,''), ',' order by source_key) from public.ingest_batch_items where batch_id=(select b from mixed_b)) = (select l from snap2)
  and (select r->'batch' from replay) = (select bt from snap2), 'a replay changes no row and no ledger count');
select pg_temp.ok((select r#>>'{results,0,document_id}' from replay) = (select r#>>'{results,0,document_id}' from real), 'a replay returns the stored document');
-- All or nothing: one refusal and nothing is written.
create temp table aon as select jsonb_build_array(pg_temp.pq(25), pg_temp.pq(98)) docs;
create temp table aon_b as select pg_temp.batch('national-pq', docs) b from aon;
create temp table aon_before as select pg_temp.corpus() c;
create temp table aon_r as select pg_temp.i_reg(b, (select docs from aon), false, true) r from aon_b;
select pg_temp.ok((select r#>>'{results,0,outcome}'='would_admit' and r#>>'{results,1,reason}'='no_desk_row' and not (r->>'written')::boolean from aon_r)
  and pg_temp.corpus() = (select c from aon_before)
  and (select bool_and(outcome='planned') from public.ingest_batch_items where batch_id=(select b from aon_b)), 'all or nothing: one refusal, nothing written');
select pg_temp.ok((select r->'totals' from (select pg_temp.i_reg(b, (select docs from aon)) r from aon_b) x)
  = '{"admitted":1,"existing":0,"refused":1,"would_admit":0,"by_reason":{"no_desk_row":1}}', 'without it the admissible document commits');
-- The thin scan is listed for the OCR route with its official file.
create temp table thin_b as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(26, '{}', repeat('t', 100), 5))) b;
select pg_temp.ok((select r->'ocr_route' from (select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(26, '{}', repeat('t', 100), 5))) r from thin_b) x)
  = jsonb_build_array(jsonb_build_object('source_key',pg_temp.pq_key(26),'file_url',pg_temp.pq_url(26))), 'thin_text documents are listed for the OCR route');

select pg_temp.ok((select h from listing0) = pg_temp.listing(), 'registration never changed a listing row');

-- ═══ Stop rules and the claim (design 4.5) ═══════════════════════════════════

-- Refusal share: 2 of 3 refused for one reason > 0.4 stops the batch; nothing of it is claimed.
create temp table tight as select pg_temp.batch('national-pq-tight', jsonb_build_array(pg_temp.pq(27), pg_temp.pq(97), pg_temp.pq(96))) b;
select pg_temp.ok((select r#>>'{batch,state}'='stopped' and r#>>'{batch,stop_reason}'='refusal_share:no_desk_row'
  from (select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(27), pg_temp.pq(97), pg_temp.pq(96))) r from tight) x), 'a refusal share over the threshold stops the batch');

-- Clear the queue of earlier sections, then claims see only what each case sets up.
update public.ingest_jobs set status='cancelled', claim_token=null, lease_until=null where status in ('queued','running');
create temp table claimable as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(30), pg_temp.pq(31), pg_temp.pq(32), pg_temp.pq(33))) b;
select (pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(30), pg_temp.pq(31), pg_temp.pq(32), pg_temp.pq(33)))->'totals'->>'admitted') from claimable;
create temp table single as select public.ingest_register_text(pg_temp.pq(34)) r;
update public.ingest_jobs set next_attempt_at = now() - interval '1 minute' where id = (select (r->>'job_id')::uuid from single);
update public.ingest_settings set max_running = 5, claim_batch = 3;
create temp table c1 as select * from public.ingest_claim(5, interval '5 minutes');
select pg_temp.ok((select count(*)=1 and bool_and(batch_id is null) from c1), 'a claim never mixes batch and non-batch jobs');
create temp table c2 as select * from public.ingest_claim(5, interval '5 minutes');
select pg_temp.ok((select count(*)=3 and bool_and(batch_id=(select b from claimable)) from c2), 'claim_batch caps a batch claim at 3, all of one batch');
create temp table c3 as select * from public.ingest_claim(5, interval '5 minutes');
select pg_temp.ok((select count(*) from c3)=1, 'max_running caps the claim (5 running)');
update public.ingest_jobs set status='cancelled', claim_token=null, lease_until=null where status in ('queued','running');
-- A stopped batch's queued job is not claimed; a job without a batch still is.
create temp table halted as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(35))) b;
select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(35))) from halted;
select pg_temp.i_stop(b, 'operator_hold') from halted;
select pg_temp.ok((select count(*) from public.ingest_claim(1, interval '5 minutes'))=0, 'a stopped batch''s queued job is not claimed');
-- Over the spend reservation: the batch is stopped, its job not claimed.
create temp table spent as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(36), pg_temp.pq(37)), 1) b;
create temp table spent_r as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(36), pg_temp.pq(37))) r from spent;
update public.ingest_jobs set status='succeeded', stage='done', embed_cost_usd=1, finished_at=now() where id=(select (r#>>'{results,0,job_id}')::uuid from spent_r);
create temp table spent_c as select count(*) n from public.ingest_claim(1, interval '5 minutes');
select pg_temp.ok((select n from spent_c)=0
  and (select state='stopped' and stop_reason='spend_ceiling' from public.ingest_batches where id=(select b from spent)), 'a batch at its spend reservation is stopped and not claimed');
create temp table other as select public.ingest_register_text(pg_temp.pq(38)) r;
select pg_temp.ok((select array_agg(id) from public.ingest_claim(1, interval '5 minutes')) = (select array[(r->>'job_id')::uuid] from other), 'jobs without a batch are claimed meanwhile');
update public.ingest_jobs set status='cancelled', claim_token=null, lease_until=null where status in ('queued','running');
-- The failure rate (failure_rate 0.4, min_decided 2): one failed of two decided stops the batch.
select pg_temp.policy('national-pq-fragile', jsonb_build_object('stop_thresholds',jsonb_build_object('refusal_share',1,'failure_rate',0.4,'uncertain_max',1,'min_decided',2)));
create temp table fragile as select pg_temp.batch('national-pq-fragile', jsonb_build_array(pg_temp.pq(41), pg_temp.pq(42), pg_temp.pq(43))) b;
create temp table fragile_r as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(41), pg_temp.pq(42), pg_temp.pq(43))) r from fragile;
update public.ingest_jobs set status='succeeded', stage='done', finished_at=now() where id=(select (r#>>'{results,0,job_id}')::uuid from fragile_r);
update public.ingest_jobs set status='failed', error_code='embed_failed', finished_at=now() where id=(select (r#>>'{results,1,job_id}')::uuid from fragile_r);
create temp table fragile_c as select count(*) n from public.ingest_claim(1, interval '5 minutes');
select pg_temp.ok((select n from fragile_c)=0
  and (select stop_reason from public.ingest_batches where id=(select b from fragile))='failure_rate', 'a failure rate over the threshold stops the batch');

-- Requeue once; a second uncertain outcome stops the batch; resuming is service_role's, recorded.
create temp table rq as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(39))) b;
create temp table rq_r as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(39))) r from rq;
create temp table rq_claim as select * from public.ingest_claim(1, interval '5 minutes');
update public.ingest_jobs set lease_until = now() - interval '1 second' where id = (select id from rq_claim);
select count(*) from public.ingest_claim(1, interval '5 minutes');
select pg_temp.ok((select status='failed' and error_code='text_outcome_uncertain' from public.ingest_jobs where id=(select id from rq_claim)), 'an expired claim is uncertain');
create temp table rq1 as select pg_temp.i_requeue(b, array[(select id from rq_claim)]) r from rq;
select pg_temp.ok((select r#>>'{results,0,outcome}' from rq1) = 'requeued'
  and (select status from public.ingest_jobs where id=(select id from rq_claim))='queued', 'an uncertain job is requeued once');
update public.ingest_jobs set status='failed', error_code='text_outcome_uncertain', finished_at=now() where id=(select id from rq_claim);
create temp table rq2 as select pg_temp.i_requeue(b, array[(select id from rq_claim)]) r from rq;
select pg_temp.ok((select r#>>'{results,0,reason}' from rq2) = 'uncertain_after_requeue'
  and (select state='stopped' and stop_reason='uncertain_after_requeue' from public.ingest_batches where id=(select b from rq))
  and (select status from public.ingest_jobs where id=(select id from rq_claim))='failed', 'uncertain after its one requeue: the batch stops');
select pg_temp.ok((select pg_temp.i_requeue(b, array[gen_random_uuid()])#>>'{results,0,reason}' from rq) = 'batch_stopped', 'a stopped batch requeues nothing');
set local role corpus_ingest;
select pg_temp.refused($q$select public.ingest_batch_resume((select b from rq), '{}')$q$, 'permission denied');
reset role;
select pg_temp.refused($q$select pg_temp.svc(format('select public.ingest_batch_resume(%L, %L)', (select b from rq), '{}'))$q$, 'decision_id');
create temp table resumed as select pg_temp.svc(format('select public.ingest_batch_resume(%L, %L)', (select b from rq),
   jsonb_build_object('decision_id','fixture-resume','approver','Fixture Owner','evidence_sha256',repeat('d',64))::text)) r;
select pg_temp.ok((select r->>'state' from resumed) = 'registered'
  and (select string_agg(event, ',' order by id) from public.ingest_batch_events where batch_id=(select b from rq)) = 'requeued,stopped,resumed',
  'service_role resumes to the state it stopped from, and every step is recorded');

-- Status, and the forward-only states: registered -> indexing -> indexed.
update public.ingest_jobs set status='cancelled', claim_token=null, lease_until=null where status in ('queued','running');
create temp table idx as select pg_temp.batch('national-pq', jsonb_build_array(pg_temp.pq(40))) b;
create temp table idx_r as select pg_temp.i_reg(b, jsonb_build_array(pg_temp.pq(40))) r from idx;
select pg_temp.ok((select pg_temp.i_status(b)->>'state' from idx) = 'registered', 'status: registered');
create temp table idx_claim as select * from public.ingest_claim(1, interval '5 minutes');
select pg_temp.ok((select batch_id from idx_claim) = (select b from idx), 'the batch job is claimed');
select pg_temp.ok((select pg_temp.i_status(b)->>'state' from idx) = 'indexing', 'status: indexing once a job started');
select public.ingest_text_commit(id, claim_token, jsonb_build_array((pg_temp.pq(40)->'expected'->0) || jsonb_build_object('embedding',to_jsonb(array_fill(0.01::real,array[1536])))))
  from idx_claim;
select public.ingest_text_activate(id, claim_token, 10, 0.0002) from idx_claim;
create temp table idx_s as select pg_temp.i_status(b, array[pg_temp.pq_key(40)]) s from idx;
select pg_temp.ok((select s->>'state'='indexed' and (s->>'indexed')::int=1 and s#>>'{items,0,job_status}'='succeeded' and (s#>>'{items,0,indexed}')::boolean
  and (s#>>'{jobs,tokens}')::int=10 and (s#>>'{counts,admitted}')::int=1 from idx_s), 'status: indexed, with the item, its job and the spend');
select pg_temp.ok((select pg_temp.i_status(b)->>'items' from idx) is null, 'status without keys lists no items');
select pg_temp.refused($q$select pg_temp.i_status((select b from idx), array_fill('x'::text, array[1001]))$q$, 'at most 1000');
rollback;
