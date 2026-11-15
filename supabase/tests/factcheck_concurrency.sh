#!/usr/bin/env bash
# Real database sessions racing each other on the fact-check functions (migration 20261116090000), which one
# transaction cannot show:
#   1. two settles of one session at once: one charge;
#   2. two starts for one user at once: one session, one hold;
#   3. a settle that holds the locks while a transcribe touch arrives: the touch finds the session settled and the
#      charge is unchanged;
#   4. a transcribe touch that holds the session while a settle arrives: the settle waits for it and charges up to the
#      touch.
# Each race is ordered by what the database reports, not by sleeps: a gate (an advisory lock held by a session of
# this script) keeps the first transaction open, holding its locks, until the second is seen waiting for a lock in
# pg_stat_activity; only then is the gate released. Every wait is a bounded poll that fails with a message.
# Run by run.sh right after the factcheck fixture passes; it copies that fixture's database (the fixture ends in a
# rollback, so the copy holds the schema and no rows).
set -euo pipefail
container=niyantran-corpus-test-db
template=niyantran_factcheck_test
db=niyantran_factcheck_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE $template" >/dev/null

A=00000000-0000-4000-8000-0000000fcea1
B=00000000-0000-4000-8000-0000000fcea2
C=00000000-0000-4000-8000-0000000fcea3
D=00000000-0000-4000-8000-0000000fcea4

q <<SQL
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', '{"enabled":true,"audience":"admin","credits_per_minute":2}');
DO \$\$ DECLARE u uuid; BEGIN
  FOREACH u IN ARRAY ARRAY['$A', '$B', '$C', '$D']::uuid[] LOOP
    INSERT INTO auth.users (id, email, created_at) VALUES (u, u || '@example.invalid', now());
    PERFORM private.credit_wallet(u);
    PERFORM private.credit_mint(u, 'topup', 1000, now() - interval '1 minute', now() + interval '12 months', 'race:' || u,
      NULL, 'grant', NULL, NULL, NULL);
  END LOOP;
END \$\$;
SQL

# Starts a 10-minute session for a user and moves it 100 s into the past; prints its id.
session() {
  local u=$1 sid
  sid=$(q -c "SELECT public.factcheck_start('$u', 'vid', 'chan', 'live', NULL, 10, true) ->> 'session_id'")
  q -c "UPDATE public.factcheck_sessions SET started_at = clock_timestamp() - interval '100 seconds',
        last_activity_at = clock_timestamp() - interval '100 seconds' WHERE id = '$sid'"
  echo "$sid"
}
fail() { echo "FAIL: $1"; exit 1; }

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

# 1. Two settles at once: the second waits for the first, then finds the session settled.
S1=$(session "$A")
race 1 "SELECT public.factcheck_settle('$A', '$S1') ->> 'repeated';" "SELECT public.factcheck_settle('$A', '$S1') ->> 'repeated';" '%factcheck_settle(%'
[ "$(first_line "$work/1.first")" = false ] || fail 'two settles: the first did not charge'
[ "$(first_line "$work/1.second")" = true ] || fail 'two settles: the second did not see the first'
[ "$(q -c "SELECT count(*) FROM public.credit_ledger WHERE user_id = '$A' AND kind = 'charge'")" = 1 ] || fail 'two settles: more than one charge entry'
[ "$(q -c "SELECT balance FROM public.credit_wallets WHERE user_id = '$A'")" = 998.0000 ] || fail 'two settles: wrong balance'
echo '  concurrency ok - two settles of one session made one charge'

# 2. Two starts at once: the second waits for the first, then is refused.
race 2 "SELECT coalesce(public.factcheck_start('$B', 'vid', 'chan', 'live', NULL, 10, true) ->> 'reason', 'ok');" \
  "SELECT coalesce(public.factcheck_start('$B', 'vid', 'chan', 'live', NULL, 10, true) ->> 'reason', 'ok');" '%factcheck_start(%'
[ "$(first_line "$work/2.first")" = ok ] || fail 'two starts: the first did not start'
[ "$(first_line "$work/2.second")" = already_active ] || fail 'two starts: the second was not refused'
[ "$(q -c "SELECT count(*) FROM public.factcheck_sessions WHERE user_id = '$B'")" = 1 ] || fail 'two starts: more than one session'
[ "$(q -c "SELECT count(*) FROM public.credit_holds WHERE user_id = '$B' AND turn_key LIKE 'fc:%'")" = 1 ] || fail 'two starts: more than one hold'
echo '  concurrency ok - two starts for one user made one session and one hold'

# 3. A settle holds the locks; a transcribe touch arrives and waits.
S3=$(session "$C")
race 3 "SELECT public.factcheck_settle('$C', '$S3') ->> 'minutes_used';" \
  "SELECT coalesce(public.factcheck_touch('$C', '$S3', 'transcribe') ->> 'reason', 'ok');" '%factcheck_touch(%'
[ "$(first_line "$work/3.first")" = 1 ] || fail 'settle then touch: the charge was not 1 minute'
[ "$(first_line "$work/3.second")" = settled ] || fail 'settle then touch: the touch did not find the session settled'
echo '  concurrency ok - a touch arriving during a settle finds the session settled'

# 4. A transcribe touch holds the session; a settle arrives and waits for it.
S4=$(session "$D")
race 4 "SELECT coalesce(public.factcheck_touch('$D', '$S4', 'transcribe') ->> 'reason', 'ok');" \
  "SELECT public.factcheck_settle('$D', '$S4') ->> 'minutes_used';" '%factcheck_settle(%'
[ "$(first_line "$work/4.first")" = ok ] || fail 'touch then settle: the touch was refused'
[ "$(first_line "$work/4.second")" = 2 ] || fail 'touch then settle: the settle did not charge up to the touch (expected 2 minutes)'
echo '  concurrency ok - a settle arriving during a touch waits and charges up to it'
