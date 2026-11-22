# A route for Bill corrigenda (F372)

> **Status: Living (2026-11-21).** Specifies how the 365 Bill corrigenda of National v1.1 (and the 11 corrected ones of
> v1.2) are admitted. Plan: [v1.1 to v1.3 loads and close-out](../plans/2026-11-19-v1.1-to-v1.3-loads-and-closeout.md),
> decision D2 and task C4. Nothing here is applied to NTER, and nothing is loaded: the migration awaits the developer's
> specific yes after a rolled-back dry run, and the load awaits the decisions below.

## Current state (read from code, and from the pack on Drive 2026-11-21; counts only, no text)

**The code holds every corrigendum, for three reasons that are each a different gap.**

- *The type name.* The Bills screen's `BILL_DOC_TYPES` is `bill` and `corrigendum` and says it was "assumed from the spec"
  (`scripts/bulk-runner/screens/bills.ts`, top). The pack's name is `bill_corrigendum` (365 of 365), so `record_shape`
  holds every one as `bad_shape`, as the v1.2 screen did for its 11.
- *The mapping.* The screen's `corrigendum` check holds a record whose `doc_type` is `corrigendum` or whose
  `citation.version` is `errata` as `corrigendum_unmapped`, "until a mapping file exists". `prepare.ts` does the same
  for a record with `document_role` `errata` and no entry in `PrepareOptions.corrigenda`. No mapping file was ever
  located (spec: [bills adapter](2026-11-07-bills-adapter.md), "Corrigenda").
- *The file link.* The Bills adapter admits a bill only with an official `sansad.in/getFile/BillsTexts|BillsPDFFiles`
  link. It is required in three places that agree: `prepareSuppliedText` (`supabase/functions/_shared/suppliedText.ts`,
  the `bill` branch), `public.bill_admission_key` (`20261110120000_bills_admission_rules.sql`), and the link row
  `ingest_admit_document` writes, whose `record_document_links.source_url` is `NOT NULL` and is filled from the
  document's `file_url` (`20261027185747_record_document_associations.sql`; `20261107120000_bills_adapter.sql`).
  The existing fixture shows the refusal: a bill with role `corrigendum` is `bill_identity_incomplete`
  (`supabase/tests/ingest_bills_adapter.sql`).

**What the pack's corrigendum records carry** (`documents/bill_corrigenda.jsonl.gz`, 365 records, read with `pack.ts
select` into `~/niyantran-eval-cache/f372-corrigenda-2026-11-21/`):

| Field | Records with it | Note |
|---|---|---|
| `source_key` (40 hex), unique; `content_sha256` equals the text's hash, `n_chars` equals its length | 365 | no control codes |
| `doc_type` `bill_corrigendum`; desk and rows desk `Bill Passage Probability Index`; licence class `gazette_s52_1_q_i_unconfirmed` | 365 | the Bills class |
| `file_url` | **0** | null in all; `file_name` is a `.doc` in all, `source_host` `sansad.in`, `source_path` a folder path |
| `citation` | 365 | holds `kind` and `source` and **nothing else**: no bill number, year, house, name or version |
| bill number, house, year, name in the **record's own `links`** | 356 | 353 with one link, 3 with two; 359 links in all |
| `links` empty | 9 | no reliable tie |
| `title` | 365 | names a bill in 352 and carries a year in 362; never equals the bill's name (0 of 330 checked); a title is not an identity |
| `pages`, `page_count` | 0 | `pages` is `[]` and `page_count` null in all, `page_split` `none`: text comes from LibreOffice `.doc` conversion, no PDF |
| text 200 characters or more | 338 | 27 are shorter; 91 are under 300; the longest is 486,379; 362 of the 365 are 11,034 or shorter, so the screen's ceiling is 20,000 and the three whole-bill-sized ones are held |

What each link carries: `bill_number`, `bill_year`, `bill_name`, `house`, `document_key` (`bill:<year>:<number>`, well
formed in 359 of 359), `role` (`corrigendum` in all, where the adapter's word is `errata`), `status`, `tier`, `feature`.
`row_key` is null in all 359, as it is in the real Bills links: admission finds the rows itself. Houses: Lok Sabha 354,
Rajya Sabha 5. Numbers: arabic 354, roman 5. The link's year equals the year closing the bill's name in 326 and differs in
33, where the listing's own key may differ from the citation's (the adapter allows either).

Of the 356 records with links, 355 name one bill and **one names two** (the second is a different bill: held). Of the 355,
330 have 200 characters or more and 25 do not. So: **330 can be tied to one bill and are long enough; 35 cannot or are
not** (25 short, 9 with no link of which 1 is also short, 1 naming two bills which is also short; counted as 25 + 8 + 1 + 1).

**The v1.2 delta** (`documents/bills_links_fixed.jsonl.gz`, 100 records) holds 11 corrigenda that are corrected versions
of v1.1 records (same `source_key`, same text, different links, no file link, `citation` of kind and source only); 10
name one bill and one names two; one is short. They are patches (`--patches`) in the runner's sense. Nothing in v1.1 to
v1.3 is a corrigendum with a file link.

## Problem

None of the 365 can be admitted: the type name is unknown, the bill is not in the citation, and the adapter and the link
row both need a file link the pack does not give. A mapping from an owner is **not** needed for 330 of them, because the
pack's links already say which bill each corrects; the screen can hold that claim to the listing like any bill's.

## Expected outcome

The 330 tied, long-enough corrigenda are screened, registered as one sealed batch, admitted to the Bills desk as role
`errata` with their bill's `document_key`, chunked into the Bills partition, found by search in the Bills desk, and linked
to each listing row of their bill (every row of a bill listed twice). The 35 that cannot be tied or are too short are
held by named reason and listed. Bills, Parliamentary Questions and every search-only desk behave exactly as today.

## Design (built, not applied)

1. **A screen of its own**, `national-bill-corrigenda`
   (`scripts/bulk-runner/screens/bill_corrigenda.ts`, registered in `screens/index.ts`). Bills and corrigenda are two
   collections because their policies differ (below) and their records differ in shape; neither changes the other.
   Its checks, in order:

   | Check | Holds | Reason |
   |---|---|---|
   | `corrigendum_shape` | wrong schema, key, desk, `doc_type` other than `bill_corrigendum`, **a file link present** (another route) | `bad_shape` |
   | `corrigendum_identity` | links empty, or a link that names no bill; links that name two bills | `corrigendum_unmapped`, `corrigendum_ambiguous` |
   | `citation_complete`, `links_agree`, `listing_row` (live) | the Bills screen's own checks, run on a view of the record whose citation is the one the links give and whose link role `corrigendum` reads as `errata`: a well-formed number, year, house and name; links that agree with it (tier, feature, role, key, house, number, year); a listing row of that key, house and whole name (the pack gives no date, so none is compared) | `citation_incomplete`, `link_disagrees`, `no_live_row`, `listing_name_mismatch` |
   | `text_binds` | hash and count bind the text; page spans are not required (an unpaged record is asked with a count of 0, as the search-only desks do) | `text_hash_mismatch`, `n_chars_mismatch`, `page_*` |
   | `length` | under 200 (as for a bill) or over 20,000 characters (the longest real corrigendum is 11,034) | `too_short`, `too_long` |
   | `servable_licence`, `licence_admitted` | barred, personal data, not servable; a class the policy does not admit | as for a bill |
   | `already_live` (live), `duplicate_text`, `duplicate_text_live` | the source key or the text is already held | as for a bill |

   Left out on purpose: the official-file rule and the file-URL lookups (no file link), the page check (no official file
   to compare with: completeness rests on the hash binding and the length rule), the role-held and role-collision
   checks (errata repeat, as the adapter says). The screen's `project` adds `document_key` (the key the listing matched)
   and `document_role` `errata`, and changes nothing. `bills.ts` only gains `export` on ten of its own helpers.
2. **The mapping comes from the record's own links, when the collection file says so.** `prepare.ts` gains
   `billIdentityFromLinks` and the option `prepare.corrigendaFromLinks` (off unless the collection file sets it,
   validated by `checkCollection`). A corrigendum with no entry in `prepare.corrigenda` takes number, year, name and house
   from its links when they all name one bill, as the existing mapping path writes them into the citation (it drops the
   pack's `introduced_on`, which belongs to nothing here). An explicit `corrigenda` entry still wins. The key conflict
   check now accepts the listing's own key (the year closing the name) as well as the citation's, as the adapter does.
3. **The adapter admits a corrigendum with no file link, and only that.** One migration,
   `supabase/migrations/20261125090000_bill_corrigenda_route.sql` (**not applied**):
   - `public.bill_admission_key`: the file clause is "an official `sansad.in` Bills file, as before, **or** `file_url` is
     null on a record whose `document_role` is `errata` and whose `doc_type` is `bill_corrigendum`". Every other clause
     is the body of 20261110120000, unchanged; a link that is given is held to the official rule whatever the role.
     `suppliedText.ts` mirrors it (`prepareSuppliedText`).
   - `record_document_links.source_url` may be null, and only on an `errata` link (a check constraint says so).
     `ingest_admit_document` is **not** replaced: it already finds the file by `file_url` (a null matches nothing), has no
     role held for errata, and writes the link with the document's `file_url`.
   - Guards: the function's `md5(prosrc)` is the 20261110120000 body; the applying role owns it; the constraint is not
     there yet. A self-check ends the file. Privileges, volatility, `security definer` and search path are restated as
     they were.
4. **A policy per collection.** `national-bill-corrigenda` is approved with `ingest_policy_approve`, adapter
   `national_bills`, desk Bills, licence class `gazette_s52_1_q_i_unconfirmed`, `require_page_count` **false** (a
   corrigendum has no pages; a policy that requires a page count refuses it `no_page_count`, shown in the fixture) and
   `required_checks` `bill_identity` (the runner sets it; errata are exempt from the title-or-number rule).
5. **What the licence class is.** The plan says the corrigenda are "cite-only" as Industry was. No licence class of that
   name exists in the code (a search of the repository finds the phrase only in the plan). The corrigenda carry the
   Bills class, and the citation names the source in its `source` and `citation_text` fields. A corrigendum has no file
   link to open: whether the Bills screen's citation shows that gracefully is **not verified**.

## Measured on NTER, read-only, 2026-11-21 (the real pack file through the real screen; no write)

`screen.ts --screen national-bill-corrigenda`, live reads only (a read-only transaction rolled back), no page check:

| Result | Records |
|---|---|
| Screened (all five review checks, a listing row found by key, house and whole name) | **330** |
| Held `too_short` as the primary reason | 25 |
| Held `corrigendum_unmapped` (no links) | 9 |
| Held `corrigendum_ambiguous` (links name two bills) | 1 |
| Reasons across the held: `too_short` 27 in all | |

`cli.ts plan` on the 330 screened: one batch, **2,079 chunks, about US$0.01**. With the 11 v1.2 patches
(`--patches`, the 11 selected from the delta with `--skip-keys` of its 89 bills): 328 screened (9 of the 11 patched
records pass and take their originals' places; 2 do not). Raw screen output stays in `~/niyantran-eval-cache/`.

Listing keys: the 330 screened keys carry 365 listing rows (some bills are listed twice; every row is linked). **34 of the
330 keys are shared**: another listing row on that key names a different bill. The Bills resolver (F314,
`20261110180000_record_resolver_shared_bill_keys.sql`) then shows a document on a row only when the document's title,
normalised, equals the row's bill name, and a corrigendum's title never does (0 of 330). So on read of the resolver, **296
corrigenda would show on their bill's row and 34 would be stored, linked and searchable but not shown there** until that
rule is widened. That is a follow-up (below), not a blocker. Not executed: the resolver ran on no corrigendum.

## Decisions

| # | Whose | Decision | Recommendation |
|---|---|---|---|
| 1 | Developer | Admit Bill corrigenda with no file link (the migration above: a null `file_url` on errata of the pack's type, a nullable link `source_url` on errata) | **Yes.** It is the smallest change that lets the pack's own claim of the bill be used; the alternative, a search-only Bills route, would drop the row links and the Bills resolver, and Bills has no search-only route. |
| 2 | Developer | Apply it: deploy `ingest-worker` and `admin-ingest` from the commit first, pause the worker, rolled-back dry run, apply, history row | After 1, in that order. |
| 3 | Owner | Load them under the Bills licence class `gazette_s52_1_q_i_unconfirmed` | Yes, as for Bills; the class still reads "unconfirmed". |
| 4 | Owner | The 27 corrigenda under 200 characters | **Hold** (plan D4), listed by key in the record. |
| 5 | Owner | The 10 with no single bill (9 with no link, 1 naming two) | **Hold.** If the owner has a mapping (`source_key` to bill number, year, house, name) it goes in `prepare.corrigenda` and they load; the pack's titles name a bill in nearly every case, but a title is a guess and no rule here reads one. |
| 6 | Owner | The 11 v1.2 corrected links | **Apply them as patches**, as for Bills: the corrected version takes the original's place. |
| 7 | Developer | The 34 corrigenda on shared bill keys | **Load them.** They are found by search; the row shows them once the resolver rule is widened (follow-up, new tracker item). |
| 8 | Owner/developer | Completeness basis: no page check, because the source is a converted `.doc` with no official PDF | Accept: hash binding, length and the listing match are the evidence. |

## Acceptance evidence

1. **Built and run (this change).** `deno test -A --config supabase/functions/deno.json scripts/bulk-runner` and
   `... supabase/functions`, each new test failing before its code (record in the report); `npm run lint`;
   `npm run test:sql` with the fixture `bill_corrigenda_route`, which fails without the migration (`run.sh` proves it) and
   was also shown to fail when the migration's `doc_type` condition was removed.
2. **Before the load.** The screen over the whole v1.1 entry on the developer's machine: the counts above, reproduced,
   held keys listed, no text printed. A rolled-back dry run of the migration on NTER with `md5(prosrc)` of
   `bill_admission_key` compared before and after (the guard already checks the 20261110120000 body).
3. **The load.** One rehearsal batch of at most 100, acceptance 50 of 50 or all (`requireLinks`: each sampled document has
   its row link); then the rest (one batch, 2,079 chunks). The Bills search check unchanged; one search that returns a
   corrigendum; a corrigendum on a row of an unshared key shows on that row.
4. **After.** `analyze public.document_chunks; analyze public.desk_rows; analyze public.documents;` (AGENTS.md); the count
   of Bills documents with `file_url` null and `doc_type` `bill_corrigendum` equals the batch's admitted count.

## Scope

`scripts/bulk-runner/` (`prepare.ts`, `cli.ts`, `screens/bill_corrigenda.ts`, `screens/bills.ts` exports,
`screens/index.ts`, their tests, and the two registry tests), `supabase/functions/_shared/suppliedText.ts` and its test,
one migration, one fixture, one chain entry in `supabase/tests/run.sh`, this spec, and the F372 entry.

## Exclusions

- No load, no policy approval, no migration applied, no deploy.
- No change to the Bills screen's behaviour, the resolver, search, or any other desk; no corrigendum with a file link
  (none exists in v1.1 to v1.3).
- No tie by title, and no tie across houses or years.
- No new licence class.

## Rollback

Before the first corrigendum is admitted: the migration's header holds the exact statements (restore the function body,
drop the constraint, restore `NOT NULL`, remove the history row) and the Edge Functions are redeployed from the commit
before. After the first admission, the documents, jobs, chunks and links stay until a reviewed removal step: the restored
function would refuse their payloads and the `NOT NULL` cannot return while their links are null. The route adds no flag;
leaving the collection's policy unapproved keeps every corrigendum out.

## Tasks

| # | Task | Who | Depends on | Verification |
|---|---|---|---|---|
| 1 | Screen, prepare option, adapter mirror, migration, fixture (this change) | engineering agent | this spec | tests above; **done, uncommitted** |
| 2 | Independent review of the migration and the admission path | senior reviewer, given code, data and rules | 1 | findings answered |
| 3 | Decisions 1 to 8 | developer, owner | 1 | recorded in the plan |
| 4 | Deploy the two functions, dry run, apply the migration, approve the policy | supervisor | 2, 3; the developer's yes | the record |
| 5 | Screen, rehearsal batch, remainder, search and row checks | supervisor | 4; the developer's yes per load | acceptance evidence 2 to 4 |
| 6 | Widen the F314 resolver rule so a corrigendum shows on a shared key | senior builder | 5 | own spec |
