#!/usr/bin/env bash
# Run the SQL authorization fixtures against a disposable local PostgreSQL.
# Never point this at a hosted Supabase project: AGENTS.md requires a
# disposable local database for SQL authorization and migration checks, and
# several fixtures deliberately attempt privilege escalation and DDL.
#
#   ./supabase/tests/run.sh              # every fixture
#   ./supabase/tests/run.sh profile_authority conversation_ownership
#
# Requires Docker with two containers already running:
#   niyantran-recovery-db     postgres:17-alpine       (no pgvector)
#   niyantran-corpus-test-db  pgvector/pgvector:pg17   (pgvector)
#
# Each fixture gets a database created from scratch, so a run never inherits
# state from the last one. Bootstrap chains come from each fixture's header.
# Database names follow niyantran_<fixture>_test because bootstrap_auth.sql
# refuses to run anywhere else - a guard against pointing this at a real
# project. Do not relax that guard to make a name convenient.
set -euo pipefail

export PATH="$HOME/.docker/bin:$PATH"
cd "$(dirname "$0")/../.."

PLAIN=niyantran-recovery-db
VECTOR=niyantran-corpus-test-db
MIG=supabase/migrations
TESTS=supabase/tests
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 0001 without the vector extension, for the container that has no pgvector.
grep -v '^create extension if not exists vector' "$MIG/20260921000001_vector_and_email.sql" > "$WORK/0001_email_only.sql"

# 0007 without pg_cron/pg_net and without the schedule: the fixtures want only
# model_pricing_reconcile and its grants (see least_privilege.sql's header).
sed -n '22,101p' "$MIG/20260921000007_pricing_reconcile_and_schedule.sql" > "$WORK/0007_reconcile_only.sql"

# auth_schema.sql section 23 is a deliberate copy of migration 0012 ("Kept
# equivalent to..."). That makes profile_authority.sql vacuous when bootstrapped
# from it, because the guard is already installed before 0012 runs. For the
# vacuity baseline only, cut the file at that section header so the profile
# authority content is genuinely absent.
sed -n "1,$(( $(grep -n '^-- 23\. PROFILE AUTHORITY AND RPC PRIVILEGES' backend/sql/auth_schema.sql | cut -d: -f1) - 2 ))p" \
  backend/sql/auth_schema.sql > "$WORK/auth_schema_no_0012.sql"

m() { echo "$MIG/$1"; }

# fixture name -> container, then the ordered bootstrap files.
chain() {
  case "$1" in
    profile_authority)
      CONTAINER=$PLAIN
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql "$WORK/0001_email_only.sql" "$(m 20260921000012_profile_authority.sql)") ;;
    conversation_ownership)
      CONTAINER=$PLAIN
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql "$WORK/0001_email_only.sql" "$(m 20260921000002_conversations.sql)" "$(m 20260921000004_telemetry_and_pricing.sql)" "$(m 20260921000013_conversation_ownership.sql)") ;;
    corpus_revision_integrity)
      CONTAINER=$VECTOR
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql "$(m 20260921000001_vector_and_email.sql)" "$(m 20260921000002_conversations.sql)" "$(m 20260921000003_corpus_and_desk.sql)" "$(m 20260921000009_rag_rpcs.sql)" "$(m 20260921000014_corpus_revision_integrity.sql)") ;;
    least_privilege|research_turn_persistence)
      CONTAINER=$VECTOR
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql
             "$(m 20260921000001_vector_and_email.sql)" "$(m 20260921000002_conversations.sql)"
             "$(m 20260921000003_corpus_and_desk.sql)" "$(m 20260921000004_telemetry_and_pricing.sql)"
             "$(m 20260921000005_allowlist.sql)" "$(m 20260921000006_health_rpc.sql)"
             "$WORK/0007_reconcile_only.sql" "$(m 20260921000008_admin_models_rpc.sql)"
             "$(m 20260921000009_rag_rpcs.sql)" "$(m 20260921000010_service_role_timeout.sql)"
             "$(m 20260921000011_desk_rows_search.sql)" "$(m 20260921000012_profile_authority.sql)"
             "$(m 20260921000013_conversation_ownership.sql)" "$(m 20260921000014_corpus_revision_integrity.sql)"
             "$(m 20260921000015_least_privilege.sql)")
      [ "$1" = research_turn_persistence ] && FILES+=("$(m 20260921115831_research_turn_persistence.sql)")
      return 0 ;;
    *) echo "unknown fixture: $1" >&2; return 1 ;;
  esac
}

psql_in() { docker exec -i "$CONTAINER" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q; }

# Vacuity check. Each chain ends with the migration the fixture exists to prove.
# Drop that one file and the fixture MUST fail; if it still passes, the fixture
# is asserting something that was already true and is worthless as a guard.
# corpus_revision_integrity.sql states this requirement in its own header.
vacuity_check() {
  local name="$1" db="niyantran_${1}_vac_test" rc=0
  chain "$name"
  local guard="${FILES[${#FILES[@]}-1]}"
  [ "$name" = profile_authority ] && FILES=("${FILES[@]/backend\/sql\/auth_schema.sql/$WORK/auth_schema_no_0012.sql}")
  docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $db" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -q -c "create database $db" >/dev/null
  local i=0
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq ${#FILES[@]} ] && break
    psql_in "$db" < "$f" >/dev/null 2>&1 || { echo "  VACUITY: bootstrap broke at $(basename "$f")"; return 1; }
  done
  if psql_in "$db" < "$TESTS/$name.sql" >/dev/null 2>&1; then
    echo "  VACUITY FAIL - fixture still passes without $(basename "$guard")"
    rc=1
  else
    echo "  vacuity ok - fails without $(basename "$guard")"
  fi
  docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $db" >/dev/null
  return $rc
}

run_fixture() {
  local name="$1" db="niyantran_${1}_test" rc=0
  chain "$name"
  echo "=== $name  [${CONTAINER#niyantran-}]"

  docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $db" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -q -c "create database $db" >/dev/null

  for f in "${FILES[@]}"; do
    if ! psql_in "$db" < "$f" > "$WORK/out.txt" 2>&1; then
      echo "  BOOTSTRAP FAILED at $(basename "$f")"
      grep -iE 'error' "$WORK/out.txt" | head -3 | sed 's/^/    /'
      return 1
    fi
  done

  if psql_in "$db" < "$TESTS/$name.sql" > "$WORK/out.txt" 2>&1; then
    echo "  PASS  ($(grep -c . "$WORK/out.txt") lines of output)"
    [ "${VACUITY:-1}" = 1 ] && { vacuity_check "$name" || rc=1; }
  else
    rc=1
    echo "  FAIL"
    grep -iE 'error|assert' "$WORK/out.txt" | head -6 | sed 's/^/    /'
  fi
  return $rc
}

FIXTURES=("$@")
[ ${#FIXTURES[@]} -eq 0 ] && FIXTURES=(profile_authority conversation_ownership corpus_revision_integrity least_privilege research_turn_persistence)

fail=0
for f in "${FIXTURES[@]}"; do run_fixture "$f" || fail=1; done
echo
[ $fail -eq 0 ] && echo "all fixtures passed" || echo "one or more fixtures FAILED"
exit $fail
