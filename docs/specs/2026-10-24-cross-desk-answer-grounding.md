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
