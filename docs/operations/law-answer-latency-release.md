# F250 Law answer latency release

> **Status: Living.** Bounded regression evidence; final v90 website acceptance pending.

## Change and exclusions

PR35 (85071f5, merged258c7ad6) removes a discarded draft model call only after successful nonempty scoped retrieval for one attached Law document with web off. Evidence selection, reasoned synthesis, citation validation, accounting and first-provider retryable-error failover remain. Normal research paths retain their original behavior. PR36 (6b6cf870) extends eligibility to attachments without a desk hint while checking actual Law evidence, and guards the unsupported negative debt-merits contrast observed during acceptance.

No model, reasoning, provider routing, schema, worker, corpus, listing, OCR or ingestion changes. No larger batches. The lexical contrast guard does not establish general legal entailment; a source-reviewed regression set is not certification across all law documents.

## Baseline and rejected experiments

V88 four live Globiz turns:70/161/81/66 seconds; median75.5s. These historical observations are not simultaneous controlled comparisons or an SLA. Routing-only and direct-synthesis experiments failed timeout or source-support gates and were not deployed; details remain in the implementation plan. The accepted design saves one model call, not a guaranteed percentage of wall time.

## First release and acceptance failure

PR35 branch/PR CI40093922822/40093946845 and exact-main CI40094437947 passed required app/SQL jobs. Research-chat v89 ACTIVE with all42 files equal to the reviewed payload, SHA25676db2791707285edcdd970c4e4ef1c464de901a2693536b9250175b279104673; unauthenticated request401. Vercel dpl_AfcGKpwYc4anH8oCEWeCsGjCbWab READY at258c7ad6.

| Case | v89 seconds | Credits | Source review |
|---|---:|---:|---|
| Original rejection/debt question |107.384|32.10|Pass|
| Same-conversation attribution follow-up |14.431|7.66|Pass|
| Paragraph7.29 exact date quotation |21.700|21.90|Pass|
| False costs premise |19.038|8.69|Fail: negative debt-merits contrast cited only to disposition|

All used two answer calls. Original selection94.457s plus synthesis10.514s explains its outlier; it was not a desk-hint failure. Median20.369s did not satisfy quality acceptance because the fourth answer failed. Original, follow-up and date citations were opened in the NTER source reader and matched chunks79,41,20 and74.

## Follow-up validation

Four no-hint tests failed before eligibility fix. Negative-contrast regression failed before guard; supported-contrast control failed the initial blanket guard and passes the source-matching refinement. Final31 Law /178 handler /1,299 full Edge tests pass, lint/build/diff pass;6,575 app tests passed before the isolated Edge refinement and are rerun by CI. Independent review found no blocker.

Private false-premise replay:30.112s, two calls,USD0.00100791936. Separately cited no-costs disposition79, debtor’s exemplary-costs request20–21 and debtor’s debt-computation argument41–42. Independent review passed. No guard activation in this sample; causal fixtures prove the correction path. Final four-case NTER validation is required after deployment.

## Recovery

Restore research-chat from the prior reviewed payload if the follow-up causes regressions; preserve the function’s existing authentication configuration. No data rollback is needed because this release performs no corpus mutation. Do not bypass required CI or publish a failed answer as accepted evidence.

## PR36 publication and preservation

PR36 merged663c737f after branch/PR CI40095869851/40095896660 passed required app/SQL jobs and preview. Exact-main CI40096385058 is the deployment gate.

Read-only comparison: all110 original completed Law documents retain document, text, chunk, input and job fingerprints. During F250, four previously empty records were populated externally (30/97/230/28 chunks), explaining global chunks149,819→150,204 and listings1,435→1,439; document count remains4,569 (Law1,110). This task invoked no ingestion. Concurrent changes are not attributed to the answer release.

Exact-main CI40096385058 passed both required jobs. Research-chat v90 ACTIVE, all42 deployed files match merged663c737f, bundle SHA2561c3ee026a5559d9d53c3c880ced190bc90b353f5600d533b05e90022b7c97d4c. Unauthenticated POST401. Vercel dpl_8hynfj7ZgdujZqgA3fYKsdgmWFdB READY at exact663c737f.

V90 first website acceptance failed before synthesis after53.939s: selector terminal response_length at8,000 completion tokens (provider reported9,354 reasoning tokens; categories are not assumed additive). ProviderUSD0.004331, user no credits. No unsupported answer displayed. Follow-up selector16k preserves High and all existing attempt/deadline/validation limits; maximum review allowance48k. Causal regression32focused and full1,300 Edge pass; independent review found no implementation blocker. Final live acceptance remains pending.
