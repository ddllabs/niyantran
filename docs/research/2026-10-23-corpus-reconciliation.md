# Local corpus, citation mappings and stored-state reconciliation

> **Status: Historical (2026-10-23).** Read-only source/database review, with report artifacts generated locally. No application implementation, ingestion, OCR, database mutation, paid provider call or deployment. This is inventory and evidence, not release approval. [Proposed orchestration spec](../specs/2026-10-23-supplied-text-bulk-orchestration.md); [open work](../plans/open-work.md).

## Executive findings

The downloaded data is already substantially structured. The National citation pack contains stable source IDs, supplied text, hashes, citation information and proposed relationships. The legal pack likewise contains text, citation objects, suggested document keys and proposed desk rows. The required work is deterministic reconciliation, source-specific validation and integration—not hand-writing a mapping for every file or repeating OCR.

Fresh Supabase metadata shows **3,459 stored documents, 3,456 indexed documents and 100,716 chunks**, all under National. There are **2,214 covered bill keys out of 9,415 current distinct keys**; **7,201 are not covered** by an indexed document under that key. Key coverage does not prove every version/attachment is present, and an uncovered key does not establish that an eligible local document exists.

The National text-source inventory has **35,358 records**: **3,455 already indexed, 315 prepared, 26,124 held, and 5,464 excluded from this ingestion inventory**. The current citation pack accounts for 24,801 of these. One additional indexed PDF-upload source is outside that original/pack inventory, explaining 3,456 indexed documents in the database. Three held National records already exist as unindexed recovery stubs.

“Prepared” means the existing frozen stage and offline checks pass. It does not mean execution is currently running or approved by this task. The prior continuation is held after a pre-write fetch failure; fresh transport, authorization, capacity and time-sensitive execution checks are still required.

## Evidence location and method

All detailed artifacts are under:

`/Users/vighneshshukla/.codex/visualizations/2026/10/22/01a164c1-e43b-7dc1-a740-4076165a94d6/corpus-reconciliation-20261023/`

Call this directory **E** below. It contains metadata and local analytical outputs; it is not a production queue. The source archives and previously frozen job artifacts were not modified. Local one-off analytical commands streamed compressed inputs and generated inventories; no ingestion or application scripts were implemented.

Supabase project: `vfgcppstyzjarlzyqdac`. The National REST snapshot ran **2026-10-22 21:23:56–21:24:16 UTC** (2026-10-23 in Asia/Kolkata), reading ordered pages of 1,000. The independent SQL count was taken at 21:23:29 UTC. A second SQL audit at 21:46:45 UTC confirmed unchanged totals, zero orphan chunks, zero unindexed documents retaining chunks, zero indexed documents without chunks, and only two succeeded/done website jobs. These reads are not a single transactional snapshot. `snapshot.json`, `documents.json`, `chunk-stats.json`, `national-desk-rows.json` and `law-live-snapshot.json` preserve the evidence and timestamps. Credentials were not written to these artifacts.

Full National scans covered all current records, all chunk records, all OCR exports, all citation sources and every manifest file. The report compares source IDs/hashes and mapping metadata to current stored state. It does **not** re-download every public PDF or repeat a semantic review of every OCR passage. Existing indexed outputs are preserved; a current full-vector/citation re-audit of all historical ingestion was not performed.

## Local resource inventory

| Resource | Role and reconciliation treatment |
|---|---|
| `~/Downloads/NTER-Complete-Processed-Data/01_original_corpus/documents.jsonl.gz` | Canonical current National/general source corpus: 1,876,044 unique records; no duplicate IDs in the full scan. |
| Same folder, `chunks.jsonl.gz` | 2,181,204 supplied chunk records, referencing 1,845,045 current IDs; zero IDs missing from the current corpus. They are not automatically the application's current chunker output or existing Supabase embeddings. |
| `~/Downloads/NTER-Complete-Processed-Data/04_indexes/` and `03_individual_ocr/` | OCR index and text exports, with hash and source-occurrence provenance. 17,443 ID/text versions across 15,093 IDs; 12,830 current-version flags, 4,613 other versions. All 17,443 markdown hashes and adjacent metadata presence checks pass. 37,096 occurrence records are provenance, not additional documents. |
| `~/Downloads/citation_pack_v1/` | National citation pack, internally schema 1.1: 24,801 sources in nine collections; 19,338 declared desk-link rows. The folder's name does not define the internal schema version. |
| `~/Downloads/NTER_citation_pack_v1.1_2026-10-05.zip` | All 14 members byte-identical to the extracted National citation package. Do not count it twice. |
| `~/Downloads/NTerminal-KnowledgeBase-2026-09-14/` | Historical handover/instructions and corpus fingerprints. Its manifest says the corpus itself is not included in that knowledge-base package. |
| Supplied Citation Readiness Report | Historical Oct 9 guidance and audit findings, not today's stored-state count. Extracted text is `E/supplied-readiness-report.txt`; prior detailed mapping decisions were reconciled with current records and retained as historical flags. |
| `~/Downloads/NTER_legal_pack_v1.1_FULL_2026-10-18-001.zip` | Large legal corpus. Internal directory is named `NTER_legal_pack_v1.2_FULL_2026-10-18`; the companion raw-data note explicitly explains this naming difference. Inventory and mappings are included below. |
| `~/Downloads/v1.1-20261022T183527Z-1-00{2,3,4,5,6}.zip` | Small legal companions: raw-data location note, old boxes README, two sample records and a contents CSV. These are not another full corpus. |
| Project `public/data/` | 106 embedded data files, 33,334,872 bytes; individually inventoried and hashed. These are application datasets, not 106 additional unindexed corpus documents. |
| Project `ingest/` | Two existing mapping/configuration artifacts, 2,904,136 bytes; individually inventoried and hashed in `project-data-file-inventory.csv`. |
| Existing corpus scripts and frozen runtime manifests | Application mapping/preparation/release evidence. Completed manifests are historical receipts, not restartable input queues. |

National current extraction counts: **1,840,686 dataset records**, **18,071 PDF-text records**, **12,830 OCR records**, **4,079 HTML records**, **367 document-text records**, and **11 text records**. The last five categories total 35,358 document/text sources. The dataset population is separately enumerated in `current-record-inventory.csv.gz` and `structured-datasets.csv`; it was **not** joined row-by-row against every live desk dataset. It must not be called 1.84 million missing PDFs or assumed wholly unimported.

The 1,039 files in the processed package's source manifest and 13 citation-manifest files all passed byte-size/SHA checks: **1,052 checks, zero failures** (`file-integrity.json`). Historical backups and `_clean.jsonl.gz` are not additive current-corpus counts. Existing source exclusion/licence declarations remain provenance and policy inputs; this report does not issue a new legal clearance.

## National: already ingested, prepared, held

The following categories are mutually exclusive **source-document** counts, not bill counts or relationship counts.

| Citation collection | Total | Indexed | Prepared | Held, current association | Held, mapping | Existing recovery | Excluded |
|---|---:|---:|---:|---:|---:|---:|---:|
| Bills | 9,709 | 2,892 | 315 | 5,718 | 781 | 3 | 0 |
| Bill corrigenda | 365 | 0 | 0 | 322 | 42 | 0 | 1 |
| Parliamentary questions | 6,840 | 82 | 0 | 6,758 | 0 | 0 | 0 |
| Regulatory | 3,319 | 474 | 0 | 119 | 2,726 | 0 | 0 |
| Transfer orders | 29 | 0 | 0 | 29 | 0 | 0 | 0 |
| MP profiles | 3,157 | 0 | 0 | 0 | 3,157 | 0 | 0 |
| Cabinet decisions | 868 | 0 | 0 | 0 | 868 | 0 | 0 |
| Budget documents | 486 | 1 | 0 | 0 | 485 | 0 | 0 |
| Industry documents | 28 | 6 | 0 | 0 | 22 | 0 | 0 |
| **Total** | **24,801** | **3,455** | **315** | **12,946** | **8,081** | **3** | **1** |

There are **21,343 absent citation-pack sources**. Of these, 13,261 have a current-record association and are not the excluded placeholder: the 315 prepared sources plus 12,946 awaiting validation or adapter work. This is the useful potential preparation backlog, not an authorized ready queue.

The other **10,557** current text sources outside the citation pack consist of:

- 10,492 affidavits: **5,399 explicitly marked retrieval-excluded in current source metadata**, and **5,093 held for separate identity/policy/adapter scope**. Neither group is admitted into the bill queue.
- 53 unavailable MP placeholders and 11 explicitly excluded internal/control records: excluded.
- One 615-character project `state_view` record: held without an established mapping.

Thus all 35,358 current text sources reconcile as 3,455 indexed + 315 prepared + 26,124 held + 5,464 excluded. Existing exclusions are preserved rather than recast as ready backlog. Older exclusion/chunk ledgers are retained separately in `exclusion-reasons.json`; their references can describe historical versions or chunk decisions and must not blindly override current record identity.

### Stored identity reconciliation

Of 3,459 stored documents, 3,458 have source keys in the citation pack: 3,455 indexed and three unindexed stubs. For the indexed overlap:

- 2,691 have the exact pack text hash.
- 763 match original/provenance metadata hashes while the stored text revision differs, consistent with prior reviewed preparation/repair paths. This join is provenance evidence, not a new full semantic certification of those transformations.
- One is an existing PDF-pipeline extraction with a different text hash: source `9fca8fe3ef9a99ccad71710b9ba7c0a810ac1f4f`, “The Classified Information and Espionage Control Bill, 2025.” Preserve its extraction/pages; do not overwrite it with pack text merely to make hashes equal.

The one indexed document outside the pack/current original corpus is the PDF upload with source key `upload:fadd34c625f6188f21b3a709eb6f438b18949a4591dc7304d299891cacd1e635`, National Anti-Doping Amendment Bill, 2025. It is not a missing local pack record or an ingestion error.

611 indexed pack sources have no accepted association to the current desk snapshot: 472 regulatory, 132 bill, six industry and one budget source. “Indexed” and “currently attached to a desk row” are separate facts. This does not authorize deleting or relinking them.

## National mapping and citation evidence

All **24,801 citation source IDs and text hashes match the current original corpus**. The mapping report preserves **27,478 source-to-current-row edges** across **16,109 sources with at least one association**. Multiple edges do not imply multiple source documents.

| Collection | Current reconciliation rule | Remaining distinction |
|---|---|---|
| Bills/corrigenda | Existing bill key found across current bill features | Association only; title/chamber/version, actual PDF/Download identity and quality proof still matter. |
| Parliamentary questions/regulatory | Current tuple plus full decoded source URL | Stable record-key propagation and selected-record website retrieval need nonbill adapters. |
| Transfer orders | Current exact source URL | Historical row keys changed; use current row identity, not stale row-key equality. |
| Cabinet | PRID against current source URL | No accepted current matches in this snapshot. |
| MP profiles | Historical links checked against current chamber/source | 215 wrong-chamber links rejected; do not transfer Lok Sabha biographies onto Rajya Sabha rows. |
| Budget/industry | No established current-record adapter | Existing indexed text remains; unindexed sources held. |

All National declared text hashes pass. The page scan checked **213,411 numbered and 74 unnumbered entries**, with zero mismatches using the supplied Python/code-point spans. Blindly applying those offsets as JavaScript UTF-16 offsets gives **4,694 mismatches**. Among absent sources, 29 records are flagged for explicit conversion. This is an adapter requirement, not a reason to repeat OCR.

Reasons overlap and therefore cannot be added to derive document totals. Among held pack records, prominent reasons include 8,081 without an accepted current-record mapping; 6,906 needing nonbill selected-record/key propagation; 4,567 without exact/available page citations; 3,188 without a public source URL; 416 shared-text identities needing preservation; 400 prior cohort PDF-identity reviews; 215 wrong-chamber MP links; 113 layout disagreements; 103 historical opening-bill identity flags; and 29 offset conversions. Some are warnings or product-mode limitations rather than independently sufficient exclusion reasons. The detailed source report retains every flag and its historical/cohort origin.

A text-only source can support exact text citations without PDF page coordinates if admitted by the applicable policy. Page numbers, boxes and original PDF availability must never be invented. A hash match proves bytes, not OCR completeness, correct table ordering or semantic identity. The National pack's loader template is not an executable production migration: generated search columns, extraction activation, offsets, embeddings and multiple relationships need the site's actual contracts.

## How ingestion has worked so far

The existing application has both a legacy/supplied-text path and a durable website PDF path. Historical National ingestion used local mapping from original source IDs and source/Download URLs to bill keys, then supplied text to `ingest-documents`, which chunked and embedded into Supabase. Later preparation froze reviewed text/identity/chunk expectations; the runner reconciled existing work, bounded costs and performed independent audits. The original corpus's precomputed chunks are not simply copied and declared indexed.

Evidence records include:

- [Initial mapping study](2026-09-21-corpus-mapping-study.md) and [first-pass plan](../plans/2026-09-21-corpus-ingest-first-pass.md): historical 2,338-document baseline.
- [First stage and correction](2026-10-09-corpus-first-stage-run.md): 23 writes, three key-collision holds, followed by separately authorized held-embedding cleanup. This explains why the three stubs must not be silently retried as absent sources.
- [Wide batch](2026-10-11-corpus-wide-batch.md): 413 documents/7,493 chunks, with cohort exclusions kept separate.
- [Integration review](2026-10-12-corpus-integration-review.md): historical focused/application/Edge/SQL/lint/build verification, not newly run tests for this report.
- [Current continuation](2026-10-23-national-corpus-continuation.md): 395 frozen documents/7,368 expected chunks; 80 completed/audited, 1,491 chunks, 630 scoped citation probes, 80 paid attempts and zero in-flight entries at the held checkpoint. Reported provider use: 140,396 tokens, USD 0.00280792. These are prior execution receipts, not processing performed in this task.

This review revalidated all 395 frozen entries offline with the existing preparation/manifest helpers and current two-feature identity/Download resolver metadata. **395 pass, 80 present, 315 absent, zero failures**. No fresh public-PDF network check or endpoint execution was performed. The immutable release manifest SHA-256 remains `604716517aed1d417fc3c96933964e87f41ff35d912aeb8f881b0541b6e645b7`. Preserve it and its held checkpoint.

The process has been slow because successful ingestion has included more than producing a mapping: actual source identity/version and OCR/layout corrections, a bill-specific foreground runner, one document in flight, per-source rechecks and periodic independent maintenance gates. A durable preparation registry and shared queue can automate repeated work while retaining exceptions. Expanding a loop to 1,000 concurrent writes would not solve the adapter, recovery or identity gaps.

## Legal pack

Law remains a separate population from National. No Law ingestion was performed or authorized by this report. The archive is 79,418,376,315 bytes (about 74 GiB), and can be streamed without unpacking it. Its central directory has 17,059 entries but only 17,051 distinct paths: eight paths occur twice. All eight repeated pairs are byte-identical (five document shards and three box shards). Count physical entries, distinct shards and unique source identities separately.

The fresh full scan ran **2026-10-22 21:38:11–22:08:32 UTC** and counted **19,336,772 physical document records**, matching the handover. Removing 10,351 superseded base records leaves 19,326,421 selected occurrences. There are 1,070 repeated selected source identities, leaving **19,325,351 distinct selected source keys**. Of those excess occurrences, 1,067 repeat the same source key and text hash; **three source keys have competing text hashes**. Both payloads for each of those three keys are held, with file-specific supplied winner evidence recorded in `legal-competing-revision-evidence.json`. A distinct-source count does not select a text revision for these three cases. The final policy dispositions are recorded below.

All **17,058 payload-entry checks** against the internal contents manifest pass byte size, CRC and SHA-256. The remaining entry is `ZIP_CONTENTS.csv` itself, which does not list its own hash. Every distinct declared path is present; the eight repeated member paths are counted separately above.

### Supplied mapping contracts

| Legal collection | Supplied identity/citation | Proposed application treatment |
|---|---|---|
| Supreme Court English | `law:sc:<file identity>`, SCR/neutral citation, suggested SCR key | Corpus-backed Supreme Court records; current recent-order feed is not an exhaustive historical judgment register. |
| Supreme Court regional | Separate source and language; `citation.translation_of` English source/key | Retain translation identity and its own text/pages; link to parent without overwriting English. |
| High Court | Court, bench, CNR/case, order number/date, file identity; `law:hc:...` | Preserve each order as a document, with case relationships. CNR or case number alone is insufficient to identify an order. |
| Tribunal | Forum/source and source-specific ID, order metadata; `law:trib:...` | Map actual forum/features through a tested adapter; do not equate every tribunal with the current insolvency feed. |
| Acts | India Code act identity, section metadata; `law:act:...` | Section-based citations and a deliberate corpus-backed feature mapping. |
| Regulations | Regulator/instrument identity and sections; `law:reg:...` | Preserve instrument/edition identity, attribution and source availability. |

Current Supabase Law has **874 desk rows**: 434 NCLT/NCLAT insolvency, 220 cross-court order archive, and 220 Supreme Court feed rows. All have null document keys. These are feed records, not the full archive's proposed rows. The checked catalogue is `supabase/functions/_shared/deskCatalog.json`, with source-mode presentation in `src/desks/landing/lawPresentation.js`. Supplied feature names such as “High Court Judgments and Orders”, “Acts and Statutes” and “Supreme Court Judgments (SCR)” are not interchangeable with these current feature names. A mass import needs an explicit catalogue/adapter decision, not millions of manual title matches.

The source's `desk_row`, `document_key_suggested`, citation and URL fields provide machine-readable mapping material. The per-record inventory retains source key, content hash, suggested key and archive member/line, so each proposal resolves back to its complete original citation metadata without duplicating all text into the report. Exact full-URL/current-key associations were checked against all 874 live rows: **140 distinct sources match 140 NCLT/NCLAT rows**. The remaining 734 live rows have no match by these accepted rules. This does not claim that every unmatched title has no related judgment elsewhere. Title-only matches are not promoted.

The complete translation-parent join checked all 111,294 regional records against 38,358 English source IDs. **111,277 parent source/key pairs match; 17 name an English source absent from this local pack.** Those 17 relationships are preserved as exceptions in `legal-translation-parent-exceptions.csv`; do not invent or silently redirect the missing parent.

### Replacement, deduplication and sensitivity rules

The sensitivity and deduplication files **are present inside the legal ZIP**. An initial grouping missed these trailing entries; the complete central-directory inspection corrected that finding. No companion download is currently needed merely to obtain those two lists.

- `flags/sensitive_cases_v1.csv.gz`: **647,241 rows, 647,057 distinct source keys**. The supplied categories comprise 533,327 statute-triggered rows and 113,914 word-only rows. These are source-provided flags requiring the serving policy, not this report's legal determination about each document.
- `dedupe/duplicate_documents_v1.csv.gz`: **1,872,280 rows, 1,843,169 distinct source keys**, in 581,698 groups. Every group has exactly one declared keeper. The two match types contain 1,152,254 same-text drop rows and 138,328 same-case/order drop rows; those counts overlap.
- There are **1,271,630 distinct declared drop keys** and **2,007 keeper/drop overlaps**. After distinguishing self-identity occurrence rules, 1,270,570 keys have non-self drop edges. 1,066 keys have a self-identity drop row; for 1,060 this is their only drop relation. Do not discard the sole selected source because its repeated occurrence was marked duplicate.
- A provisional source-key-level audit of the non-self keeper graph yields **86 source exceptions with competing terminal keepers**, no non-self cycles. Preserve those exceptions for a deterministic winner decision. Do not apply a blanket `keep=0` filter to source keys without occurrence and cross-rule reconciliation. The three competing-text cases demonstrate why the supplied `file` selector must be applied at revision level before final canonical alias selection; the source-key graph is an audit proposal, not an executable dedupe instruction.
- **22,814** distinct sensitivity-flagged keys also occur among declared drop keys; the two populations cannot be added as separate exclusions.
- `not_in_pack/still_not_in_pack_v1.csv.gz` lists **53,478 missing items**. They are not text records available to ingest from this archive. Older missing/OCR-needed lists are historical layers, not additive new backlog. These missing items need not block an independently eligible release of downloaded sources.

The external companion contents CSV and the ZIP's internal contents CSV have the same distinct paths but disagree on compressed-byte SHA/CRC for exactly three files: sensitivity, deduplication and the latest not-in-pack list. Their listed sizes agree. The report uses freshly checked local bytes against the internal manifest and retains both manifests plus `legal-contents-differences.json`. The external checksums must not be represented as matching this local revision; the cause of the difference is unverified.

### Citation evidence and remaining quality boundaries

The full document scan verified every text hash and page-text range using the supplied code-point convention: **zero failures**. Every physical record contains a suggested document key and a nonempty citation object; this establishes supplied mapping material, not independently verified legal accuracy or field completeness.

A targeted check identifies **169 incomplete-page declarations**: 55 English Supreme Court and 112 regional Supreme Court records still marked `cut_at_250`, one tribunal record `cut_at_1000`, and one replacement High Court record `partial`. These are listed by source key in `legal-incomplete-page-declarations.json`; passing hashes/ranges do not clear their completeness holds. Separately, all **22,095 Acts/regulation records and 331,213 section ranges** were scanned; all ranges are in bounds. Section entries do not repeat section text, so this proves span bounds, not substantive completeness. **11,118** of those documents declare missing numbered sections. Preserve this disclosure; do not reconstruct missing law text or call a partial instrument complete.

Box sidecars are included and their compressed-file integrity is checked. The supplied rule joins boxes to source key **and the selected content hash**, with page-local offsets and normalized coordinates; replacement records require replacement-compatible boxes. This review does not claim to have visually audited billions of rectangles or joined every individual box to active Supabase pages. Source-side geometry validation claims remain attributed to the supplied manifests. Supplied `text_differs`, partial splits, thin/noisy OCR and missing case details remain quality inputs. Correct UTF-16 conversion and website extraction activation still need implementation and tests.

The supplied `load_legal_pack.sql` and `load_legal_boxes.sql` were inspected, not executed. They illustrate mappings but are not drop-in migrations: the document template upserts existing text, sets `extract_hash` directly from the content hash and writes `document_pages.search_text`; it does not perform the site's durable embedding/activation lifecycle. Adapt these contracts through the orchestrator rather than running the template against production.

No legal source is labeled execution-ready solely because it has a suggested key or a passing hash. The remaining work is adapter/relationship integration, policy and dedupe resolution, citation-contract validation, capacity qualification and an explicit scoped release. These can be applied in bulk to the passing population while reporting exceptions.


### Final Law accounting

These are **distinct source identities**, not ZIP entries or chunks. None is currently ingested into Supabase Law, and none is execution-ready under this task.

| Collection | Distinct sources |
|---|---:|
| acts | 10,029 |
| high_courts | 18,980,736 |
| regulations | 12,066 |
| sc_judgments | 38,358 |
| sc_judgments_regional | 111,294 |
| tribunals | 172,868 |
| **Total** | **19,325,351** |

| Primary disposition | Distinct sources |
|---|---:|
| Adapter, quality-admission and release checks | 17,430,375 |
| Sensitivity/serving review | 624,221 |
| Proposed duplicate alias; not approved for deletion | 1,270,480 |
| Competing dedupe keeper rules | 86 |
| Competing text revisions | 3 |
| Incomplete page declaration | 169 |
| Missing translation parent | 17 |

The primary dispositions are exclusive. Original sensitivity and other flags remain attached and may overlap. **1,270,480 are proposed duplicate aliases; 18,054,871 are held.** Alias proposals are not deletion instructions or final revision-aware dedupe approval. The 275 specific source exceptions are 86 dedupe-rule conflicts, 169 incomplete-page declarations, 17 absent translation parents and three competing-text identities. The three competing identities retain both physical payloads in the export; their unique-identity flag is accounting, not a preferred-text decision.

All non-self dedupe source references and all sensitivity source references were found in the selected identity inventory. A separate complete inventory pass also found all **573,546 distinct declared keeper keys**, with zero missing keeper references. Exact repeated-identity checking found zero digest collisions; the three differing-text cases are real revision differences. The physical inventory conserves **19,336,772 = 19,325,351 distinct identities + 10,351 superseded base occurrences + 1,067 identical repeated occurrences + 3 additional competing-revision occurrences**.

The broad adapter/quality/release category is an engineering and admission backlog, not a finding that millions of documents need manual remapping. Apply approved deterministic rules in bulk, release eligible independent sources and keep explicit exceptions out. It is not necessary to wait for all 53,478 absent items or all held exceptions before a separately approved passing subset can progress.

## Report artifacts and limitations

| Artifact in E | Contents |
|---|---|
| `legal-reconciled-inventory.csv.gz` | All 19,336,772 physical records with original locator/key/hash, exclusive disposition, proposed canonical alias, sensitivity/conflict flags and distinct-identity accounting. |
| `legal-collection-summary.csv`, `legal-disposition-summary.csv` | Law totals by collection and exclusive distinct-source disposition. |
| `legal-current-mapping-edges.csv` | 140 exact associations to current NCLT/NCLAT rows. |
| `legal-feature-mapping-proposals.csv` | Proposed catalogue/adapter routing for all six legal collections. |
| `legal-additional-exceptions.csv` | 275 specific source exceptions; detailed parent/revision/dedupe/page evidence is in the corresponding JSON files. |
| `legal-policy-decisions.csv.gz` | Original overlapping sensitivity and keeper/drop declarations; use the reconciled inventory for primary disposition. |
| `legal-file-integrity.json`, `legal-manifest-membership.json` | Full payload byte/hash checks and manifest membership; retain external-checksum differences separately. |
| `national-source-inventory.csv` | All 35,358 current text sources with stored identity, disposition, current-target count and reasons. |
| `national-collection-summary.csv` | The nine-collection accounting table. |
| `national-prepared-315.csv` | Prepared sources remaining in the held frozen stage; not an execution manifest. |
| `national-held.csv` | 26,124 held current text sources, including separately scoped affidavits and recovery stubs. |
| `national-mapping-edges.csv` | 27,478 current source-to-row associations with methods/roles. |
| `pack-reconciliation.json` | Detailed per-source proposed/current relationships, hash joins and historical/cohort flags. |
| `current-record-inventory.csv.gz` | All 1,876,044 canonical current records, with dataset versus document route. |
| `project-data-file-inventory.csv` | All 108 files under project `public/data/` and `ingest/`, with paths, sizes and fresh hashes. |
| `structured-datasets.csv` | Dataset/source/feature aggregates; no claim of a complete live structured-row reconciliation. |
| `ocr-export-inventory.json`, `ocr-export-summary.json` | Every OCR export version and successful text/metadata checks. |
| `approved-stage-revalidation.json` | Fresh offline checks of the existing 395-source manifest. |
| `file-integrity.json`, `citation-zip-equivalence.json` | National manifest byte/hash checks and extracted/ZIP equivalence. |
| `page-checks.json`, `chunk-stats.json`, `documents.json` | Citation-coordinate checks and live stored metadata/chunk-count evidence. |

CSV values are source data: import as text rather than permitting spreadsheet formula evaluation. Reports are local and not published to the client or any third party. No claim is made that every source is legally cleared, every OCR passage is semantically correct, every public URL is currently reachable, or the current infrastructure can already index tens of millions of documents.

## Completion and verification

Closing read-only SQL at **2026-10-22 22:12:45 UTC** confirmed 3,459 documents, 3,456 indexed, 100,716 chunks, zero Law documents, 874 Law rows and zero queued/running website jobs. Counts remained unchanged from the opening snapshot. This is not a claim of a single transaction spanning the local review.

Executed verification: full compressed-record scans; source and member SHA-256/byte/CRC checks as described; current-record/source/hash joins; OCR-export checks; existing frozen-stage offline helper verification; page/section range checks; translation-parent joins; source/dedupe/sensitivity conservation assertions; `git diff --check`; and resolution of local Markdown links in the new report/spec. No application build, unit suite or SQL fixture suite was run for these documentation/report-only changes. Historical execution tests remain explicitly dated evidence.

Changed durable paths for this task: this research report, `docs/specs/2026-10-23-supplied-text-bulk-orchestration.md`, `docs/operations/corpus-jobs.md` (latest no-ingestion boundary/link), and `docs/plans/open-work.md` (inventory/spec and outstanding gates). Earlier continuation edits and untracked documents were preserved. Work remains uncommitted on `task/national-corpus-1000-20261023`. No source collection, application code, schema, production record, frozen manifest or checkpoint was changed.

Deliberately unresolved: full live reconciliation of the 1,840,686 structured dataset rows; independent substantive review of every OCR passage; every-box geometry/revision joins and visual checks; current reachability of every public URL; the three external companion checksum differences; the recorded source exceptions; nonbill/Legal feature and relationship adapters; and production capacity/release qualification. See the proposed spec and the single open-work tracker rather than treating this report as authorization to execute.
