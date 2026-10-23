# F247/F248 implementation and release

> **Status: Living.** Owner approved fixes, NTER testing, PR/CI merge and deployment; no larger batches or re-ingestion.

Spec: ../specs/2026-10-24-law-answer-attribution-fields.md. Sequential work on task/law-answer-attribution-fields.

1. Reproduce panel omission and missing attribution instruction with failing tests. Write scope: src/shell/record/adapters/lawInsolvency{,.test}.js and supabase/functions/research-chat/prompt{,_test}.ts.
2. Prefer structured case_number with legacy fallback; add mandatory legal attribution/retrieval and final-answer checks. No schema or immutable corpus change.
3. Update docs/operations/law-next-batch-agent-message.md and law-listing-client-guide.md for 100-first preparation, checkpoint resumption and explicit later approval. Keep the public handoff filename stable.
4. Run focused Vitest/Deno then npm test, full Edge suite, npm run lint and npm run build. Independent review of scoped diff before release; reviewer read-only, no delegation beyond review.
5. Push/open PR, merge exact reviewed head only after required CI. Deploy research-chat plus matching web; verify exact versions and production alias. Test both defects on signed-in NTER; compare original ten fingerprints. Record truthful bounded results and any failures. Update open-work and handoff release state.

Verification commands: npx vitest run src/shell/record/adapters/lawInsolvency.test.js; deno test -A --config supabase/functions/deno.json supabase/functions/research-chat/prompt_test.ts; npm test; deno test -A --config supabase/functions/deno.json supabase/functions; npm run lint; npm run build. CI SQL fixtures remain required even without SQL changes.

## Verification so far

F248 regressions failed on the original implementation (missing canonical field and precedence); after correction all 14 focused adapter tests pass. F247 prompt-contract test failed before the instruction change; all 45 prompt tests pass afterwards. These are wiring tests, not semantic model evaluations. Independent reviewer reran both focused suites and found no code blocker; requested handoff branch/format clarification was incorporated. Full Edge suite 1204, lint and production build pass. Application suite: 423 files / 6,575 tests pass. Live acceptance remains pending.

## Live failure and bounded follow-up

PR17 merged as 5a8f7a456d29c415cc106dc4bac2c66f90e86439 after all checks passed; research-chat v73 matches reviewed files. The original Globiz website question still falsely attributed section 3 submissions to tribunal findings. F247 remains open. A prompt-only correction is insufficient.

Follow-up scope: research-chat/agent.ts and agent_test.ts. Before drafting from returned Law chunks, run one server-generated context search restricted to those already-authorized document IDs. Use the existing search counter, trace, reply budget and deadline; never widen an empty context search. Save the attempted state across failover. If unavailable or exhausted, explicitly mark attribution unresolved. Render a neutral attribution warning beside Law excerpts, without classifying their role or changing citations/text/hashes. This retrieves evidence, not a proof of attribution; repeat original live acceptance and a contrasting follow-up. No schema, corpus, chunker or ingestion changes. Independent review and full checks precede a follow-up PR/release.

Follow-up verification: all seven context regressions fail against the PR17 agent and pass after the change. Focused agent suite 133/133; full Edge suite 1,211/1,211; application suite 6,575/6,575; lint and production build pass. Independent read-only review found no blocker; its three additional edge-case regressions were added. Live semantic acceptance remains pending follow-up deployment.

## Positional source-context correction

PR18 merged as bb5f4f10982721b03478056945778982e0567473; deployed v74 matches source. Context search executed in NTER but the opening still falsely called the debt argument a tribunal finding. F247 remains open. Scope now includes a pure Law source-heading helper and tests, retrieval Chunk's optional transient context, index.ts caller-authorized read wiring, agent rendering and regression coverage. Read bounded complete prefixes, quote only exact preceding heading text and its position, and fail closed on gaps/mismatches; no stored metadata or text changes. Review, full suites, CI and live acceptance required again.

Positional-context verification: causal source-context and renderer regressions fail without the feature; the lowercase-boundary regression failed before its guard. Corrected one initially vacuous test to use matching modified source/hit content. Independent re-review found no blocker. Actual Globiz chunk 41 receives the literal heading “3. CONTENTIONS OF CD” (source offset 9485); chunk 79 receives “7. ANALYSIS AND FINDINGS” (35648), with original content/hash preserved. Full Edge 1,217, application 6,575, lint/build pass. Live acceptance is pending.
