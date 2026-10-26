# Law batch 6 (next 1,000): preparation and checks

> **Status: Historical (dated 2026-10-26). Submitted, indexed and published; see `../law-batch-6-release/`.** Owner request (Tamanesh Kauri, 2026-10-26
> 16:26 IST): start the next batch of 1,000. Approver **Vighnesh Shukla**, confirmed at 16:29 IST. The receipt will go to
> `../law-batch-6-release/` after submission and verification. This is not a claim of autopilot readiness.

## Inputs and screen

- **Ingestion scripts:** `cf3e753`, unchanged from batches 3–5.
- **Archive and policy hashes:** as before. Member hashes come from the archive's `CONTENTS.csv`, and the screener
  re-verifies them against the actual bytes.
- **Screen:** schema-3 (complete subtree scan, all finalizable), driver `nter-law-batch6-screen.py`. It covered the
  remaining 2025 parts 00006–00009 and the 2024 parts 00001–00004.
- **Exclusions:** every completed manifest (pilot, cohort-2, next-100, next-1,000 T1–T4 and batch-5 T1–T5).
- **Staging:** Drive `Data Handover/Legal/v1.1/staging/staging-batch6-20261026-1100/`, `summary.json`
  `a9aac3351f617fb62bdc61ac650b1dbe11c4102ed0874969b0356455362c9de2`.
- **Live read (2026-10-26 11:10 UTC, read-only):**
  - 2,110 Law documents.
  - 0 candidates already in the database, by key or by order URL.
  - 0 candidates matching any of the 43 unlinked register listings.
  - 0 active jobs.

| Stage | Count |
| --- | --- |
| Records screened | 2,044 |
| Held by screener | 234: 165 already decided (batch 5), 65 declared duplicate aliases, 4 thin text |
| Ready unique | 1,810 |
| Held offline: no case number | 78 |
| Held offline: not an official order PDF URL | 3 |
| Held offline: over answer-read limits | 2 |
| Held as possible duplicate orders | 6 (same normalized case number and order date as another candidate or an existing Law document) |
| Eligible | 1,725 |
| **Cohort** | **1,000 documents = 1,000 new listings, 30,973 chunks** (482 from 2025, 518 from 2024; max 183 chunks, 82 pages) |
| Reserve | 725 eligible, not selected (2024 parts 00002–00004) |

Cohort table `cohort-batch6-UNSIGNED.tsv` (sha256 `7fb618d0d0f1381dacc000e476ceb89f891d9abb5e8973a15964bf70bd489023`).
Verification fingerprint over sorted `source_key|chunks|text_sha256`:
`fabf4f469466b1e983567357707ba4fb06d5f92a78ec74c8476ae9ecd6ea512d`.

## Tranches and bounds (worker settings unchanged)

| Tranche | Members | Docs | Chunks | Ceiling | `--max-estimated-cost-usd` | Token minutes needed |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 2025 p00006 + p00007 | 205 | 7,339 | $0.3896 | 0.39 | 24 |
| T2 | 2025 p00007 + p00008 + p00009 | 205 | 8,625 | $0.4605 | 0.47 | 24 |
| T3 | 2025 p00009 + 2024 p00001 | 205 | 6,248 | $0.3332 | 0.34 | 24 |
| T4 | 2024 p00001 | 205 | 4,836 | $0.2554 | 0.26 | 24 |
| T5 | 2024 p00001 + p00002 | 180 | 3,925 | $0.2076 | 0.21 | 22 |
| **Total** | | **1,000** | **30,973** | **$1.6464** | **1.67** | |

Expected real cost is about $0.14, at the last batch's measured $4.7 per 1,000 chunks. Two fresh 60-minute tokens should
cover T1–T2 and T3–T4, and a third covers T5.

Driver `nter-law-batch6-live.py` uses decision IDs `owner-authorized-20261026-law-batch-6-<tranche>-<year>p<member>-<i>`.
It runs as follows:
- `prepare()` finalizes each tranche with `--keys` and runs the offline dry run.
- `live_many([...])` runs a read-only reconcile and submits only on an exact match with this table.
- Before each tranche it checks the token has enough minutes left. If not, it stops cleanly and clears the credentials.
