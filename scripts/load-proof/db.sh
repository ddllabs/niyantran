#!/usr/bin/env bash
# The disposable database of the F287 ingestion proof (docs/specs/2026-11-06-ingestion-load-proof.md).
#
#   scripts/load-proof/db.sh build [--replace]           schema only, no client data
#   scripts/load-proof/db.sh load-real [--limit-chunks N]  documents and chunks copied from niyantran_rehearsal_b9final
#   scripts/load-proof/db.sh status                       sizes and row counts
#   scripts/load-proof/db.sh drop                         drop this database (never any other)
#
# The database is niyantran_ingest_load_test in container niyantran-corpus-test-db (override the name
# with LOAD_PROOF_DB; it must match niyantran_ingest_load*_test, which keeps bootstrap_auth.sql's
# _test guard satisfied and makes a rehearsal or replica database impossible to name).
#
# The schema is the ingest_register_batch chain of supabase/tests/run.sh (Phase B and C3), taken from
# run.sh itself so it cannot drift, plus 20261101130000_law_documents_serving_set in timestamp order,
# every file applied as run.sh applies it (the migrations as nter_migrator, a non-superuser).
#
# load-real reads niyantran_rehearsal_b9final and writes only the target. Nothing is ever written to
# or dropped from a rehearsal database.
set -euo pipefail

export PATH="$HOME/.docker/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CONTAINER=niyantran-corpus-test-db
DB="${LOAD_PROOF_DB:-niyantran_ingest_load_test}"
SOURCE=niyantran_rehearsal_b9final

die() { echo "db.sh: $*" >&2; exit 1; }
case "$DB" in niyantran_ingest_load*_test) ;; *) die "database name $DB must match niyantran_ingest_load*_test" ;; esac
[[ "$DB" =~ ^[a-z0-9_]+$ ]] || die "database name $DB has unexpected characters"

pg() { docker exec -i "$CONTAINER" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 "$@"; }
exists() { [ "$(pg -d postgres -c "select 1 from pg_database where datname = '$1'")" = 1 ]; }

build() {
  local replace=0
  [ "${1:-}" = --replace ] && replace=1
  if exists "$DB"; then
    [ $replace = 1 ] || die "$DB exists; use build --replace to drop and rebuild it"
    pg -d postgres -c "drop database $DB with (force)"
  fi
  pg -d postgres -c "create database $DB"
  # run.sh up to, not including, psql_in(): the file helpers and chain(). Run in one shell, because
  # run.sh writes the non-superuser variants of the migrations into a temporary directory it removes on exit.
  local head tail
  head="$(awk '/^psql_in\(\)/ {exit} {print}' "$REPO/supabase/tests/run.sh")"
  tail="$(cat <<'EOS'
chain document_chunks_partitions
FILES+=("$(as_non_superuser 20261101130000_law_documents_serving_set.sql)"
        "$TESTS/bootstrap_corpus_ingest.sql" "$(as_non_superuser 20261102130000_batch_registration.sql)")
[ "$CONTAINER" = "$LP_CONTAINER" ] || { echo "the chain wants container $CONTAINER, not $LP_CONTAINER" >&2; exit 1; }
for f in "${FILES[@]}"; do
  echo "  applying $(basename "$f")"
  docker exec -i "$CONTAINER" psql -U postgres -d "$LP_DB" -v ON_ERROR_STOP=1 -q < "$f" > /dev/null
done
EOS
)"
  LP_CONTAINER="$CONTAINER" LP_DB="$DB" bash -c "$head"$'\n'"$tail" "$REPO/supabase/tests/run.sh"
  echo "built $DB"
}

# Columns present in both databases, in the target's order, for one table.
shared_columns() {
  local table="$1" src tgt
  src="$(pg -d "$SOURCE" -c "select attname from pg_attribute where attrelid = 'public.$table'::regclass and attnum > 0 and not attisdropped and attgenerated = '' order by attnum")"
  tgt="$(pg -d "$DB" -c "select attname from pg_attribute where attrelid = 'public.$table'::regclass and attnum > 0 and not attisdropped and attgenerated = '' order by attnum")"
  comm -12 <(echo "$src" | sort) <(echo "$tgt" | sort) | paste -sd, -
}

load_real() {
  local limit=""
  if [ "${1:-}" = --limit-chunks ]; then limit="${2:?--limit-chunks needs a number}"; [[ "$limit" =~ ^[0-9]+$ ]] || die "not a number: $limit"; fi
  exists "$DB" || die "$DB does not exist; run build first"
  exists "$SOURCE" || die "$SOURCE does not exist"
  [ "$(pg -d "$DB" -c 'select count(*) from public.document_chunks')" = 0 ] || die "$DB already holds chunks; rebuild it first"
  local dcols ccols hnsw_parent hnsw_name parts
  dcols="$(shared_columns documents)"; ccols="$(shared_columns document_chunks)"
  echo "documents columns: $dcols"; echo "document_chunks columns: $ccols"
  # The replica keeps no document text; the target's ocr_text is NOT NULL, so real rows carry an empty one.
  local dsel="$dcols" dtarget="$dcols"
  case ",$dcols," in *,ocr_text,*) ;; *) dsel="$dcols,'' as ocr_text"; dtarget="$dcols,ocr_text" ;; esac
  # The partitioned HNSW index is dropped before the load and built after it, as the migration does.
  hnsw_parent="$(pg -d "$DB" -c "select indexname from pg_indexes where schemaname = 'public' and tablename = 'document_chunks' and indexdef ilike '%hnsw%'")"
  [ -n "$hnsw_parent" ] || die "no HNSW index on document_chunks"
  parts="$(pg -d "$DB" -c "select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.document_chunks'::regclass order by 1")"
  pg -d "$DB" -c "drop index public.$hnsw_parent"
  local chunk_src="public.document_chunks" doc_src="public.documents"
  if [ -n "$limit" ]; then
    chunk_src="(select * from public.document_chunks order by id limit $limit) c"
    doc_src="(select * from public.documents where id in (select document_id from (select document_id from public.document_chunks order by id limit $limit) x)) d"
  fi
  echo "copying documents"
  pg -d "$SOURCE" -c "copy (select $dsel from $doc_src) to stdout" | pg -d "$DB" -c "copy public.documents ($dtarget) from stdin"
  echo "copying chunks"
  pg -d "$SOURCE" -c "copy (select $ccols from $chunk_src) to stdout" | pg -d "$DB" -c "copy public.document_chunks ($ccols) from stdin"
  echo "building the HNSW indexes (1 GB maintenance memory)"
  local p
  {
    echo "set maintenance_work_mem = '1GB';"
    echo "create index $hnsw_parent on only public.document_chunks using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);"
    for p in $parts; do
      echo "create index ${p}_embedding_halfvec_hnsw on public.$p using hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops);"
      echo "alter index public.$hnsw_parent attach partition public.${p}_embedding_halfvec_hnsw;"
    done
  } | pg -d "$DB"
  # AGENTS.md: statistics are not carried by a bulk load.
  pg -d "$DB" -c "analyze public.document_chunks; analyze public.desk_rows; analyze public.documents;"
  status
}

status() {
  exists "$DB" || die "$DB does not exist"
  pg -d "$DB" <<'SQL'
select 'database', pg_size_pretty(pg_database_size(current_database()));
select 'documents', count(*) from public.documents;
select 'chunks ' || coalesce(desk_feature, '(null)'), count(*) from public.document_chunks group by desk_feature order by 1;
select 'ingest_jobs', count(*) from public.ingest_jobs;
SQL
}

drop_db() {
  exists "$DB" || { echo "$DB does not exist"; return 0; }
  pg -d postgres -c "drop database $DB with (force)"
  echo "dropped $DB"
}

case "${1:-}" in
  build) shift; build "$@" ;;
  load-real) shift; load_real "$@" ;;
  status) status ;;
  drop) drop_db ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
