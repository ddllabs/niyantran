#!/usr/bin/env bash
# Two real database sessions must contend for one same-intent retry permission.
set -euo pipefail
container=niyantran-corpus-test-db
db=niyantran_billing_retry_race_test
q() { docker exec -i "$container" psql -U postgres -X -v ON_ERROR_STOP=1 -qAt -d "$db" "$@"; }
cleanup() { docker exec "$container" psql -U postgres -q -c "DROP DATABASE IF EXISTS $db" >/dev/null; }
cleanup
work=$(mktemp -d)
trap 'cleanup; rm -rf "$work"' EXIT
docker exec "$container" psql -U postgres -q -c "CREATE DATABASE $db TEMPLATE niyantran_billing_creation_retry_test" >/dev/null
q <<'SQL'
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users(id,email) VALUES('c0000000-0000-4000-8000-000000000099','retry-race@fixture.test');
UPDATE public.user_profiles SET status='active' WHERE user_id='c0000000-0000-4000-8000-000000000099';
DO $$ DECLARE o jsonb; BEGIN
 o:=public.billing_order('claim','{"userId":"c0000000-0000-4000-8000-000000000099","requestId":"c0000000-0000-4000-8000-000000000098","requestHash":"retry-race","account":"acc_race","mode":"test","snapshot":{"kind":"topup","productId":"topup-20000","credits":20000,"amountPaise":49900,"currency":"INR","creditUnit":"credit-paise-v2"}}');
 PERFORM public.billing_creation_retry('reject',jsonb_build_object('purchaseId',o->>'id','userId',o->>'user_id','account','acc_race','mode','test','providerStatus',401));
END $$;
SQL
for worker in first second; do
 (q <<'SQL' >"$work/$worker" 2>&1
BEGIN;
SELECT public.billing_creation_retry('claim',jsonb_build_object('purchaseId',(SELECT id FROM private.billing_orders WHERE account='acc_race'),'userId','c0000000-0000-4000-8000-000000000099','account','acc_race','mode','test'))->>'canCreate';
SELECT pg_sleep(0.5);
COMMIT;
SQL
 ) &
 if [ "$worker" = first ]; then first=$!; else second=$!; fi
done
wait "$first" || { cat "$work/first"; exit 1; }
wait "$second" || { cat "$work/second"; exit 1; }
[ "$(cat "$work/first" "$work/second" | grep -c '^true$')" = 1 ] || { echo 'FAIL: more than one retry worker'; exit 1; }
[ "$(cat "$work/first" "$work/second" | grep -c '^false$')" = 1 ] || { echo 'FAIL: contender did not remain pending'; exit 1; }
echo '  concurrency ok - two sessions, one retry lease'
