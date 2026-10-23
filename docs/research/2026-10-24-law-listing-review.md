# Law listing coverage and PR 13 re-review

> **Status: Historical (2026-10-24).** Read-only investigation; no ingestion or production mutation.

## PR 13 decision: hold merge

Reviewed exact head `c9533bf52f34bb886c59381acb827b48d1cd52cf`. The policy-hash, repeated-entry and incomplete-screen fixes address the original three findings. Screener tests passed 10/10 and supplied-text importer tests passed 7/7. GitHub app/SQL checks and Vercel preview reported success for this head. These checks do not establish correctness of untested conflict representations.

**P1: JSON-escaped source identities bypass conflict scanning.** In `scripts/law-cohort-screen.py:283–288`, the scanner requires the literal UTF-8 source key to occur in raw JSON bytes before parsing. JSON can encode a colon as `\u003a`; this decodes to the same source key but fails that prefilter. Independent reviewer and supervisor executions placed a competing text revision with the escaped identity in another collection shard. Screening reported both production checks true and finalize approved the original candidate. The revision was not recorded as an occurrence.

Required correction: compare decoded identities, or use a conservative prefilter that cannot exclude any valid representation. Define fail-closed handling for undecodable/malformed rows rather than silently certifying a complete scan. Add a regression that fails on this exact head and proves the conflicting escaped identity is held and cannot finalize; retain a clean escaped-identity control. Re-review the new head and required CI before merging. No evidence from this reproduction establishes that the ten already indexed documents are incorrect; no re-ingestion is requested.

## Current source inventory

Counts below are executed local JSON counts and read-only production SQL observations, not assumptions from labels.

| Module | Source and observed count | Meaning |
|---|---|---|
| NCLT / NCLAT (Insolvency) | 148 bundled NCLT orders, 286 IBBI announcements, one Globiz correction = 435 | Mixed metadata register; NCLAT corpus coverage not established |
| Supreme Court orders | Bundled judiciary SC file, 220 | Metadata rows, not indexed-body count |
| Cross-Court topic archive | Same 220 SC rows reorganized | Not another 220 unique judgments or full cross-court coverage |
| WTO disputes | Bundled WTO file, 646 | Dispute register, not proof of document-body ingestion |
| UP High Court, District Courts, NGT, CAT/NCDRC, judge profiles, ICC, ICJ, sector tribunals | Eight forum-specific news feeds/searches | Reporting, not complete official judgment registers |

Code: `server/featureFeed.mjs`, `src/lib/archiveFeed.js`, `src/lib/lawPack.js`, `src/lib/lawListingCorrections.js`, `src/lib/lawLandingSummary.js`. Sources are a mixture of embedded datasets and news integrations. There is no universal API supplying all Law records and linking them to corpus documents.

Production `desk_rows` contained 435 insolvency rows and 220 rows in each SC view. All had null `document_key`. Exact source URL/source-key matching found nine of the ten indexed Law documents in the insolvency register. Ten Law documents contain 527 chunks (241 pilot + 286 cohort 2). An exact match is evidence for reconciliation, not an existing formal attachment.

Future Consumer is the exception: its displayed IBBI announcement dated 2026-07-11 is a different document from the indexed NCLT order dated 2026-07-08, case C.P.(IB)/914/MB/2025. Their URLs differ:

- Announcement: https://ibbi.gov.in/uploads/announcement/9d7de9bc21b1883d378c1e501561d1e3.pdf
- Indexed order: https://ibbi.gov.in/uploads/order/439812925378cc8ca4275463a63997d5.pdf

Do not attach the order to the announcement merely because the company name matches. Create a distinct order listing with an optional case relationship. The other nine indexed documents have exact listing matches: JRN, Globiz, Swadesh, FNM, Coastal, Sunima, Bigmoon, Jet Airways and Samata. Existing source rows without an exact indexed match are not necessarily OCR-ready; reconcile the corpus before classifying them.

## Architectural cause

The supplied-text registration/activation migration inserts immutable text inputs, documents and jobs, then marks indexing successful after chunk/vector checks. It does not publish Law listings. The ordinary NCLT UI reads bundled/feed-transformed rows; `desk_rows` mirrors them for other search surfaces. `load-desk-rows.mjs`/`deskRowSync.js` may delete rows absent from a refreshed source. Merely inserting a listing into that mirror is insufficient.

Existing attachment resolution is bill-oriented (`billDocumentKey`, metadata document keys). Supplied-text document metadata is immutable, so do not patch those documents to introduce links. Legacy listing IDs can include array indexes; preserve them during migration. Law is not currently enabled for database pagination. Listing, global search, selected-row RAG and counts need a common published projection.

## Verification limits

This turn executed the regression and focused test suites, inspected exact-head CI and source code, counted embedded JSON and queried production read-only. It did not execute a new authenticated website answer, modify records, run embeddings, deploy or merge. Source inventory is not a claim of current external-feed freshness or comprehensive judiciary coverage. Earlier 19-million-record reconciliation is a historical inventory, not a statement that those records are now ingestible.
