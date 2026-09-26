# Supabase project baseline — `NTER`

> **Status:** Historical (dated 2026-09-20) — a snapshot of the hosted
> database on this date. Not maintained.

**Evidence class:** **execution.** Every figure here was returned by a query
run against the live project through the Supabase connector on 2026-09-20,
between roughly 22:30 and 23:10 IST. The queries are reproduced in §9 so the
snapshot can be re-taken. Nothing was written.

## 1. Project

| | |
|---|---|
| Name | `NTER` |
| Ref | `vfgcppstyzjarlzyqdac` |
| Region | `ap-south-1` |
| Postgres | 17.6.1.166 (engine 17, GA channel) |
| Created | 2026-09-20 07:16 UTC |
| Status | `ACTIVE_HEALTHY` |

## 2. Tables — six, all with RLS enabled

| Table | Rows | Note |
|---|---|---|
| `public.user_profiles` | 9 | one per `auth.users` row; `organisation_id` **nullable** |
| `public.organisations` | 0 | built ahead; unused |
| `public.organisation_members` | 0 | built ahead; unused |
| `public.user_roles` | 0 | built ahead; unused |
| `public.organisation_invites` | 0 | built ahead; unused |
| `public.privacy_policy_consents` | 0 | |

(The first listing during the session showed 8 profile rows; a ninth appeared
within minutes. Someone was creating accounts while this snapshot was taken.)

### `user_profiles` columns of note

`user_id uuid UNIQUE → auth.users(id)`, `organisation_id uuid NULL →
organisations(id)`, `email text CHECK (length(trim(email)) > 0)`,
`first_name`, `last_name`, `phone_number`, `phone_verified boolean`,
`department`, `persona app_persona NULL`, `practice_area`, `jurisdiction`,
`language text DEFAULT 'en'`, `role app_role DEFAULT 'user'`,
`plan app_plan DEFAULT 'explorer'`, `status account_status DEFAULT 'active'`,
`onboarding_complete boolean DEFAULT false`, `created_at`, `updated_at`.

### Enumerated types

| Type | Values |
|---|---|
| `app_persona` | `policy_analyst`, `journalist`, `upsc_aspirant`, `corporate_affairs`, `legal_researcher`, `academic` |
| `app_role` | `user`, `admin`, `owner` |
| `app_plan` | `explorer`, `professional`, `enterprise` |
| `account_status` | `active`, `inactive`, `suspended` |
| `member_status` | `active`, `invited`, `disabled` |
| `invite_status` | `pending`, `accepted`, `revoked`, `expired` |

## 3. Functions — eight, all `SECURITY DEFINER` except the trigger helper

| Function | Arguments | Returns |
|---|---|---|
| `create_organisation` | `p_name, p_website, p_about, p_industry_id` | `organisations` |
| `get_my_profile` | — | `user_profiles` |
| `update_my_onboarding_profile` | `p_persona, p_practice_area, p_jurisdiction, p_language, p_onboarding_complete` | `user_profiles` |
| `handle_new_user` | — (trigger) | `trigger` |
| `is_org_member` | `p_organisation_id` | `bool` |
| `is_org_owner` | `p_organisation_id` | `bool` |
| `is_platform_admin` | — | `bool` |
| `update_updated_at_column` | — (trigger, not definer) | `trigger` |

## 4. Row-level security — sixteen policies, all for role `authenticated`

`organisations`: users view; authenticated create; owners update.
`organisation_members`: members view; owners manage (ALL).
`organisation_invites`: admins view; owners create; owners update.
`user_roles`: users view; admins manage (ALL).
`user_profiles`: view own; view organisation profiles; insert own; update own.
`privacy_policy_consents`: view own; create own.

No policy grants anything to `anon`.

## 5. Edge functions

**None deployed.**

## 6. Extensions

Installed: `pgcrypto 1.3`, `uuid-ossp 1.1`, `pg_stat_statements 1.11`,
`supabase_vault 0.3.1`, `plpgsql`.

Available but **not installed**, and relevant to the planned work:

| Extension | Version | Relevance |
|---|---|---|
| `vector` | 0.8.2 | required for embeddings; HNSW and IVFFlat |
| `pgroonga` | 3.2.5 | full-text search for a future hybrid retriever |
| `rum` | 1.3 | ranked full-text index, alternative to the above |
| `pg_trgm` | 1.6 | trigram similarity |
| `pgmq` | 1.5.1 | Postgres message queue, candidate for ingestion jobs |
| `pg_cron` | 1.6.4 | scheduled jobs (model pricing refresh) |
| `pg_net` | 0.20.4 | async HTTP from the database |

## 7. Users

| Measure | Value |
|---|---|
| `auth.users` rows | **9** |
| distinct email strings | 9 |
| distinct email domains | 1 (`gmail.com`) |
| distinct addresses after stripping a Gmail `+suffix` | **4** |
| email confirmed | 6 |
| ever signed in | 6 |
| all created on | 2026-09-20 |

Six of the nine are `+alias` variants of a single Gmail address whose local
part is `nter-auth-test`; Gmail delivers all six to one inbox. The remaining
three are three separate Gmail addresses, two of them unconfirmed. Full
addresses are deliberately not recorded here.

Every one of the nine `user_profiles` rows has `persona = NULL`,
`plan = 'explorer'`, `role = 'user'`, `onboarding_complete = false`. **No
account has completed onboarding**, so `update_my_onboarding_profile` has not
been observed to run end to end.

## 8. Observations that bear on the design

1. **Nothing to build on for AI yet, and nothing in the way.** No edge
   functions, no `vector`, no chat or document tables. The AI schema starts on
   a clean sheet.
2. **`organisation_id` is nullable on `user_profiles`.** Single-user operation
   needs no change; organisation scoping later is additive.
3. **Persona vocabularies differ in three places.** Database
   `app_persona` (`policy_analyst`, `upsc_aspirant`, `corporate_affairs`,
   `legal_researcher`, …), frontend `src/lib/userTypes.js` / `personas.js`
   (`policy`, `student`, `analyst`, `lawyer`, …), and the persona prompt files
   `src/data/personas/{student,journalist,lawyer,policy,analyst}.md` — with no
   `academic.md`; `personaPromptsStore.js:18` reuses the student prompt for
   academic. One canonical mapping is required, because persona selects the
   system prompt.
4. **Plan vocabularies differ.** Database `app_plan` has `professional` and no
   `gov`; frontend `planEntitlements.js:37-43` normalises to `explorer | pro |
   enterprise | gov`. The Government tier has no database representation.
5. **Entitlement state has no server home.** `plan_status`, `trial_ends_at`
   and `billing_yearly` exist in the local SQLite schema (`server/db.mjs:39-41`)
   and nowhere in Supabase.
6. **Plus-addressing defeats uniqueness.** Supabase compares email strings
   byte-for-byte; Gmail ignores `+suffix` and dots. With a 14-day trial in
   `planEntitlements.js:5`, one mailbox can mint unlimited trials. Normalising
   the address at signup is a small change now and a data migration later.
7. **The application does not use this project yet.** See
   `2026-09-20-ai-path-audit.md` §7: the frontend has no Supabase client. The
   nine users were created some other way.

## 9. Queries used

```sql
-- policies
select tablename, policyname, cmd, roles::text,
       qual is not null as has_using, with_check is not null as has_check
from pg_policies where schemaname = 'public' order by 1, 2;

-- functions
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, t.typname as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_type t on t.oid = p.prorettype
where n.nspname = 'public' order by 1;

-- users, without listing addresses
select count(*) as total_users,
       count(distinct lower(email)) as distinct_emails,
       count(distinct split_part(lower(email), '@', 2)) as distinct_domains,
       count(distinct regexp_replace(split_part(lower(email), '@', 1), '\+.*$', '')
             || '@' || split_part(lower(email), '@', 2)) as distinct_after_plus,
       count(*) filter (where email_confirmed_at is not null) as confirmed,
       count(*) filter (where last_sign_in_at is not null) as ever_signed_in
from auth.users;

-- profile state
select persona::text, plan::text, role::text, onboarding_complete, count(*)
from public.user_profiles group by 1, 2, 3, 4;
```

Tables, columns, enums, extensions and edge functions were listed with the
connector's `list_tables` (verbose), `list_extensions` and
`list_edge_functions` calls.
