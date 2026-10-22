-- Chat-only lease extension: existing claims and financial functions are unchanged.
-- CREATE OR REPLACE preserves the existing service-only grants and invoker security.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_research_turn(
  p_user_id uuid, p_turn_key text, p_request_hash text, p_conversation_id uuid,
  p_message text, p_model text, p_effort text DEFAULT NULL, p_desk_tier text DEFAULT NULL, p_desk_feature text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE t public.research_turns; c public.conversations; m public.chat_messages; uid uuid; n integer; user_created_at timestamptz;
BEGIN
  IF NOT EXISTS (SELECT FROM public.user_profiles p WHERE p.user_id = p_user_id AND p.status = 'active') THEN
    RETURN jsonb_build_object('kind', 'forbidden');
  END IF;
  IF p_message IS NULL OR length(btrim(p_message)) = 0 OR length(p_message) > 4000 OR p_model IS NULL THEN
    RAISE EXCEPTION 'Invalid initial turn fields' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.research_turns(user_id, turn_key, request_hash)
    VALUES (p_user_id, p_turn_key, p_request_hash) ON CONFLICT (user_id, turn_key) DO NOTHING
    RETURNING * INTO t;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN public.lookup_research_turn(p_user_id, p_turn_key, p_request_hash, p_conversation_id); END IF;
  -- Fail closed for pre-migration/client-created keys; their complete intent is
  -- unavailable, so neither adopt them nor run another paid attempt for them.
  IF EXISTS (SELECT FROM public.chat_messages WHERE user_id = p_user_id AND turn_key = p_turn_key) THEN
    RAISE EXCEPTION 'Legacy turn key already exists' USING ERRCODE = '23505';
  END IF;
  IF p_conversation_id IS NOT NULL THEN
    SELECT * INTO c FROM public.conversations WHERE id = p_conversation_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002'; END IF;
    -- Advance the row version too: a stale REPEATABLE READ/SERIALIZABLE
    -- claimant must fail with 40001, not allocate from an older history snapshot.
    UPDATE public.conversations SET last_message_at = clock_timestamp()
      WHERE id = c.id AND user_id = p_user_id RETURNING * INTO c;
  ELSE
    INSERT INTO public.conversations(user_id, title, desk_tier, desk_feature, model_id, last_message_at)
      VALUES (p_user_id, left(regexp_replace(p_message, '\s+', ' ', 'g'), 60), p_desk_tier, p_desk_feature, p_model, clock_timestamp())
      RETURNING * INTO c;
  END IF;
  -- The parent lock serializes claims before reading chronology. New parents
  -- are private to this transaction. Do not use now(): multiple claims may
  -- share a transaction, and prior timestamps may be ahead of the wall clock.
  SELECT greatest(clock_timestamp(), max(created_at) + interval '1 microsecond')
    INTO user_created_at FROM public.chat_messages WHERE conversation_id = c.id;
  IF NOT isfinite(user_created_at) THEN
    RAISE EXCEPTION 'Conversation has a nonfinite message timestamp; repair chronology before claiming' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.chat_messages(conversation_id, user_id, role, content, turn_key, created_at)
    VALUES (c.id, p_user_id, 'user', p_message, p_turn_key, user_created_at) RETURNING id INTO uid;
  INSERT INTO public.chat_messages(conversation_id, user_id, role, content, status, model_requested, reasoning_effort, execution_expires_at, created_at)
    VALUES (c.id, p_user_id, 'assistant', '', 'running', p_model, p_effort, clock_timestamp() + interval '300 seconds', user_created_at + interval '1 microsecond')
    RETURNING * INTO m;
  UPDATE public.research_turns SET conversation_id = c.id, user_message_id = uid, assistant_message_id = m.id, execution_token = gen_random_uuid()
    WHERE user_id = p_user_id AND turn_key = p_turn_key RETURNING * INTO t;
  RETURN jsonb_build_object('kind', 'claimed', 'conversation', jsonb_build_object('id', c.id, 'title', c.title),
    'user_message_id', uid, 'assistant', to_jsonb(m), 'execution_token', t.execution_token, 'server_now', clock_timestamp());
END;
$$;

COMMIT;
