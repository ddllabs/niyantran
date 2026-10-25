# F251 Law answer qualification

**Status: Living.** Released and accepted at v94; provider-tail follow-up remains F252. No ingestion or re-ingestion. Historical baseline `fd059e4b`, research-chat v91.

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

Local app suite: 6,575 pass. At this pre-release checkpoint, final Edge/lint/build, source review, CI, deployment and website acceptance were pending; final outcomes appear below. No standalone type-check claim.

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

At the v92 checkpoint, live acceptance was in progress. Future Consumer assistant84ee2392-469b-41e0-8786-1db6e8709fe0 completed in15.974s, with two answer calls; its source7 opens original chunk93. The live pool did not demonstrate a one-call saving, so the private compact comparison must not be presented as this website turn's path. Bigmoon now answers the previously failing question in about19s, preserves limited recall jurisdiction and no costs, and opens the original ruling citation.

### Live qualification failure and follow-up

Samata assistant407038dc-f729-4459-b811-0d8d79b249fd completed in27.053s but failed independent qualification: its deposit sentence omitted the expressly allowed lesser mutually agreed amount, and its moratorium answer omitted all-debts scope. The duration quote and source IDs were correct. Future's volunteered repayment sentence also omitted the availability-of-CoC-funds condition. These are synthesis omissions, not missing corpus or wrong listing mappings; no re-ingestion is appropriate.

Two new causal tests fail against v92 and pass with bounded lexical guards for those explicit monetary conditions. The synthesis prompt now requests material alternatives, conditions and moratorium scope. Independent review and41 focused tests pass. The guards scan a cited paragraph unit and can conservatively hold an unrelated monetary proposition in that unit; alternative phrasing may escape them. General completeness, including all-debts scope, still needs source review. Existing one-correction limit is unchanged. Final live acceptance is required again.

First follow-up private run: all six returned JSON,11 calls,USD0.00296999556, but independent semantic review rejected three. Samata selected the opening moratorium chunk without its available end-condition continuation; Future's “payable back” escaped the repayment predicate; Jet inferred blanket non-adoption of any party argument from operative relief. Retained as failed evidence. The next revision includes the observed repayment spelling, rejects unsupported non-adoption clauses, and explicitly requests selection of supplied continuations and each requested condition. Additional causal tests fail before those guards and pass afterward;42 focused tests pass. Prompt guidance alone is not a completeness guarantee.

PR #40 merged `b3d2cad720b696bfd20605604fbe52cad16b3ecc` from `af157668` after CI40108380598/40108404694 passed both required jobs and preview. Final local checks:6,575 app tests,1,320 Edge tests,42 focused tests (including positive explicit non-adoption control), lint, build, router import and diff check pass.

Final private qualification: Bigmoon20.661s,Samata26.616s,Jet29.830s,Future15.224s; Jet repaired an unknown passage and Future repaired the omitted repayment condition. Navinchandra timed out at120.310s, stopping that bounded run with unknown final-call cost (known costUSD0.002697058). A separate two-case run completed Navinchandra96.167s and Globiz19.168s,4 calls,USD0.0033275668. All six completed answers passed independent source review;18 cited entries byte-match originals. This is success across a documented retry, not a clean first-pass run. The timeout and slow retry are unresolved provider-tail evidence, not omitted from the reported performance.

Exact-main CI40108883479 passed both jobs before deploying research-chat v93, hash `43b8a29d6bc89a1d86515d75cc05f62569d5332ec0a2c94c5ddf659f84e3eec5`. All42 deployed source files match the reviewed follow-up payload; unauthenticated POST returns401. Vercel production `dpl_8Za2UwXkfvmqmrGgjBqyGJtQA1m2` is READY at b3d2cad7.

## Final authenticated NTER acceptance

DeepSeek V4 Flash / High, attached existing document only, web off. Independent clause-by-clause source review passes the five non-Globiz answers below. These are actual fresh website retrieval/answer runs, separate from private fixtures.

| Case | Assistant message | Seconds | Source acceptance |
|---|---|---:|---|
| Jet Airways |4f5ce311-1d38-4c6c-8d80-452275bea110|87.705|Tribunal38/39 versus applicant16; no inferred non-adoption|
| Samata |c2e13a32-bd09-4013-98b8-36f43f706070|37.994|All-debts scope, both end conditions, lesser agreed deposit; exact quotes24/27|
| Navinchandra |a0022e46-7fea-4cc2-986d-4d3ab87b901a|14.321|Appointment226; deposit/conditional priority repayment227|
| Future Consumer |6232f721-860c-4882-a26c-3e1a6aef8a82|13.143|Unit87–94 supports appointment91 and deposit/available-CoC-funds93|
| Bigmoon |f21ef7cb-1864-4a79-b66a-e5bc91076eaa|17.540|Limited recall40, criminal-merits reservation and costs41|

Original-reader navigation/highlights checked for Jet, Samata and Navinchandra; Future/Bigmoon reader paths were also checked during v92 acceptance. Jet's two GMICloud answer calls consumed39.538s/45.670s versus about2.3s retrieval; this is a quality pass, not a speed success. Routing history was rechecked: earlier F250 latency/throughput sorts were deliberately rejected after inconsistent results/timeouts. No new routing change was made.

### Globiz follow-up citation correction

On v93, original c02b7272-b963-44c0-b4cc-8d5201f8a88f (50.034s), date d78f7c72-2809-4be1-999d-b17b249c6775 (21.734s) and false-premise f156e9e9-f882-402a-b9e4-065ea544a012 (22.020s) passed independent source review. Follow-up 8c1c41cd-941b-4605-903a-281171756175 (17.733s) failed: a compound sentence cited disposition chunk79 for both limitation and confined-inquiry scope, while the explicit scope is in chunks62–64.

A causal test fails before a narrow inquiry-scope support guard and passes afterward, with positive separate-citation and limited-recall controls. This lexical guard does not prove subject, polarity or general entailment. It preserves the existing correction budget and model routing. All six accepted private qualification responses replay identically under the final guard.

Four targeted private Globiz responses took23.087/19.205/25.048/15.979s,8 calls,USD0.00377631156, no corrections. All13 cited entries byte-match originals. Original, follow-up and false-premise pass semantic review; the date answer has supported facts and exact quotation but an unnecessary insufficiency notice. This is three unqualified passes plus one quality caveat, not four clean passes. All four replay identically through the final guard. The v93 live date answer did not have that caveat.

Final local checks for this correction:43 focused Law tests,1,321 Edge tests,6,575 app tests; lint, production build, router import and diff check pass. Independent review found no code blocker. At this pre-v94 checkpoint, authenticated post-deployment follow-up/date acceptance was pending; completed results follow.

## Final correction release and acceptance

PR #41 merged `17531c9419e3bb116474a4703b9cfde4a477d36a` from `985893b0` after branch/PR CI40111122247/40111143350 passed both required jobs and preview. Exact-main CI40111678176 passed both jobs before deployment. Research-chat v94 bundle hash `2559c50671be28b7dd24b36e25385688bfc9c3f0fc03ca2e0feb08446cb5efe1`; all42 deployed files match the reviewed payload. Unauthenticated POST returns401. Vercel production `dpl_6JffeEcrtaEd19MXixA4mo7F4hXe` is READY at17531c94.

Fresh authenticated Globiz conversation on v94, same DeepSeek Flash/High and attached-only/web-off settings:

| Check | Assistant message | Seconds | Independent acceptance |
|---|---|---:|---|
| Original |b5f0f482-8e97-45c4-8277-9dba6ad9d5f4|30.240|Disposition79; explicit inquiry scope62–64|
| Attribution follow-up |8342eebe-6ebb-4783-8874-cfe32c3d6343|22.354|Debtor submissions41/42 and20/21; operative no-cost order79|
| Date and exact quote |4717b236-4e97-4f1b-97da-2fa227bc0865|27.368|Commencement6Sep versus notice1Sep; exact paragraph7.29, no unnecessary uncertainty|

All three pass clause-level support and requested coverage. The live export provides citation metadata, not source text: source IDs/character bounds were matched to originals, without claiming direct byte equality from that export. Date quotation matches original74 after whitespace normalization; NTER reader opens and highlights that original paragraph. The five other representative live answers were accepted on v93; their accepted private responses replay identically through the isolated v94 guard. They were not all repeated live on v94.

Final read-only corpus comparison after these answer-only checks remained identical across all1,110 Law document/input/chunk/job fingerprints,1,439 listings,global4,569 documents/150,204 chunks and costs. No ingestion/re-ingestion or corpus mutation was performed.

Outcome: compact-path call reduction demonstrated, matched small-sample median13.570→11.738s (13.5%); no overall six-case latency improvement or SLA established. Provider tails remain open as F252, including the retained120s timeout,96s private retry and87.705s Jet website answer. Existing High reasoning, citation/attribution checks and bounded correction remain. No larger batch is authorized.
