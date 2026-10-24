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

## Publication and additional regression evidence

PR #39 merged `6f511513c1dc1352f5bb592c1abaff1cf9753099` from `21626da0` after branch/PR CI40106168123/40106204385 passed both required jobs and preview. Exact-main CI40106741141 gates deployment.

Four Globiz regressions completed without corrections: 33.984/23.929/13.708/17.254 seconds, 8 calls, USD0.0037665432. Independent review passed original, follow-up, date and false-cost-premise answers; all14 cited entries byte-match originals. This private replay is separate from deployed website acceptance.

Pre-release website baseline: Bigmoon assistant2a6ec689-0620-4dc0-9b26-75129560c7f1 failed with no_evidence; Future Consumer assistant8164cccf-88ed-48ab-b3ca-5544d4a7ce35 completed in16.861s (2.211s search,2 answer calls at3.137/11.305s;5.02 credits). Future source7 opened and highlighted original chunk93 with deposit/interim-finance wording.

## Production deployment

Exact-main CI40106741141 passed both required jobs. Research-chat v92 deployed with bundle hash `478672682a9c10559152ad8c61e89c43c2c5631f26f6701c88431625ca97508d`; all42 retrieved source files match the reviewed payload byte-for-byte. Unauthenticated POST returns401. Vercel production `dpl_CqSJxJVBNgvS4sZMS29Shcxcg6zE` is READY at merge6f511513. Connector team access was unavailable; existing authenticated CLI verified the same deployment endpoint.

Post-deployment full Law baseline comparison is identical: all1,110 document/input/chunk/job fingerprints,1,439 listings, global4,569 documents/150,204 chunks and Law costs. No corpus mutation occurred.

Live acceptance remains in progress. Future Consumer assistant84ee2392-469b-41e0-8786-1db6e8709fe0 completed in15.974s, with two answer calls; its source7 opens original chunk93. The live pool did not demonstrate a one-call saving, so the private compact comparison must not be presented as this website turn's path. Bigmoon now answers the previously failing question in about19s, preserves limited recall jurisdiction and no costs, and opens the original ruling citation.

### Live qualification failure and follow-up

Samata assistant407038dc-f729-4459-b811-0d8d79b249fd completed in27.053s but failed independent qualification: its deposit sentence omitted the expressly allowed lesser mutually agreed amount, and its moratorium answer omitted all-debts scope. The duration quote and source IDs were correct. Future's volunteered repayment sentence also omitted the availability-of-CoC-funds condition. These are synthesis omissions, not missing corpus or wrong listing mappings; no re-ingestion is appropriate.

Two new causal tests fail against v92 and pass with bounded lexical guards for those explicit monetary conditions. The synthesis prompt now requests material alternatives, conditions and moratorium scope. Independent review and41 focused tests pass. The guards scan a cited paragraph unit and can conservatively hold an unrelated monetary proposition in that unit; alternative phrasing may escape them. General completeness, including all-debts scope, still needs source review. Existing one-correction limit is unchanged. Final live acceptance is required again.

First follow-up private run: all six returned JSON,11 calls,USD0.00296999556, but independent semantic review rejected three. Samata selected the opening moratorium chunk without its available end-condition continuation; Future's “payable back” escaped the repayment predicate; Jet inferred blanket non-adoption of any party argument from operative relief. Retained as failed evidence. The next revision includes the observed repayment spelling, rejects unsupported non-adoption clauses, and explicitly requests selection of supplied continuations and each requested condition. Additional causal tests fail before those guards and pass afterward;42 focused tests pass. Prompt guidance alone is not a completeness guarantee.
