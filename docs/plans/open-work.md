# Open work: the one list

> **Status: Living.** Created 2026-09-29 from the earlier trackers, and
> rewritten the same evening as a clean slate after the local cleanup
> session (`main` at `3a51724` and the docs commit after it). Every item is
> either Done (with its commit or its operations record), waiting on one
> named owner decision, in one of four later phases, or an accepted risk.

## How to use this file

- **This is the only list of open work.** Plans, specs, ADRs and
  `agents/coordination.md` may describe a task in detail, but they don't
  track it. Anything "still open", "later" or "follow-up" must appear here.
- An agent takes an unblocked item, follows `AGENTS.md`, and works on a
  `task/<id>-<slug>` branch. When it lands, the item moves to **Done** with
  its commit hash.
- A new finding gets the next free `F` number (F30 is next) and goes in the
  right section.

Current baseline (2026-09-29, evening):
- `main` is the only long-lived branch, locally and on GitHub; production
  (`niyantran-six.vercel.app`) follows it.
- Supabase NTER: 36 migrations; 2 GB compute (`shared_buffers` 512 MB); six
  Edge Functions CLI-deployed from `b60c0dc` (`health` v10, `admin-models`
  v10, `refresh-model-pricing` v11, `ingest-documents` v14, `desk-brief` v5,
  `research-chat` v35). `ALLOWED_ORIGINS` includes the preview pattern.
- The corpus: 2,338 documents, 54,219 chunks and 34,184 desk rows. The
  search index is half precision, 204 MB.
- Tests:
  - 74 Vitest files (1,006 tests), 452 Deno tests, 16 SQL fixtures;
  - `npm run lint`: 0 errors, 0 warnings;
  - `scripts/verify-local-storage-paths.mjs`: 12 of 12 checks on a local
    stack.

  CI is advisory.

## 1. Done

Newest first. Detail is in `git log`, the linked documents and the
"Operations" entries in `agents/coordination.md`.

- **2026-09-29, evening (local session):**
  - F13, a transient identity failure no longer signs the user out
    (`179a708`; spec `specs/2026-09-29-f13-transient-identity-failure.md`,
    `3a51724`, approved with no retry).
    - Network errors and 5xx refuse the request but keep the identity, the
      retained turns and the signed-in UI; callers show "Connection problem.
      Try again."
    - Authoritative failures still sign out.
    - The new tests fail on the old code.
    - In a browser against a local stack with PostgREST stopped, the old
      code dropped a valid session to the landing page on reload; the new
      code stays signed in.
  - F17, both untested database paths run against a local Supabase stack
    (`5259ffa`). `scripts/verify-local-storage-paths.mjs` checks:
    - the preferences merge-upsert through PostgREST, read back as the
      owner, with `service_role` refused;
    - the intro-video signed-URL upload, finalize, public read and delete.

    12 of 12 checks pass. The two merge checks fail when the handler nulls
    omitted fields. The script refuses any non-local URL.
  - C3 (T7), SQLite retired (`31c3915`):
    - the `entry_briefs` tier removed from `server/deskBrief.mjs`;
    - `server/db.mjs` and `sql.js` deleted;
    - `KNOWN_OFFENDERS` emptied, so the guard fails with both offences when
      SQLite is reinstated;
    - the seven tests' dead `db.mjs` mocks removed;
    - the two serverless specs marked Historical.

    O4: the laptop's only SQLite file held three 100-byte briefs written by
    a test run, so nothing was kept. The other worker's machine was not
    checked.
  - F1, `user_preferences.ai_chats` dropped (`92893f1`; migration 36, live
    and pinned). The `drop_ai_chats` fixture fails without the migration.
  - A1, all six Edge Functions redeployed with the standard CLI. The
    dashboard shows the real files, and each function was probed.
  - O5, `ALLOWED_ORIGINS` includes `https://niyantran-*-ddl-labs.vercel.app`.
    Preview and deployment hosts are allowed; foreign origins are refused.
  - O3, the merged branches `task/docs-pass` and `task/f2-server-entitlements`
    deleted on GitHub.
  - F29, the `/api/home/latest` contract test runs offline (`b60c0dc`). It
    used to query live Supabase whenever `.env.local` existed. It now fails
    if the stub isn't used.

- **2026-09-29:**
  - F28, the nuclear-site map builds its marker labels from text nodes (`fillSiteLabel` in `src/lib/geoTip.js`, used by `NuclearSiteMap.jsx`). Its test fails on the old `innerHTML` code. Both helpers were also run in Chromium with an `<img onerror>` name: no element was created and the handler never ran. The other `innerHTML` uses are deliberate: `siteHead.js` injects the admin-configured head snippet and `bootLegacy.js` a same-origin static file.
  - F26, the map tooltip sets feed text with `textContent` (`src/lib/geoTip.js`, used by `GeoDotsMap.jsx`). Its test fails on the old `innerHTML` code with an `<img onerror>` name.
  - F27, test 13 of `scripts/test-auth-complete-suite.mjs` asserts the signed-out profile read. It uses a fresh client (the old `anonClient` had held the test user's session since test 10), and passes only on `42501` or zero rows, so a network error does not pass. `42501` confirmed live on NTER with `set local role anon`; the script itself was not run, because it creates real users.
  - F25, the lint backlog cleared:
    - ESLint 9 core ignores JSX, so 218 of the 253 "unused" warnings were components used only as `<Foo />`, and an undefined `<Bar />` was never reported. `eslint-plugin-react` now supplies `jsx-uses-vars` and `jsx-no-undef` (it found no undefined component).
    - The 35 real unused bindings are gone, including dead code: the Wire RSS fetcher in `server/homeApi.mjs`, `sampleRows` in `server/deskBrief.mjs`, and `QuestionRecord` and `RegulatoryRecord` (both desks render through `BillRecord`).
    - Of the 13 hook notes: `LiveTvModal` compared a loaded archive against the broadcast selected when the fetch began, so a pick made while it loaded could be overwritten (found by reading, not reproduced; now functional updates). Three desks rebuilt memos every render from a fresh `[]` fallback. `AiPanel` now lists `research.actions`, a stable ref. The other seven are deliberate and carry a reason.
    - `no-unused-vars` is an error and `npm run lint` runs with `--max-warnings 0`. F26 and F27 were found on the way.
  - F21, a lint gate. `npm run lint` (ESLint 9 with `react-hooks`) fails on errors and runs in CI as an advisory step; the warnings are F25. Its first run found two `ReferenceError`s in shipped code, fixed in `03f039c`:
    - the right rail's record detail crashed for rows without an analysis;
    - `/data/news.json` answered 502 when nter.news had no live rows.
  - F17 (part): the `pg_cron` branch verified live. `analytics-events-retention` ran at 03:17 UTC and succeeded; `analytics-rate-windows-purge` 105 of 105 runs; `refresh-model-pricing` 18 of 18. The dev server's 503 without `SUPABASE_SECRET_KEY` is documented in `README.md`.
  - F20, the desk-row loader writes only new or changed rows and deletes removed keys (`src/lib/deskRowSync.js`, `scripts/load-desk-rows.mjs`). A dry run now reads the stored rows, so it needs the Supabase variables. The first run rewrites most rows once, because the stored `record_text` lines are in jsonb key order. F19 needed no change: the header of `backend/sql/auth_schema.sql` and `Architectures/README.md` already state its fixture-bootstrap role.
  - F13 (part): the generic "Try Reload" error from `reconcileSavedTurn` keeps the real failure as its `cause`, instead of masking read and programming errors (`src/lib/researchChat.js`).
  - F24, the signup plan step runs: a free email signup with a session sees "Choose plan" and can start its trial; a Pro or Enterprise pick enters directly (`src/lib/signupFlow.js`; checked in a browser against a mocked Supabase).
  - F16, the unused `reasoningSegments` modules (browser and Edge copies, and their tests) deleted; `params` and `max_tokens` parked as P15.
  - F14, the model and effort choice survives a reload (per browser, `useResearchThread.js`); F15, the follow-up pills are a labelled list (`SuggestionPills.jsx`).
  - F23, the `--pdf-text` ingest mode in `scripts/ingest-national-desk.mjs` (tests in `src/lib/ingestPdfText.test.js`).
  - F22, a half-precision search index (migrations `20260929120000` and `20260929120100`, live; fixture `halfvec_retrieval.sql`). 204 MB instead of 404 MB; recall@40 0.9875 against 0.990, measured on 20 queries against an exact scan.
  - F10, one account per normalised email (migration `20260929110000_email_unique`, live; fixture `email_unique.sql`); signup explains the refusal (`src/lib/signupErrors.js`). F11, the review of `my_entitlement` and `start_trial` (`Architectures/06` §9.2).
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

## 2. Awaiting the owner's decision

Each needs one answer, then an agent can finish it.

- [ ] **P12. Advisor findings and the dependency audit** (checked 2026-09-29):
  - **`xlsx` 0.18.5: high severity, and no npm fix** (prototype pollution
    and ReDoS). `server/sourceExtract.mjs` parses fetched source documents
    and chat uploads with it, so the input is untrusted. The fix is SheetJS's
    own distribution (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`),
    which is not on npm. Decide whether to allow that source.
  - `vite` 5.4 (the esbuild dev-server advisory) and `vitest` 3.2
    (`@vitest/mocker`): moderate and development-only. The fixes are major
    upgrades (Vite 7+, Vitest 4.1.11+). Decide whether to take them now.
  - Twelve RLS policies call `auth.uid()` per row (`auth_rls_initplan`), and
    six foreign keys have no index. The fix is one migration of
    `(select auth.uid())` rewrites and indexes, which needs approval.
  - By design, recorded under accepted risks:
    - RLS with no policy on six server-only tables;
    - eight `SECURITY DEFINER` RPCs callable by signed-in users (they are
      the API);
    - 23 unused indexes (low traffic);
    - three sets of multiple permissive policies.
  - Leaked-password protection and the Auth connection strategy are
    dashboard settings (D1).
- [ ] **P16. The home carousel's numbers** (`serveHomeSegments` in
  `server/homeApi.mjs`; every figure is hand-written). Proposal, awaiting
  approval:

  | Figure (shown) | Proposal | Evidence |
  |---|---|---|
  | Bills on record 9,819 | **Compute** from `desk_rows` | 9,817 rows in "Bill Passage Probability Index" |
  | Ministries 48 (legislative) | **Compute** | 56 distinct ministries in the question database |
  | Market indices 10, Open fronts 18 | **Compute** from the markets feed and the war tracker | both feeds exist |
  | Indexed judgments 8,420 | **Drop**, or compute (it would be 654) | 220 Supreme Court and 434 NCLT rows; no judgments are ingested |
  | LS constituencies 543, Houses covered 2, CBAM sectors 6, EU jurisdictions 27, High Court benches 25 | **Keep** as constants | true facts |
  | States & UTs 28 | **Fix**: 36, or relabel it "States 28" | 28 states and 8 union territories |
  | Statements this week 128, Weekly releases 128, Official sources 14, Houses 3 (media), Open tenders 1,280, Ministries 12 (tenders), Closing in 7 days 19, Macro series 42, Core publishers 8, CBAM rows 340, Theatres 6, Source feeds 9, Tribunals 12, By-elections 8 | **Drop** | no data behind them |

## 3. Ingestion pipeline (next)

Parked until the owner designs the new ingestion pipeline. The old runbook,
`plans/2026-09-29-corpus-ingestion.md`, is parked with it: its measurements
stand, but its commands aren't to be run.

- [ ] **L1.** The 18,071 never-ingested `pdf_text` documents: 7,966 bills,
  6,758 parliamentary questions, 2,813 regulatory documents and others. The
  corpus is at `~/Downloads/NTER-Complete-Processed-Data`. `.env.local` on
  the laptop has no `SUPABASE_URL` yet, and the ingest script needs it.
- [ ] **L2.** Law tier: 874 Supreme Court and NCLT PDFs. First confirm they
  have a text layer.
- [ ] **P5.** Page-level citations (`page_count`, chunk `page_number`;
  ADR 0004). Needs page-wise text.
- [ ] **P6.** Reranking and hybrid keyword search, after the corpus grows.
- [ ] **P7.** Affidavits (10,492 documents, 809 M characters): compute cost.
- [ ] **P8.** Re-crawl the 716 documents that have no `file_url`.
- [ ] **P9.** Document keys for parliamentary questions and regulators;
  desk-row "cut two" (curated views, the 41 modules with no rows) and a
  refresh pipeline.
- [ ] **P14.** Bill-key collisions (two documents on one `bill:<year>:<number>`
  key). Accept, or keep one document per key.

## 4. Payments

- [ ] **F6.** Plan gating on the server, before real payments. Desk data is
  public (static files, and `desk_rows` is readable by any signed-in user).
  Locks, row caps and export limits run only in the browser. The spec must
  settle which data is premium, how premium desks are served (an API behind
  `my_entitlement`, or RLS), server-side exports and API row caps.
- [ ] **O6.** After F6: the Razorpay keys on Vercel, then one real payment
  end to end.
- [ ] **P2.** Organisation seats, organisation billing, Razorpay
  subscriptions.
- [ ] **P3.** Metering and credits (ADR 0002); an effort column in
  `model_call_logs`.

## 5. Launch

- [ ] **O2.** Delete `VITE_AI_BACKEND` on Vercel (Settings → Environment
  Variables). Nothing reads it (checked 2026-09-29), and the Vercel tools
  can't delete a variable.
- [ ] **D1. Supabase dashboard:**
  - leaked-password protection on;
  - Auth URL configuration: site URL `https://niyantran-six.vercel.app`,
    and redirects for it, `http://localhost:5173/**` and
    `https://niyantran-*-ddl-labs.vercel.app/**`; nter.pro is added at D2;
  - Storage global upload limit of at least 50 MB;
  - optionally, Auth connections as a percentage.

  The tools can't change Auth settings safely: the CLI's `config push`
  would overwrite the whole Auth config.
- [ ] **O8 and A2. Signed-in smoke test on production** with a test
  account:
  - save preferences;
  - upload the intro video;
  - switch to Academic and ask one question (the answer opens with
    RESEARCH QUESTION / EVIDENCE / CHRONOLOGY).

  Agents may not create accounts or sign in on production, so this is the
  owner's. Afterwards an agent can check the rows with read-only SQL.
- [ ] **D2. nter.pro cutover:**
  - DNS to this Vercel project;
  - the Google OAuth client for the domain;
  - Resend email delivery, with `mailer_autoconfirm` back off;
  - nter.pro in `ALLOWED_ORIGINS` and the Auth URLs;
  - clean up the old upstream setup.

  The owner doesn't have the domain settings yet.
- [ ] **D3. Paid live round.** Five paid-model scenarios plus a
  cross-account denial check, including:
  - the first live `search_documents` turn with a highlighted span;
  - the admin persona chat on Gemini Lite, Gemini Flash and GPT Astra;
  - medium and high reasoning in production.
- [ ] **P11.** Whether `require_parameters` makes reasoning a hard routing
  constraint, and whether a single attachment should be capped at its
  per-document quota. Decided on D3's evidence.

## 6. Waiting on owner assets

- [ ] **F7 / O7.** Live TV content is partly invented. `server/liveTvApi.mjs:664`
  serves a hand-written transcript labelled "ASR Verified Record"; `:609` is
  an invented archive entry; channels without a schedule get placeholder
  programmes. It needs the new Live TV sources, UI and sample codebase.
- [ ] **O9.** The desk-landing visual mockup that
  `specs/2026-09-27-cr12-cr13-desk-landing.md` is waiting for.
- [ ] **O1.** `NTER_TERMINAL_API_KEY` on Vercel, and nter.news pointed at
  production. Until then every nter.news push is refused.
- [ ] **P1.** Database-backed home feeds (`plans/2026-09-23-home-feeds-plan.md`).
  It needs the schema agreed and a market-data vendor. The conflict pulse
  still shows the static war list.

## 7. Accepted risks and won't-fix

Each can be reopened by the condition named.

- **DNS rebinding in source fetching** (`specs/2026-09-28-authorization-review.md`).
  It needs a signed-in account. Closing it would mean pinning the resolved
  address in the HTTP client.
- **A disabled service-role JWT in public git history** (`25723f7`). The key
  is disabled, and removing it would mean rewriting `main`.
- **1,288 documents with unknown `integrity`.** It can't be recovered from
  the inputs.
- **Previews share the live Supabase project.** There is no Supabase
  branching. Test writes use test accounts only, and migrations stay
  additive and fixture-tested.
- **The preview wildcard in `ALLOWED_ORIGINS`.** Anyone can name a Vercel
  project so that its `*.vercel.app` host matches
  `niyantran-*-ddl-labs.vercel.app`. The functions authenticate with a
  bearer token that a foreign page can't read, so an allowed origin gains
  nothing. Reopen if any function starts accepting cookies.
- **Advisor findings that are by design** (see P12): RLS with no policy on
  server-only tables, the `SECURITY DEFINER` RPCs that are the API, unused
  indexes at today's traffic, and multiple permissive policies.
- **P4. Deferred agent features:** web search, compaction, memories, user
  uploads and binary attachments, a durable queue for long turns. Not
  planned until the owner schedules them.
- **P10.** Google sign-ups, and email sign-ups that wait for verification,
  skip the plan step and get no signup trial. They can start one from the
  upgrade dialog. Reopen if it matters commercially.
- **P13.** Two ADRs are numbered 0005. Left unless the ADRs are renumbered.
- **P15.** Two unused extension points, kept on purpose: `ai_models.params`
  and `StreamRequest.max_tokens`. Wire them up when a model needs either.
- **P17.** `reconcileSavedTurn` answers `false` both for "still locked" and
  for a repeat call; a test pins it and the only caller handles it. Reopen
  if a caller needs to tell them apart.
