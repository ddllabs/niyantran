# F247/F249 validation plan

> **Status: Living.** Sequential implementation under the approved correction scope.

1. Reproduce placeholder acceptance and support/citation gaps. Read the previous partial-release receipt and source-grounded failures.
2. Write causal tests, then shared placeholder validation; scopes research-chat answerValidation.ts/tests, agent.ts/tests, handler.ts/tests.
3. Add bounded Law evidence review and handler wiring; scopes lawAnswer.ts/tests, handler.ts/tests, lawContext.ts/tests only if tail ordering requires adjustment. Preserve existing citations/usage contracts. Reviewer input excludes row evidence and treats corpus/drafts as data.
4. Run focused checks, full app/Edge tests, lint/build; independent read-only code review. Fix findings before commit.
5. Push isolated task branch, PR, wait both CI jobs, merge and deploy research-chat. Verify exact payload/auth, NTER answers and citation clicks, main CI/production aliases and unchanged corpus.
6. Update open-work and release/client handoff with actual outcomes. No larger batch or re-ingestion.

Implementation evidence: placeholder handler regressions failed before the fix and passed afterward. Disabling review integration makes F247 handler regressions fail; removing exact quotation validation makes quote regressions fail. Tail ordering test failed before priority was added. Independent review found and corrected broad-search bypass, positional-heading uncertainty and missing bounded document identity. All model attempts retain existing accounting. Latest full app suite: 6,575 passed; final Edge suite: 1,239 passed (including the identity addition). Lint/build passed. Live acceptance remains pending release.
