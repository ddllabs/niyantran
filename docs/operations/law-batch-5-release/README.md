# Law batch-5 release receipt (owner-authorized-20261026-law-batch-5)

> **Status: Historical (dated 2026-10-26).** 1,000 new IBBI_NCLT orders from 2025 are indexed and published as 1,000 new
> NCLT listings. This is a record of ingestion only. It is not legal-answer, RAG or autopilot acceptance, and it does not
> authorize any further batch.

- **Authorization:** approver Vighnesh Shukla (relayed in chat by Tamanesh Kauri, 2026-10-26 03:47 IST). Bounds are in
  `../law-batch-5-prep/README.md`: exactly the 1,000 keys in `cohort-batch5-UNSIGNED.tsv`, ≤ 34,632 chunks, ≤ US$1.87
  conservative estimate in five tranches, worker settings unchanged.
- **Inputs:**
  - Ingestion scripts at `cf3e753`.
  - Driver `nter-law-batch5-live.py` `9e336b79…7d3d` (commit `0ecfb66`), fetched by pinned commit and sha256-checked in Colab.
  - Staging `summary.json` `ae80cada…77f1`.
  - Tranche manifests: T1 `aae686d4…d8c5`, T2 `295135ca…4e0a`, T3 `8e7a5159…66aa`, T4 `40ce77f8…1c4`, T5 `c76eeb95…56be`.
  - The manifests are kept with the private staging; no corpus text is in Git.
- **Open item from the next-1,000 batch, closed:** the duplicate-safe live rerun of next-1,000 T4 (manifest `5921dce5…5354`,
  06:38 UTC) returned exit 0. Results: 188 selected, 0 submitted, 188 already registered, 188 published, 0 uncertain,
  US$0 ceiling. Report `d0fc1714…a89c`.
- **Run (2026-10-26 UTC):** the offline dry run was re-verified after a runtime reset (1,000 ready, 0 held, 34,632 chunks,
  $1.8434 ceiling). Each tranche then ran a live read-only reconciliation, and submitted only when that reconciliation
  matched the reviewed plan exactly:

  | Tranche | Members | Docs | Reconcile | Chunks | Submitted (0 uncertain, 0 held) | Embedding cost |
  | --- | --- | --- | --- | --- | --- | --- |
  | T1 | 2025 p00001 | 186 | 186 create, 0 mismatches | 6,004 | 06:58–07:05 | $0.0282 |
  | T2 | p00002 | 198 | 198 create, 0 mismatches | 7,367 | 07:12–07:19 | $0.0344 |
  | T3 | p00003 + p00004 | 254 | 254 create, 0 mismatches | 8,321 | 07:28–07:37 | $0.0393 |
  | T4 | p00005 | 197 | 197 create, 0 mismatches | 6,513 | 08:00–08:07 | $0.0301 |
  | T5 | p00006 (first 165) | 165 | 165 create, 0 mismatches | 6,427 | 08:13–08:19 | $0.0300 |

  The first job was at 06:58 and the last document was indexed at 09:18. The submit summaries reported exit 2
  (publication pending), as expected. Each tranche published automatically once indexed.
- **Verified (read-only SQL, `verify.sql`):**
  - 1,000/1,000 documents are indexed and published, with 34,632 chunks.
  - The cohort fingerprint over sorted `source_key|chunks|text_sha256` equals the cohort table's (`9899e0e4…88c0`). So the
    exact keys, every per-document chunk count and every text hash match the plan.
  - Vectors: 0 missing, all 1536-d. The stored text hash is valid for all 1,000.
  - One job per document, all succeeded; 0 OCR pages.
  - Every listing URL equals its order URL. Each document has one source membership and its own listing.
  - 1,000 new listings were created, as reviewed. No existing listing was linked, because none was proposed.
- **Stored-vector self-lookup:** one mid-document chunk per document, top-1 through the production HNSW index.
  - 992/1,000 returned the same chunk, and 993/1,000 returned a chunk from the same document.
  - 7 of the other results are chunks with identical text in another batch-5 document. These are shared boilerplate
    paragraphs that appear in 2–9 chunks, at distance ≈ 0.
  - The remaining result is an approximate-index near miss inside the same document.
  - Batch 5 adds no duplicate-order pairs. A read-only check over all 2,110 Law documents found no batch-5 document
    sharing a normalized case number and order date with any other document. The new hold kept 10 records (5 pairs)
    out at screening. The same check finds 6 such pairs (12 documents), all from the next-1,000 batch:
    - The 4 pairs already reported.
    - 2 pairs whose case numbers differ only in spacing or dash: `CP (IB) – 182(ND)/2024` dated 2026-06-08, and
      `C.P.(IB)/220(AHM)2025` dated 2026-04-28.

    Nothing was deleted or unpublished; that remains an owner decision.
- **Cost:** 8,098,886 embedding tokens, **US$0.1620** against a $1.8434 conservative ceiling. No OCR or chat spend from ingestion.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 4,569 | 5,569 |
  | Chunks | 150,204 | 184,836 |
  | Law documents | 1,110 | 2,110 |
  | `law_records` | 1,439 | 2,439 |
  | Memberships | 1,545 | 2,545 |
  | Links / publications | 1,110 | 2,110 |

  ANALYZE was run on the touched tables.
- **Not checked here:** natural-language website answers on these 1,000 documents. The next-1,000 sample (five questions,
  all passed) is in `../law-batch-5-prep/README.md`. OCR and legal clearance were also not checked.
- **Incidents (no effect on data):**
  - The Colab runtime had died overnight. The first credential paste after that went into a stale prompt from the dead
    session, so nothing ran.
  - Three pastes reused an older nter.pro token. Each time the driver refused it before any network write (16.1, 12.8 and
    1.7 minutes left) and cleared it.
  - Two fresh 60-minute tokens covered the work: one for T1–T3, one for T4–T5.

Details are in `results.json`. Re-check with `verify.sql` (read-only; one aggregate row). The audit ledger of every
ingested Law document is in the owner's Drive: the Google Sheet "NTER Law ingestion ledger" plus a CSV in
`Data Handover/Legal/v1.1/ledger/`. It is built by `../law-ledger/nter-law-ledger.py`.
