#!/usr/bin/env bash
# Distinct captured renewal orders contend on the buyer, not the same order.
# Only the winner may allocate the anchored month; the second enters review.
set -euo pipefail
container=niyantran-corpus-test-db
db=niyantran_billing_manual_grace_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE niyantran_billing_manual_grace_test" >/dev/null
python3 - "$work/seed.sql" <<'PY'
from pathlib import Path
import sys
s=Path('supabase/tests/billing_manual_grace.sql').read_text()
a=s.index('CREATE FUNCTION pg_temp.assert'); b=s.index('SELECT pg_temp.assert',a)
c=s.index('-- BEGIN HELPERS'); d=s.index('-- END HELPERS',c)
Path(sys.argv[1]).write_text(s[a:b]+"ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();\nALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;\n"+s[c:d])
PY
cat >> "$work/seed.sql" <<'SQL'
DO $$ DECLARE uid uuid:=pg_temp.buyer(); oid uuid; i int; o private.billing_orders;
BEGIN
 oid:=pg_temp.buy(uid,'plus','live'); PERFORM pg_temp.expire(oid);
 FOR i IN 1..2 LOOP
  oid:=pg_temp.prepare(uid,'pro','live'); SELECT * INTO o FROM private.billing_orders WHERE id=oid;
  PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',oid,'payment',jsonb_build_object('id','pay_'||replace(oid::text,'-',''),
   'order_id',o.provider_order_id,'amount',o.amount_paise,'currency','INR','status','captured')));
 END LOOP;
END $$;
SQL
q < "$work/seed.sql" > "$work/seed.out"
for index in 0 1; do
 cat > "$work/capture-$index.sql" <<SQL
BEGIN;
SET application_name='billing-manual-grace-capture';
SELECT public.billing_cycle_capture_v3(o.id,jsonb_build_object('id','pay_'||replace(o.id::text,'-',''),'order_id',o.provider_order_id,'amount',o.amount_paise,'currency','INR','status','captured'),'{"account":"acc_grace","mode":"live"}')
 FROM private.billing_orders o WHERE snapshot->>'accessGrace'='true' ORDER BY id LIMIT 1 OFFSET $index;
SELECT pg_sleep(1);
COMMIT;
SQL
done
q < "$work/capture-0.sql" > "$work/first" 2>&1 & first=$!
for _ in $(seq 1 80); do
 grep -q '"ok": true' "$work/first" && break
 sleep 0.025
done
q < "$work/capture-1.sql" > "$work/second" 2>&1 & second=$!
blocked=false
for _ in $(seq 1 30); do
 if [ "$(q -c "SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND application_name='billing-manual-grace-capture' AND wait_event_type='Lock')")" = t ]; then blocked=true; break; fi
 sleep 0.025
done
wait "$first" || { cat "$work/first"; exit 1; }
wait "$second" || { cat "$work/second"; exit 1; }
[ "$blocked" = true ] || { echo 'FAIL: competing grace captures never contended'; exit 1; }
grep -q '"status": "review"' "$work/second" || { cat "$work/second"; echo 'FAIL: losing captured renewal did not enter review'; exit 1; }
result=$(q -c "SELECT (SELECT count(*) FROM public.invoices)=2 AND (SELECT count(*) FROM public.credit_lots WHERE kind='monthly')=2 AND (SELECT count(*) FROM private.billing_plan_periods)=2 AND (SELECT count(*) FROM private.billing_orders WHERE snapshot->>'accessGrace'='true' AND state='fulfilled')=1 AND (SELECT count(*) FROM private.billing_orders WHERE state='review')=1 AND (SELECT count(*) FROM private.billing_plan_periods WHERE starts_at<=now() AND ends_at>now() AND state='active')=1")
[ "$result" = t ] || { echo 'FAIL: competing grace renewals duplicated or lost financial effects'; exit 1; }
echo '  distinct grace renewal capture concurrency ok (lock contention observed)'
