# F251 Law answer qualification

**Status: Living.** Release acceptance in progress; no ingestion or re-ingestion. Baseline `fd059e4b`, research-chat v91.

## Final changes

- An eligible attached single-Law-document turn supplies all original evidence directly to synthesis when its complete review pool is at most 12 units / 12,000 serialized characters. This removes a redundant selector call; larger/multi-document pools keep selection. High reasoning, original citation handles, billing/accounting, deadline and configured first-call provider failover remain.
- Shared paragraph detection excludes line-wrapped decimal amounts followed by explicit magnitude/percentage units. `65.55 crores` previously became an invented paragraph boundary and suppressed Bigmoon's real ruling. No stored text or chunks change.
- Recognized quotations of at least 12 characters must match their own cited original. Explicit rupee numerals must occur in their own cited unit. These are bounded lexical guards, not general entailment certification. One existing correction is retained; failures remain closed.

## Scope and baseline

Read-only corpus baseline: 1,110 indexed Law documents / 49,488 Law chunks, all in NCLT/NCLAT. Six existing orders span 29–230 chunks: Samata, Jet Airways, Bigmoon, Globiz, Future Consumer and A.Navinchandra. This does not qualify other courts or all questions.

Controlled private fixtures use the final 30 original chunks (all 29 for Samata), hydrated source context, plus the earlier actually retrieved Globiz date context. These fixtures isolate answer stages; they are not claims about live retrieval. Final website checks separately exercise fresh retrieval. Raw text, responses and credentials remain outside Git.

On NTER v91, Bigmoon failed in about 3 seconds with no credits used. Function logs at 2026-10-24T15:01:43.305Z show `research.law_review_rejected`, `no_evidence`, attempt 0. Local causal tests reproduce the false amount boundary and missing ruling.

## Experiments retained

| Experiment | Seconds by case: Bigmoon, Samata, Jet, Future, Navinchandra, Globiz date | Result |
|---|---|---|
| Baseline JSON mode |20.877,23.881,25.645,12.914,7.144,13.122|12 calls; Samata false exact quotation fails source review|
| Strict JSON Schema |27.557,20.983,46.095,12.021,9.254,19.893|12 calls; rejected as latency optimization (median20.438 vs17.000s)|
| Compact candidate before amount guard |13.412,25.646,22.671,16.372,7.268,24.093|Completed all; Navinchandra combined appointment/deposit claim cited only appointment, so fails acceptance|

No schema-format, provider routing, selected model or reasoning change ships. Faster output does not override source-quality failure.

## Isolated compact-path comparison

Same Future Consumer fixture, DeepSeek V4 Flash / High, same unquoted-synthesis prompt and quotation guard. Controls retain selection. Sequential small samples are exposed to provider variability, not an SLA or percentile estimate.

| Path | Three runs (seconds) | Median | Model calls | Provider USD |
|---|---|---:|---:|---:|
| Selection retained |23.712,13.570,11.982|13.570|7 (one quotation correction)|0.00095678772|
| Compact evidence |11.042,11.738,11.983|11.738|3 (no correction)|0.00065483740|

Median13.5% lower in this bounded comparison; deterministic benefit is three removed selection calls. Other documents need not qualify for the shortcut, and provider tail latency remains variable.

## Verification and release gates

Causal regressions failed before fixes for monetary decimals, spaced percent symbol, non-exact quotations, own-citation amounts and compact direct synthesis. Handler matrix covers compact/full pools, desk hint presence, first-provider outage and invalid output. Multi-document/large-pool controls retain selection; correction/admission tests remain bounded.

Local app suite: 6,575 pass. Final Edge/lint/build, independent final source review, PR/main CI, exact deployed source match, authenticated NTER acceptance and corpus preservation will be recorded before completion. No standalone type-check claim.

## Recovery

Restore the saved v91 research-chat payload if acceptance shows a regression, preserving existing authentication configuration. No data rollback is required. Do not weaken citation checks or lower reasoning to meet a latency target.

## Final private six-case run

Final six:29.903/35.179/25.192/8.304/14.116/16.829 seconds (Bigmoon/Samata/Jet/Future/Navinchandra/Globiz date), 11 calls, USD0.00285353852; no corrections. Exact stored timings are available in the private result. All six outputs replay identically through the final validator after the additional magnitude-unit test. Independent source acceptance is recorded below when complete.

The six-case median is about21.0s, above the baseline17.0s. This release does **not** claim an overall latency improvement across all orders: the demonstrated optimization removes selection for compact evidence, while provider delays still vary. It also repairs reproduced source failures. Full-corpus latency/SLA and general semantic guarantees remain unproven.

Final local verification:6,575 app tests,1,317 Edge tests; lint, production build, router import and diff check pass. Existing test stderr includes deliberate mocked feed failures. No production schema, ingestion or corpus changes.

Independent final review passed all six answers clause by clause and verified all17 cited entries byte-identical to original chunks. Navinchandra separates appointment226 from deposit/repayment227; Samata includes the original parenthetical words and all-debts scope. Reviewer independently ran39 Law tests with no failures and found no current merge blocker. Final validator replay passed all six without changes.
