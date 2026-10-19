# Open work: the one list

> **Status: Living.** Created 2026-09-29 from the earlier trackers, and
> rewritten the same evening as a clean slate after the local cleanup

> session (`main` at `3a51724` and the docs commit after it). Every item is
> either Done (with its commit or its operations record), waiting on one
> named owner decision, in one of four later phases, or an accepted risk.

- [ ] **Production RAG acceptance (2026-10-19).** Implementation shipped on main
  8f72418 (clock-test prerequisite7a10c32), Vercel Production READY/exact commit,
  research-chat v68 exact36-file bundle and unauthenticated401 verified. Local
  6292 application and1158 Deno tests,lint/build/bundle/router pass. CI39258763690
  app+SQL fully green. Arc now shows vs/3304 credits and research history; owner needs
  existing conversation Reload and signed-in normal turn acceptance. Saved answer
  complete3191chars, charge880.688 retained; network closure cause unproven.
  No balance/schema/payment/corpus changes. Spec/plan2026-10-19-rag-production-recovery.



- [ ] **RAG citation/web production acceptance (2026-10-19).** Owner tests expose Lite
  zero-citation answers despite retrieved evidence; repair rejected for changing
  content; no Web calls occurred for missing-text record questions. Existing
  evidence-presence guard permits uncited completion. Generic pre-search and
  previous-subject resolution need regressions. Flash returns8 citations.
  Anti-Doping Source3 is PDF-backed; Source6 is legacy passed-version text.
  Audit:research/2026-10-19-rag-citations-web-audit.md. Owner authorized scoped
  local repair:task/rag-citation-web-recovery. Current-subject pre-search,
  verified pinned-row handles (including missing client tier), anchor-based
  content-preserving citation repair, bounded required web-only fallback and
  truthful missing-source notices implemented locally. New causal regressions;
  6293 application/1172 Deno tests,lint/build/bundle/router pass. Existing PDF
  and Text views observed in owner Arc on Anti-Doping page3/22 with highlights,
  owner-operated switching because native input failed. No viewer rebuild.
  Implementation4a1c978; owner approved push/merge to main. Plan:
  2026-10-19-rag-citation-web-recovery.md. Edge activation and real-provider
  acceptance of required web-tool call remain pending; no Supabase deployment
  in the push/merge authorization. Vercel frontend deploys automatically.



## How to use this file

- **This is the only list of open work.** Plans, specs, ADRs and
  `agents/coordination.md` may describe a task in detail, but they don't
  track it. Anything "still open", "later" or "follow-up" must appear here.
- An agent takes an unblocked item, follows `AGENTS.md`, and works on a
  `task/<id>-<slug>` branch. When it lands, the item moves to **Done** with
  its commit hash.
- A new finding gets the next free `F` number (F236 is next) and goes in the
  right section.

## Branch cleanup — active

- [ ] Consolidate non-payment branch documentation and prune merged refs while preserving all payment work. [Plan](2026-10-20-branch-cleanup.md).

## Frontend follow-up

- [ ] **F235 — Indian Sports redundant browser fallback.** Chrome shows direct Google News RSS canceled after same-origin feature-feed succeeds (200,227stories); console empty and publisher navigation works. Review unnecessary parallel fallback requests separately; no CORS failure proven by this observation. The long-open blank tab recovered on reload and was not reproduced in a fresh session; keep this limitation in browser evidence.

## Development toolchain follow-up

- [ ] **F234 — Development toolchain advisories.** Read-only npm audit on 2026-10-19 reports existing Vite/Vitest dependency advisories (2 moderate, 2 high, 2 critical; esbuild, source-map-js, @vitest/mocker, tinypool and dependents). Production dependency audit reports zero. Review compatible upgrades separately; no dependency changes in the scoped BBC/form fix.



## Current state — 2026-10-17 (milestone check)

Checked by the supervisor with `git fetch`, the branch, worktree and stash lists, CI on `main`, the
served site, a read-only probe of all 120 desk modules, and read-only SQL on NTER. Nothing was
written to production. Record: [live module status](../research/2026-10-17-live-module-status.md).

- **Git:** one branch, `main`, locally and on `origin`, at `f1ce760`; no other worktrees, no stashes.
  CI passed on the last five pushes (`05cc82d` failed on the flaky F210 test).
- **Website:** niyantran-six.vercel.app serves `index-DYC_dpIO.js` (F214).
- **Database:** 59 migrations in the repo and on NTER; the last is `20261015240000_record_brief_format`.
  1,890 MB. Corpus 3,379 documents, 99,225 chunks; `desk_rows` 136,752 (with the RBI handbook).
- **Edge Functions:** `research-chat` v63, `desk-brief` v16, `ingest-worker` v3, `ingest-documents` v21.
- **Modules (all 120 answer):**
  - 72 have a live source and all answer: 69 from the scheduled store (refreshed every 5 minutes to
    daily, 0.1–0.7 s), 2 computed from stored registers, and MLA Report Card live (it timed out once);
  - 43 are fixed data shipped with the site (bills, questions, court, geo, carbon and dossier
    packs; NSE/BSE has no live source);
  - 5 are planned and empty by design (two tender aggregators, three district modules).
- **Feed timer:** 68 of 70 store modules serving; 98% of the last 24 hours' runs succeeded. One
  source is down: Fixtures & Results — World Leagues (F215).
- **AI credits** are enforced for everyone (F111). **Checkout stays closed** until O6.
- **Owner checks:** everything listed for the owner's check on production was closed by the owner on
  2026-10-15 ("The checks that you wanted me to perform are all done … Close them.").
- **Done since 2026-10-13** (details under each item): F119–F214, including F169 module data repair
  (phases 1–4), F160 serving from the store, F171 bug programme, F196 planned modules, F201 RBI
  handbook full history and AI search, F202 module data quality, and the client's UI work F203–F214.

## Milestones: what is left, in order

Owner's updated sequence, 2026-10-17: **close M1 and the two M2 leftovers, then payment gateway
integration (M5)**. Corpus acquisition/ingestion, OCR, chunking and retrieval expansion (M4) stay
parked; source-dependent M3 work is separate and is not a prerequisite for payments. This supersedes
the 2026-10-14 ordering that put corpus R7 before payments. Milestone IDs are retained for continuity.
Each milestone ends with a checkpoint. The items below track the work; this section orders it.

**M1. Data-serving clean-up** (backend, research tests and data-configuration repair).
- F215 Fixtures & Results source; F160 leftovers (nothing-new with no items, Music Charts timer,
  World Constitutions key churn, latest-run variants over 2,000 items); F216 research answers
  asserting what the rows do not say; F210 flaky research-thread test; F202 leftover (unread stored
  searches in the data files, a data-migration task with an inventory); all F201 optional review
  items now included. F160 also includes reliable reference serving for MLA Profiles & Coverage;
  a true scorecard remains M3. Approved behavior and exact task contracts:
  [spec](../specs/2026-10-17-m1-m2-cleanup.md), [plan](2026-10-17-m1-m2-cleanup.md).
- *Checkpoint:* correct coverage, dates and empty states; no `archive` answer except NSE/BSE;
  no scheduled source above 3 consecutive failures across at least three expected refresh
  opportunities; three consecutive completed CI runs green on first attempt. Verified empty
  sources are distinguished from outages. Production closure requires separately authorized rollout.

**M2. Front-end leftovers** (after M1, on the current integrated UI).
- F208 desk catalogue out of the first-load bundle (then lower the bundle baseline); the Heads of
  State panel shows its Wikidata links (F202).
- *Checkpoint:* entry gzip and total initial JavaScript measured lower before ratcheting the
  current 224,190-byte gzip baseline; catalogue search/navigation preserved; panel checked in a
  browser. Then move to M5 payments, not corpus ingestion.

**M3. Modules waiting on sources or methods** (owner decisions first).
- MLA Report Card from a real source (ADR/MyNeta, assembly records); District Performance,
  District Governance and District Crime (NITI Aspirational Districts, NFHS-5, UDISE+, MGNREGA, an
  approved composite method, a district map); the two tender aggregators (owner's source; F196);
  then the homepage source count (F191).
- *Checkpoint:* each module live from the store with a probe; F191 shows the true count.

**M4. Corpus and retrieval** (parked by owner 2026-10-17; owner go-ahead per step; section 3).
- R5 pilot, R7 acquisition (5,327 linked PDFs), L1, L2; F170 rules 4–9 with F37 and F38; F40, P8, P9;
  then P6, F34, F42, F33.
- *Checkpoint:* the frozen retrieval eval no worse after each load; cost recorded per batch.

**M5. Payments** (next after M1/M2 closure, owner 2026-10-17; section 4).
- F107 legal pages (registered address, lawyer review); F110 a Razorpay test-mode run on a preview;
  O6 live keys, top-up packs, downgrade and renewal rules; P2 organisations later.
- *Checkpoint:* one real payment end to end, credits granted, invoice issued.

**M6. Launch** (section 5).
- D2 nter.pro cutover; O1 nter.news key; O10 Vercel plan upgrade; O11 the old Vercel project
  deleted; P11; P12 dependency majors and the RLS advisor items; P1 home feeds and O9 when the owner
  has the inputs.
- *Checkpoint:* signed-in smoke test on nter.pro.

## Active M1/M2 cleanup programme — rollout 2026-10-17

Owner approved implementation, push/deploy and closure checks; corpus ingestion remains
excluded. Main cleanup through `0e970f4` is live, three compatibility migrations applied,
research-chat v66 (F220, `256f042`) and desk-brief v17 deployed. The T0–T14 implementation entries
have moved to Done with hashes; do not infer the remaining scheduled-observation gate is closed.

[Spec](../specs/2026-10-17-m1-m2-cleanup.md) · [plan](2026-10-17-m1-m2-cleanup.md) ·
[execution/rollout evidence](../research/2026-10-17-m1-m2-cleanup-evidence.md).

- [ ] **T15 (M1/M2):** finish real scheduled source observations: three post-rollout expected
  refresh opportunities, including actual daily reference intervals. Never force extra calls
  to simulate those opportunities. Three consecutive first-attempt CI runs previously passed:
  39025298847, 39025660396 and 39026919956 (`d63192b`). Later F218 code CI passed
  on branch/main, but documentation-only run 39028606428 failed F199 (F220).
  F220 is now fixed/deployed as research-chat v66: three consecutive genuine
  post-fix CI runs 39030425827, 39030716589 and 39031190292 passed both app and SQL
  jobs on attempt 1. CI component verified complete at the 12:48 UTC observation;
  no retries, cancellations or empty commits were used. Separate local
  test interference F221 is fixed in `389dbed` (see Done). Active hourly
  read-only follow-ups on this chat, explicitly requested by the owner, notify only on a meaningful
  failure or completion. Vercel connector remains 403; the authenticated CLI works for the exact
  DDL Labs scope. Report closure before beginning payment gateway integration.
  Read-only observation 2026-10-17 12:48 UTC: fixtures and both Music Charts
  modules completed three genuine hourly opportunities (10:40, 11:40, 12:45 UTC),
  all successful; fixtures retain seven current events across all four leagues.
  Daily reference intervals remain pending: MLA next due October 18 10:45 UTC;
  Constitutions first post-rollout opportunity due October 17 15:40 UTC.
  At that observation, origin/main `2dd8ecd` was deployed READY and F222 local.
  F222 subsequently released at `e1a5557` with verified ordinary refreshes;
  separate state-landing 502s were found in its bounded log scan (F223).
  Zero sources above three failures; no new actionable failure or full closure.
  [Observation evidence](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1248-utc).
  Latest read-only observation 2026-10-17 14:48 UTC: fixtures and both charts
  remain at their fourth ordinary hourly opportunity at 13:50, all ok; next due
  just after 14:50, so no new expected opportunity was missed. Daily
  reference opportunities remain unchanged/pending; 188 constitution keys retain
  the inventory fingerprint, MLA reference remains 400 profiles + 100 coverage.
  The final three genuine release CI runs 39034204827, 39034521190 and
  39035656870 passed first attempt; READY production source matches main
  `5302dc3`. F223 subsequently received explicit implementation/release approval
  and was released at `0c1319c`; see Done and its evidence below.
  [Latest observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1448-utc).
  F223 release observation at 15:40–15:42 UTC: runtime `0c1319c` READY;
  branch/main CI 39045568101 / 39045994021 passed both jobs on attempt 1.
  Fixtures/charts fifth genuine hourly opportunity at 14:55 passed. Daily
  references remain pending (Constitutions eligible at 15:45; MLA October 18).
  No source above three failures; hourly follow-up ACTIVE.
  [Evidence](../research/2026-10-17-m1-m2-cleanup-evidence.md#f223-release-and-closure-observation--2026-10-17-1540-utc).
  Subsequent 15:46 UTC read-only observation confirms Constitutions' first real
  post-rollout daily success at 15:45 (unchanged, 188 stable keys, zero failures).
  Next daily due October 18 15:45 UTC; MLA still next due October 18 10:45 UTC.
  Both references still need further genuine daily opportunities; T15 remains open.
  Final F223 documentation head `731428f` deployed READY; both MLA summaries
  verified again 200/store with parity. Final CI 39046364866 passed app/SQL on
  attempt 1; latest three genuine F223 release runs are green. [Observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1546-utc).
  Read-only 15:49–15:51 UTC follow-up: no new daily opportunity; references
  unchanged, T15 open. Transient unrelated feed failures recorded accurately;
  only Growth Indicators retains failures (2) at 15:50, none above three.
  Serving inventory 70 modules / 257 variants; cron active every five minutes.
  Production `731428f` READY and three genuine first-attempt app/SQL CI runs
  remain green. Hourly follow-up stays ACTIVE; no action required yet.
  [Observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-17-1549-utc).
  F224 runtime `0074991` is released; its post-deploy production writer
  acceptance remains pending at Growth's next ordinary daily opportunity,
  October 18 after 15:55 UTC (normally 16:00 UTC / 21:30 IST poll). Inspect
  feed_runs/feed_state and per-series logs without forcing refresh. Live API
  failed once on unemployment, then recovered with exact stored-row parity;
  do not substitute those reads for scheduled writer acceptance.
  [F224 evidence](../research/2026-10-17-f224-growth-budget-evidence.md).
  Latest read-only follow-up 17:08 UTC: cron active every five minutes; 70 serving
  modules / 257 variants, zero failing counters. Fixtures/charts seventh real
  hourly opportunity at 17:05. Daily references unchanged (one of three each);
  Growth post-F224 writer acceptance pending tomorrow. F221 test-only fix
  landed as `389dbed`; T15 open and hourly follow-up ACTIVE.
  [F221 and closure evidence](../research/2026-10-17-f221-test-isolation-evidence.md).


  Read-only October18 11:25 UTC: MLA daily observations2/3, next eligible
  October19 10:45:19 UTC; Constitutions1/3, next eligible October18 15:45:01 UTC.
  Growth post-F224 scheduled writer acceptance pending October18 after15:55 UTC,
  normally16:00 UTC poll. All257 serving variants zero failures; */5 cron active
  with expected Vercel route. F227 separately closed by owner real-flow acceptance
  (evidence0cc7198). Earliest overall handoff remains October19 late evening IST,
  conditional on actual third reference success and final release/CI checks.
  Hourly monitor ACTIVE; no forced refresh; Razorpay held, corpus excluded.


  Read-only October18 14:07 UTC: no new blocker; MLA2/3, Constitutions1/3,
  Growth post-F224 writer acceptance still pending its15:55 daily eligibility.
  All257 serving variants zero failures; six recent cron executions succeeded.
  Constitution188-key inventory unchanged; four-league coverage remains explicit.
  Production79c0799 READY; latest three main CI runs39128803358/39131455379/
  39131793656 individually green on attempt1, both app and SQL jobs.
  [Observation](../research/2026-10-17-m1-m2-cleanup-evidence.md#scheduled-closure-observation--2026-10-18-1405-utc).
  Hourly checks continue; F231/F232 remain local/unpublished; payment held.


Current production evidence: all 120 modules HTTP 200; World Constitutions 188 stable keys,
fixtures 7 rows and failures reset, MLA reference 400 profiles + 100 coverage records serving
from storage. No source above three consecutive failures. Supabase pg_cron feed-refresh job
runs every five minutes and calls the deployed Vercel refresh route: the refresh system is active.
70 distinct modules / 257 variants serve from storage, with District Performance deliberately
planned/off. Corpus Edge Function versions/hashes and jobs were not changed.

Latest local gates: 6,126 Vitest tests, 1,155 Deno tests, 41 SQL fixtures with vacuity/rollback
checks, lint/build/router/bundle and browser checks pass. Explicitly authorized model evaluation:
4 faithful cases passed on v64; count/coverage case failed, then passed after the narrow v65
correction. Total actual cost $0.03677325, every temporary evaluator deleted. Detailed failed
batches, outputs and version distinctions are preserved; no rubric was loosened.

F218's separate Satellite landing fix is released (`0e2ebfb`) and moved to Done.
It does not close T15's real scheduled observations. The owner's earlier full
orientation list is compared item by item in the
[closure comparison](../research/2026-10-17-orientation-closure-comparison.md).

## Documentation follow-up

- [ ] **F219. Reconcile living architecture claims with current implementation.**
  The owner's orientation-list comparison on 2026-10-17 reconfirmed the architecture
  index's nine-function claim/missing feed-store path and the schema chapter's
  UUID `desk_rows` primary key, contrary to the composite migration key.
  Reconcile current claims without rewriting dated execution snapshots; consult
  rollout sections for current versions/counts. Separate documentation work,
  not an additional M1/M2 or payment prerequisite. [Comparison](../research/2026-10-17-orientation-closure-comparison.md).

## UI follow-ups

- [ ] **F107. Legal policies for payment-gateway activation.** Owner request
  2026-10-12: Privacy, Terms, Refund & Cancellation, Delivery and Contact pages
  for Niyantran Strategy Consulting Pvt Ltd (Kolkata, not GST-registered),
  matching plans Free/Plus ₹399/Pro ₹999/Max ₹9,999 priced on AI credits and
  storage, and the grievance officer. [Spec](../specs/2026-10-12-legal-policies.md).
  Drafted and verified on `task/legal-policies` (2026-10-12): six pages at
  clean paths, footer company line and links, signup notice; 2,533 Vitest /
  881 Deno tests, lint, build. Open: full registered address, the eight drafted
  assumptions in the spec, lawyer review, pricing page (F99 with F109).
- [ ] **F109. INR billing.** Code converted on `task/inr-billing`
  (2026-10-12): four monthly INR plans from `src/lib/publicPlans.js`, no GST
  (plain invoices), no trials, database values free/plus/pro/max via migration
  `20261012120000_inr_plans.sql`, applied to NTER and verified on 2026-10-12
  (owner authorized; see coordination Operations), then `main` pushed.
  Remaining for live payments: F110, F111, O6. [Spec](../specs/2026-10-12-inr-billing.md).
- [ ] **F110. In-app upgrade and checkout screen.** Shipped in `1940b02`
  (production 2026-10-13): "Plan & billing" panel in the profile
  menu (current plan, Plus/Pro/Max in rupees, renew or upgrade only, invoices,
  renewal reminder), pricing hand-off for signed-in users, and a server switch
  `BILLING_CHECKOUT_OPEN` that keeps checkout closed until credits (F111).
  [Spec](../specs/2026-10-12-upgrade-screen.md). Owner checked the panel on
  production 2026-10-13. Remaining: a Razorpay test-mode run on a preview with test keys, then open checkout after
  F111.
- [x] **F115. Duplicate and misattributed corpus documents.** Found
  2026-10-13 from the owner's anti-doping question. It returned three
  citations to `bill:2025:77`: the admin-uploaded PDF (`89b71893…`, page
  pipeline), the same "As introduced" PDF ingested again as text on 2026-10-09
  (`510cd60e…`, 98 chunks), and the "As passed Lok Sabha" version
  (`965211c8…`, legitimate).

  Read-only corpus counts (3,434 documents, 100,031 chunks):
  - The PDF-plus-text twin affects only this bill (only two documents have a
    stored PDF): 1 extra document, 98 chunks.
  - Byte-identical text in 41 groups (95 documents, 54 extra):
    - 21 groups of TRAI uploads stored three times under file-name variants
      (`_VF`, `_0`, `_1`): 32 extra documents, 492 extra chunks;
    - 3 groups where one bill's synopsis and gazette files are identical:
      3 extra documents, 55 chunks;
    - 17 groups where one text is attached to different bills (for example
      `bill:2003:41` and `bill:2012:106`): 19 extra documents, 161 chunks.
      These are likely wrong-file mappings, not copies.
  - In total about 55 surplus documents and about 806 surplus chunks (0.8%).
  - Passage-level repeats across bills (2,035 passages) are mostly standard
    clauses (rule-making powers, delegated-legislation memoranda, Finance Act
    rules). They are expected, not duplicates.

  Cleanup deletes corpus rows, so it needs an approved data-migration task
  with an exact inventory. The misattributed bills need their correct
  documents identified first.
  - **Anti-doping duplicate removed, 2026-10-13** (owner approved): `510cd60e…`
    and its 98 chunks were deleted after a local backup. No bill now has two
    documents of the same version.
    [Record](../research/2026-10-13-duplicate-document-delete.md).
    Remaining: the TRAI repeats and the text shared across different bills.
  - **Repeats and misattributed bill files removed, 2026-10-13** (owner
    approved the exact list): 51 documents and 670 chunks, each identical to
    a kept document; 32 TRAI/CCI repeats and 19 bill files whose text names
    a different Act or version. Corpus: 3,382 documents, 99,263 chunks.
    [Record](../research/2026-10-13-f115-cleanup.md).
  - **The three review pairs were resolved, 2026-10-13**, from the text and
    bill records; the wrong copies were deleted (amendment 1 of the record).
    No identical-text documents remain. Corpus: 3,379 documents, 99,225
    chunks.
- [x] **F117. Versions for the original bill corpus.** 1,622 bill documents
  loaded between 2026-09-21 and 2026-10-01 record no `document_role`, so they
  show no version label and the model does not see their version.
  - Their sansad.in URL folder names the kind:
    - As introduced: 838
    - Notification: 287
    - Synopsis: 467 (not a current role)
    - Errata: 13
    - Passed Lok Sabha: 8
    - Passed both Houses: 7
    - Hindi: 2
  - **Done for five folders, 2026-10-13** (owner approved the URL-folder
    approach): 1,153 documents gained `document_role`, with a
    `document_role_source` marker.
    [Record](../research/2026-10-13-document-role-folder-backfill.md).
  - **Synopsis role done, 2026-10-13** (owner approved): 456 synopsis
    documents tagged; label maps and grounding prompt updated;
    `research-chat` v50. Only 2 Hindi errata files remain unversioned.
  - The 24-document old-key backfill is done:
    [record](../research/2026-10-13-document-role-backfill.md).
- [x] **F119. Sector picture cards select instead of opening.** Owner
  2026-10-13: a card selects its sector, with a visible switch and a scroll
  into view on phones; the module cards open the terminal. Built on
  `task/sector-card-select`, merged `8441097`, pushed 2026-10-13.
  [Spec](../specs/2026-10-13-sector-cards-select.md). Remaining: owner check
  on production.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F120. One header on every page.** Owner 2026-10-13: All sections
  and refresh on every page (landing refresh reloads its summaries); the
  search box shows a short label below 1,110px instead of truncating. Built on
  `task/consistent-header` and merged locally.
  [Spec](../specs/2026-10-13-consistent-header.md). Pushed in `cec56ee` and
  live on production. Remaining: owner check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F121. Global record panels.** Owner request 2026-10-13: every Global
  record opens one consistent panel modelled on the owner's reference (header,
  01 at a glance, 02 about, 03 what it touches, a footer with Ask AI and
  provenance). Owner decisions: staged rollout; re-skin the Alliances,
  Sanctions, Aid and Nuclear dossiers; add a Record tab for Heads of State and
  Commodities; rule-based links and no impact page.
  [Research](../research/2026-10-13-global-record-panels.md) ·
  [Spec](../specs/2026-10-13-global-record-panels.md) ·
  [Plan](2026-10-13-global-record-panels.md).
  - Batch 1: the kit, Open Fronts, Global Intelligence and Infra (the
    supervisor, sequential).
  - Batch 2: seven modules (parallel sub-agents).
  - Batch 3: the four dossiers (parallel sub-agents).
  - Status: batch 1 merged to `main` at `a62c2bb` and pushed on 2026-10-13,
    after an independent re-review. Batch 2 (seven modules, the value board,
    country centres, and Record tabs for Heads of State and Global
    Commodities) passed an independent review and re-check and was merged to
    `main` locally at `931538c` and pushed at `3978309`. Batch 3 (Alliances,
    Sanctions, Global Aid, Nuclear Watch on the new panel; old dossier record
    views retired) passed an independent review and was merged to `main`
    locally at `067f09b` and pushed at `a3d79d7` on 2026-10-13. Still open
    after F121: the cached AI brief (F123) and the follow-ups in F122.
    Maritime Choke-Points and Energy stay as they are: the reference has no
    panel for them (owner, 2026-10-13).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F124. National record panels.** Owner request 2026-10-13: the same
  record-panel makeover as Global (F121) for the eight National modules the
  client reference covers. The reference is a mockup: its layout and kind of
  information count, its figures do not.
  [Research](../research/2026-10-13-national-record-panels.md) ·
  [Spec](../specs/2026-10-13-national-record-panels.md) ·
  [Plan](2026-10-13-national-record-panels.md).
  - Owner decisions 2026-10-13: saved AI briefs only (no model call on
    selection); one batch; the Cabinet filter and the MP house fix as separate
    tasks (F125, F126).
  - Status: all eight panels built (N1–N9), independently reviewed (one
    must-fix, fixed), merged at `51a707f` and pushed on 2026-10-13. F125 and
    F126 followed (pushed at `abfb912`).
  - Backend gaps the reference points to (not in F124's scope):
    - Cabinet Decisions serves the unfiltered PIB feed;
    - the MP register has no house column, mixes Lok Sabha and Rajya Sabha
      under an "18th Lok Sabha" label, and has inconsistent party names;
    - affidavit criminal cases are a single count, not individual listings
      (owner asked for a fix; blocked: it needs a richer source, and MyNeta/ADR
      restrict redistribution);
    - questions hold no answer text;
    - the stored bill `probability_score` and `summary` are empty;
    - Pipeline sources are `news.google.com` links;
    - status labels in `src/lib/apiStatus.js` call embedded packs "live".
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them." The six backend gaps listed above stay recorded here for the corpus work.*
- [x] **F125. Cabinet Decisions: only Cabinet decisions.** Owner 2026-10-13.
  [Spec](../specs/2026-10-13-cabinet-filter-mp-house.md).
  - **Marker:** PIB names each release's issuing body on its release page; the
    stored CCEA decision reads "Cabinet Committee on Economic Affairs (CCEA)".
  - **Server:** reads that field for every PIB release it already opens, and
    keeps only the Cabinet and its committees (`isCabinetBody`,
    `src/lib/parliament.js`; never the Cabinet Secretariat).
  - **Fallback:** when the live window has none, it shows the stored Cabinet
    decisions and says so. On 2026-10-13 none of the 18 latest releases was a
    Cabinet decision.
  - **Client and panel:** the client keeps the body's name as written
    ("(CCEA)", not "(Ccea)"), and the panel reads the body as its marker.
  - **Verification:** a server test with PIB stubbed fails on the old code.
    Merged and pushed at `abfb912` on 2026-10-13.
- [x] **F126. MP register: house and party names.** Owner 2026-10-13.
  - **House:** each row's `house` comes from its own `sansad.in` link (540
    Lok Sabha, 242 Rajya Sabha).
  - **Party:** `party` is unified to the Lok Sabha abbreviation only where the
    full name certainly means that party, with the original kept in
    `party_raw`. "Shiv Sena", "Nationalist Congress Party" and
    "Independent & Others" are left as held.
  - **Shaping:** done in `prepareDeskFeed`, so the live and stored paths agree.
  - **Labels and panel:** the labels now say both houses, and the panel shows
    "Listed as" where the name differs.
  - Merged and pushed at `abfb912` on 2026-10-13.
- [x] **F128. Law record panels.** Owner request 2026-10-13 ("go ahead with
  Law now, same process").
  - All twelve Law modules get the record panel in the Law reference's form:
    four tile questions with the clock last, a "what a lawyer needs" board,
    Quick exit handing off to AI Research, and a health strip.
  - Two source fields are kept: the IBBI claims deadline and the Google News
    publisher.
  - [Spec](../specs/2026-10-13-law-record-panels.md),
    [plan](2026-10-13-law-record-panels.md),
    [research](../research/2026-10-13-law-record-panels.md). Branch
    `task/law-record-panels`.
  - Done: twelve panels, Fable review (one must-fix, fixed), merged locally on
    2026-10-13 and pushed at `5806d13`.
  - Follow-up fixed 2026-10-13: module headings and menus no longer
    title-case abbreviations ("Nclt" → "NCLT", "Icc" → "ICC", and about 30
    labels on other desks, such as "GDP, CPI, PMI", "CBAM", "OTT").
    `featureMenuLabel` keeps a word written with inner capitals unless the
    whole label is in capitals; `src/lib/national.test.js`.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F129. ICJ and WTO registers from the stored packs.** Found in the F128
  research (2026-10-13).
  - Owner 2026-10-13: ICJ stays as it is ("keep what we have"); WTO approved
    for collection.
  - WTO built on `task/wto-register`
    ([spec](../specs/2026-10-13-wto-register.md)): the WTO's own register
    (646 disputes) collected from wto.org's data files, a register panel, and a
    Fable review with all findings fixed (several current stages, third-party
    naming by the WTO's exception lists, parser hardening, the news-fallback
    table, two guards made falsifiable).
  - The WTO's terms of use for wto.org could not be read; the owner chose
    to publish on 2026-10-13 ("merge and push the WTO register"), with the
    WTO credited on every row and panel. Confirming the terms with the WTO
    (enquiries@wto.org) remains advisable.
  - ICJ is unchanged by the owner's choice, so F129 stays open only for a
    possible ICJ register later.
  - Planned: [record follow-ups plan](2026-10-13-record-followups-plan.md) (2026-10-13).
  - `backup/` holds 177 ICJ General List cases and 641 WTO DS case pages.
    Either would turn a wire module into a register.
  - `backup/` is probably not deployed, so this is a data task that needs
    approval.
  - The Sector Tribunals pack holds a PAN in at least one title; check it for
    personal data before any use.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them." WTO register checked; the ICJ register was dropped by the owner ("keep what we have").*
- [x] **F122. Global desk data honesty follow-ups.** Found by the F121 batch 2
  agents (2026-10-13); outside F121's scope.
  - Planned: [record follow-ups plan](2026-10-13-record-followups-plan.md) (2026-10-13).
  - G1 done `bed03ba` and G2 done `e0c3e8d` (2026-10-13): the Commodities
    search, "$2.5B", whole-token sanctions issuers, one Ukraine leader row;
    illustrative commodity levels, register-only leader profiles with outside
    sites "for checking", office names not verified, no JSON launch link,
    alliance fallbacks "Not stated". The desk catalogue's Heads of State count
    is now 43 (`supabase/functions/_shared/deskCatalog.json`; reaches the Edge
    Functions on their next deploy).
  - G3 done `9dffe65` (2026-10-13; owner approved the deletions): Cook
    Islands, French Polynesia, New Caledonia, Niue and Montserrat placed on the
    maps (Pacific Islands Forum 18 of 18, CARICOM 15 of 15); EU, AU and SADR
    stay unplaced, as non-places. Removed: `AssetAnalytics.jsx`, the
    `.geo-holistic` rules, the dossier-only heat/legend helpers in
    `alliances.js`, `sanctions.js`, `globalAid.js` and `strategicAssets.js`,
    and `fillSiteLabel` (`operatorCountries` stays: `statsFor` uses it).
    F122 is complete.
  - Global Commodities desk: a KPI tile says "Live · API-ready" and the sources
    list names Trading Economics and CME, but the levels are illustrative pack
    values (`src/desks/CommoditiesDesk.jsx`; feed `links` in
    `server/featureFeed.mjs` near the Global Commodities branch; the pack note
    in `src/data/commodities.json`). The record panel already says illustrative.
  - Global Commodities desk: the search box does not filter, because
    `groupsFrom` returns `feed.meta.groups` whenever the feed has them
    (`src/desks/CommoditiesDesk.jsx`).
  - Heads of State pack: row `ua2` duplicates `ua` ("Ukraine (see
    Zelensky)"), and several names are offices that `flattenLeader` does not
    flag as unverified ("UK Prime Minister", "German Chancellor", "Japan PM",
    "Poland (govt)", "Taliban (IEA)", "Qatar (Emir)") (`src/data/leaders.json`,
    `src/lib/globalResources.js`).
  - The Heads of State feed lists Wikidata and the CIA World Factbook as links,
    though its rows come from the embedded pack (`server/featureFeed.mjs`).
  - The `.geo-holistic` workspace rules in `src/index.css` no longer apply to
    any desk since F121 T15 and can be removed.
  - Satellite Infrastructure: a launch's "Source" link is the Launch Library
    JSON endpoint, not a readable page (`flattenLaunch` in
    `server/assetsApi.mjs`).
  - Global Aid: `money()` in `src/lib/globalAid.js` prints "$2.50B" (the
    trailing zero is not trimmed).
  - Alliances: `bindingType` falls back to "Political declaration" and
    `defaultStanding` to "Full member"/"Participant", asserting more than the
    rows hold (`src/lib/alliances.js`); the record panel ignores the fallbacks.
  - Sanctions: `issuerTokens` matches by substring, so "AUS" yields both the US
    and Australia (`src/lib/sanctions.js`).
  - Map coverage: territories on alliance rosters (Cook Islands, French
    Polynesia, New Caledonia, Niue, Montserrat) and non-states (EU, AU,
    Sahrawi Arab Democratic Republic) have no position in
    `src/shell/record/countryCentres.js`, so they are left off the maps.
  - Dead code: `src/desks/AssetAnalytics.jsx` has no importer; helpers in
    `src/lib/alliances.js`, `sanctions.js`, `globalAid.js` and
    `strategicAssets.js` used only by the retired dossier record views may
    now be unused; `fillSiteLabel` in `src/lib/geoTip.js` is now called only
    by its test, and its comment and the F28 note below still name the
    deleted `NuclearSiteMap.jsx`.
- [x] **F123. AI brief in the Global record panels.** Owner 2026-10-13: the
  old brief box was largely a dummy (its base text was a template filled from
  the row, labelled "AI analyst brief"); keep a box there for now and revisit
  it properly with AI credits (F111).
  - Interim, built 2026-10-13: every record panel has a "✦ Niyantran analysis"
    card in 02 · About. It shows a brief saved earlier from AI Research
    (`useEntryBrief`, cache read only, no generation) or says that none is saved.
    No template text is shown as AI.
  - Remaining, with F111: whether selecting a record should generate a brief,
    what it costs in credits, and how it is labelled.
  *Done 2026-10-15 (owner: "create that AI brief automatically and store it … the credit cost can be borne by us"): `6cf8f35`, `c408f46`, `26dbf4d`; migration 57 `20261015220000_record_briefs`; desk-brief v10; `app_flags.record_briefs` on. Opening a record panel (adapter panels, `RecordDetail`, National generic records) asks `desk-brief` scope `record`; the first viewer's request writes the brief at the platform's cost (Claude Haiku 5.5, `RECORD_BRIEF_MODEL` to change), every later viewer reads it; regenerated only when the record changes, at most once per 24 h; 10 a minute and 200 a day per user, 5,000 a day in all; failures back off and stop after 5. Browser-supplied rows (not in `desk_rows`) get content-addressed briefs only (two security reviews; the second found a field-hiding gap, fixed in `c408f46`). [Measurement](../research/2026-10-15-record-brief-measurement.md): 20/20 correct on Haiku, about $0.16 per 1,000. Production: two briefs written ($0.000188 each), served again from the store; a re-announced account briefly hid a stored brief, fixed in `26dbf4d` with a retried account check. Open: `RecordDetail`'s separate source-document brief sits next to the record brief (product choice); Morning Brief's module is not in the catalogue; `BillRecordPane` is unreachable and could be removed.*
- [x] **F130. Web search in AI Research.** Owner request 2026-10-13: web
  context for records without indexed documents, site-wide, through
  OpenRouter's server web-search tool (Exa), as in TenderBase. Owner
  decisions: automatic per record or module without an indexed document; the
  composer globe overrides both ways and is stored per conversation; at most
  three searches per turn; web sources labelled unofficial, shown as a "From
  the web" row and a side-panel list, with a plain globe and the domain;
  searches and cost recorded for F111.
  [Research](../research/2026-10-13-web-search.md) ·
  [Spec](../specs/2026-10-13-web-search.md). Branch `task/web-search`
  (worktree `.claude/worktrees/web-search`).
  - **Status, 2026-10-13: shipped.** Migration `20261013140000` applied to
    NTER, `research-chat` v51 deployed, `origin/main` at `3d937af` (see
    coordination Operations). Remaining: the owner's check on production,
    and the follow-ups below.
    - Research and probes; spec with amendments 1–2.
      [Plan](2026-10-13-web-search.md),
      [local run](../research/2026-10-13-web-search-local-run.md).
    - Sub-agents built the fixtures, the agent loop, the policy and the UI,
      and ran the security pass and an independent review.
    - Checks: 993 Deno and 3,166 Vitest tests, lint, the build and all SQL
      fixtures pass; the migration's Down block was executed.
    - Spend: $0.31 of an approved $1.00.
  - **Owner decision, 2026-10-13:** no per-user search cap. The per-turn
    limit of three stays, and every search is logged with its cost.
  - The privacy policy names OpenRouter's web search, run by Exa, and what
    it receives (updated 13 October 2026; the F107 lawyer review still
    applies).
  - The globe's prediction now counts exactly the records the next send
    carries (`webPredictionRecords`), so it agrees with the server in the two
    cases spec amendment 2 listed. No follow-ups remain.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F131. Web search: one stream, live sources and site icons.** Owner
  report 2026-10-13: on a web turn the answer streams, vanishes and streams
  again, and the sources appear only at the end. Cause: a research call that
  searched is never the answer, so its live draft is always taken back and
  rewritten. Owner decisions: stay on OpenRouter (search terms are not
  exposed, Probe 3); real site icons through our server via DuckDuckGo; four
  icons, then "+N". Probe 3 also found the reported search count can exceed
  `max_uses` by one (billed correctly), so F130 logs overstate.
  [Spec](../specs/2026-10-13-web-search-streaming.md). Branch
  `task/web-search`.
  - **Status, 2026-10-13: shipped.** `research-chat` v52 is deployed and
    `origin/main` is pushed (see coordination Operations). Remaining: the
    owner's check on production.
    - The owner approved the spec with both recommendations: hold drafts on
      web turns only, and add the privacy half-sentence. Production logs
      showed that all three retractions in 24 hours were on web turns.
    - Checks: 3,663 Vitest and 1,012 Deno tests, lint, the build and the
      router check.
    - The local run streamed each answer once, with the strip filling live
      and real icons ([spec](../specs/2026-10-13-web-search-streaming.md),
      "Build and local run").
    - Spend: $0.57 of $1.00 in total.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F133. Desk tabs: the separator back and less space.** Owner request 2026-10-13. The line
  between the search row and the desk tabs was lost in `38fae22`, and F112 made the tab row 58 px.
  The tabs are now their own row at every width under a full-width line, in a 42 px row; the
  current desk's highlight fills the row from line to line (owner's choices). Header at 1440 px: 107 px (was 119). On `task/ui-polish`;
  [spec](../specs/2026-10-13-ui-polish.md). Remaining: review, merge, push, owner check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F134. Header search results drag into AI research.** Owner request 2026-10-13. Catalogue and
  Records results now carry the shared drag payload (a record carries its row); a drag opens AI
  research and the search window steps aside. On `task/ui-polish`. Remaining: a real mouse drag in
  the browser (the drop could not be simulated), review, merge, push.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F135. The side panel closes on a click outside or Escape on every page.** Owner request
  2026-10-13. Only AI had an outside-click close; Desk and Record now collapse to the slim bar on a
  click outside or Escape (owner's choice), and picking the selected row again reopens its record.
  On `task/ui-polish`. Remaining: review, merge, push, owner check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F140. Homepage header, hero, globe and "Curated for" strip to the client's design.** Owner
  request 2026-10-13 (client review of `NTER-Homepage-Final.html` and `globe-animation/`). The
  design's look, our data and links: white header kept sticky at 72 px with "Data coverage", Sign in
  beside "Get started ↗" and "BY NTER.PRO"; the design's hero (no mouse-follow); the orbiting globe
  with seven data labels that pass behind Earth, each opening its desk or module (signed out: sign in
  first); figures 9,817 bills, 120 modules and 246 source endpoints (counted from the source registry);
  the six personas in a strip. Measured against the design: identical positions at 1440 px apart from
  the shorter header. On `task/home-hero`; [spec](../specs/2026-10-14-home-hero-redesign.md).
  Reviewed (fixes: a new account now keeps a destination chosen before sign-up, as sign-in already
  did; the signed-in label path uses the hash, as Pricing). Owner kept "246 · Source endpoints" (of
  the 246, 189 are per-module search URLs on GDELT and Google News; 31 distinct hosts). Remaining:
  push, owner and client check. Not done, low priority: "Data coverage" from another page scrolls
  after an 80 ms timer; inherited from the client's globe, its focus listeners are re-added on
  reconnect and a partly hidden rear label stays clickable through Earth. The homepage's sideways
  scroll at 375 px is fixed on `task/mobile-overflow` (the trivia band, see the Done entry below);
  its 47 px overhang on desktop is left as it is.
  *Done 2026-10-15 (`bba5434`): owner checked on production; the three small defects fixed: the "Data coverage" scroll waits for the home page instead of an 80 ms timer, the globe's focus listeners are added once and removed on disconnect, and a disc over Earth stops clicks on the hidden part of rear labels (checked in a browser: front labels and the visible edge of a rear label still click). Rear labels stay keyboard-focusable on purpose (a focused label comes to the front).*
- [x] **F141. One globe across the marketing site.** Owner request 2026-10-14: the client's globe
  (F140) replaces the old `AuthEarth` on sign-in, sign-up and pricing (globe only; page styling
  stays), behind one shared wrapper; then the old globe is retired.
  [Spec](../specs/2026-10-14-one-globe.md). Built on `task/one-globe`: `DataGlobe.jsx` on all four
  pages; the Earth keeps the old size at 1440 px (sign-in 490 px, sign-up 331 px), is 179 px where
  sign-in and sign-up sit beside a narrow 280 px box (was 280 px) and 256 px on pricing (was 400 px),
  so labels never cross the form, heading or copy and nothing leaves the screen (checked over a full
  orbit at 1440, 1024, 939, 858 and 375 px). Old globe retired (6 files, 79 CSS rules). Reviewed:
  a pause button on every globe (WCAG 2.2.2, as the old globe had), the mount wiring tested, the old
  globe's docs marked historical. Left for later: the `three` package has no importer now (it was the
  old globe's renderer); removing it is a dependency change. Remaining: merge, push.
  *Done 2026-10-15 (`9bb01f9`): owner checked on production; the unused `three` dependency removed.*
- [x] **F142. Live, database-backed figures on the marketing site.** Owner request 2026-10-14: today
  9,817 bills and 3,431 documents are typed constants, and the carousel counts come from snapshot
  files, so new records never show. One `site_figures()` database function (service role) behind a
  cached public `/api/site-figures`, with the measured constants as the fallback; the hero, KPIs,
  ribbon, pricing and carousel read it. [Spec](../specs/2026-10-14-live-site-figures.md). Owner
  2026-10-14: migration approved; bills stay one per bill ID. Built on `task/live-figures`: the
  function and its SQL fixture (27 fixtures pass; vacuity and 7 mutations caught), the endpoint
  (15-minute cache, last good then measured fallback, CDN header per source), the carousel and the
  pages (the homepage's hand-typed "48 MINISTRIES" now reads the count; the ribbon's and the
  walkthrough's "200+ authoritative sources" now read the endpoint count). Reviewed (5 s database
  timeout, a minute of failure memory, client refresh). Migration 46 applied to NTER 2026-10-14; live
  counts equal direct counts (bills 9,817, documents 3,376, ministries 56, fronts 88); see coordination
  Operations. Remaining: merge, push. Still hand-typed on the homepage (F30): the preview cards'
  other figures (houses, series start, status bars and the other desks' samples).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F143. Desk landing counters restart on load.** Owner bug report 2026-10-14: the counters ran
  at high speed from 0 two or three times on load, sometimes kept doing it, sometimes loaded fine.
  Cause (code read): every summary arriving (up to 16 per landing, 45 s timeouts) restarted every
  counter from 0, through a key built from the raw summaries; a retry could leave "NaN". Fixed on
  `task/landing-counters`: each number counts once from the value it shows to its target, unchanged
  numbers do not move, the key follows the numbers on screen, a cleared value is left to React.
  Unit-tested (each guard fails without its code). Remaining: a browser check with the pane visible
  (a hidden pane pauses motion), merge, push.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F144. Homepage desk preview: only real figures.** Owner 2026-10-14: fix the figures our data
  backs under their current labels; list the rest for the client. Fixed on `task/preview-figures`:
  bill houses, series start and the four stage bars (real counts, checked against NTER), MP states
  covered (36), macro series (7) and publishers (2), fronts (88) and theatres (17), and the false
  "probability scores" note; generated from the snapshot files with a recount test. Waiting on the
  client: 15 items in [the client document](../research/2026-10-14-homepage-preview-for-client.md)
  (retitling Media, Ops and Economy to real datasets; the bars, rows and tiles with no data).
  Remaining: merge, push, then the client's answers.
  *Closed 2026-10-15: the owner says the client has given everything needed; the preview shows only figures the data supports (Part A of `research/2026-10-14-homepage-preview-for-client.md`).*
- [x] **F145. Globe handover and page speed.** Owner request 2026-10-14, from the client: a globe on
  a black background flashes before the real globe on every page change, and pages feel slow. Causes
  (measured on a production build): the globe's stand-in image is a photo of Earth on black space
  (inherited from the client's package), and each page rebuilds the globe from scratch; the homepage
  loads a 34 MB GIF as the walkthrough backdrop (since 2026-09-21), the whole terminal script
  (2.6 MB) for signed-out visitors, and 2.3 MB of Earth images; nothing is cached by browsers.
  [Spec](../specs/2026-10-14-globe-handover-and-page-speed.md). Owner 2026-10-14: GIF becomes a still,
  caching rule approved, unused files removed. Built on `task/page-speed` (T1–T5): a transparent still
  of our globe and shared textures and time across pages (no flash; later globes draw at once); the
  GIF is an 11 KB lazy still; the terminal, admin and chooser load on demand (entry 723 → 220 KB gzip,
  CSS byte-identical); WebP textures (2.28 → 0.52 MB), a 4 KB logo; `vercel.json` caching. A first
  homepage visit is about 0.94 MB over the wire, against about 40 MB. Reviewed (fixes: a late
  lost-context event, a reload screen for a failed download after a deploy, the terminal loading at
  start-up for a signed-in visitor, the Earth clock, a stylesheet guard in `check:bundle`). Merged
  (`3daa484`) and pushed (`5503287`, owner 2026-10-14); CI passed on both jobs.
  - **Live check, 2026-10-14:** build files are cached a year as immutable, brand images a day, and
    pages still revalidate. The signed-in terminal loads its on-demand chunks with no error screen.
  - **Finding: a missing `/assets/` file also gets the one-year header**, because Vercel applies
    headers to 404s. A browser that hit a missing build file would keep that 404 for a year (it
    matters only for a rollback to the deployment that has the file). Owner 2026-10-14: the rule is
    narrowed to top-level build files (`/assets/([^/]+)`). Checked live after `d6c8849`:
    - a build file keeps the year;
    - a subfolder 404 (`/assets/uploads/…`) gets `max-age=0`;
    - brand images keep the day.
  - Remaining: owner and client check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F146. Withdrawn, not a defect (2026-10-14).** Reported during the F145 live check as broken
  news images under our `/assets/uploads/`. That was a measurement error by the supervisor: the
  filter matched `/assets/` on any host. The images are absolute `https://nter.news/assets/uploads/…`
  URLs in the snapshot, the API and the page (`server/nterNews.mjs` makes ingested paths absolute),
  and they load from nter.news (200). Nothing under `public/data` needs changing.
- [x] **F214. Homepage globe 5% larger; the brief animation every time.** Done 2026-10-17 (`27d4bbf`,
  `30ebebb`, `157d689`; owner: "push merge clean"). CI passed on the first attempt (both jobs); Vercel
  production READY on `157d689`. Live: the hero globe scene at scale 1.05 (683 -> 717 px at the pane's
  width); the served terminal chunk carries the new brief card (reading fallback, no plain skeleton).
  A signed-in record check on production is still to do. Owner 2026-10-16, UI only.
  The hero globe scene, labels included, scaled 5% from 701 px up (phones keep their size: the globe
  already spans the screen and 5% more pushed its labels past the edge). The brief card plays the
  client's animation for 2.5 s with every record it opens, stored, new or seen this session, and
  restarts it on a record switch; fetching is unchanged. Spec: `docs/specs/2026-10-16-globe-and-brief-animation.md`.
- [x] **F213. The persona column's smallest text, a step larger.** Done 2026-10-16 (`8bb0ca9`; owner:
  "Push everything, deploy everything"). CI passed on the first attempt (run 38829697824, both jobs);
  Vercel production READY on `8bb0ca9`. Live check on the deployment: the persona column with subtitles
  and hint at 10 px, the seven coverage figures, the hover popover, no sideways scroll; the production
  domain serves the same entry bundle. Card subtitles and the hint 8.5/8 px → 10 px (10.5 px on phones),
  the popover kicker 7 → 9 px, the column's overline and line and the coverage box heading one step up;
  colours unchanged.
- [x] **F212. Homepage hero: persona column and coverage box from the client reference.** Done 2026-10-16
  (`813f061`, owner: "Push, merge, and tidy up"). Live: production serves the `05cc82d` build, whose entry
  bundle holds the persona column, the reference's wording and the coverage box. The "Curated for" strip
  became the hero's third column: six cards with the reference's names and subtitles; hovering or
  focusing a card previews a popover with the reference's text, a click keeps it open, and "Explore this
  perspective" opens that persona in the personas section (keyboard reachable after the review fixes).
  The three figures under the copy became a seven-figure coverage box, every figure from our own sources
  (desks: 8, as on pricing), with no date line. Header, copy, globe and lower sections unchanged; the
  reference's Replay button and auto-preview left out. Raised, not changed: the reference's 8 px hint and
  8.5 px light-grey subtitles are below 4.5:1 contrast (owner's call). Spec:
  `docs/specs/2026-10-16-hero-persona-column.md`.
- [x] **F211. The client's record animation plays while a brief is written.** Done 2026-10-16 (`14e323f`;
  owner: "push"). Live check: a bill with no stored brief showed the skeleton, then the animation, then
  its brief at 4.7 s. Owner 2026-10-16. The
  "NTER-Record-Animation-Final" web component (copied unchanged to `public/animation`) mounts in the
  brief card only in F209's `writing` state, loaded on first use, scaled to the card; a quick write
  waits for its 2.5 s; stored briefs and revisits are unchanged. Spec:
  `docs/specs/2026-10-16-record-brief-animation.md`.
- [x] **F209. The record brief shows "writing" only while it is written.** Done 2026-10-16 (`078100c`;
  desk-brief deployed first, then Vercel; CI green). Owner 2026-10-16 ("go"),
  before the client's new writing animation. Measured: stored reads took 1.1-2.5 s and showed the
  writing look; nothing was regenerated (50 briefs before and after). `desk-brief` gains a read mode
  (`peekDecision` mirrors `record_brief_claim`, no claim, no model call); the panel reads first and
  writes only on `missing`; briefs seen this session show at once; the account check is reused. Spec:
  `docs/specs/2026-10-16-record-brief-read.md`. Live check: stored briefs show the skeleton only
  and land in 0.5-0.75 s (were 1.1-2.5 s with the writing look); a record with no current brief read
  'missing' in 450 ms, then showed the writing look for its 3.2 s write; a revisit shows in 98 ms with
  no request.
- [x] **F207. Cleanup after F203-F206.** Done 2026-10-16 (`d7b0b02`, `59e54ed`; owner: "merge everything to
  main, and deploy"). Owner 2026-10-16 ("clean up the small gaps"). The record
  adapters no longer compute the graph's `lanes`/`nodes` (27 adapters, 24 test files, 867 lines out;
  node checks moved to links and About rows where they had a match); footer notes no longer promise
  companies or sectors the panels do not show; questions and the pipeline no longer fetch the
  ontology. The bundle baseline is re-recorded at 222,125 B gzip: the growth was bisected to F202's
  column definitions and F196's modules, which the desk catalogue puts in the entry. Also (owner,
  2026-10-16): the All sections cards lose their ↗ arrow, and Home shows the Niyantran Terminal logo.
  On `task/cleanup`.
- [x] **F204. Record panels draw no relations graph.** Done 2026-10-16 (`e2a9613`; owner: "push and
  merge"). Owner 2026-10-16 ("not genuine … remove that
  wherever it comes"). The four-lane graph is gone from all 26 record types; their related register
  rows stay as "Related on record". The unread `lanes`/`nodes` left the adapters in F207.
  Spec: `docs/specs/2026-10-16-record-panel-and-chat.md`. On `task/module-scroll`.
- [x] **F205. The AI brief card tells reading from writing.** Done 2026-10-16 (`9ef80e5`, `56ee533`). Owner 2026-10-16. A stored brief shows a
  plain skeleton; one being written (server 'pending', or slower than 1.2 s) shows the Niyantran mark
  with a shimmer. Same spec and branch.
- [x] **F206. AI opens on a new chat by default.** Done 2026-10-16 (`e1aad94`, `56ee533`). Owner 2026-10-16. After a desk, module or record
  change, opening AI starts a new local chat; a history pick, the credits page, a running answer and
  an untouched new chat are kept. Same spec and branch.
- [x] **F203. Module pages that cannot scroll, are cut off, or lose their menu.** Done 2026-10-16
  (`d53c029`, `4e0e1f5`, `8e6a0a4`). Owner request
  2026-10-16 (UI only). Measured on all 120 desk modules: the 101 on the shared table were fine; of the
  19 hand-built pages, 7 lost their bottom 36 px (`.nat-panel` content-box padding), MP Profiles and
  Centre-sanctioned Projects could not scroll (`.alliances-wrap` grew past a clipped area), a focused
  card could push a page's top out of reach (`.main-col` hidden, not clipped), and Alliances, Sanctions
  and Global Aid were cut on the right beside the map. Category menus switched under a diagonal
  pointer. Spec: `docs/specs/2026-10-16-module-scroll.md`. Reviewed; the menu's hover bridge fix
  followed the owner's look. Making the 19 hand-built pages share the
  table look is a separate owner decision.
- [x] **F195. Desk rail on module pages.** Done 2026-10-15 (`1a1b2e7`, `315de13`, `bb2e7da`, `ff17ad1`;
  owner: "once that is fixed, push"). Owner request 2026-10-15 (revisits F102 for module pages
  only). Inside a desk, the desk tabs leave the header for a 56 px icon rail on the left; its toggle
  widens it to 208 px with names over the page; at 900 px and below it is a drawer from a Desks
  button in the category row. Landing pages, Home and the credits page keep the header tabs. Spec:
  `docs/specs/2026-10-15-desk-left-rail.md`. Built on `task/desk-left-rail` (from
  `task/chat-credits-strip`); reviewed, then the toggle moved to the start of the category row with a
  three-line icon and a sliding reveal (owner follow-up).
- [x] **F194. `openCreditsUsage` has no caller left.** Done 2026-10-15 on `task/chat-credits-strip` (owner:
  "fix them too"): removed with its event and the shell's listener. Found in the F193 review, 2026-10-15. F193
  removed the chat's "Credits" link, the last caller of `openCreditsUsage` (`src/lib/creditsStore.js`);
  the shell's `OPEN_USAGE_EVENT` listener (`src/shell/TerminalShell.jsx`) now hears nothing, and the
  comments there still name the chat's Credits link. Remove both, or give the event a new caller.
- [x] **F193. Chat credit notices at the header pill; "Web sources" strip.** Done 2026-10-15 (`337f9c1`,
  `baf263d`, `16cac7a`). Owner request
  2026-10-15 (UI only). The credit line under the chat box goes; the chat's refusal (no credits,
  credits in use, could not be checked with Try again) and every warning show at the header's balance
  pill, whose popover opens by itself for a refusal without taking focus. The web strip becomes site
  icons side by side in their own pill, "Web sources" and the page count, with no outer border; the
  search count and "N cited in the answer" move into the list it opens. The model's citation
  instructions are unchanged (owner). Spec: `docs/specs/2026-10-15-chat-credits-and-web-strip.md`.
  Built on `task/chat-credits-strip`, reviewed, owner-checked on the local preview.
- [x] **F184. Credits page, balance pill and visual credits UI.** Done 2026-10-15 (`65c940e`; owner:
  "push + merge"). Owner request 2026-10-15
  (UI only). Credits get their own page from the profile menu, with a left side menu holding a
  balance card and four sections:
  - **Overview:** period bar, pace estimate, where credits went, recent answers.
  - **Usage:** today's analytics, complete, plus a 90-day heat map.
  - **Activity:** every existing filter; rows led by the question; a role bar on expand; group by
    chat.
  - **Plan and invoices.**

  Also: a header balance pill with a glance popover, and a status bar keeping every existing
  message. Every credit-to-rupee conversion goes, the CSV included; plan prices and invoices stay
  in ₹. Spec and plan: `docs/specs/2026-10-15-credits-page.md`; design canvas, board 9. Built on
  `task/credits-ui` (spec "As built"), independently reviewed twice, and checked by the owner on a
  signed-in local preview; their feedback (ring, page shift, chart colours, By feature icons) is in.
- [x] **F177. Globe position and sizes.** Done 2026-10-14 (owner: "push merge"). Owner request:
  Pricing's globe sat at the extreme right (24 px from the screen, a label 18 px); the homepage
  globe 5% larger; sign-in and sign-up smaller ("the globe" is the whole box). As built
  (spec `docs/specs/2026-10-14-globe-sizes.md`): Pricing's hero keeps `clamp(32px, 5vw, 96px)`
  clear on the right and its globe is 10% larger (400 → 440 px, 96 px from the edge at 1440 px);
  home `width: 105%` and cap × 1.05, centred; every scene width × `--globe-scale`, `.9` on sign-in
  and `.95` on sign-up. Browser-measured at 1920, 1440, 1200, 900 and 390 px. Accepted trade-off: on
  height-limited screens such as 1440×900 the homepage pushes the "Curated for" strip about
  15–26 px below the fold. Not checked in Safari or Firefox.
- [x] **F154. Terminal page speed (phase 1).** Done 2026-10-14 (`719a7eb`, pushed `1e5d065`). Owner request 2026-10-14: opening a terminal link
  takes 5–7 s; the owner asked for caching. A read-only audit on production found the page files
  fast (0.12–0.19 s) and the API slow: every `/api/*` answer was `no-store`, the function ran in
  `iad1` (US East) while users and Supabase are in India, and desk landing counts and module pages
  waited for the full live scrape (Cabinet Decisions 9–21 s, Morning Brief 28 s or a 504, Athlete
  Index 7 s). Built on `task/terminal-speed` (uncommitted, for the supervisor):
  - **Edge caching.** One allow-list in `api/router.js` (`cachePolicyFor`): the seven
    `/api/*-landing` routes, `/api/feature-feed`, `/api/home/segments`, `/api/constitutions` and
    `/api/growth`, GET or HEAD only. A 2xx answer gets `Cache-Control: public, max-age=0,
    must-revalidate` (the browser re-checks) and `Vercel-CDN-Cache-Control: public, s-maxage=300,
    stale-while-revalidate=86400` (Vercel's CDN only, not passed on; 60 s when the answer is the
    archive). Every other route, and every error, refusal or timeout, keeps `no-store`;
    `site-figures` and `site-icon` keep their own rules. `/api/home/markets|latest|pulse` stay
    `no-store` because `fresh=1` is the refresh button.
  - **Live time limit.** `serveFeatureFeedWithinLimit` (`server/featureFeed.mjs`) gives a request's
    live sources 4 s in all (`LIVE_TIME_LIMIT_MS`), then answers from the stored archive: the same
    feed code runs again with every live source refusing at once, so each module takes the fallback
    it already has. The answer carries `served: 'live' | 'archive'` (landing summaries pass it on).
    One live attempt per feed runs at a time, and a late live answer is used by later requests on
    the same instance for 10 minutes. Measured from the owner's Mac against the real sources
    (unbounded → bounded): Morning Brief 41.9 → 4.0 s, NSE/BSE 12.0 → 4.0 s (144 stored quotes),
    Athlete Index 45.0 → 4.0 s, Geopolitics News Wire 26.3 → 4.0 s.
  - **Archive first on module pages.** `fetchFeature` with `onUpdate` (used by `DeskView`) starts
    the shipped archive and the API together. If the API has not answered within 0.5 s, the
    archive shows with the note "Showing stored rows. Refreshing live data…", and live rows replace
    it when they arrive ("Updated live."). A quicker API answer is shown as before; other callers
    are unchanged.
  - **Region and data files.** `vercel.json`: `"regions": ["bom1"]` (Mumbai, next to Supabase
    ap-south-1), and `/data/(.*)` cached `public, max-age=300, stale-while-revalidate=86400`.
  - Checked on production after the push (repeat requests, from the owner's Mac): the function
    runs in `bom1`; `/data/` carries the new header; Cabinet Decisions landing 9–21 s → 0.13 s
    (edge `STALE`/`HIT`); NSE/BSE landing 4.2 s cold, 0.16 s `HIT`; Cabinet Decisions module page
    0.72 s cold, 0.12 s `HIT`; Morning Brief module page 28 s/504 → 4.2 s from stored rows.
    Morning Brief, Statement Tracker and Economic Overview landing counts can answer 502
    "unavailable" at 4.2 s (never cached): they are live-only modules with no stored copy, and the
    live fetch finishes on the server a few seconds later (Morning Brief: 502, 502, then 200 with
    219 reports about 24 s later). Corrected 2026-10-14 by the F156 measurements; the retry is F156.
  - Not in this phase (F156): one call per desk for its counts, new-tab start-up (`App.jsx`,
    `userStore.js`), re-encoding `public/images/desks-v6`, Vite `json.stringify`.
- [x] **F157. State desk landing downloads 26 whole modules to count them.** Done 2026-10-14 (`791b01e`, pushed `701e22d`). Live: `/api/state-landing` answers 0.7–0.9 KB per module (booth modules were about 110 KB each), 0.15–0.37 s, edge `HIT` on repeat; browser check on the local copy: 26 count requests, 29 KB raw in all, no whole-module downloads. Found by the F156
  measurements: at least about 440 KB compressed per State landing visit; the other seven desks
  have count-only routes. Recommended: a count-only `/api/state-landing` like the others.
  - 2026-10-14, built, not yet committed or deployed: `/api/state-landing?feature=…`
    (`server/stateLandingSummary.mjs`, `stateLandingAnswer` in `src/lib/stateLandingSummary.js`),
    on the F154 edge allow-list and in the Vite middleware, read through
    `serveFeatureFeedWithBackup` as the State landing's `/api/feature-feed` requests were. It
    answers the 26 configured modules (Local-tier booth modules included, in the catalogue's
    tier); the 15 planned modules are still summarised in the browser without a request.
    `useStateLanding.js` and the catalogue search's State summary use it, with `landingRetry.js`
    for counts pending after the live time limit.
    - Same numbers and labels: the server reproduces the browser's fallback (a feed answer with no
      real rows was replaced by the shipped archive, which has no register for these modules).
      `src/lib/stateLandingParity.test.js` compares the new answer with the old browser summary for
      every module, with live sources answering in time, failing, and past the time limit. Run live
      against a local dev server, 26 of 26 summaries were identical.
    - Measured locally (dev server from the worktree, live sources on), the 26 requests of one
      State landing visit: before, 4.2–4.8 MB raw, 677–725 KB gzip, 542–578 KB brotli (the two
      booth modules about 110 KB each); after, 29.6 KB raw, 17.8 KB gzip, 14.2 KB brotli (each
      answer at most 1.1 KB). Loader wall time 5.5–11.3 s before, 0.5–1.3 s after. Per route after:
      median 47–81 ms, slowest 0.2–0.7 s (news modules).
    - Change in behaviour: a count whose live source misses the 4 s limit now shows
      "Loading live count…" and is asked for again at 6 s and 15 s (before: "Measured data
      unavailable"); if still missing it shows "Summary unavailable" with Retry.
- [x] **F158. The Goa booth geography pack is in every terminal visit's JavaScript.** Done 2026-10-14 (`9faeade`, pushed `701e22d`). Live: served on its own as `assets/niy-geo-BQCNMAF0.js` (122 KB gzip), fetched only when a geography module opens; browser check on the local copy: not loaded on the State landing, loaded when Booth Political History opened (1,731 rows shown). Found by the
  F156 measurements: `niy-geo.json` costs 120 KB compressed whether or not a booth module opens.
  Recommended: load it only when a booth module opens (`archiveFeed.js`).
  - 2026-10-14 (task/geo-pack-lazy, awaiting review): `archiveFeed.js` now loads the pack with
    `import()` inside the geography branch, so it is its own chunk (`niy-geo-*.js`, 378 KB / 119.7 KB
    gzip) fetched only when a booth or state electoral-roll module opens. Measured with
    `npm run build`: the shared `AiMarkdown-*.js` chunk fell from 215,264 to 95,290 B gzip, and a
    terminal visit's first view (entry, `TerminalShell`, `PersonaChooser`, `AiMarkdown`) from
    702,541 to 582,570 B gzip (-119,971 B). The entry chunk is unchanged (220,773 B gzip; the pack
    was never in it), so the baseline is not changed. If the chunk fails to load, the module shows
    its error state. `npm run check:bundle` now fails when the pack is not in its own chunk or a
    chunk imports it statically; tests in `src/lib/archiveFeedGeoLazy.test.js`. The server copy
    (`server/featureFeed.mjs`) is unchanged.
- [x] **F159. Module pages show developer wording when live data is slow or fails.** Owner,
  2026-10-14: "On a couple of modules in national, it's showing that the 4-second limit has passed
  ... This kind of error is not very user-friendly." Also an error card "Something went wrong ·
  feature-feed HTTP 404 · Retry" (Policy Pipeline Tracker, local server stopped). Cause: F154's
  archive answer put its reason in `source.note`, which the module banner, the side panel and the
  State/Sports/Entertainment landing details show, and a module page did not retry the way F156's
  landing counts do.
  - 2026-10-14 (task/friendly-feed-errors, awaiting review): the server's archive answer says
    "Showing the latest stored records. Live data is still loading." / "The live source isn't
    responding. Showing the latest stored records." / "Live data is taking longer than usual." and
    keeps the reason in `source.diagnostic` (`server/featureFeed.mjs`). A module page with nothing
    stored shows "Live data is taking longer than usual. Retrying…", asks again at 6 s and 15 s (the
    landing schedule), then "This module couldn't load right now." with Retry; with stored records
    on screen it asks once after 8 s and swaps in live rows ("Updated live.")
    (`src/desks/moduleLiveRetry.js`, `DeskView.jsx`). Retries stop when the reader leaves; paged
    modules and genuine failures are not retried. The error card and the desk landing chart show
    plain words and log the reason with `console.warn`; a backup pack is described as stored
    records. Tests: `moduleLiveRetry.test.js`, `deskViewLiveWait.test.jsx`,
    `railLiveWait.test.jsx`, `deskLandingError.test.jsx`, additions to `featureFeed.test.js` and
    `featureFeedTimeLimit.test.js`, each shown to fail without its code.
  *Done 2026-10-15: owner checked on production; an independent review then found the stored-records retry answered from the edge cache and the old wording in two tooltips. Fixed in `4cb1ade`: answers served from stored records stay 5 s at the edge with no stale window (the retry 8 s later reaches the server); a failed live attempt is marked `liveFailed` and not retried; the public `source.diagnostic` holds codes only (`timeout`, `upstream-error`, `no-stored-records`, `backup-error`), the raw reason goes to the server log; Morning Brief and Statement Tracker log the diagnostic instead of a tooltip; the error card no longer blames the reader's connection for a server error. Checks: new tests red then green, lint, build, router import, 5,451 Vitest tests. Not changed: `shortFail` still passes unrecognised text into status rows for all modules.*
- [ ] **F169. Module data repair.** Owner 2026-10-14, after Cabinet Decisions showed one listing:
  "Can you do a complete module-by-module analysis?" … "what do you propose as a fix? … document it".
  [Audit](../research/2026-10-14-module-audit/README.md) of 123 modules (44 live, 10 live but over
  4 s, 4 broken, 46 stored only, 19 not built), [spec](../specs/2026-10-14-module-data-repair.md)
  and [plan](2026-10-14-module-data-repair.md): phase 1 backup files off the live site, phase 2
  repair broken and thin sources (PIB, briefs, Geopolitics, ISL, Regulatory, Manifold, Wikidata,
  F166–F168), phase 3 "As of" dates and an honest admin status screen, phase 4 F160 seeded with the
  larger registers. Approved 2026-10-14 with all five recommendations; Supabase is on Pro;
  Vercel upgrade later; O6 after this work. Phase 4 is records-first (owner 2026-10-14): every
  listed item kept as its own record under rules 1 to 3 of the F170 spec, keyed by the corpus
  identity where the corpus holds the document; no chunking, OCR or full-text fetching in F169.
  - **Phases 1 and 2 live, 2026-10-14** (pushed `11cc881..df556a4`, deployment in `bom1`; PIB dates
    follow-up `c5e4bf2`). Production probe after the deploy, all 120 desk modules: 116 live, 4 stored
    while the new deployment warmed up (all four live on the next run); no backup-pack answer.
    Regulatory Body Watch 10 → 171 rows, AI & Tech 67 stored → 104 live, Top Business Players 0 → 84,
    ISL 1 → 169, Geopolitics newest story 0.5 h old, Morning Brief 220 and Statement Tracker 100
    live. Sports Governance and State Tenders now show the empty state (no pack).
  - **Phase 3 done 2026-10-14:** T9 (`8109eff`) stored modules say "stored copy · as of <newest record
    date>" or "date not recorded" (NSE/BSE "as of 15 Jul 2026"); Energy no longer promises a live feed.
    T10 (`fce768b`) the admin API status screen shows only what checks found ("Not checked" until a
    sweep; stored answers "Stored"); the hand-written list and every promotion rule are gone. Not done
    from T10: the registry's "Direct feed configured" labels (data file) and the database-size line
    (moves to phase 4, which adds a server route for it). Still to do: phase 4 (needs the Vercel
    upgrade to go live).
  - **Phase 4 built 2026-10-15** (C1–C6, each reviewed independently, review findings fixed): C1
    schedule and item keys (`server/feedSchedule.mjs`, ADR 0012); C2 tables and functions
    (`20261015150000_feed_records`: lease token, kind from the schedule, caps, shrink rule, source
    order); C3 store writer and `POST /api/feeds/refresh` (55 s, four at a time, one request per host,
    live answers only, dormant until `FEED_REFRESH_SECRET` is set); C4 pages from the store while
    fresh, labelled "updated N min ago", live path otherwise; C5 admin "Scheduled feeds" health and
    database size (`20261015160000_feed_admin`); C6 `scripts/load-feed-register.mjs` for Cabinet's
    register (79 decisions, one per decision). Local run against the real sources: 64 of 65 modules
    stored (NSE has no live source), 7,000 items, a second run rewrote nothing. C7 go-live: steps 1–2
    (migrations 52 and 53 applied to NTER, dormant code) done with Push 7; step 3 (secret) done by the
    owner 2026-10-15 (Vault `feed_refresh_secret` and Vercel `FEED_REFRESH_SECRET`, production; an
    unsigned `POST /api/feeds/refresh` now answers 401, not 503); step 4 (timer) switched on
    2026-10-15 before the Vercel upgrade (owner); then the Cabinet register load, a day with `serve` off, and `serve` on
    class by class.
  - **MLA Directory's register (owner: option 1, 2026-10-15), live and served.** 31 per-state
    store variants (class `register`, kind `reference`: a reload replaces a state's list), off the
    timer; migration 54 `20261015170000_feed_register_page` (`feed_page_across`, `feed_make_due`, no
    stale flag for registers). Loaded to NTER 2026-10-15: 4,104 MLAs in 31 states; `serve` on. Without
    a state the page shows 16 per state (496); with `state` a state's whole list. Left out of the
    rows: email, the age (birth date kept), and the affidavit figures (assets, liabilities, criminal
    cases), whose only cited source is Wikipedia. Cabinet's 79-decision register is loaded with
    `serve` off until the timer runs (live decisions on top).
    Whether Vercel left `backup/` out of the package can't be read with the available tools; the
    code refuses pack reads on Vercel either way.
  - [x] T0 probe, built 2026-10-14 on `task/f169-phase1`, committed `d70d753`:
    `scripts/module-probe.mjs` (`npm run probe:modules -- --desk national`), module list from
    `DESK_CATALOGUE` (120 desk modules; the audit's 3 off-desk Global entries are not in it),
    records in `modules.json` fields plus adapter, kind and fallback, `--compare <file>`. Unit
    test `src/lib/moduleProbe.test.js`. Before-run on production (all desks, 2026-10-14 15:42 UTC;
    deployment not identified): `docs/research/2026-10-14-module-audit/probe-before-t1.json`, 120
    of 120 answered 200; National rows and `served` equal the audit's for 15 of 17 (Morning Brief and
    Statement Tracker answered 220 and 104 live this time, 0 in the audit). Newest dates differ
    where the audit counted bare years; the probe does not.
  - [x] T1 backup files off the live site, `d70d753`, live 2026-10-14:
    `server/backupFeed.mjs` reads a pack on Vercel only for a module on `LIVE_BACKUP_PACKS`
    (empty); `vercel.json` and the router `config` exclude `backup/**` and include only
    `{src/data/**,public/data/**}`; `src/backupPacksDeploy.test.js` rewritten. The F156 advice
    above to add packs to `includeFiles` no longer applies.
    **Checkpoint 1 owner list (modules seen answering from a pack on production, 2026-10-14):**
    AI & the Tech Industry 67 rows, Sports Governance & Policy 34, State Tender Aggregator 25 (in
    both probe runs); Geopolitics News Wire 38 and Music Charts — India Top 25 100 (first run only,
    when the live source missed 4 s; live 24 and 25 rows on the second); Box Office Tracker (in the
    audit only; live 245 rows in both runs). After T1 these show the plain empty state whenever
    their live source and archive are empty. 69 desk modules have a pack, so any of them that
    misses its live source with an empty archive now shows the empty state instead of pack rows.
    After deploy: re-run the probe over all desks and confirm no `backup-pack` answer.
- [ ] **F170. Storage, chunking and OCR rules (recorded, not scheduled).** Owner 2026-10-14:
  "record all this as a plan and not do the OCR and chunking bit, because I still have a 10 GB
  corpus and a corpus linking file with pre-contained OCR within it." [Spec](../specs/2026-10-14-document-text-rules.md):
  - rules 1 to 3 (one record per item, keep by kind, files in the bucket) feed F169 phase 4;
  - rules 4 to 9 wait for R7's corpus mapping:
    - chunk any item with a body of text, whatever its length;
    - a background queue; one shared chunking per document, with a lock;
    - chunk on demand at drag time; the platform pays for indexing;
    - for leftovers only, a free page-by-page triage before Mistral OCR; Hindi pages go to OCR
      (owner); a cost estimate and a daily cap before any paid run.
  Read 2026-10-14: the ingest worker OCRs every page today (USD 4 per 1,000) and never checks the
  text layer; chat uploads check the text layer for the whole file only, so a scanned PDF with one
  typed page passes with empty scanned pages. Open: news full text kept per chat or shared
  (copyright; recommendation per chat), and the OCR cap amount.
- **Plan for what is left (2026-10-15):** [next work](2026-10-15-next-work.md): small items (F178, F176,
  F175, local signed-in checks), measurements (F41, F35, F59), then F169 phase 4 records-first storage.
  Progress 2026-10-15: F175, F176 and F178 done; F35 and F41 measured; C1 (schedule) and C2 (tables)
  built on branches, C2 in review fixes.
- [x] **F171. The bug programme.** Owner 2026-10-14: "Regarding the bugs, I'll follow your order.
  Ideally, we need to fix all of it." [Spec](../specs/2026-10-14-bug-programme.md) and
  [plan](2026-10-14-bug-programme.md): B1 to B22 in order (source links, chat uploads, chat
  connection recovery, file size, legal pages, SheetJS, Live TV, planned modules, desk count,
  reasoning usage, log redaction, desk-filter spellings, document titles, then measurements and
  small closures). Starts after F169 phases 2 and 3. Owner decisions taken as recommended.
  - 2026-10-15: B19 done (F35, migration 51 live); B20 done (F41, latency routing, v60).
  - Done 2026-10-14: B1 source links (F89), B2 chat uploads (F172), B3 dropped connection (F66), B4
    file size (F62), B5 legal pages (F108), B6 SheetJS (P12), B7 closed into its accepted risk (F44),
    B8 Live TV (F7), B9 planned modules (F173), B10 desk count (F30); 2026-10-15: B11 (F67), B12 (F36),
    B13 closed (F39), B14 (F52), B15 (F61), B16 (F80), B18 (F31). Left: B17 (F47, closed 2026-10-15 on a local check), B19 (F35, a measurement on a local replica), B20 (F41, a paid provider trial), B21
    (F37, parked with F170), B22 (F59, a signed-in viewer measurement).
  *Closed 2026-10-15: owner "the bug programme is complete". B17, B19, B20 and B22 are done (see above and `coordination.md`); B21 (F37) stays parked with F170.*
- [x] **F192. Hindi interface: the page language and the toggle's name.** Done 2026-10-15 (`9a66bf3`, `63398e1`).
  The document's `lang` stayed `en` while the interface was in Hindi, and the EN/HI toggle had no
  accessible name (local check 2026-10-15, `docs/research/2026-10-15-local-signed-in-checks.md`).
  Now the shell sets `lang` to `hi` or `en` with the toggle and puts back the page's own value when it
  unmounts (`src/shell/interfaceLang.js`); the toggle is named "EN, switch the interface to Hindi"
  (in Hindi mode "HI, इंटरफ़ेस अंग्रेज़ी में बदलें"), so its name starts with its visible text.
  Checks: the new tests failed before the change, and the wiring test fails with the shell's effect
  removed; lint, build, 5,429 Vitest tests; independent review approved. Not checked in a browser
  (the shell needs a signed-in local stack). Possible follow-up, not opened: in Hindi mode,
  English-only content (dataset names, feeds) is now read with a Hindi voice unless marked `lang="en"`.
- [x] **F197. AI counts from desk rows: an unknown filter field returns a silent zero (D3, 2026-10-15).**
  "How many Lok Sabha bills in 2026" answered 0 (truth 23, 11 assented): `search_desk_rows` filters are
  exact JSON containment, so an invented field (`year`) matches nothing and the model reports zero as
  fact. Fix: reject unknown filter fields with the module's real field list, and support a year or date
  range on the module's date field. [D3 record](../research/2026-10-15-d3-paid-live-round.md).
  *Done 2026-10-15 (`71f4897`, migration 56 `20261015210000_desk_rows_date_range`, research-chat v62): a filtered zero checks the module's real fields and returns an error listing them for an unknown field; `date_from`/`date_to` on the row date; a case-insensitive retry only when the exact match finds nothing; a valid zero is reported as "0 matching rows for …". Production re-run: "23 bills … 11 assented", matching the register.*
- [x] **F198. Changing model or reasoning mid-conversation breaks the thread (D3).** The last answer
  vanishes from view (it is saved) and the next send fails "Your research session changed" until Reload.
  *Done 2026-10-15 (`ea78041`): the cause was the account being re-announced (tab focus, token refresh) during the thread's account check, which dropped the re-read answer and cancelled the send; the same account now keeps the send and retries the check. Red-then-green integration tests; not reproduced in a signed-in browser.*
- [x] **F199. High reasoning on a document question can outrun the server's time limit (D3).** Gemini
  Flash · High was cut off at 108.7 s after reading 40 passages; the answer is lost (not charged). Bound
  the passages or the reasoning budget so a turn finishes, or save what was written.
  *Done 2026-10-15 (`71f4897`, research-chat v62): the turn deadline is 120 s; the agent keeps 45 s for the answer, stops a call with no text at that line and answers at low effort from what it has, and caps passages at 24,000 characters at high effort. Production: Gemini Flash · High answered the count question in about a minute.*
- [x] **F200. Small chat issues found in D3.** Escape closes the whole panel instead of the open menu; a
  greeting gets a full structured brief opening "Search widened."; one click on a listed source reloaded
  the desk and re-showed the desk tour (not reproduced); a model listed under its raw id
  "gpt-luna-latest"; the owner's admin account cannot pick GPT – Astra (plan gate; decide whether
  admins bypass it).
  *Done 2026-10-15 (`ea78041`, `71f4897`): Escape closes an open panel menu first (checked on production); the desk tour waits for the account before deciding (it re-showed on any reload); an empty or id-only model label shows a readable name ("GPT Luna Latest", checked on production); greetings get a one-to-three-sentence reply with no search. The one-off reload on a source click is most likely a deploy landing mid-session (the viewer chunk reloads the page once). Admins bypass model plans (owner 2026-10-15, `a0c1216`): GPT – Astra selectable on the owner's admin account on production; research-chat checks `is_platform_admin()` as the caller.*
- [ ] **F202. Module data quality (owner 2026-10-15: "Is this feed even true? What about the other
  modules and fields?").** [Audit](../research/2026-10-15-module-quality-audit.md) of all 117 modules
  on production: 31 OK, 60 minor, 23 major, 3 broken. Causes and fixes:
  1. LIVE badge is the default and fires on the word "live" in any note: 28 stored modules show LIVE
     (`src/lib/dataState.js`). Fix: LIVE only for positively live answers.
  2. State Governance Brief prepends 40 undated national PIB releases; PIB dates are fetched only by
     the national modules; Policy Pipeline shows unfiltered PIB. Fix: PIB out of State Governance, PIB
     dates wherever PIB stays, Policy Pipeline filtered.
  3. Name-built searches stored in the data files break Municipal Watch and Panchayat Watch ("Watch").
  4. National or unguarded searches: State Cabinet, Governor Assent, CAG, HC judges, ICJ, District
     Media, State Governance. Fix: title guards as F196's curated modules have.
  5. No age limit or headline de-duplication on news (rows from 2017–2020 under LIVE).
  6. Store not serving yet (timer on since 2026-10-15; serve after the comparison day); modules with
     no stored copy can come back empty.
  7. Stored data files: bill dates a day early (time zone), 19 leaders stored as titles, expired
     tenders marked Open, Isometric rows undated, constitution names as slugs (data-migration task).
  8. Column setups that do not match the data (Centre-Sanctioned Projects, MLA Report Card, District
     Performance, Energy); resolved prediction markets and 9999 dates; raw HTML entities; Goa-only
     modules unlabelled; "Vernacular" modules that are English news; State Tender shown as configured.
  Owner 2026-10-15: all recommendations approved, including the data-file fixes (cause 7) as a
  data-migration task with an exact inventory. Also from the owner's review: the AI record brief takes
  the format of the code-written blue box (brief, why it matters, watch for, tags) and that box is
  removed (one analysis box per record); "Source date" and "Last verified" fall back to the dataset's
  as-of and our fetch time.
  - Done 2026-10-15: cause 1 (`b9830fa` badge, `c05db22` source line) and cause 8 (`3cfe20c`: columns
    match the answers, only open prediction markets and play money labelled, Goa modules named Goa, no
    "Vernacular" claim, State Tender Aggregator planned, table cells decode HTML entities; desk-brief
    redeployed for the module list). Checks: lint, build, router import, 5,779 Vitest (an earlier run
    under load from parallel agents had 10 failures that pass alone and in a quiet rerun).
  - Done 2026-10-15, brief format (`eaab332`): the AI record brief is the analysis box (brief, why
    it matters, watch for, tags; JSON from Claude Haiku 5.5, format 2), the code-written box is gone
    where the AI card shows, and Source date / Last verified fall back to the dataset's as-of and our
    fetch time, labelled. Migration `20261015240000_record_brief_format` applied, desk-brief
    redeployed; old briefs regenerate once on their next open (about $0.0002 each). The prompt also
    forbids "suggests/indicates", repeated bookkeeping fields and advice (5 Haiku samples, $0.0009).
  - Done 2026-10-15, news relevance (`dec0e08`, causes 2–5): State Governance without national PIB
    rows; PIB releases dated wherever PIB stays; Policy Pipeline keeps only policy releases (it is
    honestly empty when PIB's latest 20 have none); curated searches and headline guards for
    Municipal, Panchayat, State Cabinet, Governor Assent, CAG, HC judges, ICJ, district courts and
    media, the Assembly digest and the wires; age windows; one row per story, reworded copies
    included (five shared content words covering 55% of the shorter headline; the eight rewordings of
    one Kerala resolution fold into one). Live probe: every module but Policy Pipeline 80%+ on-topic
    in its top 20. *2026-10-16 (`c8aa5b2`): same-event rewordings fold further (Guv/TN/number words; a
    shared count and proper name; 18 more same-event merges and none wrong on ~1,480 live headlines;
    "LG gives nod to 6 bills" vs "six bills" still two rows); Climate Newswire says "N stories in the
    last 30 days"; the AI & Tech PIB filter keeps technology-industry releases only; the UK and
    Netherlands leaders' notes about the previous government blanked (addendum in the data-file
    inventory).* Closed cleanup 2026-10-17 (`6657958`): removed 57 inventoried duplicate feature-map
    source fields. The registry fields are actually read by admin/provenance consumers and remain;
    the earlier blanket claim that both files were unread was incorrect.
  - Done 2026-10-15, data files (`af03724`, cause 7; inventory
    [2026-10-15-data-file-fixes](../research/2026-10-15-data-file-fixes.md)): 9,819 bill dates are
    the source's IST day; 19 heads of state named from Wikidata (as of 2026-10-15); expired stored
    tenders read Closed (in code); 14 Isometric rows dated; constitution names readable (in code).
    desk_rows reloaded for Bill Passage, Policy Intelligence Graph, Heads of State and Carbon
    Registry Wire (9,817 + 9,817 + 43 upserted / 1 pruned + 24 / 13); analysed, 34,183 rows.
    The remaining leader source-link UI was closed 2026-10-17 (`d4c0054`, integrated `0e970f4`):
    exact Wikidata item links with safe new-tab behavior, generic/unsafe links absent.
  - Checks for each: lint, build, router import, full Vitest (5,794 / 5,862 / 5,875), Deno 1,134,
    SQL fixture record_brief_format (vacuity and Down).
- [ ] **F196. Planned modules: make them work from the sources the repo already names.** Owner
  2026-10-15: "The source is in that only … We just have to make them up and working"; the tender
  aggregators wait for the owner's source. [Research](../research/2026-10-15-planned-module-sources.md):
  of the 17 in scope, 4 news modules and Election Forecast can be built now; SDL auctions from the RBI
  press feed; State Economic, State Fiscal, NITI indices and Cross-State from the RBI state handbook
  (same RBI site as the registry's source); the 5 district themes only as state-level figures; District
  Governance and District Crime have no source and stay planned. Owner decisions (2026-10-15, "I agree
  with your recommendation"): use the RBI handbook as a yearly stored register; the five district
  themes show state-level figures and are renamed; Party Organisation Map is party seat strength per
  state, an India map (official Survey of India boundary) coloured by the largest party, with a table.
  - Batch 1 done 2026-10-15 (`99d3e83`): Sports Governance & Policy, Governor Friction & President's
    Rule, Legislative Productivity (news coverage only) and MLA Defection from curated Google News
    queries (20/20, 19/20, 20/20, 20/20 on-topic in the top 20, with headline guards), Election Forecast
    from Manifold's Indian election markets (play money; 50 markets, 17 open). On `FEED_SCHEDULE`;
    registry and feature map updated (registry addresses 115 → 120; the homepage keeps 246, F191).
    Checks: 37 new tests red first, lint, build, router import, 5,509 Vitest, 1,079 Deno; each module
    answered live on a local server. Left: no Sports history (the F63 pack is not served on the live
    site); resolved Election markets do not show the winner.
  - Batch 2 done and live 2026-10-15 (`6e32b72`, `5f54439`; migration 58
    `20261015230000_feed_nothing_new`): eight RBI Handbook registers (2024-25 edition, published
    11 Dec 2025; 152 tables, 64,445 figures, newest whole years per table, one store variant per table
    with a Table picker), the Cross-State Comparison Engine (ranks the latest complete year), and the
    SDL Auction & Borrowing Tracker (RBI press feed, kept per security; 45 backfilled lines). The five
    "District …" modules show state-level figures under "State …" labels. Independent review found
    three required fixes (partial years, append-only "nothing new" counted as failure, unbounded live
    cache keys), all fixed before loading. Loaded with `load-feed-register.mjs --target prod`, `serve`
    on; production probe: all answer from the store in 0.2–0.7 s.
  - Party Organisation Map live 2026-10-15 (`911d253`, `65ffac8`): party seat strength per state
    assembly from the MLA register (31 assemblies, 4,103 MLAs, as of 19 Aug 2026), an India map from
    DataMeet's states layer (owner-approved download; CC-BY 2.5 India; verified against the official
    Survey of India extent — Ladakh to about 37°04.7′N with Aksai Chin, Gilgit, Skardu, Siachen and
    Shaksgam; Muzaffarabad and Mirpur in J&K; Tawang in Arunachal; the check runs as a test), shipped
    as a 55 KB file, coloured by the largest party, with a table, a national roll-up and an MLA-list
    hand-off. "Majority" means more than half of the MLAs the register lists. Production: 31 rows in
    1.6 s; the map renders as specified.
  - Remaining planned: District Governance & Grievance and District Crime & Safety (no source in the
    repo), Municipal & Panchayat Tender Aggregator (owner's source awaited); State Tender Aggregator
    likewise.
- [x] **F201. RBI Handbook registers keep only the newest whole years per table.** One store page is
  500 figures, so 85 of 152 tables drop older years (e.g. table 176 keeps 480 of 12,565 figures, and
  its newest year alone is over 500, so 4 indicators including "Outstanding Liabilities" are left out;
  table 95 keeps 16 of 21 indicators). Full history needs several store variants per table (by year
  range) and a year picker. Older years remain on RBI's table pages.
  Planned 2026-10-15 ([spec](../specs/2026-10-15-rbi-handbook-full-history.md),
  [plan](2026-10-15-rbi-handbook-full-history.md)): full history is 101,277 figures (+36,832 store
  items, est. 40–60 MB); recommended: keep one variant per table read whole (up to four 500-item
  pages), split only tables 176 and 151 into whole-year blocks, no migration; T1–T11 with checkpoints.
  Owner 2026-10-15: approach approved; full history shown by default; a Year control on the Cross-State
  Comparison; and the AI must be able to query the figures ("Isn't that the entire point: AI should
  query over it") — added as T9b: load the full handbook into desk_rows for search_desk_rows.
  *Done 2026-10-16 (`c18110f`, review fixes `dec9411`): every figure stored (101,277; Tables 176 and 151
  in whole-year blocks), served whole from the store (Table 176 p95 264 ms), a Years control on
  block tables and a Year control on the Cross-State Comparison; database +80 MB (1,733 MB). Production
  steps and probes: coordination.md, 2026-10-16. An independent review found two defects before go-live,
  both fixed with tests (the Year control offered years the server ignored; `years` values could
  multiply live RBI fetches and kept answers).*
  - [x] **T9b production: the handbook in desk_rows for the AI.** Owner 2026-10-16: no vectors for
    tabular figures; structured search. *Done 2026-10-16: 102,569 rows loaded (desk_rows 34,183 →
    136,752; database 1,733 → 1,882 MB); catalogue `f96a7d7` lists the eight modules with every table
    title, fields and year forms (State-desk prompt +~3,500 tokens), and the tool description and prompt
    allow a year filter on handbook rows; research-chat redeployed (deployed copy matched main first).
    Production question in the owner's tab (Gemini Flash, 48 s, 63.2 credits): Maharashtra's GSDP
    2019-20 at current and constant prices (Tables 21, 22) and the highest 2023 outstanding liabilities
    (Tamil Nadu ₹7,58,931.5 crore, Table 176, from "state debt") — every figure equal to desk_rows.
    Seen: the answer's Gaps section asserted the 2023 figures are provisional, which the rows do not say.*
  - [x] **Before the 2026-27 edition is loaded: stable block names.** *Done 2026-10-16 (`3d577f3`):
    block names are unchanged; the loader finds every stored block of a split table (orphans of an
    unfinished cleanup included), prints one statement that switches the new blocks on and obsolete ones
    off, never deletes, and exits 4 until consistent; a re-cut block that the shrink guard refuses is
    named with its finish command (no auto-repeat past the guard). Yearly steps: dry run with
    `--target prod`, `--apply … --force`, repeat for a named re-cut block, run the printed statement,
    re-run for exit 0. Optional later: an admin RPC `feed_set_block_serve` and a variant listing in
    place of the printed SQL and the probes.* Original finding: `yearBlocks` groups newest-first, so
    one new year renames most older blocks; a shrunk block is refused and keeps serving last edition's
    years, and obsolete blocks keep `serve` on until the printed SQL is run. Group oldest-first or have
    the loader switch new blocks on and obsolete ones off in one step (review finding 3).
  - [x] Optional review completed 2026-10-17 (`81912bd`, `acadaa2`, `8cd624c`): exact-year gaps,
    immediate previous period across blocks, only necessary pages, and financial/survey interval
    overlap. No handbook reload or corpus change. Live January–March 2020 search returns exact
    2019-20 financial-year rows; TOTAL 446.
- [ ] **F191. Homepage "Source endpoints" stays 246 (owner, 2026-10-15).** "Keep it at 246 sources for
  now because we are going to be fixing the rest of the sources and eventually bringing it up to that
  number, or whatever the true number is." The source registry counts 115 working-route addresses
  since F180; the published figure stays 246 (`src/lib/siteFigures.js`) until the sources are sorted
  out, then it shows the true count.
- [ ] **F215. Fixtures & Results — World Leagues: its source is failing.** Found 2026-10-17 in the
  milestone check ([status](../research/2026-10-17-live-module-status.md)): 14 consecutive failed
  runs since the last good fetch at 2026-10-16 18:35 UTC ("TheSportsDB did not return Premier League,
  NBA, IPL or La Liga"); 16 failures and 4 timeouts in 24 hours. The stored copy (7 rows) is still
  served and stops at the 7-day stale ceiling, about 2026-10-23. Find out whether TheSportsDB changed
  its free endpoints or rate limit, then fix the adapter or move to another source.
  Rollout 2026-10-17 (`acadaa2`, integrated `0e970f4`): documented public configuration
  repaired, all four leagues checked; first scheduled run at 10:40 UTC succeeded with 7 items
  and reset failures to zero. Closure awaits three real hourly opportunities under T15.
- [ ] **F160 rollout status 2026-10-17:** code, compatibility SQL, exact constitution key repair,
  MLA reference transition and serve-on are complete. Local/bundle/browser/production probes pass.
  Remaining: T15's three real post-rollout refresh opportunities across source intervals. First
  fixtures and MLA checks succeeded, zero unexplained high-failure sources. District Performance
  remains deliberately planned/off; real MLA scorecards and additional sources stay M3.
- [ ] **F160. Serve module data from the database, filled by scheduled jobs (ingest, then serve).**
  [Spec](../specs/2026-10-14-scheduled-module-data.md) written 2026-10-14. Owner's answers the same
  day: the timer every 5 minutes, not every minute; the other recommendations adopted. Now phase 4
  of F169.
  Owner 2026-10-14: "eventually we would keep this as part of our database … a combination of both
  live pull and data-backed entries." Today a visitor's request pulls the live source (4 s limit),
  the edge keeps the answer 5 minutes (stale up to a day), and the shipped archive is a fixed
  snapshot. Recommended: background jobs fetch each source on a schedule (15 minutes to daily) into
  `desk_rows` (34 modules, about 34,000 rows there today for AI search); pages read the database
  and show "updated N min ago"; live sources are touched only by the jobs. Start with live-only
  modules (Morning Brief, Statement Tracker, news wires). Needs a spec and the owner's go-ahead;
  after or alongside O6.
- [x] **F161. Credits wording.** Done 2026-10-14 (owner: "approved, push it"): all nine approved changes — the Free card and Plan & billing no longer call AI free; model access on every plan card; "Top-ups coming soon. Need more credits now? Write to niyantranai@gmail.com." always shown until O6; the blocked chat message says to upgrade or write in; the Terms state paid-only models and no automatic renewal; the refund policy drops the mandate sentence. Guards in `publicPlans.test.js`, `legalPolicies.test.js`, `PlanBilling.test.jsx`, `CreditBalance.test.jsx`. Was: From the credits audit 2026-10-14:
  - Free is described as "every desk and the AI research assistant at no cost"
    (`src/lib/publicPlans.js:10`, `src/shell/PlanBilling.jsx:169`) although Free is 1,000 credits
    once and paid models are locked.
  - A user who runs out is not told how to get credits before O6: add "write to us for more
    credits" beside "Top-ups coming soon" and on the blocked state (`CreditBalance.jsx:66`).
  - "Top-ups coming soon" shows only while plan checkout is closed (`PlanBilling.jsx:71`); it should
    depend on top-ups being on sale.
  - Terms and refund policy describe automatic renewal and a payment mandate
    (`legalPolicies.js:123,155`), against the no-auto-renew decision; the Terms say "Other models use
    credits on every plan" (`legalPolicies.js:120`) although paid-only models exist (F150), and
    pricing never mentions model access.
- [x] **F162. Credits clarity.** Done 2026-10-14 (owner: "do F162 and F163 and push"): credits held for a running answer show beside the balance in the chat and in Plan & billing ("N credits held for a running answer"); an account with no allowance is warned at 200 credits or fewer (`LOW_BALANCE_WITHOUT_ALLOWANCE`, 10% of Plus's 2,000), without "this cycle". Was: From the credits audit: credits held by a running answer are not
  shown; the low-balance warning never shows without a monthly allowance (top-up-only users,
  `creditsStore.js:258-263`). The word "wallet" is internal only; users see "AI credits", the
  balance, "Credits by expiry" and "Credits usage". Size S.
- [x] **F163. Questions note reads like an internal note.** Done 2026-10-14: now "Search covers all 8,000 questions. Answers are not in this dataset yet, so \"Has answer\" shows Not reported." (`src/lib/shapeQuestions.test.js`). Was: "Answer text is missing on every row in
  this archive — Has answer stays Not reported until Sansad answer fields are wired."
  (`src/lib/shapeQuestions.js:55-56`, there since 2026-09-09). Owner asked whether it was new: it
  is not. Recommended: "Answers are not yet in this dataset" or hide it until answers are loaded.
- [x] **F165. Technical words left on other screens.** Done 2026-10-14 (owner: "do F165 and push"): every desk's landing cards, the module header ("complete list · stored copy" instead of "exhaustive · sync backup"), Home, the record panels, the critical-minerals note and the side-panel overview tiles (`src/lib/analytics.js`) now use plain words; data and status matching unchanged. Browser check on the local copy: Global, Economics, Carbon, Sports, Home and a module page show no developer terms. Was: Found while building F164 (2026-10-14), not
  in its scope: other desks' landing card text (Global "Reporting search / RSS", Economics "PIB RSS
  reporting" and "existing adapter", National "not a live ECI API", Carbon "The API response
  blends…", the Sports sector card "not yet available in the existing adapter"); the module header's
  "exhaustive · sync backup / sync present" labels; the critical-minerals board note ("unless the
  pack supplies them"); `HomeDesk.jsx` "nter.news feed not configured on this build" and the
  latest-news note; the record panel's `reporting_search` field ("GDELT DOC 2.0 — …").
  Recommended: the same display-only treatment with `plainSourceNote.js`. Size S–M.
  - 2026-10-14 (task/plain-words-rest, awaiting review): status matching is unchanged (`dataState.js`
    and `refreshFeeds.js` read the same notes). Landing cards in plain words on every desk ("News
    stories found by a news search and outlet feeds…", "Press Information Bureau releases…", "not
    live Election Commission data", "This source mixes live Verra publications with stored
    entries…", "the governance register is not available yet"; "workspace overlays" and "fallback"
    gone). The module header reads "500 rows · 4,104 in the full list · stored copy" or
    "2 rows · complete list · to the present" (`completenessLabel`, `freshnessLabel`; a capped stored
    copy is no longer called complete). The Critical Minerals note says "when the source does not
    give them". Home shows "No nter.news headlines yet" / "nter.news headlines aren't available right
    now" (the server's note kept as the title) and "waiting for stories", "NEWS SEARCH · LIVE". The
    National record panel says "Found by a news search, not an official dataset." instead of the
    `reporting_search` tile (`plainReportingNote`). Sweep: the record panels name sources plainly
    ("News search", "BBC World feed", "PIB release feed", "Website", "stored on the platform",
    "benchmark set", "latest stored copy", "not a full history"), the side-panel warning, Transit,
    Industry, Commodities, Global Aid, Policy Graph, the bill and manifesto panels and the loader.
    Left: the side panel's overview tiles from `src/lib/analytics.js` ("GDELT" source tile, "outlet
    RSS", "extracted pack"), outside this sweep; module names ("Order Archive by Topic",
    "Candidate Affidavit Database (Structured + API)" as an id); Live TV "archive"; admin and legal
    pages. Tests: `landingPlainNotes.test.jsx` (every desk), `deskViewPlainNotes.test.jsx`,
    `homePlainNotes.test.jsx`, `recordPlainNotes.test.jsx`, `railPlainNotes.test.jsx`,
    `plainSourceNote.test.js`, each shown to fail without its code; adapter tests that pinned the
    old wording updated.
- [x] **F164. Live source notes are technical.** Done 2026-10-14 (owner: "do F164 and push and merge"): `src/lib/plainSourceNote.js` turns technical notes into a plain source line on screen ("Live · 24 stories from BBC World"); the data and status matching are unchanged; the original note is kept as a `title`. Checked in a browser on the local copy (Geopolitics News Wire, Morning Brief). Was: Seen 2026-10-14: Geopolitics News Wire shows
  "GDELT paced ≥5s; primary DOC 2.0 search retries on the next refresh … rate limited"; Morning
  Brief and Statements show "GDELT wire unreachable…" and "PIB releases arrive through the backend
  (/api/rss)…"; landing detail cards repeat source notes; planned/offline state cards mention
  archives and hosts. Recommended: show a plain source line ("Source: BBC World") and keep the
  technical note in `source.diagnostic` (as F159 does). Size M.
  - 2026-10-14 (task/plain-source-notes, awaiting review): the feed data is unchanged
    (`refreshFeeds.js` and `dataState.js` read `source.note` word for word); screens pass notes
    through `src/lib/plainSourceNote.js`. A note without technical wording (hosts, paths, files,
    GDELT/DOC 2.0, RSS, API, proxy, backend, adapter, archive, backup, pack, fallback, pacing,
    seconds, rate limits, error text, internal identifiers) is shown as written; from a technical one
    only the plain sentences are kept, after a plain source line such as "Live · 24 stories from BBC
    World", "Latest stored records" or "Stored records from the published source". The original
    stays as the line's `title`. Used on the module page (feed-head note, strip labels such as
    "TOP WORLD STORIES — BBC WORLD", the stored-records banner), the planned/offline state card (no
    "Configured host"; sources listed by name as links), the side panel (source note, banners), the
    desk landing chart source, the record panel's fallback source, Morning Brief and Statement
    Tracker banners ("This section couldn't load right now."), and the State, Sports and
    Entertainment landing detail cards (the summary's `limitations` uses the plain note; the
    original is kept as `sourceNote`; four Sports and three Entertainment card texts no longer say
    RSS, fallback or adapter). Board notes and other notes written for readers are not changed.
    Tests: `plainSourceNote.test.js` (real notes from production answers and the code),
    `deskViewPlainNotes.test.jsx`, `railPlainNotes.test.jsx`, `landingPlainNotes.test.jsx`,
    `briefPlainNotes.test.jsx`, each shown to fail without its code.
- [x] **F111. AI credits.** Done 2026-10-14: enforced for everyone (`787bced`; migrations 47–49 live). Follow-ups: F155, F160–F164, O6. Was: Plans sell AI credits, but no credit ledger,
  allowance or enforcement exists; research-chat only logs USD cost. Needs the
  owner's credit definition, then a spec (ledger, allowances per plan, unused
  credits carried forward, enforcement in research-chat, NYAI gating to
  Pro/Max).
  - 2026-10-14: TenderBase's credits system reviewed against its code
    ([research](../research/2026-10-14-ai-credits-reference-review.md)).
    Take its log-then-trigger ledger; avoid its defects (last-round-only
    billing, broken renewal after overspend, free stopped turns, no chat
    reservation).
  - 2026-10-14: owner decisions taken; the
    [spec](../specs/2026-10-14-ai-credits.md),
    [plan](../plans/2026-10-14-ai-credits.md) (the working log, with
    progress) and [ADR 0011](../decisions/0011-per-user-credit-ledger.md)
    are approved.
    - Code starts on the owner's word.
    - Task 0 is done: the median answer costs 21 credits, and the dearest
      301.
    - A design review (`security-auditor`) found 3 critical and 10
      important issues; all are fixed in the spec.
    - The owner settled the last two questions: a failed turn that still
      showed text is charged, and credit history is deleted with the
      account.
  - 2026-10-14: built on `task/ai-credits`, local only, nothing deployed.
    - Tasks 1–6 are done, with two reviews (1R and R) fixed.
    - Local runs 1 and 2 (server, then the browser at desktop and phone
      width) both passed.
    - Remaining:
      - task 7 (pricing and policy wording, awaiting the owner's approval);
      - the production steps in the plan, each on the owner's go-ahead:
        migration, functions in shadow mode, push, a shadow week, then
        enforcement.
  - 2026-10-14, later: **enforced for everyone** (owner: "remove the entire shadow concept"):
    the secret `CREDITS_ENFORCED=1` and research-chat v56, then the shadow code removed in
    `787bced`.
  - 2026-10-14: **live in shadow mode** (superseded the same day).
    - Shipped: migration 47, research-chat v54, transcribe-audio v2, and the
      push `2a85579..80aeaa6`. Task 7's wording is live.
    - Remaining:
      - the shadow-week check on or after 2026-10-21;
      - then enforcement for everyone (owner: "we should enforce it").
    - The steps and the check queries are in the plan's "After launch"
      section.
  - Owner decisions (summary):
    - 1 credit = 10 paise of AI cost.
    - Free gets 1,000 once (30 days). Plus 2,000, Pro 6,500 and Max 75,000 a
      month.
    - 10% of unused credits roll over for one cycle.
    - Top-ups are valid 12 months.
    - Failed turns are free, and Stop charges the part used.
    - Briefs and dictation are free.
  - transcribe-audio calls a paid model with no `model_call_logs` row (plan
    task 3).
  - For O6: a downgrade must start at the next cycle, but `grant_paid_plan`
    starts a different plan at once.
- [x] **F147. Admin user list paging.** Done 2026-10-14 (`1336047`): pages of 100, search by email or name, the header shows the directory total. The directory reads every profile in
  one request (and every wallet, in pages). Recommended: page it 100 at a
  time with search, once there are more than 300 users.
- [x] **F148. Plan & billing dark mode.** Done 2026-10-14 (`a964eb4`): dark styles from the app's tokens, contrast ≥ 4.5:1 tested. The panel, its credits section
  included, has light styles only. A small CSS task for the next UI polish
  pass.
- [x] **F149. Open an answer from Plan & billing.** Done 2026-10-14 (`a964eb4`): rows open the chat in the AI panel (`niy-open-conversation`). Recent answers are plain
  text, because no route selects a conversation. Recommended: a
  `niy-open-conversation` event, like `niy-open-billing`.
- [x] **F150. Model access by plan.** Done 2026-10-14 (`787bced`). Owner: Free gets Gemini Flash-class, DeepSeek, GPT Luna and Claude Haiku; GPT Terra, Sol, Astra and Claude Sonnet and Opus need a paid plan; new models default to paid; Gemma is off. `ai_models.min_plan`, enforced by research-chat (403, including the failover chain) and shown in the picker. Was: One Claude Sonnet
  answer costs about 170 credits, and a Free account can leave one answer
  of debt unpaid. Recommended: tier-3 models on paid plans only.
- [x] **F151. Credit estimate in the model picker.** Done 2026-10-14 (`787bced`, `a964eb4`): `model_credit_estimates()`, measured median or list price. Was: Show "≈ N credits a
  typical answer" per model beside the cost diamonds. After enforcement.
- [x] **F152. Leaked-password protection (owner's dashboard action).** Done 2026-10-14: the owner switched it on; the Supabase security advisor no longer reports it. Owner 2026-10-14: will switch it on. The Supabase security advisor flags it as off (Auth → Passwords).
- [x] **F153. Credits usage page.** Done 2026-10-14 (`0d5671a`; migration `20261014233000_credit_usage_reports` applied; pushed `3d0a0d8`). Owner 2026-10-14: a separate page like TenderBase's (AI
  activity card, AI analytics with charts and legends, all AI activity, credits by expiry) plus a
  small version in Plan & billing; built from the owner's screenshots.
  [Spec](../specs/2026-10-14-credits-usage-page.md). Next after the speed work.
  Built as specified: the full-screen page (activity, analytics chart, all AI activity with CSV,
  credits by expiry), the small version in Plan & billing, the profile-menu item and the chat
  chip's Usage link; the §12 amendment is in the credits spec.
- [x] **F155. Admin can set a model's plan.** Done 2026-10-14 (`cf5231c`; migration `20261014234500_admin_model_plan` applied; `admin-models` v15). Was: The owner adds new models from the admin AI models
  page; it needs a plan selector (`admin_models_upsert` + `admin-models` + the allowlist editor) so
  each model's `min_plan` is chosen there. New models default to paid until then. Credits audit
  2026-10-14: still missing (`admin-models/handler.ts` leaves out `min_plan`; no selector in
  `AllowlistEditor.jsx`). Size S; deploys the `admin-models` function.
  - 2026-10-14, built on `task/admin-model-plan` (not yet applied or deployed): migration
    `20261014234500_admin_model_plan.sql` replaces `admin_models_upsert` (same signature, SECURITY
    DEFINER, `search_path ''`, service_role only) so a model row may carry `min_plan`: only
    `free`/`plus`/`pro`/`max` (anything else, null included, is refused with 22023), a new model
    without it gets `plus`, an existing model without it keeps its plan; no stored plan changes.
    `admin-models` passes `min_plan` through and answers 400 for any other value; its list already
    returns the column. The AI models page has a Plans selector per model ("Free and paid plans",
    "Paid plans", "Pro and Max", "Max only") saved with the row's Save, a note while a change is
    unsaved, and a selector beside "Add from catalogue" that starts at "Paid plans". Evidence: SQL
    fixture `supabase/tests/admin_model_plan.sql` (with vacuity check), Deno and Vitest tests. To
    go live: apply the migration, then deploy `admin-models`.

- [x] **F99. Reconcile public pricing copy and inventory retired commercial UI.** Pricing page done on `task/pricing-inr` (2026-10-12): owner INR plans, no GST, no unsupported claims; see the legal-policies spec. Remaining: retired commercial UI inventory below, and billing alignment (F109). Free signed-in desk access is implemented, but src/lib/pricingStore.js still advertises five core desks in public pricing. UpgradeModal.jsx has no production importer; copyPolicy.js has test-only references; onboarding.css retains unused niy-plan-wait styling. These are outside the approved terminal/signup scope. Decide marketing scope and exact removal inventory before changing them; billing history and AI limits are not removal targets.
  *Done 2026-10-15 (`f664612`, owner: "fix the loose ends"): `src/shell/copyPolicy.js` and its test and the unused `.niy-plan-wait` style removed; the pricing copy and retired screens were already done.*





- [x] **F76. Owner browser acceptance of dictation.** F74 production activation completed; verify real signed-in microphone → editable transcript in both Ask AI and command search, permission refusal and grouped production record search. Synthetic English/Hindi OpenRouter probes and deployed auth/CORS passed; authenticated browser full path is not yet exercised. [Release evidence](2026-10-04-dictation-activation.md).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*




## 1. Done

- [x] **Frontend default icons (2026-10-19).** c748e26 deployed Production READY. Both icon paths200/image MIME;46 frontend asset checks pass; Chrome32 successful requests and empty Console after reload. Evidence and remaining unrelated DevTools issues: [release record](2026-10-19-frontend-icons.md).

- [x] **Research citation/web repair implementation (2026-10-19).** 4a1c978:
  current selection anchors retrieval; pinned rows carry tier and server-verified
  handles; exact-anchor citation repair preserves prose; one bounded web-only
  fallback and truthful unverified notices. Local6293 app/1172 Deno tests pass.
  Existing PDF/Text viewer verified in owner Arc; hosted activation/acceptance
  remains open above.

- [x] **Production research recovery implementation (2026-10-19).** Main8f72418:
  refresh saved answer after terminal verification, including initial-read race;
  one bounded structured-output correction before visible text. No second turn,
  retrieval replay or credit reset. Acceptance remains tracked above.

- [x] **F230. Combine profile and credits controls.** Source7756c67, owner
  accepted local UI and authorized push/merge/deploy2026-10-18. Credit ring
  surrounds avatar; Account contains all prior credit details, warnings/retries
  and the same Credits route. No backend or credit calculation change.
  Guards4 red before green, focused49/full6268 pass; lint/build/bundle pass.
  Browser fixture desktop/mobile/dark, dismissal/focus, quiet refusal/retry and
  route pass. Independent review found no blocking source issues. Branch
  CI39131057499 app/SQL passed attempt1; merged main and deployed
  dpl_AbnvcMevyeMwtL71YxpoeoMMsTZg READY at7756c67. Public assets verified on
  www.nter.pro and retained Vercel alias. MainCI39131455379 app/SQL passed
  attempt1; zero5xx in bounded deployment request scan. Evidence in
  [Release record](2026-10-18-profile-credit-summary.md#authorized-release--2026-10-18).
  Scheduled M1/M2 checks continue; Razorpay held, corpus excluded.



- [x] **F229. Full selected-record pane animation.** Source8a33c19, released
  fae886b2026-10-18 after explicit owner approval. Adapted, generic National and
  fallback records show one native-size pane loader while loading/writing/pending;
  Close stays available, normal details return on settlement. Hook/provider/
  cache/timing/billing unchanged. Guards9 red before/22 green after, focused86,
  full6264, lint/build/bundle pass. BranchCI39128091215 app/SQL pass attempt1;
  production dpl_J3uHbqrdoHcJSoK3cGyEBqvLjgX2 READY; updated loader CSS verified
  on both aliases. MainCI39128436114 app/SQL pass attempt1.
  Browser visual check unavailable due Arc control; limitation disclosed before
  owner release approval. No paid call, backend, corpus or payment change.
  [Release evidence](2026-10-18-record-pane-animation.md#authorized-release--2026-10-18).

- [x] **F228. Homepage/sign-in presentation.** Source4e739b1, releasedfae886b
  2026-10-18. Removed hero/header CTA arrows; enlarged homepage globe/orbits5%,
  shifted desktop scene24px left, increased role names/descriptions with fixed
  line boxes, reduced sign-in globe5%. Mobile globe/sign-up preserved. Owner
  accepted local homepage preview; follow-up tweaks explicitly approved for
  release. Full6264 tests, lint/build/bundle pass; production CSS smoke checks
  pass on custom and retained aliases. Same release/CI evidence as F229.


- [x] **F227. Supabase Auth redirect cleanup.** *Closed2026-10-18,
  evidence0cc7198.* Owner applied nine-entry allowlist: broad all-Vercel wildcard,
  malformed entry and obsolete bare root removed; exact retained Vercel root/
  reset added. Site URL, four custom entries, scoped preview and localhost
  preserved. Live no-follow invalid-token checks11/11 pass; unrelated Vercel
  destination accepted before and rejected after. Owner confirms reload persists
  all9 URLs and Google sign-in/recovery/reset/sign-in pass after cleanup. No
  source deployment needed; D2 unchanged, T15 independent/open.
  [Evidence](../research/2026-10-18-f227-auth-evidence.md).


- [x] **F226. Policy Pipeline stored landing summary.** *Done2026-10-18,
  source441343e, released6c08b48.* Only this National summary selects the
  existing stored-first loader in both routers; fetch/stale provenance retained.
  Both production URLs return200/count3, matching their module;16/16 National
  resources pass, post-release request scan zero5xx. Four regressions failed
  before fix;18 new/102 focused,6242 app/1155 Deno, lint/build/bundle/router pass.
  Branch/main CI39120245451/39120540412 pass both jobs attempt1 (including SQL).
  One local paging timeout passed isolated and full retry at unchanged limits.
  No filter/data/schedule/serve/Edge/payment/corpus change.
  [Evidence](../research/2026-10-18-nter-domain-launch-evidence.md).

- [x] **D2. nter.pro application launch.** *Done2026-10-18, planning commits
  a84175c/6711578, release/evidence6c08b48.* Namecheap BasicDNS and Vercel team/
  hostname ownership verified; HTTPS www serves the existing production project,
  apex308 to www; niyantran-six retained. Old site remains available at
  niyantran-weld.vercel.app (owner-controlled mutable alias, no deletion).
  Auth/CORS prepared and verified; owner confirms sign-in, recovery-email,
  password reset and subsequent sign-in. Saved history and two-message pilot
  survive reload; exactly one USD0.000533 call/5.0635-credit charge reconciles
  balance3309.553→3304.4895, no duplicate charge/grant or active hold.
  F226 fixed before closure. Final20/20 CORS, home API, disabled checkout,
  current release, unchanged10 Edge versions/hashes and bounded no5xx gate pass.
  Known DNS resolver caches, Node DEP0169 and build-size warnings recorded;
  Auth allowlist follow-up is F227. No additional paid call or backend data/
  timer/ingestion change. T15 remains independent/open; Razorpay held.
  [Spec](../specs/2026-10-18-nter-domain-launch.md),
  [plan](2026-10-18-nter-domain-launch.md),
  [execution evidence](../research/2026-10-18-nter-domain-launch-evidence.md).

- [x] **F225. Redenominate AI credits to one paisa before payments.** *Done
  2026-10-18 IST (`679921a`, released through `de51434`).* Owner approved
  push/deploy and controlled backfill. Migrations `20261017194626` /
  `20261017194628` applied separately; compatible production deployment
  `dpl_99ho6FyZMshn7f5HECTbpqyMydsM` READY. All three wallets, lots and debt
  reconciled at 10x while paused; original 20 ledger rows, 17 draws, 92 cost
  mappings, 18 holds and entitlements fingerprint-identical. Writes resumed
  only after checks at 20:34:28 UTC October 17. Legacy stored values/rates
  remain immutable; usage/answer projections use the current unit. Allowances
  10k/20k/65k/750k, INR prices/dates unchanged. 6,224 app / 1,155 Deno tests,
  44 SQL fixtures with vacuity, lint/build/router/bundle/browser gates pass;
  branch/main CI 39066720672 / 39066765071 green on attempt 1.
  [Spec](../specs/2026-10-18-credit-paise.md),
  [plan](2026-10-18-credit-paise.md),
  [production reconciliation evidence](../research/2026-10-18-credit-paise-evidence.md).
  Final top-up prices and Razorpay implementation remain unapproved/on hold;
  all-account eligibility is the later payment requirement. Corpus excluded;
  M1/M2 T15 remains independent/open.


- [x] **F221. Feed timeout tests release their own live producers.** Landed
  `389dbed` (2026-10-17): disposable source stubs reject pending and fallback
  requests, tracked real/custom loaders settle before fetch/timers restore.
  Two real-loader regressions failed with original teardown (0→1 / 1→2 calls),
  pass after disposal; preference source and all 36 assertions unchanged.
  Full 6,194 Vitest / 1,155 Deno, lint/build/bundle/router pass. Branch CI
  39052609249 and main CI 39052960359 app/SQL passed attempt 1; production
  dpl_EC2dNBS1rX9ZPrcEBJDJydXmoqWh READY at exact 389dbed. Details recorded
  in [F221 evidence](../research/2026-10-17-f221-test-isolation-evidence.md).
  Test-only: no backend/data/SQL/corpus/payment change. T15 remains open and
  hourly closure monitoring ACTIVE.

- [x] **F224. Bound Growth Indicators requests and diagnose source failures.**
  Runtime `0074991`, owner approved implementation/push/deploy 2026-10-17.
  Growth alone uses sequential series, 6-second attempts / 18-second active
  total, one bounded transient retry per series; host queue time excluded.
  Safe per-series logs, cancellation and HTTP-body cleanup; no partial success
  or replacement on failure. Existing worker budgets/host limits/schedule and
  source/country/value contracts preserved. New guards fail on original runtime;
  final 128 focused / 6,192 Vitest / 1,155 Deno, lint/build/bundle/router pass.
  Branch/main CI 39048250037 / 39048651791 passed app/SQL on attempt 1.
  Production READY. First live probe failed truthfully on unemployment after
  GDP/CPI succeeded; a later live GET recovered, 200/20 rows exactly matching
  stored values. Store fingerprint/fetch time and all ten Edge Functions unchanged.
  Natural post-deploy writer acceptance is explicitly pending under T15 at the
  next daily refresh, not claimed from public reads. Hourly monitoring ACTIVE,
  corpus excluded, payment held. [Spec](../specs/2026-10-17-f224-growth-budget.md),
  [plan](2026-10-17-f224-growth-budget.md),
  [evidence](../research/2026-10-17-f224-growth-budget-evidence.md).

- [x] **F223. Use stored data for MLA Directory and MLA Profiles landing summaries.**
  Done 2026-10-17 (`0c1319c`), owner explicitly approved implementation/push/deploy.
  Both routers reuse the existing stored-first loader for exactly these two
  features. Summary fetch/stale metadata preserved; safe validated-feature
  diagnostics added. Original runtime fails nine new guards; final focused
  143 tests, full 6,166 Vitest / 1,155 Deno, lint/build/bundle/router pass.
  Production READY `dpl_8cMAHjxjfBroGdaPLeHz1MwNuJdp`: both summaries/modules
  HTTP 200/store with matching notes/fetch times and 496 sampled Directory rows
  (4,104 full stored records) / 500 Profiles rows. Store fingerprints and all
  ten Edge Function versions/hashes/settings unchanged. No migration, forced
  refresh or production data/timer change. Exact feature names of the original
  two 13:08 failures remain unknown. F221 and T15 stay open; corpus excluded,
  payment held, hourly closure follow-up active.
  [Spec](../specs/2026-10-17-f223-state-summaries.md),
  [plan](2026-10-17-f223-state-summaries.md),
  [evidence](../research/2026-10-17-f223-state-summaries-evidence.md).

- [x] **F222. Retain upstream Manifold market IDs in feed rows.**
  Done 2026-10-17 (`294a273`, released at `e1a5557` with owner push/deploy approval).
  Optional bounded `market_id` passes through both mappers and existing JSON
  storage, preserving keys/filters/variants/dates. Real 13:10 UTC refresh:
  204 Political Odds / 17 Election Forecast items, all distinct IDs, zero new
  item keys; both public APIs 200 from store with all IDs. All 598 prior-day
  snapshots retain their exact fingerprint. No schema, backfill, forced refresh,
  timer or Edge Function change. Local 206 focused / 6,147 Vitest / 1,155 Deno
  tests pass; lint/build/bundle/router pass; branch/main app+SQL CI pass attempt 1.
  Final documentation CI/deployment verified after push; F223 separately records
  two state-landing 502s outside this change. Closure monitor active, corpus
  excluded, payment held.
  [Spec](../specs/2026-10-17-f222-manifold-identity.md),
  [plan](2026-10-17-f222-manifold-identity.md),
  [evidence](../research/2026-10-17-f222-manifold-identity-evidence.md).

- [x] **F220. Fractional watchdog cutoff restores high reasoning effort.**
  Done 2026-10-17 (`256f042`), research-chat v66 ACTIVE. Controlled clocks prove
  the timer can cut 0.75 ms before the boundary; the checkpoint now retains
  reserve entry across replacement calls/provider retry. Null/absent overrides,
  caller abort, active streaming and independent turns preserved. Nine F199
  cases pass ten independent executions; old runtime fails four guards.
  Full Deno 1,155 and Vitest 6,126 pass; branch/main CI first-attempt green,
  including SQL. Exact deployed diff is only agent.ts; authentication/CORS and
  all unrelated functions preserved. T15 observations and separate F221 remain.
  [Spec](../specs/2026-10-17-f220-answer-reserve.md) ·
  [plan](2026-10-17-f220-answer-reserve.md) ·
  [evidence](../research/2026-10-17-f220-answer-reserve-evidence.md).

- [x] **F218. Satellite Infrastructure landing summary bypasses usable feed-store data.**
  Done 2026-10-17 (`0e2ebfb`): both routers use the canonical stored-first loader
  for this summary, preserving fetched time/stale markers and existing fallbacks.
  Production deployment `dpl_GFrsGgPzU3A8mjzmHuGUoYrcQeaX` READY; landing and module
  both return 12 stored launches with fetched time `2026-10-17T11:15:01.824Z`.
  6,126 Vitest / 1,150 Deno tests pass; branch/main CI first-attempt green,
  including 41 SQL fixtures/vacuity and 10 Down checks. Desktop/mobile browser
  verifies count and navigation. Other summaries retain their existing loaders;
  no broad shared-register change or corpus/payment work.
  Later documentation-only CI exposed F220, now fixed separately in `256f042`;
  F218 code/source and production checks remain unchanged.
  [Spec](../specs/2026-10-17-f218-stored-summary.md) ·
  [evidence](../research/2026-10-17-f218-stored-summary-evidence.md).

### Login/logout race released — 2026-10-18

- [x] **F233. Fix login/logout passive-verification race.** Runtime fix
  `66cc4f2`, merged/released with evidence as main `68c4aff`. Passive refusal
  grants no authority and emits no false logout; genuine logout/account/token
  invalidation protections retained. Causal regression,6,288 app/1,155 Deno
  tests, lint/build/bundle and independent review passed. Branch CI39138273293
  and main CI39138686342 app+SQL green attempt1. Production READY deployment
  dpl_5B3sUpd4zBEoLz3kAJCmGsifsNv6; Arc real password sign-in verified three
  times with two intervening logout → public home → sign-in cycles, no reload
  between cycles and no verification error. No credentials read/exported,
  provider/model calls or Supabase settings/function/schema changes.
  [Spec](../specs/2026-10-18-login-logout-race.md) ·
  [Production evidence](2026-10-18-login-logout-race.md#production-verification--2026-10-18).
  M1/M2 T15 remains open; hourly checks ACTIVE, Razorpay held, corpus excluded.

### Warning fixes released — 2026-10-18

- [x] **F231. Reduce large JavaScript chunks through real load boundaries.**
  Landed `f158aa8`, released on main `cd0e14d`. Home-route gzip down25.4%
  locally; production TerminalShell495.71kB, largest xlsx499.55kB, no chunk
  advisory. Production initial180,869B gzip below unchanged182,446B budget.
  App/SQL CI branch39134798867 and main39135220208 green on attempt1.
  [Spec](../specs/2026-10-18-bundle-node-warnings.md) ·
  [Release evidence](2026-10-18-bundle-node-warnings.md#production-verification--2026-10-18).
- [x] **F232. Remove deprecated lazy URL-parser path.**
  Landed `32c611e`, released on main `cd0e14d`. Causal legacy-helper tests,
  routing/query compatibility and full suites pass. Two uncached live router
  probes returned expected404; bounded deployment runtime scan zeroDEP0169
  and zeroerrors, versus eightDEP0169 entries on the prior deployment in1h.
  Ongoing monitoring continues; this is bounded evidence, not a guarantee about
  every dependency/path. Same release evidence as F231. No Supabase changes.

### M1/M2 implementation and rollout — 2026-10-17

- [x] **F210. `researchThreadIntegration.test.js` is flaky in CI.** Found 2026-10-16: "a TOKEN_REFRESHED
  for the same account while a send is checked does not fail the send" saw the server called 3 times,
  not 2, on CI run 38818354932 (commit 56f42d2); it passed 6 of 6 locally and on the next CI run.
  A timing assumption under a busy runner; make the test wait on the send, not on time.
  - Again on CI run 38828313006 (commit 05cc82d, no `src/ai` changes): attempt 1 failed the SIGNED_IN
    and TOKEN_REFRESHED cases (server called 3 times, not 2); attempt 2 failed "changing the model and
    reasoning after an answer…" with `SyntaxError: "undefined" is not valid JSON`. The file passed 5 of 5
    locally on the same commit.
  - Also failed locally (SIGNED_IN and TOKEN_REFRESHED cases) in a full `npm test` on 2026-10-16 during
    F213, then passed 3 of 3 run alone: it is load-sensitive, not CI-only.
  Done 2026-10-17 (`8d6dec5`, integrated `0e970f4`; final source `d63192b`):
  all three actual post-fix CI runs passed first attempt, without retries/cancelled runs/empty commits.


The items below are integrated/released; T15 owns the remaining multi-day observations.
Evidence: [cleanup execution record](../research/2026-10-17-m1-m2-cleanup-evidence.md).

- [x] **T0 (M1/M2):** safe baseline, reproducible defects and measured initial assets. Integrated/released 2026-10-17 (`0e970f4`); evidence below.

- [x] **T1 (F210):** deterministic research-thread integration tests, preserving ownership checks. Integrated/released 2026-10-17 (`8d6dec5`); evidence below.

- [x] **T2 (F160):** retained-item guard and truthful verified-empty source outcomes. Integrated/released 2026-10-17 (`8cd624c`); evidence below.

- [x] **T3 (F160):** caller cancellation while queued, including Music Charts fallback. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T4 (F160):** stable constitution identity, with exact stored-key inventory. Integrated/released 2026-10-17 (`acadaa2, 0e970f4`); evidence below.

- [x] **T5 (F160):** bounded, complete latest-run pagination beyond 2,000 accumulated items. Integrated/released 2026-10-17 (`8cd624c, acadaa2`); evidence below.

- [x] **T6 (F215):** diagnose/repair World Leagues fixtures and preserve four-league coverage. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T7 (F160):** reliable MLA Profiles reference serving; no scorecard/source expansion. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T8 (F201):** exact selected-year comparisons and immediate comparable previous period. Integrated/released 2026-10-17 (`81912bd`); evidence below.

- [x] **T9 (F201):** whole-variant reads request only necessary handbook pages. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T10 (F201):** exact-period and overlapping-range handbook filtering; inventory any required
  handbook-only repair separately. Corpus ingestion remains excluded. Integrated/released 2026-10-17 (`8cd624c, 81912bd`); evidence below.

- [x] **T11 (F216):** grounded qualifications, focused guards and behavioral evaluation evidence. Integrated/released 2026-10-17 (`73cfd87, 00aaf99`); evidence below.

- [x] **T12 (F202):** inventory and remove only proven unused stored searches. Integrated/released 2026-10-17 (`6657958`); evidence below.

- [x] **T13a (F208):** lightweight public catalogue identity/counts, separate terminal schema. Integrated/released 2026-10-17 (`e5f45c2`); evidence below.

- [x] **T13b (F208):** preserve deferred search/navigation and lower measured bundle baseline. Integrated/released 2026-10-17 (`e5f45c2`); evidence below.

- [x] **T14 (F202/M2):** show the selected leader's real Wikidata item link. Integrated/released 2026-10-17 (`d4c0054`); evidence below.

- [x] **F208. The desk catalogue puts every module's columns in the first-load bundle.** Found in F207,
  2026-10-16. `src/desks/landing/deskCatalogue.js` imports `feedColumns` (`src/lib/columns.js`, 40 KB
  of source) and the full feature map, so a signed-out visitor downloads them. Load them with the
  terminal instead, then lower the baseline.
  Done 2026-10-17 (`e5f45c2`, integrated `0e970f4`): public initial JS 229,274 -> 185,438 B gzip including globe; desktop/mobile search and production homepage checks pass.

- [x] **F216. Research answers state caveats the data does not.** Seen 2026-10-16 in the F201 T9b
  production question: the answer's Gaps section said the 2023 outstanding-liability figures are
  provisional, which the desk rows do not say. Rule for `research-chat`: a gap or caveat must come from
  a returned row, document or tool result, or be worded as unknown. Prompt change plus a test;
  redeploy after diffing the deployed source.
  Done 2026-10-17 (`73cfd87`, `00aaf99`; research-chat v65): all five frozen rubric cases have passing faithful evidence (four on v64; corrected page/TOTAL case on v65). Total authorized evaluation cost $0.03677325; failed batches preserved.

- [x] **F217. Morning Brief fixture clock ages out.** Found 2026-10-17 during M1/M2
  verification: the fixed 14 October RSS date crossed the three-day retention window.
  Owner authorized the test-only fix on 2026-10-17. `src/lib/briefFeeds.test.js`
  now freezes Date at 15 October and restores real timers after each test;
  runtime retention rules are unchanged. Focused 3/3 pass; final integration evidence
  is recorded with T1. Committed locally as `8d6dec5`; final full suite passes. Integration/release closure remains T15.
  Done 2026-10-17 (`8d6dec5`, integrated `0e970f4`): test-only Date clock, runtime retention unchanged; full suite passes.


- [x] **F59. First-traversal and remaining heavy-viewer stutter attribution.** F58 observed isolated 105/55/111ms long tasks and a 650.7ms frame gap whose cause was not established. If the real issue remains reproducible, collect a CPU/render trace, profile full view with thumbnails and signed-storage network timing under fixed conditions before optimizing. Warm loopback scrolling was steady; this is not production performance acceptance. [F58 evidence](../research/2026-10-03-heavy-pdf-profile.md). Safari acceptance remains F50.

## 4. Payments

- [x] **F6.** Plan gating on the server, before real payments (closed 2026-10-14, superseded; see below). Desk data is
  public (static files, and `desk_rows` is readable by any signed-in user).
  Locks, row caps and export limits run only in the browser. The spec must
  settle which data is premium, how premium desks are served (an API behind
  `my_entitlement`, or RLS), server-side exports and API row caps.
  - **Parked by the owner (2026-10-02)** until payments are integrated: "when the payment plan
    is actually integrated, we might have to make changes again."
  - **Closed 2026-10-14 as superseded (owner).** There are no paid desk tiers: plans differ in
    AI credits and in which models they may use (F150). Credits are enforced on the server.
  - **Decisions recorded for then:**
    - core desks stay persona-based and user-editable;
    - the AI assistant respects the same desk locks when it reads desk rows;
    - the desk packs stay public for now.
  - **The access map** (every path to desk data, the client-only rules, and the smallest real
    enforcement) is kept locally in `docs/security/2026-10-02-plan-gating-map.md`, which is not
    published.
  - **Noted there:** the trial row cap (25) is below the free cap (40), and prices are defined in
    both the client and the server.
  *Closed 2026-10-15 (F171 B22): three 12-second scroll profiles of a 250-page, 64 MB PDF on the real
  viewer, first traversal included: 60 fps at p99, no long task, at most 4 canvases; the only
  one-second gaps fell while the page was hidden (`research/2026-10-15-local-signed-in-checks.md`).
  Reopen with the document if a reader reports it.*

- [x] **F47.** Found during the F46 fixes and left out of their scope.
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
  *Closed 2026-10-15 (F171 B17): measured on a local signed-in copy at 320 px, every header action
  fits (avatar x 276–308 of 320, no sideways scroll); the open phone items were fixed by the chat and
  header work since (`research/2026-10-15-local-signed-in-checks.md`).*

- [x] **F188. Google News rows on Geopolitics were labelled "BBC World feed".** *Done 2026-10-15
  (`b5c86cb`, `41551bc`): a Google News kind with the real publisher; a row with a BBC outlet stays BBC;
  a summary that only repeats the headline gets no card; the link says it opens through Google News.*
- [x] **F189. The Google News reroute matched a generated URL.** *Done 2026-10-15 (`c045bfb`,
  `c83cbf2`): an explicit `news-topic` marker in the feature map (16 entries) and the source register
  (118 rows, fallback is the marker or empty); answers compared over 169 modules in three stubbed
  worlds: identical.*
- [x] **F190. MLA Directory had no state picker.** *Done 2026-10-15 (`b049d69`, `b369dae`): a State
  select (All states, or one of 31); a state's request never shows another state's MLAs on the store
  or live path; race-tested; the count is announced.*

- [x] **F179. Status rows claimed a GDELT search.** *Done 2026-10-15 (`f2d2d87`): no answer carries a
  `gdelt` flag, server or client; every client branch that read it was dead (false, or true only on
  failure status rows). Compared over 169 features in three stubbed fetch worlds: identical apart
  from one status row naming news.google.com.*
- [x] **F180. GDELT addresses in the source registry.** *Done 2026-10-15 (`f2d2d87`): 131 registry rows
  and 44 feature-map sources name the routes the loaders take; `isGdelt` removed. The homepage figure
  is F191.*
- [x] **F181. Home Top Stories had no live source.** *Done 2026-10-15 (`d676a14`, `583fe8e`): Google
  News India top stories (owner: "Go ahead with all your recommendations"); production: 38 stories.*
- [x] **F182. The conflict register was labelled an agent snapshot.** *Done 2026-10-15 (`c8aefb1`,
  `8dcec27`, `65d386c`): the register is never saved as a snapshot, the browser fallback skips the
  seed, an agent snapshot needs its own marker, and the health line says "register".*
- [x] **F183. Other PDF readers lacked the character maps.** *Done 2026-10-15 (`c8aefb1`): the page
  viewer passes them; the admin upload reads only page count and encryption, so it gains nothing.
  Legacy Hindi fonts still need OCR (F170).*
- [x] **F185. District Performance Tracker stored malformed rows.** *Done 2026-10-15 (`d676a14`): a body
  that starts as JSON is never read as CSV; production 500 clean rows.*
- [x] **F186. NSE/BSE was scheduled with no live source.** *Done 2026-10-15 (`fb52292`): off the timer
  (`OFF_TIMER`), with the drift test still strict for every other module.*
- [x] **F187. Cabinet Decisions listed a decision twice.** *Done 2026-10-15 (`d676a14`, `3e4487a`): one
  release per decision (`pickReleasePairs`) in the live loader, the store's page and the register load.*

- [x] **F41.** A widened chat turn is slow: on 2026-10-01 a bill question waited 65 s, of which
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
    - **Re-measured 2026-10-15 on v59 code (about $2.50, `589d577`)**, with the same result, then
      **option 3** (latency routing plus the prompt's coverage check, about $0.83, `93c42b0`): the
      check brings the depth back (brief documents 2.33, expected document 15/15, pages 7.6 against
      8.6) but takes the speed back too (brief total 37 s, as default routing). Nothing ships. The
      owner chooses option 1 (latency routing: briefs in about 20 s, a third cheaper, slightly less
      depth) or option 2 (default routing).
  *Done 2026-10-15 (`0dde63f`, `research-chat` v60): latency routing on every call, owner's choice of
  option 1 (briefs about 20 s instead of 37 s, a third cheaper, about one page fewer cited).*

- [x] **F35.** NTER's unscoped search loses results to its HNSW index.
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
  - **Measured on the replica (2026-10-15, $0,
    `research/2026-10-15-unscoped-search-recall.md`, `435779e`):** `ef_search` 200 finds the right
    document in the top 10 for 170 of 184 questions, as exact search does (40: 162), at about 2 ms
    more p50. Above about 500 the planner switches to an exact scan (11 to 57 s). Lowering T is not
    safe: an off-topic question in Regulatory's scope returns no rows on the index path at any
    `ef_search` up to 400, so it needs an exact fallback first.
  - **Migration `20261015130000_unscoped_ef_search`** (`task/ef-search`): `ef_search` 200 in the
    unscoped branch only, set and restored with `set_config`. Fixture `unscoped_ef_search` (index plan
    asserted; fails at 40 and without the restore). Read-only checks on NTER, 2026-10-15: the live
    body is the repository's apart from comments; at 200 the plan stays on the HNSW index; warm index
    scan 10.0 ms against 7.6 ms at 40. Side effect (review): pgvector returns at most `ef_search`
    candidates, so an unscoped call that lost rows to the `indexed_at` or tier filter now fills its
    40; prompt size per turn can rise slightly against the F41 baselines.
  *Done 2026-10-15: migration 51 `20261015130000_unscoped_ef_search` (`9bafdc1`, `74e6d66`) applied to
  NTER with `supabase db push --linked` after a dry run that listed only it; live check: one overload,
  the 200 constant in the body, grants unchanged, an authenticated call returns 40 rows and leaves
  `ef_search` at 40. Lowering T stays open (needs an exact fallback; not scheduled).*

- [x] **F178. Chat upload follow-ups (review, 2026-10-14).** Messages on the chip were English only and
  sat in a tooltip; CID-font PDFs read as nothing; a second dropped connection started a second
  re-check loop. *Done 2026-10-15 (`096375d`, `35ae106`): the reason a file was not sent and what was
  cut show as visible text, in Hindi too (joined notes sentence by sentence); pdf.js gets its character
  maps and standard fonts from `/pdfjs/` (copied from the installed `pdfjs-dist` at build); one re-check
  per conversation, replaced when a new turn is sent. Not checked with a real CID-font PDF in a browser
  (local signed-in checks). Legacy Hindi fonts and the other PDF readers are F183.*
- [x] **F175. Admin Website settings were per-browser.** *Done 2026-10-15 (A3, `1994396`, `6ff005a`):
  the site name, contact details and search tags are published from code (`src/lib/siteSettings.js`,
  company facts from `COMPANY`); the admin page keeps only the intro video. Visible change: the contact
  email is `COMPANY.email`, as on the policy pages.*
- [x] **F176. Dead GDELT code.** *Done 2026-10-15 (`ad31f52`): removed from the server loaders, the home
  conflict feed and the browser fallback. The browser branch was live: Geopolitics News Wire asked
  GDELT from the reader's browser; that request is gone. Every module's rows and source were recorded
  with the old code and the new, sources up and down: identical (Top Stories drops its false GDELT
  flag). Follow-ups F179 to F182.*

- [x] **F67. Reasoning usage accuracy.** `sendTerminal` in research-chat
  coerces unavailable `row.usage.reasoning_tokens` to zero. Preserve unknown
  versus measured zero and identify observed partial counts explicitly; add
  stream/persisted parity guards before changing this. Read-only finding from
  the owner's F65 annotation; the displayed turn's actual provider usage has
  not been inspected. No backend change or deployment in the styling amendment.
  *Done 2026-10-15 (F171 B11, `de2d1b2`; `research-chat` v59 deployed): unknown reasoning usage is sent as null and a partial count as partial, as the saved row does.*
- [x] **F36.** `_shared/logging.ts` redacts by field name, and any name
  containing "token" is hidden. So `embed_tokens` and other counts appear as
  `[redacted]` in Edge logs (seen in the I7 run). Names containing "key" are
  hidden too: `document_key`, `expected_key` and `key_holder` in `admin-ingest`'s
  logs (C5). Redact known secret names and secret-shaped values instead.
  *Done 2026-10-15 (F171 B12, `de2d1b2`): secrets redacted by exact name and by value shape (Bearer, JWT, sk-), inside arrays too; counts and record keys are logged. Live in `research-chat` v59; the other nine functions take it on their next deploy (several hold undeployed code on `main`, so they were not redeployed for this).*
- [x] **F39.** `research-chat`'s `featureScopeOf` keeps only the first
  spelling of a desk feature (`handler.ts:515-536`). It should collect every
  spelling, e.g. "(RBI / SEBI / TRAI / CCI)" and "(RBI/SEBI/TRAI/CCI)".
  *Closed 2026-10-15 (F171 B13): not reproduced. Read-only SQL: every module has exactly one `desk_feature` spelling in `documents` (Regulatory is stored as "(RBI SEBI TRAI CCI)"), and `featureScopeOf` resolves it. Reopen if a second spelling is ever ingested.*
- [x] **F52.** Some document titles are stored malformed. For example "The Farmers (Old Age
  Allowance Bill,2000" has an unbalanced parenthesis and no space before the year. They show as
  stored in the sources list and the reader. Needs a count over `documents.title` and a decision
  on cleaning at ingestion or at display.
  - **Also found (2026-10-02, research-coverage T1):** some records carry another document's
    title. `4618230e` ("The Airlines (Penalty for Delays) Bill,2005") and `a76358ab` ("The
    Communal Violence(Prevention,Control and Rehabilitation of Victims) Bill,2005") each hold one
    passage of an unrelated 2004 Appropriation Act. Read in the local replica, a copy of the
    legacy corpus; nothing was changed.
  *Done 2026-10-15 (F171 B14, `e91d959`): titles are tidied for display only (unbalanced bracket before Bill/Act/Ordinance, the space before the year, a stray final bracket); versions differing only that way share a sources card. Stored titles are unchanged; the records that carry another document's text (second note above) remain a data task.*
- [x] **F61. Broader tab keyboard audit.** *2026-10-14 (F171 B15): the Nuclear tab component no longer exists (`d25eb24`); Live TV remains.* Review the remaining Live TV and
  Nuclear analytics tab patterns for consistent roles and keyboard behavior.
  Outside the concrete F60 repair scope; coordinate with the next UI brief.
  *Done 2026-10-15 (F171 B15, `e91d959`): Live TV categories are pressed buttons; the lower tabs are tabs with one tab stop, arrows, Home and End, and a labelled panel. Not checked in a signed-in browser.*
- [x] **F80. Existing mobile marketing trivia overflow.** *2026-10-14 (F171 B16): fixed in code by `3717f95` at 768 px and below; 320 px and desktop not yet measured.* Browser at 320/768px has scrollWidth 335/783px. Main's unchanged stylesheet reproduces the 335px trivia block in a minimal browser fixture. Outside the homepage Earth scope; inspect .mkt-trivia-inner sizing before changing it. [Evidence](2026-10-04-earth-replacement.md).
  *Done 2026-10-15 (F171 B16, `e91d959`): border-box at every width; measured on the local copy: no sideways scroll at 320, 768 or 1440 px, the band inside the gutters (16–304 at 320, 24–1416 at 1440).*
- [x] **F31.** `deno.lock` is stale: it still lists `sql.js` (removed in C3)
  and lacks the ESLint packages. Regenerate it in its own commit.
  *Done 2026-10-15 (F171 B18, `e91d959`): `deno.lock` deleted; nothing read it (`"lock": false`); 1,079 Deno tests pass without it.*
- [x] **F172. Files uploaded into AI chat never reach the AI.** Found 2026-10-14 (F171 research,
  read): `requestAttachments` (`src/ai/AiPanel.jsx:171-186`) keeps only attachments with a top-level
  `text`; an uploaded file's text sits under `files[]`, so every uploaded file is dropped without a
  word while its chip shows it as attached. The server's file extraction (`extractBuffer`) lost its
  only caller in `def5f71`. F171 B2.
  *Done 2026-10-14 (F171 B2): text, CSV, spreadsheets and PDFs (page by page) are read in the browser and sent; the AI reads 12,000 characters a file (the prompt's limit, tied by a test) and the chip says so; scanned pages, images, Word and binary files say "Not sent". Commits `7f28aeb`, `7d432c5`. Follow-ups are F178.*
- [x] **F173. Four unbuilt modules are not marked planned.** Found 2026-10-14 (read): Sports
  Governance & Policy, Election Forecast Aggregator, State Fiscal Deep-Dive and Municipal &
  Panchayat Tender Aggregator show news rows or an empty state instead of "Module planned", unlike
  the other 15 unbuilt modules. F171 B9.
  *Done 2026-10-14 (F171 B9, `402622d`, `7fbc3b1`): all 19 show "Module planned"; the server fetches nothing for them and borrows no stored rows; the record loader skips them (none in `desk_rows`, checked).*
- [x] **F174. A timing test fails when the machine is busy.** `src/lib/backupFallbackRoute.test.js`
  "reads the largest pack (5.9 MB) in under a second" failed once in a full run on 2026-10-14 and
  passed three times alone. Make the bound relative or skip it in the full suite.
  *Done 2026-10-14 (`8109eff`): the bound is 2.5 s, which still catches an unbounded read.*
- [x] **F66. Connection recovery state.** Owner screenshots show Failed to
  fetch, an unknown saved outcome, excess empty space and a remaining Stop
  button. Root cause unverified; investigate separately without using live
  conversations as test fixtures. Outside F65 visual scope.
  *Done 2026-10-14 (F171 B3, `9763250`, `7d432c5`): plain message; the partial answer stays; the saved answer is re-checked every 5 s for two minutes, then "Still not saved. Use Recover answer or Reload."; Stop stays only for a turn the server acknowledged.*
- [x] **F62. File admission policy.** File attachment materialization still reads
  whole files before admission. F60 reuses those bytes and shows processing/overflow;
  choose a file-size/total-byte policy before supporting large user uploads. No
  arbitrary new size cap was introduced in the defect fixes.

Historical baseline (read-only observations, 2026-10-03; superseded by
"Current state — 2026-10-12" above):
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
  *Done 2026-10-14 (F171 B4, owner decision taken as recommended): 25 MB a file, 50 MB a drop, refused before reading; no file contents or file text in browser storage.*
- [x] **F89. National external source-link reliability.** V6 popup audit executed18 unique public targets:15 responded200; eprocure link returned500, GDELT returned429, and `https://ipm.mospi.gov.in/` has an expired TLS certificate. Do not bypass TLS or guess replacement sources. [Exact targets/evidence](../specs/2026-10-07-national-v6-link-audit.md). Existing source/feed integrations unchanged; refresh/replacement requires a scoped source task.
  *Done 2026-10-14 (F171 B1, `402622d`, `7fbc3b1`): GDELT API addresses are never listed as sources; Centre-sanctioned Projects links MoSPI's main site while ipm.mospi.gov.in's certificate is expired; eProcure answers again.*
- [x] **F166. Morning Brief and Statement Tracker cannot load on the live site.** Found by the F160
  research 2026-10-14: both pages fetch through `/api/rss` (`MorningBriefDesk.jsx:51-53`,
  `StatementsDesk.jsx:45-47`), which only the local dev server has (`server/homeApi.mjs:955`);
  production answers 404 (checked), and the pages are also gated on `VITE_LIVE_API`. Readers see a
  plain "not available" message. The server already builds the same content (`server/nationalFeed.mjs`
  :504 Morning Brief, :439 Statement Tracker for the first leader). Recommended: switch both pages to
  `/api/feature-feed` now (small), rather than adding an open `/api/rss?url=` proxy to the live
  function (it would fetch any URL it is given). F160 phase 1 then serves them from the database.
  *Done 2026-10-14 (F169 T3, `afcd931`, pushed `df556a4`): both pages read `/api/feature-feed`; production probe: Morning Brief 220 items, Statement Tracker 100 per leader.*
- [x] **F167. `/api/home/refresh` is public and makes outside fetches.** Found by the F160 research:
  anyone can call it (GET or POST) and trigger fetches of every home source. Recommended: require
  the same secret as F160's refresh route, or remove it from the live router. Size S.
  *Done 2026-10-14 (F169 T8, `7bff816`, pushed `df556a4`): the route is off the live function; production answers 404 (checked).*
- [x] **F168. An empty "taking longer than usual" answer is edge-cached for 60 s.** Found by the F160
  research: a pending module answer (`served: 'archive'` with no rows) is a 200, so the edge keeps
  it, and the F159 retries can be served the same empty answer. Recommended: send pending answers
  with `no-store`. Size S.
  *Done 2026-10-14 (F169 T8, `7bff816`, pushed `df556a4`): a pending answer is `no-store` (router test).*
- [x] **F108. Legal page content is per-browser.** `privacyStore.js` and
  `termsStore.js` keep edited content in `localStorage`, so an admin edit is
  not seen by other visitors. Make published legal content shared (part of
  F107).
  *Done 2026-10-14 (F171 B5, `4efa9ce`, pushed `df556a4`): Privacy and Terms show the published text; the per-browser editors are removed. The same per-browser problem in the admin Website settings is F175.*
- [x] **F7 / O7.** Live TV content is partly invented. `server/liveTvApi.mjs:664`
  serves a hand-written transcript labelled "ASR Verified Record"; `:609` is
  an invented archive entry; channels without a schedule get placeholder
  programmes. It needs the new Live TV sources, UI and sample codebase.
  *Done 2026-10-14 (F171 B8, `43cf837`, `8990ef9`): invented schedules, archive, transcripts, programmes, stock photos, dates and live status removed; five wrong channel IDs corrected (Sansad TV was Google for Developers); swapped titles set from YouTube. Left for a real Live TV source: schedules, archive, transcripts, checked live status.*
- [x] **F156. Terminal speed (phase 2): paged module lists and stored copies on the server.**
  Paging and the landing retry are live (`97828b2`, pushed `3d0a0d8`). Production, from the
  owner's Mac: Bills page 1 is 9.4 KB compressed (was 534 KB for the whole register, plus a
  450 KB archive), 0.82 s cold and 0.37 s from the edge; a search 0.19 s; Questions page 1
  8.5 KB, 0.44 s.
  - **Backup packs, decided 2026-10-14 (owner: "go with your recommendation … make a note"):**
    `backup/` holds 99 Excel workbooks and 8 manifests (82 MB), a one-time snapshot from
    2026-09-11 (`c83fabe`), never refreshed and not in Supabase (`desk_rows` holds none of them).
    They are a last resort, read only when a module's live source and its shipped archive are both
    empty. Only four modules reach that point on the live site, so the live function carries only
    their packs and manifests (about 5 MB): Satellite Infrastructure, Growth Indicators and
    Global Trade (`backup/GLOBAL`) and Athlete Index (`backup/SPORTS`), listed by name in
    `vercel.json` and `api/router.js` `config.includeFiles` (test: `src/backupPacksDeploy.test.js`).
    **Correction 2026-10-14 (module audit):** this list restricts nothing. Vercel's file tracing
    packages the whole `backup/` folder because `server/backupFeed.mjs` reads it at run time, so
    every pack is on the live function and in use since F156. Several packs hold a different kind
    of record from their module (Box Office → headlines, OTT → a TV schedule), and none of the four
    chosen here matches its module. Fixed by F169 phase 1 (T1).
    The other 95 workbooks stay in the repository for the local dev server and must not be deleted
    without an approved data task. (Superseded by F169 T1: backup packs are off on the live
    site; a module is added to `LIVE_BACKUP_PACKS` only with a test proving its pack holds the
    module's kind of record.) Refreshing or converting the packs is a separate data task.
  Owner request 2026-10-14: large module lists are loaded whole, which keeps load times high and
  costs server time; load them in pages instead.
  [Spec](../specs/2026-10-14-paged-module-lists.md), with measurements: only Bills (9,819 rows,
  about 0.9 MB per cold open) and Parliamentary Questions (8,000 rows, about 0.6 MB) are large;
  every other module is at most about 60 KB compressed. Planned: server pages of 100 rows for those
  two (search, sort, filters and counts on the server, edge-cached); pending landing counts retried
  instead of shown as "unavailable"; the deployed site reading the backup packs with a bounded
  read (the `includeFiles` line awaits the owner's approval).
  *Closed 2026-10-14: paging is live; the backup-pack part is superseded by F169 T1 (no backup-pack answer on production in the post-deploy probe).*
- [x] **Homepage sideways scroll at phone width.** Fixed on `task/mobile-overflow` (2026-10-14). The
  trivia band is a `.mkt-wrap` with its own padding and border added on top, so on phones and tablets
  (to 768 px) it was 47 px wider than the page (scrollWidth 390 at 375). Its padding and border now
  sit inside its width there: scrollWidth equals the viewport at 375, 390 and 768 px. The walkthrough
  globe image also measured past the edge but is clipped by its container and never scrolled the page.
  Desktop is unchanged; there the band still starts at x=1 instead of the 24 px gutter (no scroll),
  a one-line fix if wanted.
- [x] **F132. Gemini sometimes double-escapes newlines in the strict JSON
  answer.** Done `54b98e6` (2026-10-13). Found in the F131 local run, 2026-10-13: one answer in three was
  saved with 41 literal `\n` sequences and rendered them as text. The answer
  phase is unchanged by F131, and production had none in 11 answers over 14
  days.
  - **Measured 2026-10-13 (owner: "run the test first, then add the safety
    net"):**
    - **Production, read-only:** 0 of 12 saved answers ever, 10 of them from
      Gemini 3.8 Flash and 3 of those web turns. `chat_messages` is the only
      table that stores answers.
    - **Probe:** 20 answer-phase calls to Gemini 3.8 Flash, built with
      production's own prompt builder, answer schema and OpenRouter client.
      14 were follow-up questions with a prior markdown answer and web
      evidence, and 6 were first questions. **None was double-escaped**
      (0 literal `\n` in any answer). With a sizing call, the probe cost
      $0.13. Web search spend is now $0.70 of the approved $1.00.
    - Together with the one local case, that is 1 in 36 known answers: rare,
      but real.
  - **Safety net, on `task/f132-json-newlines`:** `undoDoubleEscapes`
    (`answerStream.ts`), applied to the answer in `handler.ts` before the
    citation ladder.
    - It turns literal `\n`, `\t` and `\"` back into real characters, but
      only when there are at least three literal `\n` and they outnumber the
      real line breaks.
    - The saved answer is corrected, and the terminal patch corrects what the
      reader already sees.
    - There are 3 tests, and each guard was proved by mutation: removing the
      call, lowering the threshold to one, and dropping the line-break
      comparison.
  - **Status, 2026-10-13: shipped.** `research-chat` v53 is deployed (fix
    `54b98e6`) and `origin/main` is pushed (see coordination Operations).
    - Checks on Node 24.21.0: 3,688 Vitest and 1,015 Deno tests, lint, the
      build and the router check.
    - Nothing remains unless the double escaping shows up on production:
      search `chat_messages` for literal `\n` now and then.
- [x] **F127. Record adapter helper clean-up.** Done `d19a9f3` (2026-10-13). One strict feed-date reader (`feedDate.js`, options for IST, full month names and RBI's zoneless times) and one plain-text helper (`feedText.js`) replace the copies in five adapters. Behaviour changes, deliberate: zero-width characters are stripped everywhere; the Cabinet adapter no longer reads a month fragment such as "Marc"; a weekday may be spelt out. Bill and question names print as Parliament writes them; only all-capitals names are title-cased, keeping abbreviations and roman numerals ("The ASHA Workers…", "Chapter VIIB", not "Asha", "Viib"). The Morning Brief dedup is one pass.
- [x] **F84. Law reporting-query relevance.** Fixed `897ccc7` (2026-10-13). The nine Law news-wire modules search Google News with each forum's own name and legal terms instead of product-name OR queries; ICC excludes cricket, and the international forums carry no India filter. Live check: ICC moved from cricket to International Criminal Court coverage, and the other eight moved likewise. Also fixed: Google News descriptions showed as raw link markup in tables and in the Law summary card; they are now plain text. [Spec](../specs/2026-10-13-law-news-queries.md).
- [x] **F112. Terminal navigation, type scale and search.** Owner review
  2026-10-13: no "Choose a desk" row on Home, larger highlighted desk tabs, one
  type scale on desk landings, a wider "Search desks, modules and records" box.
  The desk hero now grows to fit the larger title (amendment 1). Shipped in
  `ef4754a` (production `dpl_89StSPmjxkYuVtFLdWBq7bABvDXF`).
  [Spec](../specs/2026-10-13-nav-type-search.md).
  Owner checked on production and accepted, 2026-10-13.
- [x] **F114. Side panel collapsed by default on module pages.** Approved
  2026-10-13. A module page loads with the slim bar so the table gets the
  width; a row click opens Record; picking up a record opens AI.
  Commit `408835e`, merged `426a879`, pushed 2026-10-13.
  [Spec](../specs/2026-10-13-panel-collapsed-default.md).
  Owner checked on production and accepted, 2026-10-13.
- [x] **F116. Citations do not say which version or format a source is.** Two
  versions of a bill appear under identical titles. 413 bills have several
  documents (versions). Only two documents have a stored PDF, so all other
  citations open in Text. Show the version (`document_role`, for example "As
  introduced" or "As passed Lok Sabha") on source cards and in the reader.
  Shipped 2026-10-13: merged `839d7dc`, pushed, Vercel
  `dpl_5terWzWj3hK3nRtkVpsW9e9dgfma`, `research-chat` v49.
  [Spec](../specs/2026-10-13-citation-version-labels.md).
  Owner checked on production and accepted, 2026-10-13.
- [x] **F118. One source card per bill.** Versions of one bill cited in an
  answer share a card with a tag per version (owner, 2026-10-13). Built on
  `task/source-card-per-bill`, merged `46290e8`, pushed 2026-10-13.
  [Spec](../specs/2026-10-13-source-card-per-bill.md).
  Owner checked on production and accepted, 2026-10-13.

- [x] **F105. Reconcile stale documentation.** Owner approved 2026-10-13.
  - `agents/rollback-runbook.md`: all eight `verify_jwt = false` functions,
    the 2026-10-13 deploy-500 and unreadable-bundle notes, and the preview
    origin pattern.
  - `Architectures/01` and `06`: the 2,338-document and 54,219-chunk figures
    dated as 2026-09-22 snapshots, with the 2026-10-13 counts.
  - `ai-agent.md` rule 8: the retired upstream remote.
  - Nine Living plans, specs and research reports whose "uncommitted / local
    only" lines are stale got a dated reconciliation note naming the `main`
    commit. Historical records were left as written.

- [x] **F106. Retire the unused NterEarth runtime.** Owner approved
  2026-10-13. Removed `src/marketing/NterEarth.jsx` and its test,
  `public/brand/earth/nter-earth.js` (282 KB), `earth-poster.png` (450 KB),
  and the dead `.mkt-earth*`, `.mkt-login-earth .mkt-login-orb` and
  `.mkt-login-earth-control` CSS. Kept `.mkt-login-orb`, which the Forgot and
  Reset password pages still render. Lint, 2,578 tests and the build pass.
  The browser check found the homepage and login globes and the forgot/reset
  orbs intact, no requests to the removed files and no console errors.
  Merged `8ef1acf`.

- [x] **F69. Deploy F64 retrieval telemetry.** Deployed with F104 as
  `research-chat` v48 on 2026-10-13. Verified on the owner's live turn (`1e584cfc…`):
  `search_documents` recorded `requestedTopK` 40, `embeddingMs` 1,387,
  `retrievalMs` 103 and `latencyMs` 1,494. The v47 turn before it (18:54 UTC)
  has none of these fields.
  Existing turns cannot acquire missing measurements retroactively.

- [x] **F104. Deploy the retrieval section-context fix.** `a796383` (bill
  versions and continuation sections reach the model; `_shared/retrieval.ts`,
  `research-chat/{agent,index,prompt}.ts`) is in `main` since `d0a8020`, but
  the last recorded `research-chat` deploy is v47 on 2026-10-10. The review
  record says the correction is local only
  (`research/2026-10-12-corpus-integration-review.md`). Before any deploy,
  compare the live function bytes with `main`; then a separately authorized
  `research-chat` deployment and live RAG/citation checks. No re-embedding
  needed.
  - **Read-only comparison attempted, 2026-10-13.** The live code could not be
    downloaded: Supabase returned "Failed to retrieve function bundle" for v47
    to the MCP read, to the CLI `--use-api` path, and to the legacy eszip
    unpacker. Indirect evidence:
    - Live is still v47, deployed 2026-10-10 00:28 IST, with the same bundle
      hash recorded on 2026-10-10 (`a54690a5…`). It is unchanged since then.
    - v47 was built from uncommitted files, and its record lists only
      version-role edits to four files. The section-rendering correction was
      made on 2026-10-12, after v47, so live lacks it.
    - That record also says no telemetry changes were deployed. F64's
      retrieval telemetry (`8d0ba3d`, F69) is in `main` but has no recorded
      deploy.
    - Deploying `main`'s `research-chat` would therefore ship F104 and F69
      together, plus v47's version roles (already live), unless the deploy is
      narrowed.
  - **Deployed as v48, 2026-10-13 (owner: "go with option 1, deploy main").**
    - The saved v47 release source turned up at
      `~/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-version-live-20261010/research-chat-release`.
      Its recorded hashes match the v47 release. It is the rollback copy.
    - Compared with `main`, ignoring trailing newlines, seven files differ:
      - section labels on document passages (F104);
      - retrieval timing, requested top-k and cancelled status (F69);
      - research-coverage switches A (`coverageCheck`) and B (`digNudge`),
        which nothing sets. Empty prompt parts are filtered, so the system
        prompt is byte-identical.
    - Two deploys of `50dca74` (Deno 881 passed) failed with Supabase 500
      "Function deploy failed due to an internal error": one with `--use-api`,
      one by the owner without Docker. The third, `--use-api --debug`,
      succeeded.
    - Result: v48 ACTIVE, `verify_jwt` false, bundle `4adce437…`.
      Unauthenticated POST returns 401, the CORS preflight 204, and no
      function errors are logged.
    - The bundle still cannot be read back ("Failed to retrieve function
      bundle"), so byte equality with `main` rests on the deploy source.
    - Remaining: owner live RAG/citation check on a bill question, then a
      read-only check that `chat_messages.activity` carries
      `embeddingMs`/`retrievalMs`/`requestedTopK` (F69).
  - **Verified live, 2026-10-13.** The owner asked a bill question on
    production after v48. The turn (assistant message `1e584cfc…`, 19:57 UTC)
    completed on `google/gemini-3.8-flash` with six citations to the National
    Anti-Doping (Amendment) Bill, 2025.
    - Three are `document` passages whose stored sections ("CHAPTER VII ›
      MISCELLANEOUS" and two insertion notes) now reach the model; before
      v48 only page passages carried sections.
    - The model input is not stored, so that last step rests on the deployed
      code plus these source rows.
    - Side observation, not fixed: some stored section notes are garbled, for
      example "Insertion of › 22.". That is a chunking data-quality question,
      separate from F104.


- [x] **F113. Drag a record to AI from any panel tab.** A record or file
  dragged over the right-hand panel switches it to AI research (from Desk,
  Record or collapsed); a drop outside the chat or before it loads is handed
  over through `niy-ai-open`. Commit `06e1fe0`, merged `dae877b`, deployed in
  `dpl_89StSPmjxkYuVtFLdWBq7bABvDXF` (`ef4754a`). Owner confirmed on
  2026-10-13 that a dropped bill attaches in a signed-in chat.
  [Spec](../specs/2026-10-13-panel-drag-ai.md).

- [x] **F102 / F103. Client UI refinement and shared orbit globe.** Owner
  accepted on 2026-10-12 ("it's perfect") and authorized commit and local merge.
  Merged into local `main` at `f20ef35` (no-ff; branch `task/client-ui-spec`
  at `2ff385e`, tree identical). F102: cream desks/Home, top desk navigation,
  record graph removal, signup composition (`01634e4`, `d072308`, `b0ba405`,
  `35366d8`). F103: photographic globe (`9e6f12c`) plus amendments 1–5
  (`f7c6ffa`): India start, orbit rings and satellites, clean fade-in, persona
  labels at homepage spacing on sign-in/signup, no blue rim, and the same
  globe on the homepage hero. Final checks: 189 files / 2,527 tests, lint,
  build. **Not pushed or deployed**; production still serves `2a5be9c`.
  [Client UI spec](../specs/2026-10-12-client-ui/index.md),
  [auth Earth spec](../specs/2026-10-12-auth-earth.md).

- **Status reconciliation (2026-10-12):** F93, F95, F96, F97, F98, F100 and
  F101 below say "local only / no merge / no push" as of their execution.
  All their commits (`69595a5`, `9fe245e`, `66c7944`, `540f99d`, `12a148c`,
  `ec89cdc`, `70267e8`, `19ffef6`) are now in `origin/main`, verified by
  `git merge-base --is-ancestor`. Owner acceptance is not inferred from that.

- [x] **F101. Polish V6 sector selector.** Implemented locally in `19ffef6`: refined typography/surface/spacing, decorative chevron and theme/focus styling; native selection retained. All eight desks/35 options, mobile/desktop and keyboard checks, 29 focused tests, lint/build passed. [Evidence](../specs/2026-10-12-sector-selector-polish.md). Corpus untouched; no merge/push/deploy.

- [x] **F100. Restore original V6 selected-sector explorer.** Owner preview correction implemented locally in `70267e8`: original left sector details and right icon/count/coverage module cards, with approved internal sector select; all 35 picture-card defaults and 120 direct module destinations retained. 2,506 tests, lint/build/assets and eight-desk browser matrix passed. [Evidence](../research/2026-10-12-v6-explorer-restoration-local-run.md). Corpus untouched; no merge/push/deploy.

- [x] **F96. Optional landing module discovery.** Implemented locally in `66c7944`: collapsed all-module disclosure, per-sector accordions and 120 direct links across eight desks; all 35 approved picture-card defaults retained. [Evidence](../research/2026-10-12-terminal-follow-up-local-run.md).
- [x] **F97. Meaningful terminal header controls.** Implemented locally in `540f99d` / `12a148c`: disabled bell and unused icon removed, landing refresh hidden, Home/module refresh retained, sun/moon with next-action labels. [Evidence](../research/2026-10-12-terminal-follow-up-local-run.md).
- [x] **F98. Free signed-in desk access, copy and export.** Implemented locally in `ec89cdc`: all known desks/modules, no commercial row caps, no terminal Upgrade interruption or signup plan step, entry independent of subscription metadata. Account authorization, stored billing facts and AI limits retained. This owner-approved desk contract supersedes earlier commercial-lock assumptions; no backend enforcement work activated. 2,504 Vitest / 880 Deno, lint/build/assets and isolated browser matrix passed. Corpus excluded. [Evidence](../research/2026-10-12-terminal-follow-up-local-run.md). No push/deployment/main merge.

- [x] **F95. Direct desk-card entry and AI dismissal.** Implemented locally in `9fe245e`: all 35 cards link to approved defaults, all 120 sibling modules retain sector-menu access, outside clicks and landing navigation hide AI while retaining mounted chat. 2,472 Vitest / 880 Deno, lint/build/assets and desktop/mobile/dark browser fixture checks passed. Corpus changes excluded. [Evidence](2026-10-12-desk-direct-entry.md). No push/deployment.


- [x] **F93. Legacy landing UI cleanup.** Removed the approved 12 unused files in `69595a5`; lint, build, assets, 2,468 Vitest and 880 Deno tests passed, all 318 build outputs unchanged. [Evidence](2026-10-12-unused-landing-ui.md). Local only; corpus changes excluded.


- [x] **F88/F90/F91/F92. Desk v6 integration, canonical restricted handoffs, shared-shell alignment and explorer readability.** Owner authorized main publication on2026-10-08 after disclosure of unchanged P12 dependency risk. Verified candidate453f8ec merged into main at `d480b11`; eight desk landings including State, catalogue/search, source-backed summaries, exact images and preserved canonical module workspaces. Final2,465Vitest/862Deno,lint/build/router/assets pass; independent review and native zoom/reduced-motion/intentional coarse-pointer/hidden-tab acceptance complete. Voice remains explicitly owner-deferred under F76. [Release evidence and rollback](2026-10-08-desk-v6-release-candidate.md). Task branches retained; F93 optional old-code cleanup and P12 remain separate.

- [x] **F79. Homepage spherical Earth replacement.** Implementation `071cd13`, original isolated evidence `43c7690`. Owner authorized remaining branch integration/publication and local/remote cleanup on 2026-10-05. Combined desk/Earth code passed 2,160 Vitest tests, 862 Deno tests, lint/build/router import and homepage Chrome pause/resume smoke. See the release amendment in [plan](2026-10-04-earth-replacement.md). Existing F80 trivia overflow remains separate.

- **2026-10-04, F68 recovery cleanup — 071cd13:** Archived and hash-verified all 16 old worktrees plus their branch history, then removed them with owner authorization. Only main remained before creating task/earth-replacement. Remote has only main. Recovery archives remain local under .git/local-archives/2026-10-04-earth-preparation/. [Evidence](2026-10-04-earth-replacement.md).

- [x] **F81. National landing redesign.** Completed in the verified stacked release: implementation/fidelity and signed-in route evidence through `49aef80`, final polish/environment verification `1ad22d0`. Twelve canonical routes, real summaries, sampled-question disclosure, bills by sector and shared navigation. Owner authorized main integration and push on 2026-10-05. [Final evidence](2026-10-05-desk-landing-release-verification.md).
- [x] **F82. Global landing redesign.** Implemented and verified through `9eb4637`; final release checks `1ad22d0`. Sixteen routes, reference artwork/motion, real source-coordinate map and coverage-aware totals; illustrative commodity prices excluded. [Final evidence](2026-10-05-desk-landing-release-verification.md).
- [x] **F83. Law landing redesign.** Implemented `b3a781f`; final release checks `1ad22d0`. Twelve routes, reference artwork, source summaries and shared Supreme Court dedup. Reporting-feed limitations disclosed; F84 remains separate. Owner corrected State scope to Law. [Final evidence](2026-10-05-desk-landing-release-verification.md).
- [x] **F85. Cross-desk final polish audit.** Fixed singular module counts and tour guidance in `1ad22d0`. Reference row grid deliberately retained. Native reduced motion across three desks, coarse-pointer disclosures and actual hidden-tab lifecycle executed. Full 2,152 Vitest/862 Deno tests, lint/build/router import and whitespace checks pass. [Evidence](2026-10-05-desk-landing-release-verification.md).
- [x] **F86. Login globe and compact desk headers.** Landed in `6d4b66e`; owner authorized merge/push on 2026-10-07. Reused homepage Earth on login; compacted three desk headers. 2,160 tests, lint/build passed; browser evidence and limitations in [plan](2026-10-07-login-globe-compact-desks.md).

- [x] **F78. Publish F77 microphone waveform UI.** Owner instruction “pushed”; main pushed to 9b159f0. Vercel production dpl_BnzKVUC38fHqSxftdX2RuAjWSB9G READY with niyantran-six.vercel.app alias. No backend redeployment required. Actual microphone acceptance remains F76.

- [x] **F77. Live microphone waveform UI.** `bd37d43`: real microphone energy history and elapsed time; cancel/stop/transcription states replace existing toolbar without height growth, reduced-motion meter, sending blocked during dictation. 2,103 tests/lint/build and responsive browser checks pass. [Evidence](2026-10-04-dictation-waveform.md).

- [x] **F74. Publish and activate OpenRouter dictation.** F75 published at f346ab8; Vercel production READY, transcribe-audio v1 ACTIVE, existing OpenRouter secret present. Live auth/CORS and synthetic English/Hindi provider probes pass. Browser acceptance is F76. [Release evidence](2026-10-04-dictation-activation.md).

- [x] **F75. OpenRouter Whisper dictation.** `d352997`: uses openai/whisper-large-v3-turbo and existing server-side OPENROUTER_API_KEY. 2,100 Vitest / 862 Deno tests, lint/build and function compilation pass; provider/credential guards proved red first. Live activation remains F74. [Evidence](2026-10-04-openrouter-dictation.md).

- [x] **F73. Editable copy, grouped command search and Whisper dictation.** Local commits `75bddf3`, `a60e2cf`, `2ac4850`: native input/editor copy skips Upgrade; accessible Desks/Modules/Records groups with 300ms-debounced cancellable snapshot lookup; shared microphone controls append editable text in command search and chat; authenticated active-account endpoint calls OpenAI whisper-1 directly. 2,100 Vitest and 861 Deno tests pass, lint/build pass (existing mixed-import/large-chunk warnings), local Chrome fixture passes at 320–1440px with mocked audio/provider. Production activation is F74. [Plan and evidence](2026-10-04-command-search-dictation.md).


- [x] **F72. Compact chat footer.** `a5bc525`: tighter attachment/composer
  spacing, subtle blue follow-up pills; 28.19px saved in browser fixture with
  control sizes preserved. 61 focused checks, lint/build and light/dark browser
  checks passed. Published in `660977e`; Vercel READY (2026-10-04).
  [Plan](2026-10-04-compact-chat-footer.md).

- [x] **F71. Chat reading space and durations.** `3455988`: shared 50% dock
  default, wrapping tables and known Searching/Processing/Writing durations
  instead of user-facing reasoning tokens. 2,090 frontend tests, lint/build
  and isolated browser geometry checks passed. Published in `660977e`; Vercel READY (2026-10-04). [Plan](2026-10-04-chat-reading-space.md).

- [x] **F70. Live activity disclosure.** `899b47a`: opens while generating,
  closes on completion and preserves manual toggles within each phase.
  2,089 frontend tests, lint/build and isolated browser lifecycle check passed.
  Published in `660977e`; Vercel READY (2026-10-04). [Plan](2026-10-04-live-activity-disclosure.md).

- [x] **F63–F65. Chat presentation, activity metadata and research flow.**
  Owner authorized integration/publication on 2026-10-04. Combined code through
  `0638dbd` (24 commits beyond prior main), including F63 `3be5117`, F64
  `8d0ba3d`, F65 `f47ccb4` and amendments through `3c0a02e`. Full checks:
  2,089 frontend tests, 856 Edge Function tests, lint/build and router import
  passed. Landed and pushed on main at `75b521d`; exact Vercel deployment READY.
  F64 backend deployment tracked as F69.
  [Consolidation record](2026-10-04-main-consolidation.md).

- **2026-10-04, F60 frontend defects, verified locally on UI branch:**
  `8cfe0a4`, `7e51a0c`, `9c9fb27`, `9b5ecfb`. AI reading space, popover
  keyboard/focus, attachment/save feedback, stale briefs, desk selection and
  marketing/admin accessibility repaired. 2,068 Vitest and 854 Deno tests,
  lint/build, independent review and offline browser checks passed.
  `task/f60-ui-defect-fixes` retained; no push/deployment or owner acceptance
  inferred. [Plan, exact evidence and limits](2026-10-04-ui-defect-fixes.md).

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

- [ ] **P12. Advisor findings and the dependency audit** (checked 2026-09-29): *2026-10-14 (F171 B6, `28c8fc6`, `eeb9ccd`): `xlsx` is SheetJS 0.20.3 from the vendor's distribution, `npm audit --omit=dev` clean; parsing capped at 10 MB and 5,000 rows a sheet. npm audit no longer tracks SheetJS (URL dependency): check https://cdn.sheetjs.com for releases when touching it. Still open: the Vite/Vitest majors and the RLS advisor items below.*
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
  *2026-10-15 (owner: "P12 speedup, go ahead"; `033f4af`): migration 55 `20261015190000_rls_initplan_fk_indexes` applied to NTER with `supabase db push`: the twelve policies read `(select auth.uid())` once per statement (a pre-check refuses if any live policy differs), and the eight unindexed foreign keys have covering indexes. Checks: `npm run test:sql` 34 fixtures pass, the new one fails without the migration; live: 0 bare `auth.uid()` policies, 8 indexes; the security advisor shows only the accepted findings. Left open here: the Vite 7 / Vitest 4 upgrade (developer tooling, no reader-facing speed); unused indexes and multiple permissive policies stay as recorded.*
- [x] **F30. The other hand-written marketing figures** *(2026-10-14: "9,819", "211+" and "99.9%" are gone (F142); "12 Desks" fixed to 8 and tied to the desk list (F171 B10, `df556a4`). The homepage preview cards' sample figures are on the client's list, F144.)* (found while doing
  P16). They weren't part of P16's approval:
  - `src/marketing/HomePage.jsx` shows "9,819" bills in four places (lines
    36, 290, 584 and 736); the carousel now says 9,817 unique bills;
  - "211+" live API endpoints (`HomePage.jsx:286` and `:727`, and
    `PricingPage.jsx:135`);
  - "UPTIME 99.9%" (`HomePage.jsx:294`, `PricingPage.jsx:143`), which nothing
    measures.
  *Closed 2026-10-15: superseded by F142 (live figures), F171 B10 and F144; `src/lib/siteFigures.test.js` fails if the old hand-written figures return.*

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

- [x] **R4. `ingestion-v2`** (spec `specs/2026-10-01-rag-v2-ingestion-v2.md`,
  approved; plan `plans/2026-10-01-rag-v2-ingestion-v2.md`):
  - a private `corpus` bucket, content-addressed by file hash;
  - a job-table queue (skip-locked claims, lease, fencing), with a pg_cron
    timer switched on by the owner;
  - the `ingest-worker` Edge Function running Mistral OCR in page ranges and
    indexing slice by slice;
  - first extractions only.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

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
  - **Verified code integrated (2026-10-12):** the reviewed 12-commit corpus stack landed on local and origin/main at `d0a8020`, preserving the released UI and Download fix. Supervisor reruns passed 2,506 application, 881 Edge and 113 corpus tests, lint/build, and 22 SQL fixtures with 22 non-vacuity checks. Original shared copies are retained in a verified external backup. No Edge Function deployment, migration, source release or ingestion restart; R7 holds remain open. [Integration evidence](../research/2026-10-12-main-consolidation.md).
  - **Latest scope, owner requests larger batches toward the full corpus:** reconcile all Citation Pack categories and select the next up-to-500 absent bill cohort beyond the earlier 500-source pool. Use deployed mapping and full quality/operational gates; keep nonbill scoping and actual failures separate. Current runtime preparation is `corpus-wide-20261011/`; no new readiness count is claimed before review.
  - **Latest owner continuation, completed 2026-10-11:** next 180 identity/version candidates screened; 32 reviewed same-Download sources / 588 context chunks ingested and independently audited, including 208 final scoped citation probes. Global 3,021 documents / 3,018 indexed / 92,538 chunks / 1,730 covered bill keys; exact deltas and planner counts pass, zero orphan/null vectors. Usage 57,972 tokens / USD 0.00115944. Original 500-source pool: 252 complete, 248 pending (this review's 119 validation/quality holds +29 remaining body/version reviews, prior 88 quality +2 missing-text +10 mapping holds). [Next-set run evidence](../research/2026-10-11-corpus-next180-run.md). `job-next180-v1` and all earlier completed manifests must never restart; no unfinished ready release remains. Existing-source repair holds are untouched.
  - **Next set, owner continuation (2026-10-11):** review the remaining 97 identity and 83 version candidates from the existing 500-source pool, reconcile fresh live absence/current Download mapping, and ingest every independently passing source in one new bounded job. Preserve completed releases and the 88 + two earlier quality holds; revisit a hold only with new evidence. Active corpus-batch-blockers spec/plan extended for this continuation; no deployment, original edit, existing-source replacement or guard waiver.
  - **270-source single job COMPLETE (2026-10-11 03:41 UTC):** all 270 reviewed; 182 ingested in one frozen job with 3,611 full v4 chunks and 1,532 final scoped citation probes, all independently audited. 88 source-specific holds remain aside. Live 2,989 documents / 2,986 indexed / 91,950 chunks / 1,698 covered bill keys; zero orphans/null vectors, planner exact. `job-reviewed270-v1/stage-01.release.json` SHA `e21a71b4fcd2d172447c66f91b897df1e60de1d14b79230ff68d18f60088668b` is COMPLETE and must NEVER restart. [Final evidence](../research/2026-10-11-corpus-270-reviewed-run.md). Within the earlier 500-candidate pool, 220 complete (38 prior +182 here), 280 remain: 88 current holds, two prior missing-text holds, 97 identity reviews, 83 version reviews, 10 mapping holds. Preserve existing-source repair exclusions; R7 remains open.
  - **Production mapping and larger ingestion completed (latest 2026-10-11):** [verified execution](../research/2026-10-11-download-mapping-production-run.md). Only resolver + companion deployed from isolated production baseline; served hashes and 19,634-row deployed-function replay pass. Two releases added 38 documents / 436 complete v4 chunks / 38 covered bills; all vectors/spans/context/mapping and 118 scoped citation probes pass. Live totals 2,807 documents / 2,804 indexed / 88,339 chunks / 1,516 covered keys; zero orphans/null vectors, planner exact. Both job-quality18 and job-quality20 releases COMPLETE: never restart. Of 500 candidates: 38 complete, 2 missing-scanned-text holds, 270 pending full quality review, 97 identity reviews, 83 version reviews, 10 mapping holds. Continue passing absent sources without renewed ingestion permission; preserve existing-source and actual issue holds. Earlier deployment-pending snapshots below are historical.
  - **Passing Citation Pack subset completed (2026-10-11):** [execution evidence](../research/2026-10-11-citation-pack-passing-subset-run.md). Two absent sources, bill:2022:218 and bill:2022:220, independently mapped to current Download PDFs; 17 complete version-4 chunks, eight scoped citation probes, zero orphans/null vectors. Totals 2,769 documents / 2,766 indexed / 87,903 chunks / 1,478 covered bill keys. Completed manifest stage-02.release.json SHA a7fbe4da93456ff9834ed2b39e965bb307f23fa96d0a40bbc1dd07d943ab1faf must never restart. Two local identity bindings added; broader 3,040 proposals remain drafts and other holds remain separate.
  - **Citation Pack preflight (2026-10-11):** [executed findings](../research/2026-10-11-citation-pack-preflight.md): full 9,709-bill pool reconciled, 6,295 absent exact mapping matches, 2,408 initial screen candidates. Selected 500 all pass deployed Edge Function dry run / 11,247 chunks / zero paid usage or ingestion writes; capacity healthy. Source PDF identity passes 402; Download/version and complete quality checks remain unresolved. Owner requested findings before starting; no live release.
  - **Shared blockers and next batch (2026-10-11):** owner authorized local mapping/proof fixes and preparation only; [spec](../specs/2026-10-11-corpus-batch-blockers.md), [plan](2026-10-11-corpus-batch-blockers.md). The owner subsequently said “go Ingest” after reviewing the report: ingestion is authorized once mandatory checks pass. Zero quality-accepted sources currently exist in this batch; keep it non-executable until quality and live mapping holds are resolved. Deployment and quality waivers are not authorized. Local resolver/provenance fixes tested; [readiness evidence](../research/2026-10-11-corpus-batch-readiness.md): 500 review candidates, 81 paired PDF identity passes, 65 local identity bindings, zero release-ready. Remaining work: broader binding/coverage review, source-specific OCR/layout/table-context proof, deployed Download verification and exact owner-reviewed release.
  - **Pending corpus continuation (owner authorized2026-10-10):** [spec](../specs/2026-10-10-pending-corpus-continuation.md), [plan](2026-10-10-pending-corpus-continuation.md). Thirteen sources stored /253 full version4 chunks; live2,767 documents /2,764 indexed /87,886 chunks /1,476 covered bills, all vectors/spans/identity/citations verified. Government2023 and University2025 now have mandatory section-quality repair holds: small-cap B E enactment marker lost operative context; exact no-write correction draft10+121 chunks awaits existing-source replacement authorization. Two Appropriation sources remain accepted. All43 next-header candidates screened: Repealing2022/2023 ingested19 chunks and Deposit Insurance2021 mapped to its proven2021 key/ingested23 chunks with all seven clauses.41 remain:40 historical OCR/header holds and Coconut2021 shared-key collision. Three modern body-held sources now ingested21 chunks with both clauses recognized and independent full audit; five separate body leads remain held: four historical scans now visually reviewed with substantive OCR corruption (three pass90% identity but fail quality), plus encoded Appropriation2024. Pension1982 incomplete image-backed transcription now preserves corrigendum; distorted scan proviso requires legible independent copy before release.Two modern Lok Sabha versions now ingested14 chunks and independently audited with both clauses and six scoped citations; original Download proof resolved using independently image-backed cover assent boxes, unchanged original hashes/guards. Completed job-two-version-v1 must never restart; pool423 indexed/3 stubs/6638 absent, still mapping candidates. Next Pharmacy2023 Lok Sabha version c096aac25ab0399414247b7c4ef408e8ba1d7733 is absent and source draft passes14/14; original Download only15/17 due margin/body ordering, held with no release. Scheduled Castes2023 lead already indexed and excluded. Next Rajya Sabha Tribes2024 d5b22b9100ac0aa8b01b040bb55597b7bf30c686 and Lok Sabha JKCastes5a6ac11448aefcae53ff1d08ac87288af3b12474 source drafts pass but unchanged Download OCR fails11/13 and7/11; held/no release. Five additional already indexed leads excluded. Two AP/Industrial introduced2026 versions now ingested24 chunks with both clauses/reasons/annexures and IR financial memorandum; nine scoped citation probes passed. Completed job-introduced-v1 must never restart.15-minute heartbeat ACTIVE with context gate. [Execution record](../research/2026-10-10-pending-corpus-continuation-run.md). No original edits, deployments or waived holds.
  - **Three-source ingestion priority (owner go,2026-10-10):** [spec](../specs/2026-10-10-three-source-ingestion.md), [plan](2026-10-10-three-source-ingestion.md). Completed exact three-source ingestion after full reviewed repair/preflight:1,874 complete version4 chunks, all vectors/spans/context/identity/provenance and six scoped citation probes independently verified. Live2,754 documents /2,751 indexed /87,633 chunks /1,467 covered listing keys, zero orphans/null vectors; ANALYZE counts agree. [Execution report](../research/2026-10-10-three-source-ingestion-run.md). Owner browser acceptance and next exact queue remain. No hold waiver, original edit, deployment or existing-source cleanup.
  Finding (I7, 2026-10-01): rbidocs.rbi.org.in answers a scripted download
  with "Request Rejected", and may refuse Mistral's fetch as well. Its 76
  links need another route, such as an admin upload.
  - **Existing-text single pilot (owner-authorized 2026-10-09):** exactly one document, `bill:2025:113`, through the existing text ingestion endpoint; [spec](../specs/2026-10-09-corpus-single-pilot.md), [plan](2026-10-09-corpus-single-pilot.md). Completed after connectivity returned: exactly one indexed document (`38f15384-c4c9-45a3-8d3f-2259ba1411cd`), six real embedded chunks, original hash/spans/URL/key and scoped retrieval verified; totals now 2,341 documents / 54,346 chunks. Owner confirmed the live RAG sample worked on 2026-10-09; single-document pilot accepted. Bulk ingestion remains pending separate authorization and plan. This specific authorization supersedes R7's re-OCR requirement for this one sample only.
  - **Bulk preparation (2026-10-09):** [readiness evidence](../research/2026-10-09-corpus-bulk-readiness.md), [spec](../specs/2026-10-09-corpus-bulk-preparation.md), [plan](2026-10-09-corpus-bulk-preparation.md). Remaining screened direct-PDF inventory: 13,919 sources, including 7,064 bills. Owner authorized the first stage: 23 documents / 518 chunks ingested; final key-collision check held three, leaving 20 searchable documents / 457 chunks. Owner subsequently authorized [removing the held embeddings](../research/2026-10-09-held-embedding-cleanup.md): exactly 61 chunk rows deleted, source text/PDF URLs retained and chunking status reset for later corrected re-ingestion. [Execution and correction evidence](../research/2026-10-09-corpus-first-stage-run.md). Provider cost USD 0.00234268; runner implemented and verified. Owner browser acceptance and later cohort authorization remain pending.
  - **Owner continue/do500 eligibility refresh (2026-10-09):** [exact run evidence](../research/2026-10-09-corpus-recovered-body-run.md). Complete current two-feature screen of7,064 bill sources:327 unstored exact-Download candidates before actual-PDF approval;500 not eligible yet. Fresh79 body-hold rechecks recover71 sources /5,063 complete version4 chunks; eight body holds and two additional header failures excluded. Freeze71 under500-capacity sequential profile,USD0.42 reservation budget, fresh baseline/dry-run/metrics and independent20-document/2,000-chunk audit/ANALYZE acknowledgements. Completed71 /5,063 full version4 chunks /USD0.01581312,71 first-attempt paid writes; four independent maintenance audits/ANALYZE acknowledgements, final142 scoped citations and all vectors/spans/input hashes/Download attachments pass. Final2,576 total /2,573 indexed /72,917 chunks /1,464 covered keys (+68). Zero orphan chunks or unindexed documents retaining chunks;79 retrieval/21 capacity windows pass.256 exact-Download candidates remain unapproved. Owner natural-language RAG acceptance and resolver/version/gazette/shared-key/nonbill/oversize holds remain open; no guard relaxation or500 ingestion claim.
  - **Alternate-version mapping (owner continuing mapping,2026-10-09):** [spec](../specs/2026-10-09-corpus-version-mapping.md), [plan](2026-10-09-corpus-version-mapping.md).6,829 unstored frozen bill sources already have local text/URL/key mappings;827 share a bill with another Download version. Read-only two-PDF proof of226 ordinary alternate-version candidates /141 keys, narrow optional worker guard and context drafts. No new paid ingestion/publication in this phase. Broader wrong-bill resolver/gazette/collision/nonbill holds remain separate.
  - **Alternate-version audit complete (2026-10-09):** [report](../research/2026-10-09-corpus-version-mapping.md).226 sources reconciled:175 /116 bill keys pass two-PDF/original/listing proof,12,842 complete context chunks; all175 endpoint dry checks and corrected-worker probe pass.51 held; production unchanged2,576 /2,573 indexed /72,917 chunks /1,464 covered listing keys. All116 bill keys already covered: these add versions, zero new bill coverage.90 focused/2,465 app tests,lint/build pass; two guard-removal mutations fail as intended. Before alternate-version bulk release, separately scope explicit RAG passage version labels and owner version-specific pilot: current passage formatter omits document_role. Broader wrong-bill Download resolver/gazette/nonbill holds remain open; no new paid ingestion/backend deployment/main change.
  - **Version labeling follow-up (owner continue,2026-10-09):** [spec](../specs/2026-10-09-corpus-version-labels.md), [plan](2026-10-09-corpus-version-labels.md). Caller-scoped bounded document-role hydration and fixed passage labels, legacy/span preservation and mixed-version runtime evidence; fresh uncovered-cohort screening. Local only; no deployment/ingestion/publication in this phase.
  - **Version labeling local verification complete (2026-10-09):** [report](../research/2026-10-09-corpus-version-labels.md). Caller-scoped role hydration/fixed passage labels;175 drafts /12,842 passages preserve original text/hash/URL, mixed-version model-context probe and removed-label mutation prove behavior.154 focused/880 full Deno/2,465 app tests,lint/build pass. Fresh unstored screen6,829:6,068 sources /5,256 candidate keys lack indexed text, not verified ingestion counts. Next25 source proofs yield19 /18 uncovered keys /64 chunks, six held; zero ready until Download resolver correction. Function activation/owner mixed-version acceptance and verified legacy-role provenance remain open; no deployment/ingestion/backfill/publication/main change.
  - **Production ingestion resume completed (owner2026-10-10):** [plan](2026-10-10-corpus-ingestion-resume.md), [execution evidence](../research/2026-10-10-corpus-version-ingestion-run.md). Served research-chat v47 narrowly activates version roles; exact175 documents /12,842 complete version4 chunks ingested and independently audited with350 scoped citation probes. Final2,751 documents /2,748 indexed /85,759 chunks /1,464 covered listing keys; zero orphan chunks, exact real/planner counts after ANALYZE.1,984,754 tokens,USD0.03969508,175 paid attempts/no paid retries/unknown usage. Ten maintenance gates; sampled CPU max17.07%, available memory min38.23%; two isolated retrieval outliers, no health pause.500 is the supported job ceiling; this eligible175-version queue is exhausted and adds versions to116 already-covered bills.19 wrong-button proposals and other holds remain excluded; broader mapping and owner natural-language sample acceptance remain open. No frontend/schema/backfill/service/main publication; changes remain uncommitted.
  - **Scheduled follow-up (owner2026-10-10):** existing `check-corpus-ingestion` heartbeat updated ACTIVE every15 minutes in this chat; no duplicate writer, only eligible approved-manifest resumes with exact audits/maintenance, otherwise read-only remaining mapping investigation. Current175-doc queue is complete; held cohorts remain excluded. Monitor explicitly inventories mapped-but-absent/unindexed/unembedded sources and applies mandatory full preflight plus post-write audits; mapping alone cannot release a manifest or bypass partial-write recovery. Configuration status/interval/target and this added scope read back and verified. See the execution evidence above.
  - **Mapped-pending heartbeat investigation (2026-10-10):** [evidence](../research/2026-10-10-corpus-mapped-pending-monitor.md). Fresh live sources reconcile6,654 remaining candidates from the prior bill screen, not proven-ready counts. Of267 historical exact-URL candidates,254 have prior identity/body/Gazette holds; eleven large candidates lack receipts, and two smaller candidates freshly fail PDF-header extraction (incomplete/encoded digits/title). Rendered first-page review confirms both expected bill numbers/year/title/version; PDF.js drops/encodes glyphs, so these are potentially recoverable extraction cases. Follow-up full PDF.js body samples match23/23 and40/40, but the local corpus texts contain the same corrupt header/title/date characters. Both remain source-quality holds; alternative pypdf/pdfplumber extraction still fails the unchanged header gate. Six visually verified repair spans are now preserved in two local drafts,42 complete version4 chunks with exact source spans/input hashes and zero midword splits. Original corpus unchanged. Worker currently requires original/text hashes equal, so a verified raw-to-repaired provenance path and full preflight remain necessary; zero complete ingestion-preflight passes or paid writes. No approved unfinished job/managed locks; live2,751 /2,748 indexed /85,759 chunks, zero null/orphan vectors.
  - **Large exact-URL size screen (2026-10-10,03:55 IST):** eleven original/Citation Pack hashes and full version4 context spans/input hashes verified locally. Three fit current600k-character/800-chunk worker bounds: Social Security2019 (773), Financial Resolution/Deposit Insurance2017 (776), Bharatiya Nyaya Sanhita2023 (757); eight remain oversize. None has complete fresh preflight or an authorized manifest. Existing preflight700-chunk/older-chunker contract requires reviewed reconciliation before release; no bypass or production writes. See the mapped-pending evidence above.
  - **Three-source PDF/listing proof (2026-10-10,04:10 IST):** fresh read-only checks prove exact current two-feature Download attachments and unchanged PDF identity gates for Social Security2019, Financial Resolution/Deposit Insurance2017 and BNS2023:40/40,40/40,37/40 body samples;2,306 full version4 chunks, exact spans/input hashes, zero midword cuts. All three sources and their exact bill keys have no live documents. No released queue or writes; source-quality review, preflight contract, budget/dry-run/manifest health/capacity/release remain. Evidence in mapped-pending research; broader holds unchanged.
  - **Pending-source layout review (2026-10-10,04:25 IST):** five rendered body pages compared with original OCR and actual version4 content/input. Opening chapter/clause context is correct, but margin labels and (in introduced bills) printed line numbers remain interleaved in body prose. Exact hashes/spans do not certify reading order. Three sources /2,306 chunks remain pending quality assessment; no text repair, ready/released manifest or writes. Broader quality decision and any hash-bound repair route precede release; mapped-pending evidence updated.
  - **Existing indexed mapping-recovery inventory (2026-10-10,04:40 IST):**123 bill-feature documents lacking metadata keys already contain6,079 chunks. All123 match exact pack and individual OCR hashes;114 have pack key/URL proposals across94 keys.73 keys have unique two-feature rows,18 are absent and three have duplicates. No ready metadata correction or reupload: current Download/PDF/identity and complete legacy chunk/vector recovery proof plus narrow authorization required. Separately107 indexed bill docs /79 metadata keys lack either current listing;1,543 metadata keys versus1,464 current listing-covered keys is confirmed. Three stubs remain0 chunks, two page-OCR records121 chunks; global structural indexing/vector-dimension/span-presence checks pass, not a full semantic/vector audit. See mapped-pending evidence; no metadata/data writes.
  - **Missing-key recovery Download refresh (2026-10-10,04:55 IST):**88 existing indexed candidates /73 unique two-feature keys refreshed read-only.7 match row identity/exact current Download;80 differ/miss Download,1 identity mismatch. Pack-level URL relationships for80:55 other mapped keys,15 same-key other source requiring two-PDF proof,9 missing/multiple,1 not in pack. Seven still need PDF/year/version/source-quality/full legacy chunk-vector audit and exact authorized metadata recovery; zero recovery/ingestion-ready releases or writes. See mapped-pending evidence; never upload these already-indexed sources again.
  - **Seven recovery-PDF checks (2026-10-10,05:10 IST):** all7 exact-Download candidates remain automatic header holds:6 scanned PDFs have no extractable text,1 only128 characters. Rendered first pages match5 expected bill headers;2 differ in title (2003:63,1996:49), requiring independent version/title provenance proof. No full-body OCR/legacy-vector proof or approved alias/recovery; already-indexed sources must not be uploaded again. Zero OCR/embedding/metadata writes, no ready release. Evidence in mapped-pending research.
  - **Seven-source legacy integrity (2026-10-10,05:25 IST):** complete readback178 vectors/chunks:1536 finite/nonzero vectors, exact raw spans and v1 hash identity. Historical3a1e565 chunker reproduces all7 expected deduplicated sets exactly;23 duplicate hashes explain the127-chunk source's index gap (not a missing-write conclusion). PDF scan/body/source-quality and two title-provenance holds remain; missing-key metadata untouched, no scoped-attachment approval or ready recovery release. See mapped-pending evidence; no paid requests or writes.
  - **Full short-scan review (2026-10-10,05:40 IST):** visually compared all4 PDFpages for existing indexed candidatebill:2019:3 with its full stored OCR. Operative body appears complete; bill-number headers/marginal labels/back-page imprint and some quote punctuation omitted. Prior3-chunk/v1 vector audit intact. Automatic scan hold and missing metadata key remain; reviewed scan/quality/attachment recovery and exact authorization required, no duplicate ingestion or production writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0540.
  - **Full RBI scan quality hold (2026-10-10,05:55 IST):** all4 pages of existing indexed candidatebill:1991:3 reviewed. Operative clauses appear complete, but numeric/mixed-script OCR noise after clause3 is embedded in legacy chunk1; faint mirrored bleed-through visible on scan. Two-vector structural audit does not establish clean text. Source-quality/repair and exact attachment recovery required; no writes or duplicate upload. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0555.
  - **Full1992 scan context hold (2026-10-10,06:10 IST):** all5 pages of existing indexed candidatebill:1992:LXXX reviewed. Operative/statement/annexure body appears present; retained line digit, broken nominated word, moved margin label and omitted statement heading are embedded context defects. Suspicious statement wording matches printed source and must not be guessed away. Eight prior v1 chunks structurally complete; quality/scan/attachment recovery remains held, no writes. See mapped-pending report andcorpus-monitor-20261010-0610.
  - **Full1971 scan quality hold (2026-10-10,06:25 IST):** all5 pages of existing indexed candidatebill:1971:173 reviewed. Main clauses appear present, but separate margin headings inserted into clauses2/3 and clause(1) misread as clause(i) are embedded defects; regulations remains split across pages. Eight historical-v1 chunks structurally complete; source-quality/scan/attachment recovery held, no writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0625.
  - **Full2003 scan dual hold (2026-10-10,06:40 IST):** all4 pages of indexed candidatebill:2003:63 reviewed. OCR and PDF both say Ninety-second; listing says One Hundredth, requiring independent version/title provenance. Clause2 lead reordered and literal HTML image markup embedded; two structurally complete v1 chunks do not certify context quality. Title/quality/scan/attachment recovery held, no writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0640.
  - **2003 official title-change evidence (2026-10-10,06:55 IST):** primary Lok Sabha reference indexed passage/page337 explicitly records Bill63/2003 formal short-title change One-hundredth→Ninety-second on22Dec2003, corroborated by High Court index. Direct capture timed out; hash-bound reviewed alias/recovery proof still pending. Separate scan-vs-official assent-date annotation conflict preserved; OCR markup/order hold remains. No metadata/embedding writes or release. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0655.
  - **1996 severe OCR hold (2026-10-10,07:10 IST):** indexed candidatebill:1996:49 contains805 repeated nonsense-phrase occurrences/mixed-script prefix before readable title at offset10,366, embedded in legacy chunks. Three of9 PDFpages visually reviewed show readable operative English/bleed-through;28 structurally valid v1 chunks do not certify quality. Full recovery and exact title provenance remain pending, no alias/metadata/vector writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0710.
  - **2005 sampled reading-order hold (2026-10-10,07:25 IST):** indexed candidatebill:2005:LXXIX PDFpages4–5/34 confirm definitions(i)/(h) reversed in raw text and lowercase(l) label stored as capital(I); both definitions present.127 expected deduplicated legacy chunks remain complete;23removed duplicate hashes explain index gap, not semantic quality. Broader PDF/source-repeat/quality review and exact recovery remain pending; no writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0725.
  - **Recovery inventory consolidation (2026-10-10,07:40 IST):** fresh seven-source live IDs/hashes/indexing/counts confirm178 existing chunks, zero null vectors and missing key/fileURL unchanged. Hash-bound draft inventory separates full versus sampled quality evidence; all7 held/execution_authorized:false,0ready, no duplicate-upload eligibility. Subset of123 indexed missing-key sources, not added absent-source coverage. Current readiness table in mapped-pending monitor, corpus-monitor-20261010-0740; no writes.
  - **Alternate-version recovery review (2026-10-10,07:55 IST):** fresh unique two-feature listing for bill:2024:98 confirms Download differs from indexed source367cda61. Both public PDFs cached/hashed; visual covers show98-C/2024 Lok Sabha versus98-F/2024 both Houses, latter title2025. Source is a16-page scan with no extractable text; original OCR starts at clause2 and lacks page1 clause1 short-title/commencement phrases. Existing49chunks/zero null vectors remain missing key/fileURL; no reupload/recovery release. Full body/quality, reviewed repair provenance, two-version title proof, legacy audit and authorized recovery remain pending. Evidence corpus-monitor-20261010-0755; no writes,0ready.
  - **Bulk pending preparation refresh (2026-10-10,10:56UTC):** full7,064 pool/source presence and19,634 current two-feature listing rows reconciled;423 indexed-present/3 recovery/6,638 absent, not readiness counts. Current Download screen254 exact URLs,5,098 differing URLs and1,286 mapping/identity holds;254 include193 Gazette/61 ordinary leads.68 alternate-version source/Download archive/pack hashes and complete local context screens,24 paired PDF identity checks; two Repealing2022 pairs pass identity only and require full image-backed quality/manual-year/version proof before release. Batch ledger /private/tmp/corpus-bulk-screen-20261010; no ingestion/provider calls or new ready manifest. Continue batch preparation with all gates. [Evidence](../research/2026-10-10-pending-corpus-continuation-run.md).
  - **Extended bulk quality screening (2026-10-10,11:11UTC):**51 additional absent version candidates raw/archive/pack/context checked,7 PDF pairs screened. Three larger sources independently pass unchanged source/Download identity: Aircraft Objects2025 /Indian Ports2025 /FinanceNo2 2024,206/297/575 local chunks (1,078 total), not stored/ready counts. Exact spans/input hashes pass, but12 sampled image pages reveal margin/line-number interleaving, incomplete clause-prefix recognition and financial-table column reconciliation requirements. Full hash-bound quality/context proof pending; no release/pay/write. Evidence /private/tmp/corpus-bulk-extended-20261010-1111; prior Repealing2022 manual-year/version-contract hold unchanged. [Execution record](../research/2026-10-10-pending-corpus-continuation-run.md).
  - **R7 listing-link blocker:** fix and verify the bill analysis fallback join, which omits year and currently resolves 4,584 remaining bill-source candidates to a URL associated with another bill key in the pack. Separate valid document-version differences from wrong-bill links; never treat all different URLs as wrong. Keep missing/unproven links, 93 current-identity holds, 53 oversized bills, and two failed first-stage PDF identity probes on hold. Also resolve the three first-stage shared-key/different-title collisions (2025:109, 2025:111, 2026:107) before releasing the held documents; the runner now rejects such keys. Nonbill scoping and measured capacity gates remain required before later cohorts.
  - **Trackable existing-text job plan (2026-10-09):** [spec](../specs/2026-10-09-trackable-corpus-jobs.md), [ordered plan](2026-10-09-trackable-corpus-jobs.md), [read-only refresh](../research/2026-10-09-trackable-corpus-inventory.md). Of the earlier 524 exact-URL candidates, 23 are already stored, 35 additional sources have ambiguous shared keys and two failed PDF checks. Remaining 464 candidates: 347 small and 117 medium; all still need actual-PDF preflight before release. J1–J8 cover manifest preparation, bounded worker, partial-write reconciliation, restart supervision, capacity verification and separately authorized execution. Start with one worker, proposed stages of at most 25 documents / 1,000 chunks; no new ingestion, paid provider calls or service installation during planning. Current totals rechecked: 2,364 documents / 2,361 indexed / 54,803 chunks. Mapping fixes for excluded cohorts need not block preflight of the clear subset.
  - **Job implementation/preflight (owner “go”, 2026-10-09):** [executed evidence and release proposal](../research/2026-10-09-trackable-corpus-job-preparation.md), [operator guide](../operations/corpus-jobs.md). 347 small sources checked against original text/pack/current listings/PDFs: 91 pass (2,350 chunks), 256 held for internal evidence review (145 gazette identity, 63 body comparison, 42 header, three title, three version). Generic worker/reconciliation and foreground supervisor implemented; 46 focused checks, 2,465 application tests, lint/build pass. First proposed stage 25 documents / 681 chunks (24 newly covered bill keys) passed no-write endpoint checks; exact release approval pending, with USD 0.08 budget and post-stage ANALYZE. J7/J8 unexecuted; no service installed or new vectors produced. CPU telemetry unavailable, so first release must be supervised. The 117 medium, 35 additional key ambiguity, two prior PDF failures and three text-only holds remain pending; do not classify all preflight holds as client-data blockers.
  - **First released trackable-text stage (owner-authorized 2026-10-09):** [execution evidence and two RAG samples](../research/2026-10-09-trackable-corpus-stage-01-run.md). Completed 25 documents / 681 chunks; all source hashes, bill keys, listing Download PDFs, vectors, citation spans and scoped retrieval verified. 24 newly covered bill keys; totals 2,389 documents / 2,386 indexed / 55,484 chunks / 1,281 covered bill keys. Receipts: 112,646 embedding tokens / USD 0.00225292; no failures or unknown usage. ANALYZE and planner-count checks passed; all 27 retrieval health windows passed. Paused for owner chat/citation tests before any next stage; 66 other passing small sources remain. No persistent service or new cleanup.
  - **Second trackable-text stage (2026-10-09):** owner confirmed first-stage RAG works and instructed “Working, continue.” [Executed evidence](../research/2026-10-09-trackable-corpus-stage-02-run.md): 25 documents / 693 chunks completed, all source/link/vector/span/bill-scoped retrieval checks passed, 25 newly covered bill keys. Receipt cost USD 0.00215422; no failures/retries/unknown usage. ANALYZE and 27 health windows passed. Current totals: 2,414 documents / 2,411 indexed / 56,177 chunks / 1,306 covered bill keys. Stopped at batch boundary; 41 passing small sources remain, no later release/service/cleanup.
  - **Final approved subset completed (2026-10-09):** [execution evidence](../research/2026-10-09-trackable-corpus-final-run.md). Owner-authorized modest increase to 30-document cap; final 41 / 976 chunks completed as 30 + 11. All mappings, Download PDFs, vectors/spans/scoped retrieval verified; 40 new bill keys, no failures/retries/unknown usage, receipt cost USD 0.00322986. 45 health windows and ANALYZE passed. Full approved 91-source queue complete (2,350 chunks / 89 newly covered bill keys). Current totals 2,455 documents / 2,452 indexed / 57,153 chunks / 1,346 bill keys. 48 focused checks, 2,465 application tests, lint/build passed. Broader holds/medium/other cohorts remain open; no service/deployment or main change.
  - **Medium corpus investigation completed (2026-10-09):** [readiness report](../research/2026-10-09-medium-corpus-readiness.md), [spec](../specs/2026-10-09-medium-corpus-preflight.md), [plan](2026-10-09-medium-corpus-preflight.md). All 117 audited: 48 pass /10,093 chunks /48 currently uncovered bill keys; all 48 no-write endpoint checks pass and no embedding clamp affects them. 69 held for internal evidence review (47 gazette,16 body,4 header,1 title,1 version); no concrete client-input blocker established. Eight lower-risk passes /672 chunks require only a tested character-limit increase to75,000; exact83-chunk Immigration2025 pilot and seven589-chunk follow-up proposals frozen, execution unauthorized. Live worker unchanged;51 focused checks,2,465 application tests,lint/build pass. No ingestion/embedding charge; production remains2,455 documents /2,452 indexed /57,153 chunks. Medium execution and hold review remain open.
  - **Existing-text context correction (owner requested 2026-10-09):** [spec](../specs/2026-10-09-text-section-context.md), [plan](2026-10-09-text-section-context.md). [Local implementation/evidence](../research/2026-10-09-text-section-context.md): explicit version-4 context ingestion, original spans, context-aware vector identity, section-bounded packing and whitespace fallback; legacy/page regressions unchanged. 65 focused Deno,59 focused Node,874 full Deno,2,465 application tests,lint/build and two non-vacuous local SQL fixtures pass;91-chunk fake-vector local storage/visibility probe rolled back.48-source refreshed audit:10,689 chunks; six fit bounded worker (518 total), Immigration pilot91/follow-up427 proposals frozen and unauthorized. Production remains2,455 documents /2,452 indexed /57,153 chunks, zero version4. Function activation and owner RAG pilot pending exact release; no broad re-embedding authorized.
  - **Context pilot release completed (owner “go”, 2026-10-09):** [execution evidence](../research/2026-10-09-text-context-pilot-run.md). Only `ingest-documents` deployed as version19; Immigration/Foreigners2025 (`bill:2025:22`) indexed with91 complete context-aware chunks, original text/PDF/listing identity preserved. Independent vector/hash/span/section and real bill-scoped retrieval/text-citation checks pass. One provider request,13,105 tokens,USD0.0002621; no retries or unknown usage. ANALYZE completed; current totals2,456 documents /2,453 indexed /57,244 chunks /1,347 covered listing bill keys. One transient slow pre-write health window recovered; no consecutive-window pause. Owner natural-language RAG acceptance pending; five /427 follow-up remains unauthorized. No broader re-embedding, scheduler, merge or push.
  - **Owner RAG acceptance and follow-up release (2026-10-09):** Owner confirmed the context pilot worked and instructed continuation. Five prepared context documents /427 chunks now authorized under the existing USD0.08 supervised manifest; fresh baseline and all no-write checks passed. Larger42 sources, identity holds and broad re-embedding remain outside this release.
  - **Context follow-up completed (2026-10-09):** [execution evidence](../research/2026-10-09-text-context-follow-up-run.md). Five complete documents /427 chunks /five new covered bill keys, all mappings, source/input hashes, spans, vectors and real scoped retrieval/text citations verified. Five live attempts, six provider requests,66,738 tokens,USD0.00133476; no retries or unknown usage. All nine health windows passed; ANALYZE counts agree. Current totals2,461 documents /2,458 indexed /57,671 chunks /1,352 covered listing bill keys. Full bounded context cohort six /518 is complete;42 verified larger sources /10,171 context chunks require measured larger-document policy;69 medium holds remain open. No code/deployment/merge/push or broad re-embedding in this stage.
  - **Next50 preflight (owner requested2026-10-09):** [plan](2026-10-09-next-50-preflight.md). Read-only audit of42 remaining prior medium passes plus eight non-gazette held candidates, selected by ascending legacy chunk count/source key. Refresh original text/pack/current listing/live PDF checks and version4 spans/context/endpoint dry runs. No ingestion or guard expansion in this task; all50 must reconcile to evidence/holds and worker capacity.
  - **Next50 preflight completed (2026-10-09):** [evidence](../research/2026-10-09-next-50-preflight.md). Exact50:42 refreshed original/pack/listing/PDF identity passes and eight unchanged internal holds (six body,one version,one header). All42 context endpoint dry runs pass:10,171 chunks, zero word-interior cuts/input clamps. Actual worker guard rejects every source (103–790 chunks);38 exceed75,000 characters. Estimated embeddingUSD0.04360756, one-attempt byte reserveUSD0.17527916; no charges/writes. Counts unchanged2,461 /2,458 indexed /57,671 chunks. Tested larger-document worker reads/limits and progressively measured release remain required; no truncation or50-source one-shot capacity claim.
  - **Larger worker (owner Continue,2026-10-09):** [spec](../specs/2026-10-09-medium-worker.md), [plan](2026-10-09-medium-worker.md). Explicit context-only medium profile, bounded paginated full-chunk reads; default small/stage guards preserved.63 focused checks including real120-chunk multi-commit/lost-response/partial-hold integration,2,465 application tests,lint/build passed. First progressively measured pilot: Bharatiya Vayuyan2024 (`bill:2024:74`),103 chunks,USD0.015, fresh checks pending. Other41 and eight holds remain outside this pilot release.
  - **Larger worker/first pilot complete (2026-10-09):** [evidence](../research/2026-10-09-medium-worker-pilot.md). Explicit medium_v1 context profile800/600,000, complete bounded pagination; small/stage guards intact.63 focused checks incl actual120-chunk multi-commit lost-response/partial-hold and101-row defect mutation,2,465 application tests,lint/build pass. Bharatiya Vayuyan2024 (`bill:2024:74`) ingested103 complete verified chunks,USD0.00032406, no retries/unknown usage; five health windows and ANALYZE pass. Current2,462 documents /2,459 indexed /57,774 chunks /1,353 covered listing bill keys. Remaining41 /10,068 context chunks require progressively measured release; eight identity holds excluded. No deployment/merge/push/cleanup.
  - **Remaining41 progressive release (owner Continue,2026-10-09):** [plan](2026-10-09-medium-worker.md).13 frozen ascending-size stages /10,068 chunks,USD0.08 stage ceiling, full fresh identity/PDF/price/health/dry checks and independent audit/ANALYZE/count acknowledgement between stages. Eight identity holds excluded. Foreground only, no code/deployment/service/cleanup; halt on failed verification or partial state.
  - **Remaining41 progressive release completed (2026-10-09):** [evidence](../research/2026-10-09-medium-progressive-run.md).13 ascending-size stages,41 sources /10,068 complete version4 chunks /41 new covered keys; all vectors/source/context/spans/Download identity and82 scoped citation probes verified.1,647,072 tokens,USD0.03294144,41 live attempts/129 prepared provider batches, no paid retries or unknown usage.93 health windows passed; all post-stage ANALYZE/planner/count checks match. Stage9 read-only timeout recovered without paid retry. Final2,503 documents /2,500 indexed /67,842 chunks /1,394 covered listing keys. Approved48 medium sources /10,689 context chunks now complete; next50 audit resolves42 ingested plus eight unchanged holds.69 medium identity/body holds and other R7 cohorts remain open; owner natural-language sample acceptance pending. No implementation/deployment/service/merge/push/cleanup in this execution.
  - **Identity-hold investigation (owner continue,2026-10-09):** [plan](2026-10-09-identity-hold-review.md).54 header/title/version holds selected across small/medium; preserve fresh PDF/source diagnostics and recheck original hashes/current listing Download identity. Read-only first; no threshold relaxation, guessed mapping, OCR/embeddings or cleanup. Gazettes/body disagreements/shared-key conflicts remain separate.
    -54 fresh diagnostic failures preserved; local figure-dash parser defect corrected with red/green regression proof,65 focused checks and2,465 app tests plus lint/build. Corrected cached review:43 header /4 title /4 version /3 body holds, zero released. Three modern sources reach100% body agreement only in a marginal-note layout experiment; next establish and regress a justified layout rule, compare all prior passing PDFs and body holds, resolve Repealing/Amending2022-key/2023-title version identity, then fresh preflight/context dry run before release. [Report](../research/2026-10-09-identity-hold-review.md). Production unchanged2,503 documents /2,500 indexed /67,842 chunks; no new embeddings/OCR/mapping writes.
  - **Larger-batch capacity plan (owner request,2026-10-09):** [plan](2026-10-09-corpus-capacity-and-larger-batches.md). Live healthy16/90 connections, zero lock waits/deadlocks,99.038% cumulative cache hits; physical tier/CPU/RAM remains unverified (dashboard sign-in/Chrome timeout; historical2GB only). Proposed50-document queue, single writer,2,000-chunk stages after a tested explicit worker profile and1,000–1,500-chunk pilot; retain30/stage and800/document guards, context quality, reconciliation, health/cost gates and ANALYZE. Current executable1,000-stage cap unchanged; no new eligible inputs or ingestion. Complete identity/layout evidence first. No compute upgrade or parallel writer authorized by this plan.
    - **Supabase-plugin follow-up:** official metrics API now verified using two read-only samples:106s idle interval,2 visible cores, roughly2GB RAM /1GB available,1.13% non-idle CPU, disks below0.1% busy. CPU/RAM telemetry is available; billed tier remains unknown. Owner desires500-document stages; plan amended to one writer, per-document checkpoints/full verification and internal maintenance/health windows. Requires explicit tested incremental worker profile and measured load pilot; existing30/1,000 guards unchanged and identity holds remain. No ingestion or production settings changed. Evidence in `corpus-job-plan/capacity-review/metrics-{first,second,summary}.json`.
    - **Owner go:500-stage worker and recovered-source pilot complete.** [Report](../research/2026-10-09-corpus-500-worker-pilot.md), [spec](../specs/2026-10-09-corpus-500-stage.md). Explicit500/20,000/10million-char profile, one writer, live metrics guards and20-document/2,000-chunk maintenance pauses; default bounds unchanged.76 focused tests,2,465 app tests, lint/build,500-entry resume/lost-response fixture and mutation proof. Regressed marginal layout retained139/139 prior passes; fresh identity checks recovered two public Sansad sources,12 complete version4 chunks,USD0.00002810, no paid retries. Full audit/four scoped citations/ANALYZE passed; current2,505 documents /2,502 indexed /67,854 chunks /1,396 covered keys.323 small/medium holds remain; next79 body cases, unreadable headers/title/version/gazette/key cohorts. No500-source live release or sustained throughput proof; owner natural-language samples pending. No deployment/service/merge/push/cleanup.
- [x] **R8. `admin-upload`.** A platform-admin upload tab, with splitting
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
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  Then mark R8 done and make its plans Historical.

Follow-ups and findings:

- [x] **F32.** (fixed by R2, 2026-10-01) `research-chat` `documentModules` (`index.ts:265-281`)
  reads one row per document with no range. PostgREST caps a read at
  `max_rows` 1000, so modules can be missing from the list. Fixed by R2
  (`document_modules()`).
- [ ] **F33.** A document picker (title search), to focus on a document no
  answer has cited yet.
- [ ] **F34.** Let the model choose a desk filter itself. It needs an
  answer-level evaluation first.
- [ ] **F38.** A sweeper for `corpus/staging/` objects older than 24 h, and
  for content-addressed objects no document references after a discard
  (admin-upload spec, "Follow-ups").
- [ ] **F40.** Rows in 73 of 75 desk features carry no `document_key`, so a dropped row
  from those desks can never attach its document. Only the two bill features have keys. This
  needs stable keys from the loader for every row, and a generalised client key in place of
  `billDocumentKey`. It is admin-upload Amendment A, part A4, and needs its own spec.
- [ ] **F42.** Show page numbers in the current text citation reader before the PDF viewer
  (R6) lands. Page-aware chunks already return `page_number`, blocks and the section.
- [x] **F46.** The AI Research chat experience: review `research/2026-10-02-chat-experience-review.md`
  (owner request, 2026-10-02). The owner discusses it before a spec. Confirmed defects:
  - the composer is not pinned to the bottom;
  - the thread opens at the top;
  - finished turns lose their search steps;
  - "thought" is never shown;
  - one model has two names.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

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
- [x] **F48.** The citation viewer's header is about 190 px of text buttons in the side pane. It
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
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F49.** The citation viewer cropped pages to their body text by default ("Fit text"). The
  anti-doping bill's page 1 lost its "As introduced in Lok Sabha" header and its top two thirds,
  and read as a different document from the stored PDF.
  - **Spec:** `specs/2026-10-02-viewer-whole-page.md` (owner-approved).
  - **The fix:**
    - Fit width is the default;
    - Fit text never crops the page's height or any block;
    - the zoom is saved only when the reader chooses it, under a new key.
  - **Shipped:** `4f714f8` reached production in `60b49f4` (Vercel READY, operations
    record 2026-10-02). Owner acceptance is not inferred from deployment.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F50.** Follow-ups from the viewer-continuous review (2026-10-02). None blocks the push.
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
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [x] **F51.** The sources list under an answer had no styles, so it drew as default grey buttons
  plus the storage file name (owner: "it looks like windows 98"). The owner chose the compact
  list: spec `specs/2026-10-02-source-list.md`, plan `plans/2026-10-02-source-list.md`.
  - **Built and verified locally (2026-10-02):** `2d95bf6` (content) and `2b1bdde` (styles). The
    local run is in `research/2026-10-02-source-list-local-run.md`.
  - **Shipped:** production at `5b49049` (Vercel READY, operations record 2026-10-02).
    Owner acceptance is not inferred from deployment.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*
- [ ] **F37 note (2026-10-01):** in the R6 local run, the 25-page *Budget at a Glance* `index`
  step hit the local Edge CPU soft limit once and succeeded on retry. The F37 risk shows earlier
  than 1,000 pages on a busy machine.
- [x] **F44.** *Closed 2026-10-14: already an accepted risk (section 7, "The preview wildcard in `ALLOWED_ORIGINS`"); the functions take a bearer token, not cookies. Reopen with that risk.* The shared CORS allowlist's Vercel preview pattern (`_shared/cors.ts:21-36`;
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
- [x] **P5.** Page-level citations. Now R3 and R6, for new documents. The
  2,338 existing documents keep unpaged citations (owner decision,
  2026-09-30).
  *Closed 2026-10-15: done by R3 and R6 for new documents; the 2,338 existing documents keep unpaged citations (owner decision, 2026-09-30).*
- [ ] **P6.** Reranking and hybrid keyword search, after the corpus grows.
- [x] **P7.** Affidavits (10,492 documents, 809 M characters; 5,093 current,
  100,151 pages). **Out of scope by owner decision (2026-09-30):** no links,
  personal data.
  *Closed 2026-10-15: out of scope (owner, 2026-09-30: no affidavits).*
- [ ] **P8.** Re-crawl the 716 documents that have no `file_url`.
- [ ] **P9.** Document keys for parliamentary questions and regulators;
  desk-row "cut two" (curated views, the 41 modules with no rows) and a
  refresh pipeline.
- [x] **P14.** Bill-key collisions (two documents on one `bill:<year>:<number>`
  key). Accept, or keep one document per key.
  *Closed 2026-10-15: superseded by the versions model (F116 to F118, F115 clean-up); the remaining collisions (2025:109, 2025:111, 2026:107) are tracked under R7.*



- [ ] **O6.** After F6: the Razorpay keys on Vercel, then one real payment
  end to end.
  - Added by F111 (2026-10-14; recommendations in the
    [credits plan](2026-10-14-ai-credits.md), "After launch"):
    - **Owner amendment 2026-10-18:** Free and paid accounts can buy top-ups;
      buying credits does not grant paid-model access. One-paisa denomination
      F225 precedes payment implementation. The equivalent proposed pack sizes
      become 20,000 / 50,000 / 100,000 / 200,000 / 500,000; INR prices below
      remain suggestions, not approved. The older quantities below describe
      ten-paisa credits and must not feed a new payment catalogue.
    - **Top-up packs (owner, 2026-10-14):** 2,000, 5,000, 10,000, 20,000 and 50,000 credits,
      valid 12 months. Prices set with Razorpay (suggested ₹499 / 1,199 / 2,299 / 4,399 /
      10,499). Until then there is no way to buy credits in the app; an admin can grant a top-up.
    - **Downgrade at the next cycle:** `grant_paid_plan` queues a lower plan
      until the current `plan_period_end`.
    - **Renewal dates anchored to the first paid day,** so they do not drift
      after the 31st.
    - **No auto-renew at launch** (owner decided 2026-10-14); the Terms and refund policy say so
      (F161).
- [ ] **P2.** Organisation seats, organisation billing, Razorpay
  subscriptions.
- [x] **P3.** Metering and credits (ADR 0002); an effort column in
  `model_call_logs`.
  - 2026-10-14: metering and credits are delivered by F111; the effort column
    (`model_call_logs.reasoning_effort`) landed in `787bced`. Done.

## 5. Launch

- [x] **D1. Supabase dashboard: what remains.** The Auth redirect URLs are
  done (see Done), and leaked-password protection is on (F152, owner,
  2026-10-14). Left:
  - confirm the Storage global upload limit is at least 50 MB. The
    `marketing` bucket allows 50 MB and Supabase's default global limit is
    50 MB, but no tool here can read the global setting. The O8 intro-video
    upload proves it either way;
  - optionally, Auth connections as a percentage.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  The tools can't change Auth or Storage settings safely: the CLI's
  `config push` would overwrite the whole remote config.
- [x] **O8 and A2. Signed-in smoke test on production** with a test
  account:
  - save preferences;
  - upload the intro video;
  - switch to Academic and ask one question (the answer opens with
    RESEARCH QUESTION / EVIDENCE / CHRONOLOGY).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  Agents may not create accounts or sign in on production, so this is the
  owner's. Afterwards an agent can check the rows with read-only SQL.
- [x] **D3. Paid live round.** *Done 2026-10-15 on production (owner signed in, supervisor ran it): greeting, document answer with a highlighted passage, Stop and reload, Gemini Lite medium and cross-account denial passed; defects opened as F197 to F200. [Record](../research/2026-10-15-d3-paid-live-round.md).* Five paid-model scenarios plus a
  cross-account denial check, including:
  - the first live `search_documents` turn with a highlighted span;
  - the admin persona chat on Gemini Lite, Gemini Flash and GPT Astra;
  - medium and high reasoning in production.
- [x] **O10. Vercel plan upgrade (owner).** Owner completed upgrade2026-10-18.
  Authenticated API for team_QFu1p3ObeXmlMQczPBcZb582 confirms plan=pro and
  status=active. No subscription purchase was executed from this checkout.
  [Evidence](../research/2026-10-18-nter-domain-launch-evidence.md).
- [ ] **O11. Delete the old Vercel project `niyantran-desk-reference-v6` (owner).** Its Git link was
  removed under F94 (2026-10-12); the project and its deployment history remain. Deleting it is the
  owner's action in the Vercel dashboard.
- [ ] **P11.** Whether `require_parameters` makes reasoning a hard routing
  constraint, and whether a single attachment should be capped at its
  per-document quota. Decided on D3's evidence.

## 6. Waiting on owner assets

- [ ] **O9.** Desk-landing visual inputs: National mockup received on 2026-10-04 and tracked by F81. The supplied HTML also includes Global/Law references; State and other desk visual scope remain unapproved. The National plan replaces the older spec's waiting-for-mockup assumption for National. Global implementation was authorized on2026-10-05 and is tracked in F82.
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
- **P4. Deferred agent features:** compaction, memories, user
  uploads and binary attachments, a durable queue for long turns. Not
  planned until the owner schedules them. (Web search moved to F130 on
  2026-10-13.)
- **P10.** Google sign-ups, and email sign-ups that wait for verification,
  skip the plan step and get no signup trial. They can start one from the
  upgrade dialog. Reopen if it matters commercially.
- **P13.** Two ADRs are numbered 0005. Left unless the ADRs are renumbered.
- **P15.** Two unused extension points, kept on purpose: `ai_models.params`
  and `StreamRequest.max_tokens`. Wire them up when a model needs either.
- **P17.** `reconcileSavedTurn` answers `false` both for "still locked" and
  for a repeat call; a test pins it and the only caller handles it. Reopen
  if a caller needs to tell them apart.

## Latest v6 candidate acceptance amendment — 2026-10-08

F88/F90/F91/F92 application work is verified through ca70175. Final native shared-shell zoom, reduced-motion, intentional coarse-pointer sector/module tap and hidden-tab evidence is recorded in [the release candidate](2026-10-08-desk-v6-release-candidate.md), superseding earlier pending native statuses above. Live voice remains owner-deferred under F76. Owner subsequently approved publication with “go”; candidate merged into main at d480b11. Branch cleanup remains unapproved. Fresh production dependency audit reconfirms the unchanged P12 xlsx high advisory; it was not introduced by this branch.

R7 execution update: the owner's remaining-270 review and single 182-document / 3,611-chunk ingestion job are complete and independently audited. All 88 source-specific exclusions remain aside. See [270-source final run evidence](../research/2026-10-11-corpus-270-reviewed-run.md) and the latest R7 entry above. Never restart this completed manifest or earlier completed releases. Remaining cohorts and existing-source repairs retain their documented review/authorization requirements.

R7 wider-corpus continuation: [413-document release completed](../research/2026-10-11-corpus-wide-batch.md). All 413 passing sources from the fresh 500-source cohort were ingested in one frozen job: 7,493 complete context chunks, 6,661 contextual chunks, 3,033 independent scoped citation probes passed. The other 87 candidates remain held with evidence. Final live and planner totals: 3,434 documents / 3,431 indexed / 100,031 chunks / 2,143 covered listing bill keys, zero orphan chunks and null vectors. Actual embedding usage 706,730 tokens / USD 0.01413460; all 90 capacity samples passed, peak CPU 16.12%; 15 isolated slow health samples out of 437, no consecutive slow windows, final health passed. Runtime corpus-wide-20261011/job-wide500-v1/final-completion.json binds the full audit and exact SQL evidence. Manifest stage-01.release.json SHA256 b8a987362724afab31e157f01fae72b7f9cd9dec7667db269b4caed5864c2481 is COMPLETE; NEVER restart it. Supervisor exited 0 and locks released. The pre-write fetch recovery at 40 remains documented and preserved. Broader corpus candidates, nonbill scoping, the 87 held candidates and existing-source repair holds remain open; this is not completion of R7 as a whole.

## Done — 2026-10-19 homepage browser fixes

- Homepage form identity and image dimensions released in a82bab8; exact production assets and Chrome checked. CSP report was absent in clean Incognito; no application CSP cause proved and no policy weakened. [Release evidence](2026-10-19-frontend-browser-issues.md).

## Done — 2026-10-19 authenticated browser fixes

- BBC browser CORS and fund-flow/account/admin form semantics fixed in 2593b09 and a19e2a8; release 4a0c981 is Vercel production READY and Chrome verified. [Evidence](2026-10-19-authenticated-browser-fixes.md). No data, schema or Edge deployment. Existing development dependency advisories remain F234.

## Done — 2026-10-12 consolidation




- **Corpus code consolidation (2026-10-12), `d0a8020`:** reviewed corpus code, tests and documentation integrated with the released UI on main; original copies preserved outside Git. [Evidence](../research/2026-10-12-main-consolidation.md). R7 ingestion/repair holds remain open.
- **F94 resolved (2026-10-12):** owner-authorized Git disconnect of only `niyantran-desk-reference-v6` (`prj_hlv83bVVPDlaJht0GP7njfUDhsLA`) verified `link: null`; project/deployment history retained. Actual production project still follows main. [Operations record](../research/2026-10-12-main-consolidation.md).
