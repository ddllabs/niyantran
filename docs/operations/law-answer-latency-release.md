# F250 Law answer latency release

> **Status: Living.** Bounded regression evidence; v91 four-case website acceptance completed; wider qualification remains F251.

## Change and exclusions

PR #35 (85071f5, merged 258c7ad6) removes a discarded draft model call only after successful nonempty scoped retrieval for one attached Law document with web off. Evidence selection, reasoned synthesis, citation validation, accounting and first-provider retryable-error failover remain. Normal research paths retain their original behavior. PR #36 (6b6cf870) extends eligibility to attachments without a desk hint while checking actual Law evidence, and guards the unsupported negative debt-merits contrast observed during acceptance.

PR #37 (eb479912, merged 023bf1dc) raises the selector allowance to 16,000 to avoid the observed truncation while retaining High reasoning; the maximum three-call review allowance is 48,000 tokens.

No model, reasoning, provider routing, schema, worker, corpus, listing, OCR or ingestion changes. No larger batches. The lexical contrast guard does not establish general legal entailment; a source-reviewed regression set is not certification across all law documents.

## Baseline and rejected experiments

V88 four live Globiz turns: 70/161/81/66 seconds; median 75.5s. These historical observations are not simultaneous controlled comparisons or an SLA. Routing-only and direct-synthesis experiments failed timeout or source-support gates and were not deployed; details remain in the implementation plan. The accepted design saves one model call, not a guaranteed percentage of wall time.

## First release and acceptance failure

PR #35 branch/PR CI40093922822/40093946845 and exact-main CI40094437947 passed required app/SQL jobs. Research-chat v89 ACTIVE with all 42 files equal to the reviewed payload, SHA25676db2791707285edcdd970c4e4ef1c464de901a2693536b9250175b279104673; unauthenticated request401. Vercel dpl_AfcGKpwYc4anH8oCEWeCsGjCbWab READY at258c7ad6.

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

## PR #36 publication and preservation

PR #36 merged 663c737f after branch/PR CI40095869851/40095896660 passed required app/SQL jobs and preview. Exact-main CI40096385058 is the deployment gate.

Read-only comparison: all 110 original completed Law documents retain document, text, chunk, input and job fingerprints. During F250, four previously empty records were populated externally (30/97/230/28 chunks), explaining global chunks149,819→150,204 and listings1,435→1,439; document count remains4,569 (Law1,110). This task invoked no ingestion. Concurrent changes are not attributed to the answer release.

Exact-main CI40096385058 passed both required jobs. Research-chat v90 ACTIVE, all 42 deployed files match merged 663c737f, bundle SHA2561c3ee026a5559d9d53c3c880ced190bc90b353f5600d533b05e90022b7c97d4c. Unauthenticated POST401. Vercel dpl_8hynfj7ZgdujZqgA3fYKsdgmWFdB READY at exact 663c737f.

V90 first website acceptance failed before synthesis after 53.939s: selector terminal response_length at8,000 completion tokens (provider reported9,354 reasoning tokens; categories are not assumed additive). ProviderUSD0.004331, user no credits. No unsupported answer displayed. Follow-up selector 16k preserves High and all existing attempt/deadline/validation limits; maximum review allowance 48k. Causal regression32focused and full1,300 Edge pass; independent review found no implementation blocker. Final live acceptance remains pending.

## Final selector release

PR #37 eb479912 merged 023bf1dc. Branch/PR CI40097240030/40097267124 and exact-main CI40097737941 passed both required jobs. Final local 6,575 app /1,300 Edge /32 Law tests, lint/build/diff pass. Independent source review passed all four private answers:81.530/17.151/11.041/22.002s,9calls,USD0.00546616884. False-premise answer triggered negative_merits_contrast and corrected the unsupported debt clause while preserving the debtor’s costs request and operative no-cost order.

Research-chat v91 ACTIVE, all 42 deployed files identical to reviewed023bf1dc payload, SHA25628962c751b96fccf5400d279afb061b8f28770c955196cba735008e1b626c78a; unauthenticated POST401. Vercel dpl_PNDwCsmgiZLzB23qdn5wD8k1B53n READY at exact 023bf1dc.

## Final NTER acceptance — v91

Authenticated website, one existing Globiz document attached, web off, DeepSeek Flash / High. Four questions in one fresh conversation; no re-ingestion.

| Case | v88 seconds | v91 seconds | v91 credits | Answer calls | Source review |
|---|---:|---:|---:|---:|---|
| Original rejection/debt question |70|96.541|22.00|3|Pass:79,63,74,70|
| Attribution follow-up |161|19.890|8.00|2|Pass:41–42,20–21,79|
| Exact date quotation |81|90.391|59.50|3|Pass:74|
| False costs premise |66|20.845|9.01|2|Pass:79,20–21|

Median 55.618s versus historical 75.5s (26.3% lower); mean 56.917s versus 94.5s. This is four historical samples, not a controlled same-time benchmark, uniform speedup or SLA. Original and date questions were individually slower. The original used its one correction for synthesis_shape; the date answer used it for source_quotation_required. Both completed with supported answers; no verification errors in this final four-case run. Ten answer calls total; no discarded drafts. Earlier failed releases remain above.

Independent review checked all clauses against original text. UI citations opened and highlighted the explicit inquiry scope 63, debtor debt-proof passage 41, exact date paragraph 74 and operative order 79. Source references retained original document/chunk IDs and offsets. No excerpts substituted for answers. Final false-premise answer separately states actual no-costs disposition and debtor’s costs request; it does not infer an unsupported negative merits finding.

Read-only evidence IDs (conversation89f08f3e-ea73-48df-b14a-c7492cc92423):1ac938f3-7057-471b-8e8c-0dc7004b9933,cf567874-2793-4ab1-85a7-95a782b6922c,50584f96-eb01-470c-92f2-8ff1b8aaa8ce,ec113454-f9a0-4cdd-a47d-7023fcb26d62. Private transcript and screenshot remain outside Git; public receipt contains no session credentials or corpus text.

Final read-only preservation: all 110 original completed documents remain fingerprint-identical for document/text/chunks/input/jobs. Totals remain 4,569 documents,150,204 chunks,1,110 Law documents and1,439 listings after the separately recorded concurrent activity. This task did not ingest or re-ingest. F250's bounded optimization is complete; representative-order latency distributions, tail reliability and broader semantic qualification remain F251. No batch authorization follows from this release.
