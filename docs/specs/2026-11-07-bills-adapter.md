# Bills adapter (F275)

> **Status: Living (2026-11-07).** Spec for the Bills part of F275, under the
> [bulk ingestion spec](2026-11-01-bulk-ingestion.md) step 6. Figures are read-only from NTER on 2026-11-07, or from the client's
> completion plan and inventory on the client branch. Built in
> `supabase/migrations/20261107120000_bills_adapter.sql`, not on NTER. The relaxed text check still needs the owner's agreement.

## Current state

- Admission accepts Law and Parliamentary Questions only. A Bills document in a batch is refused `no_adapter`.
- National v1.1 package 2 is 7,182 documents and 357,920 chunks: bills, 365 corrigenda and 3 unindexed bills. That is about 57%
  of v1.1's chunks.
- NTER holds 2,896 bill documents and 9,817 listing rows, with **no** `record_document_links` row between them.
- Live documents carry `document_key` as `bill:<year>:<number>`. One bill can have several documents: as introduced, as passed,
  synopsis, gazette notification.

## Problem

The question adapter joins a document to its listing rows by answer URL. That cannot work here: all 9,817 bill rows carry the
same `source_url`, a listing page. Every reader of bills joins on `desk_rows.document_key` instead, so admission has to as well,
or a linked bill would still read as unmapped.

| Measured on NTER | Count |
|---|---|
| Listing rows | 9,817 |
| Distinct stored keys | 9,415 |
| Keys held by more than one row | 398 |
| Rows whose name states a year other than the year of introduction | 744 |
| Rows with no year in the name | 3,372 |
| Live documents with a key | 2,764 |
| Live documents with no key | 132 |

Lok Sabha numbers are normally arabic and Rajya Sabha numbers roman, but a key has no house, so a collision is possible. Dates in
`id` and `date_introduced` differ by a day on the rows sampled, so a date is not an exact key.

## Outcome

A bill or corrigendum enters through the same batch path as a question answer. It is admitted only with verified links to its
listing rows, or refused with a named reason, and nothing else is written.

## Design

**Adapter.** `national_bills`, for `Bill Passage Probability Index`, in `ingest_admit_tier`, `ingest_admit_adapter` and `deskOk`.

**File URL.** `https://sansad.in/getFile/` under `BillsTexts/` or `BillsPDFFiles/`, as `corpus-batch-review.mjs` already requires.

**Identity fields required:** `document_key`, `bill_number`, `bill_year`, `bill_name`, `house`, `document_role`, as the live
bills carry them in `metadata` and `metadata.citation`. `document_key` must equal `bill:<bill_year>:<bill_number>`.

**Finding the listing rows.** `document_key` must equal a row's stored `desk_rows.document_key`, in the same house. The whole bill
name, with its closing year removed and only letters and digits kept, then picks among those rows. All rows of that one bill are
linked. When the record gives `introduced_on`, the row's date must be within 3 days of it, as it is for all 1,145 live bills that
have one, because sessions can reuse a name and a key. No row is refused `no_desk_row`, and rows with no match are refused
`bill_identity_mismatch`. A name of under 8
letters, or one that is not in Latin script, is refused `bill_identity_incomplete`. Title alone never links, and part of a
name never matches.

**Text identity (the owner's gate).** This depends on the role, because the measured text does not support one rule for all:

- As introduced and as passed: the bill's title or its number must appear in the opening text. A failure is held for review,
  with a named reason, by the runner. It is not refused in admission, since OCR is the likely cause of most misses.
- Synopsis, gazette notification and errata: exempt. They link by key and cannot establish a bill's identity.

`billTextIdentity` in `supabase/functions/_shared/billIdentity.ts` is that check. The runner calls it and records the result as
review check `bill_identity`. Adding `bill_identity` to a collection's `required_checks` makes admission enforce it, so the rule
can change with the owner's answer without a migration.

This narrows the owner's gate, which names every sansad bill, so it needs the owner's agreement.

**Links.** Written in the same transaction, as F266 does, with `decision_id` `admission:bill-key-v1` and the document's role.

**One of each.** Admission refuses, by name, a file URL another document holds, or a role of the bill in that house that another
document holds. Errata can repeat. Two unique indexes hold the same rule if concurrent runs race past those lookups: the race then
aborts that call, and a retry gets the named refusal. Live bills have no duplicate of either.

**Role.** One of the seven live roles.

**Corrigenda.** The adapter takes them, but relabelling is not enough. The runner must map each of the 365 to its bill and give it
that bill's identity, with role `errata`, which the app already labels. The 2026-10-23 reconciliation mapped 322, held 42 for
mapping and excluded 1, so those 43 stay out until reviewed.

**One way in.** The single-document path refuses Bills, so every bill comes through a sealed batch and its policy.

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
| Identifies one bill | 2,646 | 95.7% |
| Ambiguous | 0 | 0% |
| Refused: no row for the key | 106 | 3.8% |
| Refused: the key's row is in the other house | 1 | 0.04% |
| Refused: rows for the key, no name match | 11 | 0.4% |

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

| Check | Result |
|---|---|
| Fixture covers every refusal, multi-document bills, shared keys, and the year disagreement | Passes; fails without the migration |
| Every `ingest_register_batch` case on the replaced functions | Passes, by including that fixture |
| Bills through the real worker on the full-size copy: partition, date, links, indexing, search | 6 of 6 checks |
| Each of those breaks trips its named check | 5 of 5 |
| The whole worker suite on the replaced functions | 63 of 63 checks |
| Deliberate breaks of the migration | 27 run: 26 caught. Removing the per-bill lock is not, because one session cannot race itself; the unique indexes cover that case |
| Old against new, questions and Law, independent reviewer | 2,500 SQL trials and 8,000 payload comparisons, no difference, before the date and holder fixes, which touch only the Bills branch |
| Independent review | Two rounds. The wrong-link paths are closed; three small items after the second round are fixed and proved here, not re-reviewed |
| Applied before F290 | Refused, nothing created |
| A dry run of a bill | Reports `would_admit`, writes nothing |
| The rollback note, as written | Schema matches the F290 chain, apart from test scaffolding |

Still to do before a validation batch: a dry run on the real pack, reporting each refusal class by count. The per-page text
check, the patches, the 700-chunk hold, the corrigenda mapping and the text identity call stay in the runner (F285).

## Decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Do we need pack samples to build? | No. Build on the shape the live bills show. Run the dry run on the pack before the validation batch |
| 2 | Links for live bills | A separate backfill after the adapter, for the 2,646 that match. It needs no embedding, and each link is verified the same way |
| 3 | The 118 live bills that do not match, and the 132 with no key | Report them for review. Fix nothing here |
| 4 | Text identity | As in the design. Needs the owner's agreement |
| 5 | R7's 315 staged sources | Keep the frozen manifest, and admit them through this adapter |
| 6 | Over 700 chunks | Hold, as the client's plan says. A separate bounded load comes later |

## Known limits

- The closing year of a record's name is not checked against its key: 2 of 1,149 live citations differ. The match still needs the
  stored key, the house, the name and, where given, the date.
- Readers join bills by key alone, so a row sharing a key can resolve to another bill's document (F300). This already exists.
  Switching readers to links needs the live bills linked first.
- `billTextIdentity` can pass a recurring name from another year, such as a Finance Bill. It is a screen for the runner, and the
  match itself rests on key, house and name.

## Applying on NTER

Deploy `ingest-worker` and `admin-ingest` from this commit first, then apply the migration by `psql` with the worker paused, after
F290. Each needs separate approval.

## Exclusions

- `parliament_library_bills` from v1.4 and v1.5, and anything outside v1.1.
- Applying anything to NTER.
- The bulk runner.
- Regulatory and the other collections' adapters.
