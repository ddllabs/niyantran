# Upstream integration and production relink

Status: **Living.** Proposed 2026-09-24; nothing executed. Governed by ADR 0005 (`01-decisions-adr-0005.md`). Evidence: 02-merge-audit-reconciliation.md.

## Spec

**Current state**
- `ddllabs/niyantran` `main` (7352148) and `ItsCloudDev/niyantran` `main` (528dfb4) diverged at `570c3f1`: 152 commits against 27.
- A trial merge conflicts in 14 files and auto-merges 6 files that both sides changed.
- www.nter.pro runs upstream, on a Vercel project DDL Labs cannot access.
- ItsCloudDev has left.

**Problem**
- Two backends: Supabase versus a Vercel router with SQLite in `/tmp`.
- Two auth systems: Supabase Auth versus browser seats plus Google on SQLite.
- Two AI paths: `research-chat` over SSE versus `/api/ai/chat`, which calls providers directly.
- Neither branch alone is shippable. `ddllabs` has no production handlers for `/api/auth/*` or the desk APIs. Upstream has no durable data and none of the research work.

**Expected outcome**
- One `main` containing both histories, built on ADR 0005's architecture.
- Deployed from a DDL Labs Vercel project.
- www.nter.pro moved to it, with Google sign-in through Supabase.

**Acceptance evidence**
1. `npm ci`, `npm run build`, `npm test` and the Deno suite all pass on the integration branch.
2. A preview deploy passes the smoke list (Phase 5).
3. `git merge-base --is-ancestor upstream/main main` is true after the merge lands.
4. No route writes durable data under `/tmp`. Checked by grep for `writablePath(` callers and a review of each one.
5. No LLM host other than `openrouter.ai` appears in `server/`, `api/` or `supabase/functions/`. Checked by grep.

**Scope**
- The merge, the rewiring it requires, OpenRouter-only legacy paths, Google via Supabase, the Vercel relink, and cutover.

**Out of scope, tracked separately** in 04-open-backlog.md:
- Home-feeds schema and nter.news durable storage.
- Retiring the legacy AI path (needs its own spec, per ADR 0001).
- Billing, corpus expansion, and database migrations. This plan adds none.

## Phase 0: owner prerequisites (not code)

| # | Item | Why | Owner |
|---|---|---|---|
| 0.1 | Confirm who controls the **nter.pro domain** (registrar and DNS) | Cutover means pointing the domain at the new Vercel project. If the departed developer holds the registrar, that is the real blocker. | Owner |
| 0.2 | Create a **DDL Labs Vercel project** linked to `ddllabs/niyantran`. Production branch: `main`. Leave the domain unassigned for now. | Relink | Owner |
| 0.3 | Create a **Google OAuth client** (Web) in a DDL Labs Google Cloud project, and enter its ID and secret in Supabase: Authentication → Providers → Google. Authorised redirect URI: `https://vfgcppstyzjarlzyqdac.supabase.co/auth/v1/callback`. | Google sign-in. Old credentials are not needed. | Owner |
| 0.4 | Add Supabase Auth URL configuration: Site URL, and redirect URLs for `http://localhost:5173`, the Vercel preview domain and `https://www.nter.pro`. | OAuth and email links | Owner |
| 0.5 | Decide email delivery: Supabase native, or Resend with a verified domain | Signup verification | Owner |
| 0.6 | Freeze other work on `main` until Phase 3 lands. The team must not use the `PI Terminal` checkout (see the reconciliation, §5). | One integrator | Owner |

## Phase 1: integration branch and the merge commit

On a fresh checkout: `git switch -c task/upstream-integration main`, then `git merge --no-ff --no-commit upstream/main`, then resolve with the table below. Commit the merge with the resolution notes in its message.

**Rules:**
- **Ours wins** for auth, data, AI and anything durable.
- **Upstream wins** for visual UI where we did not change the same thing.
- **Upstream's Google, app flags/testing phase and `/tmp` persistence are not taken.**

### 1a. Conflicted files (14)

| File | Resolution |
|---|---|
| `package.json` | Ours. Do **not** add `google-auth-library`. |
| `package-lock.json` | Take ours, then `npm install` to reconcile. Commit the result. |
| `vite.config.js` | Our plugin list, plus upstream's `nterNewsApiPlugin()`. No `googleAuthApiPlugin`, no `appFlagsApiPlugin`. `envPrefix: ['VITE_']` is Vite's default and harmless; take it. |
| `public/data/conflict.json`, `markets.json`, `news.json` | `--ours`. They are data snapshots, protected by AGENTS.md. |
| `server/usersApi.mjs` | Ours: Supabase-verified. Drop `googleSub` and the `writablePath('issued-users.json')` move. |
| `src/ai/AiBrandIcon.jsx` | Ours (`vendorKey()` folding and fallbacks), with upstream's coloured Gemini/OpenAI marks placed inside it. No DeepSeek special-casing needed: the catalogue decides. |
| `src/ai/AiPanel.jsx` | Ours. From upstream take only the disabled "Downloads disabled for now" button, if wanted. **Do not** take the removal of the starter-question prompts (our `SuggestionPills` uses them), the testing-phase provider list, or the send-time rehydration (legacy path; see `aiDrop`). |
| `src/lib/aiClient.js` | Ours. Upstream's `liveAiProviders()` is testing-phase only. |
| `src/lib/aiDrop.js` | **Inverted defaults; decide explicitly.** Adopt upstream's default: a dropped or seeded row does **not** fetch its documents unless `hydrate: true`. The research path never sends fetched files, so no fetch is right for it. The legacy send path passes `hydrate: true`, as upstream's does. Keep our `document_key` and `isModuleAttachment`. Update our `hydrate: false` callers and tests. Add a test that a plain drop makes no fetch. |
| `src/marketing/SignupPage.jsx` | Ours: `/api/auth/signup`, verification, Supabase. Take upstream's **ordering**: persona and details first, plan after. Leave a hidden slot for the Google button (Phase 4). Drop the testing-phase bypass. |
| `src/marketing/LoginPage.jsx` | Ours: Supabase `signInWithPassword` and verified identity. Leave a slot for the Google button (Phase 4). Drop `authenticateUser`, `hydrateUsersFromServer` and `exchangeGoogleCredential`. |
| `src/shell/RecordDetail.jsx` | Upstream's layout (KPI grid, inline entry briefs), keeping our `SourceBriefBlock` abort handling. |

### 1b. Auto-merged files that need a hand fix (6)

| File | Fix |
|---|---|
| `src/lib/userStore.js` | Remove `upsertGoogleUser` and the `googleSub`/`authProvider` fields. |
| `src/App.jsx` | Remove the `hydrateAppFlags` effect. |
| `src/shell/TerminalShell.jsx` | Keep the profile menu. Remove the testing-phase badge and `subscribeAppFlags`. |
| `src/admin/AiModelsPage.jsx` | Accept: it only removes DeepSeek from the legacy editor. |
| `src/index.css` | Accept: magazine layout, globe, status dots. Drop the Google-button styles only if Phase 4 restyles the button. |
| `.env.example` | Keep `NTER_TERMINAL_API_KEY` and `VITE_LIVE_API`. Drop `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`: Supabase holds Google's credentials. |

### 1c. Upstream-only files

| File(s) | Resolution |
|---|---|
| `api/router.js`, `vercel.json` (catch-all rewrite), deletion of `api/ai/*.js` | **Take.** In the merge commit itself, remove the `server/googleAuth.mjs` and `server/appFlags.mjs` imports and their routes, or the router fails to load (see the gate below). The rest of the rewiring is Phase 2. |
| `server/writableRoot.mjs` | Take, for caches only. |
| `server/homeApi.mjs`, `server/featureFeed.mjs`, `src/lib/apiMode.js`, `src/lib/homeCache.js`, `src/lib/homeStatic.js`, `src/desks/*`, `src/shell/RightRail.jsx`, `src/shell/DeskIntel.jsx`, `src/shell/EntryBriefInline.jsx`, `src/marketing/HomePage.jsx`, `src/marketing/PricingPage.jsx`, `src/marketing/marketing.css`, `public/brand/globe.gif` | Take. UI and desk APIs. |
| `server/nterNews.mjs`, `tools/seed_nter_news.mjs`, `public/data/nter-news.json` | Take the **read** path: the seeded articles render from the committed file. Disable the ingest write route (Phase 2) until Supabase storage exists. |
| `server/deskBrief.mjs`, `server/aiApi.mjs`, `server/db.mjs` (entry-brief cache) | Take. OpenRouter-only in Phase 3. Drop the `google_sub` column handling in `db.mjs`. |
| `server/googleAuth.mjs`, `src/lib/googleAuthClient.js` | **Do not take.** |
| `src/marketing/GoogleSignInButton.jsx` | Take the file, rewritten in Phase 4. |
| `server/appFlags.mjs`, `src/lib/appFlagsStore.js`, testing-phase code in `planEntitlements.js`, `aiModelsStore.js`, `AdminPages.jsx` and `PricingPage.jsx` | **Do not take.** The testing phase is removed. |

**Gate:**
- `npm ci`, `npm run build`, `npm test`, and `deno test -A --config supabase/functions/deno.json supabase/functions` all pass on the merge commit. Record exact outcomes.
- **And** the router must load: `node -e "import('./api/router.js').then(()=>console.log('ok'))"`.

**Why the extra gate: evidence from a trial merge on 2026-09-24,** in a throwaway worktree, never committed, resolving all 14 conflicts to our side:
- `vite build` passed, 605 Vitest tests passed and 415 Deno tests passed.
- **But `api/router.js` failed to import:** `ERR_MODULE_NOT_FOUND: google-auth-library`, via `server/googleAuth.mjs`.

On Vercel that takes down **every** `/api/*` route while every test stays green. So the removal of the `googleAuth.mjs` and `appFlags.mjs` imports from `api/router.js` belongs **in the merge commit itself**, not in Phase 2. With the Google import removed, the router loaded and served `/api/home/pulse`. `/api/auth/signup` and `/api/auth/forgot-password` returned 404: Phase 2.1.

**Build-time environment:** `vite build` fails with `[AuthEmailConfig] SUPABASE_URL is required` when the Supabase and auth variables are absent. `authApiPlugin` validates its configuration when `vite.config.js` loads, even for production builds. Either set the Phase 5 variables in Vercel before the first build, or make that validation dev-only (Phase 2.5).

## Phase 2: rewiring on the branch (separate commits)

1. **`api/router.js`:**
   - Add `/api/auth/*`, delegating to `server/authApi.mjs`'s `handleAuthApi`.
   - Remove `/api/auth/google` and `/api/app-flags`.
   - Make `/api/news/ingest` return 503 with a clear message.
   - Keep home, feature-feed, desk-brief, ohlc, constitutions, growth, source-extract and the legacy `ai/*`.
   - Do not port `ddllabs/NTER`'s unauthenticated `api/users.js`.
   - Test: each route resolves, and `/api/auth/signup` reaches the handler.
2. **`/api/users`:** `userStore.js` (lines ~198 and ~218) calls it with a Supabase bearer.
   - Decide whether the router exposes it, backed by the SQLite directory (ephemeral on Vercel), or retire the call in favour of `user_profiles`.
   - Recommendation: retire it for signed-in users. Its data now lives in Supabase.
3. **Seed accounts and the Terminal gate:** traced on 2026-09-24.
   - The Terminal shell is gated on client-side state, and `sessionUser()` falls back to a seed account when there is no verified session. That allows a client-side entitlement bypass. Server data is not exposed.
   - The reproduction is in the private security note (not published).
   - Fix: gate the shell on the verified Supabase identity, make `sessionUser()` return `null` when there is none, and remove the seed accounts and their hard-coded password from production code. Add a test that an unverified session never yields a seed account or a paid plan.
4. **Durable-write audit:** grep every `writablePath(` and `writeFileSync` reachable from `api/router.js`. Each must be a cache or be disabled.
5. **Build-time validation:** make `authApiPlugin`'s provider validation run only for the dev server (for example, only inside `configureServer`), so `vite build` does not need secrets. Otherwise, document the build-time variables in the Vercel setup.

## Phase 3: OpenRouter only

Point `server/aiApi.mjs`, which calls `generativelanguage.googleapis.com` and `api.deepseek.com` today, and `server/deskBrief.mjs` (Gemini) at `openrouter.ai`, using `OPENROUTER_API_KEY`. Remove `GEMINI_API_KEY`, `GOOGLE_API_KEY` and `DEEPSEEK_API_KEY` from the code and `.env.example`.

**Gate:** a grep for LLM hosts other than `openrouter.ai` returns nothing, and the build and tests pass.

## Phase 4: Google sign-in through Supabase (needs 0.3 and 0.4)

1. Rewrite `GoogleSignInButton.jsx` as a styled button that calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
2. The existing `on_auth_user_created` trigger creates the profile.
3. Persona and plan after a first Google sign-in: route the user to the onboarding step the signup ordering already provides.

**Verify:** a new Google account lands signed in, with an active `user_profiles` row, and can run a research turn.

## Phase 5: preview deploy on the DDL Labs Vercel project

**Environment variables**, rebuilt from code because the old project is unreadable:

| Group | Variables |
|---|---|
| Required | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_URL`/`SITE_URL`, `AUTH_EMAIL_PROVIDER`, `OPENROUTER_API_KEY` |
| If Resend | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| If the desks need them | `AIS_KEY`/`AISSTREAM_KEY` (transit), `VITE_LIVE_API` (defaults on) |
| Legacy billing, only if billing stays live | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `VITE_RAZORPAY_KEY_ID`, `BILLING_*` |
| Unknown purpose; identify before setting | `NIYANTRAN_AI_KEY` |

On Supabase, add the preview and production origins to `research-chat`'s `ALLOWED_ORIGINS`, which uses exact matching.

**Smoke list on the preview URL:**
- signup → verification email → login;
- Google sign-in;
- forgot-password;
- home: markets, latest, pulse;
- one desk's feature-feed;
- a desk brief;
- a research turn with a citation opening the reader;
- delete a chat;
- admin AI Models page loads.

Then run the E2 phase 3 paid acceptance: the five scenarios plus a cross-account denial check (supervisor-recovery plan).

## Phase 6: cutover and clean-up

1. Merge `task/upstream-integration` into `main` (`--no-ff`). Push when the owner authorises it.
2. Assign www.nter.pro and nter.pro to the new Vercel project (needs 0.1).
3. Tell users that accounts must be re-created. None are recoverable.
4. Update AGENTS.md's sync rule: upstream is frozen and there are no further syncs.
5. Delete the `origin/dev` branch. Its commits are already in upstream, and so in `main`. Note that deleting a branch does not purge the leaked, now-disabled key from public history or forks.
6. Remove the leftovers: the `task/research-answer-once` branch and the `.claude/worktrees/*` worktree.

## Authorisations needed

- **Branch creation and local commits:** under the supervisor's normal authority.
- **Needs the owner's exact go-ahead:** pushing the integration branch, merging to `main`, pushing `main`, any Vercel or DNS action, Supabase dashboard changes, and deleting `origin/dev`.
