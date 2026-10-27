# Law batch-9 release receipt (owner-authorized-20261026-law-auto-b09)

> **Status: Historical (dated 2026-10-27).** This is the third autopilot batch: 1,000 new IBBI_NCLT orders from the 2023
> pack members p00001–p00009, indexed and published as 1,000 new NCLT listings. It records ingestion only. It is not
> legal-answer or RAG acceptance.

- **Authorization:** standing approval for 5 autopilot batches (7–11) from Tamanesh Kauri (2026-10-26 21:07 IST). See
  `../law-autopilot/README.md`. The run signed in by itself from Colab Secrets.
- **Inputs:**
  - Ingestion scripts at `cf3e753`.
  - Autopilot core `f99814a4…6797`.
  - Driver `nter-law-autopilot.py` in two revisions:
    - `590419a` (`6869cfbf…b8f9`): plan, dry run and the first T1 submission;
    - `8b3133f` (`673f72d3…8ab6`): T1 resume through verification.
  - Plan `2cb73a31…7e4a` (private staging).
  - `cohort-b09-UNSIGNED.tsv` `93d37fa1…9bc6` (keys, chunk estimates and text hashes; no corpus text).
- **Selection:**
  - Screened 2023 p00001–p00009, excluding every earlier manifest.
  - Holds: **1,492 no case number** (many 2023 records lack a parsed case number); 15 near-duplicate text; 3 over the
    answer-read limits; 1 not an official order PDF URL.
  - Offline dry run: 1,000 ready, 0 held, 22,218 chunks, $1.1794 ceiling.
- **Run (2026-10-26/27 UTC):**

  | Tranche | Members | Docs | Reconcile | Chunks | Registered UTC (final: 0 uncertain, 0 held) | Embedding cost |
  | --- | --- | --- | --- | --- | --- | --- |
  | T1 | 2023 p00001–p00005 | 205 | 205 create, 0 mismatches | 3,630 | 23:03–00:04 | $0.0172 |
  | T2 | 2023 p00005–p00007 | 205 | 205 create, 0 mismatches | 4,412 | 00:11–00:19 | $0.0206 |
  | T3 | 2023 p00007 | 205 | 205 create, 0 mismatches | 5,028 | 00:26–00:34 | $0.0235 |
  | T4 | 2023 p00007 + p00008 | 205 | 205 create, 0 mismatches | 5,129 | 00:41–00:48 | $0.0239 |
  | T5 | 2023 p00008 + p00009 | 180 | 180 create, 0 mismatches | 4,019 | 00:55–01:01 | $0.0190 |

  - **T1 needed three steps, and nothing was ever written twice:**
    1. **First attempt.** The importer exited before writing anything, and the pre-write retry ran it again 90 seconds
       later. That run registered 122 documents. An uncertain status read then stopped it at 23:08.
    2. **First resume, refused.** At 23:14 the resume would not continue. 13 of the 122 had been registered seconds
       before the stop and were not yet published. Supplied-text NCLT documents are not readable through the API until
       they are published, so their text hashes could not be checked. Nothing was written.
    3. **Second resume, completed.** Driver `8b3133f` now waits for registered documents to become visible and
       re-checks them. The resume ran at 23:48, found all 122 visible and matching the plan's text hashes, and
       registered the remaining 83. T1 was complete at 00:04.
  - T2–T5 each submitted on the first attempt.
  - The last document was indexed at 02:18, and the autopilot verified the batch at 02:23.
- **Verified (read-only SQL, `verify.sql`):**
  - 1,000/1,000 indexed and published, with 22,218 chunks.
  - The cohort fingerprint over sorted `source_key|chunks|text_sha256` matches the plan (`1d482310…96fd`).
  - Vectors: 0 missing, all 1536-d. Stored text hash valid for all 1,000.
  - One job per document, all succeeded; 0 OCR pages.
  - Every listing URL equals its order URL.
  - Each document has one source membership and its own newly created listing.
- **Duplicate checks:**
  - The normalized same-case-and-date check over all 6,110 Law documents finds no group containing a batch-9 document.
  - **One overlapping pair needs the owner's review:** `9a4c2ee179c4082b` / `1b551478588dfa33` (Dharti Dredging and
    Infrastructure).
    - Both are dated 2023-07-20 and both are in batch 9.
    - Both relate to CP 329/7/HDB/2020.
    - 48 of the shorter order's 49 chunks (I.A. 385/2023, resolution plan approval) recur in the 174-chunk order.
    - The case strings differ, and the sizes differ by more than 3×, so neither hold compared them. Batch 7's Master
      Weaver pair had the same blind spot.
    - Nothing was deleted or unpublished.
  - One other pair shares 4 of 11 chunks: different companies, standard wording.
- **Cost:** 5,211,505 embedding tokens, **US$0.1042** against a $1.1794 conservative ceiling. No OCR or chat spend.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 8,569 | 9,569 |
  | Chunks | 271,848 | 294,066 |
  | Law documents | 5,110 | 6,110 |
  | `law_records` | 5,439 | 6,439 |
  | Memberships | 5,545 | 6,545 |
  | Links / publications | 5,110 | 6,110 |

  ANALYZE was run on the touched tables.
- **Not checked here:** natural-language website answers on these 1,000, and OCR or legal clearance.

Details are in `results.json`. Re-check with `verify.sql` (read-only; one aggregate row).
