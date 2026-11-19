#!/usr/bin/env bash
# Real database sessions for what one transaction cannot show (migration 20261122090000, open-work F364):
#   1. two removals of one video at once refund each unlock once (the second waits for the first, then finds nothing to refund);
#   2. a removal racing an unlock by one of the refunded users: serialised by the wallet lock, no deadlock, both effects land;
#   3. an unlock open when the removal starts: the removal waits for it, then refunds it; an unlock that starts while a removal
#      is open waits, then finds the stretch gone and is not charged (the removal's lock on the credit epoch row);
#   4. the migration applied a second time is a no-op, and over a hot-fixed function it refuses (55000) and changes nothing.
# Ordered by what the database reports, not by sleeps (a gate: an advisory lock held by a session of this script keeps the
# first transaction open, holding its locks, until the second is seen waiting for a lock in pg_stat_activity).
# Run by run.sh right after the factcheck_video_remove_refund fixture passes; it copies that fixture's database (rolled back:
# schema only).
set -euo pipefail
cd "$(dirname "$0")/../.."
container=niyantran-corpus-test-db
template=niyantran_factcheck_video_remove_refund_test
db=niyantran_factcheck_video_remove_refund_race_test
migration=supabase/migrations/20261122090000_factcheck_video_remove_refund.sql
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'kill $(jobs -p) 2>/dev/null || true; cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE $template" >/dev/null
fail() { echo "FAIL: $1"; exit 1; }

ADM=00000000-0000-4000-8000-0000000ffea0
O=00000000-0000-4000-8000-0000000ffea1
P1=00000000-0000-4000-8000-0000000ffea2
P2=00000000-0000-4000-8000-0000000ffea3
P3=00000000-0000-4000-8000-0000000ffea4
P4=00000000-0000-4000-8000-0000000ffea5
P5=00000000-0000-4000-8000-0000000ffea6
q <<SQL
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO public.app_flags (key, value) VALUES ('livetv_factcheck', '{"enabled":true,"audience":"all","credits_per_minute":2,"share_recorded":true,"unlock_credits_per_minute":100}');
DO \$\$ DECLARE u uuid; sid uuid; v text; n integer; i integer; BEGIN
  FOREACH u IN ARRAY ARRAY['$ADM', '$O', '$P1', '$P2', '$P3', '$P4', '$P5']::uuid[] LOOP
    INSERT INTO auth.users (id, email, created_at) VALUES (u, u || '@example.invalid', now());
    PERFORM private.credit_wallet(u);
    PERFORM private.credit_mint(u, 'topup', 1000, now() - interval '1 minute', now() + interval '12 months', 'race:' || u, NULL, 'grant', NULL, NULL, NULL);
  END LOOP;
  UPDATE public.user_profiles SET role = 'admin', status = 'active' WHERE user_id = '$ADM';
  -- VA: two stretches (100 and 200 credits), for race 1. VB: one stretch (100), for race 2. VC: one stretch (100) to unlock in race 2.
  FOR v, n IN SELECT * FROM (VALUES ('VA', 3), ('VA', 9), ('VB', 3), ('VC', 3), ('VD', 3), ('VE', 3)) AS t(v, n) LOOP
    sid := (public.factcheck_start('$O', v, 'chan', 'recorded', 0, 5, true) ->> 'session_id')::uuid;
    PERFORM public.factcheck_mark_shareable('$O', sid);
    FOR i IN 1..n LOOP
      PERFORM public.factcheck_piece_store('$O', sid, i, (i - 1) * 10, i * 10, 'Line ' || i);
    END LOOP;
    PERFORM public.factcheck_settle('$O', sid);
  END LOOP;
  UPDATE public.factcheck_sessions SET ended_at = now() - interval '10 minutes' WHERE user_id = '$O';
END \$\$;
SQL
SA=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VA' ORDER BY (SELECT count(*) FROM private.factcheck_pieces p WHERE p.session_id = factcheck_sessions.id) LIMIT 1")
SA2=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VA' AND id <> '$SA'")
SB=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VB'")
SD=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VD'")
SE=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VE'")
SC=$(q -c "SELECT id FROM public.factcheck_sessions WHERE video_id = 'VC'")
[ "$(q -c "SELECT private.factcheck_stretch_minutes('$SA')")" = 1 ] || fail 'set-up: the short stretch of VA is not 1 minute'
[ "$(q -c "SELECT private.factcheck_stretch_minutes('$SA2')")" = 2 ] || fail 'set-up: the long stretch of VA is not 2 minutes'
q <<SQL
DO \$\$ BEGIN
  PERFORM public.factcheck_unlock('$P1', '$SA', true, 100);
  PERFORM public.factcheck_unlock('$P1', '$SA2', true, 200);
  PERFORM public.factcheck_unlock('$P2', '$SA', true, 100);
  PERFORM public.factcheck_unlock('$P3', '$SB', true, 100);
END \$\$;
SQL
[ "$(q -c "SELECT count(*) FROM public.factcheck_unlocks")" = 4 ] || fail 'set-up: four unlocks expected'
[ "$(q -c "SELECT balance FROM public.credit_wallets WHERE user_id = '$P1'")" = 700.0000 ] || fail 'set-up: user 1 should have 700 left'

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
# The statements that make the next ones run as the administrator, and put the role back.
AS_ADMIN="DO \$\$ BEGIN PERFORM set_config('request.jwt.claim.sub', '$ADM', true); END \$\$; SET LOCAL ROLE authenticated;"

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
  t0=$(date +%s.%N)
  q -c "SELECT pg_cancel_backend($gate_pid)" >/dev/null
  wait "$pf" || { cat "$work/$name.first"; exit 1; }
  wait "$ps" || { cat "$work/$name.second"; exit 1; }
  # How long the second needed after the first let go (the wait itself lasts as long as the first holds its locks).
  echo "  race $name: after the first let go, the first and second finished in $(echo "$(date +%s.%N) - $t0" | bc -l | awk '{printf "%.3f", $1}') s"

}
first_line() { grep -v '^$' "$1" | head -1; }
refunds() { q -c "SELECT count(*) FROM public.credit_ledger WHERE user_id = '$1' AND kind = 'adjustment' AND note = 'live tv fact-check unlock refund'"; }
balance() { q -c "SELECT balance FROM public.credit_wallets WHERE user_id = '$1'"; }

# 1. Two removals of one video at once: three unlocks, refunded once.
race 1 "$AS_ADMIN SELECT public.factcheck_video_remove('VA') ->> 'unlocks_refunded'; RESET ROLE;" \
       "$AS_ADMIN SELECT public.factcheck_video_remove('VA') ->> 'unlocks_refunded'; RESET ROLE;" "%factcheck_video_remove(%"
[ "$(first_line "$work/1.first")" = 3 ] || fail "two removals: the first did not refund the three unlocks ($(cat "$work/1.first"))"
[ "$(first_line "$work/1.second")" = 0 ] || fail "two removals: the second refunded again ($(cat "$work/1.second"))"
[ "$(refunds $P1)" = 2 ] || fail 'two removals: user 1 does not have exactly two refund entries'
[ "$(refunds $P2)" = 1 ] || fail 'two removals: user 2 does not have exactly one refund entry'
[ "$(balance $P1)" = 1000.0000 ] || fail "two removals: user 1 balance is not 1000 ($(balance $P1))"
[ "$(balance $P2)" = 1000.0000 ] || fail "two removals: user 2 balance is not 1000 ($(balance $P2))"
[ "$(q -c "SELECT count(*) FROM public.factcheck_unlocks WHERE video_id = 'VA' AND refunded_at IS NOT NULL")" = 3 ] || fail 'two removals: not all three unlocks marked refunded'
[ "$(q -c "SELECT count(*) FROM public.credit_wallets w WHERE w.balance <> (SELECT sum(l.credits) FROM public.credit_ledger l WHERE l.user_id = w.user_id)")" = 0 ] || fail 'two removals: a balance is not its ledger sum'
echo '  concurrency ok - two simultaneous removals refunded each of three unlocks once'

# 2. A removal racing an unlock by a refunded user: the unlock waits for the wallet, then both land.
race 2 "$AS_ADMIN SELECT public.factcheck_video_remove('VB') ->> 'unlocks_refunded'; RESET ROLE;" \
       "SELECT coalesce(public.factcheck_unlock('$P3', '$SC', true, 100) ->> 'reason', 'ok');" "%factcheck_unlock(%"
[ "$(first_line "$work/2.first")" = 1 ] || fail "removal vs unlock: the removal did not refund ($(cat "$work/2.first"))"
[ "$(first_line "$work/2.second")" = ok ] || fail "removal vs unlock: the unlock did not go through ($(cat "$work/2.second"))"
[ "$(balance $P3)" = 900.0000 ] || fail "removal vs unlock: user 3 balance is not 900 = 1000 - 100 + 100 - 100 ($(balance $P3))"
[ "$(refunds $P3)" = 1 ] || fail 'removal vs unlock: user 3 does not have exactly one refund entry'
[ "$(q -c "SELECT count(*) FROM public.factcheck_unlocks WHERE user_id = '$P3' AND video_id = 'VC' AND refunded_at IS NULL")" = 1 ] || fail 'removal vs unlock: the new unlock is missing or was refunded'
[ "$(q -c "SELECT count(*) FROM public.credit_wallets w WHERE w.balance <> (SELECT sum(l.credits) FROM public.credit_ledger l WHERE l.user_id = w.user_id)")" = 0 ] || fail 'removal vs unlock: a balance is not its ledger sum'
echo '  concurrency ok - a removal and an unlock by a refunded user both landed, no deadlock'

# 3a. An unlock open when the removal starts: the removal waits for it (it cannot take the credit epoch row while the unlock
# holds it), then sees the unlock and refunds it.
race 3 "SELECT coalesce(public.factcheck_unlock('$P4', '$SD', true, 100) ->> 'reason', 'ok');" \
       "$AS_ADMIN SELECT public.factcheck_video_remove('VD') ->> 'unlocks_refunded'; RESET ROLE;" "%factcheck_video_remove(%"
[ "$(first_line "$work/3.first")" = ok ] || fail "unlock then removal: the unlock did not go through ($(cat "$work/3.first"))"
[ "$(first_line "$work/3.second")" = 1 ] || fail "unlock then removal: the removal did not refund the unlock that was open ($(cat "$work/3.second"))"
[ "$(balance $P4)" = 1000.0000 ] || fail "unlock then removal: user 4 balance is not 1000 ($(balance $P4))"
[ "$(refunds $P4)" = 1 ] || fail 'unlock then removal: user 4 does not have exactly one refund entry'
[ "$(q -c "SELECT count(*) FROM public.factcheck_unlocks WHERE user_id = '$P4' AND video_id = 'VD' AND refunded_at IS NOT NULL")" = 1 ] || fail 'unlock then removal: the unlock is not marked refunded'
echo '  concurrency ok - an unlock open when the removal started was waited for, then refunded'

# 3b. The reverse: an unlock that starts while a removal is open waits, then finds the stretch gone and is not charged.
race 4 "$AS_ADMIN SELECT public.factcheck_video_remove('VE') ->> 'sessions'; RESET ROLE;" \
       "SELECT coalesce(public.factcheck_unlock('$P5', '$SE', true, 100) ->> 'reason', 'ok');" "%factcheck_unlock(%"
[ "$(first_line "$work/4.first")" = 1 ] || fail "removal then unlock: the removal did not remove ($(cat "$work/4.first"))"
[ "$(first_line "$work/4.second")" = not_found ] || fail "removal then unlock: the unlock was not refused as not_found ($(cat "$work/4.second"))"
[ "$(balance $P5)" = 1000.0000 ] || fail "removal then unlock: user 5 was charged ($(balance $P5))"
[ "$(q -c "SELECT count(*) FROM public.factcheck_unlocks WHERE user_id = '$P5'")" = 0 ] || fail 'removal then unlock: an unlock row was written'
[ "$(q -c "SELECT count(*) FROM public.credit_ledger WHERE user_id = '$P5' AND turn_key LIKE 'fcu:%'")" = 0 ] || fail 'removal then unlock: a charge was written'
echo '  concurrency ok - an unlock started during a removal waited, found the stretch gone and was not charged'

# 4. The migration a second time, and over a hot-fixed function. The migration is run as a non-superuser, as run.sh runs it.
migrate() { { echo "SET ROLE nter_migrator;"; cat "$migration"; } | q -v VERBOSITY=verbose 2>&1; }
src_md5() { q -c "SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.factcheck_video_remove(text)')"; }
before=$(src_md5)
[ "$before" = c0c4b68359304c0fee94dac89047da6d ] || fail "the function's md5 is $before, not the migration's"
privs_before=$(q -c "SELECT proacl::text || proowner::regrole::text FROM pg_proc WHERE oid = to_regprocedure('public.factcheck_video_remove(text)')")
migrate >/dev/null || fail 'applying the migration a second time failed'
[ "$(src_md5)" = "$before" ] || fail 'the second application changed the function'
[ "$(q -c "SELECT proacl::text || proowner::regrole::text FROM pg_proc WHERE oid = to_regprocedure('public.factcheck_video_remove(text)')")" = "$privs_before" ] || fail 'the second application changed grants or owner'
[ "$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'factcheck_unlocks' AND column_name = 'refunded_at'")" = 1 ] || fail 'the second application did not leave exactly one refunded_at'
echo '  ok - applied a second time: no change to the function, its grants or the column'
q <<'SQL'
CREATE OR REPLACE FUNCTION public.factcheck_video_remove(p_video_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN jsonb_build_object('ok', true, 'hot', 'fix'); END; $$;
SQL
hot=$(src_md5)
out=$(migrate) && fail 'the migration was applied over a hot-fixed function' || true
grep -q 'ERROR:  55000: factcheck_video_remove_refund: public.factcheck_video_remove differs' <<<"$out" || fail "the guard did not refuse with 55000 naming the function: $out"
[ "$(src_md5)" = "$hot" ] || fail 'the refused migration changed the function'
echo '  ok - over a hot-fixed function the migration refused (55000) and changed nothing'
