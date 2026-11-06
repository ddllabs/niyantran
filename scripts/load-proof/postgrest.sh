#!/usr/bin/env bash
# PostgREST for the F287 ingestion proof, from the local image public.ecr.aws/supabase/postgrest:v16.2.
#
#   scripts/load-proof/postgrest.sh up            start it on the proof database
#   scripts/load-proof/postgrest.sh status
#   scripts/load-proof/postgrest.sh down [--drop-role]   stop and remove it; --drop-role also removes lp_authenticator
#
# Where it runs, and why it differs from the plan. The plan puts PostgREST on Docker's default bridge and
# has it reach the database by the bridge IP. niyantran-corpus-test-db has network mode "none": no IP, no
# published port. Its configuration is not to be changed or the container restarted, so PostgREST joins its
# network namespace instead (--network container:...) and connects to 127.0.0.1:5432. It listens on
# 127.0.0.1:3000 inside that namespace only. The Deno harness reaches it through a stdio relay
# (lib.ts, `docker exec` into the database container), bound to 127.0.0.1 on the host.
#
# Timing and pool. PGRST_SERVER_TIMING_ENABLED=true makes PostgREST answer with a Server-Timing header
# (jwt, parse, plan, transaction, response; checked on v16.2 by sending a request), which the driver records
# per commit so client-side wait can be told from database time. PGRST_DB_POOL is LOAD_PROOF_POOL (default 10):
# keep it above the worker count (load.ts refuses more than 8 workers on a pool of 10).
#
# Secrets. The JWT secret and the lp_authenticator password are generated here on every `up`, passed to the
# container through its environment (never on a command line, never printed) and never written to a file.
# The harness reads the JWT secret back from the container with `docker inspect` to sign its tokens.
#
# lp_authenticator is created by `up` and is a member of anon, authenticated, service_role and corpus_ingest,
# which is how PostgREST switches to those roles (corpus_ingest to register batches as the runner does).
set -euo pipefail

export PATH="$HOME/.docker/bin:$PATH"
CONTAINER=niyantran-corpus-test-db
NAME=niyantran-load-proof-postgrest
IMAGE=public.ecr.aws/supabase/postgrest:v16.2
ROLE=lp_authenticator
DB="${LOAD_PROOF_DB:-niyantran_ingest_load_test}"
POOL="${LOAD_PROOF_POOL:-10}"   # PostgREST connections to the database; keep it above the worker count

die() { echo "postgrest.sh: $*" >&2; exit 1; }
case "$DB" in niyantran_ingest_load*_test) ;; *) die "database name $DB must match niyantran_ingest_load*_test" ;; esac
pg() { docker exec -i "$CONTAINER" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 "$@"; }

up() {
  [ "$(pg -d postgres -c "select 1 from pg_database where datname = '$DB'")" = 1 ] || die "$DB does not exist; run db.sh build"
  docker image inspect "$IMAGE" > /dev/null 2>&1 || die "image $IMAGE is not present locally (it is never pulled)"
  local jwt_secret role_password
  jwt_secret="$(openssl rand -hex 32)"
  role_password="$(openssl rand -hex 24)"
  # Passed on stdin so the password is on no command line.
  pg -d postgres <<SQL
do \$\$ begin
  if not exists (select from pg_roles where rolname = '$ROLE') then
    create role $ROLE login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end \$\$;
alter role $ROLE password '$role_password';
grant anon, authenticated, service_role, corpus_ingest to $ROLE;
SQL
  docker rm -f "$NAME" > /dev/null 2>&1 || true
  PGRST_DB_URI="postgres://$ROLE:$role_password@127.0.0.1:5432/$DB" PGRST_JWT_SECRET="$jwt_secret" \
  docker run -d --name "$NAME" --network "container:$CONTAINER" \
    --read-only --cap-drop ALL --security-opt no-new-privileges --memory 512m \
    -e PGRST_DB_URI -e PGRST_JWT_SECRET \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_MAX_ROWS=1000 -e PGRST_DB_POOL="$POOL" -e PGRST_SERVER_TIMING_ENABLED=true \
    -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions \
    -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT=3000 -e PGRST_LOG_LEVEL=warn \
    "$IMAGE" > /dev/null
  local i
  for i in $(seq 1 30); do
    if docker logs "$NAME" 2>&1 | grep -q 'Schema cache loaded'; then echo "postgrest is up (database $DB, db-max-rows 1000)"; return 0; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || { docker logs "$NAME" 2>&1 | sed 's/postgres:\/\/[^ ]*/postgres:\/\/[redacted]/' | tail -5; die "postgrest exited"; }
    sleep 1
  done
  die "postgrest did not report a loaded schema cache in 30 s"
}

down() {
  docker rm -f "$NAME" > /dev/null 2>&1 && echo "removed $NAME" || echo "$NAME was not running"
  if [ "${1:-}" = --drop-role ]; then
    pg -d postgres -c "drop role if exists $ROLE"
    echo "dropped role $ROLE"
  fi
}

status() {
  docker inspect -f '{{.Name}} running={{.State.Running}} started={{.State.StartedAt}}' "$NAME" 2> /dev/null || echo "$NAME is not present"
  docker logs --tail 5 "$NAME" 2>&1 | sed 's/postgres:\/\/[^ ]*/postgres:\/\/[redacted]/' || true
}

case "${1:-}" in
  up) up ;;
  status) status ;;
  down) shift; down "$@" ;;
  *) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
