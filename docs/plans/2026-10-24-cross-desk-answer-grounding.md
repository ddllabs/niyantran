# Cross-desk answer grounding plan

**Status: Living.** Implements the matching spec on task/cross-desk-answer-grounding from a2358d33. Owner authorization covers implementation and release; no ingestion.

1. Reproduce F255 with server-grounded unindexed State/Growth/International/National/Law rows and deliberately unrelated Law retrieval. Write scope agent.ts, handler.ts, turnScope.ts and tests. Preserve indexed/mixed/broad searches, real Law review and web overrides. Fix unavailable source scope before touching prose.
2. Fix F254/F256 grounding instructions and provenance notes in prompt.ts/handler.ts with prompt/handler tests. Keep field/source/version/period boundaries explicit; avoid a universal expensive verifier. Live answer evaluation is mandatory for model behavior.
3. Full verification, independent read-only review, small commits. A test-writing subagent may edit only an explicitly assigned test file; reviewer has no write scope. No other delegation.
4. Push PR and merge after both required jobs pass; deploy reviewed research-chat bundle preserving existing auth. Save prior payload for recovery. Live authenticated NTER acceptance on original four records; preserve/cache metrics, citations and corpus fingerprints. Correct in-scope failures before closure, document provider limitations honestly.

Commands and acceptance in spec. Supabase runtime changes require bundle equality and unauthorized401 check. Exact production frontend must satisfy CI. Record deployment versions, commits and test results here; open-work remains the only task list.

## Local execution

F255 ten-case handler regression (five desks × attached/selection) failed beforefix withthree unrelated documentsearches; afterfix allpass. Added broad-context control preserves genuineLawreview andcitation. Fullhandler208passes. F256 record+web provenance regression failedbefore note repair. F254/F256 promptcontract regressions failedbefore instructionchanges; these are configuration evidence, not proof of model semantics. Prompt+agent focused checks pass (see final totals below). Legacy known-unindexed widening assertions were updated to the approved newcontract; bareunknownscope behavior and indexed/broad controls remain. No provider calls yet.

Review caught browser/server mapping divergence. Six additional causal regressions prove absent/stale keys and authoritative null mappings for selected and attached rows; all failed before the fixes. Web eligibility, document scope and citations now share the resolved row mapping. Full final Edge suite: 1,353 pass. Application suite: 6,575 tests / 423 files pass. Lint, production build, router import and diff whitespace check pass. No standalone type-check claimed. Live semantic acceptance remains pending release.

## First production acceptance and follow-up

PR #45 merged as 3c430a02 after head CI; exact-main CI also passed. Deployed research-chat v96, 42-file equality, hash 0111e4891662d4fbcadb6c42f323de4af214c789c7aa7bae0f146039055366be; unauthorized POST returned 401. Vercel production READY at 3c430a02. Economics completed in 28.452s with zero document searches and three web searches, but still asserted an unsupported calendar-year period: F256 remains open. State completed with web and row lookups, with no unrelated document retrieval or Law-verification failure. No acceptance is inferred from completion alone.

Follow-up write scope: agent.ts, agent_test.ts, handler_test.ts, and these task docs. Web-research drafts were still carried as assistant context; a record-search-only counter also triggered the no-evidence nudge after web results. Discard web synthesis while preserving local tool protocol and returned excerpts; skip that nudge for unavailable-document scope or existing web pages. Three causal tests failed before repair; 363 agent/handler tests pass after repair, with multi-round fixtures using explicit local tool calls. Repeat live acceptance after CI-gated release. Read-only DB check found no rows for the selected Economics module or State Pithani record; do not fabricate record citations or ingest data to fix acceptance.

National v96 also retained unsupported institutional identity and inferred non-commencement from a conditional commencement clause, despite correct clause 9 quotation. F254 remains open. Extend this scoped follow-up to lawAnswer.ts (optional provision synthesis mode), handler.ts (only National bill provision questions), and a separate provisionAnswer_test.ts; the test-writing subagent owns only that new test file. Reuse bounded original-source selection, per-claim source IDs, server-owned citation rendering and shared attempt/deadline accounting. Do not pass the rejected draft or listing-status analysis as legal-text evidence; existing Law mode stays unchanged. This is a targeted provision-answer boundary, not a universal verifier. Live semantic checks remain mandatory.

Follow-up local verification: 1,378 Edge tests pass; 6,575 application tests pass; lint/build/router/diff checks pass. Independent review: 278 provision/Law/handler tests pass, no remaining code blockers. Regressions fail before each fix, including failed web-stream carry-over, unsupported commencement/Board identity, empty/off-scope evidence and stale Law hints. Lexical checks intentionally cover bounded observed inference classes, not general entailment. Live semantic acceptance remains pending the follow-up deployment.

## Second production acceptance — 25 October IST

PR46 merged b9ed0503; both required exact-main CI jobs passed (40121547216). research-chat v97 hash300f13f6ba5cc2ad711cc198f447ae0189d4df17a859c70a7ad8ed6661f646bc has42/42 exact files and unauthenticated401; Vercel READY dpl_3SGvoUUDM5mSRDR3jKZ3crBxSbm6 at that SHA. Globiz passed in16.000s with5 original-source citations, and the reader opened operative paragraph7.34. National failed closed in61.848s: two unsupported_quotation rejections. Economics completed35.216s but repeated unsupported calendar/latest claims and omitted inline web links. State completed21.563s with2 web searches,9 pages and zero document searches; it mislabelled the MyNeta aggregator as an Election Commission portal. These are acceptance failures, not closed findings. All corpus fingerprints match the baseline.

Third release fixes the quotation delimiter bug with causal valid/altered quote cases, and adds the spec's scoped observation check with one bounded correction and no rejected-draft carryover. Reviewer caught a zero-web-page bypass and apostrophe quote bypass; new tests fail before both repairs and pass after. Final web instructions now explicitly distinguish actual publisher from reproduced official material and omit unsupported numerical detail; only live tests establish semantic improvement. Local1,393 Edge /6,575 application tests pass; lint/build/router/diff checks pass. No model routing/reasoning changes, no new provider, no ingestion. Independent review then caught retained continuation fragments in correction input; a causal regression now proves they are removed while evidence remains. Reviewer independently reran it and reports no remaining blockers. Live acceptance remains pending.

## Third production acceptance — 25 October IST

PR #47 merged as `af8b0cb7` after both head and PR jobs passed; exact-main run `40123909448` also passed. Research-chat v98, hash `0e46945423602ce8bd5d4af48b065a317d6ccf41140d48a29c2bbbc3f97a2de4`, matches all 42 files and returns 401 unauthenticated. Vercel `dpl_BWBAWTRcged4cEuVZhQp2cpSCvc9` is READY at that commit.

National turn `0cd46050-34d5-4c55-bf60-052e99c7c5fd` passed in 64.619s: the 2022 principal Act and clause 9's two substitutions, with two citations to the introduced version. Original ranges and hashes match; the PDF reader opens and highlights clause 9. No unsupported Board identity, commencement status, or neighboring-clause claim remains in this answer.

State turn `df94c61e-da56-454e-877d-085512ab2178` passed in 22.381s with three web searches, 12 pages, and zero document searches. It explicitly attributes web material to aggregators and Wikipedia and states that no official original was returned. The visible Record tab confirms the directory's party, constituency, and education fields. These are bounded case checks, not universal web-truth verification.

Economics turn `cb93fd47-21f9-43e3-8ea2-092661e3ed27` completed in 25.912s with two web searches, 10 pages, and zero document searches. The definition, selected 7.57 value, unverified period qualification, and three inline pages pass source review. However, it still claimed FY26 covered a different period and was not a revision. An unknown convention cannot establish either relationship: F256 remains open.

The narrow follow-up rejects same/different-period and not-a-revision comparisons in this scoped path; instructions require an explicit statement that comparability and revision relationships are unestablished. Both new causal cases fail before the fix; independent review passes all five observation-correction cases. Held answers also had a zero first-answer metric; a causal handler regression now records the validated server-release boundary. This does not measure browser receipt. Independent review reports no blockers. Final local checks: 1,395 Edge and 6,575 application tests pass, as do lint, build, router import, and whitespace checks. Live GDP acceptance remains pending. No new scope, models, ingestion, or schema changes.

## Fourth production acceptance and uncertainty repair

PR #48 merged `bc5b750e`; exact-main CI `40125846137` passed both jobs. Research-chat v99 matches 42 files, hash `0d319b33fb7f4c3c2f6bcf14236f4ed5a86c765310e929a4633409b6c071ce2e`, unauthenticated 401; Vercel READY `dpl_R67oGverfwAjQrswBFvsPgN2ifJN` at that commit. Two GDP repeats failed closed after observation validation, messages `45c8816f-cd56-44c2-8b92-dff6d69ae646` / `0e59c3be-ff13-4083-b4b4-cab00013bdd3` in 41.420s / 49.803s. The exact discarded text is unavailable; no claim identifies its exact triggering phrase.

Independent review reproduced material false positives for explicit uncertainty statements. Scoped follow-up in agent.ts/tests permits bounded negative-knowledge complements and excludes URL destinations from prose checks, retaining checks on appended assertions. Six new positive cases fail against the v99 runtime, while mixed-assertion controls still pass rejection tests. All 22 focused F256 tests pass after repair. Full checks and live acceptance remain pending. No policy weakening, provider change, new verifier or ingestion.

Review then found a causal-conjunction bypass and postposed-uncertainty false positives. Three causal tests failed before repair; all 25 focused tests pass independently after it. The exemption stops at causal/adversative conjunctions and only permits narrowly anchored postposed uncertainty. No further material review blockers; lexical checks still do not prove general entailment.

Final uncertainty-repair verification: 1,407 Edge tests / 6,575 application tests pass; lint, build, router import and whitespace checks pass. Independent focused review passes 25 cases with no remaining blockers. Fresh live acceptance remains required.

## Fifth production acceptance and comparison-boundary repair

PR #49 merged `0b6609f8`; exact-main CI `40127591222` passed. Research-chat v100 matches 42 files, hash `2216c4584fdb93cdc321bf9dc2facd1a7e24ea9383b6f75af15a5f8dc0dd5a6a`, unauthenticated 401; Vercel READY `dpl_FTsUsuZWaTTXkTVuJiHfvqvTysxE`. GDP turn `2c69edd9-f865-4c82-abae-5b00e4031c61` completed in 35.309s, two web searches / 10 pages / zero document searches, but still inferred that conventions differ and a different reference period applies. These wordings escaped the bounded check. It also merged separately reported values into ranges; the April World Bank report gives FY25 7.1 and FY26 7.6, while the October release separately projects FY27 7.1. No acceptance claimed.

Scoped follow-up expands comparison predicates, adds a server-owned observation limitation, and instructs separate labelled web observations instead of merged ranges. Three comparison cases and the server-note test fail before repair; 31 focused F256 tests pass after. No general entailment guarantee, provider change, new verifier or ingestion. Full verification and fresh live acceptance pending.

Final comparison-repair checks: 1,411 Edge / 6,575 app tests pass; lint, build, router import and whitespace checks pass. Independent review passes 31 focused cases with no further material blockers. Exact report/range semantics remain a live acceptance requirement.

## V101 failure and structured observation repair
PR #50 merged 46ed371f after CI; exact-main run 40129113789 passed. Research-chat v101 matched 42 files, hash 8ac0f35b791298a7f09465a3cf4c76307e4b6b4a26bd0d12f7fcdfeed916f38c. The original GDP test again failed closed (message 0b0ef388-c698-4762-9a50-c1480d51465d, 42.512s, three web searches/15 pages); rejected output was not persisted, so the exact trigger is unknown. Stop lexical patching and repeated live retries.

Implement the superseding spec in new observationAnswer.ts plus agent.ts/handler.ts and their tests. Ordered work: failing integration regression; pure extraction validation/renderer; wire existing answer call and server-owned selection context; focused/full checks; independent read-only review; CI-gated release and original GDP acceptance. Reviewer has no write scope. No ingestion or extra verifier.

Structured repair: the old runtime failed the new usable-answer regression. Independent review found cross-attempt loss of valid sections; a causal regression now proves preservation after malformed correction. Further causal cases cover schema fallback, qualifier-dropping spans and attached-row identity. Source spans require whole-sentence/excerpt boundaries; missing/truncated context and relevance still require live review. Independent final focused review: 390 pass, no material blockers. Full Edge: 1,404 pass (obsolete lexical wording cases replaced with extraction/renderer cases); lint/build/router/diff pass. Application suite: 6,575 tests / 423 files pass. Live acceptance remains pending.

Pre-deployment audit of merged PR #51 found a conflicting system-level general answer contract. A causal test fails before adding an answer-phase-only trusted schema override. Source excerpts remain in user evidence, not the trusted override; schema fallback remains supported. This narrow follow-up must land through CI before any structured-path deployment.

Trusted-contract follow-up: independent focused review passes with no blockers; 1,405 Edge / 6,575 app tests, lint/build/router/diff checks pass. PR #51 exact-main CI 40131065022 also passed, but its runtime was deliberately not deployed pending this contract correction.

## Structured-path live result
PR #52 merged 275c1077; exact-main CI 40132050892 passed both jobs. Research-chat v102 matches all 43 files, hash 64e5a41845ff96f524a36807202faed7eded6c83dbdd2d6440b3e7f61160aeb8; unauthenticated POST 401; Vercel READY dpl_AoGTkaDx1mGyNQve91KtrK35qqxG. Original GDP turn 1425f845-b175-4eb3-a5ce-4cd9093ef550 completed in 15.136s, two web searches/10 pages/zero document searches, but omitted the requested definition and one observation. This is NOT acceptance. Exact rejected extraction was not saved. A bounded public Economics replay with local raw capture was separately approved by the owner after automatic review blocked it. Corpus fingerprints still match the original baseline.

The owner-approved diagnostic completed four calls for $0.0159362. It captured an exact World Bank definition immediately following the glossary table label `| Long definition |`; both initial extraction and correction copied it accurately, but the sentence-start guard rejected it. A definition-only table-label boundary now accepts that complete sentence without permitting forecast/value cells or numerical-update exceptions. Captured first-extraction offline replay now renders both the definition and the separately sourced FY26 statement. This establishes the local cause; fresh website acceptance is still required. The visible literal-parentheses escape defect is also repaired. Both regressions failed before fixes; independent renderer review passes 8 cases without blockers, full focused suite 393 passes.

Table-format repair verification: 1,407 Edge tests, lint/build/router/diff pass. Local app run passed 420/423 files (6,546 tests); three files failed on ENOSPC in Vite's temporary transform cache, not assertions. Two passed on focused retry (19 tests); registry.test.jsx still hit ENOSPC. No corpus or unrelated files deleted. Required CI must run the complete application suite successfully before merge; local disk limitation remains explicit.


## Final release and scoped acceptance
PR #53 merged e4a2cf5a; both exact-main CI jobs passed in 40134772582. Deployed
research-chat v103 with 43-file equality and unauthenticated 401. Vercel READY
at e4a2cf5a. Original GDP and clean-session repeat cite the World Bank definition
and retain the supplied 7.57 value with explicit unknown comparability; both
omit additional observations. A targeted follow-up separately cites FY27's 6.6%
projection without treating it as a revision. This satisfies the partial-answer provenance boundary but not the full
original-question acceptance. All three turns,
omissions, timings, cache hits and unchanged corpus counts are recorded in the
[release evidence](../operations/cross-desk-answer-grounding-release.md).
F254/F255 acceptance is complete; F256 remains open until one fresh unchanged
original question returns both the definition and a separately sourced newer
observation. Independent review rejected blanket closure. F252 latency remains open.

## Reproduced omission and candidate selection
Renewed owner-approved diagnostic: four calls, $0.016555374152, no database
writes. Captured extraction selected a truncated numeric table row and modified
an Akashvani sentence (apostrophe and omitted trailing qualifier); both correctly
failed exact-span validation, and correction retained the table row. This is a
reproduction, not recovery of discarded website output. Technical refinement:
server-owned candidate IDs instead of model-copied spans. Ordered scope:
observationAnswer.ts/tests, agent.ts/tests, handler_test.ts, these task docs.
Prove selected exact typography/qualifiers survive, reject partial tables and
role-invalid/unknown IDs, preserve correction salvage and schema fallback.
Then full checks, independent read-only review, CI-gated release and original
NTER acceptance. No ingestion, routing change or extra model.

Candidate repair checks: integration test fails when the old renderer is restored;
12 unit cases pass, including captured transcription failure, full qualifiers,
decimals/abbreviations, wrong-slot and duplicate IDs, and correction salvage.
Independent read-only reviewer ran all 12 and found no release blockers; semantic
relevance and conservative candidate omissions remain limitations. Full Edge
suite: 1,411 pass; lint/build/router/diff pass. Application suite: 6,575 tests / 423 files pass. No further
direct diagnostic calls: renewed four-call allowance is exhausted.
