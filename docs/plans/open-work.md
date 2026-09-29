# Open work: the one list

> **Status: Living.** Created 2026-09-29 by merging
> `plans/2026-09-28-remaining-work.md`, `niyantran-conflict-audit-and-plan/04-open-backlog.md`
> and the open remainders of every other plan, spec and ADR (checked against
> the code on 2026-09-29, `main` at `71292af`). Those documents are now
> Historical and point here.

## How to use this file

- **This is the only list of open work.** Plans, specs, ADRs and
  `agents/coordination.md` may describe a task in detail, but they don't
  track it. If a document says something is "still open", "later" or
  "follow-up", it must also appear here, or it isn't tracked.
- An agent picks the first unblocked task in its section, follows
  `AGENTS.md`, and uses a `task/<id>-<slug>` branch. When the task is done,
  it moves the task's line to **Done** with the commit hash, and deletes it
  from its section.
- A new finding gets a new id (the next free `F` number) in the right section.
  Put detail in a spec only when the task is too large for a few lines here.
- Sections:
  1. Agent tasks (a cloud or local agent can do them now);
  2. Local-session tasks (they need the owner's laptop);
  3. Owner actions;
  4. Parked and decisions;
  5. Accepted risks and won't-fix;
  6. Done.

Current baseline:
- `main` is the only long-lived branch; production (`niyantran-six.vercel.app`) follows it.
- Supabase NTER has 32 migrations and runs on the 2 GB compute (`shared_buffers` 512 MB).
- The corpus: 2,338 documents, 54,219 chunks and 34,184 desk rows. The HNSW index is 404 MB.
- Tests: 66 Vitest files (958 tests), 447 Deno tests and 13 SQL fixtures. CI is advisory.

## 1. Agent tasks (doable now, in this order)

Every task runs its focused tests, `npm run build`, and the router import
check. Changes under `src/lib/`, `src/admin/` or `supabase/` also run
`npm test` and the Deno suite, and SQL changes run `npm run test:sql`. Each
new test must fail before the change.

- [ ] **F22. A half-precision search index (S–M, prerequisite for L1).**
  - Add an expression index
    `hnsw ((embedding::extensions.halfvec(1536)) extensions.halfvec_cosine_ops)`
    and move `match_documents` to it. pgvector 0.8.2 has `halfvec`.
  - This roughly halves the index, so phase A of L1 fits about 512 MB of
    `shared_buffers`. The table isn't rewritten, and the embeddings stay
    full precision.
  - Measure recall and latency against the current index on a fixed set of
    queries. Drop the old index only after that.
  - A SQL fixture covers it. After applying, run `ANALYZE` as in `AGENTS.md`.
- [ ] **F23. The `pdf_text` ingest path (S–M, prerequisite for L1).**
  - A script that streams `documents.jsonl.gz`, selects `pdf_text` by
    `doc_type` and year, and resolves `document_key` through `links.json`.
  - It carries the seven dropped metadata fields and posts to
    `ingest-documents`.
  - It is tested against a small synthetic fixture, so it can be built
    without the corpus.
  - Specification: `plans/2026-09-29-corpus-ingestion.md`, "Prerequisites".
- [ ] **F1. Drop `user_preferences.ai_chats` and its size check (XS,
  migration).** Nothing has read it since `f05a5b6`, and its values were
  cleared on 2026-09-28. It was planned for about a week later (from
  2026-10-05); the owner may approve it sooner.
- [ ] **F10. A unique index on `user_profiles.email_normalised` (XS,
  migration).** The foundation spec deferred this "until entitlements go
  server-side", which happened in `f74c8c1`. Check the live data for
  duplicates first. A SQL fixture checks that a duplicate is refused.
- [ ] **F11. Record the review of `my_entitlement()` and `start_trial()`
  (XS, docs).** The 2026-09-28 review (B1) covered the six
  `SECURITY DEFINER` functions that `authenticated` could execute then.
  These two are new, so the same line-by-line check goes on record.
- [ ] **F13. Three turn-recovery defects (S–M).** From supervisor-recovery
  L1346–1363, all still in the code:
  - `reconcileSavedTurn` is not idempotent;
  - `identityChanged(null)` discards every retained turn on one transient
    failure (`src/lib/userStore.js:81,112,194`);
  - the throw at `src/lib/researchChat.js:274` is unreachable behind a bare
    `catch`.

  Each gets a failing test first.
- [ ] **F14. The model and effort choice survive a reload (S).** They live
  only in memory (`useResearchThread.js:26`). Keep them per viewer in
  `localStorage`, guarded with `try`/`catch`.
- [ ] **F15. Follow-up pills get list semantics and a label (XS).**
  `src/ai/SuggestionPills.jsx:20` is a bare `role="group"`.
- [ ] **F16. Dead AI code (S).** Remove, or wire and test:
  - `reasoningSegments` (`src/lib` and `_shared`), which has no callers
    outside tests;
  - `ai_models.params`, typed at `research-chat/handler.ts:71` and never
    applied;
  - `StreamRequest.max_tokens`, which no caller sets.
- [ ] **F24. The signup plan step never runs (S).**
  - `src/marketing/SignupPage.jsx` defines `goToPlanStep`, but nothing calls
    it. The second step ("Choose plan", which starts a trial through
    `start_trial`) is unreachable.
  - The owner decided on 2026-09-28 (C7) to keep a two-step signup.
  - Today a plan picked from the pricing page reaches the server only through
    the signup metadata; a Google sign-up picks nothing.
  - Wire the step in after account creation (both email and Google), or
    remove it with the owner's agreement.
  - A test shows the step appears and that picking Pro starts a trial.
- [ ] **F18. Real counts on the home carousel (S).** `serveHomeSegments` in
  `server/homeApi.mjs` returns literal "live counts" (9819, 543), but the
  spec calls them authoritative. Compute them from the data they describe,
  or drop the number.
- [ ] **F17. Four database paths no test has run (M).** From wave 1:
  1. the `pg_cron` retention branch in a test database;
  2. the preferences merge-upsert through PostgREST;
  3. the signed-URL video upload against real Storage;
  4. the dev server without `SUPABASE_SECRET_KEY`, where every GET returns 503.

  1 fits `npm run test:sql`. 2 and 3 need a disposable PostgREST and Storage,
  or a test account on NTER with the owner's approval. For 4, fail clearly
  or document it.
- [ ] **F20. The desk-row loader writes only what changed (S–M).**
  `scripts/load-desk-rows.mjs` rewrites all 34,184 rows on every run. Write
  by key difference and prune removed keys. The owner asked for this on
  2026-09-22.
- [ ] **F19. `backend/sql/auth_schema.sql` (XS, docs).** It describes a schema
  that doesn't exist as a whole, but `supabase/tests/run.sh` uses it as the
  fixture bootstrap. Keep it, and state its purpose in its header and in
  `Architectures/README.md`.
- [ ] **F21. A lint gate (M).** There is no ESLint config and no lint script.
  Add one with the current code passing, and put it in CI as advisory.
  `AGENTS.md` must not claim lint passes until it does.
- [ ] **F6. Plan gating on the server (M–L, needs a spec and owner
  decisions; required before real payments).** F2 phase 1 made the plan
  server-owned, but desk data is public (static files, and `desk_rows` is
  readable by any signed-in user). Desk locks, row caps and export limits
  run only in the browser. The spec must settle:
  - which data is premium;
  - how premium desks are served (an API behind `my_entitlement`, or RLS on
    `desk_rows`);
  - server-side exports;
  - row caps at the API.

  Then owner action O6.
- [ ] **C3. T7, close out the serverless move (M). Blocked on O4.**
  - Remove the SQLite `entry_briefs` cache tier from `server/deskBrief.mjs`.
  - Delete `server/db.mjs`.
  - Remove `sql.js` from `vercel.json` `includeFiles`, from `config.includeFiles` in `api/router.js` (line 30) and from `package.json`.
  - Empty `KNOWN_OFFENDERS` in `src/lib/serverlessDurability.test.js`.
  - Mark `specs/2026-09-28-serverless-state-to-supabase.md` and
    `specs/2026-09-28-t0-serverless-durability-guard.md` Historical.

## 2. Local-session tasks (the owner's laptop)

The corpus lives only on the owner's machine
(`~/Downloads/NTER-Complete-Processed-Data`, about 10 GB). A cloud
container can't reach it.

- [ ] **L1. Ingest the large corpus.** The full runbook is in
  `plans/2026-09-29-corpus-ingestion.md`:
  - 18,071 `pdf_text` documents that have never been ingested (7,966 bills,
    6,758 parliamentary questions, 2,813 regulatory documents and others);
  - phases A → B → C;
  - it needs F22 and F23 first (F12, the chunker fix, is live).
- [ ] **L2. Law-tier ingest.** 874 Supreme Court and NCLT PDFs, in the same
  runbook, after phase A.

## 3. Owner actions

- [ ] **A1. Standard CLI redeploy of all six Edge Functions** (`supabase functions deploy <name> --project-ref vfgcppstyzjarlzyqdac`, with `--no-verify-jwt` except for `health` and `admin-models`), so the dashboard shows the real files. Since 2026-09-29 all six run `main` at `d1567d1` through pinned-commit entries.
- [ ] **A2. Academic end-to-end check.** Switch to Academic and ask one question. The answer should open with RESEARCH QUESTION / EVIDENCE / CHRONOLOGY.
- [ ] **D1. Supabase dashboard:**
  - leaked-password protection on;
  - Auth URL configuration for production (and nter.pro later);
  - Storage global upload limit of at least 50 MB.
- [ ] **D2. nter.pro cutover:**
  - DNS to this Vercel project;
  - the Google OAuth client for the domain;
  - Resend email delivery, with `mailer_autoconfirm` back off;
  - nter.pro in `ALLOWED_ORIGINS`;
  - clean up the old upstream setup.
- [ ] **D3. Paid live round.** Five paid-model scenarios plus a cross-account denial check, with an admin and a second ordinary account. It also covers:
  - the first live `search_documents` turn with a highlighted span;
  - the admin persona chat on Gemini Lite, Gemini Flash and GPT Astra;
  - medium and high reasoning in production.
- [ ] **O1. `NTER_TERMINAL_API_KEY` on Vercel, and nter.news pointed at production.** Until then every push is refused.
- [ ] **O2. Delete the unused `VITE_AI_BACKEND` on Vercel.**
- [ ] **O3. Delete the merged branches `task/docs-pass` and `task/f2-server-entitlements` on GitHub.** The agent's git proxy can't delete branches.
- [ ] **O4. Check the SQLite files on your machine and the other worker's** for desk briefs worth keeping. This unblocks C3.
- [ ] **O5. Add the preview pattern to `ALLOWED_ORIGINS`** (F8 is live): `https://niyantran-six.vercel.app,http://localhost:5173,https://niyantran-*-ddl-labs.vercel.app`. Until then every Vercel preview is refused (re-probed 2026-09-29 after the deploy).
- [ ] **O6. After F6, set the Razorpay keys on Vercel**, then run one real payment end to end.
- [ ] **O7. Share the new Live TV sources, UI and sample codebase.** This unblocks F7.
- [ ] **O9. Provide the desk-landing visual mockup** that `specs/2026-09-27-cr12-cr13-desk-landing.md` is still waiting for.
- [ ] **O8. Signed-in smoke test on production:** save preferences, and upload the intro video.

## 4. Parked and decisions

| Id | Item | Waiting on |
|---|---|---|
| F7 | **Live TV content is partly invented.** `server/liveTvApi.mjs:664` serves a hand-written transcript labelled "Official Parliamentary Broadcast / ASR Verified Record"; `:609` is an invented archive entry; channels without a schedule get made-up placeholder programmes. This contradicts the CR-06 spec's "no fabricated transcripts". The Live TV sources are changing. | O7 |
| P1 | Database-backed home feeds (`plans/2026-09-23-home-feeds-plan.md`); the conflict pulse still shows the static war list | Schema agreement; market-data vendor |
| P2 | Organisation seats, organisation billing, Razorpay subscriptions | Owner: after F6 |
| P3 | Metering and credits (ADR 0002); an effort column in `model_call_logs` | Owner |
| P4 | Deferred agent features: web search, compaction, memories, user uploads and binary attachments, a durable queue for long turns (`waitUntil` isn't one) | Owner |
| P5 | Page-level citations (`page_count`, chunk `page_number`; ADR 0004) | Page-wise text from the provider |
| P6 | Reranking and hybrid keyword search | After L1 |
| P7 | Affidavits (10,492 documents, 809 M characters) | Compute; owner |
| P8 | Re-crawl the 716 documents that have no `file_url` (the hosts are known; not in the corpus) | Owner decision |
| P9 | Document keys for parliamentary questions and regulators; desk-row "cut two" (curated views, the 41 modules with no rows) and a refresh pipeline | Measuring the joins; after L1 |
| P10 | Google sign-ups get no signup trial (they can start one from the upgrade dialog) | Revisit if it matters |
| P11 | Whether `require_parameters` makes reasoning a hard routing constraint; whether a single attachment should be capped at its per-document quota | Evidence from D3 |
| P12 | Priority-2 advisor findings (grants, foreign keys, indexes); the dependency audit; the Vite manifest-import warning | Housekeeping slot |
| P14 | Bill-key collisions. Two documents that resolve to the same `bill:<year>:<number>` both keep the key, so a scoped search reads both. `build-corpus-links.mjs` drops a key only when one file name has conflicting URLs. | Decide before L1 phase B: accept it, or keep one document per key |
| P13 | The two ADRs numbered 0005 | Leave, unless ADRs are renumbered |

## 5. Accepted risks and won't-fix

- **DNS rebinding in source fetching** (`specs/2026-09-28-authorization-review.md`).
  It needs a signed-in account. Closing it fully would mean pinning the
  resolved address in the HTTP client.
- **A disabled service-role JWT in public git history** (`25723f7`). The key
  is disabled, and removing it would mean rewriting `main`.
- **1,288 documents with unknown `integrity`.** It can't be recovered from
  the inputs.
- **Previews share the live Supabase project.** There is no Supabase
  branching. Test writes use test accounts only, and migrations stay
  additive and fixture-tested.

## 6. Done

Newest first. Detail is in `git log` and the linked documents.

- **2026-09-29:**
  - F8, preview origins in CORS; F9, no legacy keys in Edge Functions; F12, the chunker's table rule (version 2) (`d1567d1`). All six functions were redeployed from that commit: `health` v8, `admin-models` v8, `refresh-model-pricing` v9, `ingest-documents` v12, `desk-brief` v3, `research-chat` v33. The four that are reachable without a JWT answered their own 401 with the production CORS header.
  - F2 phase 1, server-owned plans (`f74c8c1`; `specs/2026-09-29-f2-entitlements.md`); this file (`docs:` commit of 2026-09-29).
- **2026-09-28/29:**
  - F3, one secret-key name (`3572e53`);
  - F4, Live TV quota (`47fa681`);
  - D4, legacy AI path retired (`14b2344`), and `aiChatStore` removed (`f05a5b6`);
  - D5, rollback runbook;
  - C1, invoices (`19d25e6`);
  - C2, nter.news (`7160391`);
  - C4, admin persona probe (`8a21133`);
  - C5, persona prompt (`c24d379`);
  - C6, testing flag retired (`9e7a125`);
  - C7, UI decisions (`96594d3`, `aee1e8a`);
  - B1 and B2, security reviews (`docs/specs/2026-09-28-authorization-review.md`);
  - B3–B6, tests stop rewriting `public/`, STAT-1 cache, `loadEnv`, CI;
  - A3, operations record.
- **2026-09-28**, the serverless move:
  - T0 (`d55da42`);
  - wave 1: T1 preferences, T2 analytics, T4 flags and media;
  - wave 2: T3, local users retired (`5a2ded0`);
  - T5 and T6 as C1 and C2;
  - the analytics rate limit (`483b3b2`).

  Only T7 (C3) remains.
- **2026-09-22 and earlier:** the first corpus pass, 2,338 documents all
  indexed (`plans/2026-09-21-corpus-ingest-first-pass.md`); scoped
  retrieval; the streaming research agent; citations; desk-row grounding.
