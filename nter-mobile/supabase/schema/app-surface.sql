-- nter.pro mobile — the part of NTER the app reads and writes, as it stood on 26 Oct 2026.
--
-- Read from the live NTER project (vfgcppstyzjarlzyqdac) with read-only catalogue queries. This is a
-- REFERENCE SNAPSHOT, not a migration: do not run it against NTER. The source of truth for the
-- schema is ddllabs/niyantran/supabase/migrations (newest: 20261023192554_law_listing_publication).
-- The app adds nothing to this schema.
--
-- Use it to: see at a glance what the app depends on; check a future NTER migration does not
-- break the app (compare the columns below); build a stand-in database for tests.

-- ---------------------------------------------------------------------------------------------
-- Tables (public schema). RLS is enabled on every one.
-- ---------------------------------------------------------------------------------------------

create table public.user_profiles (            -- app: read via rpc get_my_profile; update persona
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  organisation_id uuid,
  email text not null,
  first_name text,
  last_name text,
  phone_number text,
  phone_verified boolean not null default false,
  phone_verified_at timestamptz,
  department text,
  persona public.app_persona,                  -- policy_analyst | journalist | upsc_aspirant | corporate_affairs | legal_researcher | academic
  practice_area text,
  jurisdiction text,
  language text not null default 'en',
  role public.app_role not null default 'user',
  plan public.app_plan not null default 'free',
  status public.account_status not null default 'active',
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email_normalised text,
  plan_status text not null default 'free',
  plan_period_end timestamptz,
  plan_source text,
  trial_started_at timestamptz,
  active_billing_plan_period_id uuid
);
-- grants: select to authenticated; update (department, first_name, jurisdiction, language,
--         last_name, onboarding_complete, persona, phone_number, practice_area, updated_at)
-- policies: "Users can view own profile" (select, own row or platform admin),
--           "Users can view organisation profiles" (select), "Users can update own profile" (update)

create table public.user_preferences (         -- app: watchlist (read, upsert)
  user_id uuid not null primary key,
  watchlist jsonb,                             -- [{tab, feature, label}], at most 24
  tours jsonb,
  updated_at timestamptz not null default now()
);
-- grants: select, insert, update to authenticated · policies: own row only

create table public.conversations (            -- app: list, rename, delete (created by research-chat)
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null default auth.uid(),
  title text not null default 'New research',
  desk_tier text,
  desk_feature text,
  model_id text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  web_search boolean
);
-- grants: select, insert, update, delete to authenticated · policies: own rows only

create table public.chat_messages (            -- app: read a conversation's turns (written by research-chat)
  id uuid not null default gen_random_uuid() primary key,
  conversation_id uuid not null,
  user_id uuid not null default auth.uid(),
  role text not null,                          -- user | assistant
  content text not null,
  sources jsonb not null default '[]',
  follow_ups jsonb not null default '[]',
  activity jsonb not null default '[]',
  model_requested text,
  model_served text,
  reasoning_effort text,
  status text not null default 'complete',     -- complete | error | interrupted | cancelled | running
  error_message text,
  turn_key text,
  usage jsonb,
  timing jsonb,
  created_at timestamptz not null default now(),
  execution_expires_at timestamptz,
  web_sources jsonb not null default '[]'
);
-- grants: select to authenticated · policies: own rows in own conversations

create table public.chat_cancellations (       -- app: "Stop" (upsert on conversation_id)
  conversation_id uuid not null primary key,
  user_id uuid not null default auth.uid(),
  cancel_requested_at timestamptz not null default now()
);
-- grants: select, insert, update, delete to authenticated · policies: own conversation only

create table public.ai_models (                -- app: model picker
  model_id text not null primary key,
  label text not null,
  vendor text not null default '',
  tier smallint not null default 2,
  efforts text[] not null default '{}',
  params jsonb not null default '{}',
  enabled boolean not null default false,
  is_default boolean not null default false,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now(),
  min_plan public.app_plan not null default 'plus'
);
-- grants: select to authenticated (NOT anon: the list loads after sign-in) · policy: ai_models_read

create table public.desk_rows (                -- app: record search through rpc search_desk_rows
  tier text not null,
  feature text not null,
  row_key text not null,
  "row" jsonb not null,
  record_text text not null,
  snapshot_at timestamptz not null,
  loaded_at timestamptz not null default now(),
  document_key text,
  primary key (tier, feature, row_key)
);
-- grants: select to authenticated · policies: desk_rows_read, law_desk_serving

create table public.record_briefs (            -- app: never directly; desk-brief reads and writes it
  tier text not null,
  feature text not null,
  row_key text not null,
  hash_key text not null,
  source text not null,
  content_hash text not null,
  status text not null,
  headline text,
  points jsonb,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  cost_usd numeric,
  model_call_log_id uuid,
  claim_token uuid,
  claimed_at timestamptz,
  written_at timestamptz,
  attempts integer not null default 0,
  retry_after timestamptz,
  brief_format smallint not null default 1,
  primary key (tier, feature, row_key, hash_key)
);

-- ---------------------------------------------------------------------------------------------
-- RPCs the app calls (all executable by authenticated only)
-- ---------------------------------------------------------------------------------------------
-- get_my_profile()                    returns user_profiles        security definer
-- my_entitlement_manual()             returns jsonb                security definer
-- my_credits_cycle_v3()               returns jsonb                security definer
-- model_credit_estimates()            returns jsonb                security definer
-- credit_unit()                       returns jsonb                security definer
-- my_conversation_credits(p_conversation uuid)  returns jsonb      security definer
-- search_desk_rows(p_tier text, p_feature text default null, p_query text default null,
--                  p_filters jsonb default '{}', p_limit int default 20,
--                  p_date_from text default null, p_date_to text default null)
--   returns table(tier, feature, row_key, row jsonb, record_text, document_key, snapshot_at, total bigint)
--   security invoker (reads desk_rows under the member's RLS)

-- ---------------------------------------------------------------------------------------------
-- Edge functions the app calls (functions/v1/…, member JWT as Authorization: Bearer)
-- ---------------------------------------------------------------------------------------------
-- research-chat   v104, deployed 25 Oct 2026 · AI answers (SSE) · writes conversations, chat_messages, credits
-- desk-brief      v19,  deployed 24 Oct 2026 · record briefs (mode 'read' only reads) · writes record_briefs
-- Browsers must be on ALLOWED_ORIGINS (default http://localhost:5173); the phone apps use native
-- HTTP and are not subject to CORS.
