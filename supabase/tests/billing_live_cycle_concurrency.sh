#!/usr/bin/env bash
# Real two-session capture contention on a disposable clone of the v2 chain.
set -euo pipefail
container=niyantran-corpus-test-db
db=niyantran_billing_live_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE niyantran_billing_live_cycle_test" >/dev/null
python3 - "$work/seed.sql" <<'PY'
from pathlib import Path
import sys
s=Path('supabase/tests/billing_live_cycle.sql').read_text()
a=s.index('CREATE FUNCTION pg_temp.buy(');b=s.index('END $$;',a)+len('END $$;')
Path(sys.argv[1]).write_text("CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;\n"+s[a:b])
PY
cat >> "$work/seed.sql" <<'SQL'
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('b0000000-0000-4000-8000-000000000099','live-race@fixture.test',now());
UPDATE public.user_profiles SET status='active' WHERE user_id='b0000000-0000-4000-8000-000000000099';
DO $$ DECLARE uid uuid:='b0000000-0000-4000-8000-000000000099'; args jsonb; quote jsonb; o jsonb;
BEGIN
 PERFORM pg_temp.buy(uid,'plus','live');
 args:=jsonb_build_object('userId',uid,'account','acc_modes','mode','live','planId','pro');
 quote:=public.billing_cycle_v2('quote',args);
 o:=public.billing_cycle_v2('claim',args||jsonb_build_object('quoteId',quote->>'quoteId','requestId',gen_random_uuid(),'requestHash','v2-race','snapshot',jsonb_build_object('buyerEmail','live-race@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_liveRace','receipt',o->>'id','amount',o->>'amount_paise','currency','INR')));
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',jsonb_build_object('id','pay_liveRace','order_id','order_liveRace','amount',o->>'amount_paise','currency','INR','status','captured')));
END $$;
SQL
q < "$work/seed.sql" > "$work/seed.out"
cat > "$work/capture.sql" <<'SQL'
BEGIN;
SET application_name='billing-v2-capture';
SELECT public.billing_cycle_capture_v2((SELECT id FROM private.billing_orders WHERE provider_order_id='order_liveRace'),(SELECT jsonb_build_object('id','pay_liveRace','order_id','order_liveRace','amount',amount_paise,'currency','INR','status','captured') FROM private.billing_orders WHERE provider_order_id='order_liveRace'),'{"account":"acc_modes","mode":"live"}');
SELECT pg_sleep(1);
COMMIT;
SQL
q < "$work/capture.sql" > "$work/first" 2>&1 & first=$!
for _ in $(seq 1 50); do
 grep -q '"ok": true' "$work/first" && break
 sleep 0.05
done
q < "$work/capture.sql" > "$work/second" 2>&1 & second=$!
blocked=false
for _ in $(seq 1 20); do
 if [ "$(q -c "SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND application_name='billing-v2-capture' AND wait_event_type='Lock')")" = t ]; then blocked=true; break; fi
 sleep 0.05
done
wait "$first" || { cat "$work/first"; exit 1; }
wait "$second" || { cat "$work/second"; exit 1; }
[ "$blocked" = true ] || { echo 'FAIL: capture contention was not observed'; exit 1; }
result=$(q -c "SELECT (SELECT count(*) FROM public.invoices)=2 AND (SELECT count(*) FROM public.credit_lots WHERE kind='monthly')=2 AND (SELECT count(*) FROM private.billing_plan_periods WHERE state='active')=1 AND (SELECT sum(granted) FROM public.credit_lots WHERE kind='monthly')=65000")
[ "$result" = t ] || { echo 'FAIL: duplicate Live capture financial effects'; exit 1; }
echo '  v2 Live capture concurrency ok (lock contention observed)'
