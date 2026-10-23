# Law next-100 cohort: preparation report (unsigned)

> **Status: preparation only. Not an eligibility decision, not an authorization.** Nothing in this folder was
> registered, embedded, published, deployed or re-ingested. No decision manifest was finalized. Mapping proposals
> are an offline replica of `law_reconcile` and are **unverified** until an owner-finalized manifest is run through
> `corpus-text-import.mjs --reconcile`. Release state is unchanged: F248 is verified; F247 is partially resolved and
> F249 is open. This report does not claim RAG acceptance, legal-answer acceptance or autopilot readiness.

Prepared 2026-10-24 (IST) on branch `task/client-law-ingestion-claude-2026-10-23` at main `cf3e753`.

## Inputs pinned

| Item | Value |
| --- | --- |
| Archive | `NTER_legal_pack_v1.1_FULL_2026-10-18.zip`, 79,418,376,315 bytes; internal root `NTER_legal_pack_v1.2_FULL_2026-10-18` (filename says v1.1, root says v1.2; bytes verified, labels not assumed) |
| Member 1 | `documents/tribunals/IBBI_NCLT/2026__part-00006.jsonl.gz` sha256 `ac10758f54d75a93cf71f1be45f09ed20adefd7d32174bfe839e70b8652c841a` (194 records) |
| Member 2 | `documents/tribunals/IBBI_NCLT/2026__part-00007.jsonl.gz` sha256 `d7f8b2665044064ed57ebe023fa8ab4a7bee9468beb3860c9db7d4599d978a41` (210 records) |
| Policy files (inside ZIP, all verified, match `law-five-release` evidence) | sensitive `801f37cf…5318`, dedupe `26dc1a57…cc68`, not-in-pack `e9b899d6…6487` |
| Screener | `scripts/law-cohort-screen.py` schema 3 at `cf3e753`; complete subtree scan (367 IBBI_NCLT members, 0 unreadable, 0 conflicting repeats); `--no-scan-subtree` not used; both screens `finalizable: true` |
| Exclusions | `law-five-release/decisions.jsonl` + `law-cohort-2-release/decisions.jsonl` (the ten completed documents) |
| Chunk/cost estimator | the repository's own `prepareSuppliedText` + `EMBED_PRICE_USD_PER_TOKEN` (importer formula), run with an in-memory placeholder review `UNSIGNED-ESTIMATE-ONLY`; never written as a manifest |

Screen evidence hashes: part-00006 `screen.json` `5c42b48aacc61087d85ad2a61d48a7a5bcd7bb915d2ad3bb02fdbcecaf63cf18`, `candidates.jsonl`
`ed53e061e26b0c7e74f00b7914a2b5d4147edb4b3de649e0dba298e9f5b1e128`; part-00007 `screen.json`
`272dfe1c93660f039e13f1607ad77ca361d71eccbb572265ab0b4907b8b5cefc`, `candidates.jsonl`
`f6f70f2b9d558a940f69b5ad63b37aafe9863f9c67996690514986b397249e9e`. Private staging (corpus text stays there, not in Git):
Drive `Data Handover/Legal/v1.1/staging/staging-next100-20261023-2204/` — `summary.json` `780f35a6…5053`,
`db-matches.json` `9d9a5405…b025`, `proposals.json` `e30ae8c3…736c`.

## Counts (legal records, documents and chunks reported separately)

| Stage | Count |
| --- | --- |
| Records screened | 404 (194 + 210) |
| Held by screener | 39: 29 declared duplicate aliases (`keep=0`), 10 already decided (the completed ten) |
| Ready after screen (unique keys) | 365 (0 cross-member duplicates) |
| Already present in live DB by `source_key` | **0 of 365** |
| Live document with same order URL under another key | **0** |
| Held by offline identity replica | 7 (no case number): `…03275500e0336889`, `…c57e4dfa37029114`, `…1e87826e01582098`, `…be4302881f981412`, `…a144330cc55fffc6`, `…abe7aed163f676a9`, `…b932ff852cafa70a` |
| Eligible proposals | 358: 261 `create-listing`, 97 `link-existing` (exact official-URL match to a visible NCLT order listing with no attached document; all matches via URL, none via source membership; none ambiguous) |
| **Proposed cohort** | **100 immutable documents = 100 legal records: 66 new listings + 34 existing listings**, all from part-00006 lines 1–119 in file order |
| Reserve (not proposed) | 258 eligible, not selected |

Live read: Supabase SQL editor (owner session), read-only `SELECT`s, 2026-10-23 21:50 and 22:16 UTC. Baseline: 3,469
documents (3,466 indexed), 101,243 chunks, 10 Law documents (all published), 436 Law listings (150 NCLT orders, 286 IBBI
announcements), 445 source memberships, 10 links, 10 publications, no queued/running jobs.

## Proposed cohort resources (estimates, unverified until the finalized dry run)

| Measure | Value |
| --- | --- |
| Chunks | 4,425 (min 3, max 194 per document; 0 over the 256-chunk / 300,000-char answer-read limits; 0 over the 800-chunk adapter limit) |
| Largest document | 172,457 content chars (`…28d2333d469bc83d`, 93 pages) |
| Embedding input | 3,927,109 bytes |
| Importer conservative cost ceiling | **US$0.235627** (bytes × $0.00000002 × 3; a client admission estimate, not a provider cap). Pilot measured ≈218 tokens/chunk, implying ≈$0.02 actual — extrapolation only |
| Expected deltas if fully indexed and published | documents +100, chunks +4,425, `law_records` +66 (436→502), memberships +100, links +100, publications +100 |
| Throughput | Unmeasured at this scale; pilot/cohort-2 indexed 5 documents in ~1.5 min at worker concurrency 2. No concurrency or retry changes proposed |

Full table with exact keys, text hashes, case numbers, dates and proposed mappings: `cohort-proposal-UNSIGNED.tsv`
(sha256 `17aeb9eb63a29952b7d7b779fa62d81a5b6c24311086782c2808739391aa487b`; transcription fingerprint
`c1e8f633088b5482609b3ca6c24798c349e91fe572432cfa3fcc0e1972507007` matched against the staging `proposals.json`).

## Reviewer notes (not holds; for the owner's eligibility judgment)

- Lines 13–25 include eight near-identical short orders (`C.P. (IB) - 309/310/312/313/314/315/317/322/2023`, 9 pages, ≈14.5k chars,
  2026-07-01) plus `CP (IB) No.307/Chd/J&K/2023`. They have distinct case numbers, URLs and text hashes and the dedupe policy
  does not flag them; they look like batch orders. Keep or drop as one decision.
- Weak case-number strings that still pass identity: `616/2026`, `274/KB/2025`, `Others IAs in (IB)-1913(ND)2019`,
  `IA(IBC)(LIQ.)/1 (PB)2026 In CP (IB) – 294(PB` (truncated in source).
- Two documents each for `Chandigarh Overseas` (CP 248/2019) and `Vikram Structures` (CP 246/BB/2019): different IAs, different
  existing listings — correct per "company name is not an identity".
- `link-existing` rows were matched only by exact official order URL, then checked offline for type/forum/date/case number.
- Not checked here: OCR accuracy, legal clearance, natural-language retrieval, website citations, server fingerprints.

## Checkpoints

1. Main inspected and integrated (fast-forward to `cf3e753`); earlier staging/evidence preserved.
2. Live baseline read (21:50 UTC).
3. Schema-3 screens of part-00006 and part-00007 with complete subtree scan; existing-chunker estimates.
4. Live presence/listing reconciliation of all 365 ready keys (22:16 UTC).
5. Offline mapping proposals; 100-document cohort selected; table verified by fingerprint.

## Authorization requested (one decision for the whole cohort)

Proposed (unsigned) decision for the owner to confirm or edit: decision ID `owner-authorized-<YYYYMMDD>-law-next-100`,
approver Vighnesh Shukla, target `https://vfgcppstyzjarlzyqdac.supabase.co`, exactly the 100 keys in
`cohort-proposal-UNSIGNED.tsv` from part-00006 screen `5c42b48a…cf18`, at most 100 documents / 4,425 chunks /
US$0.24 conservative estimate, current worker concurrency and retries unchanged, metadata-only publication of the resulting
66 new and 34 existing listings, no other documents. After authorization: finalize with `--keys` (these 100 only), offline
dry run, `--reconcile` live; stop that scope if any chunk total, fingerprint, mapping or hold differs; then submit with
`--approval <manifest sha256> --max-chunks 4425 --max-estimated-cost-usd 0.24`, verify indexing and publication for all 100,
and run the citation/natural-language sample required before any 1,000-document proposal.
