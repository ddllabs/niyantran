-- Disposable stand-ins for NTER's private credit functions, for the file-manager credit fixture (F413). NEVER apply to
-- a Supabase project.
--
-- The four file-manager credit functions call private.credit_config, credit_refresh, credit_wallet,
-- credit_current_amount, credit_entry and credit_draw. The real ones are created on main by 20261014200000_ai_credits
-- and 20261017194626_credit_paise_contract, whose chains would add minutes to the SQL job (F302). These stand-ins keep
-- what the fixture depends on: credit_wallet locks the wallet row FOR UPDATE, as NTER's does; credit_entry writes a
-- ledger row and moves the balance; credit_draw does nothing (lots are out of scope); credit_current_amount returns
-- the credits unchanged (one rate). Run after bootstrap_file_manager_deps.sql, as the container's superuser.
\set ON_ERROR_STOP on

alter table public.credit_holds add column if not exists swept_at timestamptz;
create table public.credit_ledger (id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text not null,
  credits numeric not null, turn_key text, created_at timestamptz not null default now());
insert into public.credit_settings (id, usd_to_inr, inr_per_credit) values (1, 95, 0.01)
  on conflict (id) do update set usd_to_inr = 95, inr_per_credit = 0.01;

create function private.credit_config() returns public.credit_settings language sql
  as $$ select * from public.credit_settings limit 1 $$;
create function private.credit_wallet(p_user uuid) returns public.credit_wallets language plpgsql as $$
declare w public.credit_wallets;
begin
  insert into public.credit_wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into w from public.credit_wallets where user_id = p_user for update;
  return w;
end $$;
create function private.credit_refresh(p_user uuid, p_now timestamptz, p_end_monthly boolean default false) returns void
  language plpgsql as $$ begin perform private.credit_wallet(p_user); end $$;
create function private.credit_current_amount(p_credits numeric, p_rate numeric) returns numeric language sql
  as $$ select p_credits $$;
create function private.credit_entry(p_user uuid, p_kind text, p_credits numeric, p_lot uuid, p_turn_key text,
  p_request_id uuid, p_usd_to_inr numeric, p_inr_per_credit numeric, p_by uuid, p_note text) returns uuid
  language plpgsql as $$
declare v uuid;
begin
  insert into public.credit_ledger (user_id, kind, credits, turn_key) values (p_user, p_kind, p_credits, p_turn_key)
    returning id into v;
  update public.credit_wallets set balance = balance + p_credits where user_id = p_user;
  return v;
end $$;
create function private.credit_draw(p_user uuid, p_credits numeric, p_ledger uuid, p_reason text, p_now timestamptz)
  returns void language plpgsql as $$ begin null; end $$;
