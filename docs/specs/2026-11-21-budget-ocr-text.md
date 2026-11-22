# OCR text for the 116 Budget records held as control codes (F391)

> **Status: Living (2026-11-21).** Extends [the five-desk search-only route](2026-11-19-five-desk-search-only-route.md);
> module `repairs` of [corpus and search completion](2026-11-20-corpus-and-search-completion.md). Nothing here is applied,
> deployed or enabled; every step below waits for the developer's named yes.

## Current state (read from the code and the screen's own files)

- 486 v1.1 Budget records were screened on 2026-11-20: 346 eligible (loaded), 140 held. 116 of the holds carry the one
  reason `control_codes_excess` (112 Budget documents, 4 Economic Survey); the other 24 holds are out of scope. The pack's
  extracted text uses control codes in place of spaces and digits (a font-mapping fault), so it cannot be searched or cited.
  The hold is right; the text must be extracted again.
- Their official PDFs are public: 361 pages in all, counted from the PDFs the page check had already cached (116 files, each
  the size the pack states). The offline plan over the real screen files agrees: 116 records, 361 pages, US$1.444 at the
  worker's rate (`OCR_USD_PER_1000_PAGES = 4`, `supabase/functions/ingest-worker/mistral.ts`).
- The five-desk route (`ingest_register_batch`) admits **supplied text only**: it takes the text, hashes it, applies the
  collection policy and the batch spend stops, and creates an `index` job. It never reaches the OCR stage and has no field
  for a PDF. The `pdf` route (`ingest_register`) needs the PDF in the `corpus` bucket, which would store, and let
  `document-file` serve, a file whose licence class (`govt_work_permission_required`) is under legal review.
- The Budget screen allows one text type, `pdf_text` (`scripts/bulk-runner/screens/budget.json`). The pack's one `ocr` record
  (tesseract; already live) is deliberately held as "text type not allowed" (`search_only_test.ts`, `budget_doc`).
- `ingest-worker/mistral.ts` already calls Mistral OCR with a URL as `document_url` and has no time limit of its own; its
  caller supplies the `fetch`. `_shared/embed.ts` bounds the embedding call (F397); the worker bounds the whole call.
- `public.ingest_search_only_desks()` (migration `20261123090000`) is the one list of which hosts each search-only desk's file
  links may name; the Budget desk's is `www.indiabudget.gov.in`, the same list as `url_hosts` in `budget.json`.
- The ingest worker is called by `pg_cron` through `pg_net` with a secret header (`x-ingest-secret`, compared in constant
  time, 401 when unset); `refresh-model-pricing` does the same with the secret in the vault.

## Decision (developer, 2026-11-21)

1. No PDF is stored or served.
2. No OCR, model or Supabase service key on the operator's laptop: the laptop has only its database login, `corpus_ingest`.
3. The new text is loaded through the **existing** five-desk supplied-text route, so the screen, the batch policy and the
   spend stops all apply.

The earlier plan (a `pdf` job through `ingest_register`, uploading the PDF with the service key) is not built: it stores the
PDF and needs a service key on the laptop.

## Design

```
laptop (corpus_ingest)                  Supabase                                         Mistral
 ocr-enqueue ──budget_ocr_enqueue──▶ private.budget_ocr_requests (queued)
                                       ▲ cron 'budget-ocr' every minute → private.budget_ocr_tick()
                                       │   (does nothing unless switched on) ──pg_net, secret header──▶ budget-ocr
                                       │                                    budget_ocr_claim (cap enforced here) ◀─┤
                                       │                                    document_url = official PDF ────────────▶ OCR
                                       └──budget_ocr_finish (cost computed here) ◀── page text ◀────────────────────┘
 ocr-collect ◀─budget_ocr_read─────── done rows (text only when done)
   writes ocr-records.jsonl + receipt  ──▶  screen  ──▶  run (existing five-desk route)
```

### 1. Migration `20261125100000_budget_ocr_queue.sql`

Creates, and changes nothing that exists:

- `private.budget_ocr_settings`, one row: `cap_usd` 2, `usd_per_1000_pages` 4, `enabled` **false**, `function_url` empty,
  `max_attempts` 3. Row level security on, no policy, no grant to anyone but the owner. The schema `private` is closed to
  `anon`, `authenticated`, `service_role` and `corpus_ingest`.
- `private.budget_ocr_requests`: source key (unique, 40 hex), official URL (unique, https, `.pdf`, no query), expected pages
  (1 to 1,000), the pack's sha256, status (`queued`, `running`, `done`, `failed`), estimate, money spent, attempts, claim
  token and lease, pages and cost, the OCR text (a JSON list of page texts), error code, timestamps.
- Functions, all `SECURITY DEFINER` with `search_path = pg_catalog, pg_temp` and schema-qualified names; none executable by
  `PUBLIC`, `anon` or `authenticated`:

  | Function | Who | What |
  |---|---|---|
  | `public.budget_ocr_enqueue(jsonb)` | `corpus_ingest`, `service_role` | queues up to 50 items; refuses a host that is not on the Budget desk's list (`ingest_search_only_desks()`), a link with credentials, a port, a query, a non-PDF path, a control character, a backslash, an encoded separator or a `.`/`..` path segment (the screen's `billUrlSegmentsOk` check), a key that is not 40 hex, pages outside 1 to 1,000, a hash that is not sha256, and any key or link already queued (`duplicate`). The estimate is computed here from the pages; fields a caller adds are ignored. |
  | `public.budget_ocr_read(text[])` | `corpus_ingest`, `service_role` | the requests by key, with the text only when `done` |
  | `public.budget_ocr_status()` | `corpus_ingest`, `service_role` | counts, money committed, the cap, the switch |
  | `public.budget_ocr_claim(limit, lease)` | `service_role` only | the cap (below); refuses while `enabled` is false |
  | `public.budget_ocr_finish(id, token, pages, texts)` | `service_role` only | stores the text; the cost is `pages × price` computed here; more pages than expected fails the request and switches the run off |
  | `public.budget_ocr_fail(id, token, code, uncertain, permanent)` | `service_role` only | queues again until `max_attempts`, or ends the request |
  | `private.budget_ocr_tick()` | the cron job (owner) only | the cron job's body |

  `corpus_ingest` can queue requests and read answers; it cannot claim, finish or fail one, so it can neither spend nor write text.
- Cron job `budget-ocr`, every minute, scheduled only where `pg_cron` is installed. **It is inert**: `private.budget_ocr_tick()`
  returns `disabled` unless `enabled` is true and a function URL is set, `idle` when nothing is queued, `cap` when no
  queued request fits under the cap, and `no_secret` when the vault has no `budget_ocr_secret`; only then does it call
  `net.http_post`. Applying the migration therefore starts no spend.

### 2. The spend cap (in the database)

`committed = Σ spent_usd + Σ estimate_usd of running requests`. `budget_ocr_claim` takes the settings row `FOR UPDATE`, then
claims requests in creation order and **refuses the next one when `committed + its estimate` would pass `cap_usd`**, saying
`cap`. The cap is per run: the developer sets it (default US$2) in the settings row, and it counts all requests ever queued.
Money is counted conservatively: an attempt that ended without a known answer (a timeout, a 5xx, a lease that ran out)
counts its whole estimate as spent, even if it was not billed; a rate limit or a rejection (not billed) counts nothing. The
Edge function asks Mistral for exactly the expected pages (`pages: [0 … n-1]`), so one request cannot cost more than its
estimate. Finish with a page count other than the expected one fails the request (`page_count_mismatch`), keeps no text, and
still counts the money. Finish with **more** pages than expected fails the request (`pages_over_expected`), records the real cost, keeps no text and **switches the run off** (`enabled = false`), so a billing surprise stops the run. The estimate used by `claim` and `tick` is pages × the **current** price, recomputed at claim (a price raised after queuing is not under-counted). `function_url` must match `https://<20-character project ref>.supabase.co/functions/v1/budget-ocr`.

### 3. Edge function `supabase/functions/budget-ocr/`

POST only, with `x-budget-ocr-secret` equal to `BUDGET_OCR_SECRET` (constant time; 401 with no detail when it is wrong or
unset; 503 when the secret is shorter than 32 characters or `MISTRAL_API_KEY` or `OPENROUTER_API_KEY` is unset, before anything is claimed). It answers 202 and, under `waitUntil`, claims
2 requests, reads each with the engine its page count selects (below; before 2026-11-22 every request went to Mistral), calls Mistral OCR for a long one with the official URL as `document_url` (no download, no storage) and, since
2026-11-22, the ingest worker's OCR flags unchanged (`OCR_FLAGS`: blocks and image data are requested, but only the composed
page text is kept; the blocks and image data are neither stored nor logged), and reports each through `budget_ocr_finish` or `budget_ocr_fail`. Every OCR call has a time limit (100 s,
`AbortSignal.timeout`, shorter than the 300 s lease); an aborted or unavailable call is reported as uncertain. A `\u0000` in the OCR text is removed before storing; if the `finish` call itself fails, the request is ended for good (`report_failed`, estimate counted) so the paid work is never repeated. It reuses
`ingest-worker/mistral.ts` (`callMistralOcr`, `buildOcrRequest`, `checkIndexes`, `redactMessage`, `secretMatches`) and adds
`config.toml` `verify_jwt = false` for it. Tests use injected `fetch` only.

**Engine by page count (developer decision 2026-11-22, F409).** Each claimed request is read by the engine its
`expected_pages` selects, by one rule in `budget-ocr/engine.ts` (`engineFor`), which `ocr-collect` applies too:

- **1 to 4 pages** (`VISION_MAX_PAGES`; 110 of the 116 held): GPT-5 mini (`openai/gpt-5-mini`) through OpenRouter
  (`vision.ts`), with the trial's proven request: the official PDF fetched into memory with the trial's checks (no
  redirect, 20 s, 20 MB, the `%PDF-` signature), a base64 file part, the native PDF engine, temperature 0, usage included,
  the trial's prompts; only `max_tokens` is raised, to 32,000 (the densest trial document, 3 pages, used about 11k). The
  answer is split on its `=== PAGE n ===` lines into exactly `expected_pages` texts (marker lines removed, each page
  trimmed, NUL removed) and finished with that page count. Otherwise it is failed, uncertain (it was billed):
  `vision_empty` (no text; retried), `vision_truncated` (`finish_reason` `length`; final, as the same document would run
  out again), `vision_page_split` (not exactly markers 1 to n in order, or text before page 1; retried, as a new sample
  may split). Failures before or at OpenRouter: `pdf_fetch_failed` and `openrouter_rate_limited` (not billed, retried),
  `not_pdf`, `pdf_too_large`, `official_url_invalid` and `openrouter_rejected` (a 4xx: not billed, final),
  `openrouter_unavailable` (a 5xx or a dropped connection), `openrouter_timeout` and `openrouter_unreadable` (possibly
  billed, retried). Retries stop at `max_attempts`; each uncertain attempt counts its estimate.
- **5 pages and more** (6, and 11 to 62 pages): Mistral exactly as above, with `BUDGET_TABLE_FORMAT` back to `'markdown'`
  (the worker's request unchanged; the html composition code stays and is unused).

Time: the two claimed requests run together, so an invocation lasts as long as the slower one: a vision request at most
20 s + 120 s, a Mistral one 100 s, plus the claim and the report. That is under the 300 s lease, NTER's 400 s Pro wall clock,
and the 150 s Free-plan limit with 10 s to spare (held by `engine_test.ts`). `OPENROUTER_API_KEY` is now required too: without
either key the function answers 503 before any claim. Each request logs its id, source key, engine, model, pages, prompt and
completion tokens, OpenRouter's cost, finish reason, latency and outcome; never the text, the URL or a key.

### 4. Runner (`scripts/bulk-runner/ocr_route.ts`, wired in `cli.ts`)

- `cli.ts ocr-enqueue --records <records.jsonl> --holds <holds.jsonl> [--reason control_codes_excess] [--limit N] [--offset N]
  [--budget-usd N] [--dry-run]`: selects the records held **only** for that reason, in source-key order; refuses the whole
  plan when any record's link is not https on a Budget host (from `budget.json`), has a query or credentials, or when its page
  count or pack hash is unusable, or when the OCR estimate passes `--budget-usd` (default 2); `--dry-run` touches no database.
  It prints counts and reasons, never a URL or text.
- `cli.ts ocr-collect --records … --holds … [--limit N] [--offset N] --out <dir outside every checkout>`: checks the records
  file against its receipt, reads the queue ten keys at a time, and for each **done** request builds the pack's own record with
  the OCR text as `text`, one page per queued page joined by form feeds, its spans, `content_sha256`, `n_chars`,
  `page_split exact`, and, by the engine rule on the row's expected pages (2026-11-22), `extraction ocr_vision` and
  `text_engine openai/gpt-5-mini` (1 to 4 pages) or `extraction ocr_mistral` and `text_engine mistral-ocr-4-1`; the receipt
  counts the records of each engine (`ocr.models`). The queue row has no engine column, so a row finished before the rule
  was deployed must be queued again before it is collected. It refuses a row that is not this record's
  own request (key, link, page count, pack hash). Control codes in the OCR text, page breaks included, are removed and counted.
  It writes `ocr-records.jsonl` and `ocr-records.jsonl.receipt.json` (the pack's receipt with the new hash and count, the
  source hash and the hold reason, and the pages, cost and completeness). Exit 0 only when every selected record was done.
- Both use the one login `corpus_ingest` through psql; no key is read from any file.

### 5. Budget screen

`budget.json` allows a second text type, `ocr_mistral`, beside `pdf_text`, and since 2026-11-22 a third, `ocr_vision`,
exactly as `ocr_mistral` (the screen treats both only through `extraction_allowed`). Every other check is unchanged (record shape,
source fields, publisher, text binding, length, density, licence, dedupe, the page check against the official PDF, prepare).
The name differs from the pack's own `ocr` (tesseract) on purpose: that record stays held as before. The page check reads the
official PDF's text layer to compare page counts and thin pages; OCR text is checked against it the same way.

## Cost and the cap

| Item | Quantity | Price | Cost |
|---|---|---|---|
| Mistral OCR, 116 PDFs | 361 pages (measured) | US$4 per 1,000 pages | **US$1.444** |
| First batch of 20 (`--limit 20`) | 71 pages | same | **US$0.284** |
| Batches of 50 (`--limit 50 --offset 0, 50, 100`) | 105, 179 and 77 pages | same | 0.420, 0.716, 0.308 |
| Embedding the new chunks, at load | the loaded texts | US$0.02 per million tokens | about US$0.01 (estimate) |

Cap US$2 (headroom over 1.444 is for a retry or two; a timeout counts its whole estimate). The cap is in the database, per
run; changing it is one `update` by the developer.

## Order to apply and deploy (each step waits for a named yes)

1. Merge the pull request (supervisor; the migration, function and runner change nothing until used).
2. **Apply the migration** (as for earlier applies, by psql as `postgres`; read-only checks first). It creates objects only;
   `enabled` stays false. Check: `select * from private.budget_ocr_settings` (as `postgres`) shows `enabled f`, `function_url`
   empty; **`select jobname, schedule from cron.job where jobname = 'budget-ocr'` returns the job** (it is scheduled only where
   `pg_cron` is installed, so a missing row means no tick will ever run); nothing is queued.
3. **Function secrets** (developer): `BUDGET_OCR_SECRET` (a new random value of at least 32 characters; the function answers 503 with a shorter one) on the Edge function, and the same value in the
   vault as `budget_ocr_secret` (`select vault.create_secret('<value>', 'budget_ocr_secret')`); `MISTRAL_API_KEY` is already
   a function secret on NTER (the ingest worker uses it). No value is typed on the laptop or into this repository.
4. **Deploy the function** `budget-ocr` as the others are (`supabase functions deploy budget-ocr --use-api --project-ref
   <the project's ref>`); read the file list the deploy prints (it imports `../ingest-worker/…`) and download the source to
   compare with `main`.
5. **Enable** (developer, as `postgres`): `update private.budget_ocr_settings set function_url =
   'https://<project-ref>.supabase.co/functions/v1/budget-ocr', cap_usd = 2, enabled = true;` (the project ref is 20 characters;
   the setting refuses any other host). From the next minute the job calls
   the function whenever a request is queued.
6. **First batch of 20 (71 pages, about US$0.28)**, attended:
   `cli.ts ocr-enqueue … --limit 20` (dry run first), watch `select public.budget_ocr_status()` (as `corpus_ingest`) until 20
   are `done` (two a minute, so about 10 minutes), then `cli.ts ocr-collect … --limit 20 --out <dir outside the repository>`;
   it reports pages and cost, which must be 71 and US$0.284. Stop on any `failed`, any cost above the estimate, or committed
   money above the plan. Watch the committed total in this first batch: a geo-blocked or otherwise failing 5xx answer counts the
   request's whole estimate as spent (it may have been billed), so `committed_usd` can rise while nothing is `done`.
7. **Check that the tables stay legible** before anything is loaded: the developer reads the OCR text of at least three of
   the 20 records that carry tables (`ocr-records.jsonl` is outside the repository), looking for table rows kept as rows
   (markdown tables), numbers and units intact, no merged columns. The screen's own checks follow: `screen` on
   `ocr-records.jsonl` (the same `collection.json`, with `--no-live` off), expecting 20 screened and no hold; its page check
   uses the PDFs already in `~/niyantran-pdf-cache`.
8. **Load** the screened 20 with the normal `run` (batch policy, spend stops, acceptance), then the same for the other 96 in
   `--limit 50 --offset 20`, … batches, each collected and screened before the next. Run `analyze` on the chunk, desk-row and
   document tables after the load (AGENTS.md).
   **A failed request needs an owner update before it can be queued again**: `source_key` and `official_url` are unique, so
   `ocr-enqueue` reports it as a duplicate. The developer deletes or updates the `failed` row as `postgres` (for example
   `update private.budget_ocr_requests set status = 'queued', error_code = null, finished_at = null where source_key = '<key>'`
   after the cause is fixed; its `spent_usd` stays and keeps counting against the cap).
9. **Switch off**: `update private.budget_ocr_settings set enabled = false;` when the 116 are done. The tables stay as a
   record (nothing is deleted).

## Live run

- **2026-11-22, first batch of 20 (71 pages, US$0.284): tables dropped, not loaded (F408).** Every table was missing
  from the stored text: Mistral returns tables apart in `page.tables` and leaves a `[tbl-N.md](tbl-N.md)` placeholder in the
  page, and the function stored the page markdown alone. The same text also lacked every header and footer line (Mistral
  moves them out of the markdown) and kept raw image placeholders. Fix: each page text is the ingest worker's
  `composeDocument` of the same answer (tables in place, image placeholders rewritten, header and footer lines restored
  unless they repeat across pages; a test holds it equal to the worker's composition), and a request that keeps an
  unresolved table placeholder fails as `ocr_table_unresolved` (billed, permanent); `ocr-collect` refuses to build a record whose text still holds a placeholder. After the redeploy the
  20 must be re-queued (their `done` rows updated by the developer, as in step 8) and OCRed again: about US$0.284 more,
  US$0.568 in all, still under the US$2 cap.
- **2026-11-22, trial with the ingest worker's exact OCR flags.** The first re-run after F408 lost whole year columns in
  261 of 394 table detail rows, across 13 of the 20 documents. The function had overridden `include_blocks` and
  `include_image_base64` to false; the ingest worker, which works for the developer, sends `OCR_FLAGS` unchanged. With the
  developer's approval, `ocrRequestFor` is now exactly the worker's `buildOcrRequest` (same model, all expected pages, same
  flags, same time limit and cost bound). Whether the columns come back is what the trial shows. The answer is now larger
  (image data): `callMistralOcr` reads it whole with no size limit, while the worker asks at most 25 pages a call and halves
  that after a 20 MB answer; this function asks up to 62 pages in one call, two calls at once, inside the function's 256 MB.
  Not measured; no limit was added.
- **2026-11-22, trial of HTML tables.** The worker-flags trial (Demand 42 and 55, 4 pages, US$0.016) gave byte-identical
  text: the year values were still lost, as Mistral flattens merged cells in its markdown tables. The developer approved a
  trial of `table_format: 'html'`, which can express `rowspan` and `colspan`, on the same two documents. `ocrRequestFor`
  now sends the worker's flags with `BUDGET_TABLE_FORMAT = 'html'` (one line to change back; the worker's `OCR_FLAGS` are
  unchanged), and the composition also resolves `[tbl-N.html](tbl-N.html)` placeholders, so the stored text would then
  hold the tables as HTML. An unresolved html placeholder still fails as `ocr_table_unresolved`, and `ocr-collect` refuses
  one left in the text.
- **2026-11-22, HTML tables gave the same loss; vision-model trial approved (F409).** With `table_format: 'html'` Mistral
  still read 6 of the 7 columns of these tables (Hindi name, English name, head code and four year columns) and dropped the
  last year's value from every detail row. The developer approved a trial of two vision models through OpenRouter,
  Gemini 2.5 Flash (`google/gemini-2.5-flash`) and GPT-5 mini (`openai/gpt-5-mini`), on Demand 42 and 55, compared against
  the tables' own totals. The function has a second POST mode for it (`trial.ts`), selected only by the body
  `{"trial":"vision","model":"<id>","source_key":"<40 hex>"}` behind the same `x-budget-ocr-secret` check: it reads the row
  with the read-only `public.budget_ocr_read` (refused when not found or over 5 pages), fetches the official PDF from the
  row's URL without following a redirect, sends it as a base64 data URL with the native PDF engine (OpenRouter documents a
  plain URL only for its Responses API), and answers the text and the usage with its cost. The trial route writes nothing:
  no claim, finish or fail, nothing against the cap, no cron work; the PDF is never stored. Any other body, the cron job's
  `{}` included, is the queue exactly as before.
- **2026-11-22, trial result and the production rule (F409).** On Demand 42 and 55 (1 and 3 pages) GPT-5 mini returned
  every detail row and every section total exactly, checked against the tables' own totals; Gemini 2.5 Flash did not. The
  developer's decision: production Budget OCR is GPT-5 mini for documents of 1 to 4 pages (110 of the 116 held) and Mistral,
  with the default markdown tables, for the longer ones (6, and 11 to 62 pages); no new migration. Section 3 has the
  engine rule, the page split and the failure codes; the trial route is unchanged and remains how a model is checked.
  Cost: about US$0.01 a page for the vision model (OpenRouter's reported cost, logged per request), against US$0.004 for
  Mistral. The supervisor raised the cap to US$5. The database prices every request at the **current**
  `usd_per_1000_pages`, at claim and at finish, whichever engine reads it, so the supervisor sets it to 4 while only the
  Mistral documents are queued and to 15 for the vision run: the cap then errs high (15 against about 10 a thousand pages).
  A vision request claimed while the price is 4 would be under-counted, so the two runs are not queued together.
  `ocr-enqueue`'s own `--budget-usd` estimate still uses Mistral's rate for every record; the cap in the database is the
  bound. Every row already `done` from the earlier Mistral runs must be queued again before `ocr-collect`, which labels a
  record by its page count (the row does not say which engine read it).

## Rollback

- Stop spending at once: `update private.budget_ocr_settings set enabled = false;` (claim refuses; running requests finish
  or their leases lapse). Lower the cap the same way.
- Remove the schedule: `select cron.unschedule(jobid) from cron.job where jobname = 'budget-ocr';`. Undeploy or leave the
  function: with the switch off and no secret it does nothing.
- The migration's Down section (in its header) drops the objects it created; nothing else depends on them. It leaves the vault
  secret `budget_ocr_secret` in place: delete it from `vault.secrets` as `postgres` if it is no longer wanted. Loaded texts are
  ordinary supplied-text documents and leave the desk with the existing `ingest_discard` / `ingest_delete`, by the developer or
  supervisor.
- No PDF was stored, so there is nothing to remove from the `corpus` bucket.

## Verification (this change)

- `supabase/tests/budget_ocr_queue.sql` (chain: the five-desk chain, then the migration as a non-superuser; wired in
  `supabase/tests/run.sh`): grants, security definer and pinned search path, no policy; host, shape and duplicate refusals;
  the cap (exactly at the cap is claimed, just over is refused, after money spent too); claim refuses while off; stale
  tokens; finish, mismatch and money counted; retries, uncertain and permanent failures; lease expiry; the cron body with
  stand-ins for `pg_net` and the vault. Eight mutations of the migration each made it fail. After the 2026-11-22 review the fixture also covers the path checks, the
  current-price estimate (price raised after queuing), more pages than expected (and the halt), a lease expiring at
  `max_attempts`, the pinned function host, and, as a check of the function's source only, the settings-row lock that serialises
  concurrent claims (a real concurrent run needs two sessions and the fixture is one).
- `supabase/functions/budget-ocr/handler_test.ts` (injected `fetch`, no network); nine mutations each made it fail. The
  2026-11-22 engine change added `engine_test.ts` (the rule, the time limits, the page split) and engine tests in
  `handler_test.ts` (vision for 1 to 4 pages, Mistral with markdown for 5, both at once, every failure code, the logs);
  they failed on the unchanged code, and seven mutations (the page boundary, the length check, the truncation's permanence,
  `max_tokens`, the NUL strip, the collect label, `ocr_vision` in `budget.json`) each made them fail.
- `scripts/bulk-runner/ocr_route_test.ts` (plan, record building checked by the screen's own `text_binds`, the real Budget
  screen with a fake page check, both commands, psql quoting); fifteen mutations each made it fail.

## What is not verified

- Mistral fetching `www.indiabudget.gov.in` URLs itself (the site may refuse its fetcher; a refusal is a permanent
  `mistral_rejected` that costs nothing and leaves the request failed). No OCR call has been made by anyone.
- The OCR quality of the Budget tables (step 7 is the check, by reading).
- The page check's verdict on OCR text of these PDFs (their text layers are the faulty ones): not run on real OCR output.
- The cron statement and `net.http_post` / vault on NTER (the test container has no `pg_cron`, `pg_net` or vault; the body
  was run against stand-ins). Whether the deploy bundles the `../ingest-worker/` imports (the deploy's file list says).
- Concurrency of two ticks a minute apart while a long call runs: the cap and the lease are taken under a lock and covered by
  the fixture one call at a time, not by a concurrent run (the fixture only checks that `claim` locks the settings row).

## Scope and exclusions

Changed: the migration, `supabase/tests/budget_ocr_queue.sql` and its entry in `run.sh`, `supabase/functions/budget-ocr/`,
`supabase/config.toml` (one function entry), `scripts/bulk-runner/ocr_route.ts` and test, a few lines of
`scripts/bulk-runner/cli.ts` (the dispatch and the dependency), `scripts/bulk-runner/screens/budget.json` (one text type) and
its pinned-value test, the F391 entry of `docs/plans/open-work.md`.
Not changed: the five-desk route, `ingest_register`, the worker, the policy, the other 24 Budget holds, the 346 loaded
documents, the Bills screen and corrigenda (F372), any other desk's screen.
