# Screening and loading Regulatory v1.1, search-only (F307)

> **Status: Living (draft for the developer, 2026-11-12, revision 2).** Not approved. Revision 2 applies an
> independent review ("ready after changes"), the T0 counts and the supervisor's decisions. It applies the screening
> stage ([spec](2026-11-10-screening-stage.md)) to the Regulatory entry of National v1.1 and specifies the admission
> path, policy and load. Plan: [national ingestion, next](../plans/2026-11-11-national-ingestion-next.md), Phase 1
> tasks 2 to 7. Scope: [ADR 0014](../decisions/0014-national-v1.1-ingestion-scope.md). Related: [PQ screen](2026-11-11-pq-screen.md),
> [runner and acceptance](2026-11-08-runner-cli-and-acceptance.md), [Bills load](../operations/2026-11-10-bills-load.md). T1 to T3 built 2026-11-12; see Build notes.
> Open work: F307, F275, F278, F285, F311, F272, F326, F327.

Evidence labels: **read** = read in the code or document cited, at `origin/main` `c8c03eb9`; **inferred** = concluded
from what was read, not executed; **T0, 2026-11-12** = counts on the cached v1.1 entry (counts only); **profile,
2026-11-11** = the supervisor's NTER counts (read-only). Every number marked "estimate" is one. Nothing in this spec was
executed by its author.

## Summary

- v1.1 `documents/regulatory.jsonl.gz` has 3,319 records. After the holds below, **2,697 candidates** remain, about
  120 million characters (TRAI 1,429, CCI 1,154, RBI 94, SEBI 20). Only **114** of them have a `file_url`.
- **No supplied-text or batch path admits a Regulatory document today** (read). The admin PDF upload accepts the desk,
  but it is not this path. One migration and one Edge Function change are unavoidable.
- Identity is the pack `source_key`. `document_key_suggested` must be unique in the input and not already live.
  `file_url`, when present, is checked against a configured host list. Every record, the 121 linked ones included,
  loads **search-only**: no listing link is written.
- The largest decision is the developer's: 2,583 of the 2,697 candidates have no official URL, so their text cannot be
  checked against an official file and a reader gets no source link. Recommended: a named "density-only" completeness
  basis, stored on each document, with a hand check of 40 documents first (question D1).
- Three owner gates come before any live load: the licence class, attribution in citations (no code path shows it
  today: a blocker with its own task), and a report-only count of PAN- and Aadhaar-shaped strings.
- One generic search-only screen with Regulatory's specifics in a configuration file. It reuses six Bills checks as they
  are and two with a parameter, adds nine checks and one report-only scan.
- The first load is cut into files of about 500 records. The Regulatory evaluation set is re-run on NTER before the
  load, after the 100-document batch and after the load, because the first batch moves Regulatory search from exact scan
  to the vector index.

## Current state

### A record in the pack

| Field | v1.1 (T0, 2026-11-12, unless marked) |
|---|---|
| `schema` | `nter.citation_pack/1.1` (all; profile) |
| `source_key` | distinct on all 3,319 |
| `desk_tier` / `desk_feature` / `desk_rows_feature` | `national` / `Regulatory Body Watch (RBI SEBI TRAI CCI)` / `Regulatory Body Watch (RBI/SEBI/TRAI/CCI)` |
| `doc_type` | `regulatory` (all) |
| `document_key_suggested` | present and distinct on all; prefix `reg` |
| `file_url` | on 121 (all distinct): RBI 96, SEBI 25; none on the 3,198 TRAI (1,837) and CCI (1,361) records. Hosts: `rbidocs.rbi.org.in` 78 (all `.pdf`), `www.rbi.org.in` 18 (`.aspx`), `www.sebi.gov.in` 25 (`.htm`/`.html`). Host equals `source_host` (ignoring `www.`) on 43 only |
| `links` | exactly the 121 with a `file_url`, one each, role `primary_document`; `row_key` distinct (101 are `1` to `101`, 20 are `rbi_#####`); the link's `document_key` equals `document_key_suggested` on all 121 |
| `citation` | `kind`, `regulator`, `regulator_name`, `title`, `date`, `source` on all (profile); `citation.date` non-empty on 1,035, all shaped `YYYY-MM-DD`, of which 160 are not calendar dates (155 with a month above 12); valid years 1904 to 2062 |
| `licence_class` / `servable` | `govt_material_confirm_counsel` (all) / absent (all) (profile) |
| `extraction` × `page_split` | `ocr` → `none` 506 (no `pages`, `pages_with_text` null, `ocr_quality` 0.049 to 0.857, median 0.68; TRAI 313, CCI 191, RBI 2). `pdf_text` → `exact` 2,782, `approximate` 13, `last_page_empty` 11, `unsplit_multipage` 7 |
| `pages` (2,813 records) | elements `page_number`, `char_from`, `char_to`, `text`; spans cover the text; consecutive pages are one character apart (`char_from` = previous `char_to` + 1); `pages_with_text` < `page_count` on 31; `page_count` 1 to 16,397, median 7 |
| `content_sha256` | 3,223 distinct; 177 records in 81 groups share a text (largest group 3) |
| `n_chars` | under 300: 1; 300 to 999: 44; 1,000 to 599,999: 3,252; 600,000 to 1,999,999: 21; 2,000,000 or more: 1 (max 23,523,519, profile) |
| other strings | no `title` over 300 characters; no other string field over 4,000 |
| records file | 362,941,258 bytes uncompressed: over the runner's 256 MiB limit (`cli.ts:181`), so it is cut with `split` |

Funnel (T0): 3,319 → minus 506 OCR → 2,813 → minus 31 non-exact splits → 2,782 → minus 0 under 300 → minus 22 over
600,000 → 2,760 → minus 63 duplicate texts → **2,697** (119,942,184 characters; 114 with a `file_url`). Live holds
(`already_live`, `duplicate_text_live`, `suggested_key_held_live`) come on top; T5 counts them.

Not yet counted (tasks): v1.1 records not live by `source_key` whose regulator, title and date match one of the 474
live documents; which character separates pages (the reused span rule wants a form feed, below); whether the 474 carry
`document_key_suggested` in `metadata`; the load copy's inventory (T6); how F275's "2,845 regulatory documents with no
listing rows" relates to this pack's 3,198.

### On NTER (profile, 2026-11-11, read-only)

474 Regulatory documents, all created 2026-09-21 by the first corpus pass, 472 with no `file_url`, every `source_key`
among the profiled keys; 12,983 chunks in `document_chunks_regulatory`; 121 listing rows, none with a `document_key`; no
`record_document_links` row for a Regulatory document.

### Spellings (read)

Documents and chunks use the space spelling; the listing and the desk catalogue use the slash spelling
(`deskCatalog.json:158`). Serving bridges the two: `research-chat/handler.ts:764-790` (`moduleName`, `featureScopeOf`)
compares names with punctuation folded to spaces, and the admin upload stores the spelling the corpus already uses
(`admin-ingest/handler.ts:594-606`).

### Partition and search path (read)

- `document_chunks_regulatory` holds `'Regulatory Body Watch (RBI SEBI TRAI CCI)'`, RLS on, no privileges
  (`20261101120000_document_chunks_partitioned.sql:356-357`, `:529`).
- `match_documents` with a feature counts that feature's indexed, embedded chunks up to 15,001 and scans exactly at
  15,000 or fewer, else walks the vector index (`c_exact_max_chunks`, same file `:846`, `:955-966`). Regulatory has
  12,983, so the 100-document batch (an estimated 5,500 chunks at the candidates' mean of about 44,500 characters) moves
  Regulatory search onto the index path.
- `document_date_facet` has no Regulatory branch (`:298-317`): new documents get a null `doc_date`. A follow-up, not
  this spec.

### Runner (read)

- `plan.ts:127-136`: a feature listed in `limits.partitioned` skips the 100,000-chunk guard; only `chunkCeiling`
  (`:152-157`), budget (`:149-151`) and the disk stop line (`:174-177`) bound it. The list is the collection file's
  word (`cli.ts:135`).
- `prepare.ts:192-194` holds text over 600,000 characters; `:198-203` holds a dense run of control codes; `:204`
  strips the rest; `:266-272` turns a refusal of `prepareSuppliedText` into `prepare_failed`; `:274` applies
  `maxChunks`. `cli.ts:601` and `run.ts:124` carry `controlCodesRemoved` into the run receipt.
- `pack.ts:456-458`: the reader drops `servable === false`, `BARRED_` classes and `v16_replaces === true` only.
- `acceptance.ts:179-182`: with `requireLinks` false, a document with no link is not failed; `:196-197` runs the
  stored-vector probe.
- CI runs the runner's tests, `deno lint` and `deno fmt --check` on `scripts/bulk-runner` (`.github/workflows/ci.yml:46-50`).

### What readers show (read)

- A text citation carries `title`, `file_name`, `file_url`, `desk_tier`, `desk_feature` (`_shared/citations.ts:228-245`,
  `citation.types.ts:28-54`); the bubble reads "title — desk feature" (`src/ai/CitationBubble.jsx:84`); the source
  reader shows the title, file name and the stored text, and an "Open file" link only when there is a URL
  (`src/ai/SourceReader.jsx:81`, `:99-109`). So for the 472 live documents with no URL, and for every new TRAI or CCI
  document, a reader sees the title, the desk and the text, with no link to the official source (inferred from those
  lines).
- **Attribution:** no code path shows a document's publisher, source or licence attribution. The only "attribution"
  in the answer path is Law's argument-attribution warning (`research-chat/agent.ts:413-415`). ADR 0014's consequence
  ("attribution must show in citations for every licence class") is not met for any desk today. This is a blocker for
  the live load (owner gate O2, task TA).
- Admin readiness: a search-only document reads `association_kind` `unassociated` (no link, no `document_key`;
  `20261027231901_admin_corpus_readiness.sql:28-33`), and the 121 listing rows stay `unmapped` (`:121`). Neither is
  breakage.

## Admission

### What admits these today (read)

| Gate | Where | Regulatory record |
|---|---|---|
| `prepareSuppliedText` desk check | `suppliedText.ts:100-106` | refused `unsupported desk feature`: the space spelling is not in `DESK_CATALOG`, and `deskOk` admits only Law, Bills and Questions |
| non-bill National branch | `suppliedText.ts:120-126` | would require a Lok Sabha answer URL |
| `page_split` | `suppliedText.ts:128-130` | refused unless `exact` or `none` |
| `ingest_admit_tier` | `20261107120000_bills_adapter.sql:97-107` | null |
| `ingest_admit_shape` | `20261102130000_batch_registration.sql:346` | `invalid_source_or_text_hash` when the tier is null |
| `ingest_admit_adapter` | `bills_adapter.sql:109-116` | null, so `ingest_register_batch` refuses `no_adapter` (`:414-417`) |
| `ingest_policy_approve` | `batch_registration.sql:668-672` | refuses the desk: its `adapter` must equal `ingest_admit_adapter(desk)` |

The admin PDF upload path does accept the desk (`admin-ingest/handler.ts:594-606`, `:698-734`): it resolves the
catalogue entry and stores the corpus spelling. It uploads one PDF for OCR and is not the bulk path.

The worker re-prepares every stored payload with `prepareSuppliedText` before paying for embeddings
(`ingest-worker/supplied-step.ts:38-47`), so the Edge Function change is deployed before the migration.

Policy gates every adapter gets (`bills_adapter.sql:145-182`): licence class in the policy and not personal data;
`servable` not false; required checks (only `title_guard`, `bill_identity`, `batch_registration.sql:672`); `n_chars`;
`n_pages`/`page_count` equal to the spans; no control code; `no_page_count`; `thin_text` by the density numbers. Then
duplicate text (`:276-286`).

### The migration (T2): `national_search_only`

One file, timestamped after every migration on `main` when it is written (after `20261112090000_batch_resume_requeue`
if that PR merges first; if it replaces any function below, T2 rebases on its body). It opens with a guard block that
refuses to run unless `20261110120000_bills_admission_rules.sql` is applied (its `bill_admission_key` exists and is
`stable`), then `set local lock_timeout = '10s'`. Every function is `create or replace` from its current body with one
added branch, so grants stay:

| Object | Change |
|---|---|
| `ingest_admit_tier` | `'national'` for a 40-hex `source_key` on a search-only desk |
| `ingest_admit_adapter` | `'national_search_only'` for the desks in one list (Regulatory's space spelling only) |
| `ingest_admit_document` | search-only branch: refuse `completeness_basis_missing` unless `completeness_basis` is `page_check` or `density_only`; when `file_url` is present, refuse `file_url_invalid` unless it is https, its host is in the configured list (`rbidocs.rbi.org.in`, `www.rbi.org.in`, `www.sebi.gov.in`; later desks add theirs) and it has no `.`/`..` or encoded-separator segment (the rule of `bill_admission_key`, `20261110120000`); refuse `file_url_held` when a document of the same feature holds it; refuse `suggested_key_held` when a document of the same feature has the same `metadata->>'document_key_suggested'`; **no link insert** (the link block, `bills_adapter.sql:302-318`, stays limited to the two linked adapters) |
| `ingest_register_batch` | lock values for the adapter: `coalesce(file_url, source_key)` and `document_key_suggested`, as Bills' (`:429-431`) |
| `ingest_register_text_unmapped` | refuses the adapter, as it refuses Bills (`:333-335`) |
| indexes | `unique (file_url)` where the feature is a search-only desk and `file_url` is not null, as `documents_bill_file_url` (`:44-45`); a partial index on `metadata->>'document_key_suggested'` for the same desks (the existing one, `20261106120000_admission_scans.sql:50-51`, is limited to Parliamentary Questions) |

`ingest_policy_approve` needs no change.

**Rollback:** clean only before the first Regulatory admission: re-run the bodies from `20261107120000_bills_adapter.sql`
(each `create or replace`), drop the two indexes, delete the history row. After an admission, the documents stay until a
reviewed step removes them. Rolling the worker back while Regulatory jobs are queued fails them (the old adapter refuses
their payloads, `supplied-step.ts:39-41`), so the worker rolls back only with no Regulatory job queued or running.

Shared adapter (same task), `supabase/functions/_shared/suppliedText.ts`:

- `NATIONAL_SEARCH_ONLY`, a list holding the one desk; `deskOk` admits it without the catalogue lookup (its stored
  spelling is not the catalogue's); the question-URL branch (`:120-126`) applies to the question desk only.
- A search-only record must carry `completeness_basis` (`page_check` or `density_only`); it is copied into the payload
  (added to the copied fields, `:232-253`) and so stored in `metadata` (`bills_adapter.sql:288`). Other desks never
  carry it, so their payloads do not change.
- When `file_url` is present, the same host list and segment rule as the SQL.
- Every existing question, bill and Law fixture must prepare byte-identically (the worker compares stored payloads,
  `supplied-step.ts:42-47`).

SQL fixture (`supabase/tests/national_search_only.sql`, chained in `supabase/tests/run.sh` after
`ingest_bills_admission_rules`, with the vacuity check dropping the new migration): admits a Regulatory record with no
link and its basis stored; refuses each new reason; re-proves Law, Parliamentary Questions and Bills unchanged by
including `ingest_bills_adapter.sql` through `fixture_sql()`'s include (`run.sh:1187-1197`). That include also runs
`ingest_register_batch.sql:304`, which expects a Regulatory-spelled record under the `national-pq` policy to be refused
`no_adapter`; with the new adapter it is `collection_not_admitted`. The new fixture's include rewrites that one
expected reason, on purpose and commented; the older fixtures keep theirs, since their chains lack the new migration.

### What search-only means

Stored, chunked into the Regulatory partition, found by search in its feature; no `record_document_links` row. For the
121 linked records:

| Option | What it needs | Recommendation |
|---|---|---|
| A. Search-only like the rest | nothing more | **yes, first load** |
| B. Link later with `record_mapping_apply` (`20261027185747_record_document_associations.sql:34`) | the pack's `row_key`s (`1`–`101`, `rbi_#####`) matched to NTER's 121 rows; a reviewed mapping; F275's listing decision. Not traced here | the follow-up |
| C. Linked at admission | a branch finding rows by `row_key` under the listing spelling (the Bills insert matches `q.feature = r->>'desk_feature'`, `bills_adapter.sql:312`, which no Regulatory row has) | no |

## The screen

### Generic screen, Regulatory as configuration

`screens/search_only.ts` exports `makeSearchOnlyScreen(config, pageCheck)`. Regulatory's specifics live in
`screens/regulatory.json`, validated strictly by the factory and listed in `rules_sha256`: desk tier, both spellings,
`doc_type`, the suggested-key prefix (`reg:`), the required citation fields, allowed `extraction` values (`pdf_text`),
`source_host` values, the URL host list, the PDF URL rule (`^https://rbidocs\.rbi\.org\.in/.+\.pdf$`, case-insensitive),
the character limits (300 to 600,000), the replacement fields, and whether the density-only basis is allowed (D1).
`screens/index.ts` registers `national-regulatory`. The collection file's `screen.settings` keeps the licence classes
and the two density numbers, which must equal the policy's (`rules_sha256` covers settings, `screen.ts` `rulesSha256`).

Other v1.1 collections are not registered until profiled; MP profiles and transfer orders need the owner's
personal-data look first (ADR 0014; plan, Phase 4); bill corrigenda belong to Bills.

### Checks, in order, with hold codes

The core's holds run first (`screen.ts:320-344`): `no_source_key`, `duplicate_source_key`, `no_text`,
`text_not_well_formed`, `content_sha256_mismatch`, `record_has_review`; `--no-live`/`--no-pages` hold everything
`screen_incomplete` (`:352-362`).

| # | Check | Covers | Rule | Holds | Source |
|---|---|---|---|---|---|
| 1 | `record_shape` | identity | schema `nter.citation_pack/1.`; 40-hex `source_key`; tier, both spellings and `doc_type` as configured; `document_key_suggested` a string with the configured prefix | `bad_shape` | new |
| 2 | `not_a_replacement` | identity | `v16_replaces === true`, or `delta_patch` or `replaces_text` present | `replacement_not_supported` | new |
| 3 | `source_fields` | identity | `title` 1 to 300 characters (`suppliedText.ts:93`); `citation` a non-empty object (`:152-153`) with the configured fields non-empty; every copied field, when not null, a non-empty string of at most 4,000 (`:232-256`); `text_quality` absent or `ok` (`:127`); `source_host` configured; `file_url`, when present, https, host in the list, no credentials, no dot or encoded segment (as the SQL) | `title_invalid`, `citation_incomplete`, `field_invalid`, `text_quality`, `unknown_host`, `not_official_url` | new |
| 4 | `links_shape` | identity | no links, or one: tier `national`, the listing spelling, role `primary_document`, non-empty `row_key`, `document_key` equal to `document_key_suggested`. Read, never written | `link_shape` | new |
| 5 | `text_binds` | completeness | hash, `n_chars`, `page_split` `exact` or `none`, spans from page 1 each starting one character after the previous one ends, that character a form feed (`bills.ts:233-235`), `page_count`; `none` passes only with `page_count` equal to its spans | `text_hash_mismatch`, `n_chars_mismatch`, `page_split` (the 31), `page_spans`, `page_count_unsplittable` | reused as is, if the separator count (open) shows form feeds; else given a separator parameter |
| 6 | `length` | completeness | 300 to 600,000 UTF-16 units, as `prepare.ts` counts | `too_short`, `too_long` (the 22) | reused, parameterised (`makeLength`; Bills keeps 200) |
| 7 | `density` | completeness | admission's gate on the text as admission sees it (after `prepare.ts`'s `strip`): spans at least `min_pages_for_density` and code points per span below `min_chars_per_page`; no spans under `require_page_count` | `below_density`, `no_page_spans` | new (mirrors `bills_adapter.sql:173-181`) |
| 8 | `extraction` | completeness | `extraction` among the configured values | `extraction_not_allowed` (the 506 OCR) | new |
| 9 | `servable_licence` | sensitivity | `servable` absent or true; not `BARRED_`; not personal data | `not_servable`, `servable_malformed`, `licence_barred`, `personal_data` | reused (`bills.ts:254-266`) |
| 10 | `licence_admitted` | rights | `settings.licenceClasses` = `['govt_material_confirm_counsel']` | `licence_not_admitted` | reused (`bills.ts:268-274`) |
| 11 | `already_live` (live) | dedupe | `source_key` held by any document; `file_url`, when present, held by a document of the feature | `already_live` | new (Bills' holds every record without a URL, `bills.ts:376`) |
| 12 | `suggested_key_held_live` (live) | dedupe | a document of the feature has the same `metadata->>'document_key_suggested'` | `suggested_key_held_live` | new; needs a `LiveReader` list |
| 13 | `suggested_key_collision` (set) | dedupe | records sharing `document_key_suggested`: all held | `suggested_key_collision` | reused builder (`collisionCheck`, `bills.ts:421-443`) |
| 14 | `file_url_collision` (set) | dedupe | records sharing a non-null `file_url`: all held | `file_url_collision` | reused (`bills.ts:456-460`) |
| 15 | `duplicate_text` (set) | dedupe | the hash `prepare.ts` will store; the lowest `source_key` stays | `duplicate_text` (63 in the funnel) | reused (`bills.ts:463-485`) |
| 16 | `duplicate_text_live` (live) | dedupe | another document holds that hash | `duplicate_text_live` | reused (`bills.ts:489-518`) |
| 17 | `completeness_basis` (pages, `onlyIfClean`) | completeness | a record whose `file_url` matches the PDF URL rule (78 RBI): the page check runs (`page_check.ts`, `urlRule`) and must pass; basis `page_check`. Any other record (no URL, or an HTML/ASPX URL): only if the configuration allows the density-only basis (D1), and only for an allowed text-layer extraction with `page_split` `exact` that passed checks 5 to 8; basis `density_only`. Else held | the page check's reasons; `no_completeness_basis` | new, wraps the reused page check |

Reused: six as they are (5, 9, 10, 14, 15, 16), two with a parameter (6, and the builder for 13), and the page check
inside 17. New: nine (1, 2, 3, 4, 7, 8, 11, 12, 17). Codes are distinct across checks (the page check keeps
`thin_text`; the density check says `below_density`).

**What completeness means.** Check 17 never returns an empty list for a record it did not judge: under option (i) the
records without a checkable PDF are held `no_completeness_basis`. Under option (ii) they pass check 17 because a named
rule ran (checks 5 to 8 passed and the configuration admits the density-only basis), not by default. The basis that
ran is recorded per record: `project` adds `completeness_basis` (it only adds, `screen.ts` `applyProject`), admission
requires and stores it, and the receipt counts each basis in `checks_stats`.

**Control codes** are not a screen check: `prepare.ts` strips them and holds a dense run before admission's refusal
can fire.

**Report-only scan (no hold, v1).** For the owner (gate O3), the receipt carries counts of records whose text holds a
PAN-shaped string (`[A-Z]{5}[0-9]{4}[A-Z]`) or an Aadhaar-shaped one (12 digits starting 2 to 9, optionally grouped
4-4-4), by host: records and matches, never values. A `Check` must cover a review check (`screen.ts` `validateScreen`),
so the scan is a new optional `reports` list on `Screen` that writes only to the receipt (T1).

**Invalid citation dates.** Not held. `prepare.ts` drops `citation.date` from a search-only record when it is not a
calendar date (160 in v1.1), before the payload is built, and counts it as `citation_dates_dropped`, carried into the
run receipt as `controlCodesRemoved` is (`cli.ts:601`, `run.ts:124`). The text and its hashes are unchanged.

`mapping_version` `search-only-screen-v1`; `rules_sha256` over `screens/search_only.ts`, `screens/regulatory.json`,
`screens/bills.ts` (the reused checks), `screen.ts`, `screen_types.ts`, `screens/index.ts`, `live.ts`, `page_check.ts`.

### Core changes (T1)

- **A screen without listing rows.** The core asks `identity` for documents and listing rows under the records'
  `desk_feature` (`screen.ts:723-724`, `live.ts:132-133`) and stops at zero (`screen.ts:729-734`); Regulatory rows use
  the other spelling (inferred zero). `Screen` gains `listingRows: 'required' | 'none'`; with `none`, only zero
  documents stops the run, and the receipt says so.
- `--service <name>` (default `nter-accept`; a constant today, `screen.ts:623`), as the PQ spec's T1; whichever lands
  first carries it.
- `Screen.reports` (above).
- `LiveReader.documents` gains `suggestedKeys` (with tier and feature, as `documentKeys`, `live.ts:83-91`).

### Identity collisions

| Case | In v1.1 | Screen | Admission |
|---|---|---|---|
| Two records, one `source_key` | none | core `duplicate_source_key` | unique `source_key` |
| Two records, one suggested key | none; v1.4 SEBI has 15,437 keys for 16,693 | `suggested_key_collision` | per-key lock |
| A later pack's record for a live suggested key | — | `suggested_key_held_live` | `suggested_key_held` (D3) |
| Two records, one `file_url` | none (121 distinct) | `file_url_collision` | lock and unique index |
| A live document holds the key, URL or text | the 474 | `already_live`, `duplicate_text_live` | `existing`/`legacy_source`, `file_url_held`, `duplicate_text` |
| One text twice | 81 groups, 177 records | `duplicate_text` | `duplicate_text` |

## Policy, collection file and worker settings

Estimates for the 2,697 candidates: about 120 million characters, about 150,000 chunks at 800 characters a chunk,
about US$0.75 of embedding at the Bills rate (266,947 chunks for US$1.34), about 2.1 GB at 13,970 bytes a chunk. Live
holds lower all of them; T5's plan gives the figures the policy uses.

Interim rule `min_decided` >= 2 x `claim_batch` / `failure_rate`: with 8 and 0.05 that is 320, so 400, as Bills
(`2026-11-10-bills-load.md:22-24`).

| Setting | Value | Why |
|---|---|---|
| collection | `national-regulatory` | one policy per collection (ADR 0014, 4) |
| admitted | `[{desk_tier: national, desk_feature: <space spelling>, adapter: national_search_only}]`, no required checks | |
| licence classes | `['govt_material_confirm_counsel']` | after owner gate O1 |
| `min_chars_per_page`, `min_pages_for_density` | 600, 5 | the F281 thin-OCR line (`docs/research/2026-11-02-batch-registration-design.md`, section 6) |
| `require_page_count` | true | every passing record has spans |
| `budget_usd` | 5 | estimate about US$0.75; v1.1 ceiling US$100 (ADR 0014, 3) |
| `chunk_ceiling` | the plan's chunks plus 10%, at most 200,000 | |
| stop thresholds | `refusal_share` 0.05, `failure_rate` 0.05, `uncertain_max` 5, `min_decided` 400 | refusals are pre-checked, so expected 0 |
| `prepare.maxChunks` | 700 | the largest measured on Bills; records of 700 to 800 chunks are held for F311 |
| files | 100 for validation, then about 500 records each (`cli.ts split --lines 500`) | a job that fails after its one requeue blocks its whole batch (F326); small batches limit what one failure holds up |
| `limits.partitioned` | includes the space spelling | checked by hand against `pg_inherits` before T8 |
| `limits.diskStopBytes` | 34 GB on the 40 GB disk | as Bills |
| `acceptance` | `{sample: 50, requireLinks: false}` | search-only |

With `min_decided` 400, the stop rules cannot fire inside a 100- or 500-document batch; each file is judged by hand
(0 refused, 0 failed) and by acceptance. Worker settings: `claim_batch` 8 and `max_running` 16 (still set from Bills)
during the load; back to 1 and 2 after it (approval A8).

## Acceptance

- **Automated** (`acceptance.ts`, unchanged): 50 a file, all passing: stored, indexed, text hash, chunks, vectors,
  probe first. No link check. F313: shared boilerplate headings can give `probe_not_first`; read before calling it a
  defect.
- **Attribution (owner gate O2):** a cited answer about one loaded document shows its attribution (regulator and
  source). No code shows it today; task TA must land first.
- **Evaluation gate**, with `scripts/eval-retrieval.mjs --target nter` (read-only, frozen question vectors), Regulatory
  set of 60 (`src/lib/evalSet.js:10`), feature mode, Doc@10:
  - E0 on NTER immediately before the load (the 2026-11-01 baseline, 54/60, was on the replica and is stale);
  - E1 right after the 100-document batch (the search path has switched);
  - E2 after the load.
  - On a drop of more than 3 against E0: stop loading, report, and, with approval A7, take the batches since E0 out of
    search by clearing `indexed_at` (recorded per document), as F281 did (`docs/operations/2026-11-02-f281-repair.md:168`).
    Clearing it also returns the count below 15,000 if enough are cleared. Their vectors stay in the index (inferred),
    so the walk may underfill (F272); E1 after the clear checks it.
  - Optional, now: the Bills set (60) on NTER, cheap evidence on whether the synthetic-growth drop is real: Bills grew
    by 266,947 real chunks on 2026-11-10.
- **Spot-check** after the load, as the developer's login: ten documents (TRAI, CCI, RBI, SEBI; short and long), each
  searched in the desk with a question written from its title; each in the top 10.

## Rehearsal, then NTER

1. **Rehearsal (T6).** The hybrid rehearsal copies were dropped on 2026-11-11 (open-work F286), so
   `scripts/load-proof/db.sh load-real` cannot rebuild from `niyantran_rehearsal_b9final` (`db.sh:5`). The load copy
   `niyantran_ingest_load_test` exists (about 15 GB; its schema is a fixture chain,
   `docs/plans/2026-11-06-ingestion-load-proof.md:8-13`) and may hold synthetic Regulatory chunks from F287.
   - Inventory first: documents and chunks by desk (synthetic and real), `schema_migrations`, `ingest_*` tables.
   - Apply what it lacks, in order, as the fixture chains do: `20261106120000_admission_scans`,
     `20261107120000_bills_adapter`, `20261110120000_bills_admission_rules`,
     `20261110180000_record_resolver_shared_bill_keys`, `20261112090000_batch_resume_requeue` if merged, then T2's
     migration. Skip `20261111090000_search_keep_warm` (needs `pg_prewarm`, irrelevant here).
   - If it holds synthetic Regulatory documents, remove them from the copy only, so `already_live` and the 15,000 switch
     behave as on NTER.
   - Connection: a libpq service `nter-load-copy` (in the developer's service file, outside the repository) for the
     screen (`--service`) and acceptance (`--accept-service`).
   - Run: policy; screen (`--service nter-load-copy`); plan; run 100 screened records with the harness's fake embedder;
     acceptance. Pass: every screened record admitted, 0 refusals, chunks in `document_chunks_regulatory`, no link row,
     `completeness_basis` stored, Bills and question fixtures unchanged. A `--break` that makes admission refuse a
     screened record must fail the proof.
2. **NTER (T7).** Read the deployed `ingest-worker` and `admin-ingest` back and diff `supabase/functions` against the
   commit to deploy; list every change (at this checkout there is none between the Bills deploy `39faf8ae` and `main`
   for those two functions and `_shared`, read; F301's worker change rides along if it merges first, and then needs
   the developer's yes by name). Deploy; pause cron job 4; dry-run the migration with its commit replaced by a rollback
   and checks inside (a Regulatory record admitted with no link and its basis; each new refusal; a question and a bill
   as before; the single-document path refuses Regulatory); apply with its history row; resume;
   `analyze public.documents`.
3. **Load (T8).** E0; policy; the 100-document file with acceptance; E1; then the files of about 500, each with
   acceptance; E2; spot-check.
4. **Cold measurement (T9)** straight after the load: the hybrid plan's cold run on Regulatory's grown partition
   (keep-warm covers NCLT only, F324). Then worker settings back.

## Tasks

`deno test …` means `deno test -A --config supabase/functions/deno.json <path>`; "runner CI" means
`deno test … scripts/bulk-runner`, `deno lint --config supabase/functions/deno.json scripts/bulk-runner` and
`deno fmt --check --config supabase/functions/deno.json scripts/bulk-runner`, as CI runs them.

| # | Task | Size | Write scope | Verify | Needs | Stronger builder |
|---|---|---|---|---|---|---|
| T0 | Counts on the v1.1 entry | S | this spec | done 2026-11-12 (above); the open counts move to T5 and T6 | — | — |
| T1 | Core: `listingRows`, `--service`, `reports`, `suggestedKeys` built 2026-11-12 | S | `screen_types.ts`, `screen.ts`, `screen_test.ts`, `live.ts`, `live_test.ts` | runner CI; a zero-row identity passes only under `none`; a report never adds a hold | — | no |
| T2 | Admission: migration, fixture, shared adapter built 2026-11-12 | M | one new migration; `supabase/tests/national_search_only.sql`; `supabase/tests/run.sh` (its `chain()` entry and include); `supabase/functions/_shared/suppliedText.ts`, `suppliedText_test.ts` | `deno test … supabase/functions`; `npm run test:sql` (vacuity ok); `npm test`; `npm run lint`; `npm run build`; byte-identical existing payloads | interface fixed here (adapter name, reasons, `completeness_basis` values, host list) | **yes** |
| T3 | Screen, configuration, date drop built 2026-11-12 | M | `screens/search_only.ts`, `screens/search_only_test.ts`, `screens/regulatory.json`, `screens/index.ts`, `screens/bills.ts` (exports and `makeLength` only), `prepare.ts`, `prepare_test.ts`, `cli.ts`, `run.ts` (the date count only) | runner CI; Bills tests unchanged; each hold shown failing first | T1 | no |
| TA | Attribution in citations (owner gate O2): carry the document's regulator and source into text citations and show them | M | its own spec first (citations, the answer path and `src/ai`) | its own | O2 | no |
| R | Independent review of T1-T3 | — | none | notes | T1-T3 | — |
| T5 | Screen v1.1 offline, then live read-only with the page check; plan; count the open items (live holds, title-date matches with the 474, page separator) | S | this spec | screen receipt; plan output | R, A1 | no |
| T6 | Rehearsal on the load copy | M | `scripts/load-proof/regulatory-proof.ts`, any setup script under `scripts/load-proof/`; this spec | proof exit code and counts; the `--break` run fails | T2, T5, A2 | yes |
| T7 | NTER: function diff, deploy, dry run, apply | S | a `docs/operations/` record | dry-run checks; versions read back | T6, A3, O1, O2, O3 | supervisor |
| T8 | E0, policy, 100-document file, E1, files of 500, E2, spot-check | S | the same record | `cli.ts status`; acceptance reports; eval reports | T7, A4-A7 | supervisor |
| T9 | Cold measurement; worker settings back; tracker | S | the same record; `docs/plans/open-work.md` (F307, F275) | measurement output | T8, A8, A9 | supervisor |

T2 may run beside T1 and T3 (disjoint files; interface fixed here). `screens/bills.ts` is also touched by the
shared-key title rule (F314) and the questions screen: those land one after another, not concurrently. Everything
else is sequential.

## Approvals

**Owner** (gates before any live load):

| | Step |
|---|---|
| O1 | `govt_material_confirm_counsel` confirmed for serving: the class name asks for counsel's confirmation and no record shows it was given |
| O2 | Attribution shown in every citation (ADR 0014); TA built and accepted |
| O3 | A decision on regulatory orders that name individuals, from the receipt's PAN- and Aadhaar-shaped counts (no hold in v1) |
| O4 | (A request, not a gate) official URLs for TRAI and CCI documents in the next pack |

**Developer:**

| | Step |
|---|---|
| A0 | Search-only for all candidates; the holds in this spec; D1 to D3 |
| A1 | Read-only reads on NTER as the developer's login; PDF fetches from `rbidocs.rbi.org.in` (robots.txt obeyed); the hand check of 40 documents on the official sites (D1) |
| A2 | Changes to the local load copy (inventory, migrations, removing synthetic Regulatory rows) |
| A3 | The Edge Function deploy, with its listed diff, and the migration on NTER |
| A4 | The `national-regulatory` policy |
| A5 | Each NTER file, with its documents, chunks and cost |
| A6 | The NTER evaluation runs (E0, E1, E2, optional Bills) and the spot-check |
| A7 | Taking batches out of search by clearing `indexed_at` after a drop |
| A8 | Worker settings kept at 8/16 for the load, and reverted to 1/2 after |
| A9 | The cold measurement |
| A10 | Linking the 121 (option B), per F275 |

## Scope

May change: `scripts/bulk-runner/screen_types.ts`, `screen.ts`, `screen_test.ts`, `live.ts`, `live_test.ts`,
`screens/search_only.ts`, its test, `screens/regulatory.json`, `screens/index.ts`, `screens/bills.ts` (exports and
`makeLength`), `prepare.ts`, `prepare_test.ts`, `cli.ts` and `run.ts` (the date count), `scripts/load-proof/regulatory-proof.ts`
and its setup script, one new migration, `supabase/tests/national_search_only.sql`, `supabase/tests/run.sh`,
`supabase/functions/_shared/suppliedText.ts` and its test, this spec, `docs/plans/open-work.md` (F307, F275), one
`docs/operations/` record. TA has its own spec and scope.

## Exclusions

- v1.3 to v1.6 Regulatory entries (a second load; the replacement and suggested-key checks keep room for them).
- The RBI text fixes and any replacement of live text (F275).
- Long documents over 600,000 characters or 700 chunks (F311); OCR records and re-OCR from official files (F281).
- Linking the 121; the listing, the catalogue, the spellings; a Regulatory branch in `document_date_facet`.
- Near-duplicates; deriving official URLs from file names; the other v1.1 collections.
- Repairing the 474 live documents, whose OCR may be truncated (`docs/research/2026-11-01-f281-triage.md:375-392`).

## Risks

| Risk | Mitigation |
|---|---|
| Search quality falls as the partition grows: on the F287 synthetic growth, feature-mode Doc@10 fell from 54/60 to 35/59 (`eval/ingestion/results/e4/2026-11-06T03-20-22-067Z-e4-base-1.md:56`, `…05-24-06-875Z-e4-grown-1.md:56`; synthetic text, 42% duplicate) | E0 to E2 with a stop rule and A7 |
| The first batch moves Regulatory to the vector index (15,000) | E1 straight after it |
| Text-layer TRAI and CCI documents truncated or wrong, with no URL to check | D1's hand check of 40; density; E1 |
| Readers get no source link for 2,583 documents | O4; TA shows at least the regulator and source |
| A failed job after its requeue blocks its batch for good (F326); the failure rate forgets requeued failures (F327) | files of about 500; watch each file |
| One failed embedding call fails its innocent documents (F301) | `min_decided` 400; F301's fix if it lands (then in the deploy diff) |
| The Edge Function change alters other payloads | byte-identity tests; deploy before the migration |
| `limits.partitioned` mistyped: the runner trusts it | the hand check before T8 |
| Cold search over 2.5 s after the load | T9 |

## Conflicts found

1. **"Admitted search-only, as today."** Neither the supplied-text nor the batch path admits Regulatory (see
   "Admission"); the 474 were stored by the first corpus pass. The admin PDF upload does accept the desk.
2. **The screen core cannot screen this desk** as written (`screen.ts:723-734`, `live.ts:132-133`).
3. **The reader drops replacements only by `v16_replaces`** (`pack.ts:458`); check 2 holds the others.
4. **The partition guard** is skipped for a listed feature (`plan.ts:128`), and the list is not checked (`cli.ts:135`).
5. **Bills checks that cannot be reused as they are:** `already_live` (`bills.ts:376`), the page check's `no_pdf_url`
   (`page_check.ts:548`), `length`'s 200 (`bills.ts:32`).
6. **A Bills-style linked branch would link nothing** (`bills_adapter.sql:312`).
7. **Review point: "an index on `document_key_suggested` already exists."** It does, but it is partial to Parliamentary
   Questions (`20261106120000_admission_scans.sql:50-51`), so it does not serve Regulatory; T2 adds one.
8. **Review point: "a strict contiguity rule would flag 2,356 records."** The reused rule is not strict: it already
   requires each page to start one character after the previous one ends (`bills.ts:234`), but that character must be a
   form feed (`:235`). Which character separates the pack's pages is not counted; if not a form feed, `text_binds`
   takes a separator parameter.
9. **Corrected from revision 1:** F308 is on `main` (`cli.ts:181`); CI runs the runner's tests, lint and fmt
   (`ci.yml:46-50`); the 22 long records hold at least 36.1 million characters (21 × 600,000 + 23,523,519), not 13.2
   million; the host rule is a configured list, since `file_url`'s host equals `source_host` on 43 of 121.

## Build notes (2026-11-12)

T1, T2 and T3 are built and independently reviewed (each: accept with changes, applied). Where the build or a review corrects this spec, this section wins.

### Admission (T2)

- Migration `20261113090000_national_search_only`, `_shared/suppliedText.ts`. The five functions are their current bodies (all from `20261107120000_bills_adapter.sql`) plus insertions only.
- New refusal reason `suggested_key_invalid`: a present `document_key_suggested` must be a JSON string, non-blank after trimming, and at most 500 UTF-8 bytes. An absent or null key is allowed.
- A `file_url` longer than 2,000 UTF-8 bytes is refused `file_url_invalid`. Without these limits one over-long value failed at insert and aborted the whole batch call.
- Order of the search-only refusals: completeness basis, URL rule, suggested-key shape, URL held, key held, then duplicate text.
- Both partial indexes are unique (`documents_search_only_file_url`, `documents_search_only_key_suggested`); they are the backstop behind the lookups and the advisory locks. None of the 474 live documents carries a suggested key.
- The URL rule is `bill_admission_key`'s full rule (https, a listed host, no control character or backslash, no encoded slash or backslash, no `.` or `..` segment), the same in SQL and in the adapter.
- The fixture includes `ingest_bills_admission_rules.sql` (which includes the Bills adapter and batch fixtures), with the one expectation at `ingest_register_batch.sql:304` rewritten on purpose. It adds 8 seconds to the SQL job.
- Not automated: a Down check in `run.sh` and a two-session race test. Both were run once by hand (the schema after the Down block equals the schema before the migration; a second session admitting the same key or URL waits and is refused).
- Known and not closed here: a re-extracted copy of one of the 474 first-pass documents, under a new source key and with different text, is admitted; they have no suggested key and almost no URL. T5 counts regulator, title and date matches against them before any load.

### Screen (T3, with the T1 core)

- New hold codes: `suggested_key_invalid` (as admission); `official_pdf_no_text` (an official PDF with no text layer never earns `page_check`; the record is held); `page_check_error` (a failure of the whole page check holds only the records that needed it); `field_invalid` also for text that is not well-formed UTF-16.
- Completeness basis: `page_check` only for a record whose `file_url` matches the PDF rule and whose official file has a text layer and passes; `density_only` only when the text-binding, length, density and extraction checks each ran and passed on that record; otherwise the record is held. Nothing is granted by default.
- The suggested-key prefix is `reg:`.
- The PDF rule is `^https://rbidocs\.rbi\.org\.in/[^?#]+\.pdf$`. A configuration must anchor its rule at both ends, name a host that is in `url_hosts`, and keep `max_chars` at or under 600,000.
- `citation_required` is kind, regulator, regulator_name, title and source. The date is not required (1,035 of 3,319 records have one).
- Replacement hold: `delta_patch` or `replaces_text` present, or `v16_replaces` with any value other than false, null or absent.
- `link_shape`: at most one link, its feature in the listing spelling, its `row_key` a string.
- Collection file settings (`screen.settings`): `minCharsPerPage`, `minPagesForDensity`, `requirePageCount`; a missing one holds every record. The collection file also sets `prepare.dropInvalidCitationDates: true`.
- `rulesFiles` for this screen has 11 entries, adding `prepare.ts`, `_shared/suppliedText.ts` and `_shared/textNormalise.ts`. The Bills screen's list has the same gap and is unchanged (recorded in open work).
- Core additions beyond T1's list: `Screen.holdKeys` (this screen prints a hold's `source_key` only when it is 40 hex characters); a report receives the record's outcome and may carry a fixed note, and the receipt gains `report_notes` and `reports_cover`; an exception while projecting a record holds that record (`project_failed`) and no longer stops the run.
- The identifier scan reports counts only, per source host, separately for screened and held records. A 12-digit match counts as Aadhaar-shaped only when it passes the Verhoeff checksum and is not three year-like groups; the excluded matches are counted apart. On v1.1 the unfiltered pattern matched 181 strings in 52 records, of which 111 were runs of years and 18 passed the checksum (about what chance gives); PAN-shaped matches: 0. The receipt carries the note "strings shaped like identifiers; unverified upper bound; not evidence of personal data".
- Page separator, counted on v1.1: all 82,024 page gaps in the 2,356 multi-page records are one form feed, so the Bills text-binding check is reused unchanged.
- Offline run on v1.1 (live reads and page fetches off; counts only): 2,693 records with no offline finding (76 with an official PDF URL, 2,617 for the density-only basis); holds: OCR 506, duplicate text 96, page split 31, too long 22, below density 4, too short 1. The 2,697 in the funnel above did not apply the density floor.
- Still to add: the screen must hold a record whose publisher cannot be resolved (`publisher_unresolved`), using the resolver of the citation-attribution work (F332), once that is merged.

## Open questions (developer)

**Decided 2026-11-12 (developer, taking the recommendations):** D1 option (ii), the density-only basis with the hand
check of 40 before any load; D2 search-only for the 121; D3 refuse a live suggested key; D4 hold the OCR records; D5
hold the long and short records; D6 `maxChunks` 700; D7 the generic screen. D8 stays open until T5. The build of T1,
T2 and T3 may start; the owner's gates (O1 to O3) and every NTER step keep their own approvals.

- **D1 (the largest).** 2,583 of the 2,697 candidates have no `file_url`; 43 more have an HTML or ASPX one. Their text
  cannot be checked against an official file. (i) Hold them until the owner's pack supplies URLs: the first load is at
  most 114, of which only the 78 RBI PDFs can be page-checked. (ii) Approve the named density-only basis for text-layer
  extractions, stored as `metadata.completeness_basis`, after a hand check of a stratified sample (20 TRAI, 20 CCI)
  against the official sites: title, date, first and last page. **Recommended: (ii)**, and ask the owner for URLs (O4)
  either way. The 43 HTML/ASPX records get the density-only basis under (ii) and keep their URL as the source link.
- **D2.** Search-only for the 121 linked records? Recommended: yes; link later (option B).
- **D3.** Refuse a record whose suggested key is already live (`suggested_key_held`)? Recommended: yes, for search-only
  desks; it guards later packs (v1.4 SEBI repeats keys).
- **D4.** OCR records (506): recommended hold (`extraction_not_allowed`); the pack's Regulatory OCR is known to be
  truncated.
- **D5.** The 22 long and the 1 short: recommended hold; the 22 join F311.
- **D6.** `maxChunks` 700 or 800: recommended 700.
- **D7.** Generic screen with Regulatory as configuration: recommended yes; add collections only after their profile.
- **D8.** Which collection follows: recommended, decide after T5.

## How the counts were obtained

- T0 counts: the supervisor, on the cached v1.1 entry, 2026-11-12, counts only. NTER counts: profile, 2026-11-11.
- Code: read at `origin/main` `c8c03eb9`; the open F291 PR was not read.
- Inferred, not executed: the zero listing-row count under the space spelling; vectors staying in the index after
  `indexed_at` is cleared; what readers show for a document with no URL; the per-batch chunk estimate.
