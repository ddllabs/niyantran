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
- Supabase NTER has 35 migrations and runs on the 2 GB compute (`shared_buffers` 512 MB).
- The corpus: 2,338 documents, 54,219 chunks and 34,184 desk rows. The search index is half precision, 204 MB (F22).
- Tests: 72 Vitest files (983 tests), 452 Deno tests and 15 SQL fixtures. `npm run lint`: 0 errors, 266 warnings (F25). CI is advisory.

## 1. Agent tasks (doable now, in this order)

Every task runs its focused tests, `npm run build`, and the router import
check. Changes under `src/lib/`, `src/admin/` or `supabase/` also run
`npm test` and the Deno suite, and SQL changes run `npm run test:sql`. Each
new test must fail before the change.

- [ ] **F1. Drop `user_preferences.ai_chats` and its size check (XS,
  migration).** Nothing has read it since `f05a5b6`, and its values were
  cleared on 2026-09-28. It was planned for about a week later (from
  2026-10-05); the owner may approve it sooner.
- [ ] **F13. One transient identity failure discards every retained turn (S–M,
  needs a short spec first; authentication scope).** One rejected
  `get_my_profile` makes `verifyLocalIdentity` call `identityChanged(null)`
  (`src/lib/userStore.js`). That bumps the generation and drops the retained
  replay intent of every conversation, not only the current one. It fails
  safe (nothing is spent or written), but one network blip loses recovery.
  - The spec must define which failures are authoritative (signed out,
    inactive, a different user) and which are transient (network, 5xx), and
    keep failing closed for the first group.
  - The other two recorded defects are settled:
    - the masked error now keeps its cause (Done);
    - the repeat-call return value is P17.
- [ ] **F17. Two database paths no test has run (M).** From wave 1:
  - the preferences merge-upsert through PostgREST;
  - the signed-URL video upload against real Storage.

  Both need a disposable PostgREST and Storage, or a test account on NTER
  with the owner's approval; the owner smoke test O8 covers them in part.
  (The `pg_cron` branch and the dev-server behaviour are Done.)
- [ ] **F25. Clear the lint warnings, then make `no-unused-vars` an error (S–M).**
  - `npm run lint` reported 266 warnings on 2026-09-29: unused bindings, most of
    them imports left by refactors, plus 13 `react-hooks/exhaustive-deps` notes.
  - Clear them file by file (`src/desks/DeskView.jsx` has 25), then raise the
    rule in `eslint.config.js`.
  - Treat each `exhaustive-deps` note as a possible stale-closure bug: read it
    before silencing it.
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
  - every prerequisite is done (F12 chunker, F22 half-precision index, F23 `--pdf-text` mode); only the run on the owner's laptop remains.
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
| P10 | Google sign-ups, and email signups that wait for verification, skip the plan step and get no signup trial (they can start one from the upgrade dialog). F24 wired the step for email signups that return a session. | Revisit if it matters |
| P11 | Whether `require_parameters` makes reasoning a hard routing constraint; whether a single attachment should be capped at its per-document quota | Evidence from D3 |
| P12 | Priority-2 advisor findings (grants, foreign keys, indexes); the dependency audit; the Vite manifest-import warning | Housekeeping slot |
| P14 | Bill-key collisions. Two documents that resolve to the same `bill:<year>:<number>` both keep the key, so a scoped search reads both. `build-corpus-links.mjs` drops a key only when one file name has conflicting URLs. | Decide before L1 phase B: accept it, or keep one document per key |
| P15 | Two unused extension points, kept on purpose (F16): `ai_models.params` (an admin-editable registry column, `{}` on every row, never applied to a request) and `StreamRequest.max_tokens` (a model without native effort support would need it for a thinking budget). | Wire when a model needs either |
| P16 | **The home carousel's numbers are hand-written** (`serveHomeSegments` in `server/homeApi.mjs`, about 30 figures across 8 segments; `src/lib/segmentCarousel.test.js` pins some; formerly F18):
- some are real constants (543 Lok Sabha constituencies);
- some could be computed (bills on record from `desk_rows`, about 9,817; open fronts from the war tracker);
- some look invented (128 "statements this week", 1,280 open tenders, 42 macro series, 340 CBAM rows).

For each figure: compute it, keep it as a constant, or drop it. | Owner (marketing copy) |
| P17 | `reconcileSavedTurn` answers `false` both for "still locked" and for a repeat call after it already reconciled. The supervisor plan called this a defect, but a later review test pins the `false` (`src/lib/researchChat.test.js`, "a repeat call after a successful unlock reports false, not true"), and the only caller handles it correctly. | Decide only if a caller needs to tell them apart |
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
