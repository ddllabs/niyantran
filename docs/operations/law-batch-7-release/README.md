# Law batch-7 release receipt (owner-authorized-20261026-law-auto-b07)

> **Status: Historical (dated 2026-10-26).** This is the first autopilot batch: 1,000 new IBBI_NCLT orders from 2024
> (pack members p00002–p00005), indexed and published as 1,000 new NCLT listings. It records ingestion only. It is not
> legal-answer or RAG acceptance.

- **Authorization:**
  - Standing approval for 5 autopilot batches (7–11). The approver is Tamanesh Kauri (2026-10-26 21:07 IST).
  - The approval and run rules are in `../law-autopilot/README.md`.
  - The run signed in by itself from Colab Secrets as the dedicated ingestion account. No token was pasted.
- **Inputs:**
  - Ingestion scripts at `cf3e753`.
  - Autopilot core `f99814a4…6797`.
  - Driver `nter-law-autopilot.py`, in three revisions. Each was fetched by pinned commit and sha256-checked in Colab:
    - `f529706` (`2cd40cd2…6797`): plan, dry run and the first T1 attempt;
    - `92c3e8f` (`b516ff47…02e0`): pre-write retry;
    - `590419a` (`6869cfbf…b8f9`): resume of an incomplete submission.
  - Plan `80ddcb6c…e5c9` (private staging).
  - `cohort-b07-UNSIGNED.tsv` `0e77daae…713a` (keys, chunk estimates and text hashes; no corpus text).
- **Selection:**
  - Screened members 2024 p00001–p00005, excluding every earlier manifest.
  - Holds: 58 no case number; 25 near-duplicate text against the 3,110 ingested documents or earlier candidates; 1 same
    case number and date; 3 not an official order PDF URL.
  - The first 1,000 eligible documents were taken, in screen order.
  - Offline dry run: 1,000 ready, 0 held, 26,217 chunks, $1.3934 ceiling.
- **Run (2026-10-26 UTC):**

  | Tranche | Members | Docs | Reconcile | Chunks | Registered UTC (final: 0 uncertain, 0 held) | Embedding cost |
  | --- | --- | --- | --- | --- | --- | --- |
  | T1 | 2024 p00002 + p00003 | 205 | 205 create, 0 mismatches | 4,827 | 17:01–17:52 | $0.0226 |
  | T2 | 2024 p00003 | 205 | 205 create, 0 mismatches | 5,105 | 17:59–18:07 | $0.0239 |
  | T3 | 2024 p00003 + p00004 | 205 | 205 create, 0 mismatches | 5,276 | 18:15–18:22 | $0.0245 |
  | T4 | 2024 p00004 + p00005 | 205 | 205 create, 0 mismatches | 5,752 | 18:30–18:37 | $0.0270 |
  | T5 | 2024 p00005 | 180 | 180 create, 0 mismatches | 5,257 | 18:44–18:51 | $0.0249 |

  - **T1 stopped twice before completing, and nothing was ever written twice:**
    1. **16:45: stopped before writing anything.** One `law-reconcile` mapping request took about 40 seconds on the
       server, past the importer's 30-second client timeout. The importer stopped before it opened its report, so
       nothing was written. The driver now retries exactly that case.
    2. **17:08: stopped part-way.** 185 documents were registered. Then the read-only publication-status check after
       document 185 returned HTTP 503. The importer stops at the first uncertain outcome, so the last 20 were not sent.
    3. **17:52: resumed.** The driver ran a fresh read-only reconcile of the same approved manifest. It accounted for
       every key: 185 registered with the plan's text hash, and 20 cleanly ready. It then submitted again and
       registered only those 20.
  - Every tranche published automatically once it was indexed. The last document was indexed at 19:37, and the
    autopilot verified the batch at 19:38.
- **Verified (read-only SQL, `verify.sql`):**
  - 1,000/1,000 indexed and published, with 26,217 chunks.
  - The cohort fingerprint over sorted `source_key|chunks|text_sha256` matches the plan (`b75fd57a…5832`). That covers
    the exact keys, every per-document chunk count and every text hash.
  - Vectors: 0 missing, all 1536-d. Stored text hash valid for all 1,000.
  - One job per document, all succeeded; 0 OCR pages.
  - Every listing URL equals its order URL.
  - Each document has one source membership and its own newly created listing.
- **Duplicate checks:**
  - The normalized same-case-and-date check over all 4,110 Law documents finds no group containing a batch-7
    document. It still finds the 6 earlier next-1,000 pairs.
  - The shared-chunk check looks at pairs with three or more identical chunk hashes. **One pair needs the owner's
    review:**
    - `9781d6d42a44617e` / `91d46e288216be50` (Master Weaver Ethnics India): both dated 2024-05-02 and both in
      batch 7. 13 of the shorter order's 14 chunks recur in the 83-chunk order.
    - The case strings differ (I.A.1356 of 2023 vs IA-IBC-1356-2024).
    - Their sizes differ by more than 3×, so the near-duplicate hold did not compare them.
    - Nothing was deleted or unpublished.
  - All other shared chunks are standard resolution-plan approval wording across different companies: at most 6 of
    60–126 chunks.
  - The stored-vector self-lookup used for batch 6 was not run. It timed out while batch 8 was registering, and the
    shared-chunk check covers the same identical-text signal.
- **Cost:** 6,143,578 embedding tokens, **US$0.1229** against a $1.3934 conservative ceiling. No OCR or chat spend from
  ingestion.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 6,569 | 7,569 |
  | Chunks | 215,809 | 242,026 |
  | Law documents | 3,110 | 4,110 |
  | `law_records` | 3,439 | 4,439 |
  | Memberships | 3,545 | 4,545 |
  | Links / publications | 3,110 | 4,110 |

  ANALYZE was run on the touched tables.
- **Not checked here:** natural-language website answers on these 1,000, and OCR or legal clearance.

Details are in `results.json`. Re-check with `verify.sql` (read-only; one aggregate row).
