-- Model plans, credit estimates and the effort column (open-work F111, F150,
-- F151, P3; docs/specs/2026-10-14-ai-credits.md §6.1, §12).
--
--   * F150 (owner, 2026-10-14): model access is decided per model.
--     ai_models.min_plan is the lowest plan that may use a model (free < plus
--     < pro < max; research-chat refuses a caller whose effective plan ranks
--     below it, a lapsed plan counting as free). The default is plus, so any
--     model added later needs a paid plan until an admin says otherwise. Seeded
--     free, for every row enabled or not: Gemini Flash-class
--     (^google/gemini-.*flash, so Flash and Flash-Lite), DeepSeek
--     (^~?deepseek/), Luna (gpt.*luna) and Haiku (^anthropic/claude-haiku).
--     Everything else (Sonnet, Opus, Gemini Pro, Gemma, Astra...) stays plus.
--     ai_models already grants SELECT on the whole table to authenticated
--     under a USING (true) policy, so the new column is readable wherever the
--     browser reads ai_models. admin_models_upsert does not name the column:
--     an insert gets the default and an update keeps the stored value.
--   * Three Claude models are added (enabled, not default), when their
--     model_pricing row is available with tool support (ai_models_guard's
--     rule; a missing one is skipped with a NOTICE rather than failing the
--     migration): Haiku 5.5 (tier 1, free), Sonnet 5.5 and Opus 5.5 (tier 3,
--     plus). Their efforts follow model_pricing_reconcile's clamp for an empty
--     admin filter: the catalogue's reasoning_efforts, plus 'off' unless
--     reasoning is mandatory, cheapest first. Their sort_order follows the
--     last anthropic/ row. ON CONFLICT (model_id) DO NOTHING keeps a row an
--     admin already added.
--   * Gemma (google/gemma-%) is disabled, not deleted (log rows reference it).
--     A Gemma row that an ai_roles row points at, or that is the default, is
--     left enabled and reported with a NOTICE, so no role is broken.
--   * P3: model_call_logs.reasoning_effort, the effort the turn asked for
--     (research-chat writes it on every row; 'off' when none). Nullable, since
--     other callers and older rows have none; CHECKed against the vocabulary of
--     research-chat/validate.ts REASONING_VALUES.
--   * F151: public.model_credit_estimates() returns
--     [{model_id, credits, basis}] for every enabled ai_models row, in picker
--     order. basis 'measured': the median credits per answer over the last 30
--     days, when the model has at least 10 charged answers (credit_ledger
--     charges summed per turn; a turn belongs to the model_requested of its
--     earliest charged chat_answer row, so a failover does not move it).
--     Otherwise basis 'list_price': round((prompt_usd x 30,000 + completion_usd
--     x 2,000) x usd_to_inr / inr_per_credit), from model_pricing and
--     credit_settings (30k prompt and 2k completion tokens approximate today's
--     measured median for Gemini 3.8 Flash). basis 'none' with credits null
--     when the model has no prices. Credits are whole numbers, at least 1. No
--     dollars, rupees or exchange rate leave the function. SECURITY DEFINER,
--     STABLE, search_path '' and TimeZone UTC; EXECUTE for authenticated only
--     (revoked from PUBLIC, anon and service_role, which reads the tables
--     directly and does not need it).
--
-- No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual). The NOTICEs name the Claude rows this migration inserted and
-- the Gemma rows it disabled; restore exactly those:
--   begin;
--   drop function public.model_credit_estimates();
--   alter table public.model_call_logs drop column reasoning_effort;
--   update public.ai_models set enabled = true where model_id in (<Gemma ids from the NOTICE>);
--   delete from public.ai_models where model_id in (<Claude ids from the NOTICE>)
--     and not exists (select 1 from public.ai_roles r where r.model_id = ai_models.model_id);
--   alter table public.ai_models drop column min_plan;
--   commit;

-- 1. ai_models.min_plan (F150) ---------------------------------------------------------------
ALTER TABLE public.ai_models ADD COLUMN min_plan public.app_plan NOT NULL DEFAULT 'plus';
COMMENT ON COLUMN public.ai_models.min_plan IS
  'The lowest plan that may use the model (free < plus < pro < max). research-chat refuses anyone below it.';

UPDATE public.ai_models
SET min_plan = 'free'
WHERE model_id ~ '^google/gemini-.*flash'
   OR model_id ~ '^~?deepseek/'
   OR model_id ~ 'gpt.*luna'
   OR model_id ~ '^anthropic/claude-haiku';

-- 2. Three Claude models ------------------------------------------------------------------------
DO $$
DECLARE
  after_claude integer := coalesce(
    (SELECT max(sort_order) FROM public.ai_models WHERE model_id LIKE 'anthropic/%'), 100);
  added text[];
  missing text[];
BEGIN
  WITH wanted (n, model_id, label, tier, min_plan) AS (
    VALUES (1, 'anthropic/claude-haiku-5.5',  'Claude - Haiku 5.5',  1::smallint, 'free'::public.app_plan),
           (2, 'anthropic/claude-sonnet-5.5', 'Claude - Sonnet 5.5', 3::smallint, 'plus'::public.app_plan),
           (3, 'anthropic/claude-opus-5.5',   'Claude - Opus 5.5',   3::smallint, 'plus'::public.app_plan)
  ), ins AS (
    INSERT INTO public.ai_models (model_id, label, vendor, tier, efforts, enabled, is_default, sort_order, min_plan)
    SELECT w.model_id, w.label, 'anthropic', w.tier,
           (SELECT coalesce(array_agg(e ORDER BY public.effort_rank(e)), '{}')
              FROM (SELECT unnest(p.reasoning_efforts) AS e
                    UNION
                    SELECT 'off'::text WHERE NOT p.reasoning_required) t),
           true, false, after_claude + w.n, w.min_plan
    FROM wanted w
    JOIN public.model_pricing p
      ON p.model_id = w.model_id AND p.is_available AND 'tools' = ANY(p.supported_parameters)
    ON CONFLICT (model_id) DO NOTHING
    RETURNING model_id
  )
  SELECT array_agg(model_id ORDER BY model_id) INTO added FROM ins;
  SELECT array_agg(w ORDER BY w) INTO missing
  FROM unnest(ARRAY['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5']) w
  WHERE NOT EXISTS (SELECT 1 FROM public.ai_models m WHERE m.model_id = w);
  RAISE NOTICE 'Claude models added: %', coalesce(added, '{}');
  IF missing IS NOT NULL THEN
    RAISE NOTICE 'Claude models not added (no available model_pricing row with tools): %', missing;
  END IF;
END;
$$;

-- 3. Gemma is not wanted -------------------------------------------------------------------------
DO $$
DECLARE
  disabled text[];
  kept text[];
BEGIN
  WITH off AS (
    UPDATE public.ai_models m
    SET enabled = false
    WHERE m.model_id LIKE 'google/gemma-%' AND m.enabled AND NOT m.is_default
      AND NOT EXISTS (SELECT 1 FROM public.ai_roles r WHERE r.model_id = m.model_id)
    RETURNING m.model_id
  )
  SELECT array_agg(model_id ORDER BY model_id) INTO disabled FROM off;
  SELECT array_agg(m.model_id ORDER BY m.model_id) INTO kept
  FROM public.ai_models m
  WHERE m.model_id LIKE 'google/gemma-%' AND m.enabled;
  RAISE NOTICE 'Gemma models disabled: %', coalesce(disabled, '{}');
  IF kept IS NOT NULL THEN
    RAISE NOTICE 'Gemma models left enabled (an ai_roles row points at them, or one is the default): %', kept;
  END IF;
END;
$$;

-- 4. model_call_logs.reasoning_effort (P3) ----------------------------------------------------
ALTER TABLE public.model_call_logs
  ADD COLUMN reasoning_effort text
  CONSTRAINT model_call_logs_reasoning_effort_check
    CHECK (reasoning_effort IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));
COMMENT ON COLUMN public.model_call_logs.reasoning_effort IS
  'The reasoning effort the turn asked for (research-chat validate.ts REASONING_VALUES); null when not recorded.';

-- 5. model_credit_estimates() (F151) ----------------------------------------------------------
CREATE FUNCTION public.model_credit_estimates()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET TimeZone = 'UTC'
AS $$
  WITH recent AS (
    SELECT l.id, l.user_id, l.turn_key, l.credits
    FROM public.credit_ledger l
    WHERE l.kind = 'charge' AND l.created_at >= now() - interval '30 days'
  ), answers AS (
    SELECT r.user_id, r.turn_key, -sum(r.credits) AS credits
    FROM recent r
    GROUP BY r.user_id, r.turn_key
  ), answer_model AS (
    SELECT DISTINCT ON (r.user_id, r.turn_key) r.user_id, r.turn_key, m.model_requested
    FROM recent r
    JOIN public.credit_charge_rows c ON c.ledger_id = r.id
    JOIN public.model_call_logs m ON m.id = c.model_call_log_id
    WHERE m.purpose = 'chat_answer'
    ORDER BY r.user_id, r.turn_key, m.created_at, m.id
  ), measured AS (
    SELECT am.model_requested AS model_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY a.credits::double precision) AS median
    FROM answers a
    JOIN answer_model am USING (user_id, turn_key)
    GROUP BY am.model_requested
    HAVING count(*) >= 10
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('model_id', x.model_id, 'credits', x.credits, 'basis', x.basis)
                            ORDER BY x.sort_order, x.model_id), '[]'::jsonb)
  FROM (
    SELECT a.model_id, a.sort_order,
           CASE
             WHEN ms.model_id IS NOT NULL THEN greatest(1, round(ms.median))::integer
             WHEN p.prompt_usd IS NOT NULL AND p.completion_usd IS NOT NULL THEN
               greatest(1, round((p.prompt_usd * 30000 + p.completion_usd * 2000) * s.usd_to_inr / s.inr_per_credit))::integer
           END AS credits,
           CASE
             WHEN ms.model_id IS NOT NULL THEN 'measured'
             WHEN p.prompt_usd IS NOT NULL AND p.completion_usd IS NOT NULL THEN 'list_price'
             ELSE 'none'
           END AS basis
    FROM public.ai_models a
    CROSS JOIN public.credit_settings s
    LEFT JOIN measured ms ON ms.model_id = a.model_id
    LEFT JOIN public.model_pricing p ON p.model_id = a.model_id
    WHERE a.enabled
  ) x;
$$;
COMMENT ON FUNCTION public.model_credit_estimates() IS
  'F151: [{model_id, credits, basis}] per enabled model; the 30-day median per answer (measured, >= 10 answers) or a list-price estimate. Credits only.';

REVOKE ALL ON FUNCTION public.model_credit_estimates() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.model_credit_estimates() TO authenticated;
