#!/usr/bin/env bash
# Only the run.sh disposable database, never a hosted target.
set -euo pipefail
export PATH="$HOME/.docker/bin:$PATH"
CONTAINER=niyantran-corpus-test-db
DB=niyantran_law_listing_test
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
psql_local() { docker exec -i "$CONTAINER" psql -X -U postgres -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
# Seed one approved pending publication and commit fully indexed chunks. Disable only
# the automatic publication trigger to model a stopped publisher; immediately restore it.
awk '
 /^select public.ingest_text_activate/ {
  print "alter table public.documents disable trigger law_indexed_publication;";
  print;
  print "alter table public.documents enable trigger law_indexed_publication;";
  print "commit;";
  exit
 }
 {print}
' supabase/tests/law_listing.sql | psql_local > "$WORK/setup.log" 2>&1
cat > "$WORK/publish.sql" <<'SQL'
begin;
select public.law_publish(jsonb_build_object('document_id',d.id,'text_sha256',d.content_sha256,
 'expected_fingerprint',p.fingerprint,'decision_id',p.decision_id,'approver',p.approver,'evidence_sha256',p.evidence_sha256))
 from public.documents d join public.law_publications p on p.document_id=d.id;
select pg_sleep(0.2);
commit;
SQL
psql_local < "$WORK/publish.sql" > "$WORK/one.log" 2>&1 & one=$!
psql_local < "$WORK/publish.sql" > "$WORK/two.log" 2>&1 & two=$!
wait "$one" || { cat "$WORK/one.log"; exit 1; }
wait "$two" || { cat "$WORK/two.log"; exit 1; }
psql_local <<'SQL'
do $$begin
 if (select count(*) from public.law_document_links)<>1
 or (select count(*) from public.law_records)<>2
 or (select count(*) from public.document_chunks)<>1
 or (select attempts from public.law_publications)<>1
 or (select status from public.law_publications)<>'published' then
 raise exception 'concurrent publication duplicated or damaged state'; end if;
end$$;
SQL
echo '  concurrency ok - two publishers, one link/receipt attempt, unchanged chunk count'
# Activation and an exact registration retry must use the same lock order.
psql_local <<'SQL'
truncate public.documents,public.desk_rows,public.law_records cascade;
update public.law_listing_settings set seeded=false,active=false;
SQL
awk '
 /^select public.ingest_text_activate/ {print "commit;"; exit}
 {print}
' supabase/tests/law_listing.sql | psql_local > "$WORK/activation-setup.log" 2>&1
psql_local <<'SQL'
create function public.fixture_slow_index_update() returns trigger language plpgsql as $$begin perform pg_sleep(0.8); return new; end$$;
create trigger fixture_slow_index_update before update of indexed_at on public.documents for each row execute function public.fixture_slow_index_update();
SQL
cat > "$WORK/activate.sql" <<'SQL'
set application_name='law_fixture_activation';
select public.ingest_text_activate(id,claim_token,0,0) from public.ingest_jobs where status='running';
SQL
psql_local < "$WORK/activate.sql" > "$WORK/activate.log" 2>&1 & activating=$!
# Wait for the causal point (document lock acquired, before-update trigger sleeping).
seen=false
for i in $(seq 1 60); do
  if [ "$(printf "select count(*) from pg_stat_activity where application_name='law_fixture_activation' and wait_event='PgSleep';" | psql_local -tA 2>/dev/null | tr -d '[:space:]')" = 1 ]; then seen=true; break; fi
  sleep 0.02
done
if [ "$seen" != true ]; then wait "$activating" || true; cat "$WORK/activate.log"; echo 'activation overlap not established'; exit 1; fi
cat > "$WORK/retry.sql" <<'SQL'
select public.ingest_register_text(jsonb_build_object('payload',payload,'payload_sha256',payload_sha256,'expected',expected,'pages','[]'::jsonb,'sections','[]'::jsonb)) from public.ingest_text_inputs;
SQL
psql_local < "$WORK/retry.sql" > "$WORK/retry.log" 2>&1 & retrying=$!
wait "$activating" || { cat "$WORK/activate.log"; exit 1; }
wait "$retrying" || { cat "$WORK/retry.log"; exit 1; }
psql_local <<'SQL'
drop trigger fixture_slow_index_update on public.documents;
drop function public.fixture_slow_index_update();
do $$begin
 if (select count(*) from public.documents)<>1 or (select count(*) from public.document_chunks)<>1
 or (select status from public.law_publications)<>'published' or (select status from public.ingest_jobs)<>'succeeded' then
 raise exception 'activation/retry overlap corrupted state'; end if;
end$$;
SQL
echo '  concurrency ok - activation overlaps exact retry without deadlock or re-ingestion'
