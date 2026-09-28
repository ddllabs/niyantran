-- T5: GST tax invoices move from the per-instance SQLite file to Postgres
-- (docs/specs/2026-09-28-t5-invoices-to-supabase.md; owner approval
-- 2026-09-28).
--
-- - public.invoices: a user reads only their own rows, a platform admin
--   reads all, and clients never write. The service role writes only
--   through public.issue_invoice().
-- - public.invoice_counters: one row per Indian financial year.
--   issue_invoice() increments it in the same statement that inserts the
--   invoice, so a failed insert rolls the number back. Numbers are unique
--   and gapless per year (GST), unlike a sequence.
-- - user_id is kept nullable (ON DELETE SET NULL) because a tax invoice must
--   outlive the account it was issued to; user_email is copied onto the row.

BEGIN;

CREATE TABLE public.invoice_counters (
  financial_year text    PRIMARY KEY CHECK (financial_year ~ '^[0-9]{4}$'),
  last_seq       integer NOT NULL CHECK (last_seq >= 0)
);

CREATE TABLE public.invoices (
  id               text        PRIMARY KEY CHECK (id ~ '^inv_[a-z0-9_]{1,60}$'),
  invoice_no       text        NOT NULL UNIQUE,
  financial_year   text        NOT NULL CHECK (financial_year ~ '^[0-9]{4}$'),
  seq              integer     NOT NULL CHECK (seq > 0),
  user_id          uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  user_email       text        NOT NULL CHECK (length(user_email) BETWEEN 3 AND 320),
  plan_id          text        NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 40),
  yearly           boolean     NOT NULL DEFAULT false,
  currency         text        NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  taxable          numeric(12,2) NOT NULL CHECK (taxable >= 0),
  cgst             numeric(12,2) NOT NULL DEFAULT 0 CHECK (cgst >= 0),
  sgst             numeric(12,2) NOT NULL DEFAULT 0 CHECK (sgst >= 0),
  igst             numeric(12,2) NOT NULL DEFAULT 0 CHECK (igst >= 0),
  total            numeric(12,2) NOT NULL CHECK (total >= 0),
  tax_split        text,
  usd_list         numeric(12,2),
  usd_to_inr       numeric(12,4),
  buyer_name       text,
  buyer_gstin      text,
  buyer_state_code text,
  buyer_address    text,
  payment_id       text,
  order_id         text,
  provider         text        NOT NULL CHECK (provider IN ('razorpay', 'demo')),
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (financial_year, seq)
);

-- A replayed verify must not issue a second invoice for one payment.
CREATE UNIQUE INDEX invoices_provider_payment_key ON public.invoices (provider, payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX invoices_user_issued_idx ON public.invoices (user_id, issued_at DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and admins read invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

REVOKE ALL ON TABLE public.invoices, public.invoice_counters FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.invoices TO authenticated;
GRANT SELECT, INSERT ON TABLE public.invoices TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.invoice_counters TO service_role;

-- Issues one invoice: assigns NIY/<FY>/<seq> and inserts the row, atomically.
-- The Indian financial year starts on 1 April, taken in Asia/Kolkata time.
-- p->>'issued_at' may set the issue time (for tests and back-dated
-- records); it defaults to now().
CREATE FUNCTION public.issue_invoice(p jsonb)
RETURNS public.invoices
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_at    timestamptz := coalesce((p ->> 'issued_at')::timestamptz, now());
  v_local timestamp   := v_at AT TIME ZONE 'Asia/Kolkata';
  v_start integer;
  v_fy    text;
  v_seq   integer;
  v_row   public.invoices;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invoice must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_start := extract(year FROM v_local)::integer - CASE WHEN extract(month FROM v_local) >= 4 THEN 0 ELSE 1 END;
  v_fy := lpad((v_start % 100)::text, 2, '0') || lpad(((v_start + 1) % 100)::text, 2, '0');

  INSERT INTO public.invoice_counters AS c (financial_year, last_seq)
  VALUES (v_fy, 1)
  ON CONFLICT (financial_year) DO UPDATE SET last_seq = c.last_seq + 1
  RETURNING c.last_seq INTO v_seq;

  INSERT INTO public.invoices (
    id, invoice_no, financial_year, seq, user_id, user_email, plan_id, yearly,
    taxable, cgst, sgst, igst, total, tax_split, usd_list, usd_to_inr,
    buyer_name, buyer_gstin, buyer_state_code, buyer_address,
    payment_id, order_id, provider, payload, issued_at
  ) VALUES (
    p ->> 'id',
    'NIY/' || v_fy || '/' || lpad(v_seq::text, 5, '0'),
    v_fy,
    v_seq,
    nullif(p ->> 'user_id', '')::uuid,
    lower(p ->> 'user_email'),
    p ->> 'plan_id',
    coalesce((p ->> 'yearly')::boolean, false),
    (p ->> 'taxable')::numeric,
    coalesce((p ->> 'cgst')::numeric, 0),
    coalesce((p ->> 'sgst')::numeric, 0),
    coalesce((p ->> 'igst')::numeric, 0),
    (p ->> 'total')::numeric,
    p ->> 'tax_split',
    (p ->> 'usd_list')::numeric,
    (p ->> 'usd_to_inr')::numeric,
    nullif(p ->> 'buyer_name', ''),
    nullif(p ->> 'buyer_gstin', ''),
    nullif(p ->> 'buyer_state_code', ''),
    nullif(p ->> 'buyer_address', ''),
    nullif(p ->> 'payment_id', ''),
    nullif(p ->> 'order_id', ''),
    p ->> 'provider',
    coalesce(p -> 'payload', '{}'::jsonb),
    v_at
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_invoice(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_invoice(jsonb) TO service_role;

COMMIT;
