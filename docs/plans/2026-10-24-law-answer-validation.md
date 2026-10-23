# F247/F249 validation plan

> **Status: Living.** Sequential implementation under the approved correction scope.

1. Reproduce placeholder acceptance and support/citation gaps. Read the previous partial-release receipt and source-grounded failures.
2. Write causal tests, then shared placeholder validation; scopes research-chat answerValidation.ts/tests, agent.ts/tests, handler.ts/tests.
3. Add bounded Law evidence review and handler wiring; scopes lawAnswer.ts/tests, handler.ts/tests, lawContext.ts/tests only if tail ordering requires adjustment. Preserve existing citations/usage contracts. Reviewer input excludes row evidence and treats corpus/drafts as data.
4. Run focused checks, full app/Edge tests, lint/build; independent read-only code review. Fix findings before commit.
5. Push isolated task branch, PR, wait both CI jobs, merge and deploy research-chat. Verify exact payload/auth, NTER answers and citation clicks, main CI/production aliases and unchanged corpus.
6. Update open-work and release/client handoff with actual outcomes. No larger batch or re-ingestion.

Implementation evidence: placeholder handler regressions failed before the fix and passed afterward. Disabling review integration makes F247 handler regressions fail; removing exact quotation validation makes quote regressions fail. Tail ordering test failed before priority was added. Independent review found and corrected broad-search bypass, positional-heading uncertainty and missing bounded document identity. All model attempts retain existing accounting. Latest full app suite: 6,575 passed; final Edge suite: 1,239 passed (including the identity addition). Lint/build passed. Live acceptance remains pending release.

Live v78: original answer and explicit commencement-date question passed source comparison. Costs follow-up failed closed; reason was not recorded. Follow-up scope: accept complete short exact quotations (32-character floor wrongly rejected No order as to cost.), add text-free rejection reason codes and causal tests; preserve exact matching, bounds and fail-closed behavior. Repeat live acceptance after gated release.

V79 original question failed closed with quote_not_found. Refinement scope: lawAnswer.ts/tests and handler test fixtures, server-bound excerpt selection instead of model transcription. Causal selection test fails previous protocol; tests cover unknown/rebound IDs and exact bounded partition. Repeat all checks and live acceptance after gated release.

V80 costs follow-up passed, but original review exhausted 6,000 output tokens. Live catalog for DeepSeek Flash exposes off/high/xhigh; provider catalog confirms none/high/xhigh with default high. Reviewer now explicitly chooses low/minimal if supported, otherwise maps catalog off to provider none. Draft retains user-selected reasoning; no model/output/deadline limits are raised. Source: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens and public model catalog, checked 2026-10-24.

V81 original passed in22s but follow-up failed exact claim-to-citation support despite correct overall attribution. Add one bounded retain-only support audit in lawAnswer.ts, handler wiring and causal fixtures; run full gates and re-test before closure.

V82 original retained unsupported numeric-date clauses despite the audit. Add a general own-excerpt numeric-date guard with separator/zero-padding/ISO normalization, dropping unsupported claims with an evidence-limit notice. The small claim audit now uses the selected supported draft reasoning, capped at4,000 output tokens; selection remains low/none. Date presence is necessary only and does not prove event attribution. Re-run live acceptance; no case-specific replacements.
