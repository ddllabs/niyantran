# Screening stage for pack records, Bills first (F307)

> **Status: Living (2026-11-10).** Approved by the developer on 2026-11-10 ("approved, go with all your
> recommendations"; then "start with Bills … go ahead"). Bulk ingestion: [F278](2026-11-01-bulk-ingestion.md); runner:
> [stages](2026-11-07-bulk-runner.md), [command line and acceptance](2026-11-08-runner-cli-and-acceptance.md),
> [pack reader](2026-11-10-pack-reader.md); Bills: [adapter](2026-11-07-bills-adapter.md).

## Current state

- The pack reader writes a records file and a receipt from one `documents/*.jsonl.gz` entry of a National pack. Its
  proof on v1.1 Parliamentary Questions held every record in the runner's `prepare`: pack records carry
  `content_sha256` and no `review`.
- `prepare.ts` and admission (`ingest_admit_shape`, `ingest_admit_document`, the Bills adapter) take a screened record:
  - top-level `text_sha256` = sha256 of `text` (and `content_sha256`, when present, equal to it);
  - `review.status = 'eligible'`, `review.text_sha256`, `review.source_key` binding the record;
  - `review.rules_sha256` (64 hex), `review.package_id`, `review.mapping_version`, `review.decision_id` (non-empty
    strings of at most 1,000 characters), optional `review.file_sha256` (64 hex);
  - `review.checks.identity`, `completeness`, `sensitivity`, `dedupe` and `rights` all `true`
    (`supabase/functions/_shared/suppliedText.ts`); the collection policy's `required_checks` too.
  - `checkedReview` keeps only these fields; anything else in `review` never reaches the database.
- What admission already re-checks for Bills (so the screen pre-checks it only to avoid refusals counting against the
  refusal cap): licence and `servable`, required checks, `n_chars`, page count, control codes, thin text, identity by
  key, house, whole name and date against the listing rows (`ingest_bill_rows`), `file_url_held`, `no_desk_row`,
  `existing`, `immutable_conflict`, exact duplicate text.
- `prepare.ts` already does, for Bills: the text identity check (`billTextIdentity`, when the collection asks for it;
  it sets `review.checks.bill_identity`), corrigenda mapping (`prepare.corrigenda`; unmapped ones are held), patches
  (`prepare.patches`), the chunk cap (`maxChunks`, 700 for Bills) and control codes.

## Decisions (developer, 2026-11-10)

1. **Bills is the first collection**, not the 157 held answers (they need better text, see 4).
2. The screen **may read NTER read-only** as the developer's login (libpq service `nter-accept`, every statement in a
   read-only transaction that is rolled back), for listing rows and live documents.
3. **`title_guard` is never put in a collection policy**: the runner cannot carry it.
4. **Text per page is a check, not a repair.** Fetch the official PDF, compare page count and text per page with the
   pack, and hold what disagrees with a named reason. Re-OCR is out of scope; held records stay held until the
   developer decides.
5. The review is written only from checks that ran and passed. No default, no hard-coded `true`.

## What the screen produces

```
deno run -A --config supabase/functions/deno.json scripts/bulk-runner/screen.ts \
  --collection <collection.json> --records <reader output .jsonl> --out <dir outside the repo> \
  [--patches <reader output .jsonl>] [--no-live] [--no-pages]
```

- Refuses unless `<records>.receipt.json` exists and its `output_sha256` equals the records file's sha256 (closes F309
  for the screen; the runner's own check stays F309). The same for `--patches`.
- Writes, exclusively and receipt first (as the pack reader does), into `--out`:
  - `screened.jsonl`: each passing record, its original fields unchanged, plus top-level `text_sha256` and `review`;
    the screened main records first, then the screened patches. A patch is the complete corrected record under its
    original's `source_key` and the original is held `superseded_by_patch_input`, so a patch is an ordinary record to the
    runner and nothing goes through `prepare.patches`;
  - `holds.jsonl`: one line per held record: `source_key`, `reasons` (names), `findings` (check, reason, detail),
    never record text;
  - `screen.receipt.json`: input receipts' sha256, the collection, `rules_sha256`, counts by reason, records in and
    out, whether live reads and the page check ran, the git commit and dirty flag, times. It also records how many
    screened records came from the patches input (`screened_from_patches`) and the sha256 of their sorted
    `source_key`s (`screened_from_patches_keys_sha256`), and, per check that keeps counters, its numeric fields and the
    source keys it set aside as scans (`checks_stats`), never text or URLs.
- `--no-live` and `--no-pages` exist for offline use. A run with either one writes **no review**: every record is held
  `screen_incomplete`. Only a full run can produce screened records.

### Review fields

| Field | Value |
|---|---|
| `status` | `'eligible'` |
| `text_sha256`, `source_key` | the record's |
| `rules_sha256` | sha256 over the bytes of the screen's rule files, in a fixed order (the collection screen module, `screen.ts`, `page_check.ts`) |
| `package_id` | `<pack>/<entry>#<manifest sha256>` from the reader's receipt |
| `mapping_version` | the screen's version, `bills-screen-v1` |
| `decision_id` | the collection policy's decision id, from the collection file (`screen.decisionId`; required) |
| `file_sha256` | the reader's `output_sha256` |
| `checks` | the five, each `true` only when every check that covers it ran on this record and found nothing |

## Interface (fixed; `scripts/bulk-runner/screen_types.ts`)

Every check covers one or more of the five review checks. A screen definition is invalid unless each of the five is
covered by at least one check. A check returns findings; an empty list is a pass. Checks that need the whole set
(duplicates) implement `all`; the rest implement `one`. Live reads go through `LiveReader` only, so tests use a fake.
The page check is a `Check` like any other, built by `page_check.ts`.

## The Bills screen (`scripts/bulk-runner/screens/bills.ts`)

| Check | Covers | Holds (reason) |
|---|---|---|
| Record shape: `schema` `nter.citation_pack/1.`, 40-hex `source_key`, `desk_tier` `national`, `desk_feature` and `desk_rows_feature` `Bill Passage Probability Index`, `doc_type` a bill or corrigendum | identity | `bad_shape` |
| Official source: `file_url` matches the Bills adapter's URL rule (`sansad.in/getFile/(BillsTexts|BillsPDFFiles)/`, no `..`); `file_name` is the URL's last path segment | identity | `not_official_url`, `file_name_mismatch` |
| Citation complete: `bill_number`, `bill_year` (4 digits), `house` (Lok Sabha or Rajya Sabha), `bill_name`, a known version role | identity | `citation_incomplete` |
| Links agree: at least one link; each link's tier and feature are the record's; its `document_key` is `bill:<year>:<number>`; its house, number and year equal the citation's | identity | `no_link`, `link_disagrees` |
| Listing row exists (live): a Bills desk row with that `document_key` and house | identity | `no_live_row` |
| Text binds: sha256(`text`) = `content_sha256`; `n_chars`; `page_split` `exact` or `none`; page spans contiguous, numbered from 1, joined by form feeds equal `text`; `page_count` | completeness | `text_hash_mismatch`, `n_chars_mismatch`, `page_split`, `page_spans` |
| Length: at least 200 characters, at most 600,000 | completeness | `too_short`, `too_long` |
| Text per page (`page_check.ts`) | completeness | its reasons, below |
| Servable and licence class not `BARRED_` and not personal data | sensitivity | `not_servable`, `licence_barred`, `personal_data` |
| Licence class admitted by the collection (`gazette_s52_1_q_i_unconfirmed` for Bills) | rights | `licence_not_admitted` |
| Already live (live): `source_key` or `file_url` held by a live document | dedupe | `already_live` |
| Same text twice in the set: the lowest `source_key` stays, the rest are held | dedupe | `duplicate_text` |

The adapter reads two fields at the top level that the pack keeps elsewhere (`bill_admission_key` in `20261107120000_bills_adapter.sql`): `document_key` and `document_role`. The screen's `project` step adds them to passing records only, from fields its checks verified: `document_key` from the record's agreeing links (`bill:<year>:<number>`), `document_role` from `citation.version` (one of the seven roles). It adds, never changes or removes. The listing-row check also pre-checks what `ingest_bill_rows` checks at admission (the whole name with its year removed, and the introduction date within 3 days when the record gives one), holding `listing_name_mismatch` or `listing_date_far`, so these show as screen holds instead of admission refusals that count against the refusal cap.

Corrigenda (`doc_type` corrigendum) are held `corrigendum_unmapped` until a mapping file exists (the 43 of 365 without
one; the 322 with one need that file, which is not yet located). The v1.2 `bills_links_fixed` records (100) are screened
as patches: each takes its original's place in `screened.jsonl` (the original is held), see "What the screen produces". The v1.2 `bills_recovered` records (55) are new records,
selected from their own entry and screened like any other (not patches: they replace no record). Text identity stays in `prepare.ts` (the collection sets `requireTextIdentity`).

## Text per page (`scripts/bulk-runner/page_check.ts`)

For each record with a `file_url`: fetch the official PDF (at most one request per second per host; obey robots.txt;
cache by URL hash outside the repository; retry like the pack reader), read its page count and the text layer of each
page (`pdfjs-dist`, already a dependency, through an `npm:` specifier). Then:

- page count differs from the pack's `page_count` → `page_count_mismatch`;
- the PDF has a text layer and a pack page holds less than half the PDF page's letters and digits → `thin_page`
  (detail: page numbers);
- the PDF cannot be fetched (after retries) → `pdf_unavailable`; not a PDF, or unreadable → `pdf_unreadable`;
- no text layer (a scan): only the page count is compared; counted, not held.

## Tasks

| # | Task | Owner | Files |
|---|---|---|---|
| S0 | This spec and `screen_types.ts` | supervisor | spec, `screen_types.ts`, `open-work.md` |
| S1 | Screen core: command, receipt checks, running checks, review building, outputs, the `nter-accept` read-only `LiveReader`; accept `manifest_delta.json` in the pack reader (v1.2 has no `manifest.json`) | task agent | `screen.ts`, `screen_test.ts`, `live.ts`, `live_test.ts`, `pack.ts` (manifest name only), `pack_test.ts` |
| S2 | Bills screen | task agent | `screens/bills.ts`, `screens/bills_test.ts` |
| S3 | Text per page | task agent | `page_check.ts`, `page_check_test.ts` |
| S4 | Review of S1-S3, then a whole-system review before the first real load | reviewers | none |
| S5 | Proof and first batch (below) | supervisor | none |

S1, S2 and S3 run at the same time in their own worktrees: their files do not overlap and they share only
`screen_types.ts`, fixed here. All tests are offline (fakes for Drive, NTER and the PDF host).

## Proof and first batch (S5)

1. Reader: v1.1 `bills.jsonl.gz`, v1.2 `bills_recovered.jsonl.gz`, v1.2 `bills_links_fixed.jsonl.gz`, with
   `--skip-keys` from the live Bills `source_key`s (read-only).
2. Screen with live reads and the page check; record counts by reason; spot-check five screened and five held records
   by hand against the PDF and the listing row.
3. `cli.ts plan` on the screened file: batches and holds, no database writes.
4. With the developer's go: the Bills collection policy on NTER (`ingest_policy_approve`: `required_checks`
   `['bill_identity']`, licence `gazette_s52_1_q_i_unconfirmed`, budget and chunk ceiling from the plan), then a
   100-document validation batch with automated acceptance, then batches of 1,000.

### Proof result (2026-11-10, steps 1 to 3; no database writes)

Screen at `1823b8cb` (records and links-fixed patches) and `e611749b` (recovered), live reads read-only on NTER
(2,896 Bills documents, 9,817 listing rows), page check on 5,515 official PDFs. Raw output stays outside the
repository.

| Input | Read | Screened | Held by the screen | In the plan's batch | Held by the plan |
|---|---|---|---|---|---|
| v1.1 `bills` (after 2,895 live keys skipped) | 6,814 | 5,502 | 1,312 | 5,085 (235,419 chunks, about US$1.18) | 417 |
| v1.2 `bills_links_fixed` (patches) | 100 | 0 | 100 | 0 | 0 |
| v1.2 `bills_recovered` | 55 | 25 | 30 | 22 (914 chunks) | 3 |

Largest hold groups, and what each needs:

- `no_live_row` (660 alone): the pack's key year is the title year where the listing's is the introduction year,
  or the reverse. 291 match a listing row of the same house by introduction year; 332 more have a row of the same house
  and number within 3 days under another year. Recovering them needs a key rule from the listing (a decision).
- `not_official_url` (142 alone): sansad file names hold `....` (`591LS As Int....pdf`). The live adapter refuses any
  URL containing `..` (migration `20261107120000`, line 61), so the screen mirrors it. Recovering them needs a
  segment-based rule in the adapter, the screen and the page check (an NTER change).
- `text_identity_failed` (400, in the plan): the owner's bill identity rule; 384 are 1950s to 1980s scans. A sample shows
  noisy text layers, corrigenda and other bills' texts filed under these bills on sansad.
- Links-fixed patches: 35 of the new URLs return HTTP 500 on sansad; 27 are already live; the rest link other bills.
- `too_long` (41) and `over_chunk_limit` (17): above the proof's 700-chunk ceiling (a policy decision).
- Also held: `page_split` not `exact` or `none` (128), `corrigendum_unmapped` (64), links to a second bill (58),
  a listing row of another bill under the same key (44), unavailable or unreadable PDFs (21).

Spot check by hand, PDF fetched fresh: five screened records (two Houses, 1 to 40 pages, a key shared by two listing
rows) match the listing row, the PDF's page count and its first page. Five held records (`listing_name_mismatch`,
`link_disagrees`, `thin_page`, `unverified_empty_pages`, `too_long`) are held for the reason given.

Change made during the proof (`e611749b`): a link's `bill_number` or `bill_year` that is null or absent is not compared,
because the link's `document_key` binds both and the adapter reads neither; all 55 recovered records were held for it.

## Open points

- Form feeds: `prepare.ts` may change a text's characters before storing it. S1 checks whether the stored text hash
  then differs from the pack's and whether acceptance's "text hash" check compares the right pair, and reports.
- F300 (bill readers join by key alone) can affect acceptance's link check on keys shared by several bills.

## Review round 1 (2026-11-10): decisions

An independent review accepted the stage with changes; a 20-record pilot on real v1.1 Bills (live reads and the page
check on) held all 20 and showed three more. All are fixed in one round, each test shown failing first:

1. **Same bill, house and role.** Records in the set sharing `document_key`, house and role (other than `errata`) are
   all held `bill_role_collision` (none is picked); a record whose key, house and role a live Bills document already
   holds is held `bill_role_held_live`; records in the set sharing a `file_url` are all held `file_url_collision`.
2. **Patches.** Every main record whose `source_key` is in the `--patches` input is held `superseded_by_patch_input`,
   whatever the patch's outcome; whole-set checks run over records and patches together. A screened patch is written
   into `screened.jsonl` as an ordinary record (supervisor decision, final integration): it is the complete corrected
   record under its original's key, so there is no `screened-patches.jsonl` and no `prepare.patches`.
3. **Unsplit text.** `page_split: 'none'` passes only if it meets what prepare and admission require
   (`page_count` equals the page spans); otherwise `page_count_unsplittable`.
4. **Partly scanned PDFs.** Pack pages with fewer than 20 letters and digits on PDF pages that have no text layer
   count as unverified; at least 2 such pages and at least 10% of the pages hold `unverified_empty_pages`.
5. **Scripts.** Letters, digits and combining marks (`\p{M}`) are counted, so Devanagari is not undercounted.
6. **What is fetched.** Only URLs matching the Bills URL rule; redirects only to https on the same host; the page check
   runs only on records still clean (`onlyIfClean`).
7. **Which database.** The receipt records the database, server and Bills document and listing-row counts; a zero
   count stops the run.
8. **A long run.** Per-record errors in the page check become findings for that record only; a failed robots.txt is
   retried later; pdfjs has a timeout; per-page counts are cached by PDF hash; progress is logged; outputs are written
   as they are produced, not built in memory.
9. **Links.** A link's `role` must equal `citation.version`, and its `row_key` must be among the listing rows matched by
   key, house and name; otherwise `link_disagrees`.
10. **Provenance.** `rules_sha256` hashes, in a fixed order, each rule file as path, length and sha256 (adding
    `live.ts`, `screen_types.ts`, `screens/index.ts`) and the canonical collection settings; the receipt records the
    collection file's sha256.
11. **Mirror admission, not stricter.** An `introduced_on` that is not a date is ignored, as the SQL ignores it; page
    spans without `text` are cut from the record's text; `file_name` is compared with the decoded URL segment; name
    normalisation follows Postgres `bill_norm`. A missing `servable` counts as servable (v1.1 has no such field; only an
    explicit `false` holds; a non-boolean holds).
12. **Duplicate text** compares the hash prepare will store (after its layout-break normalisation), within the set and
    against live documents (`duplicate_text_live`).
13. **Errors.** A `check_error` logs its message to stderr (never to holds); the screen takes `--psql <path>`.
