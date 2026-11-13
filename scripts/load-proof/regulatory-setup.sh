#!/usr/bin/env bash
# The database of the Regulatory rehearsal (docs/specs/2026-11-12-regulatory-screen.md, "Rehearsal, then NTER" 1):
#
#   scripts/load-proof/regulatory-setup.sh build     build the base database and the working database (about a minute)
#   scripts/load-proof/regulatory-setup.sh reset     replace the working database with a copy of the base, restart PostgREST
#   scripts/load-proof/regulatory-setup.sh status    sizes and counts of both
#   scripts/load-proof/regulatory-setup.sh check     read-only: the two rules that tell real Regulatory documents from synthetic ones
#   scripts/load-proof/regulatory-setup.sh drop      drop both (never any other database)
#
# Two databases, both in container niyantran-corpus-test-db and both created here:
#   niyantran_ingest_load_reg_base_test   the template: the fixture chain of db.sh, the migrations it lacks up to and
#                                         including 20261113090000_national_search_only, and a seed copied read-only
#   niyantran_ingest_load_reg_test        a copy of the template; the proof runs here and `reset` makes a fresh one
# (override the working name with LOAD_PROOF_DB; the template is its name with _base before the final _test).
#
# What is copied, from niyantran_ingest_load_test (override with LOAD_PROOF_SOURCE_DB), which is only ever read
# (COPY ... TO STDOUT on a connection that is read-only at the session level):
#   Regulatory   the real documents and their chunks, told apart from the F287 synthetic ones by two independent rules,
#                which must select the same document ids or the script stops:
#                  1. what synth.ts gives a synthetic document: a sansad.in question URL, a title starting "Subject "
#                     and metadata.document_key_suggested; a real document is not all three together
#                  2. the spec's build notes: none of the 474 real documents carries a suggested key, so a real
#                     document is one with no metadata.document_key_suggested (synth.ts gives every synthetic
#                     Regulatory document one)
#                The count must also be REAL_REGULATORY_EXPECTED (default 474, the number on NTER); any other count stops
#                the script. All three must agree; if any does not, nothing is copied.
#   Bills, PQ    SEED_DOCS (default 30) documents of each with a listing link, their chunks, links and listing rows,
#                so "Bills and question rows unchanged" compares something.
#
# Nothing is written to, truncated or dropped from any database but the two named above (the source is only read). The
# only container it uses is niyantran-corpus-test-db, and the harness's PostgREST container, which `reset` and `drop`
# stop and `reset` starts again. Cluster-wide effects, which are NOT limited to the two databases:
#   - `postgrest.sh up` (run by reset) creates the role lp_authenticator if missing and RESETS ITS PASSWORD, which is
#     cluster-wide: any other proof using the shared PostgREST container is cut off until it is brought up again
#   - `apply()` (run by build) creates the role nter_migrator if missing and grants it cluster-wide (membership of
#     postgres, CREATE on schema public in the database being built, default privileges for it)
#   - `postgrest.sh down` (run by reset and drop) removes the single shared PostgREST container, which breaks any other
#     proof that is using it at that moment (it leaves both roles in place)
# After a copy and after a reset it runs analyze, because planner statistics are not carried by a bulk load (AGENTS.md).
set -euo pipefail

export PATH="$HOME/.docker/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CONTAINER=niyantran-corpus-test-db
DB="${LOAD_PROOF_DB:-niyantran_ingest_load_reg_test}"
BASE="${DB%_test}_base_test"
SOURCE="${LOAD_PROOF_SOURCE_DB:-niyantran_ingest_load_test}"
EXPECTED="${REAL_REGULATORY_EXPECTED:-474}"
SEED_DOCS="${SEED_DOCS:-30}"
REG="Regulatory Body Watch (RBI SEBI TRAI CCI)"
BILLS="Bill Passage Probability Index"
PQ="Parliamentary Question Database"

die() { echo "regulatory-setup.sh: $*" >&2; exit 1; }
# Only a name made for this rehearsal may be created or dropped here.
mine() { [[ "$1" =~ ^niyantran_ingest_load_[a-z0-9_]*reg[a-z0-9_]*_test$ ]] || die "database name $1 is not a rehearsal name (niyantran_ingest_load_*reg*_test)"; }
mine "$DB"; mine "$BASE"
[ "$DB" != "$BASE" ] || die "the working and base names are the same"
[ "$SOURCE" != "$DB" ] && [ "$SOURCE" != "$BASE" ] || die "the source database is one of the rehearsal databases"
[[ "$SOURCE" =~ ^niyantran_ingest_load[a-z0-9_]*_test$ ]] || die "source $SOURCE is not a niyantran_ingest_load*_test database"
[[ "$SEED_DOCS" =~ ^[0-9]{1,4}$ ]] || die "SEED_DOCS is not a number"

pg() { docker exec -i "$CONTAINER" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 "$@"; }
# The source connection cannot write: read-only at the session level, and only COPY ... TO and select are issued.
src() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$CONTAINER" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 -d "$SOURCE" "$@"; }
exists() { [ "$(pg -d postgres -c "select 1 from pg_database where datname = '$1'")" = 1 ]; }

# A migration as NTER applies migrations: by a role that owns the objects and is not a superuser (run.sh as_non_superuser).
apply() {
  local name="$1" file="$REPO/supabase/migrations/$1.sql"
  [ -f "$file" ] || die "no migration $file"
  echo "  applying $name"
  {
    cat <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nter_migrator') THEN
    CREATE ROLE nter_migrator NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  END IF;
END $$;
GRANT postgres TO nter_migrator;
GRANT CREATE ON SCHEMA public TO nter_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE nter_migrator IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE nter_migrator IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE nter_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
SET ROLE nter_migrator;
SQL
    cat "$file"
  } | pg -d "$BASE" > /dev/null
}

# Columns present in both the source and the base, in the base's order, for one table (generated columns left out).
shared() {
  local t="$1" s b
  s="$(src -c "select attname from pg_attribute where attrelid = 'public.$t'::regclass and attnum > 0 and not attisdropped and attgenerated = '' order by attnum")"
  b="$(pg -d "$BASE" -c "select attname from pg_attribute where attrelid = 'public.$t'::regclass and attnum > 0 and not attisdropped and attgenerated = '' order by attnum")"
  comm -12 <(echo "$s" | sort) <(echo "$b" | sort) | paste -sd, -
}

# copy_rows TABLE 'select-list placeholder: COLS' 'FROM ... WHERE ...': the source's rows into the base.
copy_rows() {
  local t="$1" from="$2" cols n
  cols="$(shared "$t")"
  [ -n "$cols" ] || die "no shared columns for $t"
  n="$(src -c "select count(*) from $from")"
  # the select list is the table alias's columns, qualified so a join cannot make one ambiguous
  local qcols
  qcols="$(echo "$cols" | sed -E 's/([^,]+)/x.\1/g')"
  echo "  copying $n rows of $t"
  src -c "copy (select $qcols from $from) to stdout" | pg -d "$BASE" -c "copy public.$t ($cols) from stdin"
}

# A synthetic Regulatory document is one the F287 harness made: all three of these (synth.ts, synthDoc).
SYNTH="(d.file_url like 'https://sansad.in/getFile/loksabhaquestions/%' and d.title like 'Subject %' and d.metadata ? 'document_key_suggested')"
REAL_REG="d.desk_feature = '$REG' and not $SYNTH"
# The second, independent rule: the suggested key is stored in metadata (the unique index documents_search_only_key_suggested
# is on metadata->>'document_key_suggested'); the real documents have none.
REAL_NOKEY="d.desk_feature = '$REG' and d.metadata->>'document_key_suggested' is null"

# The two rules must select the same documents (the same ids, not only the same number), and that number must be EXPECTED.
check_real() {
  local a b na nb total
  total="$(src -c "select count(*) from public.documents d where d.desk_feature = '$REG'")"
  a="$(src -c "select count(*)::text || ' ' || coalesce(md5(string_agg(d.id::text, ',' order by d.id)), '') from public.documents d where $REAL_REG")"
  b="$(src -c "select count(*)::text || ' ' || coalesce(md5(string_agg(d.id::text, ',' order by d.id)), '') from public.documents d where $REAL_NOKEY")"
  na="${a%% *}"; nb="${b%% *}"
  echo "  source Regulatory documents: $total; real by the synth rule $na, real by the no-suggested-key rule $nb"
  [ "$a" = "$b" ] || die "the two rules select different documents (synth rule: $na, no-suggested-key rule: $nb, or the same number with different ids); none is copied"
  [ "$na" = "$EXPECTED" ] || die "real Regulatory documents in $SOURCE: $na, not $EXPECTED; they cannot be told apart reliably, so none is copied"
  echo "  both rules select the same $na documents (id digest ${a#* })"
}

seed() {
  check_real
  local bills_ids pq_ids
  bills_ids="$(src -c "select string_agg(quote_literal(id::text) || '::uuid', ',') from (select distinct d.id from public.documents d join public.record_document_links l on l.document_id = d.id where d.desk_feature = '$BILLS' order by d.id limit $SEED_DOCS) s")"
  pq_ids="$(src -c "select string_agg(quote_literal(id::text) || '::uuid', ',') from (select distinct d.id from public.documents d join public.record_document_links l on l.document_id = d.id where d.desk_feature = '$PQ' order by d.id limit $SEED_DOCS) s")"
  [ -n "$bills_ids" ] && [ -n "$pq_ids" ] || die "the source holds no linked Bills or question documents to seed"
  local ids="$bills_ids,$pq_ids"
  copy_rows desk_rows "public.desk_rows x where (x.tier, x.feature, x.row_key) in (select l.tier, l.feature, l.row_key from public.record_document_links l where l.document_id in ($ids))"
  copy_rows documents "public.documents x where x.id in ($ids) or x.id in (select d.id from public.documents d where $REAL_REG)"
  copy_rows document_chunks "public.document_chunks x where x.document_id in ($ids) or x.document_id in (select d.id from public.documents d where $REAL_REG)"
  copy_rows record_document_links "public.record_document_links x where x.document_id in ($ids)"
  pg -d "$BASE" -c "analyze public.documents; analyze public.document_chunks; analyze public.desk_rows; analyze public.record_document_links;"
}

counts() {
  local d="$1"
  exists "$d" || { echo "$d does not exist"; return 0; }
  pg -d "$d" <<'SQL'
select 'database', pg_size_pretty(pg_database_size(current_database()));
select 'documents ' || coalesce(desk_feature, '(null)'), count(*) from public.documents group by desk_feature order by 1;
select 'chunks ' || coalesce(desk_feature, '(null)'), count(*) from public.document_chunks group by desk_feature order by 1;
select 'record_document_links', count(*) from public.record_document_links;
select 'desk_rows', count(*) from public.desk_rows;
select 'ingest_batches', count(*) from public.ingest_batches;
SQL
}

build() {
  exists "$BASE" && die "$BASE exists; run drop first"
  exists "$DB" && die "$DB exists; run drop first"
  LOAD_PROOF_DB="$BASE" "$HERE/db.sh" build
  for m in 20261106120000_admission_scans 20261107120000_bills_adapter 20261110120000_bills_admission_rules \
    20261110180000_record_resolver_shared_bill_keys 20261112090000_batch_resume_requeue 20261113090000_national_search_only; do
    apply "$m"
  done
  [ "$(pg -d "$BASE" -c "select public.ingest_admit_adapter('{\"desk_tier\":\"national\",\"desk_feature\":\"$REG\"}'::jsonb)")" = national_search_only ] \
    || die "the base does not admit the Regulatory desk as national_search_only"
  seed
  echo "base ready:"; counts "$BASE"
  reset
}

reset() {
  exists "$BASE" || die "$BASE does not exist; run build"
  "$HERE/postgrest.sh" down > /dev/null 2>&1 || true
  exists "$DB" && pg -d postgres -c "drop database $DB with (force)"
  pg -d postgres -c "create database $DB template $BASE"
  pg -d "$DB" -c "analyze public.documents; analyze public.document_chunks; analyze public.desk_rows; analyze public.record_document_links;"
  LOAD_PROOF_DB="$DB" "$HERE/postgrest.sh" up
  echo "working database $DB is a fresh copy of $BASE"
}

drop() {
  "$HERE/postgrest.sh" down > /dev/null 2>&1 || true
  for d in "$DB" "$BASE"; do
    mine "$d"
    if exists "$d"; then pg -d postgres -c "drop database $d with (force)"; echo "dropped $d"; else echo "$d does not exist"; fi
  done
}

case "${1:-}" in
  build) build ;;
  reset) reset ;;
  status) counts "$BASE"; counts "$DB" ;;
  check) check_real ;;
  drop) drop ;;
  *) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
