# Law batch 5 (next 1,000, 2025 orders): preparation and checks

> **Status: Historical (dated 2026-10-26). Submitted, indexed and published; see `../law-batch-5-release/`.** Owner request (Tamanesh Kauri, 2026-10-26
> 03:21 IST): finish the open items from the next-1,000 batch, then start the next 1,000; approver **Vighnesh Shukla**
> (confirmed 03:47 IST). The receipt goes to `../law-batch-5-release/` after submission and verification. Not a claim of
> autopilot readiness.

## Open items from the next-1,000 batch

- **Website sample on the new 1,000** (2026-10-26 03:50–03:59 IST, nter.pro signed-in admin, DeepSeek Flash High,
  Attached only unless noted; research-chat now returns synthesized answers with sentence citations):

  | Document | Listing / size | Question | Result |
  | --- | --- | --- | --- |
  | Canara Bank v. Vidya Devi, IA (IBC) 327/2026 | new, 1 chunk | decision and basis | Pass (8.25 credits) |
  | G & L Profile, C.P. (IB)/22/AHM/2026 | existing, 29 | admitted?, commencement, submissions vs findings | Pass: respondent's prematurity plea kept separate; admitted; CIRP from date of order (14.3) |
  | IMOST Academy, CP (IBC)/8/KOB/2026 | new, 27 | admitted?, default amount, IRP | Pass with caveat: admitted, AAA Insolvency Professionals LLP correct; the Rs 5,70,84,211.69 figure is the petitioner's stated default, which the tribunal accepted only as "the default reported by the Petitioner" (11.7) |
  | Kedia v. Tayal, IA 905/2025 & IA 267/2026 | new, 252 (longest) | decision, excluded period, reason | Pass: allowed; 29.07.2025–26.01.2026 (182 days) excluded for non-cooperation (12.5) |
  | Desk-wide, no attachment | 1,110 documents | find the 182-day exclusion order | Pass: found Kedia v. Tayal with citation (17) |

- **Finding: four duplicate-order pairs in the next-1,000 batch.** Eight documents form four pairs that share a case
  number and order date but have different PDF URLs and 93–99% word overlap. These are likely the same order uploaded
  twice by IBBI, and the pack's dedupe list did not flag them:
  - `C.P. (IB)/579/MB/2025`
  - `C.P. (IB)No. 85/KB/2023`
  - `CP (IBC)/8/KOB/2026` (IMOST)
  - `IA (IBC) (Plan) No. 13/(KB)/2025`

  Each document has its own listing. Nothing was deleted or unpublished; that needs a separate owner decision. These
  pairs also explain the 4 stored-vector self-lookup ties. Batch 5 adds a new hold so this does not recur (below).
- **Duplicate-safe rerun:** done 2026-10-26 06:38 UTC (`rerun_previous_t4()`): 188 selected, 0 submitted, 188 already
  registered and published, US$0. Recorded in the batch-5 receipt.
- **Ledger sheet:** updated from `../law-ledger/ledger-export.sql` once Colab Google auth is granted.

## Inputs and screen

Ingestion scripts at `cf3e753` (byte-identical on main `dc2b411`). Archive and policy hashes as before. Schema-3 screens of
the nine 2025 IBBI_NCLT parts (complete subtree scan, all finalizable) excluded every completed manifest: pilot, cohort-2,
next-100 and next-1,000 T1–T4. 2026 parts 00001–00008 are exhausted. Staging: Drive
`Data Handover/Legal/v1.1/staging/staging-batch5-20261025-2224/`, `summary.json`
`ae80cada1c7c12a9862f0e6501a5e54d3836e9ded058f87dea890b1ac37c77f1`. Live read 2026-10-25 22:32 UTC: 1,110 Law documents,
1,439 listings, 0 active jobs.

| Stage | Count |
| --- | --- |
| Records screened | 1,614 |
| Held by screener | 69 (63 declared duplicate aliases, 6 thin text) |
| Ready unique | 1,545; 0 already in the database; 0 matched to an existing listing |
| Held offline | 53 (51 no case number, 2 not an official order PDF URL) |
| Held as possible duplicate orders (new rule) | 10 (5 pairs with the same normalized case number and order date) |
| Eligible | 1,482 |
| **Cohort** | **1,000 documents = 1,000 new listings, 34,632 chunks** (max 187 chunks; all within answer-read limits) |
| Reserve | 482 |

Cohort table `cohort-batch5-UNSIGNED.tsv` (sha256 `544591c9b7b58e9fb1b4efb38a60f01ceeeb9d84b2e97b538c7e45ca9fa68154`;
fingerprint `e2c2737fe3efdadc8a93ab2be3458d9a20c7d10c4c6295c97ab3d8d02a220198`).

## Tranches and bounds (worker settings unchanged)

| Tranche | Member | Docs | Chunks | Ceiling | `--max-estimated-cost-usd` | Token minutes needed |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 2025 p00001 | 186 | 6,004 | $0.3200 | 0.32 | 22 |
| T2 | p00002 | 198 | 7,367 | $0.3938 | 0.40 | 23 |
| T3 | p00003 + p00004 | 254 | 8,321 | $0.4430 | 0.45 | 28 |
| T4 | p00005 | 197 | 6,513 | $0.3449 | 0.35 | 23 |
| T5 | p00006 (first 165) | 165 | 6,427 | $0.3417 | 0.35 | 20 |
| **Total** | | **1,000** | **34,632** | **$1.8434** | **1.87** | |

Expected real cost is about $0.16, at the last batch's measured $4.6 per 1,000 chunks. Driver `nter-law-batch5-live.py` (sha256 `9e336b796ad9100ee3094de2570cfed1859620ef4ccead3e473fea1924e57d3d`)
uses decision IDs `owner-authorized-20261026-law-batch-5-<tranche>-p<member>-<i>`. Its `live_many([...])` runs tranches
on one token and stops cleanly (credentials removed) when the token cannot cover the next tranche.
