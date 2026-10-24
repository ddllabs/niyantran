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
