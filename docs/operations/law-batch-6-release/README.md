# Law batch-6 release receipt (owner-authorized-20261026-law-batch-6)

> **Status: Historical (dated 2026-10-26).** 1,000 new IBBI_NCLT orders (482 from 2025 and 518 from 2024) are indexed
> and published as 1,000 new NCLT listings. This is a record of ingestion only. It is not legal-answer, RAG or autopilot
> acceptance, and it does not authorize any further batch.

- **Authorization:** approver Vighnesh Shukla (relayed in chat by Tamanesh Kauri, 2026-10-26 16:29 IST). Bounds are in
  `../law-batch-6-prep/README.md`: exactly the 1,000 keys in `cohort-batch6-UNSIGNED.tsv`, ≤ 30,973 chunks, ≤ US$1.67
  conservative estimate in five tranches, worker settings unchanged.
- **Inputs:**
  - Ingestion scripts at `cf3e753`.
  - Screen driver `nter-law-batch6-screen.py` `72eb70cc…836d` (commit `79e8a57`).
  - Live driver `nter-law-batch6-live.py` `780c65d6…5a26` (commit `6eb59d6`).
  - Both drivers were fetched by pinned commit and sha256-checked in Colab.
  - Staging `summary.json` `a9aac335…9de2`.
  - Tranche manifests: T1 `146739f4…34dd`, T2 `2f2b0262…ccf3`, T3 `59bc3f99…e498`, T4 `8cfbec56…37e2`, T5 `338c70ae…771a`.
  - The manifests are kept with the private staging; no corpus text is in Git.
- **Run (2026-10-26 UTC):**
  - The offline dry run passed for all five tranches: 1,000 ready, 0 held, 30,973 chunks, $1.6464 ceiling.
  - Each tranche then ran a live read-only reconciliation and submitted only on an exact match with the reviewed plan:

  | Tranche | Members | Docs | Reconcile | Chunks | Submitted UTC (0 uncertain, 0 held) | Embedding cost |
  | --- | --- | --- | --- | --- | --- | --- |
  | T1 | 2025 p00006 + p00007 | 205 | 205 create, 0 mismatches | 7,339 | 12:19–12:27 | $0.0340 |
  | T2 | 2025 p00007–p00009 | 205 | 205 create, 0 mismatches | 8,625 | 12:31–12:42 | $0.0400 |
  | T3 | 2025 p00009 + 2024 p00001 | 205 | 205 create, 0 mismatches | 6,248 | 13:00–13:12 | $0.0293 |
  | T4 | 2024 p00001 | 205 | 205 create, 0 mismatches | 4,836 | 13:16–13:27 | $0.0225 |
  | T5 | 2024 p00001 + p00002 | 180 | 180 create, 0 mismatches | 3,925 | 13:31–13:41 | $0.0184 |

  - The first job ran at 12:19 and the last document was indexed at 14:20.
  - Every tranche published automatically once it was indexed.
  - Two fresh tokens covered the run: T1–T2 and T3–T5. One earlier paste had too few minutes left; the driver stopped
    before T3, sent nothing, and cleared it.
- **Verified (read-only SQL, `verify.sql`):**
  - 1,000/1,000 indexed and published, with 30,973 chunks.
  - The cohort fingerprint over sorted `source_key|chunks|text_sha256` matches the plan (`fabf4f46…512d`). That covers
    the exact keys, every per-document chunk count and every text hash.
  - Vectors: 0 missing, all 1536-d. Stored text hash valid for all 1,000.
  - One job per document, all succeeded; 0 OCR pages.
  - Every listing URL equals its order URL.
  - Each document has one source membership and its own listing.
  - All 1,000 listings were newly created, as reviewed.
- **Stored-vector self-lookup:** 983/1,000 returned the same chunk. In the other 17, the nearest chunk is an identical
  chunk text (distance ≈ 0) in another document.
  - Most of these are sibling orders: standard-form orders for related petitions on the same day, such as C.P. (IB)
    437/443/444/445/448/452 of 2025.
  - **Four pairs look like duplicate or overlapping orders and need the owner's review.** None of them was caught by the
    case-number-and-date hold, because the case strings or dates differ. Nothing was deleted or unpublished.
    - `4c12a79b9c025227` / `2f2b9b57e25445e7` (Dr. Jain Video On Wheels): same CP and date, different IAs; 38 of 42
      chunks shared.
    - `80362814f70b232f` / `24d4c2e106815449` (Green India Building Systems): same CP; dates 2024-01-05 and 2024-01-24;
      the same PDF basename was re-uploaded with a date prefix.
    - `9bde5d1dbd2e4c4f` / `890aa169203045d1` (Mantena Laboratories): same IAs and date; 15 of 29 chunks shared.
    - `ee42ffaf4e2bb6bc` / `6d6ba64145e34fd9` (Dharti Cotton): same CP; dates 2025-11-10 and 2025-12-05; all 18 chunks
      shared.
  - The normalized same-case-and-date check over all 3,110 Law documents finds no batch-6 document in any group. It still
    finds the 6 earlier next-1,000 pairs.
- **Cost:** 7,213,777 embedding tokens, **US$0.1443** against a $1.6464 conservative ceiling. No OCR or chat spend from
  ingestion.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 5,569 | 6,569 |
  | Chunks | 184,836 | 215,809 |
  | Law documents | 2,110 | 3,110 |
  | `law_records` | 2,439 | 3,439 |
  | Memberships | 2,545 | 3,545 |
  | Links / publications | 2,110 | 3,110 |

  ANALYZE was run on the touched tables.
- **Not checked here:** natural-language website answers on these 1,000, and OCR or legal clearance.

Details are in `results.json`. Re-check with `verify.sql` (read-only; one aggregate row). The audit ledger of every
ingested Law document is in the owner's Drive: the Google Sheet "NTER Law ingestion ledger" plus a CSV in
`Data Handover/Legal/v1.1/ledger/`.
