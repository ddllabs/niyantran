#!/usr/bin/env bash
# C3b races (design 8.1), on the run.sh disposable database only, never a hosted target. run.sh
# calls this after ingest_register_batch.sql passes; the fixture rolled back, so the database holds
# the chain and nothing else. Each race holds one session open at a known point (pg_sleep, seen in
# pg_stat_activity) and checks what the other session saw and how long it waited.
set -euo pipefail
export PATH="$HOME/.docker/bin:$PATH"
CONTAINER=niyantran-corpus-test-db
DB=${INGEST_BATCH_DB:-niyantran_ingest_register_batch_test}
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
q() { docker exec -i "$CONTAINER" psql -X -U postgres -v ON_ERROR_STOP=1 -d "$DB" -qtA "$@"; }
fail() { echo "  CONCURRENCY FAIL - $*"; exit 1; }
# Wait until the session named $1 sleeps inside its transaction (its locks are held).
held() {
  for _ in $(seq 1 100); do
    [ "$(q -c "select count(*) from pg_stat_activity where application_name='$1' and wait_event='PgSleep'")" = 1 ] && return 0
    sleep 0.05
  done
  fail "session $1 never reached its hold point"
}
# Runs SQL as a named session that holds its transaction open for $2 seconds after it.
holding() { printf "set application_name='%s';\nbegin;\n%s\nselect pg_sleep(%s);\ncommit;\n" "$1" "$3" "$2" | q > "$WORK/$1.out" 2>&1; }

q > /dev/null <<'SQL'
create schema cx;
-- The fixture's builders, permanent in this disposable database.
create function cx.url(g int) returns text language sql immutable as $$
 select 'https://sansad.in/getFile/loksabhaquestions/annex/187/AU' || (2000+g) || '_cx.pdf?source=pqals' $$;
create function cx.doc(g int, t text) returns jsonb language sql as $$
 with r as (select jsonb_build_object('source_key',left(encode(sha256(convert_to('cx-'||g,'UTF8')),'hex'),40),'title','Subject '||g,'text',t,
   'text_sha256',encode(sha256(convert_to(t,'UTF8')),'hex'),'desk_tier','national','desk_feature','Parliamentary Question Database',
   'file_url',cx.url(g),'licence_class','gov_open',
   'citation',jsonb_build_object('house','Lok Sabha','subject','Subject '||g,'ministry','MINISTRY','answered_on','02.04.2026'),
   'review',jsonb_build_object('status','eligible'),'pages','[]'::jsonb) r)
 select jsonb_build_object('payload',r::text,'payload_sha256',encode(sha256(convert_to(r::text,'UTF8')),'hex'),
  'expected',jsonb_build_array(jsonb_build_object('chunk_hash',encode(sha256(convert_to('c'||g||t,'UTF8')),'hex'),'embed_hash',repeat('e',64),
   'chunk_index',0,'source_kind','document','char_from',0,'char_to',length(t),'content',t,'token_count',4,'chunker_version',4)),
  'pages','[]'::jsonb,'sections','[]'::jsonb) from r $$;
create function cx.batch(docs jsonb, salt int) returns uuid language plpgsql as $$
declare items jsonb; b uuid;
begin
 select jsonb_agg(jsonb_build_object('source_key',(d->>'payload')::jsonb->>'source_key','payload_sha256',d->>'payload_sha256',
   'content_sha256',(d->>'payload')::jsonb->>'text_sha256','chunks',1,'est_tokens',salt)) into items from jsonb_array_elements(docs) d;
 b := (public.ingest_batch_open(jsonb_build_object('collection','cx','manifest_sha256',(select encode(sha256(convert_to(string_agg(concat_ws(E'\t',
   e->>'source_key',e->>'payload_sha256',e->>'content_sha256',e->>'chunks',e->>'est_tokens')||E'\n','' order by e->>'source_key' collate "C"),'UTF8')),'hex')
   from jsonb_array_elements(items) e),'items_planned',jsonb_array_length(items),'chunks_planned',jsonb_array_length(items),
   'est_tokens',salt*jsonb_array_length(items),'est_cost_usd',1,'runner_commit','abcdef1'))->>'batch_id')::uuid;
 perform public.ingest_batch_add_items(b, items);
 if public.ingest_batch_seal(b)->>'state' <> 'sealed' then raise exception 'cx: seal failed'; end if;
 return b;
end $$;
create table cx.b(name text primary key, id uuid, docs jsonb);
create table cx.res(name text primary key, r jsonb, seconds numeric);
-- Registers as corpus_ingest and records the answer and how long the call took.
create function cx.reg(n text, bn text) returns void language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); v jsonb;
begin
 set local role corpus_ingest;
 v := public.ingest_register_batch((select x.id from cx.b x where x.name=bn), (select x.docs from cx.b x where x.name=bn));
 reset role;
 insert into cx.res values (n, v, extract(epoch from clock_timestamp() - t0));
end $$;
grant usage on schema cx to corpus_ingest;

select public.ingest_policy_approve(jsonb_build_object('collection','cx','admitted',jsonb_build_array(jsonb_build_object('desk_tier','national',
 'desk_feature','Parliamentary Question Database','adapter','lok_sabha_answers')),'licence_classes',jsonb_build_array('gov_open'),
 'min_chars_per_page',0,'min_pages_for_density',5,'require_page_count',false,'budget_usd',100,'chunk_ceiling',100000,
 'stop_thresholds',jsonb_build_object('refusal_share',1,'failure_rate',1,'uncertain_max',1,'min_decided',1),
 'decision_id','cx','approver','Fixture','evidence_sha256',repeat('e',64)));
insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at)
select 'national','Parliamentary Question Database','cx'||g,jsonb_build_object('house','Lok Sabha','date','2026-04-02','ministry','MINISTRY',
 'subject','Subject '||g,'source_url',cx.url(g)),'x',now() from generate_series(1,6) g;
-- Race 1: one text under two keys, in two batches.
insert into cx.b values ('same_a', cx.batch(jsonb_build_array(cx.doc(1,'ONE SHARED TEXT')), 1), jsonb_build_array(cx.doc(1,'ONE SHARED TEXT')));
insert into cx.b values ('same_b', cx.batch(jsonb_build_array(cx.doc(2,'ONE SHARED TEXT')), 1), jsonb_build_array(cx.doc(2,'ONE SHARED TEXT')));
-- Race 2: two batches over the same two keys, sent in opposite orders.
insert into cx.b values ('fwd', cx.batch(jsonb_build_array(cx.doc(3,'TEXT THREE'), cx.doc(4,'TEXT FOUR')), 2), jsonb_build_array(cx.doc(3,'TEXT THREE'), cx.doc(4,'TEXT FOUR')));
insert into cx.b values ('rev', cx.batch(jsonb_build_array(cx.doc(4,'TEXT FOUR'), cx.doc(3,'TEXT THREE')), 3), jsonb_build_array(cx.doc(4,'TEXT FOUR'), cx.doc(3,'TEXT THREE')));
insert into cx.b values ('new5', cx.batch(jsonb_build_array(cx.doc(5,'TEXT FIVE')), 4), jsonb_build_array(cx.doc(5,'TEXT FIVE')));
grant select on cx.b to corpus_ingest;
grant insert on cx.res to corpus_ingest;
SQL

# ── 1. The same text under two keys at once: exactly one admitted, one duplicate_text. ─────────
holding same_a 1.5 "select cx.reg('same_a','same_a');" & a=$!
held same_a
q -c "select cx.reg('same_b','same_b')" > /dev/null
wait "$a" || { cat "$WORK/same_a.out"; fail "session same_a"; }
got="$(q -c "select string_agg(r#>>'{results,0,outcome}' || ':' || coalesce(r#>>'{results,0,reason}',''), ',' order by name) from cx.res where name like 'same_%'")"
[ "$got" = "admitted:,refused:duplicate_text" ] || fail "same text under two keys: $got"
[ "$(q -c "select count(*) from public.documents where content_sha256=encode(sha256(convert_to('ONE SHARED TEXT','UTF8')),'hex')")" = 1 ] || fail "two documents hold one text"
echo '  concurrency ok - one text under two keys at once: one admitted, one duplicate_text'

# ── 2. Overlapping keys in opposite orders: no deadlock, one batch admits both, the other sees them. ─
printf "set application_name='fwd';\nbegin;\nselect cx.reg('fwd','fwd');\nselect pg_sleep(0.5);\ncommit;\n" | q > "$WORK/fwd.out" 2>&1 & f=$!
printf "set application_name='rev';\nbegin;\nselect cx.reg('rev','rev');\nselect pg_sleep(0.5);\ncommit;\n" | q > "$WORK/rev.out" 2>&1 & r=$!
wait "$f" || { cat "$WORK/fwd.out"; fail "session fwd (deadlock?)"; }
wait "$r" || { cat "$WORK/rev.out"; fail "session rev (deadlock?)"; }
got="$(q -c "select string_agg((select string_agg(d->>'outcome', '+' order by d->>'source_key') from jsonb_array_elements(r->'results') d), ',' order by (r->'totals'->>'admitted')::int desc) from cx.res where name in ('fwd','rev')")"
[ "$got" = "admitted+admitted,existing+existing" ] || fail "opposite orders: $got"
echo '  concurrency ok - overlapping keys in opposite orders: no deadlock, admitted then existing'

# ── 3. A registration rerun against the worker (Phase B's chunk trigger takes documents FOR SHARE). ─
# The rerun's existing-source branch holds the document FOR SHARE; the worker's chunk insert must
# not wait behind it. Then activation (job, then document FOR UPDATE) must finish after the rerun.
q > /dev/null <<'SQL'
create function cx.chunk_share() returns trigger language plpgsql as $$
begin perform 1 from public.documents d where d.id = new.document_id for share; return new; end $$;
create trigger cx_chunk_share before insert on public.document_chunks for each row execute function cx.chunk_share();
update public.ingest_jobs set status='running', claim_token='00000000-0000-4000-8000-0000000000c3', lease_until=now()+interval '10 minutes', attempts=1
 where document_id=(select id from public.documents where file_url=cx.url(3));
create function cx.worker(n text, what text) returns void language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); j uuid; d jsonb := cx.doc(3,'TEXT THREE');
begin
 select id into j from public.ingest_jobs where document_id=(select id from public.documents where file_url=cx.url(3));
 if what = 'commit' then
  perform public.ingest_text_commit(j,'00000000-0000-4000-8000-0000000000c3',
    jsonb_build_array((d->'expected'->0) || jsonb_build_object('embedding',to_jsonb(array_fill(0.01::real,array[1536])))));
 else
  perform public.ingest_text_activate(j,'00000000-0000-4000-8000-0000000000c3',1,0);
 end if;
 insert into cx.res values (n, null, extract(epoch from clock_timestamp() - t0));
end $$;
SQL
holding rerun 1.5 "select cx.reg('rerun','fwd');" & h=$!
held rerun
q -c "select cx.worker('commit','commit')" > /dev/null
wait "$h" || { cat "$WORK/rerun.out"; fail "session rerun"; }
waited="$(q -c "select seconds from cx.res where name='commit'")"
q -c "select (seconds < 1.0)::text from cx.res where name='commit'" | grep -qx true || fail "the chunk write waited ${waited}s behind a registration rerun"
[ "$(q -c "select string_agg(d->>'outcome', '+') from cx.res, jsonb_array_elements(r->'results') d where name='rerun'")" = "existing+existing" ] || fail "rerun outcome"
echo "  concurrency ok - a registration rerun never blocks the worker's chunk write (waited ${waited}s)"
holding rerun2 1.0 "select cx.reg('rerun2','rev');" & h=$!
held rerun2
q -c "select cx.worker('activate','activate')" > /dev/null || fail "activation failed (deadlock?)"
wait "$h" || { cat "$WORK/rerun2.out"; fail "session rerun2"; }
[ "$(q -c "select status from public.ingest_jobs where document_id=(select id from public.documents where file_url=cx.url(3))")" = succeeded ] || fail "activation did not succeed"
echo '  concurrency ok - activation behind a registration rerun: it waits, then succeeds, no deadlock'

# ── 4. Registration racing ingest_discard of an upload: neither waits for the other. ────────────
q > /dev/null <<'SQL'
insert into public.documents(id,source_key,title,content_sha256,ocr_text,storage_path,file_sha256)
 values('d0000000-0000-4000-8000-0000000000c4','upload:cx','Upload',encode(sha256(''::bytea),'hex'),'','files/x.pdf',repeat('a',64));
insert into public.ingest_jobs(document_id,status,stage,file_sha256,pages_total) values('d0000000-0000-4000-8000-0000000000c4','failed','ocr',repeat('a',64),1);
SQL
holding discard 1.5 "select public.ingest_discard('d0000000-0000-4000-8000-0000000000c4', null);" & h=$!
held discard
q -c "select cx.reg('new5','new5')" > /dev/null
wait "$h" || { cat "$WORK/discard.out"; fail "session discard"; }
q -c "select (seconds < 1.0 and r#>>'{results,0,outcome}' = 'admitted')::text from cx.res where name='new5'" | grep -qx true || fail "registration waited behind a discard"
[ "$(q -c "select count(*) from public.documents where id='d0000000-0000-4000-8000-0000000000c4'")" = 0 ] || fail "discard did not happen"
echo '  concurrency ok - registration and ingest_discard run side by side'
