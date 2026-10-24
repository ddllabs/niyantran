# Law next-1,000 cohort: preparation and website sample gate

> **Status: prepared; owner authorization recorded; not yet submitted.** Owner request (Tamanesh Kauri, 2026-10-24
> 14:16 IST): ingest a batch of 1,000 next, approver **Vighnesh Shukla**, after a sample of real nter.pro questions.
> This folder fixes the exact 1,000 documents, the four tranches and their bounds. The release receipt will be written
> to `../law-next-1000-release/` after submission and verification. Nothing here claims legal-answer acceptance, RAG
> acceptance or autopilot readiness: F247 synthesis remains open on main.

## Inputs pinned

| Item | Value |
| --- | --- |
| Repository revision used by the importer, chunker and screener | `cf3e7533209858dadde08274f49fe996dd7179d5` (main has since moved to `2429d5f`; the ingestion scripts and chunker are byte-identical, only research-chat/answer code changed) |
| Archive | `NTER_legal_pack_v1.1_FULL_2026-10-18.zip`, 79,418,376,315 bytes |
| Screens (schema 3, complete subtree scan, policy hashes verified) | 2026 parts 00001–00005 and 00008 screened 2026-10-24 08:53 UTC; parts 00006/00007 reused from the next-100 staging (hashes re-verified) |
| Exclusions | pilot, cohort-2 and next-100 decision manifests |
| Private staging (corpus text stays there) | Drive `Data Handover/Legal/v1.1/staging/staging-next1000-20261024-0853/`, `summary.json` `b48c00b3fdf153cab22e03d9cc00708444dcc2a27d8688b30070c435fa76b8c6` |
| Live presence/listing read | read-only SQL 2026-10-24 09:03 UTC: 3,569 documents, 105,668 chunks, 110 Law documents, 502 Law listings, 0 active jobs |

## Counts

| Stage | Count |
| --- | --- |
| Records screened | 1,231 across 8 members |
| Held by screener | 96: 85 declared duplicate aliases, 10 already decided (pilot), 1 `text_quality thin` |
| Ready unique keys | 1,135 (0 cross-member duplicates) |
| Already registered (the next-100 documents) | 100 |
| Held offline | 29: 25 no case number, 4 file URL not an official order PDF |
| Eligible | 1,006: 943 `create-listing`, 63 `link-existing` (exact official-URL match, type/forum/date/case checked) |
| Excluded as over the 256-chunk / 300,000-char answer-read limits | 3 (`…52736c56beccd7b2` 324 chunks, `…126a036dd1e1dcde` 329, `…b6dcede85484c775` 401) |
| **Cohort** | **1,000 documents = 1,000 legal records: 937 new listings + 63 existing listings, 44,536 chunks** |
| Reserve | 3 eligible, not selected |

Cohort table: `cohort-1000-UNSIGNED.tsv` (sha256 `4e9b6d0d5e891ab19fec937c77c90adcca8bf765d9a4fa1e44b6aa9969e99711`;
fingerprint over `source_key|chunks|text_sha256|proposal` lines `0708c31b9b7e14f91366d57c3338a68f17c921d90a641e6a4dd3ebef420a32c0`).
Largest document 252 chunks; max 194 pages.

## Tranches and bounds (worker concurrency and retries unchanged)

| Tranche | Members | Documents | New / existing listings | Chunks (exact) | Conservative cost ceiling | `--max-estimated-cost-usd` |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 2026 p00001 + p00002 | 289 | 289 / 0 | 10,480 | $0.5558 | 0.56 |
| T2 | p00003 + p00004 | 312 | 312 / 0 | 13,788 | $0.7324 | 0.74 |
| T3 | p00005 + p00006 + p00008 | 211 | 165 / 46 | 10,784 | $0.5733 | 0.58 |
| T4 | p00007 | 188 | 171 / 17 | 9,484 | $0.5021 | 0.51 |
| **Total** | | **1,000** | **937 / 63** | **44,536** | **$2.3636** | **2.39** |

The ceiling is the importer's admission estimate (bytes × $0.00000002 × 3), not a provider cap. Next-100 measured
$0.0201 actual against a $0.2356 ceiling, which extrapolates to roughly $0.20 here (extrapolation only).
Next-100 throughput (100 documents in 11.6 minutes at concurrency 2) extrapolates to about two hours of indexing.

Driver: `nter-law-next1000-live.py` (sha256 `5c59ae72bdea5b5a40235081c9ed74efd28c862ff71a881e3ae6f92d1e0314eb`).
`prepare()` finalizes each tranche with `--keys` (decision IDs `owner-authorized-20261024-law-next-1000-<tranche>-p<member>-<i>`)
and runs the offline dry run; `live(t)` runs `--reconcile` and submits only if every key is ready, every mapping action
matches this table, chunks equal the tranche total and the ceiling is within the bound. A token with under 40 minutes
left is refused. Reports are never overwritten; reruns are duplicate-safe.

## Website sample gate (2026-10-24 14:38–14:56 IST, nter.pro, signed-in admin)

Configuration: NCLT / NCLAT (Insolvency) register, record attached as Full text, Focus “Attached only” (Desk for the
last check), web off, DeepSeek Flash High. Production research-chat v86 returns **extractive original passages with
citations, not generated prose** (the containment behavior described in `../law-answer-validation-release/`). The gate
therefore checked that the new corpus behaves correctly under that release: right document, right operative passage,
no false-premise endorsement, citations opening the original text. Source passages were compared independently by
read-only SQL.

| # | Document (batch B3) | Listing | Size | Question type | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | Surya Milk Products, IB-549/ND/2024 | new | 3 chunks | decision + RP submissions vs findings | Pass: RP submission passage and operative reversal of CIRP; citation highlights the original passage (20.4 credits) |
| 2 | same, follow-up | new | | plain-words outcome | Pass: operative passage (18.8 credits) |
| 3 | Jet Airways, IA 5729/2025 | existing | 35 | workmen status, relief, costs, precedent vs finding | Pass: paras 24–25 dismissal (38.5 credits) |
| 4 | Bhubaneshwar Expressways, IA-2392/ND/2026 | new | 194 | recall, notice, disposition, costs | Pass: para 28 and “No order as to costs”. A third passage came from Jet Airways because that record was still attached (tester carry-over, labelled as a separate source) (40.9 credits) |
| 5 | Mkmg Jewel Developers, I.A. (Plan) 29/2024 | existing | 129 | plan approval and directions | Pass: para 23 ORDER and directions; this PDF holds two orders (plan approval + IA 5399/2025) |
| 6 | same, follow-up | existing | | respondent contention vs tribunal conclusion (IA 5399) | Pass: fresh retrieval; contention paras iii–iv and conclusion xi–xiii (51 credits) |
| 7 | Spacevision Impex, IA/2476/ND/2026 | existing | 4 | false premise (rejected nominee, costs) | Pass: passage shows the SCC proposed no name and the tribunal appointed a liquidator; premise not endorsed |
| 8 | BPL Limited, CP (IB)/10/KOB/2026 | new | 118 | admission, reasoning, costs | Pass: paras 63, 65–67 incl. no order as to costs |
| 9 | Desk-wide, no attachment | — | 110 docs | find the order by description | First attempt failed closed (`research.law_review_rejected` / `invalid_shape`, no credits, already recorded under F247); retry found BPL with the operative passage (34.5 credits) |
| 10 | Global record search “Kalka Home Developers” | new | | listing search | Pass: NCLT order listing and the separate IBBI announcement listing both found |
| 11 | Register filter “Indexed text” | | | listing publication | Pass: 110 / 502 rows |

Outcome: **no new defect attributable to ingestion**; known F247 limitations persist (no synthesized prose;
intermittent fail-closed). Observations for the app team, not blockers: a single official PDF can contain two orders
under one listing title; in the research panel, a previous chat's attachment can remain attached (collapsed under
“More attachments”) after starting a new chat. A sample does not certify every document, question or model.
