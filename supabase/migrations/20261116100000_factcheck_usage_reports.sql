-- Fact-check charges in the credit reports (open-work F347; docs/plans/open-work.md).
--
-- A fact-check charge is an ordinary ledger charge: its turn_key is the session's private hold key ('fc:<uuid>', set by
-- factcheck_settle in 20261116090000_factcheck.sql, so it can never equal a research-chat turn key) and its note is
-- 'live tv fact-check'. The reports listed it nowhere or under the wrong feature: totals counted it as research, the
-- activity list (driven by research_turns and model calls) omitted it, and my_credits.recent showed it with no title.
-- This migration only CREATE OR REPLACEs the report functions, each an exact copy of its current body (the latest is
-- 20261017194626_credit_paise_contract.sql) plus the additions below, produced by position-checked replacements of that
-- file's text, so a changed original fails the generation. Chat and dictation output is byte-for-byte what it was (the
-- fixture compares the jsonb before and after on seeded chat and dictation data). Privileges and owners are kept
-- (CREATE OR REPLACE). Nothing is written and no table changes.
--
--   * private.factcheck_charges(user, from, to) (new): the user's fact-check charges with the session's channel, kind and
--     minutes used (null once the owner has deleted the session). Credits are positive, in the current unit.
--   * private.credit_usage_charged: a fact-check charge returns caller 'factcheck' and model 'factcheck' (so it is its own
--     slice in the timeseries; the summary leaves it out of by_model).
--   * my_usage_summary: research credits exclude it; by_feature gains {feature:'factcheck', calls: charges, credits,
--     searches: 0} only when the user has such a charge; by_model, models_used and providers do not count it; credits and lifetime_credits still do.
--   * my_usage_activity: both modes list one row per fact-check charge (key = the ledger id, never a turn key): turn_key
--     null, conversation_id null, title null, question null, status 'succeeded', model null, calls 0, tokens 0, credits,
--     detail [], and the extra keys feature 'factcheck', channel, minutes_used, video_kind. p_kind 'factcheck' selects
--     only them; a model filter matches them only for the value 'factcheck'. Chat and dictation rows are unchanged and
--     carry none of the extra keys.
--   * my_credits.recent: such an entry has conversation_id null, title 'Live TV fact-check' and feature 'factcheck'.
--   * Unchanged: my_usage_timeseries (the pseudo-model comes from credit_usage_charged), my_conversation_credits,
--     model_credit_estimates, settle_turn_credits and my_credits_cycle*, none of which can see a fact-check charge by key.
--   * The fact-check helper is read only for kinds that can hold such a row: its two lists carry a gate on p_kind, and the
--     per-row join is a lateral subquery gated on the row's own kind (OFFSET 0 keeps the planner from turning it into a
--     join that would read the helper once for every request).
--   * No report returns the hold key.
--
-- The migration refuses (55000, naming the function) to run over a function whose source is neither the original nor this
-- migration's own, and applying it twice is a no-op.
--
-- Down: re-run the functions from 20261017194626_credit_paise_contract.sql and drop private.factcheck_charges.

BEGIN;

-- Drift guard. Each function replaced below must still be the version this migration was written against (the md5 of its
-- source in 20261017194626_credit_paise_contract.sql), or already the version written here (so applying the migration
-- again is a harmless no-op). Anything else - a hot fix, a later migration - stops the migration with 55000 before it
-- changes a thing, so it cannot silently overwrite that work.
DO $guard$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.my_credits()', 'c4c80f54968a8091a948cff66d01e079', 'bea1cdaa7868714635b97a84ed486d09'),
      ('private.credit_usage_charged(uuid,timestamptz,timestamptz)', 'de05789a99856ade1c9bf6241c9cd9a6', '52a757d70e6861a06679a3add01605a2'),
      ('public.my_usage_summary(timestamptz,timestamptz)', '68f145777c34827fbc6334876cb7d2a4', 'de45ef61ca33659f8b52f24bd494c173'),
      ('public.my_usage_activity(integer,integer,boolean,text,text,text)', '2298534d14c203dfb11ba407bae623d6', 'e70f35ab76b6b0df7cfbdb274a4792ec')
    ) AS t(sig, old_md5, new_md5)
  LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig);
    IF v_md5 IS NULL OR v_md5 NOT IN (r.old_md5, r.new_md5) THEN
      RAISE EXCEPTION 'factcheck_usage_reports: % differs from the version this migration was written against (source md5 %); review it before applying',
        r.sig, coalesce(v_md5, 'missing') USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$guard$;

CREATE OR REPLACE FUNCTION private.factcheck_charges(p_user uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (ledger_id uuid, charged_at timestamptz, credits numeric, channel_id text, video_kind text, minutes_used integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT e.id, e.created_at, -private.credit_current_amount(e.credits, e.inr_per_credit),
         fs.channel_id, fs.video_kind, fs.minutes_used
  FROM public.credit_ledger e
  LEFT JOIN private.factcheck_hold_keys k ON k.turn_key = e.turn_key
  LEFT JOIN public.factcheck_sessions fs ON fs.id = k.session_id AND fs.user_id = e.user_id
  WHERE e.user_id = p_user AND e.kind = 'charge' AND e.note = 'live tv fact-check'
    AND e.created_at >= p_from AND e.created_at < p_to;
$$;
REVOKE ALL ON FUNCTION private.factcheck_charges(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- my_credits (recent)
CREATE OR REPLACE FUNCTION public.my_credits() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  w public.credit_wallets;
  p public.user_profiles;
  v_plan text := 'free';
  v_allowance numeric;
  v_ends timestamptz;
  v_held numeric;
  v_lots jsonb;
  v_recent jsonb;
  v_cycle_start timestamptz;
  v_used numeric;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;
  PERFORM private.credit_refresh(uid, now());
  SELECT * INTO w FROM public.credit_wallets WHERE user_id = uid;
  SELECT * INTO p FROM public.user_profiles WHERE user_id = uid;
  IF FOUND THEN
    v_plan := public.entitlement_from(p) ->> 'plan';
  END IF;

  SELECT a.monthly_credits INTO v_allowance FROM public.credit_plan_allowances a WHERE a.plan::text = v_plan;
  IF v_allowance IS NOT NULL THEN
    SELECT max(o.expires_at) INTO v_ends FROM public.credit_lots o
    WHERE o.user_id = uid AND o.kind = 'monthly' AND o.closed_at IS NULL;
    v_ends := coalesce(v_ends, p.plan_period_end);
  ELSE
    SELECT coalesce((SELECT c.old_granted * 10 FROM private.credit_lot_conversions c
                     WHERE c.old_lot_id = o.id OR c.new_lot_id = o.id), o.granted), o.expires_at
    INTO v_allowance, v_ends FROM public.credit_lots o
    WHERE o.user_id = uid AND o.kind = 'signup' AND o.closed_at IS NULL;
  END IF;

  -- Credits charged to answers this cycle (review R, I2). The cycle starts with the current open
  -- monthly lot (the latest-ending one, which also gives cycle.ends_at), else on Free with the open
  -- signup lot; with neither there is no cycle and the figure is null.
  SELECT o.starts_at INTO v_cycle_start FROM public.credit_lots o
  WHERE o.user_id = uid AND o.kind = 'monthly' AND o.closed_at IS NULL
  ORDER BY o.expires_at DESC, o.starts_at DESC LIMIT 1;
  IF v_cycle_start IS NULL THEN
    SELECT o.starts_at INTO v_cycle_start FROM public.credit_lots o
    WHERE o.user_id = uid AND o.kind = 'signup' AND o.closed_at IS NULL;
  END IF;
  IF v_cycle_start IS NOT NULL THEN
    SELECT coalesce(-sum(private.credit_current_amount(e.credits, e.inr_per_credit)), 0) INTO v_used FROM public.credit_ledger e
    WHERE e.user_id = uid AND e.kind = 'charge' AND e.created_at >= v_cycle_start;
  END IF;

  SELECT coalesce(sum(private.credit_current_amount(x.credits, x.inr_per_credit)), 0) INTO v_held FROM public.credit_holds x
  WHERE x.user_id = uid AND x.settled_at IS NULL AND x.expires_at > now() AND NOT x.shadow_blocked;

  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'remaining', o.remaining, 'expires_at', o.expires_at)
                            ORDER BY o.expires_at, o.kind), '[]'::jsonb) INTO v_lots
  FROM public.credit_lots o WHERE o.user_id = uid AND o.closed_at IS NULL AND o.remaining > 0;

  WITH latest AS (
    SELECT e.turn_key, e.created_at FROM public.credit_ledger e
    WHERE e.user_id = uid AND e.kind = 'charge' AND e.credits < 0
    ORDER BY e.created_at DESC
    LIMIT 200
  ), turns AS (
    SELECT l.turn_key FROM latest l GROUP BY l.turn_key
  ), totals AS (
    SELECT e.turn_key, -sum(private.credit_current_amount(e.credits, e.inr_per_credit)) AS credits, max(e.created_at) AS created_at,
           bool_or(e.note IS NOT DISTINCT FROM 'live tv fact-check') AS fc
    FROM turns k
    JOIN public.credit_ledger e ON e.user_id = uid AND e.kind = 'charge' AND e.turn_key = k.turn_key
    GROUP BY e.turn_key
    HAVING sum(private.credit_current_amount(e.credits, e.inr_per_credit)) < 0
    ORDER BY max(e.created_at) DESC, e.turn_key
    LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('conversation_id', t.conversation_id,
                                               'title', CASE WHEN r.fc THEN 'Live TV fact-check' ELSE c.title END,
                                               'credits', r.credits, 'created_at', r.created_at)
                            || CASE WHEN r.fc THEN jsonb_build_object('feature', 'factcheck') ELSE '{}'::jsonb END
                            ORDER BY r.created_at DESC, r.turn_key), '[]'::jsonb) INTO v_recent
  FROM totals r
  LEFT JOIN public.research_turns t ON t.user_id = uid AND t.turn_key = r.turn_key
  LEFT JOIN public.conversations c ON c.id = t.conversation_id AND c.user_id = uid;

  RETURN jsonb_build_object('unit_version', (SELECT unit_version FROM private.credit_epoch WHERE id), 'balance', w.balance, 'held', v_held, 'debt', w.debt, 'plan', v_plan,
           -- The published value of one credit in rupees, for the UI's rupee hint; never dollars.
           'inr_per_credit', (SELECT cs.inr_per_credit FROM public.credit_settings cs WHERE cs.id),
           'cycle', jsonb_build_object('allowance', v_allowance, 'starts_at', v_cycle_start, 'ends_at', v_ends),
           'used_this_cycle', v_used, 'lots', v_lots, 'recent', v_recent);
END;
$$;

-- credit_usage_charged
CREATE OR REPLACE FUNCTION private.credit_usage_charged(p_user uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (ledger_id uuid, charged_at timestamptz, turn_key text, model_call_log_id uuid, model text,
               caller text, credits numeric, web_search_credits numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT e.id, e.created_at, e.turn_key, c.model_call_log_id,
         CASE WHEN e.note = 'live tv fact-check' THEN 'factcheck' ELSE private.credit_usage_model(l.model_requested, l.model_served) END,
         CASE WHEN e.note = 'live tv fact-check' THEN 'factcheck' ELSE l.caller END,
         CASE WHEN c.model_call_log_id IS NULL THEN -private.credit_current_amount(e.credits, e.inr_per_credit)
              WHEN t.cost > 0 THEN -private.credit_current_amount(e.credits, e.inr_per_credit) * c.cost_usd / t.cost
              ELSE 0 END,
         CASE WHEN t.cost > 0 AND coalesce(l.web_search_cost_usd, 0) > 0
              THEN least(-private.credit_current_amount(e.credits, e.inr_per_credit) * c.cost_usd / t.cost, -private.credit_current_amount(e.credits, e.inr_per_credit) * l.web_search_cost_usd / t.cost)
              ELSE 0 END
  FROM public.credit_ledger e
  LEFT JOIN public.credit_charge_rows c ON c.ledger_id = e.id
  LEFT JOIN LATERAL (SELECT sum(c2.cost_usd) AS cost FROM public.credit_charge_rows c2 WHERE c2.ledger_id = e.id) t ON true
  LEFT JOIN public.model_call_logs l ON l.id = c.model_call_log_id AND l.user_id = p_user
  WHERE e.user_id = p_user AND e.kind = 'charge' AND e.created_at >= p_from AND e.created_at < p_to;
$$;

-- my_usage_summary
CREATE OR REPLACE FUNCTION public.my_usage_summary(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz;
  v jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;
  v_from := greatest(coalesce(p_from, v_to - interval '10 years'), v_to - interval '10 years');
  IF v_from > v_to THEN
    v_from := v_to;
  END IF;

  WITH charged AS (
    SELECT * FROM private.credit_usage_charged(uid, v_from, v_to)
  ), calls AS (
    SELECT private.credit_usage_model(l.model_requested, l.model_served) AS model, l.caller, l.status,
           coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens,
           l.web_search_count AS searches
    FROM public.model_call_logs l
    WHERE l.user_id = uid AND l.created_at >= v_from AND l.created_at < v_to
      AND l.caller IN ('research-chat', 'transcribe-audio')
  ), models AS (
    SELECT x.model, private.credit_usage_provider(x.model) AS provider, round(sum(x.credits), 4) AS credits,
           sum(x.calls)::bigint AS calls, sum(x.tokens)::bigint AS tokens
    FROM (SELECT ch.model, ch.credits, 0 AS calls, 0 AS tokens FROM charged ch WHERE ch.caller IS DISTINCT FROM 'factcheck'
          UNION ALL
          SELECT ca.model, 0, 1, ca.tokens FROM calls ca) x
    GROUP BY x.model
  ), turns AS (
    SELECT t.turn_key,
           EXISTS (SELECT FROM public.credit_ledger e
                   WHERE e.user_id = uid AND e.kind = 'charge' AND e.turn_key = t.turn_key AND e.credits < 0) AS charged
    FROM public.research_turns t
    WHERE t.user_id = uid AND t.created_at >= v_from AND t.created_at < v_to
  )
  SELECT jsonb_build_object(
    'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch),
    'calls', (SELECT count(*) FROM calls),
    'failed_calls', (SELECT count(*) FROM calls ca WHERE ca.status = 'error'),
    'tokens', (SELECT coalesce(sum(ca.tokens), 0) FROM calls ca),
    'answers', (SELECT count(*) FROM turns),
    'answers_free', (SELECT count(*) FROM turns tu WHERE NOT tu.charged),
    'web_searches', (SELECT coalesce(sum(ca.searches), 0) FROM calls ca),
    'web_search_credits', (SELECT coalesce(round(sum(ch.web_search_credits), 4), 0) FROM charged ch),
    'models_used', (SELECT count(*) FROM models),
    'providers', (SELECT count(DISTINCT m.provider) FROM models m),
    'by_model', (SELECT coalesce(jsonb_agg(jsonb_build_object('model', m.model, 'provider', m.provider,
                   'credits', m.credits, 'calls', m.calls, 'tokens', m.tokens)
                   ORDER BY m.credits DESC, m.calls DESC, m.model), '[]'::jsonb) FROM models m),
    'by_feature', jsonb_build_array(
      jsonb_build_object('feature', 'research',
        'calls', (SELECT count(*) FROM calls ca WHERE ca.caller = 'research-chat'),
        'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch
                    WHERE coalesce(ch.caller, 'research-chat') NOT IN ('transcribe-audio', 'factcheck')),
        'searches', (SELECT coalesce(sum(ca.searches), 0) FROM calls ca WHERE ca.caller = 'research-chat')),
      jsonb_build_object('feature', 'dictation',
        'calls', (SELECT count(*) FROM calls ca WHERE ca.caller = 'transcribe-audio'),
        'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch WHERE ch.caller = 'transcribe-audio'),
        'searches', 0))
      || CASE WHEN EXISTS (SELECT FROM charged ch WHERE ch.caller = 'factcheck') THEN jsonb_build_array(
      jsonb_build_object('feature', 'factcheck',
        'calls', (SELECT count(*) FROM charged ch WHERE ch.caller = 'factcheck'),
        'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch WHERE ch.caller = 'factcheck'),
        'searches', 0)) ELSE '[]'::jsonb END,
    'lifetime_credits', (SELECT coalesce(-sum(private.credit_current_amount(e.credits, e.inr_per_credit)), 0) FROM public.credit_ledger e
                         WHERE e.user_id = uid AND e.kind = 'charge'))
  INTO v;
  RETURN v;
END;
$$;

-- my_usage_activity
CREATE OR REPLACE FUNCTION public.my_usage_activity(p_offset integer, p_limit integer, p_grouped boolean, p_model text,
  p_status text, p_kind text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_model text := nullif(left(btrim(coalesce(p_model, '')), 200), '');
  v_status text := CASE WHEN p_status IN ('succeeded', 'failed') THEN p_status ELSE 'all' END;
  v_kind text := CASE WHEN p_kind IN ('answers', 'dictation', 'factcheck') THEN p_kind ELSE 'all' END;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;

  IF coalesce(p_grouped, true) THEN
    WITH turns AS (
      SELECT t.turn_key AS key, t.created_at, t.conversation_id, t.user_message_id,
             coalesce(t.assistant_message_id, x.message_id) AS msg
      FROM public.research_turns t
      LEFT JOIN private.credit_turn_messages x ON x.user_id = t.user_id AND x.turn_key = t.turn_key
      WHERE t.user_id = uid AND v_kind IN ('all', 'answers')
    ), items AS (
      SELECT 'turn' AS item, tu.key, tu.created_at, tu.conversation_id, tu.user_message_id, tu.msg, NULL::uuid AS call_id,
             CASE
               WHEN m.id IS NOT NULL THEN CASE
                 WHEN m.status IN ('complete', 'truncated') THEN 'succeeded'
                 WHEN m.status = 'cancelled' THEN 'stopped'
                 WHEN m.status = 'running' AND m.execution_expires_at > now() THEN 'running'
                 ELSE 'failed' END
               WHEN EXISTS (SELECT FROM public.model_call_logs l WHERE l.message_id = tu.msg AND l.user_id = uid
                            AND l.purpose = 'chat_answer' AND l.status = 'success') THEN 'succeeded'
               ELSE 'failed'
             END AS status,
             (v_model IS NULL OR EXISTS (SELECT FROM public.model_call_logs l WHERE l.message_id = tu.msg AND l.user_id = uid
                AND private.credit_usage_model(l.model_requested, l.model_served) = v_model)) AS model_ok
      FROM turns tu
      LEFT JOIN public.chat_messages m ON m.id = tu.msg AND m.user_id = uid
      UNION ALL
      SELECT 'call', l.id::text, l.created_at, NULL, NULL, NULL, l.id,
             CASE l.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END,
             (v_model IS NULL OR private.credit_usage_model(l.model_requested, l.model_served) = v_model)
      FROM public.model_call_logs l
      WHERE l.user_id = uid AND l.caller = 'transcribe-audio' AND v_kind IN ('all', 'dictation')
      UNION ALL
      SELECT 'factcheck', f.ledger_id::text, f.charged_at, NULL, NULL, NULL, NULL, 'succeeded',
             (v_model IS NULL OR v_model = 'factcheck')
      FROM private.factcheck_charges(uid, '-infinity', 'infinity') f WHERE v_kind IN ('all', 'factcheck')
    ), filtered AS (
      SELECT * FROM items i
      WHERE i.model_ok
        AND (v_status = 'all' OR (v_status = 'failed' AND i.status = 'failed')
             OR (v_status = 'succeeded' AND i.status IN ('succeeded', 'stopped')))
    ), page AS (
      SELECT * FROM filtered f ORDER BY f.created_at DESC, f.key DESC OFFSET v_offset LIMIT v_limit
    ), page_calls AS (
      -- The calls behind each page row: a turn's by its assistant message, a dictation row's itself.
      SELECT x.key, l.id, l.created_at, l.purpose, l.status, l.reasoning_effort,
             private.credit_usage_model(l.model_requested, l.model_served) AS model,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens
      FROM (SELECT p.key, l0.id FROM page p JOIN public.model_call_logs l0 ON l0.message_id = p.msg AND l0.user_id = uid
            WHERE p.item = 'turn'
            UNION ALL
            SELECT p.key, p.call_id FROM page p WHERE p.item = 'call') x
      JOIN public.model_call_logs l ON l.id = x.id AND l.user_id = uid
    ), answer_call AS MATERIALIZED (
      -- The call that wrote the visible answer: the one the answer trace links, else the last
      -- successful chat_answer call, else (nothing succeeded) the last chat_answer call. Materialized:
      -- inlined into the join below, its subqueries ran once per call and page row (66 of 73 ms on a
      -- 50-row page in the local plan check), instead of once per page row.
      SELECT p.key,
             coalesce((SELECT tr.model_call_log_id FROM public.chat_turn_traces tr
                       WHERE tr.message_id = p.msg AND tr.user_id = uid AND tr.step_type = 'answer'
                         AND tr.model_call_log_id IS NOT NULL
                       ORDER BY tr.step_index DESC LIMIT 1),
                      (SELECT pc.id FROM page_calls pc WHERE pc.key = p.key AND pc.purpose = 'chat_answer'
                       ORDER BY (pc.status = 'success') DESC, pc.created_at DESC, pc.id DESC LIMIT 1)) AS id
      FROM page p WHERE p.item = 'turn'
    ), call_credits AS (
      SELECT pc.key, pc.id, pc.created_at, pc.purpose, pc.model, pc.tokens, pc.reasoning_effort,
             CASE pc.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END AS status,
             CASE WHEN pc.purpose = 'chat_answer' AND pc.id = a.id THEN 'answer'
                  WHEN pc.purpose IN ('chat_answer', 'embedding') THEN 'search'
                  WHEN pc.purpose = 'citation_repair' THEN 'repair'
                  WHEN pc.purpose = 'transcription' THEN 'dictation'
                  ELSE 'other' END AS role,
             cr.credits
      FROM page_calls pc
      LEFT JOIN answer_call a ON a.key = pc.key
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.cost > 0 THEN -private.credit_current_amount(e.credits, e.inr_per_credit) * c.cost_usd / t.cost ELSE 0 END) AS credits
        FROM public.credit_charge_rows c
        JOIN public.credit_ledger e ON e.id = c.ledger_id AND e.user_id = uid AND e.kind = 'charge'
        CROSS JOIN LATERAL (SELECT sum(c2.cost_usd) AS cost FROM public.credit_charge_rows c2 WHERE c2.ledger_id = c.ledger_id) t
        WHERE c.model_call_log_id = pc.id
      ) cr ON true
    )
    SELECT (SELECT count(*) FROM filtered),
           coalesce(jsonb_agg(r.row ORDER BY r.created_at DESC, r.key DESC), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (
      SELECT p.created_at, p.key, jsonb_build_object(
               'turn_key', CASE WHEN p.item = 'turn' THEN p.key END,
               'created_at', p.created_at,
               'conversation_id', c.id,
               'title', c.title,
               'question', CASE WHEN c.id IS NOT NULL THEN left(um.content, 500) END,
               'status', p.status,
               -- The answer's model, else the last chat_answer call's, else the last call's (dictation).
               'model', (SELECT cc.model FROM call_credits cc WHERE cc.key = p.key
                         ORDER BY (cc.role = 'answer') DESC, (cc.purpose = 'chat_answer') DESC, cc.created_at DESC, cc.id DESC
                         LIMIT 1),
               'calls', (SELECT count(*) FROM call_credits cc WHERE cc.key = p.key),
               'tokens', (SELECT coalesce(sum(cc.tokens), 0) FROM call_credits cc WHERE cc.key = p.key),
               'credits', CASE WHEN p.item = 'turn'
                            THEN (SELECT coalesce(-sum(private.credit_current_amount(e.credits, e.inr_per_credit)), 0) FROM public.credit_ledger e
                                  WHERE e.user_id = uid AND e.kind = 'charge' AND e.turn_key = p.key)
                            WHEN p.item = 'factcheck' THEN coalesce(fcr.credits, 0)
                            ELSE (SELECT coalesce(round(sum(cc.credits), 4), 0) FROM call_credits cc WHERE cc.key = p.key) END,
               'detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', cc.role, 'model', cc.model,
                                    'effort', cc.reasoning_effort, 'tokens', cc.tokens,
                                    'credits', coalesce(round(cc.credits, 4), 0), 'free', cc.credits IS NULL,
                                    'status', cc.status) ORDER BY cc.created_at, cc.id), '[]'::jsonb)
                          FROM call_credits cc WHERE cc.key = p.key))
             || CASE WHEN p.item = 'factcheck' THEN jsonb_build_object('feature', 'factcheck', 'channel', fcr.channel_id, 'minutes_used', fcr.minutes_used,
                                                 'video_kind', fcr.video_kind) ELSE '{}'::jsonb END AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN public.chat_messages um ON um.id = p.user_message_id AND um.user_id = uid
      LEFT JOIN LATERAL (SELECT x.* FROM private.factcheck_charges(uid, '-infinity', 'infinity') x
                         WHERE p.item = 'factcheck' AND x.ledger_id::text = p.key
                         OFFSET 0) fcr ON true
    ) r;
  ELSE
    WITH items AS (
      SELECT l.id, l.created_at, l.message_id, l.conversation_id, l.reasoning_effort,
             private.credit_usage_model(l.model_requested, l.model_served) AS model,
             CASE l.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END AS status,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens,
             false AS is_fc
      FROM public.model_call_logs l
      WHERE l.user_id = uid
        AND ((v_kind IN ('all', 'answers') AND l.caller = 'research-chat')
             OR (v_kind IN ('all', 'dictation') AND l.caller = 'transcribe-audio'))
      UNION ALL
      SELECT f.ledger_id, f.charged_at, NULL::uuid, NULL::uuid, NULL::text, NULL::text, 'succeeded', 0, true
      FROM private.factcheck_charges(uid, '-infinity', 'infinity') f WHERE v_kind IN ('all', 'factcheck')
    ), filtered AS (
      SELECT * FROM items i
      WHERE (v_model IS NULL OR i.model = v_model OR (i.is_fc AND v_model = 'factcheck'))
        AND (v_status = 'all' OR (v_status = 'failed' AND i.status = 'failed')
             OR (v_status = 'succeeded' AND i.status IN ('succeeded', 'stopped')))
    ), page AS (
      SELECT * FROM filtered f ORDER BY f.created_at DESC, f.id DESC OFFSET v_offset LIMIT v_limit
    )
    SELECT (SELECT count(*) FROM filtered),
           coalesce(jsonb_agg(r.row ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (
      SELECT p.created_at, p.id, jsonb_build_object(
               'turn_key', (SELECT x.turn_key FROM private.credit_turn_messages x
                            WHERE x.user_id = uid AND x.message_id = p.message_id LIMIT 1),
               'created_at', p.created_at,
               'conversation_id', c.id,
               'title', c.title,
               'question', NULL,
               'status', p.status,
               'model', p.model,
               'calls', CASE WHEN p.is_fc THEN 0 ELSE 1 END,
               'tokens', p.tokens,
               'credits', CASE WHEN p.is_fc THEN coalesce(fcr.credits, 0) ELSE coalesce(round(cr.credits, 4), 0) END,
               'detail', '[]'::jsonb)
             || CASE WHEN p.is_fc THEN jsonb_build_object('feature', 'factcheck', 'channel', fcr.channel_id, 'minutes_used', fcr.minutes_used,
                                                 'video_kind', fcr.video_kind) ELSE '{}'::jsonb END AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN LATERAL (SELECT x.* FROM private.factcheck_charges(uid, '-infinity', 'infinity') x
                         WHERE p.is_fc AND x.ledger_id = p.id
                         OFFSET 0) fcr ON true
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.cost > 0 THEN -private.credit_current_amount(e.credits, e.inr_per_credit) * ch.cost_usd / t.cost ELSE 0 END) AS credits
        FROM public.credit_charge_rows ch
        JOIN public.credit_ledger e ON e.id = ch.ledger_id AND e.user_id = uid AND e.kind = 'charge'
        CROSS JOIN LATERAL (SELECT sum(c2.cost_usd) AS cost FROM public.credit_charge_rows c2 WHERE c2.ledger_id = ch.ledger_id) t
        WHERE ch.model_call_log_id = p.id
      ) cr ON true
    ) r;
  END IF;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

COMMIT;
