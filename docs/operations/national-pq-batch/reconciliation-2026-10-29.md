# Lok Sabha answers: read-only reconciliation against live NTER (2026-10-29)

> **Status: Historical (dated 2026-10-29).** Handoff step (b). Observed on NTER (`vfgcppstyzjarlzyqdac`) 2026-10-28
> 19:25–19:45 UTC (29 Oct 00:55–01:15 IST), after F266 (`main` at `498152f`). Read-only `SELECT`s only, in
> [`reconcile.sql`](reconcile.sql); the visibility check runs inside `begin read only … rollback` as `authenticated`.
> This replaces the cutoff-bound inventory of 2026-10-28 00:30 IST (project note `nter-national-pq-handoff-2026-10-28`).
> It proposes no action on these documents. Most of its queries ran through the database connector as plain read-only `SELECT`s;
> since 2026-10-29 rule 6 requires `begin transaction read only; … rollback;`, and `reconcile.sql` now wraps every query that way.

## Counts, kept separate

| Batch | Registered | Indexed (all vectors) | Linked (mapped) | Published / visible to signed-in readers | Website-accepted |
|---|---|---|---|---|---|
| b01 | 1,000 | 1,000 | 1,000 | 1,000 | 0. The owner searched five of its file names on 2026-10-27 and could not find the document (23:18 IST): the unlinked-record and feature-search defects since fixed (F257–F260, F266). Not re-checked since |
| b02 | 1,000 | 1,000 | 1,000 | 1,000 | 0 |
| b03 | 1,000 | 1,000 | 1,000 | 1,000 | 0 |
| b04 | 1,000 | 1,000 | 1,000 | 1,000 | 0 |
| b05 | 1,000 | 1,000 | 1,000 | 1,000 | 0 |
| b06 | 865 | 865 | 865 | 865 | 0 |
| **All** | **5,865** | **5,865** | **5,865** | **5,865** | **0 accepted** |

- **Indexed:** 59,503 chunks, all with 1536-d vectors; stored text hash valid on every document; one `succeeded` job per document; 0 pending, 0 failed; 0 OCR pages.
- **Linked:** 6,845 links in `record_document_links`, exactly one per listing row naming the document's answer file. Every link's `source_url` equals the document's `file_url`, and its `text_sha256` equals the document's `content_sha256`. 4,749 documents (5,638 links) under `owner-authorized-20261028-f257-mapping-repair`; 1,116 documents (1,207 links) under `F266-backfill-2026-10-28`. No other document in the section has a link.
- **Published / visible:** as `authenticated` under RLS: 5,865 documents, 59,503 chunks, 6,845 links visible. For every one of the 6,845 linked rows, the resolver's rule (`record_resolve_document_keys`, replicated set-based) gives `full`. 24 rows (4 per batch) put through the function itself: 24 `full`, each with a document. Admin-side computation; not a browser check.
- **Website-accepted:** none recorded at this observation. **Update 2026-10-29:** the developer recorded website acceptance as passed for batches 1–6, signed in, one answer each from batches 1, 2, 3, 5 and 6 (`../2026-10-29-f266-release.md`); see each receipt.

## Identity

- **Source keys:** 40-hex pack keys; unique.
- **URLs:** every one is complete, with `?source=pqals`. No URL or answer key is held by two documents in the section.
- **Answer key:** `metadata.document_key_suggested` = `pq:ls:<session>:<stem>` derived from the document's own URL, on all 5,865.
- **Listing tuples:** `(national, Parliamentary Question Database, row_key)`; `row_key` is the shipped file's position (F266 §4.4 open).

| Batch | Fingerprint `source_key\|chunks\|text_sha256` (equals plan) | Complete tuple hash (query 3) |
|---|---|---|
| b01 | `581081b2650fdc8eb2770cea29f11a53f2eba944ab5e9f46cfeb459cc7f132f4` | `36e74e04901f60bfa58376fca3f5300ced4159ada887388aebcec44913c37d56` |
| b02 | `92982efa58467ec08fd59e09e748b1f7e05ae33ed5209fae4661fee99ec99e8b` | `70e6d25bacff351065e24f8f4bea42f6e5278325e1bde61a8c04539f9e350e06` |
| b03 | `c0733440126c7f542e54ac200d0576f97644f5720315d6aa108fe409f3df70fc` | `ef885e2861d91426cbc91866df15d269d11637190c7f493b5959fec0749db20b` |
| b04 | `c40e540215aaddcea360f949a71ab75bdf7639073b2d694a0ca1404b44b136c6` | `dd1199bb1defb6e49ed50c0b4a146b3e540b2af66834c322e1cdc0c338c29d68` |
| b05 | `857799b5ad490cdf9c4dece1e0536b89043d245c76f98468cee55485567b01c5` | `f18e548e3e7cbc78410aeb0375d78f35c6b69722f3deba3affe4f0a630888b7d` |
| b06 (865) | `ba49d8567b459261a64d850ce623b795f7d49c061f873c384da31dab2dfc4059` (equals the plan's 865-key subset) | `004ec0b58725f431c2df9ac18920efcdfa0435e96e4b24adf20443279aff7886` |

The complete tuple is `id|source_key|file_url|content_sha256|chunks|vectors|answer_key|linked row_keys`. Query 2 exports it per document (5,865 rows), with the listing tuples and the link decision. It is not reproduced here. The Drive ledgers carry document IDs for b01–b04 only. The b05 and b06 ledgers still say `planned`; query 2 is authoritative.

## Costs

| Batch | Embedding tokens | Spend (US$) |
|---|---|---|
| b01 | 2,412,145 | 0.048243 |
| b02 | 2,261,571 | 0.045231 |
| b03 | 2,291,196 | 0.045824 |
| b04 | 1,988,987 | 0.039780 |
| b05 | 2,130,107 | 0.042602 |
| b06 | 1,773,006 | 0.035460 |
| **All** | **12,857,012** | **0.257140** |

The six index jobs re-run by the supervisor on 2026-10-28 (b05 T5 ×3, b06 T1 ×3) are included at their final cost. F266 estimates about US$0.0003 of repeated embedding, not separately visible in `ingest_jobs`.

## Holds and what remains

Listing: 8,000 rows, 6,840 distinct answer files.

- 5,865 are held by these documents.
- 82 are held by the 2026-09-21 pack imports, matched by pack path: no URL, no review, unlinked, held by the owner's decision. Not re-ingested.
- **893 answer files have a listing row and no document.** They break down by the pack screen's holds as:
  - **Never registered, eligible:** 135 (b06 T5 remainder) + 488 (never planned) = 623.
  - **Held by a screening rule:** the other 270, by subtraction (page split, missing date or number, no answer section, near-duplicate, limits). The per-reason counts overlap, so the validation cohort's screen recounts these directly against live state.

## Checkpoints

Drive `Data Handover/National/v1.1/staging/`: `pq-batch-01/` … `pq-batch-06/` (plan, status, tranches, reports, ledgers) and `pq-section-status.json`. Receipts: [`README.md`](README.md) (b01) and [`receipts/`](receipts/) (b02–b06). Production changes: [`production-changes.md`](production-changes.md).

## Platform observations for the supervisor

- No document in this section is unlinked except the 82 held. No queue is pending.
- `row_key` positional identity (F266 §4.4) still applies to every link above.
