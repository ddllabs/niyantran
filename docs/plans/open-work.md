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
- A new finding gets the next free `F` number (F60 is next) and goes in the
  right section. F61 is next after the authorized frontend defect task.

## Active execution

- [ ] **F60. Frontend defect fixes.** Owner authorized fixes from the UI review
  before the next enhancement brief. Isolated local UI branch; no publication.
  [Spec](../specs/2026-10-04-ui-defect-fixes.md),
  [plan and evidence](2026-10-04-ui-defect-fixes.md).

Current baseline (read-only observations, 2026-10-03):
- `main` is the only long-lived branch; production follows origin/main.
  The review began at local `f0058b1`, one documentation commit ahead of
  origin/main `322c76a`. Subsequently F57 was pushed at `3b40cba` and its
  Vercel deployment succeeded; the infrastructure observations below remain the
  dated read-only review snapshot. No fresh Supabase probe is implied.
- Supabase NTER: ACTIVE_HEALTHY, PostgreSQL 17.6, 43 applied migrations
  through `20261002180000_search_folding`; 33 public tables, all with RLS enabled.
- Nine ACTIVE Edge Functions: `health` v12, `admin-models` v12,
  `refresh-model-pricing` v13, `ingest-documents` v18, `research-chat` v46,
  `desk-brief` v7, `ingest-worker` v1, `admin-ingest` v2, `document-file` v1.
- Corpus: 2,340 indexed documents, 54,340 chunks and 34,184 desk rows.
  The stored-PDF/page pipeline covers two documents: 34 pages, 561 blocks,
  no page images. This is separate from legacy text-only corpus coverage.
- The worker cron is active every 30 seconds. Pricing refresh is every
  twelve hours; analytics retention is daily and rate-window purge every 15 minutes.
- Verification evidence: local `npm run lint` and router import passed during
  the review. GitHub CI for `322c76a` passed lint, build, router import,
  Vitest, Deno and disposable SQL fixtures. No local build or test-suite run
  was performed in the read-only review. CI is advisory.
- GitHub authenticated as `ddllabs`; repository read access and Supabase
  SELECTs/function metadata were verified. Vercel READY states below are
  dated operations records, not an independent October 3 Vercel probe.

## 1. Done

- **2026-10-03, F58 heavy PDF local profiling:** `d971245`. Offline harness and repeated measurements on 25-page Budget and 740-page Economic Survey; steady warm scrolling, three live canvases, no sampled visible-page loading. No production optimization justified. [Results and limits](../research/2026-10-03-heavy-pdf-profile.md); remaining first-traversal attribution is F59. Locally integrated only.

- **2026-10-03, F56 documentation reconciliation:** `b79e335`. Architecture, ADR amendments, entrypoints and shipped-work statuses reconciled against source and dated operations. Independent review and Markdown checks passed; documentation-only, locally integrated. [Plan and evidence](2026-10-03-documentation-reconciliation.md).

Newest first. Detail is in `git log`, the linked documents and the
"Operations" entries in `agents/coordination.md`.

- **2026-10-03, F57 citation viewer reliability, verified locally by supervisor:** `6df6d7c`. Stable PDF slot order preserves highlights; repeated citation events and cited-page controls reveal the exact passage, including after redraw. 2,029 Vitest tests, lint, build, independent review and local browser checks pass. [Plan and evidence](2026-10-03-citation-viewer-reliability.md). Pushed to origin/main at `3b40cba`; GitHub Vercel status confirmed deployment success. Timing follow-up is F58.

- **2026-10-03, F55 `chat-attach-fixes`, closed by the owner:** the AI chat's drop frame, duplicate
  attachments and Reload.
  - **The drop frame** is an overlay on all four sides.
  - **Attachments are identified by document key or file content.** The same bill by any route is
    one chip, and two different files that share a name are two. Skipped duplicates are named
    ("Already attached: …").
  - **Reload and its row** appear only when needed.
  - **Spec:** `specs/2026-10-03-chat-attach-fixes.md`. On production at `e651613` (Vercel READY).
- **2026-10-03, F54 `side-panel`, closed by the owner:** Desk, Record and AI research are one
  `SidePanel`, replacing the rail and the AI dock that took turns in the same slot.
  - **What it has:**
    - one tablist;
    - one draggable, remembered width (36% by default, 400 px to 60%);
    - one expand mode for every tab (the citation overlay generalised);
    - Collapse with a handle;
    - AI's actions in the tab bar;
    - the docked shadow.
  - **A row click or page load always opens the panel.** On AI, a row click stays on AI.
  - **Spec:** `specs/2026-10-03-side-panel.md`, with amendments 1 and 2; local run
    `research/2026-10-03-side-panel-local-run.md`. On production at `57e3d8c` and `1f0ab07` (Vercel
    READY).
- **2026-10-03, F53 `research-coverage`, closed by the owner:** questions that sound simple but
  need digging. Measured; neither fix ships.
  - **The test set:** `eval/agent/coverage.v1.jsonl`, 15 bill questions with 75 points, revised
    after an independent review (`research/2026-10-02-coverage-set-review.md`).
  - **The measured risk:** today's agent covers 88% of the points and answers 57% of the questions
    in full. Its misses are provisions later in the bill than its first search reached.
  - **The fixes:**
    - The prompt coverage check did not help.
    - The dig nudge passed the coverage mark at the threshold but failed on ordinary questions:
      +9 s and +122% cost on narrow questions, firing on 6 of 10.
    - Both stay in the code as options, off by default. NTER is unchanged.
  - **Not scheduled:** a narrower nudge, or a reader-side "Dig deeper" action, if a real answer
    shows this failure.
  - **Spec:** `specs/2026-10-02-research-coverage.md`; results in
    `research/2026-10-02-research-coverage.md` (`cf54c58`). About $10.40 spent.
- **2026-10-02, R6 `citations-pdf`:** a page-wise viewer for ingestion-v2 citations.
  - **What it does:**
    - the original PDF, with box highlights;
    - an OCR text view, both with page switching;
    - signed byte-range reads through `document-file`;
    - the chat widens into a resizable overlay;
    - Fit text, zoom and a full view;
    - a click outside closes both panels, while Close citation keeps the chat.
  - Legacy documents keep the old reader.
  - **Spec:** `specs/2026-10-01-rag-v2-citations-pdf.md`, revisions 3–5.
  - **Local runs:** `research/2026-10-01-citations-pdf-local-run.md` (V7, V7b and V7c).
  - **On NTER:**
    - `document-file` deployed (V8 step 1);
    - frontend at `e76a48a` (revision 4) and `3a44ff2` (revision 5), Vercel READY.
  - **Owner checks passed (2026-10-02):** citations on the Anti-Doping bill, click outside,
    Close citation and the full view. The "Open stored copy" tab is still to check, listed
    under R8.
- **2026-10-02, F45 (on NTER with R6 revision 5):** `0181b71`, wired in `ee206bb`.
  - **Per-part requests:** the viewer passes the part layout it read from `document_files`, so
    `document-file` is asked once per part, not once per page.
  - **Ask state:** "Ask about this document" is disabled, with a reason, for a deleted or not-live
    document.
  - **Verified:** V7c on the local stack. Paging 21 times across a 3-part document made 3
    requests.
- **2026-10-01, F43 (local, `task/admin-records`):** `ad34438`. The chat panel kept
  resetting on every same-account auth event (tab refocus, token refresh), which dropped
  an unsent chat's attachments and draft and aborted a streaming answer. A same-account
  event now re-verifies quietly; a sign-out or another account still clears at once.
  Reproduced and verified in the browser on the local stack (the old code drops the
  attached row on one same-account `SIGNED_IN`; the fix keeps it; `SIGNED_OUT` clears it).

- **2026-09-29, evening (local session):**
  - Declutter before the new ingestion pipeline (owner-approved). Removed
    from the repository: eleven unused scripts, `api-status.pdf`,
    `_kpi_slides.txt`, `.oxlintrc.json`, the root
    `NTER_BACKEND_FIRST_INTEGRATION_REPORT.md`, the deleted-branches archive
    in `docs/`, the never-deployed backend module (`backend/src`,
    `backend/index.ts`, `backend/package.json`, three invite functions) and
    the `extract`, `feed` and `export-map` npm scripts. `backend/sql` stays
    for the SQL fixtures. Outside git: `dist/` and `tmp/` removed, the old
    link map `ingest/national-desk/` moved to the Trash, the local Supabase
    stack's Docker images and volumes removed, and five superseded zips and
    folders in Downloads moved to the Trash. The corpus folder was first
    completed from its zip (7 files it lacked, about 1.1 GB, sizes and CRCs
    checked). The Supabase corpus is kept until the new pipeline replaces it.
  - O2, closed without deleting (owner's decision). Four Vercel variables
    are unused: `VITE_AI_BACKEND`, `PROJECT_ID`, `GOOGLE_CLIENT_ID` and
    `VITE_GOOGLE_CLIENT_ID`. No code reads them, and nothing reads
    `import.meta.env` as a whole, so Vite puts neither `VITE_` value in the
    bundle. Google sign-in runs through Supabase's own provider settings.
    They stay because the Vercel tools can't delete variables; remove them
    whenever someone is in the dashboard.
  - D1 (part), the Auth redirect URLs: the owner added
    `http://localhost:5173/**` and `https://niyantran-*-ddl-labs.vercel.app/**`
    (site URL stays production). Verified by starting a Google sign-in from
    each origin and reading `auth.flow_state.referrer`: production, the
    `main` alias, a preview deployment and localhost each return to
    themselves, and an unknown origin falls back to production. Before
    this, the Auth logs showed a preview sign-in (28 Sep 08:43 UTC) landing
    on production. Google sign-in itself has worked since 27 Sep (5
    accounts).
  - P16, the home carousel shows only computed figures and true constants
    (`87dc8bf`):
    - computed: bills 9,817 (unique IDs; the feed repeats two rows),
      ministries 56, fronts 88, market instruments 9;
    - constants: 543 seats, 2 Houses, 36 states and UTs (was 28), 6 CBAM
      sectors, 27 EU states, 25 High Courts;
    - the invented figures are dropped.

    Its test fails on any figure outside those.
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
    - RLS with no policy on server-only tables (nine in the October 3 advisor check);
    - eight `SECURITY DEFINER` RPCs callable by signed-in users (they are
      the API);
    - 23 unused indexes (low traffic);
    - three sets of multiple permissive policies.
  - Leaked-password protection and the Auth connection strategy are
    dashboard settings (D1).
- [ ] **F30. The other hand-written marketing figures** (found while doing
  P16). They weren't part of P16's approval:
  - `src/marketing/HomePage.jsx` shows "9,819" bills in four places (lines
    36, 290, 584 and 736); the carousel now says 9,817 unique bills;
  - "211+" live API endpoints (`HomePage.jsx:286` and `:727`, and
    `PricingPage.jsx:135`);
  - "UPTIME 99.9%" (`HomePage.jsx:294`, `PricingPage.jsx:143`), which nothing
    measures.

  Decide per figure: compute it (the bills count can reuse P16's), keep it
  as a constant, or drop it.

## 3. RAG v2: retrieval and page-aware ingestion (in progress)

Designed on 2026-09-30. The map and every decision are in
`specs/2026-09-30-rag-v2-capability-map.md`, and the evidence in
`research/2026-09-30-rag-v2-investigation.md`. The old runbook
`plans/2026-09-29-corpus-ingestion.md` is superseded: its measurements stand,
but its commands aren't to be run.

Part 1 is planned in `plans/2026-09-30-rag-v2-retrieval-and-contract.md`
(tasks T1–T17):

- [x] **R1. `eval`** (spec `specs/2026-09-30-rag-v2-eval.md`). Done on
  2026-10-01 (`952d4e8`):
  - the frozen set of 195 questions and its vectors;
  - the harness;
  - the live baseline in `research/2026-09-30-retrieval-baseline.md`
    (broad doc@10 85.3%, focused chunk@10 97.8%).

  The 20-question owner review was done by the supervisor on the owner's
  behalf.
- [x] **R2. `retrieval-scope`**. Done on 2026-10-01:
  - migration `20261001100000`, and `research-chat` deployed from `2d4f9bd`;
  - frontend `6f1b94b`;
  - live eval "no worse", with the desk filter at doc@10 171/184 against 157;
  - F32 fixed by `document_modules()`.

  Remaining: the owner's signed-in check of the button.
- [x] **R3. `chunk-contract`**. Done on 2026-10-01 (`b9bcb6c`):
  - migration `20261001120000` live;
  - `research-chat` and `ingest-documents` redeployed;
  - page text rules, the page chunker (version 3), citation fields, and the refusal of
    page-aware documents by the old path;
  - the ADR 0002 and 0004 amendments.

  Live eval "no worse".

Part 2: deployed ingestion and the remaining pilot/acquisition work:

- [ ] **R4. `ingestion-v2`** (spec `specs/2026-10-01-rag-v2-ingestion-v2.md`,
  approved; plan `plans/2026-10-01-rag-v2-ingestion-v2.md`):
  - a private `corpus` bucket, content-addressed by file hash;
  - a job-table queue (skip-locked claims, lease, fencing), with a pg_cron
    timer switched on by the owner;
  - the `ingest-worker` Edge Function running Mistral OCR in page ranges and
    indexing slice by slice;
  - first extractions only.

  The owner sets `MISTRAL_API_KEY` and runs the secret steps.

  Built on `task/rag-v2-ingestion-v2` (I0–I5, checkpoint D, 2026-10-01). The
  local end-to-end run (I7) passed:
  `research/2026-10-01-ingestion-v2-local-run.md`, $0.197. The later NTER
  deployment below supersedes the earlier checkpoint E/I8 deployment steps.
  `MISTRAL_API_KEY` is already set on NTER (the owner, 2026-10-01).
  **Live on NTER, 2026-10-01** (`agents/coordination.md`): migration 39, the worker
  secret, both functions deployed, and the first document (the 12-page bill) ingested
  for $0.048. R8 subsequently switched the schedule on; it was active in the
  October 3 read-only check. Remaining: the owner's signed-in citation check, then
  mark R4 done.
- [ ] **R5.** A pilot of about 10 PDFs from the candidates in the research
  doc §6, which proves pages, boxes, images, cost and re-run cost.
- [ ] **R7. `acquisition`.** Download the 5,327 linked `pdf_text`
  records (5,218 sansad.in bills), then backfill on a separate owner
  go-ahead. This replaces L1 for the linked records; the unlinked ones wait
  for R8.
  Finding (I7, 2026-10-01): rbidocs.rbi.org.in answers a scripted download
  with "Request Rejected", and may refuse Mistral's fetch as well. Its 76
  links need another route, such as an admin upload.
- [ ] **R8. `admin-upload`.** A platform-admin upload tab, with splitting
  in the browser. Spec `specs/2026-10-01-rag-v2-admin-upload.md` (draft,
  approved 2026-10-01). Moved ahead of R5–R7 by the owner
  (2026-10-01): it is the milestone.
  Built on `task/rag-v2-admin-upload` (B0–B4, checkpoint F). The local end
  to end (B5) passed: `research/2026-10-01-admin-upload-local-run.md`.
  **Live on NTER, 2026-10-01** (`agents/coordination.md`): migration 40,
  `admin-ingest`, the Documents tab, and the schedule ON. Remaining: the owner's
  upload of *Budget at a Glance* with "split every 10 pages" and the citation
  check on pages 10/11. Then mark R8 done and make the plan Historical.
  **Amendment A** (records-first document management, approved 2026-10-01; plan
  `plans/2026-10-01-rag-v2-admin-records.md`): built on `task/admin-records`
  (C0–C4, migration `20261001180000_corpus_records`), checkpoint H passed, and the
  local end to end (C5) passed: `research/2026-10-01-admin-records-local-run.md`.
  **Live on NTER, 2026-10-01:** the migration, `admin-ingest` and the frontend. Owner check 1
  passed: the Anti-Doping bill was attached to `bill:2025:77`.
  **Remaining, deferred by the owner on 2026-10-02.** The NTER logs and audit table showed none of
  these had run yet:
  1. upload *Budget at a Glance* with "split every 10 pages" (3 parts), then open a citation on
     page 11 or later;
  2. delete one document (it must show in `corpus_admin_actions`);
  3. from R6, "Open stored copy" opening the PDF in a new tab.

  Then mark R8 done and make its plans Historical.

Follow-ups and findings:

- [ ] **F31.** `deno.lock` is stale: it still lists `sql.js` (removed in C3)
  and lacks the ESLint packages. Regenerate it in its own commit.
- [x] **F32.** (fixed by R2, 2026-10-01) `research-chat` `documentModules` (`index.ts:265-281`)
  reads one row per document with no range. PostgREST caps a read at
  `max_rows` 1000, so modules can be missing from the list. Fixed by R2
  (`document_modules()`).
- [ ] **F33.** A document picker (title search), to focus on a document no
  answer has cited yet.
- [ ] **F34.** Let the model choose a desk filter itself. It needs an
  answer-level evaluation first.
- [ ] **F35.** NTER's unscoped search loses results to its HNSW index.
  Measured 2026-10-01 in `research/2026-10-01-feature-filter-measurements.md`:
  - against an exact search, NTER's top 40 has a recall of 0.913;
  - exact search finds the right document in the top 10 for 170 of 184
    questions, NTER's index for 157;
  - Budget and Industry are lost on NTER's index build.

  Next: measure raising `hnsw.ef_search` for the unscoped branch (100–200)
  with the `eval` harness, on the replica and then live.
  Also measure lowering the feature filter's exact threshold T (15,000)
  so that Regulatory takes the index path. Its exact scan takes 733 ms on
  NTER.
- [ ] **F36.** `_shared/logging.ts` redacts by field name, and any name
  containing "token" is hidden. So `embed_tokens` and other counts appear as
  `[redacted]` in Edge logs (seen in the I7 run). Names containing "key" are
  hidden too: `document_key`, `expected_key` and `key_holder` in `admin-ingest`'s
  logs (C5). Redact known secret names and secret-shaped values instead.
- [ ] **F38.** A sweeper for `corpus/staging/` objects older than 24 h, and
  for content-addressed objects no document references after a discard
  (admin-upload spec, "Follow-ups").
- [ ] **F39.** `research-chat`'s `featureScopeOf` keeps only the first
  spelling of a desk feature (`handler.ts:515-536`). It should collect every
  spelling, e.g. "(RBI / SEBI / TRAI / CCI)" and "(RBI/SEBI/TRAI/CCI)".
- [ ] **F40.** Rows in 73 of 75 desk features carry no `document_key`, so a dropped row
  from those desks can never attach its document. Only the two bill features have keys. This
  needs stable keys from the loader for every row, and a generalised client key in place of
  `billDocumentKey`. It is admin-upload Amendment A, part A4, and needs its own spec.
- [ ] **F41.** A widened chat turn is slow: on 2026-10-01 a bill question waited 65 s, of which
  Gemini Flash took 46 s on a 25,850-token prompt. Search took 0.6 s. Measure the prompt size
  of widened turns and cap it.
  - **In progress (2026-10-02).** Spec `specs/2026-10-02-chat-turn-cost.md` (approved: "measure,
    then cap"); plan `plans/2026-10-02-chat-turn-cost.md`. It also covers F46's agent-loop cost.
    - **Built:** a widened search asks for 15 passages, and a search reply stops at 24,000
      characters (`0de8178`, `13c050e`).
    - **The benchmark** has a widened kind and per-call prompt tokens (`a76d093`).
    - **Measured** (`research/2026-10-02-turn-cost-benchmark.md`, $2.83):
      - the reply cap missed the narrow depth mark and is off;
      - the widened limit deepens widened answers but does not speed them up;
      - prompt size explains little of call time (r = 0.14).
    - **The slow turn's NTER log** (owner-approved read): the provider was slow, not the prompt.
      One call ran at 21 tokens a second; the next took 18.6 s to write 29 tokens.
    - **Next:**
      - the owner decides on the widened limit;
      - a measured trial of OpenRouter provider preferences (by throughput or latency), which is
        where F41's speed lies.
    - **Routing trial run (2026-10-02, $2.43, 25 questions, no errors):** `thru` and `lat` are
      much faster than `v45`. First word p50 falls from 21.3 s to 8.7 s and 7.4 s; p90 from
      40.9 s to 15.0 s and 10.9 s. Cost falls 15% and 27%. Both miss the depth pass mark on
      briefs: 3.1 and 2.8 searches against 4.5, and 7.8 and 7.3 pages against 8.3. Citations are
      100% valid. By the amendment's rule nothing ships. Results are in
      `research/2026-10-02-turn-cost-benchmark.md`.
    - **Owner discussion open (2026-10-02):** routing, and whether widened searches return to 40
      passages.
    - **Second pass of 40 against 15 (2026-10-02, $0.56):** the first pass's advantage for 15 did
      not repeat. Pooled over 25 question-runs the two are level on depth: documents 1.32
      against 1.44, pages 4.84 against 4.68, the expected document 25/25 against 24/25. 15 is
      1.6 s slower at p50, and costs the same.
    - **Done:** widened searches are back to 40 (owner, 2026-10-02; `2f0c71d`), deployed as
      `research-chat` v46.
    - **Still open:** the provider-routing decision. By the rule nothing ships; the owner has not
      decided.
- [ ] **F42.** Show page numbers in the current text citation reader before the PDF viewer
  (R6) lands. Page-aware chunks already return `page_number`, blocks and the section.
- [ ] **F46.** The AI Research chat experience: review `research/2026-10-02-chat-experience-review.md`
  (owner request, 2026-10-02). The owner discusses it before a spec. Confirmed defects:
  - the composer is not pinned to the bottom;
  - the thread opens at the top;
  - finished turns lose their search steps;
  - "thought" is never shown;
  - one model has two names.

  Also covered there: loading in stages, the thinking indicators, the agent loop's speed and cost
  (53 s and $0.105 for one answer), no visible streaming, and re-render cost.

  **Bug fixes on `task/chat-bug-fixes` (2026-10-02):** `7abd31e`, `a5f84af`, `8dfc571`,
  `cd6a7ac`. All five defects above are fixed, each with a test shown red first.
  - **Verified in a local browser run:**
    - the composer is pinned 14 px from the bottom from first paint;
    - a reload opens at the newest message (0 px from the bottom, re-pinned after the pills);
    - saved steps keep their three lookups;
    - "thought 23.5s" shows when the row has a reasoning count;
    - the saved answer reads "Gemini - Flash".
  - **Pushed to NTER** with `b3b95d0` (Vercel READY).

  **The thinking display (2026-10-02).** Spec `specs/2026-10-02-thinking-display.md`, approved;
  plan `plans/2026-10-02-thinking-display.md`. Built on `task/thinking-display` (`18343c0`,
  `1c882af`, `4491abe`, `c234e51`), and the local browser run passed.
  - **What it does:**
    - one indicator from Send;
    - each stage labelled once;
    - "Found so far";
    - a collapsed summary;
    - the NyAI card removed (ADR 0007 amended).
  - **Shipped:** the thinking-display deployment and frontend push are recorded in
    `agents/coordination.md` on 2026-10-02.
  - **Still open from F46:** loading in stages, and the agent loop's speed and cost.
    - **Update (2026-10-02):** loading in stages was closed by panel loading. The end-of-turn
      shift (D4) measured zero in the chat-panel-fixes run. The agent loop's cost is measured in
      `research/2026-10-02-turn-cost-benchmark.md`: a cap on prompt size costs depth, and the slow
      calls are provider latency (F41).

  **Answer streaming (2026-10-02).** Spec `specs/2026-10-02-answer-streaming.md`, approved, with
  amendments 1 and 2. Built on `task/answer-streaming` (`4150197`, `6e0e9e7`). The local run
  passed: `research/2026-10-02-answer-streaming-local-run.md`.
  - **Result:** answers arrive in 13–37 pieces instead of one block. `timing` records
    `first_model_ms`, `first_answer_ms` and `rounds`. `session_id` is sent.
  - **Owner-approved latency cuts shipped:** Google requests omit explicit cache
    breakpoints; the duplicate client pre-send identity check was removed while
    server authorization remains. The measured tradeoffs and authorization are in
    coordination's October 2 operations record.
  - **Shipped implementation (2026-10-02):** research-chat v42 and frontend
    pushes `0aa8077` and `947dc82`; later function deployments retain these changes.

  **Panel loading, A–E (2026-10-02).** Spec `specs/2026-10-02-panel-loading.md`, approved. Built
  on `task/panel-loading`, and the local browser run passed.
  - **What changed:**
    - one verification per open;
    - the panel kept alive between opens (reopen makes 0 network calls and keeps scroll);
    - one reveal;
    - one layout per open;
    - memoised message rows.
  - **Pushed:** to NTER at `a4da602`, with the bundle re-baselined.

  **Answer speed (2026-10-02).** Spec `specs/2026-10-02-answer-speed.md`, approved; chunks stay
  at 40.
  - **The change:** the question is searched before the first model call (`3efcca9`).
  - **The benchmark** (`research/2026-10-02-answer-speed-benchmark.md`, two passes):
    - 32% fewer model calls;
    - first word earlier;
    - cost 13–38% lower;
    - citations valid 40/40, gold citations 38/40 against 34/40.
  - **Batching** was measured and is not recommended.
  - **Deployed** as research-chat v43.
  - **A fast routing model** (step 4) was dropped by the owner: with the pre-search it would add a
    call to most turns.
  - **Amendment 1** (`1a46546`), so speed never costs depth:
    - the pre-search reply asks for a search per part it does not cover;
    - follow-ups are not pre-searched.
  - **Benchmark pass 3** (`research/2026-10-02-answer-speed-depth-benchmark.md`) is partial: the
    OpenRouter account ran out of credits.
    - Narrow questions keep the gain.
    - Briefs search more than before and cite at least as much, but take about 13 s longer to the
      first word.
  - **Benchmark pass 4** (`research/2026-10-02-answer-speed-depth-benchmark-pass4.md`) is complete:
    all 15 briefs and the 10 follow-ups, $3.68, every call succeeded.
    - **Briefs meet the pass mark.** Pooled over 24, amendment 1 against the baseline: 4.71 against
      3.79 searches, 2.38 against 2.33 documents, 8.50 against 8.25 pages, and the expected
      document 24/24. The first word comes 3 s sooner at p50.
    - **Follow-ups run as the baseline by construction.** v43's verbatim pre-search missed the
      expected document once.
  - **Deployed** on 2026-10-02 as `research-chat` v44 (`agents/coordination.md`).
  - **Next:** the owner checks, signed in on production, a four-part brief and a follow-up.
- [ ] **F47.** Found during the F46 fixes and left out of their scope.
  - **In progress (2026-10-02):** spec `specs/2026-10-02-chat-panel-fixes.md` (approved: the dimming
    is restored), plan `plans/2026-10-02-chat-panel-fixes.md`.
    - **Done:**
      - T1, the live timing word (`ea0e07c`, a `research-chat` change);
      - T2, the region rules and dimming (`4e030e8`);
      - T3, the phone dock (`fabae3a`): the thread goes from 18 px to 318 px at 375 × 812;
      - T4, measured: zero shift at the end of a turn.

      The local run is in `research/2026-10-02-chat-panel-fixes-local-run.md`.
    - **`research-chat` v45 deployed** on 2026-10-02, with T1's frame and the widened limit.
    - **Shipped:** T1–T3 at `da32cb3`; T5 at `c2c3069` (operations record, 2026-10-02).
    - **Noted in the run, then fixed by T5** (`01d1714`, `research/2026-10-02-phone-header-local-run.md`):
      - at 375 px the header fits, with no Log out duplicated in the bar below 900 px;
      - the history list stays on screen (x 57–359);
      - the account menu, clipped below 900 px by the scrolling bar, now opens and works.
    - **Open, an owner design choice:** at 320 px the avatar is still cut, because the actions
      need 212 px and get 172. Closing it costs the wordmark, a button or touch-target size.
  - **Phone width:** the AI dock gets 268 px under the desk at 375 × 812. The composer is clipped
    71 px below it and the thread is 18 px tall. The same happens with the pre-fix CSS.
  - **Dead dimming:** the history-open dimming selectors (`index.css`,
    `.ai-shell.ai-shell-v2.history-open > .ai-v2-body` etc.) match nothing in the research
    shell, because its rows sit inside `.ai-panel-background`.
  - **Live timing word:** it reads "waited" until the saved row replaces it, even when the saved
    row then says "thought". The live stream carries no reasoning count.
- [ ] **F48.** The citation viewer's header is about 190 px of text buttons in the side pane. It
  becomes a compact, icon-based chrome: two rows in the side pane, and a header plus a floating
  page pill in the full view.
  - **Spec:** `specs/2026-10-02-viewer-toolbar.md` (owner-approved).
  - **Plan:** `plans/2026-10-02-viewer-toolbar.md`.
  - **Piece 2 is re-scoped by the owner (2026-10-02)** into a standard PDF viewer, with its own
    spec:
    - continuous scrolling in the side pane and the full view, opening at the cited page;
    - thumbnails on the left;
    - search in the document;
    - the citation marked by its exact text on the PDF's text layer. Block rectangles stay only as
      a visibly different fallback for pages without a text layer.
    - The PDF loader must hold a few stored parts open at once.
    - **Spec:** `specs/2026-10-02-viewer-continuous.md` (owner-approved; the Text view gets both
      layouts for documents with pages).
    - **Plan:** `plans/2026-10-02-viewer-continuous.md`, T1–T9.
  - **Piece 1 is built and verified locally** (2026-10-02):
    - side pane chrome 83 px, against about 190 px before;
    - a review's four required fixes are applied;
    - 1,826 tests pass;
    - the main bundle is +0, the viewer chunk +5.7 KB.
  - **Piece 2 is built and verified locally** (2026-10-02, T1–T9 and the search start page). An
    independent review found nothing critical; its four behaviour defects are fixed (plan,
    Checkpoint B), and the rest are F50.
  - **Migration 42** (`search_document_pages`) was applied to NTER on 2026-10-02 and verified live
    (`agents/coordination.md`).
  - **Pushed** on 2026-10-02 (`7565408`); production deploy `dpl_GvdNsfQHM8wQwxbLV2SBMt2Zu9FN` is
    READY.
  - **Next:** the owner checks on production:
    - the clipboard's success path (the test browser refuses clipboard access);
    - a real split document;
    - search, exact marks and thumbnails on the live bills;
    - the continuous Text view in Safari (F50).
- [ ] **F49.** The citation viewer cropped pages to their body text by default ("Fit text"). The
  anti-doping bill's page 1 lost its "As introduced in Lok Sabha" header and its top two thirds,
  and read as a different document from the stored PDF.
  - **Spec:** `specs/2026-10-02-viewer-whole-page.md` (owner-approved).
  - **The fix:**
    - Fit width is the default;
    - Fit text never crops the page's height or any block;
    - the zoom is saved only when the reader chooses it, under a new key.
  - **Shipped:** `4f714f8` reached production in `60b49f4` (Vercel READY, operations
    record 2026-10-02). Owner acceptance is not inferred from deployment.
- [ ] **F50.** Follow-ups from the viewer-continuous review (2026-10-02). None blocks the push.
  - **Built and verified locally** (spec `specs/2026-10-02-viewer-f50.md`, plan
    `plans/2026-10-02-viewer-f50.md`, `4a0871d`..T5). Every item below is fixed except the
    stored-column note, which was settled at migration 42's apply.
  - **Migration 43** (`20261002180000_search_folding`) was applied to NTER on 2026-10-02 and verified
    live (`agents/coordination.md`).
  - **Pushed** on 2026-10-02 (`55d7595`); production deploy `dpl_CaCMMxNPeJoxYPzUjYUdGvW3Y93z` is
    READY.
  - **Next:** the owner checks the continuous Text view in Safari. Then move F50 to Done.
  - **Original findings below (fixed or settled as noted above):**
  - **Query folding.** The client folds with NFC and JS whitespace (NBSP, U+2000–U+200A); the database
    does neither, and `lower()` follows the database collation. Text with NBSP, or precomposed
    Devanagari nukta letters, can find 0 pages in the database yet match on the page. Fold both
    sides alike, and add fixture cases for NBSP and É.
  - **The part pool.** A failed thumbnail job closes the part it shares with page renders, which can
    show the PDF error banner. `pdfPage.cleanup()` is never called, so a long single-part document
    keeps the operator lists of every page visited (memory cost not measured).
  - **Safari.** The continuous Text view relies on `overflow-anchor`, which WebKit lacks, so batches
    arriving above the view may shift the reader. Check in Safari. WebP thumbnails are stored as
    PNG there (they work, but take more space).
  - **Highlight names are global** (`pv-cite`, `pv-match`), each with its own registry. Two viewers
    mounted at once would clear each other's marks. Use a shared, counted registry.
  - **The rail tabs lack Home and End.**
  - **On apply to NTER,** `search_text` is a stored generated column, so adding it rewrites
    `document_pages` under an exclusive lock and doubles its stored text. That is fine at today's
    34 live pages, but note it for the apply.
  - **The search result is not reset** when the document's extraction changes while search is open.
- [ ] **F51.** The sources list under an answer had no styles, so it drew as default grey buttons
  plus the storage file name (owner: "it looks like windows 98"). The owner chose the compact
  list: spec `specs/2026-10-02-source-list.md`, plan `plans/2026-10-02-source-list.md`.
  - **Built and verified locally (2026-10-02):** `2d95bf6` (content) and `2b1bdde` (styles). The
    local run is in `research/2026-10-02-source-list-local-run.md`.
  - **Shipped:** production at `5b49049` (Vercel READY, operations record 2026-10-02).
    Owner acceptance is not inferred from deployment.
- [ ] **F52.** Some document titles are stored malformed. For example "The Farmers (Old Age
  Allowance Bill,2000" has an unbalanced parenthesis and no space before the year. They show as
  stored in the sources list and the reader. Needs a count over `documents.title` and a decision
  on cleaning at ingestion or at display.
  - **Also found (2026-10-02, research-coverage T1):** some records carry another document's
    title. `4618230e` ("The Airlines (Penalty for Delays) Bill,2005") and `a76358ab` ("The
    Communal Violence(Prevention,Control and Rehabilitation of Victims) Bill,2005") each hold one
    passage of an unrelated 2004 Appropriation Act. Read in the local replica, a copy of the
    legacy corpus; nothing was changed.
- [ ] **F37 note (2026-10-01):** in the R6 local run, the 25-page *Budget at a Glance* `index`
  step hit the local Edge CPU soft limit once and succeeded on retry. The F37 risk shows earlier
  than 1,000 pages on a busy machine.
- [ ] **F44.** The shared CORS allowlist's Vercel preview pattern (`_shared/cors.ts:21-36`;
  production `ALLOWED_ORIGINS` includes it) matches any `niyantran-*-ddl-labs.vercel.app` host.
  A third party could probably claim such a name.
  - **Risk:** small, because functions authenticate with bearer tokens, not cookies.
  - **Fix:** pin previews to the team scope, or drop them from production and point previews at
    a separate Supabase project.
  - Raised in the R6 security review (2026-10-01).
- [ ] **F37.** The `index` step recomposes the whole document on every
  claim. It took 547 ms of laptop CPU for 1,000 pages (I7), so a split
  document of 3,000 or more pages would pass the spec's 1.5 s threshold.
  Persist the composed pages after the first run (the spec's own fallback)
  before ingesting documents that large.

Earlier items, updated:

- [ ] **L1.** The 18,071 never-ingested `pdf_text` documents: 7,966 bills,
  6,758 parliamentary questions, 2,813 regulatory documents and others.
  The 5,327 with direct links are R7. The rest have no link and wait for
  admin upload (R8) or an API source.
- [ ] **L2.** Law tier: 874 Supreme Court and NCLT PDFs. First confirm they
  have a text layer.
- [ ] **P5.** Page-level citations. Now R3 and R6, for new documents. The
  2,338 existing documents keep unpaged citations (owner decision,
  2026-09-30).
- [ ] **P6.** Reranking and hybrid keyword search, after the corpus grows.
- [ ] **P7.** Affidavits (10,492 documents, 809 M characters; 5,093 current,
  100,151 pages). **Out of scope by owner decision (2026-09-30):** no links,
  personal data.
- [ ] **P8.** Re-crawl the 716 documents that have no `file_url`.
- [ ] **P9.** Document keys for parliamentary questions and regulators;
  desk-row "cut two" (curated views, the 41 modules with no rows) and a
  refresh pipeline.
- [ ] **P14.** Bill-key collisions (two documents on one `bill:<year>:<number>`
  key). Accept, or keep one document per key.


- [ ] **F59. First-traversal and remaining heavy-viewer stutter attribution.** F58 observed isolated 105/55/111ms long tasks and a 650.7ms frame gap whose cause was not established. If the real issue remains reproducible, collect a CPU/render trace, profile full view with thumbnails and signed-storage network timing under fixed conditions before optimizing. Warm loopback scrolling was steady; this is not production performance acceptance. [F58 evidence](../research/2026-10-03-heavy-pdf-profile.md). Safari acceptance remains F50.

## 4. Payments

- [ ] **F6.** Plan gating on the server, before real payments. Desk data is
  public (static files, and `desk_rows` is readable by any signed-in user).
  Locks, row caps and export limits run only in the browser. The spec must
  settle which data is premium, how premium desks are served (an API behind
  `my_entitlement`, or RLS), server-side exports and API row caps.
  - **Parked by the owner (2026-10-02)** until payments are integrated: "when the payment plan
    is actually integrated, we might have to make changes again."
  - **Decisions recorded for then:**
    - core desks stay persona-based and user-editable;
    - the AI assistant respects the same desk locks when it reads desk rows;
    - the desk packs stay public for now.
  - **The access map** (every path to desk data, the client-only rules, and the smallest real
    enforcement) is kept locally in `docs/security/2026-10-02-plan-gating-map.md`, which is not
    published.
  - **Noted there:** the trial row cap (25) is below the free cap (40), and prices are defined in
    both the client and the server.
- [ ] **O6.** After F6: the Razorpay keys on Vercel, then one real payment
  end to end.
- [ ] **P2.** Organisation seats, organisation billing, Razorpay
  subscriptions.
- [ ] **P3.** Metering and credits (ADR 0002); an effort column in
  `model_call_logs`.

## 5. Launch

- [ ] **D1. Supabase dashboard: what remains.** The Auth redirect URLs are
  done (see Done), and leaked-password protection was dropped by the owner
  (see accepted risks). Left:
  - confirm the Storage global upload limit is at least 50 MB. The
    `marketing` bucket allows 50 MB and Supabase's default global limit is
    50 MB, but no tool here can read the global setting. The O8 intro-video
    upload proves it either way;
  - optionally, Auth connections as a percentage.

  The tools can't change Auth or Storage settings safely: the CLI's
  `config push` would overwrite the whole remote config.
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
- **No leaked-password protection** (Supabase's HaveIBeenPwned check).
  Dropped by the owner on 2026-09-29. Most accounts sign in with Google;
  email accounts keep Supabase's password rules. Reopen before a public
  launch if email sign-ups grow.
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
