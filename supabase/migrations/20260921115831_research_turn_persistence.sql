-- D3: durable server-owned turn claims. No jobs, providers or live URLs.
BEGIN;

ALTER TABLE public.chat_messages DROP CONSTRAINT chat_messages_status_check;
ALTER TABLE public.chat_messages
  ADD COLUMN execution_expires_at timestamptz,
  ADD CONSTRAINT chat_messages_status_check
    CHECK (status IN ('running', 'complete', 'error', 'cancelled', 'truncated', 'interrupted')),
  ADD CONSTRAINT chat_messages_execution_check CHECK (
    (status <> 'running' OR execution_expires_at IS NOT NULL)
    AND (status NOT IN ('running', 'interrupted') OR role = 'assistant')
  );

CREATE TABLE public.research_turns (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_key text NOT NULL CHECK (length(turn_key) BETWEEN 1 AND 64 AND length(btrim(turn_key)) > 0),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  conversation_id uuid,
  user_message_id uuid UNIQUE REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  assistant_message_id uuid UNIQUE REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  execution_token uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, turn_key),
  FOREIGN KEY (conversation_id, user_id) REFERENCES public.conversations(id, user_id)
    ON DELETE SET NULL (conversation_id)
);
CREATE INDEX research_turns_conversation ON public.research_turns(conversation_id);
CREATE INDEX chat_messages_owner_turn ON public.chat_messages(user_id, turn_key) WHERE turn_key IS NOT NULL;
ALTER TABLE public.research_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.research_turns FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.research_turns TO service_role;

-- FK SET NULL preserves the owner/key tombstone when the conversation or its
-- messages are deleted. A service adapter cannot rewrite a consumed intent.
CREATE FUNCTION public.guard_research_turn() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    (NEW.user_id, NEW.turn_key, NEW.request_hash, NEW.created_at)
      IS DISTINCT FROM (OLD.user_id, OLD.turn_key, OLD.request_hash, OLD.created_at)
    OR (OLD.execution_token IS NOT NULL AND NEW.execution_token IS DISTINCT FROM OLD.execution_token)
    OR (OLD.execution_token IS NOT NULL AND NEW.conversation_id IS NOT NULL AND OLD.conversation_id IS DISTINCT FROM NEW.conversation_id)
    OR (OLD.execution_token IS NOT NULL AND NEW.user_message_id IS NOT NULL AND OLD.user_message_id IS DISTINCT FROM NEW.user_message_id)
    OR (OLD.execution_token IS NOT NULL AND NEW.assistant_message_id IS NOT NULL AND OLD.assistant_message_id IS DISTINCT FROM NEW.assistant_message_id)
  ) THEN
    RAISE EXCEPTION 'Turn identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS NULL AND EXISTS (SELECT FROM public.conversations WHERE id = OLD.conversation_id))
    OR (OLD.user_message_id IS NOT NULL AND NEW.user_message_id IS NULL AND EXISTS (SELECT FROM public.chat_messages WHERE id = OLD.user_message_id))
    OR (OLD.assistant_message_id IS NOT NULL AND NEW.assistant_message_id IS NULL AND EXISTS (SELECT FROM public.chat_messages WHERE id = OLD.assistant_message_id))
  ) THEN
    RAISE EXCEPTION 'Live claim links cannot be detached' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT FROM public.conversations c WHERE c.id = NEW.conversation_id AND c.user_id = NEW.user_id)
      OR (NEW.user_message_id IS NOT NULL AND NOT EXISTS (
        SELECT FROM public.chat_messages m WHERE m.id = NEW.user_message_id AND m.user_id = NEW.user_id
          AND m.conversation_id = NEW.conversation_id AND m.role = 'user'))
      OR (NEW.assistant_message_id IS NOT NULL AND NOT EXISTS (
        SELECT FROM public.chat_messages m WHERE m.id = NEW.assistant_message_id AND m.user_id = NEW.user_id
          AND m.conversation_id = NEW.conversation_id AND m.role = 'assistant')) THEN
      RAISE EXCEPTION 'Turn ownership mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER research_turn_identity BEFORE INSERT OR UPDATE ON public.research_turns
FOR EACH ROW EXECUTE FUNCTION public.guard_research_turn();

CREATE FUNCTION public.guard_research_result() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT FROM public.research_turns t WHERE t.assistant_message_id = OLD.id) THEN
    IF (OLD.status <> 'running' AND NEW IS DISTINCT FROM OLD)
      OR (NEW.id, NEW.user_id, NEW.conversation_id, NEW.role, NEW.turn_key, NEW.execution_expires_at, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.conversation_id, OLD.role, OLD.turn_key, OLD.execution_expires_at, OLD.created_at) THEN
      RAISE EXCEPTION 'Claimed result is immutable after completion; identity cannot change' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER research_result_immutable BEFORE UPDATE ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_research_result();

CREATE FUNCTION public.lookup_research_turn(
  p_user_id uuid, p_turn_key text, p_request_hash text, p_conversation_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE t public.research_turns; m public.chat_messages; c public.conversations;
BEGIN
  IF NOT EXISTS (SELECT FROM public.user_profiles p WHERE p.user_id = p_user_id AND p.status = 'active') THEN
    RETURN jsonb_build_object('kind', 'forbidden');
  END IF;
  SELECT * INTO t FROM public.research_turns WHERE user_id = p_user_id AND turn_key = p_turn_key FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'missing'); END IF;
  IF t.request_hash <> p_request_hash THEN RETURN jsonb_build_object('kind', 'conflict'); END IF;
  IF t.conversation_id IS NULL OR t.user_message_id IS NULL OR t.assistant_message_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'deleted');
  END IF;
  IF p_conversation_id IS NOT NULL AND p_conversation_id <> t.conversation_id THEN
    RETURN jsonb_build_object('kind', 'conflict');
  END IF;
  SELECT * INTO c FROM public.conversations WHERE id = t.conversation_id AND user_id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;
  IF NOT EXISTS (SELECT FROM public.chat_messages WHERE id = t.user_message_id AND user_id = p_user_id
      AND conversation_id = c.id AND role = 'user') THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;
  SELECT * INTO m FROM public.chat_messages WHERE id = t.assistant_message_id AND user_id = p_user_id
    AND conversation_id = c.id AND role = 'assistant' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;
  IF m.status = 'running' AND m.execution_expires_at <= clock_timestamp() THEN
    UPDATE public.chat_messages SET status = 'interrupted', error_message = 'Execution interrupted.'
      WHERE id = m.id RETURNING * INTO m;
  END IF;
  RETURN jsonb_build_object('kind', CASE WHEN m.status = 'running' THEN 'running' ELSE 'terminal' END,
    'conversation', jsonb_build_object('id', c.id, 'title', c.title), 'user_message_id', t.user_message_id,
    'assistant', to_jsonb(m), 'server_now', clock_timestamp());
END;
$$;

CREATE FUNCTION public.claim_research_turn(
  p_user_id uuid, p_turn_key text, p_request_hash text, p_conversation_id uuid,
  p_message text, p_model text, p_effort text DEFAULT NULL, p_desk_tier text DEFAULT NULL, p_desk_feature text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE t public.research_turns; c public.conversations; m public.chat_messages; uid uuid; n integer;
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
    SELECT * INTO c FROM public.conversations WHERE id = p_conversation_id AND user_id = p_user_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002'; END IF;
  ELSE
    INSERT INTO public.conversations(user_id, title, desk_tier, desk_feature, model_id, last_message_at)
      VALUES (p_user_id, left(regexp_replace(p_message, '\s+', ' ', 'g'), 60), p_desk_tier, p_desk_feature, p_model, clock_timestamp())
      RETURNING * INTO c;
  END IF;
  INSERT INTO public.chat_messages(conversation_id, user_id, role, content, turn_key)
    VALUES (c.id, p_user_id, 'user', p_message, p_turn_key) RETURNING id INTO uid;
  INSERT INTO public.chat_messages(conversation_id, user_id, role, content, status, model_requested, reasoning_effort, execution_expires_at)
    VALUES (c.id, p_user_id, 'assistant', '', 'running', p_model, p_effort, clock_timestamp() + interval '120 seconds')
    RETURNING * INTO m;
  UPDATE public.research_turns SET conversation_id = c.id, user_message_id = uid, assistant_message_id = m.id, execution_token = gen_random_uuid()
    WHERE user_id = p_user_id AND turn_key = p_turn_key RETURNING * INTO t;
  RETURN jsonb_build_object('kind', 'claimed', 'conversation', jsonb_build_object('id', c.id, 'title', c.title),
    'user_message_id', uid, 'assistant', to_jsonb(m), 'execution_token', t.execution_token, 'server_now', clock_timestamp());
END;
$$;

CREATE FUNCTION public.finalize_research_turn(
  p_user_id uuid, p_turn_key text, p_execution_token uuid, p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE t public.research_turns; m public.chat_messages; c public.conversations;
BEGIN
  SELECT * INTO t FROM public.research_turns WHERE user_id = p_user_id AND turn_key = p_turn_key FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;
  IF t.execution_token IS DISTINCT FROM p_execution_token THEN RETURN jsonb_build_object('kind', 'forbidden'); END IF;
  IF t.conversation_id IS NULL OR t.user_message_id IS NULL OR t.assistant_message_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'deleted');
  END IF;
  SELECT * INTO c FROM public.conversations WHERE id = t.conversation_id AND user_id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;
  IF NOT EXISTS (SELECT FROM public.chat_messages WHERE id = t.user_message_id AND user_id = p_user_id
      AND conversation_id = c.id AND role = 'user') THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;
  SELECT * INTO m FROM public.chat_messages WHERE id = t.assistant_message_id AND user_id = p_user_id
    AND conversation_id = c.id AND role = 'assistant' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;
  IF m.status = 'running' THEN
    IF m.execution_expires_at <= clock_timestamp() THEN
      UPDATE public.chat_messages SET status = 'interrupted', error_message = 'Execution interrupted.'
        WHERE id = m.id RETURNING * INTO m;
    ELSE
      IF jsonb_typeof(p_result) IS DISTINCT FROM 'object'
        OR p_result->>'status' IS NULL OR p_result->>'status' NOT IN ('complete', 'error', 'cancelled', 'truncated', 'interrupted')
        OR jsonb_typeof(p_result->'content') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_result->'sources') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p_result->'follow_ups') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p_result->'activity') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Invalid terminal result' USING ERRCODE = '22023';
      END IF;
      UPDATE public.chat_messages SET content = p_result->>'content', status = p_result->>'status',
        sources = p_result->'sources', follow_ups = p_result->'follow_ups', activity = p_result->'activity',
        model_served = p_result->>'model_served', error_message = p_result->>'error_message',
        usage = NULLIF(p_result->'usage', 'null'::jsonb), timing = NULLIF(p_result->'timing', 'null'::jsonb)
        WHERE id = m.id RETURNING * INTO m;
    END IF;
    UPDATE public.conversations SET last_message_at = clock_timestamp() WHERE id = c.id AND user_id = p_user_id;
  END IF;
  RETURN jsonb_build_object('kind', 'terminal', 'conversation', jsonb_build_object('id', c.id, 'title', c.title),
    'user_message_id', t.user_message_id, 'assistant', to_jsonb(m), 'server_now', clock_timestamp());
END;
$$;

REVOKE ALL ON FUNCTION public.guard_research_turn(), public.guard_research_result(),
  public.lookup_research_turn(uuid,text,text,uuid),
  public.claim_research_turn(uuid,text,text,uuid,text,text,text,text,text),
  public.finalize_research_turn(uuid,text,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_research_turn(), public.guard_research_result(),
  public.lookup_research_turn(uuid,text,text,uuid),
  public.claim_research_turn(uuid,text,text,uuid,text,text,text,text,text),
  public.finalize_research_turn(uuid,text,uuid,jsonb) TO service_role;

COMMIT;
