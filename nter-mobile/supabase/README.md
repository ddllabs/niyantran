# Database: what the app uses, and how to get a separate copy

## Nothing to migrate

The app has **no database of its own and adds nothing to NTER** — no tables, columns, functions,
policies, triggers or storage buckets. Everything it reads and writes already exists in NTER and
is used the same way by the website:

| What the app does | Where it lands in NTER | Written by |
| --- | --- | --- |
| Sign in, create account, reset password | `auth.users`, `user_profiles` | Supabase Auth and NTER's existing triggers |
| Choose a perspective | `user_profiles.persona` | the member (column grant + own-row policy) |
| Watch a module | `user_preferences.watchlist` | the member (own row) |
| Ask the AI | `conversations`, `chat_messages`, credit tables | the `research-chat` function |
| Stop an answer | `chat_cancellations` | the member (own conversation) |
| Rename or delete a conversation | `conversations` | the member (own rows) |
| Write a record brief | `record_briefs` | the `desk-brief` function |

So moving the app onto "the original nter.pro database" needs no migration: it already runs on it.
If the website team changes one of these tables, check `schema/app-surface.sql` and
`../docs/backend-contract.md` and update the app in the same release.

Pinned records, Studio documents, the writing profile and the theme are kept **on the phone**
(Capacitor Preferences). If the website team later wants them in the account, add a table in the
website repo and switch `src/state/app.jsx` to it; nothing else needs to change.

## What is in this folder

| File | What it is |
| --- | --- |
| `schema/app-surface.sql` | Read-only snapshot (26 Oct 2026) of every table, grant, policy, RPC and function the app depends on. Reference only — do not run it against NTER. |
| `seed/mobile-sample.sql` | Sample data for a **local** copy: the 11 AI models and 762 desk records from the bundled sample. Regenerate with `node scripts/make-seed.mjs`. |

## Getting a separate copy of the backend (free, on a laptop)

The full backend — schema, policies, RPCs and edge functions — is defined in the website repo, so
a separate copy is built from there with the Supabase CLI and Docker. It never touches NTER.

```bash
# in a checkout of ddllabs/niyantran
supabase start                       # local Postgres, Auth, REST and Studio from the website's migrations
supabase functions serve             # research-chat, desk-brief … (provider keys in supabase/functions/.env)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f <this repo>/supabase/seed/mobile-sample.sql
npx vite --port 3000                 # the website's dev server, which also serves /api

# in this repo
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_PUBLISHABLE_KEY=<the anon / publishable key printed by supabase start> \
API_PROXY=http://localhost:3000 \
npm run dev                          # the app on http://localhost:5173 (the origin local functions allow)
```

Create a test member in the local Studio (http://127.0.0.1:54323 → Authentication) and sign in.

A hosted copy (a second Supabase project, about US$10 a month on the Pro plan) is made the same
way with `supabase link` and `supabase db push` from the website repo; point the app at it with
the two `VITE_SUPABASE_*` variables. It is not needed for the app.

## Rules

- Reads only, against NTER, while building or debugging: `select` and the read RPCs above. The SQL
  in `../docs/backend-checks.sql` is safe to run.
- Schema changes are made in `ddllabs/niyantran/supabase/migrations`, never from this repo.
