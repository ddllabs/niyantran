# F251 — Law answer performance qualification

**Status: Normative.** Owner authorized implementation, NTER verification and release on 2026-10-24. No ingestion or re-ingestion.

## Current state and problem

F250 ships evidence selection followed by synthesized, source-validated claims. On four Globiz questions, two extra calls repaired output shape or missing quotations. Provider latency also varies substantially. High reasoning remains the user's selection; reducing it or replacing answers with excerpts is outside scope.

The current indexed Law corpus contains 1,110 NCLT/NCLAT documents and 49,488 chunks. It cannot establish qualification for other courts. Representative evaluation will cover Globiz (80 chunks), Bigmoon (42), Jet Airways (40), Samata (29), Future Consumer (95), and A.Navinchandra (230): disputed submissions, limited recall jurisdiction, liquidation relief, personal guarantor insolvency, and corporate admission.

## Expected outcome

Measure baseline and candidate with identical source context and questions. Investigate strict structured output to prevent malformed shape before it causes a correction call. Keep model selection, reasoning, source ownership, one shared correction, deadlines, cost accounting and every existing attribution/citation validator. Strict schemas are an output-format constraint, not a semantic correctness guarantee.

OpenRouter's [structured-output contract](https://openrouter.ai/docs/guides/features/structured-outputs) is endpoint dependent. The 2026-10-24 endpoint snapshot confirms DeepSeek V4 Flash has supporting providers. A candidate must avoid imposing unsupported schemas on unrelated selected models, and must not silently downgrade validation on provider failure. No speculative routing or cache changes.

## Acceptance evidence

- Causal regression tests for the changed request contract, focused passage IDs and unchanged semantic rejection; full app/Edge tests, lint and build.
- Matched private evaluations, preserving failed attempts and provider timing/correction counts. Ship only a demonstrated benefit; distinguish deterministic avoided retries from variable provider latency.
- Independent source review of representative answers and Globiz regression questions. Claims must be supported by their cited source, preserving party submissions, tribunal findings and quoted precedent.
- Authenticated NTER answers and working source navigation after release, including representative order lengths. No universal SLA claim from this bounded sample.
- Read-only corpus fingerprint comparison; no corpus writes. Exact reviewed runtime deployment, required CI and source match.

## Scope

Law reviewer/request-contract tests, bounded evaluation tooling if needed, and task/release documentation. No schema, ingestion, listing, model/reasoning preference, billing or unrelated UI changes.

## Reproduced wider-sample defect

Bigmoon contains a line beginning `65.55 crores`. The decimal-paragraph recognizer incorrectly treated it as a paragraph opening; global structured-document filtering then discarded independent ruling chunks. Causal tests reproduce both the false hydration anchor and lost ruling. Share one conservative recognizer excluding decimal amounts immediately followed by explicit monetary magnitude/percentage units. This does not infer speakers or rewrite text, and existing orphan/quoted-precedent protections remain.

## Rejected experiment and revised optimization

Strict JSON Schema candidate: six matched contexts, median 20.438s versus baseline 17.000s, 12 calls in both. Rejected as a latency optimization; no schema/provider eligibility change ships.

The revised optimization skips evidence selection only when the existing one-attached-Law-document fast path is eligible and the complete review pool is at most 12 units / 12,000 serialized characters from one identified document. Every unit is supplied unchanged to synthesis. Larger/multi-document pools retain selection. High reasoning, citations, source validation, the shared correction and attempt accounting remain. The handler's first-call retryable-provider failover applies to the first review call, including direct synthesis. At most two calls on the compact path, three otherwise.

The baseline Samata answer also omitted original parenthetical words inside purported verbatim quotation. Validate every recognized quotation of at least 12 characters against its cited unit, not only explicitly requested quotations. This is a bounded lexical check, not a general semantic verifier; it may require the existing correction. Private originals and evaluations remain outside Git.

Candidate two completed six local cases but failed independent source review on Navinchandra: a combined appointment/deposit sentence cited only the appointment. Other cases passed bounded source review. It required correction for a false exact quotation (Future) and omitted requested quotation (Globiz date). The synthesis instruction now explicitly asks for unquoted synthesis by default and preserves all words, including parentheticals, in requested exact quotes. Existing validators remain authoritative.

A narrow rupee-numeral support guard now checks INR/Rs/₹ amounts against each claim’s own original passage; it rejects the reproduced combined appointment/deposit claim. Comma grouping and singular/plural magnitude labels are normalized; differing explicit magnitude units are rejected. This is not validation of arbitrary number words, units, conversions or all legal entailment.

## Live qualification correction

The v92 Samata website answer omitted the express alternative of a lesser mutually agreed deposit and the moratorium's all-debts scope. Future's repayment paraphrase omitted availability of CoC funds. Preserve material conditions in synthesis, with bounded causal checks for an explicitly stated lesser mutually agreed rupee amount and repayment subject to available funds in the same cited passage. Require the existing correction rather than changing evidence or adding calls. These lexical checks do not establish general semantic completeness. Re-run source review and authenticated acceptance before closing F251.

The v93 Globiz follow-up combined an expressly confined-inquiry claim with a disposition-only citation. Require a literal scope/limitation-of-inquiry anchor in the claim's own original passage for such a scope assertion; retain correct source-supported scope statements and ordinary disposition statements. This is a narrow rejection guard using the existing correction, not a general inference engine. Verify the reproduced follow-up and the other accepted outputs against the final guard.
