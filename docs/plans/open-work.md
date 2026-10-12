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
- A new finding gets the next free `F` number (F115 is next) and goes in the
  right section.

## Current state — 2026-10-13

Checked by the supervisor with `git fetch`, `git worktree list`, the Vercel
deployment list and a fetch of the served bundle. No tests were rerun for this
note.

- **Branches:** one branch, `main`, locally and on `origin`. Local `main` =
  `origin/main` = `8a5eddb` with a clean working tree. All merged task branches
  were deleted on 2026-10-13 (owner: "clean up"), and so was the old Codex
  worktree `~/.codex/worktrees/corpus-integration` (it pointed at `d0a8020`,
  which is in `main`).
- **Production:** deploy `dpl_9k7YDwqEdbkCxqUkR9nMbYfeqMwg` (`8a5eddb`) is
  READY on niyantran-six.vercel.app. Its last code change is `ef4754a`
  (F112, F113), served as `index-D84x6f8c.js`; the commits after it change
  only docs.
- **Shipped and still open:**
  - F107: legal pages, awaiting the address and a lawyer review.
  - F109: INR billing, with migration `20261012120000` applied to NTER.
  - F110: Plan & billing panel, awaiting owner review; checkout stays closed
    (`BILLING_CHECKOUT_OPEN` unset, no Razorpay keys).
  - F112: navigation, type scale and search, awaiting owner review.
- **Shipped and done:** F113, drag-to-AI, confirmed by the owner on
  production.
- **Blocked on the owner:**
  - F111: needs a definition of an AI credit.
  - O6: live Razorpay keys.
  - F104 and F69 are done: `research-chat` v48 was deployed and verified on a
    live owner turn on 2026-10-13.
  - F106: needs approval to retire NterEarth.
- **Corpus:** last recorded 2026-10-11, not recounted: 3,434 documents /
  3,431 indexed / 100,031 chunks / 2,143 covered bill keys. R7 stays open.

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
- [ ] **F108. Legal page content is per-browser.** `privacyStore.js` and
  `termsStore.js` keep edited content in `localStorage`, so an admin edit is
  not seen by other visitors. Make published legal content shared (part of
  F107).
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
  [Spec](../specs/2026-10-12-upgrade-screen.md). Remaining: owner review, a
  Razorpay test-mode run on a preview with test keys, then open checkout after
  F111.
- [ ] **F112. Terminal navigation, type scale and search.** Owner review
  2026-10-13: no "Choose a desk" row on Home, larger highlighted desk tabs, one
  type scale on desk landings, a wider "Search desks, modules and records" box.
  The desk hero now grows to fit the larger title (amendment 1). Shipped in
  `ef4754a` (production `dpl_89StSPmjxkYuVtFLdWBq7bABvDXF`).
  [Spec](../specs/2026-10-13-nav-type-search.md). Remaining: owner review.
- [ ] **F114. Side panel collapsed by default on module pages.** Approved
  2026-10-13. A module page loads with the slim bar so the table gets the
  width; a row click opens Record; picking up a record opens AI.
  Commit `408835e`, merged `426a879`, pushed 2026-10-13.
  [Spec](../specs/2026-10-13-panel-collapsed-default.md). Remaining: owner
  review on production.
- [ ] **F111. AI credits.** Plans sell AI credits, but no credit ledger,
  allowance or enforcement exists; research-chat only logs USD cost. Needs the
  owner's credit definition, then a spec (ledger, allowances per plan, unused
  credits carried forward, enforcement in research-chat, NYAI gating to
  Pro/Max).

- [ ] **F106. Retire the unused NterEarth runtime.** Since F103 amendment 5
  the homepage hero renders the shared photographic globe. `src/marketing/
  NterEarth.jsx` (and its test), `public/brand/earth/nter-earth.js`,
  `earth-poster.png` and the old `.mkt-earth*` / login-orb CSS are no longer
  rendered. Remove only with owner approval and an exact file inventory.

- [ ] **F105. Reconcile stale documentation.** Found in the 2026-10-12
  read-only review: `agents/rollback-runbook.md` omits `ingest-worker`,
  `admin-ingest` and `document-file` and the preview origin pattern;
  `Architectures/01`, `03` and `06` still quote the 2,338-document / nano-tier
  figures; `ai-agent.md` rule 8 mentions upstream rebases; several dated
  plans/specs still read "local only / not merged" for work now in `main`.
  Documentation only; correct in place or mark Historical.

- [ ] **F99. Reconcile public pricing copy and inventory retired commercial UI.** Pricing page done on `task/pricing-inr` (2026-10-12): owner INR plans, no GST, no unsupported claims; see the legal-policies spec. Remaining: retired commercial UI inventory below, and billing alignment (F109). Free signed-in desk access is implemented, but src/lib/pricingStore.js still advertises five core desks in public pricing. UpgradeModal.jsx has no production importer; copyPolicy.js has test-only references; onboarding.css retains unused niy-plan-wait styling. These are outside the approved terminal/signup scope. Decide marketing scope and exact removal inventory before changing them; billing history and AI limits are not removal targets.





- [ ] **F89. National external source-link reliability.** V6 popup audit executed18 unique public targets:15 responded200; eprocure link returned500, GDELT returned429, and `https://ipm.mospi.gov.in/` has an expired TLS certificate. Do not bypass TLS or guess replacement sources. [Exact targets/evidence](../specs/2026-10-07-national-v6-link-audit.md). Existing source/feed integrations unchanged; refresh/replacement requires a scoped source task.



- [ ] **F84. Law reporting-query relevance.** Read-only audit found nine Law modules backed by news-search rather than official dockets/analytics; several RSS queries use broad OR terms and India filtering, including international modules. Landing must disclose reporting identity; provider relevance and official integrations require a separate scope, not opportunistic changes in F83.





- [ ] **F76. Owner browser acceptance of dictation.** F74 production activation completed; verify real signed-in microphone → editable transcript in both Ask AI and command search, permission refusal and grouped production record search. Synthetic English/Hindi OpenRouter probes and deployed auth/CORS passed; authenticated browser full path is not yet exercised. [Release evidence](2026-10-04-dictation-activation.md).




- [ ] **F80. Existing mobile marketing trivia overflow.** Browser at 320/768px has scrollWidth 335/783px. Main's unchanged stylesheet reproduces the 335px trivia block in a minimal browser fixture. Outside the homepage Earth scope; inspect .mkt-trivia-inner sizing before changing it. [Evidence](2026-10-04-earth-replacement.md).

- [ ] **F67. Reasoning usage accuracy.** `sendTerminal` in research-chat
  coerces unavailable `row.usage.reasoning_tokens` to zero. Preserve unknown
  versus measured zero and identify observed partial counts explicitly; add
  stream/persisted parity guards before changing this. Read-only finding from
  the owner's F65 annotation; the displayed turn's actual provider usage has
  not been inspected. No backend change or deployment in the styling amendment.
- [ ] **F66. Connection recovery state.** Owner screenshots show Failed to
  fetch, an unknown saved outcome, excess empty space and a remaining Stop
  button. Root cause unverified; investigate separately without using live
  conversations as test fixtures. Outside F65 visual scope.



- [ ] **F61. Broader tab keyboard audit.** Review the remaining Live TV and
  Nuclear analytics tab patterns for consistent roles and keyboard behavior.
  Outside the concrete F60 repair scope; coordinate with the next UI brief.
- [ ] **F62. File admission policy.** File attachment materialization still reads
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


## 1. Done

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

## Latest v6 candidate acceptance amendment — 2026-10-08

F88/F90/F91/F92 application work is verified through ca70175. Final native shared-shell zoom, reduced-motion, intentional coarse-pointer sector/module tap and hidden-tab evidence is recorded in [the release candidate](2026-10-08-desk-v6-release-candidate.md), superseding earlier pending native statuses above. Live voice remains owner-deferred under F76. Owner subsequently approved publication with “go”; candidate merged into main at d480b11. Branch cleanup remains unapproved. Fresh production dependency audit reconfirms the unchanged P12 xlsx high advisory; it was not introduced by this branch.

R7 execution update: the owner's remaining-270 review and single 182-document / 3,611-chunk ingestion job are complete and independently audited. All 88 source-specific exclusions remain aside. See [270-source final run evidence](../research/2026-10-11-corpus-270-reviewed-run.md) and the latest R7 entry above. Never restart this completed manifest or earlier completed releases. Remaining cohorts and existing-source repairs retain their documented review/authorization requirements.

R7 wider-corpus continuation: [413-document release completed](../research/2026-10-11-corpus-wide-batch.md). All 413 passing sources from the fresh 500-source cohort were ingested in one frozen job: 7,493 complete context chunks, 6,661 contextual chunks, 3,033 independent scoped citation probes passed. The other 87 candidates remain held with evidence. Final live and planner totals: 3,434 documents / 3,431 indexed / 100,031 chunks / 2,143 covered listing bill keys, zero orphan chunks and null vectors. Actual embedding usage 706,730 tokens / USD 0.01413460; all 90 capacity samples passed, peak CPU 16.12%; 15 isolated slow health samples out of 437, no consecutive slow windows, final health passed. Runtime corpus-wide-20261011/job-wide500-v1/final-completion.json binds the full audit and exact SQL evidence. Manifest stage-01.release.json SHA256 b8a987362724afab31e157f01fae72b7f9cd9dec7667db269b4caed5864c2481 is COMPLETE; NEVER restart it. Supervisor exited 0 and locks released. The pre-write fetch recovery at 40 remains documented and preserved. Broader corpus candidates, nonbill scoping, the 87 held candidates and existing-source repair holds remain open; this is not completion of R7 as a whole.

## Done — 2026-10-12 consolidation

- **Corpus code consolidation (2026-10-12), `d0a8020`:** reviewed corpus code, tests and documentation integrated with the released UI on main; original copies preserved outside Git. [Evidence](../research/2026-10-12-main-consolidation.md). R7 ingestion/repair holds remain open.
- **F94 resolved (2026-10-12):** owner-authorized Git disconnect of only `niyantran-desk-reference-v6` (`prj_hlv83bVVPDlaJht0GP7njfUDhsLA`) verified `link: null`; project/deployment history retained. Actual production project still follows main. [Operations record](../research/2026-10-12-main-consolidation.md).
