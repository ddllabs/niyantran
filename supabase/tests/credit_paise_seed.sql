-- Disposable pre-cutover fixture state; run.sh does not treat this as a test.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
INSERT INTO auth.users (id,email,email_confirmed_at) VALUES
  ('00000000-0000-4000-8000-00000000e101','paise.signup@example.invalid',now()),
  ('00000000-0000-4000-8000-00000000e102','paise.monthly@example.invalid',NULL),
  ('00000000-0000-4000-8000-00000000e103','paise.debt@example.invalid',NULL),
  ('00000000-0000-4000-8000-00000000e104','paise.zero@example.invalid',now()),
  ('00000000-0000-4000-8000-00000000e105','paise.estimates@example.invalid',NULL),
  ('00000000-0000-4000-8000-00000000e106','paise.boundary@example.invalid',NULL);

-- Signup lineage: partially spent and fully spent in the current Free cycle.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e101',true);
SELECT public.my_credits();
SELECT private.credit_entry('00000000-0000-4000-8000-00000000e101','charge',-100,
  NULL,'signup-old',NULL,95,0.10,NULL,NULL);
SELECT private.credit_draw('00000000-0000-4000-8000-00000000e101',100,
  (SELECT id FROM public.credit_ledger WHERE user_id='00000000-0000-4000-8000-00000000e101' AND turn_key='signup-old'),
  'charge',now());
INSERT INTO public.conversations (id,user_id,title) VALUES
  ('d0000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-00000000e101','Mixed unit turn');
INSERT INTO public.chat_messages (id,conversation_id,user_id,role,content,turn_key,created_at) VALUES
  ('d0000000-0000-4000-8000-00000000e111','d0000000-0000-4000-8000-00000000e101',
   '00000000-0000-4000-8000-00000000e101','user','Question','signup-old',now());
INSERT INTO public.chat_messages (id,conversation_id,user_id,role,content,status,created_at) VALUES
  ('d0000000-0000-4000-8000-00000000e112','d0000000-0000-4000-8000-00000000e101',
   '00000000-0000-4000-8000-00000000e101','assistant','Answer','complete',now());
INSERT INTO public.research_turns (user_id,turn_key,request_hash,conversation_id,user_message_id,assistant_message_id,execution_token)
VALUES ('00000000-0000-4000-8000-00000000e101','signup-old',repeat('e',64),
  'd0000000-0000-4000-8000-00000000e101','d0000000-0000-4000-8000-00000000e111',
  'd0000000-0000-4000-8000-00000000e112',gen_random_uuid());
INSERT INTO public.model_call_logs (id,user_id,message_id,caller,purpose,model_requested,status,cost_usd,total_tokens)
VALUES ('e0000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-00000000e101',
  'd0000000-0000-4000-8000-00000000e112','research-chat','chat_answer','google/gemini-3.7-flash','success',0.1,100);
INSERT INTO public.credit_charge_rows (model_call_log_id,ledger_id,cost_usd)
SELECT 'e0000000-0000-4000-8000-00000000e101',id,0.1 FROM public.credit_ledger
WHERE user_id='00000000-0000-4000-8000-00000000e101' AND turn_key='signup-old';
INSERT INTO public.credit_holds (user_id,turn_key,credits,expires_at,settled_at,swept_at)
VALUES ('00000000-0000-4000-8000-00000000e101','signup-old',50,now()-interval '1 minute',
  now()-interval '2 minutes',now()-interval '1 minute');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e104',true);
SELECT public.my_credits();
SELECT private.credit_entry('00000000-0000-4000-8000-00000000e104','charge',-1000,
  NULL,'zero-old',NULL,95,0.10,NULL,NULL);
SELECT private.credit_draw('00000000-0000-4000-8000-00000000e104',1000,
  (SELECT id FROM public.credit_ledger WHERE user_id='00000000-0000-4000-8000-00000000e104' AND turn_key='zero-old'),
  'charge',now());

-- A paid cycle with earlier draw, plus an idempotent pre-cutover admin grant.
UPDATE public.user_profiles SET plan='plus',plan_status='active',plan_source='manual',
  plan_period_end=now()+interval '1 month' WHERE user_id='00000000-0000-4000-8000-00000000e102';
SELECT private.credit_wallet('00000000-0000-4000-8000-00000000e102');
SELECT private.credit_mint('00000000-0000-4000-8000-00000000e102','monthly',2000,
  now(),now()+interval '1 month','test-monthly','plus','grant',NULL,NULL,NULL);
SELECT private.credit_entry('00000000-0000-4000-8000-00000000e102','charge',-500,
  NULL,'monthly-old',NULL,95,0.10,NULL,NULL);
SELECT private.credit_draw('00000000-0000-4000-8000-00000000e102',500,
  (SELECT id FROM public.credit_ledger WHERE user_id='00000000-0000-4000-8000-00000000e102' AND turn_key='monthly-old'),
  'charge',now());
SELECT public.admin_adjust_credits('00000000-0000-4000-8000-00000000e102',25,'topup','Pre-cutover request',
  '00000000-0000-4000-8000-00000000e199','a0000000-0000-4000-8000-00000000e102');
INSERT INTO public.credit_holds (user_id,turn_key,credits,expires_at,settled_at,swept_at)
VALUES ('00000000-0000-4000-8000-00000000e102','old-settled-hold',100,now()-interval '1 minute',
  now()-interval '2 minutes',now()-interval '1 minute');

-- An overdrawn wallet with debt and no remaining lot.
SELECT private.credit_wallet('00000000-0000-4000-8000-00000000e103');
SELECT private.credit_mint('00000000-0000-4000-8000-00000000e103','topup',10,
  now(),now()+interval '12 months','test-debt','free','grant',NULL,NULL,NULL);
SELECT private.credit_entry('00000000-0000-4000-8000-00000000e103','charge',-20,
  NULL,'debt-old',NULL,95,0.10,NULL,NULL);
SELECT private.credit_draw('00000000-0000-4000-8000-00000000e103',20,
  (SELECT id FROM public.credit_ledger WHERE user_id='00000000-0000-4000-8000-00000000e103' AND turn_key='debt-old'),
  'charge',now());

-- Numeric boundary: two future 900m lots and 900m debt give a 900m balance.
-- The final 9b balance/debt fit numeric(14,4), but converting lots before the
-- debt bridge would temporarily push the wallet to 17.1b and fail.
SELECT private.credit_wallet('00000000-0000-4000-8000-00000000e106');
SELECT private.credit_mint('00000000-0000-4000-8000-00000000e106','topup',900000000,
  now()+interval '1 day',now()+interval '1 year','boundary-lot-1',NULL,'grant',NULL,NULL,NULL);
SELECT private.credit_mint('00000000-0000-4000-8000-00000000e106','topup',900000000,
  now()+interval '1 day',now()+interval '1 year','boundary-lot-2',NULL,'grant',NULL,NULL,NULL);
SELECT private.credit_entry('00000000-0000-4000-8000-00000000e106','charge',-900000000,
  NULL,'boundary-debt',NULL,95,0.10,NULL,NULL);
SELECT private.credit_draw('00000000-0000-4000-8000-00000000e106',900000000,
  (SELECT id FROM public.credit_ledger WHERE user_id='00000000-0000-4000-8000-00000000e106'
    AND turn_key='boundary-debt'),'charge',now());

-- Ten measured old-unit answers so model_credit_estimates must normalize its
-- 30-day median rather than falling back to list price.
SELECT private.credit_wallet('00000000-0000-4000-8000-00000000e105');
SELECT private.credit_mint('00000000-0000-4000-8000-00000000e105','topup',1000,
  now(),now()+interval '12 months','test-estimates',NULL,'grant',NULL,NULL,NULL);
DO $$
DECLARE i integer; v_entry uuid; v_call uuid;
BEGIN
  FOR i IN 1..10 LOOP
    v_entry := private.credit_entry('00000000-0000-4000-8000-00000000e105','charge',-10,
      NULL,'estimate-'||i,NULL,95,0.10,NULL,NULL);
    PERFORM private.credit_draw('00000000-0000-4000-8000-00000000e105',10,v_entry,'charge',now());
    INSERT INTO public.model_call_logs (user_id,caller,purpose,model_requested,status,cost_usd,total_tokens)
    VALUES ('00000000-0000-4000-8000-00000000e105','research-chat','chat_answer',
      'google/gemini-3.7-flash','success',0.010526,100) RETURNING id INTO v_call;
    INSERT INTO public.credit_charge_rows (model_call_log_id,ledger_id,cost_usd)
    VALUES (v_call,v_entry,0.010526);
  END LOOP;
END;
$$;

-- Full-row fingerprints in disposable fixture tables prove the conversion
-- leaves every preexisting ledger, draw, mapped cost, and settled hold intact.
CREATE TABLE private.credit_paise_snapshot_ledger AS
SELECT e.id, md5(row_to_json(e)::text) AS fingerprint FROM public.credit_ledger e;
CREATE TABLE private.credit_paise_snapshot_draws AS
SELECT d.id, md5(row_to_json(d)::text) AS fingerprint FROM public.credit_lot_draws d;
CREATE TABLE private.credit_paise_snapshot_charge_rows AS
SELECT c.model_call_log_id, md5(row_to_json(c)::text) AS fingerprint FROM public.credit_charge_rows c;
CREATE TABLE private.credit_paise_snapshot_holds AS
SELECT h.user_id, h.turn_key, md5(row_to_json(h)::text) AS fingerprint FROM public.credit_holds h;
COMMIT;
