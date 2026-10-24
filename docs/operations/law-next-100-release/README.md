# Law next-100 release receipt (owner-authorized-20261024-law-next-100)

> **Status: indexed and published; website answer-quality gate still unmet.** 100 new IBBI_NCLT orders are indexed and
> published. This is not legal-answer, RAG or autopilot acceptance: natural-language retrieval and website citations were
> not tested here; F247 remains partially resolved and F249 open. Not permission for a 1,000-document cohort.

- **Authorization:** decision `owner-authorized-20261024-law-next-100`, approver Vighnesh Shukla (relayed in chat by
  Tamanesh Kauri, 2026-10-24 04:13 IST). Bounds: exactly the 100 keys in
  `../law-next-100-prep/cohort-proposal-UNSIGNED.tsv`, ≤ 4,425 chunks, ≤ US$0.24 conservative estimate, worker settings unchanged.
- **Inputs:** repo `cf3e753`; member `2026__part-00006.jsonl.gz` `ac10758f…841a`; schema-3 screen `5c42b48a…cf18`;
  candidates `ed53e061…e128`; decision manifest `af57c78d…d13b` (100 rows; kept with the private staging, no corpus text in Git).
- **Run (2026-10-24 UTC):** offline dry run 100 ready / 0 held / 4,425 chunks / $0.2356 ceiling → live reconciliation
  07:04–07:07, 66 `create-listing` + 34 `link-existing`, 0 mismatches → submit 07:08, 100 registered / 0 uncertain / 0 held →
  first job 07:11, last indexed 07:22 (11.6 min).
- **Verified (read-only SQL):** 100/100 indexed and published; 4,425 chunks (per-document counts and text hashes match the plan
  by fingerprint `c45ed25e…2f41`); 0 missing vectors, all 1536-d; stored-text hash valid 100; one job each, all succeeded;
  0 OCR pages; each listing URL equals its order URL; one source membership each; 100 distinct listings, 66 new + 34 existing
  matching the reviewed mapping (fingerprint `861516b0…31ce`); stored-vector self-lookup top-1 100/100 (global and NCLT-scoped).
- **Cost:** 107 embedding calls, 1,006,176 tokens, **US$0.0201**; no OCR or chat spend.
- **Deltas:** documents 3,469→3,569; chunks 101,243→105,668; Law documents 10→110; `law_records` 436→502;
  memberships 445→545; links/publications 10→110. ANALYZE run on the touched tables.
- **Rerun (same manifest):** 0 submitted, 100 already registered and published, no new jobs, chunks or embedding calls.

Details: `results.json`; re-check with `verify.sql`. Next gate before any 1,000 proposal: stratified natural-language and
citation sample across new/existing listings and long/short orders, party-vs-tribunal attribution and final relief/costs
(see `../law-next-batch-agent-message.md`).
