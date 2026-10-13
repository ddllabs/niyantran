-- Web search in AI Research (open-work F130; docs/specs/2026-10-13-web-search.md §5).
--
-- research-chat offers OpenRouter's web-search server tool (Exa) on research
-- calls. This migration stores what that needs:
--
--   * conversations.web_search: the reader's globe override for the
--     conversation. NULL means automatic (the server decides from the turn's
--     scope). The owner may already update their own conversations
--     (conversations_update, 0002), so this is their own preference and needs
--     no new grant; research-chat writes it with the reader's own client.
--   * chat_messages.web_sources: the pages searched for an assistant answer,
--     at most 20 {url, title, domain, cited}. Readers cannot insert it: the
--     INSERT column grant from 0013 does not include it.
--   * model_call_logs.web_search_count and web_search_cost_usd: per provider
--     call. cost_usd already includes the search; this is the attributed
--     share, never added to it.
--   * chat_turn_traces.step_type gains 'web_search'.
--
--   * finalize_research_turn (20260921115831) is replaced, unchanged except
--     that it validates and writes `web_sources` (an array; missing means
--     '[]'), because it writes an explicit column list and would otherwise
--     drop them. Its snapshots return to_jsonb(m), so they carry the column
--     without change. CREATE OR REPLACE keeps its owner and grants.
--
-- Existing RLS covers the new columns: owners read their own rows; only the
-- service role writes the telemetry tables.
--
-- Down:
--   (first) re-run the CREATE FUNCTION public.finalize_research_turn of
--   20260921115831_research_turn_persistence.sql as CREATE OR REPLACE;
--   alter table public.chat_turn_traces drop constraint chat_turn_traces_step_type_check;
--   delete from public.chat_turn_traces where step_type = 'web_search';
--   alter table public.chat_turn_traces add constraint chat_turn_traces_step_type_check
--     check (step_type in ('search_documents', 'search_desk_rows', 'reasoning', 'answer'));
--   alter table public.model_call_logs drop column web_search_cost_usd, drop column web_search_count;
--   alter table public.chat_messages drop column web_sources;
--   alter table public.conversations drop column web_search;

alter table public.conversations
  add column web_search boolean;

alter table public.chat_messages
  add column web_sources jsonb not null default '[]'
    constraint chat_messages_web_sources_array check (jsonb_typeof(web_sources) = 'array' and jsonb_array_length(web_sources) <= 20);

alter table public.model_call_logs
  add column web_search_count int not null default 0
    constraint model_call_logs_web_search_count_nonnegative check (web_search_count >= 0),
  add column web_search_cost_usd numeric(12,6)
    constraint model_call_logs_web_search_cost_nonnegative check (web_search_cost_usd >= 0);

alter table public.chat_turn_traces drop constraint chat_turn_traces_step_type_check;
alter table public.chat_turn_traces add constraint chat_turn_traces_step_type_check
  check (step_type in ('search_documents', 'search_desk_rows', 'reasoning', 'answer', 'web_search'));

CREATE OR REPLACE FUNCTION public.finalize_research_turn(
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
        OR jsonb_typeof(p_result->'activity') IS DISTINCT FROM 'array'
        OR (p_result ? 'web_sources' AND jsonb_typeof(p_result->'web_sources') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Invalid terminal result' USING ERRCODE = '22023';
      END IF;
      UPDATE public.chat_messages SET content = p_result->>'content', status = p_result->>'status',
        sources = p_result->'sources', follow_ups = p_result->'follow_ups', activity = p_result->'activity',
        web_sources = COALESCE(p_result->'web_sources', '[]'::jsonb),
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
