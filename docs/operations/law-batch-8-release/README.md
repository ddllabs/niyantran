# Law batch-8 release receipt (owner-authorized-20261026-law-auto-b08)

> **Status: Historical (dated 2026-10-26).** This is the second autopilot batch: 1,000 new IBBI_NCLT orders (2024 pack
> members p00005–p00010 and 2023 p00001), indexed and published as 1,000 new NCLT listings. It records ingestion only.
> It is not legal-answer or RAG acceptance.

- **Authorization:** standing approval for 5 autopilot batches (7–11) from Tamanesh Kauri (2026-10-26 21:07 IST). See
  `../law-autopilot/README.md`. The run signed in by itself from Colab Secrets; no token was pasted.
- **Inputs:**
  - Ingestion scripts at `cf3e753`.
  - Autopilot core `f99814a4…6797`.
  - Driver `nter-law-autopilot.py` at `590419a` (`6869cfbf…b8f9`), fetched by pinned commit and sha256-checked.
  - Plan `3a0eee39…39a0` (private staging).
  - `cohort-b08-UNSIGNED.tsv` `124d7348…fc84` (keys, chunk estimates and text hashes; no corpus text).
- **Selection:**
  - Screened 2024 p00005–p00010 and 2023 p00001, excluding every earlier manifest.
  - Holds:
    - 311 no case number;
    - 54 near-duplicate text against the 4,110 ingested documents or earlier candidates;
    - 3 same case number and date;
    - 4 over the answer-read limits;
    - 2 not an official order PDF URL.
  - Offline dry run: 1,000 ready, 0 held, 29,822 chunks, $1.5846 ceiling.
- **Run (2026-10-26 UTC):** every tranche submitted on its first attempt. No retry or resume was needed.

  | Tranche | Members | Docs | Reconcile | Chunks | Registered UTC (0 uncertain, 0 held) | Embedding cost |
  | --- | --- | --- | --- | --- | --- | --- |
  | T1 | 2024 p00005 + p00006 | 205 | 205 create, 0 mismatches | 6,533 | 19:53–20:02 | $0.0304 |
  | T2 | 2024 p00006 + p00007 | 205 | 205 create, 0 mismatches | 5,603 | 20:09–20:17 | $0.0263 |
  | T3 | 2024 p00007 + p00008 | 205 | 205 create, 0 mismatches | 6,030 | 20:24–20:32 | $0.0281 |
  | T4 | 2024 p00008 + p00009 | 205 | 205 create, 0 mismatches | 6,272 | 20:39–20:47 | $0.0293 |
  | T5 | 2024 p00009 + p00010 + 2023 p00001 | 180 | 180 create, 0 mismatches | 5,384 | 20:53–21:00 | $0.0252 |

  The last document was indexed at 22:42, and the autopilot verified the batch at 22:43.
- **Verified (read-only SQL, `verify.sql`):**
  - 1,000/1,000 indexed and published, with 29,822 chunks.
  - The cohort fingerprint over sorted `source_key|chunks|text_sha256` matches the plan (`052152b6…266c`). That covers
    the exact keys, every per-document chunk count and every text hash.
  - Vectors: 0 missing, all 1536-d. Stored text hash valid for all 1,000.
  - One job per document, all succeeded; 0 OCR pages.
  - Every listing URL equals its order URL.
  - Each document has one source membership and its own newly created listing.
- **Duplicate checks:**
  - The normalized same-case-and-date check over all 5,110 Law documents finds no group containing a batch-8
    document. It still finds the 6 earlier next-1,000 pairs.
  - Shared chunks: only one pair shares at least 30% of the smaller document. That is Sohrab Spinning Mill / Noble
    Steels, with 3 of 9 chunks shared: different companies, standard liquidation wording.
  - **No pair needs the owner's review.**
- **Cost:** 6,964,706 embedding tokens, **US$0.1393** against a $1.5846 conservative ceiling. No OCR or chat spend from
  ingestion.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 7,569 | 8,569 |
  | Chunks | 242,026 | 271,848 |
  | Law documents | 4,110 | 5,110 |
  | `law_records` | 4,439 | 5,439 |
  | Memberships | 4,545 | 5,545 |
  | Links / publications | 4,110 | 5,110 |

  ANALYZE was run on the touched tables.
- **Not checked here:** natural-language website answers on these 1,000, and OCR or legal clearance.

Details are in `results.json`. Re-check with `verify.sql` (read-only; one aggregate row).
