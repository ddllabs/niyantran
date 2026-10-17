-- F225 atomic conversion: red without 20261017194628_credit_paise_convert.sql.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END;
$$;
CREATE FUNCTION pg_temp.rejected(statement text, state text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> state THEN RAISE EXCEPTION 'FAIL: % expected %, got %',label,state,SQLSTATE; END IF;
    RAISE NOTICE 'PASS: %',label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % was accepted',label;
END;
$$;
SELECT pg_temp.assert_true(public.credit_unit() @> '{"unit_version":"credit-paise-v2","inr_per_credit":0.0100}',
  'conversion changes unit and rate together');
SELECT pg_temp.assert_true((SELECT signup_credits=10000 AND hold_credits=3000 AND usd_to_inr=95
  FROM public.credit_settings WHERE id), 'signup and hold scale without changing exchange rate');
SELECT pg_temp.assert_true((SELECT bool_and(monthly_credits = CASE plan WHEN 'plus' THEN 20000
  WHEN 'pro' THEN 65000 WHEN 'max' THEN 750000 END) FROM public.credit_plan_allowances),
  'paid monthly allowances scale');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM private.credit_paise_snapshot_ledger)
  AND NOT EXISTS (SELECT FROM private.credit_paise_snapshot_ledger s
    LEFT JOIN public.credit_ledger e ON e.id=s.id
    WHERE s.fingerprint IS DISTINCT FROM md5(row_to_json(e)::text)),
  'every original ledger row retains its full-row fingerprint');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM private.credit_paise_snapshot_draws)
  AND (SELECT count(*) FROM private.credit_paise_snapshot_draws)=(SELECT count(*) FROM public.credit_lot_draws)
  AND NOT EXISTS (SELECT FROM private.credit_paise_snapshot_draws s
    LEFT JOIN public.credit_lot_draws d ON d.id=s.id
    WHERE s.fingerprint IS DISTINCT FROM md5(row_to_json(d)::text)),
  'all original lot draws and their amounts remain exact');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM private.credit_paise_snapshot_charge_rows)
  AND (SELECT count(*) FROM private.credit_paise_snapshot_charge_rows)=(SELECT count(*) FROM public.credit_charge_rows)
  AND NOT EXISTS (SELECT FROM private.credit_paise_snapshot_charge_rows s
    LEFT JOIN public.credit_charge_rows c ON c.model_call_log_id=s.model_call_log_id
    WHERE s.fingerprint IS DISTINCT FROM md5(row_to_json(c)::text)),
  'all charge mappings and frozen USD costs remain exact');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM private.credit_paise_snapshot_holds)
  AND (SELECT count(*) FROM private.credit_paise_snapshot_holds)=(SELECT count(*) FROM public.credit_holds)
  AND NOT EXISTS (SELECT FROM private.credit_paise_snapshot_holds s
    LEFT JOIN public.credit_holds h ON h.user_id=s.user_id AND h.turn_key=s.turn_key
    WHERE s.fingerprint IS DISTINCT FROM md5(row_to_json(h)::text)),
  'all settled historical holds retain full-row fingerprints');
SELECT pg_temp.assert_true((SELECT bool_and(w.balance=c.old_balance*10 AND w.debt=c.old_debt*10)
  FROM private.credit_wallet_conversions c JOIN public.credit_wallets w USING(user_id)), 'all wallet value and debt preserved');
SELECT pg_temp.assert_true((SELECT balance=-100 AND debt=100 FROM public.credit_wallets
  WHERE user_id='00000000-0000-4000-8000-00000000e103'), 'negative balance and debt scale');
SELECT pg_temp.assert_true((SELECT balance=9000000000 AND debt=9000000000 FROM public.credit_wallets
  WHERE user_id='00000000-0000-4000-8000-00000000e106'),
  'debt-first bridge avoids transient numeric overflow at the 9b boundary');
SELECT pg_temp.assert_true((SELECT count(*)=2 AND min(remaining)=9000000000 AND max(remaining)=9000000000
  FROM public.credit_lots WHERE user_id='00000000-0000-4000-8000-00000000e106'
    AND source_key LIKE 'redenom:v2:%'), 'future large lots preserve expiry and exact remainder');
SELECT pg_temp.assert_true((SELECT credits=100 AND inr_per_credit=0.10 FROM public.credit_holds
  WHERE user_id='00000000-0000-4000-8000-00000000e102' AND turn_key='old-settled-hold'),
  'settled historical hold retains original numeric amount and unit');
SELECT pg_temp.assert_true((SELECT column_default LIKE '%0.01%' FROM information_schema.columns
  WHERE table_schema='public' AND table_name='credit_holds' AND column_name='inr_per_credit'),
  'new hold default uses current unit');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM private.credit_legacy_entries)
  AND NOT EXISTS (SELECT FROM private.credit_legacy_entries x JOIN public.credit_ledger e ON e.id=x.ledger_id
    WHERE e.kind='redenomination' OR (e.kind='charge' AND e.inr_per_credit<>0.10)),
  'all old entries retain original kind and frozen charge rate');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM private.credit_lot_conversions c
  JOIN public.credit_lots old ON old.id=c.old_lot_id
  LEFT JOIN public.credit_lots new ON new.id=c.new_lot_id
  WHERE old.granted<>c.old_granted OR (c.old_remaining>0 AND (old.remaining<>0 OR old.closed_at IS NULL
    OR new.granted<>c.old_remaining*10 OR new.remaining<>c.old_remaining*10
    OR new.starts_at<>old.starts_at OR new.expires_at<>old.expires_at OR new.kind<>old.kind))
    OR (c.old_remaining=0 AND (c.new_lot_id IS NOT NULL OR old.closed_at IS NOT NULL))),
  'each old lot keeps history and positive remainder moves to same-duration replacement');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_wallets w WHERE w.balance<>
  coalesce((SELECT sum(e.credits) FROM public.credit_ledger e WHERE e.user_id=w.user_id),0)
  OR w.balance<>coalesce((SELECT sum(o.remaining) FROM public.credit_lots o
    WHERE o.user_id=w.user_id AND o.closed_at IS NULL),0)-w.debt), 'wallet invariants after conversion');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.credit_lots o WHERE o.granted-o.remaining<>
  coalesce((SELECT sum(d.credits) FROM public.credit_lot_draws d WHERE d.lot_id=o.id),0)
  -coalesce((SELECT sum(e.credits) FROM public.credit_ledger e
    WHERE e.lot_id=o.id AND e.kind IN ('expiry','redenomination')),0)), 'per-lot conservation');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e101',true);
SELECT pg_temp.assert_true(public.my_credits() @> '{"unit_version":"credit-paise-v2","cycle":{"allowance":10000},"used_this_cycle":1000}',
  'partially spent Free cycle shows original 10x allowance and historic 10x usage');
SELECT pg_temp.assert_true(public.my_conversation_credits('d0000000-0000-4000-8000-00000000e101')
  @> '[{"credits":1000}]', 'historic conversation charge reads in current unit');
SELECT pg_temp.assert_true(public.reserve_turn_credits('00000000-0000-4000-8000-00000000e101',
  'signup-old',true) @> '{"hold":{"credits":500}}',
  'claimed turn replay projects old hold into current unit');
SELECT pg_temp.assert_true((SELECT credits=50 AND inr_per_credit=0.10 FROM public.credit_holds
  WHERE user_id='00000000-0000-4000-8000-00000000e101' AND turn_key='signup-old'),
  'claimed turn replay leaves historical hold unchanged');
SELECT pg_temp.assert_true(public.my_usage_summary(now()-interval '1 day',now()+interval '1 day')
  @> '{"credits":1000,"lifetime_credits":1000}', 'historic usage summary reads in current unit');
SELECT pg_temp.assert_true(public.model_credit_estimates()::text LIKE '%google/gemini-3.7-flash%',
  'measured model estimates remain available after conversion');
SELECT pg_temp.assert_true((SELECT (x->>'credits')::numeric=100 AND x->>'basis'='measured'
  FROM jsonb_array_elements(public.model_credit_estimates()) x
  WHERE x->>'model_id'='google/gemini-3.7-flash'),
  'measured old-unit median becomes 100 current credits');
SELECT private.credit_entry('00000000-0000-4000-8000-00000000e101','charge',-50,
  NULL,'signup-old',NULL,95,0.01,NULL,NULL);
SELECT private.credit_draw('00000000-0000-4000-8000-00000000e101',50,
  (SELECT id FROM public.credit_ledger WHERE user_id='00000000-0000-4000-8000-00000000e101'
    AND turn_key='signup-old' AND inr_per_credit=0.01),'charge',now());
INSERT INTO public.model_call_logs (id,user_id,message_id,caller,purpose,model_requested,status,cost_usd,total_tokens)
VALUES ('e0000000-0000-4000-8000-00000000e102','00000000-0000-4000-8000-00000000e101',
  'd0000000-0000-4000-8000-00000000e112','research-chat','chat_answer','google/gemini-3.7-flash','success',0.005263,50);
INSERT INTO public.credit_charge_rows (model_call_log_id,ledger_id,cost_usd)
SELECT 'e0000000-0000-4000-8000-00000000e102',id,0.005263 FROM public.credit_ledger
WHERE user_id='00000000-0000-4000-8000-00000000e101' AND turn_key='signup-old' AND inr_per_credit=0.01;
SELECT pg_temp.assert_true(public.my_credits() @> '{"used_this_cycle":1050}',
  'mixed-era Free cycle sums normalized old and new charges');
SELECT pg_temp.assert_true(public.my_conversation_credits('d0000000-0000-4000-8000-00000000e101')
  @> '[{"credits":1050}]', 'conversation combines two charge epochs');
SELECT pg_temp.assert_true(public.settle_turn_credits('00000000-0000-4000-8000-00000000e101','signup-old')
  @> '{"state":"charged","credits":1050}', 'settlement replay combines two charge epochs');
SELECT pg_temp.assert_true(public.my_usage_summary(now()-interval '1 day',now()+interval '1 day')
  @> '{"credits":1050,"lifetime_credits":1050}', 'usage summary combines two charge epochs');
SELECT pg_temp.assert_true((SELECT sum((x->>'credits')::numeric)=1050 FROM jsonb_array_elements(
  public.my_usage_timeseries(now()-interval '1 day',now()+interval '1 day','day')->'series') x),
  'timeseries combines two charge epochs');
SELECT pg_temp.assert_true((public.my_usage_activity(0,10,true,NULL,NULL,NULL)->'rows')
  @> '[{"turn_key":"signup-old","credits":1050}]', 'grouped activity combines two charge epochs');
SELECT pg_temp.assert_true((public.my_usage_activity(0,10,false,NULL,NULL,NULL)->'rows')
  @> '[{"credits":1000},{"credits":50}]', 'ungrouped activity shows each call in current unit');
INSERT INTO public.model_call_logs (id,user_id,message_id,caller,purpose,model_requested,status,cost_usd,total_tokens)
VALUES ('e0000000-0000-4000-8000-00000000e103','00000000-0000-4000-8000-00000000e101',
  'd0000000-0000-4000-8000-00000000e112','research-chat','embedding','google/gemini-3.7-flash','success',0.001,10);
SELECT pg_temp.assert_true(public.settle_turn_credits('00000000-0000-4000-8000-00000000e101','signup-old')
  @> '{"state":"charged","credits":1059.5}',
  'late model cost settles once at new rate without repricing old charges');
SELECT pg_temp.assert_true((SELECT count(*)=1 AND min(inr_per_credit)=0.01 AND min(credits)=-9.5
  FROM public.credit_ledger WHERE user_id='00000000-0000-4000-8000-00000000e101'
    AND turn_key='signup-old' AND inr_per_credit=0.01 AND credits=-9.5),
  'late settlement writes one new-unit ledger row');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e104',true);
SELECT pg_temp.assert_true(public.my_credits() @> '{"cycle":{"allowance":10000},"used_this_cycle":10000}',
  'fully spent Free cycle retains original allowance');
SELECT pg_temp.assert_true((public.admin_adjust_credits('00000000-0000-4000-8000-00000000e102',25,
  'topup','Pre-cutover request','00000000-0000-4000-8000-00000000e199',
  'a0000000-0000-4000-8000-00000000e102')) @> '{"repeated":true,"credits":250,"unit_version":"credit-paise-v2"}',
  'old request id repeats exactly once and returns current-unit amount');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits_v2('00000000-0000-4000-8000-00000000e102',25,
  'topup','Pre-cutover request','00000000-0000-4000-8000-00000000e199','a0000000-0000-4000-8000-00000000e102',
  'credit-paise-v2')$q$,'22023','old request rejects new-unit tag even with matching number');
SELECT pg_temp.assert_true(public.admin_adjust_credits_v2('00000000-0000-4000-8000-00000000e102',5,
  'topup','New request','00000000-0000-4000-8000-00000000e199','a0000000-0000-4000-8000-00000000e105',
  'credit-paise-v2') @> '{"credits":5,"unit_version":"credit-paise-v2"}', 'new versioned adjustment accepted');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits_v2('00000000-0000-4000-8000-00000000e102',5,
  'topup','New request','00000000-0000-4000-8000-00000000e199','a0000000-0000-4000-8000-00000000e105',
  NULL)$q$,'22023','new request replay rejects absent version');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits_v2('00000000-0000-4000-8000-00000000e102',5,
  'topup','New stale request','00000000-0000-4000-8000-00000000e199','a0000000-0000-4000-8000-00000000e103',
  'credit-ten-paise-v1')$q$,'22023','stale new adjustment rejects');
SELECT pg_temp.rejected($q$SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000e102',5,
  'topup','Unversioned new request','00000000-0000-4000-8000-00000000e199',
  'a0000000-0000-4000-8000-00000000e104')$q$,'22023','legacy unversioned new adjustment rejects');
SELECT pg_temp.rejected($q$SELECT private.credit_convert_to_paise()$q$,'55000','second conversion refuses');
ROLLBACK;
