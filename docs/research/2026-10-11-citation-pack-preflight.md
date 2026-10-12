# Citation Pack first-batch preflight

> **Status: Historical (2026-10-11).** Owner requested findings before live ingestion. No ingestion, paid embeddings/OCR, deployment, source repair or production data writes performed.

## Result

The Citation Pack's bill mappings were reconciled against fresh Supabase snapshots, independent of the old 7,064-source selection. All 9,709 bill sources were considered. The snapshots contain 2,767 documents and 19,634 bill-listing rows. Within the pack, 2,168 sources are present with indexed timestamps, three are existing recovery records and 7,538 are absent. Existing presence is not a fresh full vector audit.

There are 6,295 absent sources with an exact pack identity match against both current bill features: bill key, title, number and chamber, without a conflicting current identity under that key. Of these, 2,408 pass the initial source-hash, ordinary bill-role, section/clause-detection and size screening used here. These are candidates, not quality-certified sources. Suspicious or unproven records remain in the ledger; they were not deleted or declared unusable.

The first selected 500 contain 7,095,372 characters and 11,247 complete version-4 draft chunks. Selection prioritizes matching baseline Download URLs, then recent registration years and smaller complete documents. It does not truncate documents or pad a released batch with failures.

## Executed checks

- Full original/pack text hashes checked for selected sources. Source files are unchanged.
- Deployed `ingest-documents` version 19 was read through Supabase. Its handler, chunker and text-context files match local source byte-for-byte after removing an extra newline introduced when saving the tool response.
- All 500 full texts were submitted sequentially to that deployed endpoint with hard-coded `dry_run:true`. **500 passed**, with exactly **11,247 expected chunks**, all proposed as new, zero retained/deleted chunks, zero embedding tokens and USD 0 usage. The helper contains no live-ingestion mode.
- 500 source PDFs fetched/screened: **402 identity passes**; **234** also match the source text ignoring whitespace only. Neither test certifies semantic OCR/layout quality.
- Remaining 98 source checks: 45 number/year/header issues, 42 title issues, five version issues and six distributed-body disagreement issues. These require evidence review; an unreadable header is not proof of a wrong document.
- **40 existing retrieval probes passed**: 20 broad and 20 scoped across five indexed bills. Broad p95 ~391 ms, scoped p95 ~364 ms. This is a diagnostic review-batch measurement, not the eventual release's bound baseline.
- Official capacity metrics over 61.4 seconds: **CPU 2.56%, available memory 52.16%, disk busy 0.064%**, passing configured thresholds. An earlier 35-second pair had an invalid metric interval; it was not treated as a pass and was replaced by the valid measurement.
- Public OpenRouter model response: `openai/text-embedding-3-small`, USD 0.00000002 per input token. The selected cohort's conservative UTF-8-byte token ceiling is 8,484,051, giving **USD 0.16968102**. This is an upper-bound estimate, not billed usage or permission to embed held sources.
- Fresh final live counts: **2,767 documents / 2,764 indexed / 87,886 chunks / zero null vectors / zero orphan chunks**, unchanged.

## Download and version findings

The Download comparison uses the saved pre-change resolver with fresh listing data. It is not a fresh deployed-browser verification. Do not mislabel these computed results as live UI acceptance.

| Baseline Download relation to pack source | Count |
| --- | ---: |
| Same source URL | 14 |
| Another version of the same bill key | 70 |
| Pack associates the Download URL with a different bill key | 316 |
| Missing or ambiguous Download identity | 100 |

Different URLs were not automatically rejected. All 70 same-bill version pairs were separately fetched/screened. Fifty-eight Download URLs use the Gazette/unsupported path and need explicit bill-to-Act/source proof; that path restriction is not evidence that their PDFs are unusable. Eight Download identity screens passed; only two pairs passed both source and Download checks. The remaining four Download results comprise three number/year/header failures and one body-agreement failure.

The two paired passes are `074b34020e9bec0388584455e60e91da17941ee4` (introduced) and `0fc48ad9ff26857653f149cb01df69f9f571e59f` (Lok Sabha passed), both mapped to `bill:2022:290`. Their original source and Download texts match independent PDF text extraction ignoring whitespace. The latter PDF explicitly bears registration 290-C of 2022 with title/short-title 2023. The worker's manual-year hold remains; it requires a reviewed replacement proof, not removal of the guard. Their schedule continuation chunks also omit column headers and split row text, so full table-context quality is not accepted. Neither source is released.

## Release status and next action

**All 500 are technically accepted by the Edge Function's dry-run chunking path. Zero have completed every mandatory release check.** The actual obstacles are source/Download proof, the analysis resolver's wrong-key associations, and complete source/layout/context acceptance—not endpoint capacity or a need to re-OCR every document. Pending review must not be presented as a defective-file count.

Before live ingestion, resolve the cross-key Download associations with the pack-backed identity mapping and verify deployed behavior; supply explicit Gazette and registration-year/version proofs where appropriate; finish source-specific layout/table-context review and repair only demonstrated defects with originals preserved. Then freeze the passing subset (at most 500) and refresh its exact manifest-bound health, price/budget and writer checks. Ingestion approval exists, but the owner explicitly requested these findings before starting; no live process was started here.

## Evidence

Directory: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/citation-pack-preflight-20261011`.

- `pack-live-inventory.json`: all 9,709 bill sources, current presence and mapping/check statuses.
- `preflight-candidates.json`: 500 selected full-text/chunk drafts; execution disabled.
- `endpoint-dry-run.json`: all 500 endpoint results, bound to candidate hash.
- `pdf-screen.json`, `version-check/pdf-screen.json`: source and version-pair receipts, cached PDF hashes.
- `download-relations.json`: exact baseline Download/key relationships.
- `deployed-code-comparison.json`, `health-preview.json`, `capacity-check.json`: deployed code, retrieval/price and valid capacity evidence.
- `preflight-review.csv`: reviewable 500-row status/hold table.
- `preflight-report.json`: consolidated evidence; SHA-256 `b0e835fd4c47e9c3b2b6ae8bca5b92a2b12687b93d4cc7e4c4eaf2041f72a2f8`.

No repository implementation code changed this turn. Documentation and local evidence added; previous uncommitted work preserved on `task/corpus-single-pilot-20261009`. No push, merge or deployment.
