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
| Live documents with a key | 2,764 |
| Live documents with no key | 132 |

Lok Sabha numbers are arabic and Rajya Sabha numbers roman, so the two houses do not collide. Dates in `id` and
`date_introduced` differ by a day on the rows sampled, so a date is not an exact key.

## Outcome

A bill or corrigendum enters through the same batch path as a question answer. It is admitted only with verified links to its
listing rows, or refused with a named reason, and nothing else is written.

## Design

**Adapter.** `national_bills`, for `Bill Passage Probability Index`, in `ingest_admit_tier`, `ingest_admit_adapter` and `deskOk`.

**File URL.** `https://sansad.in/getFile/` under `BillsTexts/` or `BillsPDFFiles/`, as `corpus-batch-review.mjs` already requires.

**Identity fields required:** `document_key`, `bill_number`, `bill_year`, `bill_name`, `house`, `document_role`, as the live
bills carry them in `metadata` and `metadata.citation`. `document_key` must equal `bill:<bill_year>:<bill_number>`.

**Finding the listing rows.** `bill_number` and `house` match exactly. Year narrows the candidates, by the year of introduction
or the year in the bill's name. The normalised bill name then picks the bill. All rows of that one bill are linked. No candidate
is refused `no_desk_row`, and no name match is refused `bill_identity_mismatch`. Title alone never links: it only chooses among
rows that already match on number, house and year.

**Text identity (the owner's gate).** This depends on the role, because the measured text does not support one rule for all:

- As introduced and as passed: the bill's title or its number must appear in the opening text. A failure is held for review,
  with a named reason, by the runner. It is not refused in admission, since OCR is the likely cause of most misses.
- Synopsis, gazette notification and errata: exempt. They link by key and cannot establish a bill's identity.

This narrows the owner's gate, which names every sansad bill, so it needs the owner's agreement.

**Links.** Written in the same transaction, as F266 does, with `decision_id` `admission:bill-key-v1`.

**Facets.** From the pack's citation: bill number, year, house, ministry, status, introduced on, per spec §4.5. Absent fields stay
null and are not guessed.

**Oversized.** Over 700 chunks is held with a named reason, under the collection's policy: 52 documents, the largest 3,362 chunks.
They are out of this batch path, whose limit is 800.

**Patches first.** v1.2 `bills_links_fixed` (100) and `bills_recovered` (55) replace their v1.1 records in the prepared set, so
the patched version loads and is never replaced afterwards.

## Measured on the live bills

The rule above, run read-only on NTER against the 2,764 live bills that carry a key, with no write:

| Result | Documents | Share |
|---|---|---|
| Identifies one bill | 2,675 | 96.8% |
| Still ambiguous | 0 | 0% |
| Refused: no row for number, house and year | 84 | 3.0% |
| Refused: candidates, but no name match | 5 | 0.2% |

Text identity, in the opening 6,000 characters:

| Role | Documents | Title or number | Both |
|---|---|---|---|
| As introduced | 1,791 | 84% | 43% |
| As passed, either or both houses | 232 | 99.6% | 93% |
| Synopsis | 451 | 72% | 7% |
| Gazette notification | 275 | 1% | 0% |
| Errata | 13 | 85% | 0% |

Requiring both, as the gate is written, would refuse most as-introduced bills. A gazette notification names an Act, not a bill, so
the check does not apply to it.

These are the bills that passed earlier reviews, so the remaining 6,814 may match less well. The dry run on the real pack is what
settles that.

## Acceptance evidence

- A fixture covers every refusal, multi-document bills, shared keys, and the year disagreement; it fails without the migration.
- Every `ingest_register_batch` case still passes.
- A dry run on the real pack reports each refusal class by count, and those counts are reviewed.
- The per-page text check stays in the runner (F285), which also applies the patches and the 700-chunk hold.
- A registration call stays inside F290's bound on the load copy.

## Decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Do we need pack samples to build? | No. Build on the shape the live bills show. Run the dry run on the pack before the validation batch |
| 2 | Links for live bills | A separate backfill after the adapter, for the 2,675 that match. It needs no embedding, and each link is verified the same way |
| 3 | The 89 live bills that do not match, and the 132 with no key | Report them for review. Fix nothing here |
| 4 | Text identity | As in the design. Needs the owner's agreement |
| 5 | R7's 315 staged sources | Keep the frozen manifest, and admit them through this adapter |
| 6 | Over 700 chunks | Hold, as the client's plan says. A separate bounded load comes later |

## Exclusions

- `parliament_library_bills` from v1.4 and v1.5, and anything outside v1.1.
- Applying anything to NTER.
- The bulk runner.
- Regulatory and the other collections' adapters.
