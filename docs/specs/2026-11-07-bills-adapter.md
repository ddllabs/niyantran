# Bills adapter (F275)

> **Status: Living (draft, 2026-11-07).** Spec for the Bills part of F275, under the
> [bulk ingestion spec](2026-11-01-bulk-ingestion.md) step 6. Not approved. Figures are read-only from NTER on 2026-11-07, or from
> the client's completion plan and inventory on `task/client-corpus-claude-2026-10-29`. Nothing here is built yet.

## Current state

- Admission accepts Law and Parliamentary Questions only. A Bills document in a batch is refused `no_adapter`.
- National v1.1 package 2 is 7,182 documents and 357,920 chunks: bills, 365 corrigenda and 3 unindexed bills. That is about 57%
  of v1.1's chunks.
- NTER holds 2,896 bill documents and 9,817 listing rows, with **no** `record_document_links` row between them.
- Live documents carry `document_key` as `bill:<year>:<number>`. One bill can have several documents: as introduced, as passed,
  synopsis, gazette notification.

## Problem

The question adapter joins a document to its listing rows by answer URL. That cannot work here: all 9,817 bill rows carry the
same `source_url`, a listing page. Identity has to come from number, year and house, and the listing is not clean:

| Measured on NTER | Count |
|---|---|
| Listing rows | 9,817 |
| Distinct `bill:<year of introduction>:<number>` keys | 9,300 |
| Keys shared by more than one row | 507 (1,024 rows) |
| Rows whose name states a year other than the year of introduction | 744 |
| Rows with no year in the name | 3,372 |
| Live documents with a key and a matching row | 2,581 |
| Live documents with a key and no matching row | 183 |
| Live documents with no key | 132 |

Lok Sabha numbers are arabic and Rajya Sabha numbers roman, so the two houses do not collide. Dates in `id` and
`date_introduced` differ by a day on the rows sampled, so a date is not an exact key.

## Outcome

A bill or corrigendum enters through the same batch path as a question answer. It is admitted only with verified links to its
listing rows, or refused with a named reason, and nothing else is written.

## Design

**Adapter.** `national_bills`, for `Bill Passage Probability Index`, in `ingest_admit_tier`, `ingest_admit_adapter` and `deskOk`.

**File URL.** `https://sansad.in/getFile/` under `BillsTexts/` or `BillsPDFFiles/`, as `corpus-batch-review.mjs` already requires.

**Identity fields required:** `document_key`, `bill_number`, `bill_year`, `bill_name`, `house`, `document_role`.
`document_key` must equal `bill:<bill_year>:<bill_number>`.

**Role.** One of the pack's roles. Synopses and corrigenda may link to a bill but cannot establish its identity, which is the
rule the earlier review scripts already apply.

**Finding the listing rows.** `bill_number` and `house` must match exactly. Year then narrows the candidates, using either the
year of introduction or the year in the bill's name. Exactly the rows of one bill are linked. Candidates that disagree on the
normalised bill name are refused `ambiguous_listing_row`, and no candidate is refused `no_desk_row`. Title alone never links.

**Text identity (the owner's gate).** The bill number and title in the text must match the listing row and URL. A mismatch is
refused `bill_identity_mismatch` and listed for review.

**Links.** Written in the same transaction, as F266 does, with `decision_id` `admission:bill-key-v1`.

**Facets.** From the pack's citation: bill number, year, house, ministry, status, introduced on, per spec §4.5. Absent fields stay
null and are not guessed.

**Oversized.** Over 700 chunks is held with a named reason, under the collection's policy: 52 documents, the largest 3,362 chunks.
They are out of this batch path, whose limit is 800.

**Patches first.** v1.2 `bills_links_fixed` (100) and `bills_recovered` (55) replace their v1.1 records in the prepared set, so
the patched version loads and is never replaced afterwards.

## Acceptance evidence

- A fixture covers every refusal, multi-document bills, shared keys, and the year disagreement; it fails without the migration.
- Every `ingest_register_batch` case still passes.
- A dry run on the real pack reports each refusal class by count, and those counts are reviewed.
- The per-page text check stays in the runner (F285), which also applies the patches and the 700-chunk hold.
- A registration call stays inside F290's bound on the load copy.

## Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| 1 | Real pack fields | Ask for a field list and 20 sample records of `bills`, `bill_corrigenda` and both v1.2 patches. Nothing else can prove the match rates |
| 2 | Links for the 2,581 live bills | A separate read-then-write backfill later. It needs no embedding and should not delay this |
| 3 | The 183 live documents with no row | Report, do not fix here |
| 4 | Text identity check placement | A strict number check in admission, and the fuzzier title check in the runner, because OCR varies |
| 5 | R7's 315 staged sources | Keep their frozen manifest, and admit them through this adapter like the rest |

## Exclusions

- `parliament_library_bills` from v1.4 and v1.5, and anything outside v1.1.
- Applying anything to NTER.
- The bulk runner.
- Regulatory and the other collections' adapters.
