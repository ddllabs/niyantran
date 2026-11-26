-- Disposable stand-ins for what the file-manager schema (F411) needs to be created. NEVER apply to a Supabase project.
--
-- 20261126150000_file_manager_schema.sql alters public.ingest_settings, puts a vector column and an HNSW index on
-- user_file_chunks, writes policies that call storage.foldername(), and has PL/pgSQL functions that declare variables
-- of the composite types public.credit_wallets and public.credit_settings (PL/pgSQL resolves declared types when a
-- function is created; the statements in the bodies are resolved only when they run). The real objects are created on
-- main by 20261102130000_batch_registration (ingest_settings) and 20261014200000_ai_credits (the credit tables and the
-- private schema), whose chains would add minutes to the SQL job (F302), so the fixture uses these stand-ins, as
-- search_keep_warm does. The credit functions' behaviour is out of the fixture's scope: they are adopted as they run on
-- NTER. Run after bootstrap_auth.sql and bootstrap_storage.sql, as the container's superuser.
\set ON_ERROR_STOP on

create extension if not exists vector with schema extensions;

-- Supabase's storage.foldername: the folder parts of an object name.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

create schema if not exists private;

create table public.ingest_settings (id integer primary key default 1);
insert into public.ingest_settings default values;

create table public.credit_wallets (user_id uuid primary key, balance numeric not null default 0);
create table public.credit_settings (id integer primary key default 1, usd_to_inr numeric, inr_per_credit numeric);
create table public.credit_holds (user_id uuid, turn_key text, credits numeric, inr_per_credit numeric,
  expires_at timestamptz, settled_at timestamptz, shadow_blocked boolean default false, primary key (user_id, turn_key));
create table public.app_flags (key text primary key, value jsonb);
