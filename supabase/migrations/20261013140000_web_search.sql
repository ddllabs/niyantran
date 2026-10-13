-- Web search in AI Research (open-work F124; docs/specs/2026-10-13-web-search.md §5).
--
-- research-chat offers OpenRouter's web-search server tool (Exa) on research
-- calls. This migration stores what that needs:
--
--   * conversations.web_search: the reader's globe override for the
--     conversation. NULL means automatic (the server decides from the turn's
--     scope). The owner may already update their own conversations
--     (conversations_update, 0002), so this is their own preference and needs
--     no new grant; research-chat also writes it with the service role.
--   * chat_messages.web_sources: the pages searched for an assistant answer,
--     at most 20 {url, title, domain, cited}. Readers cannot insert it: the
--     INSERT column grant from 0013 does not include it.
--   * model_call_logs.web_search_count and web_search_cost_usd: per provider
--     call. cost_usd already includes the search; this is the attributed
--     share, never added to it.
--   * chat_turn_traces.step_type gains 'web_search'.
--
-- Existing RLS covers the new columns: owners read their own rows; only the
-- service role writes the telemetry tables.
--
-- Down:
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
