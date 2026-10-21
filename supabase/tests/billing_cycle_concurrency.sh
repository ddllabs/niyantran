#!/usr/bin/env bash
# Real contention against a disposable clone of the cycle fixture only.
set -euo pipefail
container=niyantran-corpus-test-db
db=niyantran_billing_cycle_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE niyantran_billing_cycle_changes_test" >/dev/null
# Copy only the synthetic buy helper, not the fixture transaction/assertions.
sed -n '/^CREATE FUNCTION pg_temp.assert/,/^END \$\$;/p' supabase/tests/billing_cycle_changes.sql > "$work/helper.sql"
# The first assertion and buy helper have separate terminators. Keep the helper exact.
python3 - "$work/helper.sql" <<'PY'
from pathlib import Path
import sys
s=Path('supabase/tests/billing_cycle_changes.sql').read_text()
a=s.index('CREATE FUNCTION pg_temp.buy_v2');b=s.index('END $$;',a)+len('END $$;')
Path(sys.argv[1]).write_text("CREATE FUNCTION pg_temp.assert(ok boolean,why text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',why; END IF; END $$;\n"+s[a:b])
PY
cat "$work/helper.sql" > "$work/seed.sql"
cat >> "$work/seed.sql" <<'SQL'
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('b0000000-0000-4000-8000-000000000099','cycle-race@fixture.test',now());
UPDATE public.user_profiles SET status='active' WHERE user_id='b0000000-0000-4000-8000-000000000099';
DO $$ DECLARE buyer uuid:='b0000000-0000-4000-8000-000000000099'; oid uuid; args jsonb; quote jsonb; o jsonb;
BEGIN
 oid:=pg_temp.buy_v2(buyer,'plus');
 UPDATE private.billing_plan_periods SET starts_at=now()-interval '15 days',ends_at=now()+interval '15 days',anchor_at=now()-interval '15 days' WHERE order_id=oid;
 UPDATE public.credit_lots SET starts_at=now()-interval '15 days',expires_at=now()+interval '15 days' WHERE billing_order_id=oid;
 UPDATE public.user_profiles SET plan_period_end=now()+interval '15 days' WHERE user_id=buyer;
 args:=jsonb_build_object('userId',buyer,'account','acc_cycle','mode','test','planId','pro');
 quote:=public.billing_cycle('quote',args);
 o:=public.billing_cycle('claim',args||jsonb_build_object('quoteId',quote->>'quoteId','requestId',gen_random_uuid(),'requestHash','cycle-race','snapshot',jsonb_build_object('buyerEmail','cycle-race@fixture.test')));
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_cyclerace','receipt',o->>'id','amount',o->>'amount_paise','currency','INR')));
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment',jsonb_build_object('id','pay_cyclerace','order_id','order_cyclerace','amount',o->>'amount_paise','currency','INR','status','captured')));
END $$;
SQL
q < "$work/seed.sql" > "$work/seed.out"
for n in 1 2; do
 (q <<'SQL' >"$work/capture_$n" 2>&1
BEGIN;
SELECT public.billing_cycle_capture((SELECT id FROM private.billing_orders WHERE provider_order_id='order_cyclerace'),(SELECT jsonb_build_object('id','pay_cyclerace','order_id','order_cyclerace','amount',amount_paise,'currency','INR','status','captured') FROM private.billing_orders WHERE provider_order_id='order_cyclerace'));
SELECT pg_sleep(0.5);
COMMIT;
SQL
 ) &
 if [ "$n" = 1 ]; then first=$!; else second=$!; fi
done
wait "$first" || { cat "$work/capture_1"; exit 1; }
wait "$second" || { cat "$work/capture_2"; exit 1; }
result=$(q <<'SQL'
SELECT (SELECT count(*) FROM public.invoices)=2
 AND (SELECT count(*) FROM public.credit_lots WHERE kind='monthly')=2
 AND (SELECT count(*) FROM private.billing_plan_periods WHERE state='active')=1
 AND (SELECT sum(granted) FROM public.credit_lots WHERE kind='monthly')=42500;
SQL
)
[ "$result" = t ] || { echo 'FAIL: concurrent upgrade duplicated benefits'; exit 1; }
echo '  concurrency ok - two upgrade capture sessions, one increment and invoice'
