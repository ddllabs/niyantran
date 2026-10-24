# F255 / F254 / F256 — Cross-desk answer grounding

**Status: Normative.** Owner approved implementation, live NTER tests, push, CI-gated merge/deploy on2026-10-24. Baseline a2358d33. Implements the findings in the F253 release record, in order F255 then F254/F256.

## Outcome
A record-scoped question whose source text is unavailable uses verified row fields and policy-permitted web evidence, never an automatic whole-corpus nearest-neighbour search that introduces unrelated Law evidence. Broad-context research remains cross-desk, and genuinely retrieved Law sources retain mandatory attribution/operative-order review. Indexed attachments keep document retrieval. Preserve explicit web-off, model capability, failed-lookup privacy, bounded tools, budgets, caching and citations.

Answers to narrow provision questions identify the requested provision/version and explain only changes established by its text. Do not add neighboring-clause claims or legal-effect interpretations without their own evidence; do not confuse amendment clause numbers with principal-Act sections. Useful explanation is required, not excerpt-only substitution.

Web evidence is external, not inherently unofficial. Distinguish server-verified row citations, source-text citations, searched-page links and user-supplied context. Do not label all claims unbacked when a row supplied fields. Use desk-neutral scope messages. Economic observation year does not establish calendar/fiscal convention; release/update dates are not measurement periods, and a search returning no newer result does not prove latest official status.

## Plan and boundaries
Sequential changes under supabase/functions/research-chat (agent/handler/turnScope/prompt and colocated tests), plus docs/specs and docs/plans. No schema, dependencies, routing/reasoning downgrade, auth/billing, corpus/listing writes, ingestion or re-ingestion. Existing source-attribution checks remain. No universal semantic-correctness or latency guarantee.

## Verification
Deno regression tests must fail before fixes for unindexed records admitting unrelated Law results and provenance labels. Preserve indexed, mixed, broad, Law and explicit-off controls across desks. npm test; deno test -A --config supabase/functions/deno.json supabase/functions; npm run lint; npm run build; node -e "import('./api/router.js')"; git diff --check. Independent review before commit. Live NTER: same State MLA, National Anti-Doping, Economics GDP questions plus Globiz attribution/operative citations; inspect provider execution and reader navigation, not just toggles. Compare corpus fingerprints. Both required CI jobs and exact deployment must pass; record failures and repair within scope before acceptance.

## Style
Use existing pure decision helpers and typed inputs, e.g. { ...input, documentSearchUnavailable: true }; keep model output untrusted. Do not add a universal second LLM verifier or hard-code these document names. Provider grounding instructions require live semantic evidence, not merely green string assertions.

## Web synthesis boundary
A web research draft is not retrieved evidence and must not travel into final synthesis as an assistant assertion. Preserve tool-call/reply protocol and returned web excerpts. A successful web search must not trigger a record-search-only “no evidence” nudge; known missing source text must not be searched merely to satisfy that nudge. Browser-only fields remain explicitly user-supplied when the server cannot confirm a row.

## Provision synthesis boundary
For National bill questions about sections, clauses, amendments or provisions, with matching retrieved bill text, use bounded original-source claim synthesis rather than publishing the broad research draft. Reuse existing selector/renderer and shared limits in a separate provision mode. Preserve document-role/version labels; do not promote a conditional commencement clause into actual commencement/non-commencement status. Neither listing analysis nor an earlier assistant draft establishes institutional definitions or legal effect. Other desks and existing Law synthesis keep their current path.

## Live acceptance follow-up
v97 rejected valid quoted substitutions because the quotation scanner skipped short quoted terms and paired their closing delimiter with the next opening delimiter. Consume complete quoted spans before applying the long-quotation threshold; retain exact-quotation rejection.

The Economics observation test still invented calendar-year coverage and latest/unrevised status. For the scoped Economic Simulator web path, withhold provisional output and enforce a bounded final-answer check: retain the observation's year label without asserting calendar coverage, avoid latest/unrevised claims from search absence, and require a link to a returned page when web facts are used. One correction, within the existing step/deadline budget, receives unchanged evidence and specific feedback, never the rejected draft. Fail closed if that correction fails. This conservative module boundary does not infer a fiscal period either, fetch originals, or claim general semantic entailment. Other scopes keep their existing path. Live source review remains required.

An unknown observation convention also cannot establish whether a differently labelled figure covers the same/different period or is/is not a revision. The scoped check rejects those comparisons and asks for explicit unestablished comparability. Held answers record first-answer time at final release, not zero.
