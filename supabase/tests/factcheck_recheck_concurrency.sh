#!/usr/bin/env bash
# Real database sessions racing on the re-check functions (migration 20261116110000), which one transaction cannot show:
#   1. two begins at once for one user with credits for only one: the wallet lock serialises them, exactly one is ok and
#      the other sees the first in flight (insufficient);
#   2. two charges of one finished re-check at once: one ledger entry, the other answers repeated.
# Each race is ordered by what the database reports, not by sleeps (a gate: an advisory lock held by a session of this script
# keeps the first transaction open, holding its locks, until the second is seen waiting for a lock in pg_stat_activity).
# Run by run.sh right after the factcheck_recheck fixture passes; it copies that fixture's database (rolled back, so schema only).
set -euo pipefail
container=niyantran-corpus-test-db
template=niyantran_factcheck_recheck_test
db=niyantran_factcheck_recheck_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE $template" >/dev/null
fail() { echo "FAIL: $1"; exit 1; }

A=00000000-0000-4000-8000-0000000fe0a1
B=00000000-0000-4000-8000-0000000fe0a2
q <<SQL
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', '{"enabled":true,"audience":"admin","credits_per_minute":2,"recheck_credits":100}');
DO \$\$ DECLARE u uuid; sid uuid; BEGIN
  FOREACH u IN ARRAY ARRAY['$A', '$B']::uuid[] LOOP
    INSERT INTO auth.users (id, email, created_at) VALUES (u, u || '@example.invalid', now());
    PERFORM private.credit_wallet(u);
    PERFORM private.credit_mint(u, 'topup', 150, now() - interval '1 minute', now() + interval '12 months', 'race:' || u, NULL, 'grant', NULL, NULL, NULL);
    sid := (public.factcheck_start(u, 'vid', 'chan', 'live', NULL, 5, true) ->> 'session_id')::uuid;
    PERFORM public.factcheck_settle(u, sid);                      -- charged 2: 148 left
    FOR i IN 1..2 LOOP
      INSERT INTO public.factcheck_claims (session_id, user_id, video_id, video_kind, spoken_at, quote, claim_en, kind, status, verdict, reason, sources, checked_at)
      VALUES (sid, u, 'vid', 'live', now(), 'Quote ' || i, 'Claim ' || i, 'claim', 'checked', 'supported', 'Because.', '[]', now());
    END LOOP;
  END LOOP;
END \$\$;
SQL
claim() { q -c "SELECT id FROM public.factcheck_claims WHERE user_id = '$1' AND quote = 'Quote $2'"; }

# Polls (about 30 s at most) until the SQL returns t.
poll() {
  local label=$1 sql=$2 i
  for i in $(seq 1 300); do
    [ "$(q -c "$sql")" = t ] && return 0
    sleep 0.1
  done
  fail "timed out waiting for: $label"
}
# Is some other backend of this database waiting for a lock while running a statement like the pattern?
waiting() {
  echo "SELECT EXISTS (SELECT FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND state = 'active' AND wait_event_type = 'Lock' AND query LIKE '$1')"
}

# race NAME FIRST_SQL SECOND_SQL SECOND_PATTERN
# FIRST_SQL runs in a transaction that then waits at the gate with its locks held. SECOND_SQL starts once the first is
# at the gate and must be seen waiting for a lock (a statement matching SECOND_PATTERN) before the gate opens.
# Output: $work/NAME.first and $work/NAME.second.
race() {
  local name=$1 first=$2 second=$3 pattern=$4 gate_pid pf ps
  (q >/dev/null 2>&1 <<SQL
BEGIN;
SELECT pg_advisory_xact_lock(7001);
SELECT pg_sleep(120);
COMMIT;
SQL
  ) &
  poll "the gate to be held" "SELECT EXISTS (SELECT FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event = 'PgSleep' AND query LIKE 'SELECT pg_sleep(120)%')"
  gate_pid=$(q -c "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event = 'PgSleep' AND query LIKE 'SELECT pg_sleep(120)%'")
  (q >"$work/$name.first" 2>&1 <<SQL
BEGIN;
$first
SELECT pg_advisory_xact_lock(7001);
COMMIT;
SQL
  ) &
  pf=$!
  poll "the first transaction to reach the gate holding its locks" "$(waiting 'SELECT pg_advisory_xact_lock(7001)%')"
  (q >"$work/$name.second" 2>&1 <<SQL
BEGIN;
$second
COMMIT;
SQL
  ) &
  ps=$!
  poll "the second transaction to wait for a lock" "$(waiting "$pattern")"
  q -c "SELECT pg_cancel_backend($gate_pid)" >/dev/null
  wait "$pf" || { cat "$work/$name.first"; exit 1; }
  wait "$ps" || { cat "$work/$name.second"; exit 1; }
}
first_line() { grep -v '^$' "$1" | head -1; }
last_line() { grep -v '^$' "$1" | tail -1; }


# 1. Two begins at once: 148 credits, 100 each.
C1=$(claim "$A" 1); C2=$(claim "$A" 2)
race 1 "SELECT coalesce(public.factcheck_recheck_begin('$A', '$C1', true, 100) ->> 'reason', 'ok');" \
  "SELECT coalesce(public.factcheck_recheck_begin('$A', '$C2', true, 100) ->> 'reason', 'ok');" '%factcheck_recheck_begin(%'
[ "$(first_line "$work/1.first")" = ok ] || fail 'two begins: the first was not ok'
[ "$(first_line "$work/1.second")" = insufficient ] || fail 'two begins: the second did not see the first in flight (insufficient)'
[ "$(q -c "SELECT count(*) FROM public.factcheck_claims WHERE user_id = '$A' AND supersedes IS NOT NULL")" = 1 ] || fail 'two begins: more than one re-check row'
echo '  concurrency ok - two begins with credits for one: exactly one ok, the other sees it in flight'

# 2. Two charges of one finished re-check at once.
BC=$(claim "$B" 1)
K=$(q -c "SELECT public.factcheck_recheck_begin('$B', '$BC', true, 100) ->> 'claim_id'")
q -c "UPDATE public.factcheck_claims SET status = 'checked', verdict = 'partly_true', reason = 'New.', sources = '[]', checked_at = now() WHERE id = '$K'"
race 2 "SELECT public.factcheck_recheck_charge('$B', '$K') ->> 'repeated';" "SELECT public.factcheck_recheck_charge('$B', '$K') ->> 'repeated';" '%factcheck_recheck_charge(%'
[ "$(first_line "$work/2.first")" = false ] || fail 'two charges: the first did not charge'
[ "$(first_line "$work/2.second")" = true ] || fail 'two charges: the second did not see the first'
[ "$(q -c "SELECT count(*) FROM public.credit_ledger WHERE user_id = '$B' AND turn_key LIKE 'fcr:%'")" = 1 ] || fail 'two charges: more than one ledger entry'
[ "$(q -c "SELECT balance FROM public.credit_wallets WHERE user_id = '$B'")" = 48.0000 ] || fail 'two charges: wrong balance'
echo '  concurrency ok - two charges of one re-check made one ledger entry'
