# Spec: page-aware PDF ingestion (`ingestion-v2`)

> **Status: Normative — approved by the owner on 2026-10-01,** with the
> recommendations accepted. Downloads remain a separate go-ahead. Module `ingestion-v2` of
> `docs/specs/2026-09-30-rag-v2-capability-map.md` (open-work R4). It writes
> into the chunk contract (`docs/specs/2026-09-30-rag-v2-chunk-contract.md`,
> live since 2026-10-01 as migration `20261001120000`). Revision 2 folds in a
> fresh-context adversarial review of revision 1: 27 findings, all accepted
> (see "Review record").

## Objective

Turn a **new** PDF into a searchable, citable, page-aware document on NTER:

- the file is stored privately;
- Mistral OCR extracts pages, block boxes and images;
- page text, sections and chunks are built by the tested pure code in
  `_shared/pageText.ts` and `_shared/chunking.ts`;
- chunks are embedded through OpenRouter and committed;
- the document appears in search with page, box and image citations.

It must work for any PDF size, never pay for the same OCR twice, and record
the cost of every paid call.

There is **one pipeline** with a single entry point, `ingest_register`, for
every source: the `acquisition` scripts (R7), the admin tab (R8) and the
pilot (R5).

This module builds the pipeline and runs it end to end locally, then on
**one** document on NTER. The pilot and any bulk run need separate
go-aheads.

**Only first extractions.** Re-extracting a document that is already
page-aware (a new file, a new model, a new chunker version) is **refused**
here and left to a later module. That keeps chunk-contract R6's
re-extraction sequence out of this module.

## Current state (read and executed 2026-10-01)

- **Storage:** one bucket, `marketing` (public, videos). No document bucket.
- **Secrets:** no `MISTRAL_API_KEY` on NTER; it is only in the laptop's
  `.env.local`. `OPENROUTER_API_KEY` is set.
- **The contract is live:**
  - `documents.storage_path`, `file_sha256`, `extract_hash`, `source_mime`;
  - `document_pages`, `document_page_blocks` and `document_page_images`,
    readable by any signed-in user, all empty;
  - `document_chunks.block_ids`, `image_ids`, `embed_hash`;
  - `chunk_commit`;
  - `match_documents` with the page columns. All its branches return only
    documents with `indexed_at` set.
- **`ingest-documents`** refuses documents whose `extract_hash` is set
  (`ingest-documents/handler.ts`, `ingestOne`).
- **Pure code, tested:**
  - `_shared/pageText.ts`: `composeDocument`, `locateBlocks`, `normaliseBox`
    and `isMarginNote`. `composeDocument` runs `inlineTables` and then
    `rewriteImagePlaceholders` (`pageText.ts:270-273`).
  - `_shared/chunking.ts`: `chunkPages`.
  - `_shared/embed.ts`: OpenRouter embeddings. A failed batch discards the
    batches already completed in the same call (`embed.ts:148-164`).
- **Test fixture:** a real OCR response, `mistral-bill-12p.json` (88 KB on
  disk, 0 images). The PDF itself is not in the repository.
- **Mistral OCR:**
  - `pages` indexes are 0-based, and they stay the file's own indexes on a
    range request.
  - Mistral fetches `document_url` from its own servers.
  - 50 MB and 1,000 pages per file.
  - The response's `model` echoed the alias `mistral-ocr-latest`.
- **Edge Functions** (research doc §5, official docs):
  - 256 MB of memory;
  - a wall clock of 150 s on Free and 400 s on paid plans (NTER is on a paid
    compute tier, but its plan is not recorded here);
  - 2 s of CPU per request, excluding async I/O;
  - an idle or response timeout of 150 s, after which the caller gets a 504;
  - `EdgeRuntime.waitUntil` for background work, bounded by the same limits.
- **PostgREST** returns at most 1,000 rows per request (`config.toml:18`).
  Set-returning RPCs are capped too.
- **The SQL test containers** have no `pg_cron`, `pg_net` or Vault
  (`run.sh:34-36`). The non-superuser wrapper is hard-wired to one migration
  (`run.sh:53-68`).
- **Superuser lesson (2026-10-01):** NTER's migration role is not a
  superuser. Hosted migrations have created buckets (`20260928100200`, an
  insert into `storage.buckets`) and cron jobs (`20260921000007`) without
  trouble.
- **Dependencies:** `pdfjs-dist` is present; `pdf-lib` is not.

## Owner decisions (recommendations in bold)

1. **Queue:** **a job table claimed with `FOR UPDATE SKIP LOCKED`,** with a
   lease and a fencing token, driven by `pg_cron` → `pg_net` → the worker.
   It needs no new extension.
2. **Storage: one private bucket, `corpus`, content-addressed by file hash
   alone.**
   - `corpus/files/<sha256>.pdf` for a whole PDF or a part;
   - `corpus/img/<sha256>.<ext>` for an image.
   - Keys need no document id, so a caller can upload **before** it
     registers, and identical bytes are stored once.
   - File limit **50,000,000 bytes** (decimal, the stricter reading of
     Mistral's 50 MB).
   - MIME types: `application/pdf`, `image/jpeg`, `image/png` and
     `image/webp`.
   - No object policies; the service role only.

   This amends chunk-contract R6's `<document_id>/<file_sha256>.pdf` path.
   The column is plain text, so no schema change is needed.
3. **Mistral key:** **you set it yourself, in your own terminal:**
   `supabase secrets set MISTRAL_API_KEY=… --project-ref vfgcppstyzjarlzyqdac`.
   The worker's own secret is generated and stored by an operator script
   **you** run (below), so neither value passes through chat, a transcript
   or a file I read.
4. **Throughput:** at most **2 jobs running system-wide** (enforced in the
   claim, under a lock), and **25 pages per OCR call to start**, shrinking
   when a response is large. Both are named constants, tuned by the pilot.
5. **Model:** before the first call, `GET /v1/models`, which is free, lists
   the OCR ids. The worker then uses **an explicit OCR 4.1 id**, recorded in
   the job and in the hashes.

## Design

### Identity and hashes (computed in TypeScript, in the worker)

- **`file_sha256`:** SHA-256 of the whole PDF's bytes, computed by the
  caller. For a split PDF, the SHA-256 of the original, plus each part's own
  hash.
- **`ocr_hash`:** SHA-256 of the canonical JSON
  `{file_sha256, model_id, table_format, extract_header, extract_footer, include_blocks, include_image_base64}`,
  with keys sorted. The pages per call are **excluded**, so tuning them
  never forces a re-OCR. It keys the raw OCR.
- **`extract_hash`:** SHA-256 of `{ocr_hash, PAGE_CHUNK_VERSION, COMPOSITION_VERSION}`.
  It keys the composed pages and blocks (chunk contract R6).
  `COMPOSITION_VERSION` is a new constant in `pageText.ts`, set to 1.

### Tables and columns (migration `…_ingestion_v2.sql`)

**`document_files`,** one row per stored PDF object of a document:
`document_id` (cascade), `part_index` (0..n−1), `page_offset`, `page_count`,
`sha256`, `byte_size`, `storage_path`.

- Unique on `(document_id, part_index)`.
- Checks: `page_count ≥ 1`, `page_offset ≥ 0`.
- Readable by signed-in users (the viewer, R6, maps a page to its part).
- Written by the service role.

**`document_ocr_pages`,** the raw OCR:
`document_id`, `ocr_hash`, `page_number` (≥ 1), `raw jsonb`, `created_at`.

- Unique on `(document_id, ocr_hash, page_number)`.
- `raw` holds Mistral's page **without** image base64: markdown, header,
  footer, dimensions, blocks, tables, and images as
  `{id, bbox, sha256, mime}`.
- **Service role only.** Signed-in users never read raw OCR.

**`ingest_jobs`:**

| Column | Purpose |
| --- | --- |
| `id` | the job |
| `document_id` | fk, cascade |
| `status` | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `stage` | `ocr`, `index`, `done` |
| `ocr_hash`, `extract_hash`, `model_id` | set at the first claim |
| `pages_total` | pages to extract |
| `claim_token` | uuid, the fencing token |
| `lease_until` | when the claim expires |
| `attempts` | attempts on the current step |
| `next_attempt_at` | backoff |
| `error_code`, `last_error` | last failure, redacted |
| `ocr_pages` | pages OCR'd |
| `ocr_cost_usd` | numeric, default 0, not null |
| `embed_tokens` | tokens embedded |
| `embed_cost_usd` | numeric, default 0, not null |
| `requested_by`, `created_at`, `started_at`, `finished_at` | bookkeeping |

- One active job per document: a partial unique index for status `queued`
  or `running`.
- Service role only.

**Also in this migration:**
- **`documents.page_count`** is filled at registration.
- **The `corpus` bucket,** as in decision 2.
- **No cron job.** The schedule is an operator step (below), because the SQL
  test containers have no `pg_cron`.

### Functions

All are `security definer`, `set search_path = public, extensions`, revoked
from public, anon and authenticated, and granted to service_role.

**`ingest_register(p jsonb) → jsonb`:** the only entry point. Its input:
`source_key`, `title`, `desk_tier`, `desk_feature`, `file_url`, `metadata`,
`file_sha256`, `page_count`, and `files[]`, each
`{part_index, page_offset, page_count, sha256, byte_size, storage_path}`.

It validates:
- `page_count ≥ 1`;
- parts contiguous from 0, with no gaps or overlaps (each part's
  `page_offset` equals the sum of the page counts before it), and summing to
  `page_count`;
- every `storage_path` equal to `files/<sha256>.pdf`;
- each object present in `storage.objects` for bucket `corpus`, with a
  matching size.

It **refuses:**
- any existing document with `storage_path` null. That is every one of the
  2,338 legacy rows, whether it has chunks or not.
- any existing document with `extract_hash` set, or with an active or
  succeeded job (re-extraction is out of scope);
- a `source_key` that exists with a different `file_sha256`.

**A document with a `failed` or `cancelled` job** and the same
`file_sha256` is **resumed:** the job is re-queued with its stage kept (see
`ingest_retry`).

**Otherwise** it inserts the document with:
- `ocr_text = ''` and `content_sha256 = sha256('')`;
- `indexed_at` null;
- `source_mime = 'application/pdf'`;
- `storage_path` = part 0's path, and `file_sha256`;

then inserts the `document_files` rows and one `queued` job. It returns
`{document_id, job_id, status}`.

**`ingest_claim(p_limit int, p_lease interval) → setof ingest_jobs`:**
1. Take `pg_advisory_xact_lock` on a constant key.
2. Compute the free slots: `INGEST_MAX_RUNNING` (2) minus the jobs that are
   `running` with an unexpired lease.
3. Pick up to `least(p_limit, free)` jobs that are either `queued` with a due
   `next_attempt_at`, or `running` with an expired lease, using
   `FOR UPDATE SKIP LOCKED`.
4. For each: set `running`, a new `claim_token`, `lease_until = now() +
   p_lease`, `attempts = attempts + 1`, and `started_at` if it was null.

**A job whose `attempts` exceeds 6 on one step** becomes `failed` instead of
being claimed. Because attempts count at claim time, a worker killed after
Mistral has billed can't loop forever.

**`ingest_advance(p_job uuid, p_token uuid, p jsonb) → jsonb`:**
- The call is rejected unless `claim_token` matches (fencing).
- It adds to `ocr_pages`, the costs and `embed_tokens`.
- It moves `stage` forward only; it never moves back.
- On progress it resets `attempts` to 0.
- It **releases** the job: `status = queued`, `lease_until` null,
  `next_attempt_at = now()`. After `done`: `succeeded` and `finished_at`.
- On a reported failure: `queued` with `next_attempt_at = now() + 30 s ×
  2^attempts` (capped at 1 h), with `error_code` and `last_error` redacted
  (query strings and anything that looks like a key removed). A permanent
  error, such as a Mistral 4xx other than 429, gives `failed`.

**`ingest_retry(p_job uuid)`:** re-queues a `failed` or `cancelled` job with
its stage kept and `attempts` 0. **`ingest_cancel(p_job uuid)`:** sets
`cancelled`.

**`ingest_activate(p_job uuid, p_token uuid, p jsonb)`,** one transaction:
- It checks the token and that `documents.extract_hash` is null (first
  extraction only).
- It sets `extract_hash`, `ocr_text`, `content_sha256` and `page_count`.
- It sets **`indexed_at = now()` last**.
- The job moves to `done` / `succeeded`.

Chunks were committed while `indexed_at` was null, so they were invisible to
`match_documents` until this point.

### The worker Edge Function: `ingest-worker`

- **Access:** `verify_jwt` off. The handler checks `x-ingest-secret` against
  `INGEST_WORKER_SECRET` in constant time.
- **Returns quickly:** `202` straight away. The work runs in
  `EdgeRuntime.waitUntil` with a **100 s budget**, under both the 150 s
  response timeout and the Free-plan wall clock, so it doesn't depend on the
  plan.
- **One step per claimed job,** after `ingest_claim(p_limit = 1, lease =
  5 min)`.
- **Reads** are paged with PostgREST `range`, 1,000 rows at a time,
  everywhere.
- **Cost logging:** every paid call is logged in `model_call_logs` **before**
  its results are written. That's `caller 'ingest-worker'`, the `purpose`,
  `cost_usd`, and `raw_usage` including `job_id` and `document_id`. A
  charged call is never unrecorded.

**The `ocr` step:**
1. **Find the first missing page** for this `ocr_hash` from
   `document_ocr_pages`. The stored rows are the cursor, so a crash after
   Mistral billed but before `ingest_advance` resumes without paying again.
2. **Find its part** and a range of up to `pages_per_call` pages within that
   part (the part-local, 0-based indexes Mistral expects).
3. **Mint a 10-minute signed URL** for the part.
4. **Call Mistral** with the pinned model, `document_url`, `pages` and the
   approved flags.
5. **Require the returned indexes to equal the requested ones.** Anything
   else is a failure (`ocr_page_mismatch`).
6. **Log the cost** from `usage_info.pages_processed`.
7. **Store images:** each image's base64 is decoded, hashed and uploaded to
   `corpus/img/<sha256>.<ext>` if absent. Images over 5 MB, or beyond 100 on
   a page, are skipped and noted (TenderBase's limits).
8. **Upsert** `document_ocr_pages` for each page. The global page number is
   `page_offset + index + 1`.
9. **Advance.**
10. **Adapt the range:** if the response body exceeded 20 MB, the next call
    halves `pages_per_call` for this job (stored in the job's patch).
11. **When pages 1..`pages_total` are all present,** the stage becomes
    `index`.

**The `index` step,** resumable at every point:
1. **Load and compose:** load all raw pages (paged), then `composeDocument`
   → `locateBlocks` / `isMarginNote` → `chunkPages`.
2. **Write pages, blocks and images:**
   - upsert `document_pages` (final text and offsets) and
     `document_page_blocks` for `extract_hash`;
   - read the block ids back (paged);
   - upsert `document_page_images` with the **placeholders
     `composeDocument` assigned** (`img:<page>-<n>`), matched to the raw
     image ids through `rewriteImagePlaceholders`' mapping;
   - map `block_refs` and placeholders to uuids.
3. **Read what's stored:** the chunk hashes and `embed_hash` values already
   stored for the document (paged).
4. **Embed and commit in slices of 100 chunks.** Only a slice's missing or
   changed chunks are embedded, and that slice is committed with
   `chunk_commit` (full keep list) before the next is embedded. So a failure
   loses at most one slice's embeddings.
5. **When the time budget runs out,** advance with no stage change. The
   next claim resumes at step 1. The computation is deterministic, and
   stored hashes are skipped.
6. **When every chunk is committed,** call `ingest_activate`.

**CPU:** steps 1–2 recompute the whole document on every resume. Their CPU
time is **measured** on the largest local candidate (see acceptance). If it
exceeds 1.5 s, the composed pages are persisted after the first run and
later resumes skip recomputing them.

### Operator steps (the owner runs these; never an agent with secret values)

`scripts/ingest-ops.sh` prints each command before running it, and reads
values from the owner's terminal, never from files:

- **`secret`:** generates `INGEST_WORKER_SECRET` with `openssl rand -hex 32`,
  then:
  - pipes it into `supabase secrets set` for the function;
  - stores it in Vault as `ingest_worker_secret`, through `psql` reading
    stdin;
  - prints only its SHA-256 fingerprint.
- **`schedule on|off`:** creates or alters the `pg_cron` job
  `ingest-worker` (every 30 s, `net.http_post` with the Vault header,
  timeout 10 s), switching it on or off.
- **`kick`:** one manual invocation, the same `net.http_post`, for testing
  with the schedule off.

Agents may **run SQL that reads Vault server-side** (`net.http_post` with
`(select decrypted_secret …)`) through the MCP tool. The value never appears
in a transcript.

### The old path

`ingest-documents` refuses when `extract_hash` **or `storage_path`** is set.
The second condition covers a page-aware document whose job is still
pending. This is a one-line change to T16's rule, with its test.

### Registration script: `scripts/ingest-register.mjs`

For operators and the tests:
- it counts pages with `pdfjs-dist`, which is already a dependency;
- it hashes the file;
- it refuses a file over the limits (splitting belongs to R7 and R8);
- it uploads to `corpus/files/<sha256>.pdf` with the service key, using
  resumable upload above 6 MB;
- it calls `ingest_register`.

## Test plan

### Unit and SQL

- **Deno (pure code and fakes):**
  - the hashes: canonical JSON, pages per call excluded;
  - the Mistral request builder;
  - response mapping: indexes checked, part offsets, base64 to bytes, SHA,
    size and count caps, a synthetic image fixture;
  - the cursor from stored pages, across parts, including a gap;
  - the adaptive range;
  - the `index` step: resumes from each sub-step (pages written, slice k
    committed); never embeds a stored pair; slice-by-slice commits; the
    image placeholder mapping; activation last;
  - cost logged before writes, with job and document ids;
  - the secret check;
  - the 100 s budget.
- **SQL fixture `ingestion_v2.sql`,** applied as a non-superuser. `run.sh`'s
  wrapper is generalised to take any migration name.
  - The bucket: private, limit, MIME types.
  - A privilege loop over `ingest_jobs` and `document_ocr_pages` (service
    only) and `document_files` (select for signed-in users).
  - `ingest_register`:
    - validation (parts contiguous and summing correctly, paths, objects
      present);
    - refuses legacy rows, with and without chunks;
    - refuses re-extraction;
    - refuses a changed file;
    - resumes a failed job;
    - allows one active job.
  - `ingest_claim`:
    - the system cap with two sessions;
    - the lease;
    - attempts at claim;
    - `failed` after 6.
  - `ingest_advance`: fencing, stage forward only, release, backoff,
    redaction.
  - `ingest_activate`: first extraction only; `indexed_at` set last.

  Each assertion is shown red on its own.

### Local end to end (the full local Supabase stack)

- **How Mistral reaches the PDF.** Mistral can't fetch a laptop URL. For
  this run only, the worker honours
  `INGEST_DOCUMENT_URL_OVERRIDE_<file sha>`, a public URL for that file.
  It's accepted **only when `SUPABASE_URL` is a localhost address**, and a
  unit test proves it is ignored otherwise.
  - The bill uses its sansad.in URL.
  - The chart document (RBI's International Investment Position, March 2026)
    uses its rbidocs URL.

  Signing a URL is exercised on NTER in the first-document step.
- **Documents:** the 12-page bill (no images) and the RBI chart document
  (tables and a chart image). Their PDFs are needed locally for hashing and
  upload, which means **downloading two public PDFs: a go-ahead is needed.**
- **Checks:**
  - pages, blocks, sections and chunks as expected;
  - images stored and linked;
  - `match_documents` returns the page columns;
  - re-registration refused;
  - a forced mid-`index` failure resumes with no new OCR log row;
  - costs on the job and in `model_call_logs`;
  - CPU of the `index` step measured.
- **Budget:** a few cents of Mistral and OpenRouter.

### First document on NTER

After go-aheads for each of these: the migration, the owner's `secret` step
and `MISTRAL_API_KEY`, the deploy, and registering the 12-page bill. Then
`kick` until the job is `done`, with the schedule **off**. The owner checks
the citation in a signed-in session.

## Boundaries

- **Always:**
  - One pipeline.
  - Content-addressed files.
  - Cost logged before writes, 0 never null.
  - Stages only move forward.
  - Paged reads.
  - Migrations tested as a non-superuser.
- **Ask first:**
  - Downloads.
  - The migration.
  - Secrets (the owner runs them).
  - Deploys.
  - The schedule.
  - Any registration on NTER.
  - The pilot and any bulk run.
- **Never:**
  - Secret values in chat, files, logs or migrations.
  - Mistral from the browser.
  - Touch the 2,338 legacy rows.
  - Re-extraction.
  - Custom-setting `SET` clauses.
  - Split a PDF inside an Edge Function.
  - Honour the URL override outside localhost.

## Acceptance evidence

1. Both suites, lint, build and `npm run test:sql` (including the new
   fixture as a non-superuser, with its vacuity check) pass, with
   per-assertion fail-first evidence.
2. The local end-to-end run is recorded: both documents, with every check
   above and the `index` CPU time.
3. After the go-aheads, the 12-page bill is live on NTER:
   - the job `succeeded`;
   - a signed-in citation shows its page, section and boxes;
   - costs on the job;
   - the schedule still off;
   - the `coordination.md` record written.

## Scope

- The migration and its fixture, and the `run.sh` generalisation.
- `supabase/functions/ingest-worker/` and its tests.
- `supabase/config.toml` (`verify_jwt` for the worker).
- `_shared/pageText.ts`: the `COMPOSITION_VERSION` constant only.
- The one-line rule in `ingest-documents` and its test.
- `scripts/ingest-register.mjs` and `scripts/ingest-ops.sh`.
- Docs: amendments to the chunk contract (R6 storage paths, and
  re-extraction deferred), open-work R4, and the operations record.

## Exclusions

- Re-extraction and re-indexing, which get their own module.
- Splitting PDFs (R7, R8).
- Downloading bills (R7).
- The admin tab (R8).
- The viewer and user-facing signed URLs (R6).
- The pilot's 10 documents and a page-level evaluation set (R5).
- Annotations; DOCX.
- The 2,338 legacy documents.

## Open questions for the owner

1. The five decisions above. I recommend each as written.
2. **Downloading two public PDFs to the laptop** for the local test: the
   12-page bill from sansad.in and the RBI chart release from rbidocs, a few
   hundred KB each.
3. **Keeping the raw OCR** (`document_ocr_pages`, service role only, about
   6.4 KB per page measured without images, roughly 400 MB for the linked
   bills). Decide before any bulk run, with the pilot's real sizes.

## Review record

A fresh-context adversarial review of revision 1 (2026-10-01) raised 27
findings. All were accepted:

1. Paths needed an id that didn't exist yet: paths are now keyed by file
   hash alone.
2. The local test couldn't reach Mistral: a localhost-only URL override,
   proven by a test.
3. The cron job can't be tested in the SQL containers: it's an operator
   step, and `run.sh` is generalised.
4. Re-extraction conflicted with chunk-contract R6: it's refused, and R6 is
   deferred.
5. A new file registered mid-job was lost: it's refused.
6. Legacy rows were weakly protected: refuse on `storage_path` null, and the
   old path refuses too.
7. The concurrency cap wasn't enforced: a system-wide cap under a lock.
8. Crashes could re-pay forever: attempts count at claim time.
9. The resume claim was false: the cursor comes from stored pages, and
   `ingest_retry` exists.
10. Re-indexing from raw didn't work: a separate `ocr_hash` and an
    `ocr_pages` table (re-indexing itself deferred).
11. Edge limits were misread: 202 plus `waitUntil`, a 100 s budget, CPU
    measured, an adaptive range, image caps.
12. The 1,000-row cap wasn't handled: paged reads everywhere.
13. Page accounting was unspecified: 0-based, indexes checked, completeness,
    billed on `pages_processed`.
14. Parts weren't validated or stored: `document_files`, validated,
    content-addressed.
15. `extract_hash` was underspecified: a canonical definition.
16. The secret handling broke the rules: operator-run steps, and Vault read
    server-side.
17. Images were untested: a chart document, a synthetic fixture, the
    placeholder rule, webp.
18. Re-embedding on failure: slice-by-slice commits.
19. `pdf-lib`: `pdfjs-dist` instead.
20. The PDF wasn't in the repository: a download go-ahead, and the fixture
    size corrected.
21. The model pin came after use: `GET /v1/models` first.
22. Call logs had no job: ids in `raw_usage`, logged before writes.
23. Job mechanics were vague: fencing, release, retry and cancel defined.
24. Errors could leak secrets: redaction.
25. `raw` was user-readable: a service-only table.
26. Open-work R4 said pgmq: corrected.
27. MB versus MiB: 50,000,000 bytes.
