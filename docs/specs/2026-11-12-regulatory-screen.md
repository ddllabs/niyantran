# Screening and loading Regulatory v1.1, search-only (F307)

> **Status: Living (draft for the developer, 2026-11-12).** Not approved. It applies the screening stage
> ([spec](2026-11-10-screening-stage.md)) to the Regulatory entry of National v1.1, and specifies the admission path,
> policy and load. Plan: `docs/plans/2026-11-11-national-ingestion-next.md` (on `task/ingestion-hardening`), Phase 1
> tasks 2 to 7. Scope: [ADR 0014](../decisions/0014-national-v1.1-ingestion-scope.md). Related: [PQ screen](2026-11-11-pq-screen.md),
> [runner and acceptance](2026-11-08-runner-cli-and-acceptance.md), [Bills load](../operations/2026-11-10-bills-load.md).
> Open work: F307, F275, F278, F285, F311, F272.

Evidence labels: **read** = read in the code or document cited at this checkout (`main` at `c43ecfe3`); **inferred** =
concluded from what was read, not executed or counted; **profile, 2026-11-11** = the supervisor's counts of the v1.1
entry and of NTER (read-only), taken as given. Nothing in this spec was executed.

## Summary

- v1.1 `documents/regulatory.jsonl.gz` has 3,319 records. **No path admits a Regulatory document today** (read): the
  batch admission has no adapter for the desk, the policy function refuses the desk, and the shared supplied-text
  adapter refuses the feature. The 474 live documents came from the first corpus pass (2026-09-21), outside this path.
  So one migration and one Edge Function change are unavoidable (below, "Admission").
- Identity is the pack `source_key`. `document_key_suggested` is checked unique and stored; `file_url` exists for 121
  records only and is checked where present. Every record, the 121 linked ones included, loads **search-only**: no
  listing link is written. Linking the 121 is a later, separate step (F275's regulatory listing decision).
- One small, parameterised search-only screen (`screens/search_only.ts`) with Regulatory as its only registered
  configuration. It reuses seven Bills checks as they are (exported, nothing else changed) and adds six of its own.
- Held in the first load: the 22 over 600,000 characters and the 1 under 300 (F311), the 31 whose `page_split` the
  adapter refuses, OCR records (the pack's Regulatory OCR is known to be truncated, F281), anything already live.
- The 220,000-chunk estimate includes the 22 long records, which hold at least 13.2 million of the 174.7 million
  characters (inferred). The loadable set is smaller; the plan's count after screening is the figure the policy uses.

## Current state

### A record in the pack (profile, 2026-11-11)

| Field | v1.1 |
|---|---|
| `schema` | `nter.citation_pack/1.1` (all) |
| `source_key` | distinct on all 3,319 |
| `desk_tier` / `desk_feature` / `desk_rows_feature` | `national` / `Regulatory Body Watch (RBI SEBI TRAI CCI)` / `Regulatory Body Watch (RBI/SEBI/TRAI/CCI)` (the two spellings differ) |
| `doc_type` | `regulatory` (all) |
| `document_key_suggested` | present and distinct on all; prefix `reg` |
| `file_url` | 121 distinct values over the 3,319 |
| `links` | none on 3,198; one on 121 (role `primary_document`, a `row_key`, a `document_key` with prefix `reg`) |
| `citation` | `kind`, `regulator`, `regulator_name`, `title`, `date`, `source` on all; `action_type`, `detail_url` on 121 |
| `source_host` | trai.gov.in 1,837; cci.gov.in 1,361; rbi.org.in 96; sebi.gov.in 25 |
| `licence_class` / `servable` | `govt_material_confirm_counsel` (all) / absent (all) |
| `page_count`, `page_split` | `page_count` on all; `exact` 2,782, `none` 506, `approximate` 13, `last_page_empty` 11, `unsplit_multipage` 7 |
| `extraction` | `pdf_text` 2,813, `ocr` 506 |
| `n_chars` | sum 174,673,428; min 84; median 12,647; max 23,523,519; under 300: 1; over 600,000: 22 |

What identifies a document, and what could not be determined:

- **Inferred, to count in T0:** rbi.org.in 96 + sebi.gov.in 25 = 121 = the linked records and the distinct `file_url`
  count, and trai.gov.in 1,837 + cci.gov.in 1,361 = 3,198 = the unlinked records. So the likely shape is: RBI and SEBI
  records carry a `file_url` and a link each; TRAI and CCI records carry neither. Not determined: whether the 3,198 have
  `file_url` null or share values; whether the 121 URLs are PDFs or HTML pages; whether `file_url`'s host equals
  `source_host`.
- **Inferred, to count in T0:** the 506 `none` splits are the 506 OCR records (as in the PQ entry, where 82 = 82), and
  the first corpus pass loaded 506 Regulatory documents (`docs/plans/2026-09-21-corpus-ingest-first-pass.md:137`), so the
  474 live are probably most of the OCR records. Not determined: how many of the 474 are in v1.1 rather than v1.4
  (the 49,211 profiled keys are v1.1's 3,319 plus v1.4's 45,892).
- Not determined: duplicate texts within v1.1; whether `none` records carry page spans; `ocr_quality` values; titles
  over 300 characters; string fields over 4,000 characters; the encoded byte size of the records file.

### On NTER (profile, 2026-11-11, read-only)

474 Regulatory documents, all created 2026-09-21, 472 with no `file_url`, every `source_key` among the profiled keys;
12,983 chunks in `document_chunks_regulatory`; the Regulatory listing has 121 rows, none with a `document_key`; no
`record_document_links` row for a Regulatory document. Documents are stored under the space spelling (open-work line
2076, read; `src/lib/evalSet.js:10`, read); the desk catalogue has only the slash spelling
(`supabase/functions/_shared/deskCatalog.json:158`, read).

### Partition (read)

`document_chunks_regulatory` is a partition for `'Regulatory Body Watch (RBI SEBI TRAI CCI)'`, with RLS on and no
privileges (`20261101120000_document_chunks_partitioned.sql:356-357`, `:529`). Chunks take the document's feature,
so a document stored under the space spelling lands there (inferred from the header, lines 18-22).

### Runner (read)

- `plan.ts:127-136`: a feature listed in `limits.partitioned` skips the 100,000-chunk guard entirely; only the
  collection's `chunkCeiling` (152-157), budget (149-151) and disk stop line (174-177) bound it. The list comes from
  the collection file (`cli.ts:134` checks only that it is an array); nothing reads the database's partitions.
- `prepare.ts:192-194` holds text over 600,000 characters `over_chunk_limit`; `198-203` holds a dense run of control
  codes `control_codes_excess`; `204` strips the rest; `266-272` turns any refusal of `prepareSuppliedText` into
  `prepare_failed`; `274` applies `maxChunks`; `296` plans by `desk_feature`.
- `pack.ts:456-458`: the reader drops `servable === false`, `BARRED_` licence classes and `v16_replaces === true`.
- `acceptance.ts:179-182`: with `requireLinks` false, a document with no listing link is not failed; `186-195` then
  checks only the links it has (none), and `196-197` runs the stored-vector probe.

## Admission: what admits these today (read)

| Gate | Where | Regulatory record |
|---|---|---|
| `prepareSuppliedText` desk check | `suppliedText.ts:100-106` | refused `unsupported desk feature`: the space spelling is not in `DESK_CATALOG`, and `deskOk` admits only Law, Bills and Questions |
| non-bill National branch | `suppliedText.ts:120-126` | would require a Lok Sabha answer URL |
| `page_split` | `suppliedText.ts:128-130` | refused unless `exact` or `none` |
| `ingest_admit_tier` | `20261107120000_bills_adapter.sql:97-107` | null (Questions with an answer URL, Bills, Law only) |
| `ingest_admit_shape` | `20261102130000_batch_registration.sql:346` | `invalid_source_or_text_hash` when the tier is null |
| `ingest_admit_adapter` | `bills_adapter.sql:109-116` | null, so `ingest_register_batch` refuses `no_adapter` (`:414-417`) |
| `ingest_policy_approve` | `batch_registration.sql:668-672` | refuses the desk: its `adapter` must equal `ingest_admit_adapter(desk)` |

The worker re-prepares every stored payload with `prepareSuppliedText` before paying for embeddings
(`ingest-worker/supplied-step.ts:38`), so the Edge Function change must be deployed before any Regulatory batch.

**No adapter admits a national document without a listing row or record key.** Lok Sabha answers need a row carrying
the URL (`bills_adapter.sql:238`, `no_desk_row`); Bills need listing rows by key (`:268`). A search-only adapter must
be added.

### Policy gates every adapter gets (read, `bills_adapter.sql:145-182`)

Licence class in the policy's list and not personal data; `servable` not false; each `required_checks` entry true in
the review (only `title_guard` and `bill_identity` may be named, `batch_registration.sql:672`); `n_chars` equal to the
text's length; `n_pages` and `page_count` equal to the page spans; no control code; with no spans, `no_page_count` if
the policy requires one; with at least `min_pages_for_density` spans, `thin_text` below `min_chars_per_page`. Then
duplicate text against any document (`:276-286`).

### The migration (T2): `national_search_only`

One migration, every function `create or replace` from its current body (`20261107120000_bills_adapter.sql`) with one
added branch, so grants stay and the rollback is to re-run those bodies:

| Object | Change |
|---|---|
| `ingest_admit_tier` | `'national'` for a 40-hex `source_key` on `national` / `Regulatory Body Watch (RBI SEBI TRAI CCI)` |
| `ingest_admit_adapter` | `'national_search_only'` for that desk (one `in (...)` list, so a later desk is one line) |
| `ingest_admit_document` | branch for the adapter: when `file_url` is not null and a document of the same feature holds it, `file_url_held`; nothing else, and **no link insert** (the link block, lines 302-318, stays limited to the two linked adapters) |
| `ingest_register_batch` | lock value for the adapter: `coalesce(file_url, source_key)`, as Bills (`:429-431`) |
| `ingest_register_text_unmapped` | refuses the adapter, as it refuses Bills (`:333-335`): search-only desks enter through a sealed batch |
| index | `unique (file_url) where desk_tier = 'national' and desk_feature = <regulatory> and file_url is not null`, as `documents_bill_file_url` (`:44-45`); the dry run proves the 2 live URLs do not collide |

`ingest_policy_approve` needs no change: it accepts the desk once the adapter function returns its name.

Shared adapter (`supabase/functions/_shared/suppliedText.ts`, same task): a `NATIONAL_SEARCH_ONLY` list holding the
one desk; `deskOk` admits it without the catalogue lookup (its stored spelling is not the catalogue's); the
question-URL branch applies to the question desk only; nothing else changes. Every existing question, bill and Law
fixture must prepare byte-identically (the worker compares stored payloads, `supplied-step.ts:41-47`).

### What search-only means

The document is stored, chunked into the Regulatory partition and found by search in its feature; no
`record_document_links` row is written, so no listing row shows it (the same as the 474 today). For the 121 linked
records:

| Option | What it needs | Recommendation |
|---|---|---|
| A. Search-only like the rest | nothing more | **yes, for the first load** |
| B. Search-only now, link later with `record_mapping_apply` (`20261027185747_record_document_associations.sql:34`) | the pack's `row_key`s matched to NTER's 121 rows; a reviewed mapping; the owner's or developer's listing decision (F275). Not traced in this spec | the follow-up |
| C. Linked at admission | an adapter branch that finds rows by `row_key` and checks their fields; it must use the listing spelling, because the Bills link insert matches `q.feature = r->>'desk_feature'` (`:312`), which no Regulatory row has; the listing rows' fields are not yet read | no: a larger migration for 121 documents |

## The screen

### One generic search-only screen, one configuration

`screens/search_only.ts` exports `makeSearchOnlyScreen(config, extra)`; `screens/index.ts` registers
`national-regulatory` with this configuration: desk `national` / the space spelling, listing spelling the slash
spelling, `doc_type` `regulatory`, hosts `trai.gov.in`, `cci.gov.in`, `rbi.org.in`, `sebi.gov.in`, characters 300 to
600,000, the page check's URL rule (rbi.org.in and sebi.gov.in, after T0 shows their URLs' form).

The other v1.1 collections (budget, cabinet, industry, transfer orders, bill corrigenda, MP profiles) are **not**
registered: none is profiled, MP profiles and transfer orders carry personal data the owner must see first (ADR 0014;
plan, Phase 4), and bill corrigenda belong to Bills (their mapping, `prepare.ts:221-248`). Each later collection is a
configuration, a test file and one line in the adapter's desk list, once its profile shows it fits.

### Checks, in order, with hold codes

The screen core's own holds run first (read, `screen.ts:320-344`): `no_source_key`, `duplicate_source_key`, `no_text`,
`text_not_well_formed`, `content_sha256_mismatch`, `record_has_review`; `--no-live` and `--no-pages` hold everything
`screen_incomplete` (`:352-362`). Then:

| # | Check | Covers | Rule | Holds | Bills check |
|---|---|---|---|---|---|
| 1 | `record_shape` | identity | schema `nter.citation_pack/1.`; 40-hex `source_key`; tier, `desk_feature`, `desk_rows_feature` and `doc_type` as configured; `document_key_suggested` a string with the `reg` prefix (exact form from T0) | `bad_shape` | new (Bills' fixes its desk, `bills.ts:132-141`) |
| 2 | `not_a_replacement` | identity | none of `delta_patch`, `replaces_text`, `v16_replaces` present (v1.4's RBI text fixes pass the reader, `pack.ts:458`) | `replacement_not_supported` | new |
| 3 | `source_fields` | identity | `title` 1 to 300 characters (`suppliedText.ts:93`; `batch_registration.sql:346`); `citation` has non-empty `kind`, `regulator`, `regulator_name`, `title`, `date`, `source`; every field the adapter copies at most 4,000 characters (`suppliedText.ts:232-256`); `source_host` configured; `file_url`, when present, https, no credentials, host equal to `source_host` (or its `www.` form; T0), no dot segment (`billUrlSegmentsOk`) | `title_invalid`, `citation_incomplete`, `field_too_long`, `unknown_host`, `not_official_url` | new |
| 4 | `links_shape` | identity | no links, or exactly one: tier `national`, feature the listing spelling, role `primary_document`, non-empty `row_key`, `document_key` equal to `document_key_suggested`. Read so the 121 can be linked later; never written | `link_disagrees` | new |
| 5 | `text_binds` | completeness | hash, `n_chars`, `page_split` `exact` or `none`, contiguous form-feed spans from page 1, `page_count`; `none` passes only with `page_count` equal to its spans | `text_hash_mismatch`, `n_chars_mismatch`, `page_split` (the 31), `page_spans`, `page_count_unsplittable` | reused (`bills.ts:202-244`) |
| 6 | `length` | completeness | 300 to 600,000 UTF-16 units, as `prepare.ts` counts | `too_short` (the 1), `too_long` (the 22) | parameterised (`bills.ts:246-252` fixes 200) |
| 7 | `density` | completeness | admission's gates, with the policy's numbers in `settings`: spans at least `min_pages_for_density` and characters per span below `min_chars_per_page`; no spans under `require_page_count` | `thin_text`, `no_page_count` | new (mirrors `bills_adapter.sql:173-181`) |
| 8 | `extraction` | completeness | `extraction` is `pdf_text` | `ocr_unverified` (detail: the value) | new |
| 9 | `servable_licence` | sensitivity | `servable` absent or true; licence not `BARRED_`, not personal data | `not_servable`, `servable_malformed`, `licence_barred`, `personal_data` | reused (`bills.ts:254-266`) |
| 10 | `licence_admitted` | rights | `settings.licenceClasses` = `['govt_material_confirm_counsel']` | `licence_not_admitted` | reused (`bills.ts:268-274`) |
| 11 | `already_live` (live) | dedupe | `source_key` held by any document; or `file_url`, when present, held by a document of the feature | `already_live` | new: Bills' holds every record without a `file_url` (`bills.ts:376`) |
| 12 | `suggested_key_collision` (set) | dedupe | records sharing `document_key_suggested`: all held, none picked | `suggested_key_collision` | reused builder (`collisionCheck`, `bills.ts:421-443`) |
| 13 | `file_url_collision` (set) | dedupe | records sharing a non-null `file_url`: all held | `file_url_collision` | reused (`bills.ts:456-460`) |
| 14 | `duplicate_text` (set) | dedupe | the hash `prepare.ts` will store; the lowest `source_key` stays | `duplicate_text` | reused (`bills.ts:463-485`) |
| 15 | `duplicate_text_live` (live) | dedupe | another document already holds that hash (admission's `duplicate_text`) | `duplicate_text_live` | reused (`bills.ts:489-518`) |
| 16 | `text_per_page` (pages, `onlyIfClean`) | completeness | `page_check.ts` with the configured `urlRule` (`page_check.ts:71`) | its reasons (`page_count_mismatch`, `thin_page`, `thin_text`, `unverified_empty_pages`, `pdf_unavailable`, `pdf_unreadable`) | reused; records without a `file_url`: question 3 |

Control codes are not a screen check: `prepare.ts` strips them and holds a dense run (`control_codes_excess`) before
admission's own refusal can fire; duplicate checks already compare the stripped text (`bills.ts:46-56`).

Reuse needs only `export` added to the seven Bills checks and `collisionCheck` (none is exported today; only
`billNorm` and `makeBillsScreen` are, `bills.ts:74`, `:554`); the Bills tests must pass unchanged. `length` becomes
`makeLength(min, max)`, with Bills' call keeping 200 and 600,000.

`project` adds nothing: the adapter reads no field the pack lacks. The review is written only from checks that ran,
per screening-stage decision 5; `mapping_version` `regulatory-screen-v1`; `rules_sha256` over `screens/search_only.ts`
and the core files Bills lists.

### Core change: a screen without listing rows (T1)

The core refuses to screen Regulatory as written (read): it asks `identity` for documents **and listing rows** of the
records' `desk_feature` (`screen.ts:718-719`, `live.ts:132-133`) and stops on a zero count (`screen.ts:724-729`).
Regulatory rows are stored under the slash spelling, so the count is 0 (inferred from the spellings). Change: `Screen`
gains `listingRows: 'required' | 'none'` (default `required`); with `none`, only a zero document count stops the run,
and the receipt says so. With it, `screen.ts` takes `--service <name>` (default `nter-accept`, today a constant,
`:618`) so the rehearsal reads a local copy; the PQ spec's T1 specifies the same option, and whichever lands first
carries it.

### Identity collisions (F314's lesson)

| Case | In v1.1 | Screen | Admission |
|---|---|---|---|
| Two records, one `source_key` | none (distinct) | core `duplicate_source_key` | unique `source_key` |
| Two records, one suggested key | none (distinct); v1.4 SEBI 15,437 keys for 16,693 records | `suggested_key_collision` | not checked |
| Two records, one `file_url` | not determined (T0) | `file_url_collision` | per-URL lock and the new unique index |
| A live document holds the key, URL or text | the 474 (by key) | `already_live`, `duplicate_text_live` | `existing` or `legacy_source`, `file_url_held`, `duplicate_text` |
| One text twice in the set | not determined (T0) | `duplicate_text` (lowest stays) | `duplicate_text` |

## Policy, collection file and worker settings

Interim rule: `min_decided` >= 2 x `claim_batch` / `failure_rate`. With `claim_batch` 8 and `failure_rate` 0.05 that is
320, so `min_decided` 400, as Bills (the Bills record does not give its other stop numbers; read, `2026-11-10-bills-load.md:22-24`).

| Setting | Value | Why |
|---|---|---|
| collection | `national-regulatory` | one policy per collection (ADR 0014, 4) |
| admitted | `[{desk_tier: national, desk_feature: <space spelling>, adapter: national_search_only}]`, no required checks | |
| licence classes | `['govt_material_confirm_counsel']` | ADR 0014, 6 (question 6) |
| `min_chars_per_page`, `min_pages_for_density` | 600, 5 | the F281 thin-OCR line (`docs/research/2026-11-02-batch-registration-design.md`, section 6) |
| `require_page_count` | true | every passing record has spans (check 5) |
| `budget_usd` | 5 | estimate about US$1.10 at the Bills rate, less after holds; v1.1 ceiling US$100 (ADR 0014, 3) |
| `chunk_ceiling` | the screened plan's chunks plus 10%, at most 250,000 | set from T5's plan |
| stop thresholds | `refusal_share` 0.05, `failure_rate` 0.05, `uncertain_max` 5, `min_decided` 400 | interim rule; every admission refusal is pre-checked, so refusals should be 0 |
| `prepare.maxChunks` | 700 | the largest measured on Bills; 700 to 800 is held `over_chunk_limit` for F311 |
| `limits.partitioned` | includes the space spelling | checked by hand against `pg_inherits` before the run (the runner does not) |
| `limits.diskStopBytes` | 34 GB on the 40 GB disk | Bills' line; projected use about 18 GB + under 3.1 GB |
| `acceptance` | `{sample: 50, requireLinks: false}` | search-only |
| `screen.settings` | licence classes, the two density numbers (equal to the policy's) | |

`min_decided` 400 means the stop rules cannot fire inside the 100-document validation batch; that batch is judged by
hand: 0 refused, 0 failed, acceptance passed. Worker settings: keep `claim_batch` 8 and `max_running` 16, as for Bills
(still set), during the load; return them to 1 and 2 after it, and record both changes.

## Acceptance

- **Automated** (`acceptance.ts`, unchanged): 50 a batch, every one passing: stored, indexed, text hash, chunk count,
  vectors, stored-vector probe first. No link check (`requireLinks` false). F313 applies: Regulatory orders share
  boilerplate headings, so a `probe_not_first` is read before it is called a defect.
- **Retrieval spot-check** after the last batch, as the developer's login: ten loaded documents (TRAI, CCI, RBI, SEBI;
  short and long; one per `kind`), each searched in the Regulatory desk with a question written from its title; each
  must be in the top 10. Then the existing Regulatory evaluation set (60 questions, `src/lib/evalSet.js:10`; feature
  mode Doc@10 54/60 on 2026-11-01, `docs/research/2026-11-01-retrieval-baseline-v2.md:65`) is re-run; a drop of more
  than 3 is reported to the developer before more Regulatory loads.

## Rehearsal, then NTER

1. **Rehearsal (T6), on a disposable copy of the load copy:** apply the T2 migration; approve the policy; screen
   against the copy (`--service`), plan, run 100 screened records with the load-proof harness's fake embedder, then
   automated acceptance. Pass: every screened record admitted, 0 refusals, chunks in `document_chunks_regulatory`, no
   link row written, Bills and question registration unchanged (their existing fixtures). A `--break` that edits one
   screened record so admission refuses it must fail the proof.
2. **NTER (T7):** deploy `ingest-worker` and `admin-ingest` from the merge commit; pause cron job 4; dry-run the
   migration with its commit replaced by a rollback and checks inside (a Regulatory record admitted with no link; a
   question and a bill admitted as before; a Regulatory record by the single-document path refused); apply with its
   history row; resume; `analyze public.documents`.
3. **Load (T8):** `ingest_policy_approve`; a 100-document file (`cli.ts split`), run with automated acceptance; then
   the rest. Each step on the developer's yes. A screened file over 256 MiB is split (F308, merged on
   `task/ingestion-hardening`, `49814d75`, not yet on `main`).
4. **Cold measurement (T9), straight after the load:** the hybrid plan's cold run (T9 there), with Regulatory's
   partition now grown; keep-warm covers NCLT only (F324). The developer decides hybrid from it.

## Tasks

| # | Task | Size | Write scope | Verify | Needs | Stronger builder |
|---|---|---|---|---|---|---|
| T0 | Count what this spec could not determine (identity shape above), on the cached v1.1 entry and read-only NTER; record counts here | S | this spec; outputs in `~/niyantran-eval-cache/reg-next/` | receipts; counts reproducible | A1 | no |
| T1 | Core: `listingRows: 'none'` and `--service` | S | `screen_types.ts`, `screen.ts`, `screen_test.ts` | `deno test -A --config supabase/functions/deno.json scripts/bulk-runner/screen_test.ts`; a test with 0 listing rows passes only under `none` | — | no |
| T2 | Admission: migration `national_search_only` and the shared adapter | M | one new file under `supabase/migrations/`, a new fixture under `supabase/tests/`, `supabase/functions/_shared/suppliedText.ts`, `suppliedText_test.ts` | `deno test -A --config supabase/functions/deno.json supabase/functions`; `npm run test:sql` (the fixture fails without the migration); `npm test`; `npm run lint`; `npm run build` | interface fixed here (adapter name, desk list) | **yes** |
| T3 | The search-only screen and Regulatory configuration | M | `screens/search_only.ts`, `screens/search_only_test.ts`, `screens/index.ts`, `screens/bills.ts` (exports and `makeLength` only) | `deno test … scripts/bulk-runner/screens`; Bills tests unchanged; each new hold shown failing first | T1 | no |
| R | Independent review of T1 to T3 | — | none | review notes | T1-T3 | — |
| T5 | Screen v1.1 offline (`--no-live --no-pages`), then live read-only with the page check; `cli.ts plan` | S | this spec (counts by reason) | screen receipt; plan output | R, A1 | no |
| T6 | Rehearsal on a disposable copy | M | `scripts/load-proof/regulatory-proof.ts`; this spec | proof exit code and counts; the `--break` run fails | T2, T5, A2 | yes (it applies the migration) |
| T7 | NTER: deploy, dry run, apply | S | `docs/operations/` record | the dry run's checks; function versions read back | T6, A3 | supervisor |
| T8 | Policy, 100-document batch, the rest | S | the same record | `cli.ts status`; acceptance reports; spot-check | T7, A4, A5 | supervisor |
| T9 | Cold measurement; evaluation re-run; worker settings back | S | the same record; `docs/plans/open-work.md` (F307, F275 lines) | measurement output; eval report | T8 | supervisor |

T2 may run beside T1 and T3 (disjoint files; the adapter name is fixed here). Everything else is sequential. CI does
not run the runner's tests (F306): run and record them by hand.

## Approvals

| | Step | Who |
|---|---|---|
| A0 | Search-only for all 3,319, the holds in this spec, the licence class | developer (owner for the licence, if question 6 says so) |
| A1 | Read-only reads on NTER as the developer's login; PDF fetches from rbi.org.in and sebi.gov.in (robots.txt obeyed) | developer |
| A2 | A disposable copy of the load copy (disk) | developer |
| A3 | Edge Function deploy and the `national_search_only` migration on NTER | developer |
| A4 | The `national-regulatory` policy | developer |
| A5 | Each NTER load, with the plan's documents, chunks and cost | developer |
| A6 | Linking the 121 (option B) | developer, per F275 |

## Scope

May change: `scripts/bulk-runner/screen_types.ts`, `screen.ts`, `screen_test.ts`, `screens/search_only.ts`, its test,
`screens/index.ts`, `screens/bills.ts` (exports and `makeLength`), `scripts/load-proof/regulatory-proof.ts`, one new
migration and one new SQL fixture, `supabase/functions/_shared/suppliedText.ts` and its test, this spec,
`docs/plans/open-work.md` (F307 and F275 lines), one `docs/operations/` record.

## Exclusions

- v1.3, v1.4, v1.5 and v1.6 Regulatory entries (a second load; the design keeps room: the suggested-key collision, the
  replacement hold, HTML records with `page_count` null are held by checks 5 and 7 until a rule is agreed).
- The RBI text fixes (`delta_patch`, `replaces_text`) and any replacement of live text (F275).
- Long documents over 600,000 characters or 700 chunks (F311); OCR records and re-OCR from official files (F281's route).
- Linking the 121 listing rows; changing the listing, the desk catalogue or the feature spellings.
- Near-duplicate detection; deriving official URLs from file names; the other v1.1 collections.
- Repairing the 474 live documents, whose OCR may be truncated (F281 addendum).

## Risks

| Risk | Mitigation |
|---|---|
| Search quality falls as the partition grows: on the F287 synthetic growth to about 228,000 Regulatory chunks, feature-mode Doc@10 fell from 54/60 to 35/59 (`eval/ingestion/results/e4/…-e4-base-1.md:56`, `…-e4-grown-1.md:56`; synthetic text, 42% duplicate, F272) | the evaluation re-run after the load; stop further Regulatory loads on a drop |
| Cold search over 2.5 s after the load | T9 measurement; keep-warm extension is the developer's choice |
| The Edge Function change alters other payloads | byte-identity tests on existing fixtures; deploy before the migration, as Bills |
| `limits.partitioned` mistyped: the runner trusts it | the hand check against `pg_inherits` before T8 |
| Text-layer TRAI and CCI records truncated like the OCR ones, with no URL to check | the density pre-check; spot-check; question 3 |
| One failed embedding call fails its innocent documents (F301) | `min_decided` 400; requeue per batch |
| Attribution: v1.1 records carry no `attribution` field, and ADR 0014 requires attribution in every citation | question 6 |

## Conflicts found

1. **"Admitted search-only, as today."** No admission path exists today for Regulatory (see "Admission"); the 474
   were stored by the first corpus pass. "As today" holds for how they are served (no links), not for how they enter.
2. **The screen core cannot screen this desk.** It counts listing rows under `desk_feature` and stops at zero
   (`screen.ts:718-729`, `live.ts:132-133`); Regulatory rows use the other spelling.
3. **The reader drops replacements only by `v16_replaces`** (`pack.ts:458`). v1.4's RBI text fixes carry
   `delta_patch` and `replaces_text` and would pass the reader; check 2 holds them.
4. **The partition guard.** For a partitioned feature there is no chunk guard beyond the ceiling and budget
   (`plan.ts:128`), and the partition list is the collection file's word (`cli.ts:134`).
5. **The 256 MiB refusal is not on `main`.** It is on `task/ingestion-hardening` (`49814d75`, `MAX_RECORDS_BYTES` in its
   `cli.ts`); at `c43ecfe3` `plan` and `run` read any size.
6. **Bills checks that cannot be reused as they are:** `already_live` holds every record without a `file_url`
   (`bills.ts:376`), the page check holds every record without one `no_pdf_url` (`page_check.ts:548`), and `length`
   fixes 200 characters (`bills.ts:32`).

## Open questions

1. **Search-only for the 121 linked records too?** Recommended: yes (option A), and link them later (option B) under
   F275's listing decision, after reading NTER's 121 rows against the pack's `row_key`s.
2. **One generic screen or a Regulatory screen?** Recommended: the generic factory with Regulatory as its only
   configuration; add a collection only after its profile.
3. **Text per page for records without a `file_url`** (inferred: all TRAI and CCI, 3,198). Holding them would load
   only RBI and SEBI. Recommended: the page check runs on records with an official `file_url`; for the rest the screen
   records "no official PDF" as a named, counted rule in the receipt (`checks_stats`), approved by the developer as a
   rule, not a default; their completeness rests on checks 5 to 8. Alternative: hold them until official URLs are
   supplied by the owner.
4. **OCR records (506).** Recommended: hold `ocr_unverified`. The pack's Regulatory OCR is known to be truncated
   (`docs/research/2026-11-01-f281-triage.md:375-392`) and most are probably live already (T0 confirms).
5. **Long and short records.** Recommended: hold the 22 and the 1; the 22 join F311.
6. **Licence and attribution.** ADR 0014 decision 6 admits "regulatory" licence classes; the class here is
   `govt_material_confirm_counsel`. Recommended: the developer confirms it is covered (or asks the owner), and confirms
   that citations show `citation.source` and `source_host` as the attribution.
7. **`maxChunks` 700 or the adapter's 800.** Recommended: 700, the largest measured.
8. **Worker settings.** Recommended: keep 8 and 16 for the load, revert to 1 and 2 after.
9. **Which collection follows.** Recommended: decide after T5's counts; the plan's Phase 4 order stands.

## How the counts were obtained

- Pack and NTER counts: profile, 2026-11-11, as given to this spec's author; not re-measured.
- Code citations: read at `c43ecfe3` in this checkout, except the F308 limit (read on `origin/task/ingestion-hardening`).
- Inferred, not counted: the RBI/SEBI and TRAI/CCI split of URLs and links; OCR equal to `none`; the 474 as mostly OCR
  records; the zero listing-row count under the space spelling; the chunk estimate's long-record share.
