#!/usr/bin/env bash
# Disposable concurrency proof; source database is the completed billing fixture.
set -euo pipefail
container=niyantran-corpus-test-db
db=niyantran_billing_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db" >/dev/null; }
cleanup
trap cleanup EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE niyantran_billing_purchases_test" >/dev/null
q <<'SQL'
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('b0000000-0000-4000-8000-000000000099','race@billing.test',now());
DO $$ DECLARE o jsonb; BEGIN
 o:=public.billing_order('claim','{"userId":"b0000000-0000-4000-8000-000000000099","requestId":"a0000000-0000-4000-8000-000000000099","requestHash":"race","account":"acc_race","mode":"test","snapshot":{"kind":"topup","productId":"topup-20000","credits":20000,"amountPaise":49900,"currency":"INR","creditUnit":"credit-paise-v2","buyerEmail":"race@billing.test"}}');
 PERFORM public.billing_order('bind',jsonb_build_object('purchaseId',o->>'id','order',jsonb_build_object('id','order_race','receipt',o->>'id','amount',49900,'currency','INR')));
 PERFORM public.billing_order('payment',jsonb_build_object('purchaseId',o->>'id','payment','{"id":"pay_race","order_id":"order_race","amount":49900,"currency":"INR","status":"captured"}'::jsonb));
END $$;
SQL
work=$(mktemp -d)
# Both sessions request the exact same captured payment. First keeps its locks
# through a short delay so the second actually contends on the transaction.
(q <<'SQL' >"$work/first" 2>&1
BEGIN;
SELECT public.billing_capture((SELECT id FROM private.billing_orders WHERE provider_order_id='order_race'),'{"id":"pay_race","order_id":"order_race","amount":49900,"currency":"INR","status":"captured"}');
SELECT pg_sleep(0.5);
COMMIT;
SQL
) & first=$!
(q <<'SQL' >"$work/second" 2>&1
BEGIN;
SELECT public.billing_capture((SELECT id FROM private.billing_orders WHERE provider_order_id='order_race'),'{"id":"pay_race","order_id":"order_race","amount":49900,"currency":"INR","status":"captured"}');
COMMIT;
SQL
) & second=$!
if ! wait "$first"; then cat "$work/first"; exit 1; fi
if ! wait "$second"; then cat "$work/second"; exit 1; fi
result=$(q <<'SQL'
SELECT (SELECT count(*) FROM public.invoices)=1
 AND (SELECT count(*) FROM public.credit_lots WHERE kind='topup')=1
 AND (SELECT balance FROM public.credit_wallets WHERE user_id='b0000000-0000-4000-8000-000000000099')=30000;
SQL
)
rm -rf "$work"
[ "$result" = t ] || { echo 'FAIL: concurrent capture duplicated financial effects'; exit 1; }
echo '  concurrency ok - two sessions, one top-up and invoice'
