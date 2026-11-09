# Bills admission: the listing's key and file names with dots (F307 follow-up)

> **Status: Living (2026-11-10).** Approved by the developer on 2026-11-10 ("go ahead with all your
> recommendations") after the Bills proof ([screening stage spec](2026-11-10-screening-stage.md#proof-result-2026-11-10-steps-1-to-3-no-database-writes)).
> Bills adapter: [spec](2026-11-07-bills-adapter.md), migration `20261107120000_bills_adapter.sql`.

## Current state

- `bill_admission_key(r)` (migration `20261107120000`, line 58) admits a bill only when `r.document_key` is
  `bill:<citation.bill_year>:<citation.bill_number>`, and its `file_url` matches the official rule and does not contain
  `..` anywhere (line 61).
- `prepareSuppliedText` (`supabase/functions/_shared/suppliedText.ts`, line 83) has the same two rules for a bill:
  `url.includes('..')` refuses, and `document_key` must equal `bill:${c.bill_year}:${c.bill_number}`.
- The Bills screen mirrors both (`scripts/bulk-runner/screens/bills.ts`: `official_source`, `links_agree`, `listing_row`,
  and the checks that read live documents by key), and the page check refuses a URL containing `..`
  (`scripts/bulk-runner/page_check.ts`, `officialUrl`).
- The listing's own key is `billDocumentKey` (`src/lib/deskRows.js`, line 93): the year closing the bill name
  (`,\s*(\d{4})\s*\.?\s*$`), else the year of `date_introduced`, then the number.

## Problem

Measured in the proof (read-only, 2026-11-10):

1. The pack builds the key from `citation.bill_year`; the listing builds it from the name's closing year, else the
   introduction year. Where they differ, the bill has no listing row under the pack's key. Of 742 v1.1 bills held
   `no_live_row`, the listing's formula applied to the record's citation (`bill_name`, else `introduced_on`) finds a row
   of the same House with the same normalised name (and, when the record gives `introduced_on`, a date within 3 days)
   for 667; 43 find none; 32 have no bill number.
2. sansad file names contain runs of dots (`591LS As Int....pdf`, 142 bills held for this alone). They are not
   parent-directory segments, but the substring rule refuses them.

## Outcome

### Key

A bill's key may be either of two, and nothing else:

- the citation key, `bill:<citation.bill_year>:<citation.bill_number>` (today's rule); or
- the listing key, `billDocumentKey` applied to the citation: the year closing `citation.bill_name`, else the year of
  `citation.introduced_on` when it is a valid `YYYY-MM-DD` date, then `citation.bill_number`.

The adapter still finds the listing rows by that key and the House, then by the whole normalised name and the 3-day
date window (`ingest_bill_rows`, unchanged). So the second key only changes which key is looked up; a row of another
bill still cannot match.

Ambiguity, in the database: when `document_key` is the listing key and differs from the citation key,
`bill_admission_key` returns null (admission refuses `bill_identity_incomplete`) if the listing has a row under the
citation key with the same House and the same normalised name. That bill is listed under both keys, and which one is the
record's is not for the record to say. The function reads `desk_rows` for this (index `desk_rows_document_key`, partial
on `document_key`), so it is `stable`, not `immutable`. The pack's links carry the pack's (citation) key, so the screen
does not require every link to carry the matched key. The year before which the name's whitespace is read is
JavaScript's `\s`, written out in SQL (Postgres' own `\s` lacks U+FEFF and has U+0085).

- SQL `bill_admission_key`: accept `r.document_key` equal to either key, with the number and year rules unchanged.
- `prepareSuppliedText`: the same rule.
- Screen:
  - `listing_row` reads the rows under both keys (one `deskRows` call).
  - It passes when exactly one of the two keys has rows matching House, name and date.
  - It holds `bill_key_ambiguous` when both do.
  - `project` sets `document_key` to the key that matched.
  - `links_agree` accepts a link `document_key` equal to either key.
  - Every check that reads live documents or other records by key (`already_live` by role, `role_collision`,
    `role_held_live`) uses the matched key.
  - A record whose key cannot be decided is held, never passed.

### File names

Replace "contains `..`" with the following, applied the same way in SQL `bill_admission_key`, `prepareSuppliedText`
(`billUrlSegmentsOk`), the screen's `official_source` and the page check's `officialUrl`:

- on the whole URL: no control character (U+0000 to U+001F, U+007F) and no backslash (a URL parser strips tab and line
  breaks, so `x/..\r/a.pdf` would otherwise read another path than the one stored);
- on the part before any `?` or `#`: no `%2f` or `%5c` (encoded separators, any case), and no path segment that is `.`
  or `..`, plain or percent-encoded (`%2e`, any case), with or without a path parameter (`..;x`, `%2e%2e%3b`).

A run of dots or spaces inside a file name is not a segment (`591LS As Int....pdf` is admitted).

## Acceptance evidence

- Each changed rule has a test that fails before the change and passes after it, shown failing first:
  - Deno, for `suppliedText.ts` and the screen or page check;
  - SQL, in the new fixture `supabase/tests/ingest_bills_admission_rules.sql`, which `run.sh` chains after the
    `ingest_bills_adapter` chain, so each of the two migrations keeps its own vacuity proof.
- Every existing SQL fixture and both Deno suites still pass.
- Tests cover:
  - a listing-key bill admitted and linked to the right row;
  - a listing-key bill whose name differs from that row refused `bill_identity_mismatch`;
  - a third key year refused `bill_identity_incomplete`;
  - `....` in a file name admitted;
  - `/../`, `/./`, `/%2e%2e/`, `/%2E./`, a backslash, control characters (`..\r`, `..\n`, `.\t.`), path parameters
    (`..;`, `%2e%2e%3b`) and encoded separators (`..%2f`, `..%2F..%2F`, `%2e%2e%5c`) refused;
  - a listing-key bill refused `bill_identity_incomplete` when the citation key has a row of the same House and name;
  - in the screen, `bill_key_ambiguous`.
- `npm run test:sql` passes, including vacuity for the new migration. Also `deno test` for `supabase/functions` and for
  `scripts/bulk-runner`, `deno lint`, `npm run lint` and `npm run build`.
- Supervisor proof after merge: re-screen the v1.1 Bills. At least 600 more bills screen than at `8f52b8c7`, and each
  screened record's `document_key` has a matching listing row.

## Scope

May change:
- a new migration `supabase/migrations/20261110120000_bills_admission_rules.sql`: `create or replace function
  public.bill_admission_key` only, keeping its revokes; a header with apply order and rollback;
- `supabase/functions/_shared/suppliedText.ts` and its test;
- `scripts/bulk-runner/screens/bills.ts`, `scripts/bulk-runner/page_check.ts` and their tests;
- `supabase/tests/` (the Bills fixture, or a new fixture and its line in `run.sh`);
- this spec; `docs/plans/open-work.md` (F307 line only).

Not in scope:
- `ingest_bill_rows`, the listing, `desk_rows`, any other adapter;
- `prepare.ts`, `plan.ts`, `run.ts`, `cli.ts`;
- the platform's per-document limits (F311);
- any NTER access, deploy or apply.

## Apply (supervisor, after merge)

1. Deploy `ingest-worker` and `admin-ingest` from the merged commit. The function is then looser than the database,
   which still refuses.
2. Pause cron job 4, dry-run the migration in a rolled-back transaction on NTER, apply it with its history row in
   the same transaction, then resume the worker.

Rollback: the exact SQL is in the migration's header (the old body as `create or replace`, its revoke, and the history
row's delete). A dry run replaces the file's trailing `commit;` with `rollback;`. Bills already
admitted under a listing key stay; they are correct under the listing's own rule.
