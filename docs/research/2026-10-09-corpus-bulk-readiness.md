# Bulk corpus readiness after the accepted pilot

> **Status: Historical (2026-10-09).** Executed preparation snapshot. No bulk writes. The [execution plan](../plans/2026-10-09-corpus-bulk-preparation.md) remains Living.

## Result

A reviewable first stage of **23 documents, 23 bill keys (22 newly covered), 518 chunks** is prepared. Existing full text is preserved exactly. Live source IDs, current bill-row identities, the actual Download PDF resolver, PDF opening identity and document version were checked. This is a proposed stage, not an ingestion result. The owner-accepted single pilot remains the only live write from this task.

The full screened pool cannot yet be called ready for a listing-consistent bulk run: the Download PDF resolver often selects another bill's analysis, and nonbill scoping is incomplete.

## Fresh inventory

All 13,919 remaining screened direct-PDF records passed local text SHA/length validation and offline chunking/span validation. No exact text duplicates were found within this selected pool. This does not establish perfect OCR accuracy or identity from every actual remote PDF.

| Collection | Remaining documents | Actual chunks | Estimated tokens | Estimated embedding USD |
| --- | ---: | ---: | ---: | ---: |
| Bills | 7,064 | 359,397 | 80,082,645 | 1.601653 |
| Parliamentary questions | 6,750 | 70,261 | 16,735,419 | 0.334708 |
| Regulatory | 76 | 469 | 103,779 | 0.002076 |
| Transfer orders | 29 | 116 | 21,304 | 0.000426 |
| Total | 13,919 | 430,243 | 96,943,147 | 1.938863 |

The accepted sample was excluded using a fresh production snapshot. Previous audit exclusions and review flags remain excluded; this inventory is not the entire 24,801-document pack. Nonbill documents (6,855) remain on hold for record attachment/scoping work. Strict current bill-row identity checks hold 93 bills; another 53 bills exceed 700 chunks and require a separate bounded-ingestion approach. These are conservative gates, not proof that every held record is intrinsically wrong.

## Download PDF relationship

Executed `analysisFor` and `buildBillModel` from `src/lib/impactRecord.js` against current Supabase bill rows and the current embedded analysis map. URLs were compared with normalized encoding. Pack URL-to-bill-key relationships distinguish the following:

| Relationship | Documents |
| --- | ---: |
| Same PDF as the listing button | 539 |
| Listing PDF associated with another bill key | 4,584 |
| Same bill, another document version | 892 |
| No resolved Download PDF URL | 947 |
| Different URL whose identity is not yet proven | 102 |
| Total remaining bills | 7,064 |

**524** of the 539 exact-URL records also pass current identity and size gates. They represent 524 distinct current bill keys. The other 15 are held by the preceding checks. Only 25 of these 524 had their actual PDFs fetched during this preparation; 23 pass opening identity checks, two remain held. The other 499 were not fetched here. Together, the two held and 499 untested records form the remaining 501 outside the proposed stage.

The resolver's fallback indexes bill number and category without year. Example: `bill:2008:LXI`, National Food Security Authority Bill, resolves the listing button to `Judcial-EI.pdf`, while its mapped source is `nationl food LXI of 08.pdf`. Conversely, the Appropriation (Railways) No. 2 Bill, 2017 links an introduced version while the listing button resolves a gazetted version of the same bill. The categories must not be conflated. Pack relationships alone are not proof of each remote PDF's actual content.

Hold examples in the first 25: the Appropriation Bill, 2025 is mapped to bill key 34 but the extracted PDF header reads `3-F`; this needs visual confirmation before alleging a wrong URL. Manipur Appropriation (No. 2), 2025 has garbled PDF header/text extraction and needs another identity-reading method. Neither is included in the proposed stage. Passed-both-houses PDFs commonly have `-F` number suffixes; these were accepted only where version metadata agrees.

## Capacity and estimate

Live NTER: 2,341 documents / 54,346 chunks; 9,415 current distinct bill keys, 1,238 with indexed documents. `shared_buffers=512MB`; `effective_cache_size=1536MB`; these are PostgreSQL settings, not measurements of total server RAM. Index 214,515,712 bytes (~204.6 MiB), database 945,974,419 bytes (~902.2 MiB). Planner estimate for chunks exactly matches the count; postmaster started 2026-09-28.

Using today's index bytes per chunk as a linear estimate, the proposed 518 chunks add ~1.95 MiB. Adding all 359,397 bill chunks would project the index to ~1.52 GiB; actual growth and retrieval performance must be measured, not inferred from this extrapolation. The 524 exact-URL candidate cohort has 35,714 chunks, projecting a total index near 339 MiB. This is a review forecast, not a throughput or safety guarantee.

Public OpenRouter embedding model catalog was fetched during preparation: `openai/text-embedding-3-small`, prompt USD 0.00000002/token. Proposed stage: 128,224 estimated tokens, **USD 0.00256448**. Actual tokenization/cost may differ. No paid provider calls were made during preparation. OCR, database compute/storage, chat and retries are excluded. No credible end-to-end runtime estimate is available until measured stage throughput exists.

## Evidence and next gate

Thread evidence directory `corpus-bulk-preparation` holds `inventory.csv`, `inventory.jsonl`, `inventory-summary.json`, `initial-pdf-preflight.json`, `embedding-price.json`, `proposed-first-stage.json`, `proposed-first-stage-manifest.json`, exact text files and SHA-256 checksums. Source archive locations/line numbers are in the inventory. The initial manifest contains exactly 23 documents and no credentials.

Next: owner reviews the first-stage manifest and authorizes its scope; implement and verify a bounded resumable runner before invoking it. After the first stage, measure actual index growth and retrieval. The cross-year listing resolver, document-version display behavior, nonbill scoping and oversized-document path are explicit R7 follow-ups. No source-code fix or deployment has occurred in preparation.
