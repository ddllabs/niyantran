# Law listing release — 2026-10-24

> **Status: Historical (2026-10-24).** Authorized metadata release, not a new ingestion batch.

PR [15](https://github.com/ddllabs/niyantran/pull/15) merged as `2173b95be8dc785ac0c04b7291b6c38c25b45162`. Required Build and tests and SQL fixtures jobs passed on PR run40010260341 and main run40011451185. Production deployment `dpl_4ycjFrqStAqsd5anMH8R2E2dkB3H` is READY with www.nter.pro/nter.pro aliases assigned to that merge.

## Database and functions

Project NTER `vfgcppstyzjarlzyqdac`. Migration source `20261023184450_law_listing_publication.sql` SHA256 `6d6b5a9e028e8a16ff94200a0b154884687d0d6ced67f25461ec2244b509f82c` is recorded by the production migration service as version `20261023192554`, name law_listing_publication. No migration-history rewrite was attempted.

Deployed admin-ingest v7 (index SHA256 `206755c8be2db43a3e7b3566f72263620899a3c90e4480c14d7c0ef9853fab66`) and research-chat v72 (`61ca3e84319d7e356a7fed9248fbc2e3f163a67835a47ac6ed257979123dbcef`). Re-read deployed files matched local inputs. Existing verify_jwt:false configuration is retained because handlers authenticate themselves; unauthenticated POSTs returned401.

Verified inactive/unseeded before switching. After production web aliases were assigned, seed returned435 records and active:false. Reconciliation returned9 link-existing and1 create-listing with zero holds. Published all ten under owner-authorized-20261024-law-existing-ten-listings / Vighnesh Shukla, evidence hash `5092e6a621321afbdb506b7a0182075a82ec257d7dc363ac6f1c80876b24bb16`. Repeated identical publication requests returned identical receipts. Activation returned active:true.

These metadata operations used the authorized Supabase operator connector calling the same service RPCs; they did **not** exercise a live platform-admin CLI bearer submission. Actor was left null rather than inventing an authenticated subject. Local authenticated endpoint/client tests and live unauthenticated rejection are separate evidence. Client operators must use the documented admin endpoint, not service credentials or arbitrary SQL.

## Counts and preservation

| Measure | Before | After |
|---|---:|---:|
| Global documents |3469|3469|
| Global chunks |101243|101243|
| Law documents |10|10|
| Law chunks |527|527|
| Law ingestion jobs |10|10|
| Insolvency register listings |435|436|
| Indexed canonical attachments |0 before seed|10|
| Historical Law embedding cost USD |0.00232816|0.00232816|

All document-row, input-row, job-row and complete chunk-row fingerprints match, including vectors, text, offsets and metadata. No registration, OCR, re-chunking or corpus embedding ran. ANALYZE ran for documents, document_chunks and desk_rows after metadata publication. Full text-free fingerprints, mapping proposals, exact requests, receipts and repeated receipts are in [evidence.json](law-listing-release/evidence.json); [verify.sql](law-listing-release/verify.sql) rechecks read-only state. The plan hash binds the exact private mapping-plan JSON bytes; the same parsed plan is retained in evidence.json.

The baseline had149 NCLT orders and286 IBBI announcements. Future Consumer's8 July order is separate from its11 July announcement, hence150 orders +286 announcements now. A source-only listing is not an indexed document;426 listings remain source-only.

## Navigation and mappings

Open Law → Tribunals → NCLT / NCLAT (Insolvency), then Table filters → Indexed text to see all ten. Search company names through Table filters. Select the row (outside its external PDF link), then Ask AI about this order; full-text attachment resolves the canonical document key.

| Listing | Existing chunks | Canonical document key |
|---|---:|---|
| In the matter of Future Consumer Limited | 95 | `law-record:35f91d92-3f9c-4c46-9c64-460c0f58f478` |
| In the matter of Globiz Exim Private Limited [C.P. (IB)/595/MB/2025] | 80 | `law-record:51c3a5e3-f81d-4d40-b9df-d6ffc74b5581` |
| In the matter of Bigmoon Buildcon Private Limited [IA No. 1258 of 2025 in C.P.(IB) No. 572(PB)/2019] | 42 | `law-record:5ebb69a7-1d1b-4a63-a45f-ce2879d983a8` |
| In the matter of Coastal Automobiles Private Limited [IA (IBC)(Dis)/1/2026 in CP(IB)/07/7/AMR/2020] | 75 | `law-record:4fc22758-70c1-47c6-a9a6-804eaccd76db` |
| In the matter of FNM PROPERTY SERVICES PRIVATE LIMITED [C.P. (IB)/393/ND/2025] | 40 | `law-record:0afc1499-cf68-43b9-9275-f5c74a4be85e` |
| In the matter of Jet Airways (India) Ltd. [IA No. 5460 of 2025 in CP (IB) No. 2205 of 2019] | 40 | `law-record:ccad5188-b6ef-46e0-b747-026cb85ca9cb` |
| In the matter of JRN PHARMA AND LABORATORIES LLP [CP (IB)/7/GB/2024] | 53 | `law-record:27560847-0f06-4921-a778-b25ac6599482` |
| In the matter of Samata Nagari Sahkari Patsanstha Maryadit vs. Satish Suresh Sawai, [C.P. (IB) NO. 346 of 2026] | 29 | `law-record:09e864cd-53be-4f85-917c-3cde8c93bedc` |
| In the matter of SUNIMA STEEL MARKETING PRIVATE LIMITED [Company Petition (IB) No. 43/KB/2025] | 35 | `law-record:2ced5ed8-6e85-4157-9738-932e8c43831c` |
| In the matter of SWADESH GREEN INFRA LIMITED [IB-394(ND)/2025] | 38 | `law-record:7ad1f3e0-f3ba-4a04-a1f5-1fb443a4b9a5` |

Authenticated-role listing query returned exactly10 indexed rows /436 total; attachment resolution returned the exact ten expected document IDs. Globiz global-search RPC returned its canonical key. Website tests used the owner's signed-in account.

## Website acceptance and limits

Globiz search returned one indexed order; selected-record AI showed Full text, web off. A fresh natural-language question retrieved40 passages in1415ms, answered with seven citation markers from one document and charged23.9 research credits. Citation opening loaded the original OCR and the exact official PDF URL. This is actual query retrieval, not vector self-lookup. Existing page_number values are null for this supplied-text corpus; page labels are present inside OCR text. The citation panel opened the document text rather than proving exact-page navigation.

The answer overstated debtor submissions as tribunal findings: section3 is “CONTENTIONS OF CD”, whereas the answer attributed paragraph3.31's unproven-debt argument to the tribunal. It acknowledged the exemplary-costs distinction in a later caveat but still overstated confidence. **Retrieval/citation plumbing passed; legal answer-quality acceptance did not.** Tracked F247; do not present this as blanket RAG correctness or autopilot approval.

Future Consumer search showed both distinct entries:11 July IBBI announcement/source-only and8 July NCLT order/indexed. The indexed order attached Full text. A fresh three-sentence question completed in8 seconds with one document search, two citations and18.5 research credits, identifying the correct parties, C.P. (IB)/914/MB/2025 and CIRP admission. Its legacy record panel incorrectly said the case number was absent despite structured case_number; F248 tracks this presentation defect. Do not rewrite canonical titles or immutable corpus to hide it.

No end-to-end natural-language test was run for every one of the ten documents. No throughput or1000-document capacity test was run.

## Operational warnings and next step

Supabase advisor delta: two INFO no-policy tables (service-only law_publications/law_source_memberships), one WARN authenticated security-definer function (boolean law_document_is_published visibility predicate). These reflect intentional tested grants, not an assertion of zero advisor warnings. Production dependency audit reported zero vulnerabilities. Broader pre-existing findings were unchanged.

Before rollback to readers without law-record attachment support, coordinate database serving and projection compatibility; do not simply roll back the web alone after seeding. Prior web deployment was dpl_3J31e3tVYnhsg7wAV6nqKtwWBzes; private previous function backups retained locally. No rollback was executed.

Use the [client guide](law-listing-client-guide.md) and [paste-ready next-cohort message](law-next-batch-agent-message.md). Preparation of up to1000 new supported documents is permitted by that handoff; submission is not. F246 source-register refresh, unsupported forum adapters, broader orchestration capacity gates and F247/F248 remain open.
