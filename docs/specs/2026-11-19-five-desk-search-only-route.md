# A search-only route for five National desks (F367, F371)

> **Status: Living (2026-11-19).** Specifies how the documents of five National desks in packs v1.1 to v1.3 are
> admitted. Plan: [v1.1 to v1.3 loads and close-out](../plans/2026-11-19-v1.1-to-v1.3-loads-and-closeout.md), tasks A2,
> B1 and B2. It extends the route built for Regulatory ([screen spec](2026-11-12-regulatory-screen.md), migration
> `20261113090000_national_search_only.sql`). Nothing here is applied to production without the developer's specific
> yes after a rolled-back dry run.

## Current state (packs read from Drive 2026-11-19; counts only)

| Desk, as the packs spell `desk_feature` | Entries | Records | Text from | File link host | Shortest / median / longest (characters) |
|---|---|---|---|---|---|
| Budget Utilisation & Schemes | v1.1 budget | 486 | PDF text 483, document 2, OCR 1 | `www.indiabudget.gov.in`, all, rebuilt from the path | 341 / 10,323 / 2,624,211 (10 over 600,000) |
| Cabinet Decisions | v1.1 cabinet | 868 | web page | `www.pib.gov.in`, all | 201 / 1,856 / 95,872 (21 under 300) |
| Bureaucratic Transfers — AGMUT Cadre | v1.1 (29, written with a hyphen), v1.3 (11) | 40 | PDF text | `mha.gov.in`, all | 1,006 / about 2,000 / 4,523 |
| Industry Updates (Ministry Data) | v1.1 (28, 6 already on NTER), v1.3 (37) | 65 | PDF text 59, OCR 6 | none in v1.1; `www.dpiit.gov.in`, `eaindustry.nic.in`, `www.mospi.gov.in`, `mospi.gov.in` in v1.3 | 1,406 / about 18,000 / 701,105 (2 over 600,000) |
| MP Profiles & Performance (MPLAD attendance debates) | v1.1 (3,157), v1.2 (565) | 3,722 | web page 3,157, dataset 565 | `sansad.in`, all | 86 / 1,396 / 8,271 (207 under 300) |

- Every record has a 40-character `source_key`, a citation block with `kind` and `source`, and a licence class. The
  other citation fields differ by desk (for example `prid` for Cabinet, `mpsno` and `mp_name` for MP profiles).
- Budget, Industry and MP records carry `document_key_suggested` (prefixes `budget:`, `industry:`, `mp:`). Cabinet and
  Transfers carry none.
- The search-only branch names one desk and three hosts, in four places of the migration and in
  `supabase/functions/_shared/suppliedText.ts` (`NATIONAL_SEARCH_ONLY`, `SEARCH_ONLY_HOSTS`). The runner knows one
  search-only screen, `national-regulatory`.
- The chat matches a desk to its documents by a name with punctuation removed (`moduleName` in
  `research-chat/handler.ts`), then searches the one spelling it finds. The commas missing from the packs' MP
  Profiles name are therefore harmless. Two spellings of one desk are not: only one would be searched.

## Problem

None of the five desks can be loaded: registration refuses them as having no adapter, and no screen exists. The
Transfers desk arrives under two spellings. The existing host list is one list for every search-only desk, so adding
hosts to it would let one desk's record carry another desk's link.

## Expected outcome

Each of the five desks can go through the runner: screened, registered as one sealed batch, admitted search-only,
chunked into the default partition, found by search in its desk, and cited with its source. Other desks behave
exactly as today.

## Design

1. **One migration.** `CREATE OR REPLACE` of each function that names the search-only desks, from its latest body,
   with:
   - the desk list extended by the five names above, in the dash spelling for Transfers;
   - the file-link host checked **per desk**, not from one shared list: Regulatory keeps its three hosts; Budget
     `www.indiabudget.gov.in`; Cabinet `www.pib.gov.in`; Transfers `mha.gov.in`; MP Profiles `sansad.in`; Industry
     `www.dpiit.gov.in`, `eaindustry.nic.in`, `www.mospi.gov.in`, `mospi.gov.in`;
   - the two unique indexes and the "already held" lookups widened to the same desk list;
   - privileges restated exactly as they are.
   `suppliedText.ts` mirrors the list and the hosts. A record without a file link stays admissible, as today.
2. **Five screen configurations** on the existing search-only screen (`scripts/bulk-runner/screens/*.json`), one
   collection name each (`national-budget`, `national-cabinet`, `national-transfers`, `national-industry`,
   `national-mp-profiles`):

   | Desk | Text types allowed | Completeness basis | Citation fields required | Suggested key prefix |
   |---|---|---|---|---|
   | Budget | `pdf_text` | page check against the official PDF, required | `kind`, `issuer`, `source` | `budget:` |
   | Cabinet | `html` | density-only | `kind`, `issuer`, `prid`, `source` | none |
   | Transfers | `pdf_text` | page check where the link is a checkable PDF; density-only where there is none | `kind`, `source` | none |
   | Industry | `pdf_text` | page check where a link exists; density-only otherwise | `kind`, `source` | `industry:` |
   | MP Profiles | `html`, `dataset` | density-only | `kind`, `house`, `mp_name`, `mpsno`, `source` | `mp:` |

   Minimum length 300 and maximum 600,000 characters for every desk, as for Regulatory. That holds 21 Cabinet records,
   207 MP profiles, and 12 long Budget and Industry documents (F311 covers long documents). Budget's 2 `doc` and 1
   `ocr` records and Industry's 6 `ocr` records are held as a text type not allowed; the 6 are already on NTER.
3. **One spelling per desk.** The Transfers configuration accepts the hyphen spelling from v1.1 and writes the dash
   spelling, in both `desk_feature` and `desk_rows_feature`. The screen records how many it rewrote. No other value
   of a record is changed.
4. **Rebuilt Budget links (decision D3).** The page check fetches the official PDF, so a link that does not answer
   cannot pass as page-checked. A record whose link fails is held, not admitted on density alone, for this desk.
5. **Policies.** One policy per desk, approved on NTER with `ingest_policy_approve`, naming the checks the screen
   reports. MP Profiles is approved only after the owner's personal-data note.
6. **Partition.** All five land in the default partition: about 27,000 chunks by estimate (Budget about 20,000),
   beside the 68,110 chunks of Parliamentary Questions. No desk is near the 100,000 bound. The runner's own refusal
   above that bound is F285.
7. **Citations.** Every citation carries its publisher (F332), and the screen holds a record whose publisher cannot
   be named. `supabase/functions/_shared/publisher.ts` names Regulatory documents only, so it is extended. As for
   Regulatory, the name is a constant chosen from the document's hosts, never a value from the document:

   | Desk | Domain | Publisher shown |
   |---|---|---|
   | Budget | `indiabudget.gov.in` | Ministry of Finance, Government of India |
   | Cabinet | `pib.gov.in` | Press Information Bureau, Government of India |
   | Transfers | `mha.gov.in` | Ministry of Home Affairs, Government of India |
   | MP Profiles | `sansad.in` | Parliament of India |
   | Industry | `dpiit.gov.in` | Department for Promotion of Industry and Internal Trade |
   | Industry | `eaindustry.nic.in` | Office of the Economic Adviser, DPIIT |
   | Industry | `mospi.gov.in` | Ministry of Statistics and Programme Implementation |

   A document whose hosts are outside its desk's domains, or name two publishers, gets no name and is held. The
   research chat imports this file, so it is redeployed with the route.
8. **Corrections from the build, 2026-11-19.** (a) A link that matches a desk's PDF rule but cannot be fetched or read
   holds the record on every desk, as the Regulatory screen already does; the density-only basis applies only where a
   record has no checkable link. (b) The screen engine refused any projection that changes a field, so the spelling
   rewrite needs a declared exception: a screen may name the fields its projection may change, and only those.
   (c) Cabinet and MP records have no pages (`page_split` none); the configurations say so with a flag, and admission
   is checked for the same shape by fixture.

9. **From the independent reviews, 2026-11-19.**
   - **First load.** The `screen` command refuses a desk that holds no documents, to catch a wrong database. Four of
     the five desks hold none. `--first-load` declares a first load: it is refused once the desk holds documents, it
     still checks the database and server identity, and the receipt records it.
   - **Shared host.** MP Profiles shares `sansad.in` with Parliamentary Questions and Bills. A search-only record
     whose link is a question's answer file or a bill file is refused, on every search-only desk; otherwise it would
     later block that question's own admission.
   - **Page count.** Admission refuses a record with no pages when the desk's policy requires a page count. Cabinet
     and MP Profiles are web pages, so their policies set that requirement off, and the screen follows the policy.
   - **Applying.** The new indexes are built first and swapped in, so searches wait only for the swap; a lock that is
     not granted in 2 s rolls the whole file back and the apply is run again. An empty suggested key on an older
     document is left out of the index.
   - **Publisher.** As for Regulatory, a host outside the desk's domains is ignored, not a refusal: the name comes
     from the hosts that are the desk's own. This replaces the stricter wording in point 7.
   - **Budget.** The configuration simply does not allow the density-only basis; no separate rule was needed.
   - **Rewrite exception.** The engine lets a screen change `desk_feature` and `desk_rows_feature` only.

## Acceptance evidence

1. Fixture in `supabase/tests/`: a record of each desk is admitted with its own host and refused with another desk's
   host; a desk outside the list is refused as before; Law, Parliamentary Questions, Bills and Regulatory take the
   paths they took. The fixture fails when rebuilt without the migration (`npm run test:sql`).
2. Screen tests per configuration: a good record passes; each hold named above is shown on a record built for it;
   the hyphen spelling comes out as the dash spelling.
3. The whole v1.1 entry of each desk through `screen` on the developer's machine: counts of eligible and held by
   reason, in a record. No text is printed.
4. Rolled-back dry run of the migration on NTER with the function hashes compared before and after, then the apply,
   as for the batch-close migration ([record](../operations/2026-11-17-batch-close-apply.md)).
5. First load per desk: a batch of at most 100, acceptance 50 of 50 or all, one search in the desk that returns a
   loaded document, one citation showing the publisher, and the search check for every existing desk unchanged.
6. An independent reviewer reads the migration against the access rules before it is committed.

## Scope

- One file in `supabase/migrations/`, one in `supabase/tests/`, `supabase/functions/_shared/suppliedText.ts` and its
  test.
- `scripts/bulk-runner/screens/` (five configurations, `index.ts`, `search_only.ts`), `scripts/bulk-runner/screen.ts`
  and `screen_types.ts` for the declared rewrite, `supabase/functions/_shared/publisher.ts`, and their tests.
- A record per load in `docs/operations/`.

## Exclusions

- No row links: a search-only document has none (F368, its own spec).
- No corrigenda (F372), no replacements (F357), no Regulatory change (F355, F369), no row files or page boxes (F373).
- No new partition, no change to search functions, no change to billing, accounts or analytics.
- No load of MP Profiles before the owner's note.

## Tasks

| # | Task | Who | Depends on | Verification |
|---|---|---|---|---|
| 1 | Migration and fixture | senior builder | this spec accepted | `npm run test:sql`, non-vacuity shown |
| 2 | Shared constants | senior builder, same change as 1 | 1 | Edge Function tests |
| 3 | Screen configurations, spelling rewrite, Budget link rule | engineering agent | this spec accepted; disjoint from 1 | bulk-runner tests, each hold shown to fail without its rule |
| 4 | Independent review of 1 to 3 | senior reviewer, given code, data and rules only | 1, 3 | findings answered |
| 5 | Dry run, then apply on NTER; redeploy the functions that import the constants | supervisor | 4; the developer's yes | the record |
| 6 | Screen each v1.1 entry; policies; loads in the plan's order | supervisor | 5; the developer's yes per load | acceptance evidence 3 and 5 |

## Open decisions for the developer

1. **Held on length.** 228 short records and 12 long documents are held under the Regulatory limits. Recommendation:
   keep the limits; list the held keys in each record.
2. **Industry without a link.** The 22 new v1.1 Industry records have no file link and load with a citation only.
   Recommendation: load them; v1.3's 37 carry links.
3. **Budget records that fail the page check.** Recommendation: hold them and report the count, since their links
   were rebuilt and not confirmed by the pack.
