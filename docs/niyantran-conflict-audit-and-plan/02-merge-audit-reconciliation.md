# Merge audit reconciliation: engineering team report vs. Claude audit

Status: **Historical (2026-09-24).** It checks two independent read-only audits of the `upstream/main` ↔ `ddllabs/main` divergence against the repository, so the team works from one set of facts.

- **Team report:** "NTER Git Repository Divergence & Merge Audit", 2026-09-24, run from `C:\Users\nawa\PI Terminal`.
- **Claude audit:** this repository, 2026-09-24.

Every claim marked **verified** below was checked by running a command on 2026-09-24 against refs fetched that day. `ddllabs/NTER` was fetched into `FETCH_HEAD` only; no remote was added.

## 1. Agreed and verified

| Claim | Evidence |
|---|---|
| Merge-base is `570c3f1` | `git merge-base main upstream/main` |
| 152 commits ahead, 27 behind; no equivalent commits | `git rev-list --left-right --cherry-mark --count main...upstream/main` gives `152 27 0` |
| 142 non-merge + 10 merge commits since the fork; 151 by Vighnesh Shukla, 1 by Nawajish | `git rev-list --count --merges/--no-merges`, `git shortlog -sn 570c3f1..main` |
| All-history authorship: 178 commits on `main` (151 / 26 ItsCloudDev / 1); 53 on `upstream/main` | `git shortlog -sn` |
| 14 files conflict and 6 merge cleanly, out of 20 changed on both sides | `git merge-tree --write-tree main upstream/main` |
| The same 14 conflicted files, by name | same |
| 24 migrations in `supabase/migrations/` | `ls` |
| The core risk is architectural divergence, not text conflicts | both audits |
| `ddllabs` is the source of truth for data, auth, AI and RAG; upstream for visual UI | both audits; owner decision (ADR 0005 (`01-decisions-adr-0005.md`)) |
| Do not adopt the `nter/` subfolder layout | both audits; ADR 0005 |
| Google sign-in goes through Supabase Auth's native provider | both audits; owner decision |
| `api/router.js` needs `/api/auth/*` routes added | both audits |
| Upstream signup has a testing-phase bypass | `SignupPage.jsx` imports `isTestingPhase` (upstream) |
| Upstream `usersApi.mjs` moved `issued-users.json` to `writablePath()` | `git diff 570c3f1 upstream/main -- server/usersApi.mjs` |
| `ddllabs/NTER` main is at `859375f`, 6 commits past `8ba52b1`, and moves the tree into `nter/` | `git ls-remote`, `git log 8ba52b1..FETCH_HEAD` |

## 2. Errors in the team report

| # | Team claim | Actual (verified) |
|---|---|---|
| T1 | §9B migration inventory: `corpus_documents`, `corpus_chunks`, `model_allowlist`, `admin_roles`, `model_pricing_snapshots`, `ai_turn_telemetry`, `check_database_health()`, `reconcile_model_pricing()`, `set_model_allowlist_entry()` | **The file names are right but the contents are invented.** None of these names exists anywhere in the repo (`grep` finds 0 files). The migrations actually create `conversations`, `chat_messages`, `chat_cancellations`, `documents`, `document_chunks`, `desk_rows`, `model_call_logs`, `chat_turn_traces`, `model_pricing`, `ai_models`, `ai_roles`, `ai_health()`, `model_pricing_reconcile()`, `admin_models_upsert()`, `research_turns`, and others. |
| T2 | "16 Deno functions" | **5**: `admin-models`, `health`, `ingest-documents`, `refresh-model-pricing`, `research-chat`, plus the `_shared/` library. |
| T3 | Upstream `AiPanel.jsx` "stripped advanced streaming hooks" | **The fork point had no streaming**, so there was nothing to strip. Upstream's real changes (commits `aeb2e22`, `37191d8`): removed the contextual starter-question prompts, deferred document fetching until Send, made the model list come from testing-phase app flags, and disabled the download button. |
| T4 | Resolution for `aiDrop.js`: "allow `hydrate: false` when targeting research" | **Misses an inverted default.** Both sides added a `hydrate` option with opposite defaults. Upstream fetches documents only if `hydrate === true`; `ddllabs` fetches unless `hydrate === false`. A textual resolution silently flips behaviour on one path. See the integration plan. |
| T5 | Step 4: keep `google-auth-library` | **Contradicts the Supabase-native Google decision.** It is not needed; drop it together with `server/googleAuth.mjs`. |
| T6 | "~127 frontend commits = 152 − 25" | **Not a git quantity.** The arithmetic is unexplained and nothing supports it. The only measured numbers are 152 and 27. |
| T7 | Merge-base `570c3f1` "authored 2026-09-21" | **2026-09-19 22:30 +0500.** |
| T8 | ddllabs `AiModelsPage.jsx`: upstream "added testing phase notice" | Upstream's change there was **removing DeepSeek** (`528dfb4`). No testing-phase text. |
| T9 | ddllabs "added vitest config" to `vite.config.js` | Vitest has its own `vitest.config.js`; `vite.config.js` has no test config. |
| T10 | `persona_map.ts` | The file is `supabase/functions/_shared/personaMap.ts`. |
| T11 | "Upstream frontend calls `/api/users` without auth; backend would reject with 403" | **Partly right.** On live nter.pro, `/api/users` returns **404**: upstream's router has no such route. So production password accounts exist only in each visitor's browser. |
| T12 | Upstream SQLite framed as "sufficient for user sessions" | **On Vercel it is data loss.** `/tmp` is wiped per instance and on cold starts. Upstream keeps accounts, app flags and nter.news writes there. |

## 3. Things the team report does not cover

1. **Production runs upstream.**
   - www.nter.pro serves upstream's build. Its JS bundle has no Supabase client, and `/api/home/*`, `/api/app-flags` and `/api/auth/google` answer.
   - The Vercel project is not accessible, so production must be **relinked**, not merged into.
2. **No production accounts can be migrated.** Password accounts live in each browser (`/api/users` is 404), and Google accounts are in `/tmp`.
3. **`ddllabs/NTER` contains an unauthenticated `/api/users`.**
   - `nter/api/users.js` serves GET (every user) and PUT (overwrite every user) with **no auth check**.
   - Do not port it. Confirm it was never deployed.
4. **`ddllabs/NTER` deletes `backup/`** (`e16b731`). AGENTS.md forbids that without an approved data-migration task.
5. **`ddllabs/main` cannot be deployed to Vercel as it is.**
   - Signup, resend-verification and forgot-password call `/api/auth/*`, which exists only as a Vite dev plugin.
   - The same applies to feature-feed, desk-brief and the home APIs.
   - Upstream's router solves this; it is taken and rewired.
6. **The six "clean" auto-merged files carry semantic conflicts.**
   - `userStore.js` gains `upsertGoogleUser` and `googleSub` fields: a local-seat path.
   - `App.jsx` and `TerminalShell.jsx` gain testing-phase hooks.
   - `.env.example` gains Google server variables that won't be used.
7. **Direct provider calls remain in the legacy server paths:**
   - `server/aiApi.mjs`: Gemini and DeepSeek;
   - `server/deskBrief.mjs`: Gemini.

   ADR 0005 routes them through OpenRouter.
8. **Security:**
   - `src/lib/userStore.js` still ships seed accounts with a hard-coded password. They are to be removed during integration (plan Phase 2.3). The details are in the private security note, which is not published.
   - The public history of `origin/dev` contains a service-role JWT from 2026-09-20. The legacy JWT keys were disabled that day, so the exposure is closed but the history remains.

9. **The seed-account fallback allows a client-side entitlement bypass.**
   - Paid features in the Terminal UI can be unlocked without a verified session.
   - It exposes no server data, since those paths need a Supabase session.
   - The fix is plan Phase 2.3. The reproduction is in the private security note, which is not published.
10. **A clean merge with green tests can still take down the whole API.**
    - A trial merge on 2026-09-24 (throwaway worktree) passed the build, 605 Vitest and 415 Deno tests.
    - But `api/router.js` could not load: `google-auth-library` was missing.
    - That is the team report's own point that "a Git-clean merge does not mean the functionality is compatible", confirmed concretely. See the integration plan's Phase 1 gate.

## 4. Things the Claude audit got wrong or missed

| # | Earlier claim | Correction |
|---|---|---|
| C1 | "Production markets are three weeks old" (home-feeds plan, 2026-09-23) | **Wrong for live nter.pro,** which serves live `/api/home/*` through upstream's router. True only for a static `ddllabs` build. The plan has been corrected. |
| C2 | The first audit did not know about `ddllabs/NTER` | **The team found it.** Its auth handlers are useful reference; the rest is rejected (items 3 and 4 in §3). |
| C3 | Earlier proposal: Google via `signInWithIdToken` with the GIS button | **Aligned with the team:** use `signInWithOAuth` (redirect). It needs no Google script or nonce handling in the client; Supabase holds the client ID and secret. |

## 5. Notes on the team's workstation

- The audit ran on a local `ddllabs-main` at `63ef6a1`, 113 commits behind `ddllabs/main`.
- Its working tree has every root file deleted and moved into an untracked `nter/` folder.
- The remote refs they measured are correct, but that checkout should not be used for the integration. **Start from a fresh clone of `ddllabs/niyantran`.**
