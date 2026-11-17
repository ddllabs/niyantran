#!/usr/bin/env bash
# Real database sessions racing on the unlock (migration 20261117090000), which one transaction cannot show:
#   1. two unlocks of one stretch by one user at once: one charge, one unlock row; the other call answers repeated;
#   2. the same race for the other order of arrival (the wallet lock makes the second wait for the first).
# Ordered by what the database reports, not by sleeps (a gate: an advisory lock held by a session of this script keeps the
# first transaction open, holding its locks, until the second is seen waiting for a lock in pg_stat_activity).
# Run by run.sh right after the factcheck_sharing fixture passes; it copies that fixture's database (rolled back: schema only).
set -euo pipefail
container=niyantran-corpus-test-db
template=niyantran_factcheck_sharing_test
db=niyantran_factcheck_sharing_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE $template" >/dev/null
fail() { echo "FAIL: $1"; exit 1; }

O=00000000-0000-4000-8000-0000000ffea1
B1=00000000-0000-4000-8000-0000000ffea2
B2=00000000-0000-4000-8000-0000000ffea3
q <<SQL
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":100}');
DO \$\$ DECLARE u uuid; sid uuid; i integer; BEGIN
  FOREACH u IN ARRAY ARRAY['$O', '$B1', '$B2']::uuid[] LOOP
    INSERT INTO auth.users (id, email, created_at) VALUES (u, u || '@example.invalid', now());
    PERFORM private.credit_wallet(u);
    PERFORM private.credit_mint(u, 'topup', CASE WHEN u = '$B2'::uuid THEN 150 ELSE 1000 END, now() - interval '1 minute', now() + interval '12 months', 'race:' || u, NULL, 'grant', NULL, NULL, NULL);
  END LOOP;
  sid := (public.factcheck_start('$O', 'VR', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM public.factcheck_mark_shareable('$O', sid);
  FOR i IN 1..3 LOOP PERFORM public.factcheck_piece_store('$O', sid, i, (i - 1) * 10, i * 10, 'Line ' || i); END LOOP;
  PERFORM public.factcheck_settle('$O', sid);
  sid := (public.factcheck_start('$O', 'VR2', 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
  PERFORM public.factcheck_mark_shareable('$O', sid);
  FOR i IN 1..3 LOOP PERFORM public.factcheck_piece_store('$O', sid, i, (i - 1) * 10, i * 10, 'Line ' || i); END LOOP;
  PERFORM public.factcheck_settle('$O', sid);
  UPDATE public.factcheck_sessions SET ended_at = now() - interval '10 minutes' WHERE user_id = '$O';
END \$\$;
SQL
S=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VR'")
S2=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VR2'")

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



# 1. Two unlocks of one stretch by one user at once.
race 1 "SELECT public.factcheck_unlock('$B1', '$S', true, 100) ->> 'repeated';" "SELECT public.factcheck_unlock('$B1', '$S', true, 100) ->> 'repeated';" '%factcheck_unlock(%'
[ "$(first_line "$work/1.first")" = false ] || fail 'two unlocks: the first did not charge'
[ "$(first_line "$work/1.second")" = true ] || fail 'two unlocks: the second did not see the first (repeated)'
[ "$(q -c "SELECT count(*) FROM public.credit_ledger WHERE user_id = '$B1' AND turn_key LIKE 'fcu:%'")" = 1 ] || fail 'two unlocks: more than one ledger entry'
[ "$(q -c "SELECT count(*) FROM public.factcheck_unlocks WHERE user_id = '$B1' AND session_id = '$S'")" = 1 ] || fail 'two unlocks: more than one unlock row'
[ "$(q -c "SELECT balance FROM public.credit_wallets WHERE user_id = '$B1'")" = 900.0000 ] || fail 'two unlocks: wrong balance'
echo '  concurrency ok - two unlocks of one stretch made one charge and one unlock'

# 2. Two unlocks of different stretches by one user with credits for one: serialised by the wallet lock, exactly one is charged.
race 2 "SELECT coalesce(public.factcheck_unlock('$B2', '$S', true, 100) ->> 'reason', 'ok');" "SELECT coalesce(public.factcheck_unlock('$B2', '$S2', true, 100) ->> 'reason', 'ok');" '%factcheck_unlock(%'
[ "$(first_line "$work/2.first")" = ok ] || fail 'two stretches: the first was not unlocked'
[ "$(first_line "$work/2.second")" = insufficient ] || fail 'two stretches: the second was not refused for credits'
[ "$(q -c "SELECT count(*) FROM public.factcheck_unlocks WHERE user_id = '$B2'")" = 1 ] || fail 'two stretches: not exactly one unlock'
[ "$(q -c "SELECT balance FROM public.credit_wallets WHERE user_id = '$B2'")" = 50.0000 ] || fail 'two stretches: wrong balance'
echo '  concurrency ok - two unlocks with credits for one: exactly one charged'
