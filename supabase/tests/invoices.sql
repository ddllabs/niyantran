-- Disposable PG assertions for T5 invoices. Run on the isolated
-- least-privilege fixture plus research-turn persistence and
-- 20260928140000_invoices.sql; never against a hosted project.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END; $$;
CREATE FUNCTION pg_temp.rejected(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS: % (%)', label, SQLSTATE; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % accepted', label;
END; $$;

SELECT pg_temp.assert_true(to_regclass('public.invoices') IS NOT NULL, 'invoices table exists');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoices'::regclass), 'RLS on invoices');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoice_counters'::regclass), 'RLS on counters');

-- Clients read at most; they never write, and never touch the counters.
DO $$
DECLARE actor text; privilege text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.invoices', privilege), actor || ' cannot ' || privilege || ' invoices');
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(actor, 'public.invoice_counters', privilege), actor || ' cannot ' || privilege || ' counters');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_function_privilege(actor, 'public.issue_invoice(jsonb)', 'EXECUTE'), actor || ' cannot issue invoices');
  END LOOP;
  PERFORM pg_temp.assert_true(NOT has_table_privilege('anon', 'public.invoices', 'SELECT'), 'anon cannot read invoices');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('service_role', 'public.invoices', 'UPDATE'), 'service_role cannot rewrite an invoice');
  PERFORM pg_temp.assert_true(NOT has_table_privilege('service_role', 'public.invoices', 'DELETE'), 'service_role cannot delete an invoice');
  PERFORM pg_temp.assert_true(has_function_privilege('service_role', 'public.issue_invoice(jsonb)', 'EXECUTE'), 'service_role can issue invoices');
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'a@example.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'b@example.test'),
  ('00000000-0000-4000-8000-0000000000c3', 'admin@example.test');
UPDATE public.user_profiles SET role = 'admin' WHERE user_id = '00000000-0000-4000-8000-0000000000c3';

CREATE FUNCTION pg_temp.inv(id text, uid text, at text, payment text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', id, 'user_id', uid, 'user_email', 'Buyer@Example.test', 'plan_id', 'pro',
    'taxable', 1000, 'cgst', 90, 'sgst', 90, 'total', 1180, 'provider', 'razorpay', 'payment_id', payment, 'issued_at', at);
$$;

SET LOCAL ROLE service_role;
-- Numbering: sequential within a financial year (1 April, Asia/Kolkata), and
-- restarting in the next year.
SELECT pg_temp.assert_true((public.issue_invoice(pg_temp.inv('inv_a1', '00000000-0000-4000-8000-0000000000a1', '2026-09-28T10:00:00Z', 'pay_1'))).invoice_no = 'NIY/2627/00001', 'first invoice of FY 2026-27');
SELECT pg_temp.assert_true((public.issue_invoice(pg_temp.inv('inv_a2', '00000000-0000-4000-8000-0000000000a1', '2026-10-01T10:00:00Z', 'pay_2'))).invoice_no = 'NIY/2627/00002', 'second invoice of FY 2026-27');
SELECT pg_temp.assert_true((public.issue_invoice(pg_temp.inv('inv_b1', '00000000-0000-4000-8000-0000000000b2', '2027-03-31T19:00:00Z', 'pay_3'))).invoice_no = 'NIY/2728/00001', '31 March 19:00 UTC is 00:30 on 1 April in India: FY 2027-28');
SELECT pg_temp.assert_true((public.issue_invoice(pg_temp.inv('inv_b2', '00000000-0000-4000-8000-0000000000b2', '2027-03-31T10:00:00Z', 'pay_4'))).invoice_no = 'NIY/2627/00003', 'a 31 March daytime invoice stays in FY 2026-27');
SELECT pg_temp.assert_true((SELECT user_email FROM public.invoices WHERE id = 'inv_a1') = 'buyer@example.test', 'email is stored lower-case');

-- A failed issue leaves no gap: the counter rolls back with the insert.
SELECT pg_temp.rejected($$SELECT public.issue_invoice(pg_temp.inv('inv_a1', '00000000-0000-4000-8000-0000000000a1', '2026-11-01T10:00:00Z', 'pay_5'))$$, 'a duplicate invoice id is refused');
SELECT pg_temp.rejected($$SELECT public.issue_invoice(pg_temp.inv('inv_a9', '00000000-0000-4000-8000-0000000000a1', '2026-11-01T10:00:00Z', 'pay_1'))$$, 'a second invoice for one payment is refused');
SELECT pg_temp.rejected($$SELECT public.issue_invoice(jsonb_set(pg_temp.inv('inv_a8', '00000000-0000-4000-8000-0000000000a1', '2026-11-01T10:00:00Z'), '{provider}', '"free"'))$$, 'an unknown provider is refused');
SELECT pg_temp.assert_true((public.issue_invoice(pg_temp.inv('inv_a3', '00000000-0000-4000-8000-0000000000a1', '2026-11-02T10:00:00Z', 'pay_6'))).invoice_no = 'NIY/2627/00004', 'no gap after the refused issues');
SELECT pg_temp.rejected($$UPDATE public.invoices SET total = 1 WHERE id = 'inv_a1'$$, 'service_role cannot rewrite an issued invoice');
RESET ROLE;

-- Reads: each user sees only their own invoices; an admin sees all.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.invoices) = 3, 'user A sees their three invoices');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM public.invoices WHERE user_id <> '00000000-0000-4000-8000-0000000000a1'), 'user A sees no one else''s');
SELECT pg_temp.rejected($$INSERT INTO public.invoices (id, invoice_no, financial_year, seq, user_email, plan_id, taxable, total, provider) VALUES ('inv_x', 'NIY/2627/99999', '2627', 99999, 'x@example.test', 'pro', 0, 0, 'demo')$$, 'a user cannot forge an invoice');
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b2';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.invoices) = 2, 'user B sees their two invoices');
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000c3';
SELECT pg_temp.assert_true((SELECT count(*) FROM public.invoices) = 5, 'an admin sees every invoice');
RESET ROLE;

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SELECT pg_temp.rejected($$SELECT count(*) FROM public.invoices$$, 'anon cannot read invoices');
RESET ROLE;
ROLLBACK;
