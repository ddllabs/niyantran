# Law batch-10 release receipt (owner-authorized-20261026-law-auto-b10)

> **Status: Historical (dated 2026-10-27).** This is the fourth autopilot batch: 1,000 new IBBI_NCLT orders (2023 pack
> members p00009–p00013 and 2022 p00001–p00006), indexed and published as 1,000 new NCLT listings. It records ingestion
> only. It is not legal-answer or RAG acceptance.

- **Authorization:** standing approval for 5 autopilot batches (7–11) from Tamanesh Kauri (2026-10-26 21:07 IST). See
  `../law-autopilot/README.md`.
- **Inputs:**
  - Ingestion scripts at `cf3e753`.
  - Autopilot core `f99814a4…6797`.
  - Driver `nter-law-autopilot.py` at `8b3133f` (`673f72d3…8ab6`).
  - Plan `28432025…1880` (private staging).
  - `cohort-b10-UNSIGNED.tsv` `d37c2f7a…7cdf` (keys, chunk estimates and text hashes; no corpus text).
- **Selection:**
  - Screened 2023 p00009–p00013 and 2022 p00001–p00006, excluding every earlier manifest.
  - Holds: 738 no case number; 26 near-duplicate text; 3 over the answer-read limits; 2 not an official order PDF URL.
  - Offline dry run: 1,000 ready, 0 held, 22,647 chunks, $1.2002 ceiling.
- **Run (2026-10-27 UTC):** every tranche submitted on its first attempt. No retry or resume was needed.

  | Tranche | Members | Docs | Reconcile | Chunks | Registered UTC (0 uncertain, 0 held) | Embedding cost |
  | --- | --- | --- | --- | --- | --- | --- |
  | T1 | 2023 p00009 + p00010 | 205 | 205 create, 0 mismatches | 4,289 | 02:41–02:48 | $0.0204 |
  | T2 | 2023 p00010 | 205 | 205 create, 0 mismatches | 4,795 | 02:56–03:03 | $0.0222 |
  | T3 | 2023 p00010 + p00011 | 205 | 205 create, 0 mismatches | 4,062 | 03:11–03:18 | $0.0191 |
  | T4 | 2023 p00011 + p00012 | 205 | 205 create, 0 mismatches | 5,044 | 03:25–03:32 | $0.0235 |
  | T5 | 2023 p00012 + p00013, 2022 p00001–p00006 | 180 | 180 create, 0 mismatches | 4,457 | 03:39–03:45 | $0.0208 |

  - The last document was indexed at 05:44.
  - The Colab runtime disconnected at about 05:13, while the autopilot was polling for indexing. Indexing is
    server-side, so it finished regardless. After the owner reconnected Drive access, the autopilot restarted and
    verified the batch at 06:20.
- **Verified (read-only SQL, `verify.sql`):**
  - 1,000/1,000 indexed and published, with 22,647 chunks.
  - The cohort fingerprint over sorted `source_key|chunks|text_sha256` matches the plan (`8e3f687b…7cd1`).
  - Vectors: 0 missing, all 1536-d. Stored text hash valid for all 1,000.
  - One job per document, all succeeded; 0 OCR pages.
  - Every listing URL equals its order URL.
  - Each document has one source membership and its own newly created listing.
- **Duplicate checks:**
  - The normalized same-case-and-date check over all 7,110 Law documents finds no group containing a batch-10
    document.
  - **One overlapping pair needs the owner's review:** `dae6d05550bdb5c3` / `912189341684a077` (MSA Developers).
    - Both are dated 2023-10-13, and both cite I.A. 4224/2021 in CP IB-806-PB-2019, formatted differently.
    - 5 of the shorter order's 6 chunks recur in the 34-chunk order.
    - This is the same pattern as batch 7 (Master Weaver) and batch 9 (Dharti Dredging).
    - Nothing was deleted or unpublished.
  - A same-date containment hold was added to the driver for batch 11 (`ea40c44`).
- **Cost:** 5,299,006 embedding tokens, **US$0.1060** against a $1.2002 conservative ceiling. No OCR or chat spend.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 9,569 | 10,569 |
  | Chunks | 294,066 | 316,713 |
  | Law documents | 6,110 | 7,110 |
  | `law_records` | 6,439 | 7,439 |
  | Memberships | 6,545 | 7,545 |
  | Links / publications | 6,110 | 7,110 |

  ANALYZE was run on the touched tables.
- **Not checked here:** natural-language website answers on these 1,000, and OCR or legal clearance.

Details are in `results.json`. Re-check with `verify.sql` (read-only; one aggregate row).
