-- A refund of unlock credits is its own line in the usage history (Live TV phase 2, track 3; follows open-work F364).
--
-- When an administrator removes a video's shared results, each unlock is refunded once through private.credit_mint as a
-- ledger entry of kind 'adjustment' (20261122090000_factcheck_video_remove_refund.sql: credits positive, request_id = the
-- unlock id, note 'live tv fact-check unlock refund', in a lot whose source key is 'fcu-refund:<unlock id>'). The usage
-- reports read only kind 'charge', so the user saw the refund in the balance and nowhere in the history.
--
-- This migration replaces ONLY public.my_usage_activity (an exact copy of its current body, 20261116100000_factcheck_usage_reports.sql,
-- produced by position-checked replacements of that file's text, so a changed original fails the generation) and adds the
-- helper private.factcheck_refunds(user). In both modes (grouped and per call) the list gains one row per refund:
--   turn_key null, conversation_id null, title null, question null, status 'succeeded', model null, calls 0, tokens 0,
--   credits = the credits returned, POSITIVE (an adjustment entry holds its credits in the unit of its day and no rate, like the balance sums them), detail [], and the extra keys feature
--   'factcheck_refund', channel, video_kind and video_id (null once the user deleted the session, which removes the unlock).
-- p_kind 'all' and 'factcheck' list them; 'answers' and 'dictation' do not; a model filter matches them only for the value
-- 'factcheck'; the status filter treats them as succeeded. The refund is found by its lot's source key, not by its note
-- alone, so no other adjustment can look like one. They are the signed-in user's own ledger entries only. The list's
-- total counts them (they are rows). Chat, dictation and fact-check charge rows are unchanged.
-- Not changed: my_usage_summary, my_usage_timeseries, my_credits (its used_this_cycle and totals read charges only, so no
-- total counts the refund, and nothing is netted), credit_usage_charged, and every grant.
--
-- The migration refuses (55000, naming the function) to run over a function whose source is neither the original nor this
-- migration's own, and applying it twice is a no-op. Privileges and owners are kept (CREATE OR REPLACE). Nothing is
-- written, no table changes, nothing is deleted.
--
-- RELEASE ORDER: apply this migration first, then deploy the browser. The new browser works against the old function (it
-- simply never sees a refund row); the old browser against the new function would read a refund row as a dictation row
-- (feature unknown, no chat, no turn key), so the database must not go first without the browser following soon.
-- Applying the migration first is the safer of the two: do both in the same sitting.
--
-- Down: re-run public.my_usage_activity from 20261116100000_factcheck_usage_reports.sql, then
--   drop function private.factcheck_refunds(uuid);

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.my_usage_activity(integer,integer,boolean,text,text,text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('e70f35ab76b6b0df7cfbdb274a4792ec', '411f88ac918474997cb4cd806ea01bc1') THEN
    RAISE EXCEPTION 'factcheck_refund_usage: public.my_usage_activity(integer,integer,boolean,text,text,text) differs from the version this migration was written against (source md5 %); review it before applying',
      coalesce(v_md5, 'missing') USING ERRCODE = '55000';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION private.factcheck_refunds(p_user uuid)
RETURNS TABLE (ledger_id uuid, refunded_at timestamptz, credits numeric, channel_id text, video_kind text, video_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $$
  SELECT e.id, e.created_at, e.credits,
         fs.channel_id, fs.video_kind, u.video_id
  FROM public.credit_ledger e
  JOIN public.credit_lots l ON l.id = e.lot_id AND l.user_id = e.user_id AND l.source_key = 'fcu-refund:' || e.request_id::text
  LEFT JOIN public.factcheck_unlocks u ON u.id = e.request_id AND u.user_id = e.user_id
  -- The session belongs to the runner of the stretch, not to the user who unlocked it, so it is joined by id only.
  LEFT JOIN public.factcheck_sessions fs ON fs.id = u.session_id
  WHERE e.user_id = p_user AND e.kind = 'adjustment' AND e.credits > 0;
$$;
REVOKE ALL ON FUNCTION private.factcheck_refunds(uuid) FROM PUBLIC, anon, authenticated, service_role;

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
      UNION ALL
      SELECT 'refund', r.ledger_id::text, r.refunded_at, NULL, NULL, NULL, NULL, 'succeeded',
             (v_model IS NULL OR v_model = 'factcheck')
      FROM private.factcheck_refunds(uid) r WHERE v_kind IN ('all', 'factcheck')
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
                            WHEN p.item = 'refund' THEN coalesce(rfr.credits, 0)
                            ELSE (SELECT coalesce(round(sum(cc.credits), 4), 0) FROM call_credits cc WHERE cc.key = p.key) END,
               'detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', cc.role, 'model', cc.model,
                                    'effort', cc.reasoning_effort, 'tokens', cc.tokens,
                                    'credits', coalesce(round(cc.credits, 4), 0), 'free', cc.credits IS NULL,
                                    'status', cc.status) ORDER BY cc.created_at, cc.id), '[]'::jsonb)
                          FROM call_credits cc WHERE cc.key = p.key))
             || CASE WHEN p.item = 'factcheck' THEN jsonb_build_object('feature', 'factcheck', 'channel', fcr.channel_id, 'minutes_used', fcr.minutes_used,
                                                 'video_kind', fcr.video_kind) ELSE '{}'::jsonb END
             || CASE WHEN p.item = 'refund' THEN jsonb_build_object('feature', 'factcheck_refund', 'channel', rfr.channel_id,
                                                 'video_kind', rfr.video_kind, 'video_id', rfr.video_id) ELSE '{}'::jsonb END AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN public.chat_messages um ON um.id = p.user_message_id AND um.user_id = uid
      LEFT JOIN LATERAL (SELECT x.* FROM private.factcheck_charges(uid, '-infinity', 'infinity') x
                         WHERE p.item = 'factcheck' AND x.ledger_id::text = p.key
                         OFFSET 0) fcr ON true
      LEFT JOIN LATERAL (SELECT x.* FROM private.factcheck_refunds(uid) x
                         WHERE p.item = 'refund' AND x.ledger_id::text = p.key
                         OFFSET 0) rfr ON true
    ) r;
  ELSE
    WITH items AS (
      SELECT l.id, l.created_at, l.message_id, l.conversation_id, l.reasoning_effort,
             private.credit_usage_model(l.model_requested, l.model_served) AS model,
             CASE l.status WHEN 'success' THEN 'succeeded' WHEN 'aborted' THEN 'stopped' ELSE 'failed' END AS status,
             coalesce(l.total_tokens, coalesce(l.prompt_tokens, 0) + coalesce(l.completion_tokens, 0)) AS tokens,
             false AS is_fc, false AS is_rf
      FROM public.model_call_logs l
      WHERE l.user_id = uid
        AND ((v_kind IN ('all', 'answers') AND l.caller = 'research-chat')
             OR (v_kind IN ('all', 'dictation') AND l.caller = 'transcribe-audio'))
      UNION ALL
      SELECT f.ledger_id, f.charged_at, NULL::uuid, NULL::uuid, NULL::text, NULL::text, 'succeeded', 0, true, false
      FROM private.factcheck_charges(uid, '-infinity', 'infinity') f WHERE v_kind IN ('all', 'factcheck')
      UNION ALL
      SELECT r.ledger_id, r.refunded_at, NULL::uuid, NULL::uuid, NULL::text, NULL::text, 'succeeded', 0, false, true
      FROM private.factcheck_refunds(uid) r WHERE v_kind IN ('all', 'factcheck')
    ), filtered AS (
      SELECT * FROM items i
      WHERE (v_model IS NULL OR i.model = v_model OR ((i.is_fc OR i.is_rf) AND v_model = 'factcheck'))
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
               'calls', CASE WHEN p.is_fc OR p.is_rf THEN 0 ELSE 1 END,
               'tokens', p.tokens,
               'credits', CASE WHEN p.is_fc THEN coalesce(fcr.credits, 0) WHEN p.is_rf THEN coalesce(rfr.credits, 0) ELSE coalesce(round(cr.credits, 4), 0) END,
               'detail', '[]'::jsonb)
             || CASE WHEN p.is_fc THEN jsonb_build_object('feature', 'factcheck', 'channel', fcr.channel_id, 'minutes_used', fcr.minutes_used,
                                                 'video_kind', fcr.video_kind) ELSE '{}'::jsonb END
             || CASE WHEN p.is_rf THEN jsonb_build_object('feature', 'factcheck_refund', 'channel', rfr.channel_id,
                                                 'video_kind', rfr.video_kind, 'video_id', rfr.video_id) ELSE '{}'::jsonb END AS row
      FROM page p
      LEFT JOIN public.conversations c ON c.id = p.conversation_id AND c.user_id = uid
      LEFT JOIN LATERAL (SELECT x.* FROM private.factcheck_charges(uid, '-infinity', 'infinity') x
                         WHERE p.is_fc AND x.ledger_id = p.id
                         OFFSET 0) fcr ON true
      LEFT JOIN LATERAL (SELECT x.* FROM private.factcheck_refunds(uid) x
                         WHERE p.is_rf AND x.ledger_id = p.id
                         OFFSET 0) rfr ON true
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
