#!/usr/bin/env bash
# Operator steps for the ingest worker (docs/specs/2026-10-01-rag-v2-ingestion-v2.md,
# "Operator steps"). The OWNER runs these in their own terminal; an agent never runs
# `secret`. Every command is printed before it runs. The worker secret is generated
# here, handed to the CLI through a file descriptor (never argv, never a file on disk),
# and only its SHA-256 fingerprint is printed.
#
#   scripts/ingest-ops.sh secret          # generate INGEST_WORKER_SECRET: function secret + Vault
#   scripts/ingest-ops.sh schedule on     # pg_cron job 'ingest-worker', every 30 s
#   scripts/ingest-ops.sh schedule off    # deactivate it (the job row stays)
#   scripts/ingest-ops.sh kick            # one invocation now, for testing with the schedule off
#   scripts/ingest-ops.sh status          # the cron job and the latest jobs (no secret values)
#
# Uses the Supabase CLI's login (`supabase db query` goes through the Management API),
# so no database password or psql is needed. Project: NTER unless INGEST_PROJECT_REF is set.
set -euo pipefail

REF="${INGEST_PROJECT_REF:-vfgcppstyzjarlzyqdac}"
URL="https://${REF}.supabase.co/functions/v1/ingest-worker"
VAULT_NAME=ingest_worker_secret

say() { printf '\n>> %s\n' "$*"; }

# SQL to the project, read from a file descriptor so nothing lands in argv or on disk.
sql() { supabase db query --project-ref "$REF" -f <(printf '%s\n' "$1"); }

# One http_post to the worker, the secret read from Vault inside the database.
POST_SQL="select net.http_post(
  url := '${URL}',
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = '${VAULT_NAME}')),
  body := '{}'::jsonb,
  timeout_milliseconds := 10000)"

case "${1:-}" in
  secret)
    command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
    s="$(openssl rand -hex 32)"
    fp="$(printf '%s' "$s" | shasum -a 256 | cut -c1-8)"

    say "supabase secrets set INGEST_WORKER_SECRET=<generated> --project-ref ${REF}"
    supabase secrets set --project-ref "$REF" --env-file <(printf 'INGEST_WORKER_SECRET=%s\n' "$s")

    say "store the same value in Vault as '${VAULT_NAME}' (create or update)"
    sql "select vault.update_secret(id, '${s}') from vault.secrets where name = '${VAULT_NAME}';
select vault.create_secret('${s}', '${VAULT_NAME}')
 where not exists (select 1 from vault.secrets where name = '${VAULT_NAME}');" >/dev/null
    unset s

    say "fingerprint (sha256, first 8): ${fp}"
    say "check: the Vault copy's fingerprint must match"
    sql "select left(encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex'), 8) as vault_fingerprint
  from vault.decrypted_secrets where name = '${VAULT_NAME}';"
    ;;

  schedule)
    case "${2:-}" in
      on)
        say "cron.schedule('ingest-worker', '30 seconds', <http_post to ${URL}>), then activate"
        sql "select cron.schedule('ingest-worker', '30 seconds', \$cmd\$ ${POST_SQL} \$cmd\$);
select cron.alter_job(jobid, active := true) from cron.job where jobname = 'ingest-worker';
select jobid, schedule, active from cron.job where jobname = 'ingest-worker';" ;;
      off)
        say "cron.alter_job(<ingest-worker>, active := false)"
        sql "select cron.alter_job(jobid, active := false) from cron.job where jobname = 'ingest-worker';
select jobid, schedule, active from cron.job where jobname = 'ingest-worker';" ;;
      *) echo "usage: $0 schedule on|off" >&2; exit 2 ;;
    esac
    ;;

  kick)
    say "net.http_post(${URL}) once; the worker answers 202 and works in the background"
    sql "${POST_SQL} as request_id;"
    ;;

  status)
    say "cron job and latest ingest jobs"
    sql "select jobid, schedule, active from cron.job where jobname = 'ingest-worker';
select id, document_id, status, stage, ocr_pages, pages_total, attempts, error_code,
       ocr_cost_usd, embed_cost_usd, last_change
  from (select *, coalesce(finished_at, started_at, created_at) as last_change from public.ingest_jobs) j
 order by last_change desc limit 10;"
    ;;

  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
