-- Credits usage reports (open-work F153; docs/specs/2026-10-14-credits-usage-page.md, Data;
-- docs/specs/2026-10-14-ai-credits.md §7, §12).
--
-- Three read-only reports for the Credits usage page, each for the signed-in user only
-- (auth.uid()), each SECURITY DEFINER, STABLE, search_path '' and TimeZone UTC, executable by
-- authenticated only. They return credits, counts and tokens: no dollars, no rupees, no exchange
-- rate (the browser multiplies credits by my_credits().inr_per_credit for the rupee hint).
--
--   * my_usage_summary(p_from, p_to): {credits, calls, failed_calls, tokens, answers,
--     answers_free, web_searches, web_search_credits, models_used, providers,
--     by_model:[{model, provider, credits, calls, tokens}], by_feature:[{feature, calls, credits,
--     searches}], lifetime_credits}.
--     Credits are counted by charge time (the ledger entry's created_at, spec Decision 3), so a
--     summary over the cycle equals my_credits().used_this_cycle. Calls, tokens and web searches
--     are counted by call time (model_call_logs.created_at). answers counts research turns
--     claimed in the window; answers_free those with no credits charged.
--   * my_usage_timeseries(p_from, p_to, p_bucket): {bucket, series:[{bucket_start, model,
--     credits, calls, tokens}]}. p_bucket is 'day' or 'month' (anything else is 'day'); buckets
--     are calendar days or months in IST (Asia/Kolkata), bucket_start is the IST date
--     'YYYY-MM-DD'. Every bucket in the window appears: one with no usage carries a single
--     element whose model is null and whose figures are 0. A null p_from starts at the user's
--     first charge or call.
--   * my_usage_activity(p_offset, p_limit, p_grouped, p_model, p_status, p_kind): {total,
--     rows:[{turn_key, created_at, conversation_id, title, question, status, model, calls,
--     tokens, credits, detail:[{role, model, effort, tokens, credits, free, status}]}]}, newest
--     first. Grouped, a row is one research turn (from research_turns, so free and failed answers
--     appear; its messages are found through private.credit_turn_messages once a deleted
--     conversation has unlinked them) or one dictation call (model_call_logs.caller
--     'transcribe-audio'). Ungrouped, a row is one call and detail is empty. A deleted
--     conversation gives conversation_id, title and question null. status is succeeded,
--     stopped, failed or running; the 'succeeded' filter takes succeeded and stopped. role is
--     answer, search (search and plan: tool-using calls and the query embedding), repair or
--     dictation. free is true for a call no credits were charged for.
--
-- A model's share of a charge is ledger.credits x row.cost_usd / sum(cost_usd of the entry's
-- charged rows), from credit_charge_rows (the cost that was charged); its web-search credits are
-- ledger.credits x row.web_search_cost_usd / the same sum, never more than the row's own share.
-- Shares are rounded to 4 places once they are summed. A charge entry with no charged rows (none
-- exist; every charge records its rows) would count whole, for the model 'unknown', so the shares
-- always add up to the ledger.
--
-- Inputs are clamped: windows are at most 10 years (summary), 400 days of days or 10 years of
-- months (timeseries); p_offset 0..100000, p_limit 1..100 (default 50), p_model at most 200
-- characters, unknown statuses and kinds mean all. A window that ends before it starts is empty.
--
-- my_credits() is replaced to bound `recent` and to name the cycle's start. `recent` now takes the
-- latest 200 charge entries that charged anything, picks the 20 most recent turns among them, and
-- only then sums each of those turns' entries and joins their titles; its output is unchanged.
-- cycle gains starts_at: the start used_this_cycle already counts from (the open monthly lot's, else
-- the open signup lot's; null with neither), so the page's "Billing period" summary uses the same
-- bounds as "Used this cycle".
--
-- Indexes: research_turns (user_id, created_at DESC) for the activity pages and the summary's
-- answers. model_call_logs (user_id, created_at DESC) already exists (0004) and serves every
-- per-user call scan here, so no index is added to it.
--
-- No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual):
--   begin;
--   drop function public.my_usage_summary(timestamptz, timestamptz),
--     public.my_usage_timeseries(timestamptz, timestamptz, text),
--     public.my_usage_activity(integer, integer, boolean, text, text, text);
--   drop function private.credit_usage_charged(uuid, timestamptz, timestamptz),
--     private.credit_usage_model(text, text), private.credit_usage_provider(text),
--     private.credit_usage_bucket(timestamptz, text);
--   drop index public.research_turns_user_time;
--   -- my_credits(): run its CREATE FUNCTION from 20261014200000_ai_credits.sql again as
--   -- CREATE OR REPLACE FUNCTION (its grants are kept).
--   commit;

-- 1. Index -----------------------------------------------------------------------------------------
CREATE INDEX research_turns_user_time ON public.research_turns (user_id, created_at DESC);

-- 2. Private helpers ---------------------------------------------------------------------------------

-- The model a log row is reported under: the one asked for (a failover asks for its own), else the
-- one that served, else 'unknown'.
CREATE FUNCTION private.credit_usage_model(p_requested text, p_served text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT coalesce(nullif(btrim(p_requested), ''), nullif(btrim(p_served), ''), 'unknown');
$$;

-- The vendor part of a model id ('google' for 'google/gemini-3.7-flash', '~openai/...' too).
CREATE FUNCTION private.credit_usage_provider(p_model text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT CASE WHEN position('/' IN ltrim(coalesce(p_model, ''), '~')) > 1
              THEN lower(split_part(ltrim(p_model, '~'), '/', 1)) ELSE 'other' END;
$$;

-- The IST calendar day or month an instant falls in.
CREATE FUNCTION private.credit_usage_bucket(p_at timestamptz, p_bucket text) RETURNS date
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT CASE WHEN p_bucket = 'month' THEN date_trunc('month', p_at AT TIME ZONE 'Asia/Kolkata')::date
              ELSE (p_at AT TIME ZONE 'Asia/Kolkata')::date END;
$$;

-- Every charged row of the user's charge entries in [p_from, p_to), with its share of the entry's
-- credits and of its web-search credits. Credits are positive here.
CREATE FUNCTION private.credit_usage_charged(p_user uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (ledger_id uuid, charged_at timestamptz, turn_key text, model_call_log_id uuid, model text,
               caller text, credits numeric, web_search_credits numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT e.id, e.created_at, e.turn_key, c.model_call_log_id,
         private.credit_usage_model(l.model_requested, l.model_served),
         l.caller,
         CASE WHEN c.model_call_log_id IS NULL THEN -e.credits
              WHEN t.cost > 0 THEN -e.credits * c.cost_usd / t.cost
              ELSE 0 END,
         CASE WHEN t.cost > 0 AND coalesce(l.web_search_cost_usd, 0) > 0
              THEN least(-e.credits * c.cost_usd / t.cost, -e.credits * l.web_search_cost_usd / t.cost)
              ELSE 0 END
  FROM public.credit_ledger e
  LEFT JOIN public.credit_charge_rows c ON c.ledger_id = e.id
  LEFT JOIN LATERAL (SELECT sum(c2.cost_usd) AS cost FROM public.credit_charge_rows c2 WHERE c2.ledger_id = e.id) t ON true
  LEFT JOIN public.model_call_logs l ON l.id = c.model_call_log_id AND l.user_id = p_user
  WHERE e.user_id = p_user AND e.kind = 'charge' AND e.created_at >= p_from AND e.created_at < p_to;
$$;

-- 3. my_usage_summary ----------------------------------------------------------------------------------
CREATE FUNCTION public.my_usage_summary(p_from timestamptz, p_to timestamptz) RETURNS jsonb
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
    FROM (SELECT ch.model, ch.credits, 0 AS calls, 0 AS tokens FROM charged ch
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
                    WHERE coalesce(ch.caller, 'research-chat') <> 'transcribe-audio'),
        'searches', (SELECT coalesce(sum(ca.searches), 0) FROM calls ca WHERE ca.caller = 'research-chat')),
      jsonb_build_object('feature', 'dictation',
        'calls', (SELECT count(*) FROM calls ca WHERE ca.caller = 'transcribe-audio'),
        'credits', (SELECT coalesce(round(sum(ch.credits), 4), 0) FROM charged ch WHERE ch.caller = 'transcribe-audio'),
        'searches', 0)),
    'lifetime_credits', (SELECT coalesce(-sum(e.credits), 0) FROM public.credit_ledger e
                         WHERE e.user_id = uid AND e.kind = 'charge'))
  INTO v;
  RETURN v;
END;
$$;

-- 4. my_usage_timeseries ---------------------------------------------------------------------------------
CREATE FUNCTION public.my_usage_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v_bucket text := CASE WHEN p_bucket = 'month' THEN 'month' ELSE 'day' END;
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz := p_from;
  v_series jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to read credits' USING ERRCODE = '42501';
  END IF;
  IF v_from IS NULL THEN
    SELECT least((SELECT min(e.created_at) FROM public.credit_ledger e WHERE e.user_id = uid AND e.kind = 'charge'),
                 (SELECT min(l.created_at) FROM public.model_call_logs l
                  WHERE l.user_id = uid AND l.caller IN ('research-chat', 'transcribe-audio')))
    INTO v_from;
    v_from := coalesce(v_from, v_to);
  END IF;
  v_from := greatest(v_from, v_to - CASE v_bucket WHEN 'month' THEN interval '10 years' ELSE interval '400 days' END);
  IF v_from >= v_to THEN
    RETURN jsonb_build_object('bucket', v_bucket, 'series', '[]'::jsonb);
  END IF;

  WITH buckets AS (
    SELECT g::date AS b
    FROM generate_series(private.credit_usage_bucket(v_from, v_bucket)::timestamp,
                         private.credit_usage_bucket(v_to - interval '1 microsecond', v_bucket)::timestamp,
                         CASE v_bucket WHEN 'month' THEN interval '1 month' ELSE interval '1 day' END) g
  ), cells AS (
    SELECT x.b, x.model, round(sum(x.credits), 4) AS credits, sum(x.calls)::bigint AS calls, sum(x.tokens)::bigint AS tokens
    FROM (
      SELECT private.credit_usage_bucket(ch.charged_at, v_bucket) AS b, ch.model, ch.credits, 0 AS calls, 0 AS tokens
      FROM private.credit_usage_charged(uid, v_from, v_to) ch
      UNION ALL
      SELECT private.credit_usage_bucket(l.created_at, v_bucket),
             private.credit_usage_model(l.model_requested, l.model_served), 0, 1,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0))
      FROM public.model_call_logs l
      WHERE l.user_id = uid AND l.created_at >= v_from AND l.created_at < v_to
        AND l.caller IN ('research-chat', 'transcribe-audio')
    ) x
    GROUP BY x.b, x.model
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket_start', to_char(bk.b, 'YYYY-MM-DD'), 'model', c.model,
                                               'credits', coalesce(c.credits, 0), 'calls', coalesce(c.calls, 0),
                                               'tokens', coalesce(c.tokens, 0))
                            ORDER BY bk.b, c.model NULLS FIRST), '[]'::jsonb)
  INTO v_series
  FROM buckets bk
  LEFT JOIN cells c ON c.b = bk.b;
  RETURN jsonb_build_object('bucket', v_bucket, 'series', v_series);
END;
$$;

-- 5. my_usage_activity ----------------------------------------------------------------------------------
CREATE FUNCTION public.my_usage_activity(p_offset integer, p_limit integer, p_grouped boolean, p_model text,
  p_status text, p_kind text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE
  uid uuid := auth.uid();
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_model text := nullif(left(btrim(coalesce(p_model, '')), 200), '');
  v_status text := CASE WHEN p_status IN ('succeeded', 'failed') THEN p_status ELSE 'all' END;
  v_kind text := CASE WHEN p_kind IN ('answers', 'dictation') THEN p_kind ELSE 'all' END;
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
        SELECT sum(CASE WHEN t.cost > 0 THEN -e.credits * c.cost_usd / t.cost ELSE 0 END) AS credits
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
                            THEN (SELECT coalesce(-sum(e.credits), 0) FROM public.credit_ledger e
                                  WHERE e.user_id = uid AND e.kind = 'charge' AND e.turn_key = p.key)
                            ELSE (SELECT coalesce(round(sum(cc.credits), 4), 0) FROM call_credits cc WHERE cc.key = p.key) END,
               'detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', cc.role, 'model', cc.model,
                                    'effort', cc.reasoning_effort, 'tokens', cc.tokens,
                                    'credits', coalesce(round(cc.credits, 4), 0), 'free', cc.credits IS NULL,
                                    'status', cc.status) ORDER BY cc.created_at, cc.id), '[]'::jsonb)
                          FROM call_credits cc WHERE cc.key = p.key)) AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN public.chat_messages um ON um.id = p.user_message_id AND um.user_id = uid
    ) r;
  ELSE
    WITH items AS (
      SELECT l.id, l.created_at, l.message_id, l.conversation_id, l.reasoning_effort,
             private.credit_usage_model(l.model_requested, l.model_served) AS model,
             CASE l.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END AS status,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens
      FROM public.model_call_logs l
      WHERE l.user_id = uid
        AND ((v_kind IN ('all', 'answers') AND l.caller = 'research-chat')
             OR (v_kind IN ('all', 'dictation') AND l.caller = 'transcribe-audio'))
    ), filtered AS (
      SELECT * FROM items i
      WHERE (v_model IS NULL OR i.model = v_model)
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
               'calls', 1,
               'tokens', p.tokens,
               'credits', coalesce(round(cr.credits, 4), 0),
               'detail', '[]'::jsonb) AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.cost > 0 THEN -e.credits * ch.cost_usd / t.cost ELSE 0 END) AS credits
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

-- 6. my_credits(): `recent` limited before it aggregates, and cycle.starts_at --------------------------
-- Unchanged except cycle.starts_at and the `recent` query: it reads the latest 200 non-zero charge entries (credit_ledger_user_time),
-- keeps the 20 most recent turns among them, and only then sums those turns' entries and joins titles.
-- A turn has one entry per settle or sweep, so 200 entries always hold the 20 latest turns.
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
    SELECT o.granted, o.expires_at INTO v_allowance, v_ends FROM public.credit_lots o
    WHERE o.user_id = uid AND o.source_key = 'signup' AND o.closed_at IS NULL;
  END IF;

  -- Credits charged to answers this cycle (review R, I2). The cycle starts with the current open
  -- monthly lot (the latest-ending one, which also gives cycle.ends_at), else on Free with the open
  -- signup lot; with neither there is no cycle and the figure is null.
  SELECT o.starts_at INTO v_cycle_start FROM public.credit_lots o
  WHERE o.user_id = uid AND o.kind = 'monthly' AND o.closed_at IS NULL
  ORDER BY o.expires_at DESC, o.starts_at DESC LIMIT 1;
  IF v_cycle_start IS NULL THEN
    SELECT o.starts_at INTO v_cycle_start FROM public.credit_lots o
    WHERE o.user_id = uid AND o.source_key = 'signup' AND o.closed_at IS NULL;
  END IF;
  IF v_cycle_start IS NOT NULL THEN
    SELECT coalesce(-sum(e.credits), 0) INTO v_used FROM public.credit_ledger e
    WHERE e.user_id = uid AND e.kind = 'charge' AND e.created_at >= v_cycle_start;
  END IF;

  SELECT coalesce(sum(x.credits), 0) INTO v_held FROM public.credit_holds x
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
    SELECT e.turn_key, -sum(e.credits) AS credits, max(e.created_at) AS created_at
    FROM turns k
    JOIN public.credit_ledger e ON e.user_id = uid AND e.kind = 'charge' AND e.turn_key = k.turn_key
    GROUP BY e.turn_key
    HAVING sum(e.credits) < 0
    ORDER BY max(e.created_at) DESC, e.turn_key
    LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('conversation_id', t.conversation_id, 'title', c.title,
                                               'credits', r.credits, 'created_at', r.created_at)
                            ORDER BY r.created_at DESC, r.turn_key), '[]'::jsonb) INTO v_recent
  FROM totals r
  LEFT JOIN public.research_turns t ON t.user_id = uid AND t.turn_key = r.turn_key
  LEFT JOIN public.conversations c ON c.id = t.conversation_id AND c.user_id = uid;

  RETURN jsonb_build_object('balance', w.balance, 'held', v_held, 'debt', w.debt, 'plan', v_plan,
           -- The published value of one credit in rupees, for the UI's rupee hint; never dollars.
           'inr_per_credit', (SELECT cs.inr_per_credit FROM public.credit_settings cs WHERE cs.id),
           'cycle', jsonb_build_object('allowance', v_allowance, 'starts_at', v_cycle_start, 'ends_at', v_ends),
           'used_this_cycle', v_used, 'lots', v_lots, 'recent', v_recent);
END;
$$;

-- 7. Function privileges -------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.my_usage_summary(timestamptz, timestamptz),
  public.my_usage_timeseries(timestamptz, timestamptz, text),
  public.my_usage_activity(integer, integer, boolean, text, text, text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.my_usage_summary(timestamptz, timestamptz),
  public.my_usage_timeseries(timestamptz, timestamptz, text),
  public.my_usage_activity(integer, integer, boolean, text, text, text)
TO authenticated;
REVOKE ALL ON FUNCTION
  private.credit_usage_model(text, text),
  private.credit_usage_provider(text),
  private.credit_usage_bucket(timestamptz, text),
  private.credit_usage_charged(uuid, timestamptz, timestamptz)
FROM PUBLIC, anon, authenticated, service_role;
