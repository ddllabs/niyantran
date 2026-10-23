# Law evidence validation and malformed answers

> **Status: Living.** Owner authorized fixes, tests, PR, CI-gated merge and deployment. No ingestion.

Current behavior accepts a nonempty placeholder as an answer and validates citation existence rather than claim support. Law drafts can attribute party arguments to a tribunal, cite a listing for costs, or lose the closing passages under reply truncation. Prompt-only attempts did not establish acceptance.

Add a bounded evidence-review step for nonconversational turns with retrieved Law text. Buffer these drafts until review; use the same serving model, existing attempt accounting and deadline, reserving time for review. The reviewer receives only bounded caller-authorized text evidence, question and untrusted draft. It returns concise claims with exact supporting source quotations. Server validation rejects unknown/row handles, invented quotations, malformed/unfinished output and excessive sizes. Render each accepted claim with its source quotation and verified citation; return an explicit failure if review cannot produce valid support. This establishes traceable support, not a universal semantic guarantee; real source-reviewed acceptance remains required. Field-only row answers remain unchanged. Preserve source identity, offsets and hashes.

Reject exact placeholder answers centrally, including research promotion and completed envelopes; hold streaming placeholder prefixes so a bounded correction can run before nonsense is shown. Do not blacklist legitimate prose merely mentioning a token. No pricing/schema/auth/corpus changes; all provider attempts remain accounted.

Acceptance: causal fixture failures for placeholder promotion/handler retries, fabricated quotes, row-as-order citations, wrong handles, partial output, budget/cancellation and evidence bounds. Real NTER original and same-conversation follow-up must correctly distinguish submissions, tribunal findings, invocation versus commencement dates, and costs, with document citations. Full app/Edge suites, lint/build, independent review, CI and corpus preservation checks.
