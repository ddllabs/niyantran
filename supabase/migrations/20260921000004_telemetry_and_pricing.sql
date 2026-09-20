-- 0004: model call logs, per-turn traces, model pricing.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §B (Decision 7); ADR 0002 point 4.
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 3.
--
-- Down (manual):
--   drop table if exists public.chat_turn_traces, public.model_call_logs, public.model_pricing;

create table public.model_call_logs (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  user_id                   uuid,
  conversation_id           uuid,
  message_id                uuid,
  caller                    text not null,     -- 'research-chat' | 'ingest-documents' | 'repair'
  purpose                   text not null,     -- 'chat_answer' | 'embedding' | 'citation_repair'
  model_requested           text,
  model_served              text,
  provider                  text,
  status                    text not null check (status in ('success', 'error', 'aborted')),
  error_message             text,
  latency_ms                int,
  prompt_tokens             int,
  completion_tokens         int,
  total_tokens              int,
  cached_prompt_tokens      int,
  reasoning_tokens          int,
  cost_usd                  numeric(12, 6),
  openrouter_generation_id  text,
  raw_usage                 jsonb
);
create index model_call_logs_user_time on public.model_call_logs (user_id, created_at desc);
create index model_call_logs_conversation on public.model_call_logs (conversation_id);

create table public.chat_turn_traces (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  user_id            uuid,
  conversation_id    uuid,
  message_id         uuid not null,
  step_index         int  not null,
  step_type          text not null
                     check (step_type in ('search_documents', 'search_desk_rows', 'reasoning', 'answer')),
  input              text,
  result_count       int,
  top_similarity     numeric,
  latency_ms         int,
  chunk_ids          uuid[],
  row_keys           text[],
  model_call_log_id  uuid references public.model_call_logs(id) on delete set null,
  aborted            boolean not null default false,
  error_message      text
);
create index chat_turn_traces_message on public.chat_turn_traces (message_id, step_index);

-- Ported shape from the owner's other product; refreshed from OpenRouter every twelve hours.
create table public.model_pricing (
  model_id                text primary key,
  context_length          int,
  max_completion_tokens   int,
  prompt_usd              numeric,
  completion_usd          numeric,
  cache_read_usd          numeric,
  cache_write_usd         numeric,
  internal_reasoning_usd  numeric,
  supported_parameters    text[],
  is_available            boolean not null default true,
  fetched_at              timestamptz not null default now()
);

-- RLS: telemetry is readable by its own user only; pricing by every signed-in user.
-- Only the service role writes any of these. anon gets nothing.
alter table public.model_call_logs  enable row level security;
alter table public.chat_turn_traces enable row level security;
alter table public.model_pricing    enable row level security;

create policy model_call_logs_own  on public.model_call_logs  for select to authenticated using (user_id = auth.uid());
create policy chat_turn_traces_own on public.chat_turn_traces for select to authenticated using (user_id = auth.uid());
create policy model_pricing_read   on public.model_pricing    for select to authenticated using (true);

grant select on public.model_call_logs, public.chat_turn_traces, public.model_pricing to authenticated;
revoke all on public.model_call_logs, public.chat_turn_traces, public.model_pricing from anon;
