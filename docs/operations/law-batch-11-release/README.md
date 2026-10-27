# Law batch-11 release receipt (owner-authorized-20261026-law-auto-b11)

> **Status: Historical (dated 2026-10-27).** This is the fifth and last autopilot batch: the last **439** eligible
> text-native IBBI_NCLT orders in the pack (2022 p00006 back to 2017 p00003), indexed and published as 439 new NCLT
> listings. The pack is exhausted for the current eligibility rules. This receipt records ingestion only. It is not
> legal-answer or RAG acceptance.

- **Authorization:** standing approval for 5 autopilot batches (7–11) from Tamanesh Kauri (2026-10-26 21:07 IST). See
  `../law-autopilot/README.md`. After this batch the autopilot logged `finished` and stopped. Any further ingestion
  needs a new approval.
- **Inputs:**
  - Ingestion scripts at `cf3e753`.
  - Driver `nter-law-autopilot.py` at `ea40c44` (`282068c2…97a2`).
  - Core `19299c52…fe63`, which includes the new same-date containment hold.
  - Plan `17560dfc…6a0b` (private staging).
  - `cohort-b11-UNSIGNED.tsv` `762bc658…6387` (keys, chunk estimates and text hashes; no corpus text).
- **Selection:**
  - Screened 51 members, from 2022 p00006 back to 2017 p00003. That is every remaining member; the next cursor is the
    end of the pack.
  - Holds:
    - **3,428 no case number** (most pre-2023 records have no parsed case number);
    - 19 not an official order PDF URL;
    - 7 over the answer-read limits;
    - 4 near-duplicate text;
    - 2 same case number and date;
    - 0 contained in a same-date order.
  - Selected by year: 2022 131, 2021 104, 2020 122, 2019 67, 2018 12, 2017 3.
  - Offline dry run: 439 ready, 0 held, 9,276 chunks, $0.4940 ceiling.
- **Run (2026-10-27 UTC):**

  | Tranche | Members | Docs | Reconcile | Chunks | Registered UTC (0 uncertain, 0 held) | Embedding cost |
  | --- | --- | --- | --- | --- | --- | --- |
  | T1 | 2022 p00006 → 2021 p00008 (17) | 194 | 194 create, 0 mismatches | 3,650 | 07:07–07:14 | $0.0171 |
  | T2 | 2021 p00009 → 2017 p00003 (31) | 245 | 245 create, 0 mismatches | 5,626 | 07:23–07:32 | $0.0260 |

  - T1's first read-only reconcile exited before writing anything: one mapping request returned HTTP 503 at 06:56.
    The pre-write retry ran it again after 90 seconds and it passed.
  - The last document was indexed at 08:23, and the autopilot verified the batch at 08:29.
- **Verified (read-only SQL, `verify.sql`):**
  - 439/439 indexed and published, with 9,276 chunks.
  - The cohort fingerprint over sorted `source_key|chunks|text_sha256` matches the plan (`6d68007e…44f5`).
  - Vectors: 0 missing, all 1536-d. Stored text hash valid for all 439.
  - One job per document, all succeeded; 0 OCR pages.
  - Every listing URL equals its order URL.
  - Each document has one source membership and its own newly created listing.
- **Duplicate checks:**
  - No same-case-and-date group contains a batch-11 document.
  - **No pair needs the owner's review.** The only shared-chunk pair is two Bank of Baroda petitions against different
    respondents, sharing 2 of 4 chunks of standard wording.
  - Metadata note: `69d80dd946b6133a` is CP (IB)-714(MB)/2022 but carries order date 2021-12-16 in the pack citation.
    Its sibling is dated 2022-12-16, so this is likely a source date error. It was left as supplied.
- **Cost:** 2,158,040 embedding tokens, **US$0.0432** against a $0.4940 conservative ceiling.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 10,569 | 11,008 |
  | Chunks | 316,713 | 325,989 |
  | Law documents | 7,110 | 7,549 |
  | `law_records` | 7,439 | 7,878 |
  | Memberships | 7,545 | 7,984 |
  | Links / publications | 7,110 | 7,549 |

  ANALYZE was run on the touched tables.
- **Autopilot totals (batches 7–11):** 4,439 documents, 25,776,835 embedding tokens, **US$0.5155**. Law documents went
  from 3,110 to 7,549.

Details are in `results.json`. Re-check with `verify.sql` (read-only; one aggregate row).
