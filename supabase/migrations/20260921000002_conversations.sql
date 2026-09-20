-- 0002: conversations, chat messages, cancellations — user-scoped under RLS.
-- Spec: docs/specs/2026-09-20-ai-backend-foundation-design.md §B; ADR 0003.
-- Plan: docs/plans/2026-09-21-ai-backend-foundation.md Task 2.
--
-- Down (manual):
--   drop table if exists public.chat_cancellations, public.chat_messages, public.conversations;

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title            text not null default 'New research',
  desk_tier        text,
  desk_feature     text,
  model_id         text,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index conversations_user_recent on public.conversations (user_id, last_message_at desc nulls last);

create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null default auth.uid(),
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  sources          jsonb not null default '[]',   -- CitationSource[]
  follow_ups       jsonb not null default '[]',
  activity         jsonb not null default '[]',   -- persisted ticker trace
  model_requested  text,
  model_served     text,
  reasoning_effort text,
  status           text not null default 'complete'
                   check (status in ('complete', 'error', 'cancelled', 'truncated')),
  error_message    text,
  turn_key         text,                          -- idempotency claim, user turns only
  usage            jsonb,                         -- tokens and cost_usd
  timing           jsonb,                         -- search_ms, reasoning_ms, writing_ms, total_ms
  created_at       timestamptz not null default now(),
  unique (conversation_id, turn_key)
);
create index chat_messages_conversation_order on public.chat_messages (conversation_id, created_at);

create table public.chat_cancellations (
  conversation_id      uuid primary key references public.conversations(id) on delete cascade,
  user_id              uuid not null default auth.uid(),
  cancel_requested_at  timestamptz not null default now()
);

-- updated_at maintenance, reusing the project's existing helper.
create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.update_updated_at_column();

-- Row-level security: a user sees and edits only their own rows. anon gets nothing.
alter table public.conversations      enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.chat_cancellations enable row level security;

create policy conversations_select on public.conversations for select to authenticated using (user_id = auth.uid());
create policy conversations_insert on public.conversations for insert to authenticated with check (user_id = auth.uid());
create policy conversations_update on public.conversations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy conversations_delete on public.conversations for delete to authenticated using (user_id = auth.uid());

create policy chat_messages_select on public.chat_messages for select to authenticated using (user_id = auth.uid());
create policy chat_messages_insert on public.chat_messages for insert to authenticated with check (user_id = auth.uid());
create policy chat_messages_update on public.chat_messages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chat_messages_delete on public.chat_messages for delete to authenticated using (user_id = auth.uid());

create policy chat_cancellations_select on public.chat_cancellations for select to authenticated using (user_id = auth.uid());
create policy chat_cancellations_insert on public.chat_cancellations for insert to authenticated with check (user_id = auth.uid());
create policy chat_cancellations_update on public.chat_cancellations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chat_cancellations_delete on public.chat_cancellations for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.conversations, public.chat_messages, public.chat_cancellations to authenticated;
revoke all on public.conversations, public.chat_messages, public.chat_cancellations from anon;
