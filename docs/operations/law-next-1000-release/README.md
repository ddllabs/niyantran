# Law next-1,000 release receipt (owner-authorized-20261024-law-next-1000)

> **Status: indexed and published.** 1,000 new IBBI_NCLT orders are indexed and published as 937 new and 63 existing
> NCLT listings. This is not legal-answer, RAG or autopilot acceptance: F247 synthesis is still open on main and the
> production Law answer path returns extractive passages. Not permission for any further batch.

- **Authorization:** approver Vighnesh Shukla (relayed in chat by Tamanesh Kauri, 2026-10-24 14:16 IST), after the
  website sample gate in `../law-next-1000-prep/README.md`. Bounds: exactly the 1,000 keys in
  `../law-next-1000-prep/cohort-1000-UNSIGNED.tsv`, ≤ 44,536 chunks, ≤ US$2.39 conservative estimate in four tranches,
  worker settings unchanged.
- **Inputs:** ingestion scripts at `cf3e753`; driver `nter-law-next1000-live.py` `7af1a886…7184` (commit `e3f9841`);
  staging `summary.json` `b48c00b3…b6c6`; tranche manifests T1 `ed83e437…f29a`, T2 `972e95b1…5506`, T3 `dd463637…7a9e`,
  T4 `5921dce5…5354` (kept with the private staging; no corpus text in Git).
- **Run (2026-10-24 UTC):** offline dry run for all four tranches 1,000 ready / 0 held / 44,536 chunks / $2.3636 ceiling →
  per tranche, live reconciliation with 0 mismatches, then submission with 0 uncertain and 0 held:

  | Tranche | Docs | Actions (reconcile) | Chunks | Submitted |
  | --- | --- | --- | --- | --- |
  | T1 (p00001–00002) | 289 | 289 create | 10,480 | 10:16 |
  | T2 (p00003–00004) | 312 | 312 create | 13,788 | 10:43 |
  | T3 (p00005, 00006, 00008) | 211 | 165 create + 46 link | 10,784 | 11:26 |
  | T4 (p00007) | 188 | 171 create + 17 link | 9,484 | 11:40 |

  First job 10:05, last indexed 12:13 (128 minutes).
- **Verified (read-only SQL, per document against the cohort table):** 1,000/1,000 indexed and published; 44,536 chunks
  with every per-document count and text hash matching the plan (fingerprint `c468005a…8c8a`); 0 missing vectors, all
  1536-d; stored text hash valid 1,000; one job each, all succeeded; 0 OCR pages; each listing URL equals its order URL;
  one source membership each; one document per listing; 937 listings created and 63 existing listings linked exactly
  as reviewed (fingerprint `9688c5e3…9798`). Stored-vector self-lookup top-1 993/997. In the other 4, the nearest chunk
  is an identical chunk text in another document of this batch (same-case boilerplate).
- **Cost:** 1,087 embedding calls, 10,249,159 tokens, **US$0.2050**. No OCR or chat spend from ingestion.
- **Deltas:** documents 3,569→4,569; chunks 105,668→150,204; Law documents 110→1,110; `law_records` 502→1,439;
  memberships 545→1,545; links/publications 110→1,110. ANALYZE run on the touched tables.
- **Not repeated here:** a live duplicate-safe rerun. The same importer proved it on the next-100, and repeating it
  would have needed another credential paste. Natural-language answers, website citations and OCR/legal clearance on
  these 1,000 were also not checked.
- **Incidents:**
  - Driver v1 stopped offline on a member-name bug before any network call.
  - One pasted token had only 20 minutes left; the driver refused it and cleared it.
  - The Colab browser connection dropped during T3, but the kernel completed T3 and T4.

Details: `results.json`. Re-check with `verify.sql` (read-only; one aggregate row). The audit ledger of every ingested
Law document is in the owner's Drive (Google Sheet "NTER Law ingestion ledger" plus CSV, `Data Handover/Legal/v1.1/ledger/`).
It is built by `../law-ledger/nter-law-ledger.py` from `../law-ledger/ledger-export.sql`.
