# Spec: platform-admin document upload (`admin-upload`)

> **Status: Normative — revision 2, approved by the owner on 2026-10-01**
> with the recommendations accepted: 300 MB per file in v1; every platform
> admin may upload and act on any job; `pdf-lib`, the `ingest_discard`
> migration and the schedule at go-live approved in principle. Each production
> action (the migration, the deploys, the schedule, uploads on NTER) still gets
> its own go-ahead when it is reached. Module `admin-upload` of
> `docs/specs/2026-09-30-rag-v2-capability-map.md` (open-work R8). It feeds the
> pipeline of `docs/specs/2026-10-01-rag-v2-ingestion-v2.md` (R4, live on NTER
> since 2026-10-01) through its single entry point, `ingest_register`. The
> owner moved this module ahead of R5–R7, because admin upload is the
> milestone. Revision 2 folds in a fresh-context adversarial review of revision
> 1: 16 findings, all accepted (see "Review record").

## Objective

A **platform admin** opens the admin panel, picks one or more PDFs, fills in a
title and the desk they belong to, sees the estimated cost, and presses one
button.

- The PDFs are verified and stored in the private `corpus` bucket.
- They are registered with `ingest_register`, OCR'd, chunked and embedded by
  the worker already live on NTER.
- They become searchable, with page citations, without anyone opening a
  terminal.

The admin sees every job's progress, cost and errors. They can retry or cancel
a job, and discard an upload that never went live.

**Who:** users for whom `is_platform_admin()` is true (`user_profiles.role =
'admin'`, `status = 'active'`). Any platform admin may act on any ingest job,
including jobs started by scripts; this is intended, and every action is
logged with the admin's id. Nobody else can upload, see the tab's data, or
call its backend. Chat uploads and a file manager are out of scope.

**Sensitive scopes (AGENTS.md):** admin authorisation, storage writes and
deployment configuration (the cron schedule). Each has focused verification
below.

**Done looks like:**
1. The owner, signed in as an admin on production, uploads a PDF from the
   admin panel.
2. Within minutes it is searchable in the chat with page citations, with no
   terminal step.
3. A PDF that needs splitting becomes **one** document with continuous page
   numbers. This is proven end to end on NTER with a small file forced to
   split, with citations on both sides of a part boundary.

## Current state (read and executed 2026-10-01)

- **Admin panel:** at `/admin`, gated in the UI by `verifyAdminSession`
  (`src/admin/adminSession.js:12-56`). It is a UI gate only; every backend call
  checks again.
  - The Edge Function pattern is `admin-models`: `requireUser`, then
    `rpc('is_platform_admin')` with the caller's JWT, then `serviceClient()`
    for writes (`admin-models/index.ts:4-8`).
  - Tabs are a `NAV` array plus one conditional render
    (`AdminApp.jsx:14-24`, `:184-192`). Styles are in `admin.css`.
- **The existing admin upload (the homepage video):**
  - a server route mints `createSignedUploadUrl`;
  - the browser calls `uploadToSignedUrl`;
  - a finalize call checks the object;
  - there is no per-byte progress (`marketingIntroVideo.js:73-79`).
- **The pipeline (live):**
  - `corpus` is private: 50,000,000 bytes, PDF/JPEG/PNG/WebP, no object
    policies;
  - `ingest_register` is service_role only. It checks parts and object sizes
    (not content) and raises plain-text errors;
  - the worker handles multi-part documents (`ocr.ts:52-72`);
  - the **schedule is off.**
- **Storage client facts** (`node_modules/@supabase/storage-js`):
  - The default `contentType` is `text/plain;charset=UTF-8`; a Blob sends its
    own type.
  - A signed upload token lives 2 h.
  - Upsert is off by default.
- **Browser tooling:** `pdfjs-dist` is a dependency, not used in `src/`. No
  PDF-writing library is installed.
- **Desk names:** the corpus and the catalog spell some features differently.
  - The corpus has "Regulatory Body Watch (RBI / SEBI / TRAI / CCI)"; the
    catalog has "(RBI/SEBI/TRAI/CCI)".
  - `research-chat`'s `featureScopeOf` takes the **first** normalised match
    (`handler.ts:515-536`), so a second spelling hides documents.
  - "Cabinet Decisions" exists on two tiers.
  - `src/lib/deskCatalogBuild.js` is Node-only. `_shared/deskCatalog.json`
    (16 KB) is importable by the browser and the function.
- **`documents.file_sha256`** has no index and no uniqueness. Legacy rows have
  it null.

## Owner decisions (recommendations in bold)

1. **Backend: a new Edge Function `admin-ingest`** (the `admin-models`
   pattern).
   - **`verify_jwt` is off, and the handler runs `requireUser` plus
     `is_platform_admin`,** like `research-chat`. So even a 401 carries CORS
     headers.
   - The worker secret stays in Supabase.
   - It adds no Vercel route.
2. **Upload through a staging area, then a server-side move.**
   - The browser only ever gets signed upload URLs for
     `corpus/staging/<random uuid>.pdf`.
   - The server verifies each staged object: byte count and streamed SHA-256.
   - Only then does it **move** the object to `files/<sha256>.pdf`.
   - If the destination already exists, the staged copy is deleted instead.
   - Nothing unverified ever sits at a content address, and this module never
     deletes a content-addressed object.
   - Stale staging objects (over 24 h) are swept (open-work item).
3. **Document key: `upload:<file_sha256>`.** The same file uploaded again shows
   the existing document instead of making a copy.
   - A file already among the 2,338 legacy documents, or under an R7 corpus
     key, can still be uploaded again and will then appear twice in search.
     The tab warns when it can tell (the same `file_sha256`), but it can't
     detect legacy rows, whose `file_sha256` is null.
4. **Splitting in the browser with `pdf-lib`, pinned exactly** (MIT,
   `1.17.1`). **A new dependency: ask first.**
   - It is lazy-loaded in the admin tab only.
   - **`pdfjs-dist`** (already a dependency, and the same parser R7 uses) gives
     the page count and detects encryption.
   - A file within Mistral's limits (≤ 50,000,000 bytes and ≤ 1,000 pages) is
     uploaded **unchanged**, encrypted or not; Mistral reads owner-password
     PDFs.
   - Only a file that must be split is loaded into `pdf-lib`. An encrypted file
     that needs splitting is refused with a clear message.
5. **Metadata the admin fills in:**
   - title (required; defaults to the file name);
   - desk tier and feature, **as a pair** from `_shared/deskCatalog.json`,
     stored in the spelling the corpus already uses for that module
     (`document_modules()`) when one exists;
   - source URL (optional);
   - a note (optional);
   - "split every N pages" (optional; used for testing and for awkward files).
6. **Discard:** an upload that never went live can be removed from the tab.
   That means `indexed_at` and `extract_hash` null, the job failed or
   cancelled, and a key starting with `upload:`.
   - This needs a small SQL function, `ingest_discard`, so **one migration:
     ask first.**
   - Stored objects are left for the sweeper, because they may be shared.
7. **Processing: switch the schedule on at go-live** (every 30 s, at most 2
   jobs running; about 2,880 cheap invocations a day, most of them idle).
   - `admin-ingest` also starts the worker once after each registration.
   - **Owner go-ahead.**
8. **Limits:**
   - v1 caps a browser file at **300 MB**, measured, and raised once
     measurements allow.
   - The server caps a registration at **5,000 pages**: about $20 of OCR.
   - The cost shown is OCR only; embedding adds well under 1 %.

## Design

### The flow, per file

1. **Read** the file, up to 300 MB. Refuse it unless `%PDF-` appears in the
   first 1,024 bytes.
2. **Inspect** with `pdfjs-dist`: page count and encryption. `file_sha256` is
   the SHA-256 of the whole file.
3. **Plan the parts.** If the file is within the limits and no "split every N"
   was given: one part, the original bytes. Otherwise:
   - load it into `pdf-lib` (not if encrypted);
   - drop `/Annots` from the copied pages, since OCR doesn't need them and link
     annotations can drag other pages into a part;
   - first range length = `min(1000, N if given, floor(45 MB / (file bytes /
     pages)))`;
   - a **work-list:** take the next range [a,b], build it (`copyPages`,
     `PDFDocument.create({ updateMetadata: false })`, `save()`). If it is over
     50,000,000 bytes and b > a, replace it with [a,m] and [m+1,b] and
     continue. A single page over the limit refuses the file. This terminates,
     since one page is the floor, and keeps ranges contiguous and in order;
   - **check each part with `pdfjs-dist`:** its page count equals its range,
     and the counts sum to the whole;
   - each part's SHA-256. Splitting is **deterministic** (no metadata stamp,
     pinned library), so a re-split gives the same hashes.
4. **Show a summary:** pages, parts, size, the estimated OCR cost, and a
   duplicate warning (step 5). The admin confirms.
5. **`prepare`:** for each part the server answers either "already stored",
   or a signed upload URL to a fresh `staging/<uuid>.pdf`. If documents with
   this `file_sha256` exist, it returns them, preferring an activated one:
   - an `upload:` document stops the flow ("already uploaded");
   - a document under another key triggers the duplicate warning.
6. **Upload** each part: `uploadToSignedUrl` with
   `new Blob([bytes], { type: 'application/pdf' })` and `contentType:
   'application/pdf'`, each with a fresh session token.
7. **`verify` each part:**
   - the server streams the staged object;
   - counts its bytes (they must equal the declared size and
     `metadata.size`) and hashes it;
   - on a match, moves it to `files/<sha256>.pdf` (or deletes the staged copy
     if that address already exists);
   - on a mismatch, deletes the **staged** object and returns 422.
8. **`register`:**
   - every part must already be at its content address;
   - it calls `ingest_register` with `source_key = upload:<file_sha256>`,
     `requested_by` = the admin, and metadata (file name, note, uploader, part
     list);
   - it starts the worker once.
9. The file appears in the **jobs list**.

Several files run one after another in a queue. If the tab closes mid-way,
already-stored parts are found at step 5, and a deterministic re-split gives
the same hashes, so the upload continues without sending those bytes again.

### `admin-ingest` (Edge Function, `verify_jwt` off)

**Every request:**
- is POST with `authorization: Bearer <user JWT>`;
- passes `requireUser` then `rpc('is_platform_admin')` with the caller's token
  (401 or 403 otherwise, with CORS headers and nothing touched);
- has its JSON body capped at 64 KB **while reading**;
- has its parts built from a field whitelist.

Work uses the service client. Every action logs `{action, user_id, ids}`.

| Action | Input | Result |
| --- | --- | --- |
| `prepare` | `file_sha256`, `page_count`, `parts[] {sha256, byte_size, page_count}` | `{documents[]}` for the same file, and per part `{stored}` or `{staging_path, token}` |
| `verify` | `staging_path`, `sha256`, `byte_size` | `{stored: true}`, or 422 (staged copy deleted) |
| `register` | parts plus `title`, `desk_tier`, `desk_feature`, `file_url?`, `note?`, `file_name` | `{document_id, job_id}`; 409 "already uploaded" (for a unique violation or an existing `upload:` key); 422 with the refusal reason |
| `jobs` | `limit ≤ 50`, `before?` | jobs with title, desk, stage, status, pages, `attempts`, `next_attempt_at`, `error_code` / `last_error`, costs, the requester's email (a second read of `user_profiles`) |
| `retry` / `cancel` | `job_id` | new status |
| `discard` | `document_id` | removed, or 409 with the reason (`ingest_discard`) |

**Validation:**
- hashes are 64 lowercase hex;
- staging paths are exactly `staging/<uuid>.pdf`;
- sizes are between 1 and 50,000,000;
- parts are contiguous and sum to `page_count`, which is ≤ 5,000;
- the tier and feature pair is in the catalog (normalised match);
- title is 1–300 characters;
- `file_url` is http(s) or empty;
- `ingest_register`'s plain-text refusals are mapped to 409 or 422 by
  message.

**Verification cost:**
- SHA-256 runs incrementally with `node:crypto` `createHash` over the fetch
  stream: native and constant memory.
- One part per request, so a 50 MB part is one request.
- **Measured in the build:** CPU ms and peak memory per 50 MB part, against
  the 2 s CPU and 256 MB limits.

**Starting the worker:** a `fetch` to `ingest-worker` with
`INGEST_WORKER_SECRET`. A failure only logs; the schedule catches up.

### `ingest_discard(p_document uuid)` (migration, service_role only)

It locks the document row, then deletes the document only when all of these hold (each refusal names its reason):
- `source_key like 'upload:%'`;
- `indexed_at is null` and `extract_hash is null`;
- no job is queued, running or succeeded.

Cascades remove its files rows, raw OCR, pages, blocks, images, chunks and
jobs. Otherwise it raises with the reason. It is tested as a non-superuser like
every migration. The same migration adds an index on `documents.file_sha256`
(where not null) for `prepare`.

### The admin tab: "Documents"

- **Upload card:**
  - a file picker (multiple, PDF);
  - per file: the summary, the form, the duplicate warning and the confirm
    button;
  - progress per part (queued, uploading, verifying, stored), not per byte.
- **Jobs table:** title, desk, pages done of total, stage, status, attempts,
  next attempt, error, OCR and embedding cost, requested by, when; Retry,
  Cancel and Discard where allowed. It refreshes every 10 s while any job is
  active.
- It follows `admin.css`, adding at most one progress style.

### Code layout

- `src/lib/corpusUpload.js`: pure and injectable pieces. `sha256Bytes`,
  `inspectPdf` (pdfjs), `planParts` / `splitPdf` (pdf-lib, lazy `import()`),
  `estimateCostUsd`, and the orchestration with `fetch`, storage and token
  injected.
- `src/admin/DocumentsPage.jsx`, plus a `NAV` entry in `AdminApp.jsx`.
- `supabase/functions/admin-ingest/{handler,index}.ts` and tests;
  `supabase/config.toml` (`verify_jwt = false`).
- `supabase/migrations/<ts>_ingest_discard.sql` and its fixture.

## Security

- Admin-ness is checked on the server for every action; the UI gate is not
  trusted.
- The browser never holds a service key or the worker secret.
- Signed URLs point only at fresh `staging/<uuid>.pdf` paths.
- Content addresses are written only by the server's verified move. The
  service-key script (R7) remains a trusted writer.
- No content-addressed object is ever deleted by this module.
- Uploaded PDFs are untrusted data: they are parsed only by pdfjs and pdf-lib
  in the admin's browser and by Mistral. The server only counts and hashes
  bytes.
- Errors shown are the pipeline's redacted `last_error`.
- **Focused verification:**
  - Deno tests for 401 and 403 on every action;
  - after the deploy, a browser preflight and 401/403 probes from the
    production origin;
  - the migration tested as a non-superuser;
  - the schedule's cron row read back after it is switched on.

## Testing strategy

- **Vitest (`src/lib/corpusUpload.test.js`):**
  - hashing;
  - `planParts` at the edges: exactly 1,000 pages or 50,000,000 bytes, 1,001
    pages, an oversized part halved, a single oversized page refused, "split
    every N";
  - `splitPdf` on PDFs generated in the test: page counts, order, continuity;
    annotations linking across pages don't inflate a part;
  - **the same input split twice gives the same part hashes;**
  - an encrypted PDF within limits is uploaded unchanged, and refused only
    when it needs splitting;
  - a non-PDF is refused, and so is a file over 300 MB;
  - the orchestration with fakes:
    - `contentType` is `application/pdf`;
    - stored parts are skipped;
    - an `upload:` duplicate stops the flow, and another key shows a warning;
    - a 409 maps to "already uploaded";
    - errors surface;
    - each call gets a fresh token;
  - the cost estimate.
- **Component test (`DocumentsPage`),** in the `usersPage.test.jsx` style:
  the summary, the confirm gate, the jobs table with attempts, next attempt
  and error, and the Retry, Cancel and Discard buttons by status.
- **Deno (`admin-ingest/handler_test.ts`):**
  - 401 and 403 on every action, with nothing touched;
  - the body cap while reading;
  - every validation, including a catalog pair and the 5,000-page cap;
  - `prepare`: duplicates and stored parts;
  - `verify`: the hash is computed incrementally; a size or hash mismatch
    deletes only the staged object; an existing destination deletes the
    staged copy;
  - `register`: message-to-status mapping, the `ingest_register` payload, a
    worker start that fails;
  - `jobs` paging;
  - `retry`, `cancel`, `discard`.
- **SQL fixture `ingest_discard.sql`** as a non-superuser: each refusal
  condition, and the cascade.
- Every test is shown red first.
- **Local end to end** (local stack, dev server, a local test admin with test
  credentials on localhost only):
  1. upload the 12-page bill from the tab and take it to "succeeded". Locally
     Mistral reaches it through the existing `INGEST_DOCUMENT_URL_OVERRIDE`
     for its hash;
  2. upload a generated PDF of 1,200 pages: 2 parts, verified, moved,
     `document_files` correct. Cancel it before OCR, then discard it;
  3. upload the bill again: "already uploaded";
  4. a tampered staged part is refused, and only the staged object is
     removed;
  5. measure a 300 MB PDF in the browser (time; peak memory from Chrome's
     task manager or a DevTools heap snapshot; pass = no crash and under 2
     GB), and `verify` of a 50 MB part (CPU ms and peak memory within Edge
     limits).
- **On NTER** (after the go-aheads; the owner signs in, agents never do):
  1. the owner uploads the 25-page *Budget at a Glance* with "split every 10
     pages": 3 parts, about $0.10;
  2. it reaches "succeeded" with the schedule on and no terminal step;
  3. the owner finds citations on pages 10 and 11 (either side of a part
     boundary) in the chat.

## Commands

- `npm run lint`, `npm run build`, `npm test`
- `deno test -A --config supabase/functions/deno.json supabase/functions`
- `npm run test:sql` (the new `ingest_discard` fixture)

## Boundaries

- **Always:**
  - check admin-ness on the server;
  - staging, then a verified move;
  - one pipeline (`ingest_register`);
  - paged reads;
  - the cost shown before an upload;
  - deterministic splits;
  - every action logged with the admin's id.
- **Ask first:**
  - adding `pdf-lib`;
  - the `ingest_discard` migration;
  - deploying `admin-ingest` and the frontend;
  - switching the schedule on;
  - any upload on NTER.
- **Never:**
  - object policies that open `corpus` to users;
  - a service key or the worker secret in the browser;
  - Mistral from the browser;
  - splitting inside an Edge Function;
  - writing or deleting a content-addressed object without verification;
  - touching the 2,338 legacy documents.

## Acceptance evidence

1. Lint, build, both test suites and the SQL fixtures pass, with per-test
   fail-first evidence.
2. The local end-to-end report
   (`docs/research/<date>-admin-upload-local-run.md`) with the five checks and
   the measurements.
3. After the go-aheads:
   - the migration is applied and verified;
   - `admin-ingest` and the frontend are deployed, and the production probes
     pass;
   - the schedule is on;
   - the owner's NTER run above succeeds, with citations on both sides of a
     part boundary;
   - all of it recorded in `coordination.md`.

## Exclusions

- Deleting or replacing a document that went live, and re-extraction (a later
  module).
- Uploads by non-admins, a chat composer upload, and a file manager.
- Formats other than PDF.
- The PDF viewer (R6).
- Automatic metadata extraction.
- Matching an upload to a legacy or R7 corpus record (decision 3). **Amended:** linking an
  upload to its desk record is now in scope; see "Amendment A".
- Per-byte progress and resumable uploads within a part.
- A daily cost budget; the page cap is the v1 guard.

## Follow-ups for open-work

- **The staging sweeper.**
- **`research-chat`'s `featureScopeOf`** keeps only the first spelling of a
  desk feature; it should collect every spelling.
- **Orphaned content-addressed objects** after a discard.

## Open questions for the owner

1. The eight decisions above. I recommend each as written; decisions 4
   (`pdf-lib`), 6 (the migration) and 7 (the schedule) are explicit
   go-aheads.
2. **The 300 MB browser ceiling for v1.** Is there a real document you expect
   to be larger?
3. **Every platform admin may upload and act on any job,** as recommended, or
   the owner only?

## Amendment A (revision 3): records-first document management (approved by the owner, 2026-10-01)

> **History.**
> - Revision 1 (a record picker in the upload form) was replaced on the owner's direction.
> - The owner accepted four recommendations: records first; bills first, with keys for other
>   desks as a follow-up (F40); admins may delete documents; the source URL is required unless
>   "no public source" is ticked.
> - Revision 3 folds in a fresh-context adversarial review of revision 2: 15 findings, all
>   accepted (see "Amendment A review record" below).

### Why

**The first production upload showed the gap.** The 12-page bill was ingested and searchable,
but dragging its desk row into the chat attached the row alone ("Record only"). The document
carried no `document_key`. It was linked by hand (`bill:2025:XLV`).

**The owner's requirement:** the Documents page maps files to desk records end to end. Dropping
a record into the chat attaches its text, embeddings and context, and admins can attach,
unlink, re-link, replace and delete.

### Current state (NTER, 2026-10-01; read and reviewed)

- **The link is one field.**
  - The client computes a row's key from the live desk row (`billDocumentKey`,
    `src/lib/deskRows.js:93`; `aiDrop.js:243`).
  - `research-chat` resolves keys live, against documents whose `metadata->>'document_key'`
    equals the key and whose `indexed_at` is set (`index.ts:333-345`).
  - The panel badge (`corpusCoverage.js`) does the same lookup, but **caches each answer for
    the whole browser session**.
  - `ingest_activate` never rewrites `metadata`.
  - No chat table references `documents`, and every foreign key to `documents` cascades.
- **Rows versus keys.**
  - Only *Bill Passage Probability Index* and *Policy Intelligence Graph* carry keys: the same
    9,817 bill rows, **9,415 distinct keys**. So about 400 rows share a key: the key drops the
    house, so two houses' bills with the same number and year collide (open-work P14).
  - The loader recomputes keys and deletes rows it no longer sees (`load-desk-rows.mjs`,
    `deskRowSync.js`), so **a key can move** (a corrected year, a renumbered bill).
- **Coverage.** 1,236 of the 9,415 keys (13 %) have an indexed document, all of them legacy.
  - 1,620 legacy documents carry keys, some of them keys no desk row has.
  - 294 keys have more than one document.
- **Search.** `search_desk_rows` is capped at 50 rows, with no offset and no status filter.
  `desk_rows.record_text` has a trigram index.
- **The legacy rule:** the 2,338 legacy documents are never touched (ingestion-v2 spec,
  Boundaries).

### Objective

A platform admin manages the corpus **by record**. A "record" in this view is **one document key**
(one bill), showing every desk row that shares it.

1. **Records:**
   - Pick a desk with keys and see its records with a status, a search box, status filters and
     paging.
   - A coverage line, counted in keys: "1,236 of 9,415 bills have full text".
   - An **orphaned links** count: ingestion-v2 documents whose key no desk row has any more.
2. **Attach a PDF to a record.**
   - The desk, title and key come from the record; the admin supplies the exact source URL, or
     ticks "No public source".
   - When it is live, dragging any row of that record into the chat attaches its full text.
3. **Manage ingestion-v2 documents:** unlink, re-link (to another record), replace (the new PDF
   goes live, then swaps in) and delete. Each is confirmed in the page and audited.
   - **None of today's 1,236 covered bills can be unlinked or deleted here**: their text is
     legacy and read-only.
4. **Documents without a record:**
   - a list of standalone uploads, unlinked documents, documents whose link was orphaned, and
     replacements waiting to swap;
   - each has Link, Delete and, for a replacement, Swap.
5. **Desks without keys:** the page says so and offers standalone upload only (F40).

**Success looks like:**
1. The owner opens a bill marked "Record only", attaches its PDF and watches it go to "Full
   text".
2. Without reloading, they drag that row into the chat. The panel shows "Full text", and the
   answer is scoped to that bill with page citations.
3. They unlink and re-link it, delete a test upload, and see each change in the Records view
   and in the chat badge within a minute (decision D9).

### Decisions (recommendations in bold)

- **D1. The link stays `documents.metadata->>'document_key'`,** so `research-chat` is unchanged.
  - **Keys are owned by `billDocumentKey` and the loader.** A key that moves orphans its link.
  - The page counts and lists orphaned links (Objective 1 and 4), and the fix is a re-link. The
    acceptance test compares the dragged row's computed key with the linked key.
- **D2. At most one linked ingestion-v2 document per key:**
  - a partial unique index, `documents_v2_document_key_unique`, on
    `(metadata->>'document_key')` where `storage_path is not null` and the key is present;
  - the migration first checks there are no duplicates, and fails listing them if there are;
  - legacy duplicates (`storage_path` null) are untouched.
- **D3. Legacy documents are read-only.**
  - They show as "Full text (legacy)".
  - Attaching a new PDF to a record that has legacy text is allowed, with a warning that both
    will be searched.
  - Retiring legacy text is a separate owner decision (open-work).
- **D4. Delete is limited to admin uploads** (`source_key` starting `upload:`), in any state.
  - A queued or running job is cancelled first.
  - It cascades to pages, blocks, images, chunks, files and jobs.
  - Stored objects are kept for the sweeper (F38). Costs stay in `model_call_logs`.
  - R7 documents are not deletable here; their policy is decided with R7. Deleting one would
    only make the next R7 run pay for its OCR again.
  - A deleted document's chat chips and citations degrade to "This document is no longer
    available" (`SourceReader.jsx:17`). This is accepted.
- **D5. Replace is two-step, and the replacement holds no key until the swap:**
  1. The new PDF registers **unlinked**, with `metadata.link_target = <key>` and
     `metadata.replaces = <old id>`.
  2. When it is live, `ingest_swap(p_new, p_expected_old)`:
     - locks both documents in id order;
     - re-checks that the old document still holds the target;
     - unlinks the old and links the new in one transaction.
  3. If the old one was unlinked or deleted in the meantime, the swap simply links the new one,
     provided no other document holds the key.
  4. Deleting the old document afterwards is a separate, confirmed step.
- **D6. Source URL** (it maps to `documents.file_url`).
  - The record's provenance URL (for bills, the sansad.in legislation hub) is shown **as a hint,
    not a value**.
  - The admin pastes the document's own URL. Known hub URLs (the distinct `source_url` values of
    the desk's rows) are refused.
  - It may be empty only when "No public source" is ticked, which is stored as
    `metadata.no_public_source = true`.
  - **This rule binds the admin path only.** Scripts and R7 set `file_url` from their own
    sources.
- **D7. Audit table `corpus_admin_actions`:** `id`, `at`, `actor` (a uuid, **no foreign key**,
  so history survives account deletion), `action`, `document_id`, `key`, `old_key`, `detail`
  jsonb (no emails).
  - RLS on; service_role may only SELECT. The security-definer functions below are the sole
    writers, in the same transaction as their change.
  - Kept indefinitely (it is small).
  - The actions recorded are attach, link, unlink, swap, delete and discard (`ingest_discard`
    is amended to write one).
- **D8. The key check binds the admin path only.**
  - `ingest_register` stays permissive for scripts. A document key that no desk row has is
    allowed, as it is for legacy documents today.
  - Admin attach and link check that the key belongs to a row of the chosen desk.
  - **If another ingestion-v2 document already holds the key:**
    - the admin path refuses with `key_held` (and offers Replace);
    - a script registers the document unlinked with `link_target` and reports it (written into
      R7's spec).
- **D9. A client change: the badge re-checks.**
  - `corpusCoverage.js` gets a 60 s lifetime per answer.
  - It re-queries a key whenever that key is newly attached in the panel.
  - So a change shows without a reload, within a minute at most.
- **D10. One canonical bill desk.**
  - The records picker lists *Bill Passage Probability Index* for bills. *Policy Intelligence
    Graph* holds the same keys, and its rows attach the same documents, because chat joins by
    key alone.
  - The desk check accepts a key from either bill feature.
- **D11. Compare-and-set.**
  - `ingest_link`, `ingest_unlink` and `ingest_swap` take the expected current key (or the
    expected old document), and refuse with `stale` if the page was out of date.
  - `admin-ingest` maps the D2 violation by its constraint name (`key_held`), not by every
    unique violation.

### Design

**SQL (one migration, applied as a non-superuser, with a Down section).** Write functions are
security definer, service_role only, with only `search_path` set. The read function is security
invoker.

- **`admin_desk_records(p_tier, p_feature, p_query, p_status, p_limit, p_offset) → jsonb`:**
  - **one entry per key**: its rows (`row_key`, house, date, title), `source_url` as a hint, and
    every document holding the key (`id`, `title`, `legacy`, `indexed`, the latest job's
    `status` / `stage` / `error_code`);
  - a **status** by precedence: `processing` > `failed` > `full_text` > `full_text_legacy` >
    `record_only`;
  - `total` (keys) and coverage (keys with full text, and orphaned links);
  - search on `record_text` with `%` and `_` escaped; sorted by introduction date (newest first),
    then key; status filtered in SQL; at most 50 per page.
- **`admin_unlinked_documents(p_tier, p_feature, p_query, p_limit, p_offset) → jsonb`:**
  ingestion-v2 documents of the desk with no key, an orphaned key, or a `link_target`.
- **`ingest_link(p_document, p_key, p_expected_key, p_actor)`:**
  - ingestion-v2 only; the desk check (D8, D10); D2; compare-and-set;
  - writes the audit row.
- **`ingest_unlink(p_document, p_expected_key, p_actor)`.**
- **`ingest_swap(p_new, p_expected_old, p_actor)`** (D5).
- **`ingest_delete(p_document, p_actor)`:** `upload:` documents only (D4); cancels the job, then
  deletes.
- **`ingest_register` gains:**
  - `document_key` together with `key_check` (`'desk'` from `admin-ingest`, absent for scripts);
  - `link_target`, `replaces`, `no_public_source`.
- **On resume** (a failed or cancelled job for the same file), the new fields are applied under
  the same checks, or the call is refused when they conflict. They are never dropped.
- **`ingest_discard`** writes an audit row.
- **Indexes:** the D2 index, and `ingest_jobs (document_id, created_at desc)` for "latest job"
  lookups.

**`admin-ingest` (new actions; same admin check, CORS, body cap and logging):**

| Action | Purpose |
| --- | --- |
| `records` | the records view for a desk |
| `unlinked` | documents without a record |
| `link` / `unlink` | link or unlink one document, with compare-and-set |
| `swap` | the second step of Replace |
| `delete` | delete an admin upload |
| `prepare` | also returns whether a live document already holds the target key |
| `register` | takes the link fields |

- **Attaching a file that is already live** returns `already_uploaded` with its document. The
  panel then offers "Link the existing document".
- **New refusal codes:** `key_held`, `stale` and `not_deletable` (409), and `hub_url` (422).

**The Documents page** (`DocumentsPage.jsx`, split into components):

1. **Records:**
   - the desk picker (keyed desks first; others "no record keys yet", standalone only);
   - the coverage and orphaned-links line;
   - search; status chips; paging;
   - per record: status, rows (with a "shared by N rows" note), documents, and actions (Attach,
     Replace, Unlink, Re-link, Delete), each with an in-page confirmation.
2. **Documents without a record:** Link, Delete, Swap.
3. **Upload panel** (Attach, Replace, Standalone): today's panel, plus the record's title, the
   source URL rule, and the legacy or `key_held` warnings.
4. **Jobs:** as today, with a Record column.

**Client:** `corpusCoverage.js` gets the D9 lifetime and re-query.

**Unchanged:** the worker, the staging and verify flow, and `research-chat`.

### Testing and acceptance

- **SQL fixture (non-superuser):**
  - every function's checks and refusals: legacy, other desk, `key_held`, `stale`, `upload:`-only
    delete, resume with link fields;
  - swap atomicity, including the old document deleted in between;
  - the unique index and its pre-check;
  - cascades leaving storage objects;
  - an audit row for each action, and none on a refusal;
  - privileges; the Down section.
- **Deno:** the new actions, the refusal mapping by constraint name, and the hub-URL refusal.
- **Vitest:**
  - the records and unlinked views, the statuses and precedence, actions by status;
  - the upload panel's pre-fill and URL rule;
  - `corpusCoverage` lifetime and re-query.
- Each test is shown red first.
- **Local end to end** (the built-in browser, a local test admin, the local stack):
  - attach the bill to its record: the status goes from processing to full text;
  - in the chat panel, dragging the bill row **without a reload** shows "Full text", and the
    row's computed key equals the linked key;
  - unlink, then re-link, with each step showing in the badge within a minute;
  - replace and swap;
  - delete;
  - a standalone upload on a keyless desk;
  - an orphaned link (a key changed in the local `desk_rows`) shows in both lists;
  - two tabs acting on one record give a `stale` refusal;
  - the audit rows.
- **On NTER** (the owner, signed in):
  1. attach a PDF to one "Record only" bill; drag its row without a reload and check the
     citations;
  2. the split test as a standalone *Budget at a Glance* (split every 10);
  3. delete one test upload.

### Boundaries (in addition to the spec's)

- **Always:**
  - every change goes through the SQL functions, with its audit row in the same transaction;
  - compare-and-set on link changes;
  - legacy documents are read-only;
  - the source URL rule on the admin path.
- **Ask first:**
  - the migration;
  - deploys;
  - any action on NTER data beyond the owner's own test.
- **Never:**
  - unlink, delete or modify a legacy document;
  - delete a content-addressed object;
  - bulk actions across records;
  - deleting R7 documents here.

### Follow-ups (open-work)

- **F40:** keys for the document-holding desks.
- **The legacy decision:** per record, including the 294 duplicate keys.
- **F38:** the sweeper also removes objects orphaned by delete.
- **R7:** handling a key already held (D8), and the delete policy (D4).
- **P14:** bill keys that collide across houses.

### Amendment A review record

A fresh-context adversarial review of revision 2 (2026-10-01) raised 15 findings. All were
accepted:

1. Replace contradicted D2: now the replacement holds `link_target`, and the swap reads it.
2. The key check would break R7: now it binds the admin path only, and scripts register
   unlinked when the key is held.
3. Resume dropped the link fields: now they are applied or refused, and "Link the existing
   document" is offered.
4. The badge cache made "at once" false: now a 60 s lifetime and a re-query on attach.
5. A record is not a key, and keys move: now the view is one entry per key, with shared rows
   shown and an orphaned-links count, and the acceptance compares keys.
6. Unlinked documents had no home: now a "Documents without a record" list.
7. Concurrent admins: now compare-and-set and `stale`, and refusals mapped by constraint name.
8. The hub source URL: now a hint only, hub URLs refused, `file_url` named, and the rule binds
   the admin path only.
9. Status precedence and units: now defined, counted in keys.
10. Delete scope and audit gaps: now `upload:` documents only, and audit rows from register and
    discard too.
11. The duplicate bill desk: now one canonical desk, and the desk check accepts either feature.
12. SQL details: now an index for the latest job, ilike escaping, a defined sort, and the read
    function as security invoker.
13. The audit table: now `actor` has no foreign key, it is read-only to service_role, no emails
    are stored, and its retention is stated.
14. The migration: now it has a Down section and a duplicate pre-check, and is applied as a
    non-superuser.
15. Deleted documents in chat: degradation is accepted and stated.

## Review record

A fresh-context adversarial review of revision 1 (2026-10-01) raised 16
findings. All were accepted:

1. Content addresses could be squatted, and a delete on mismatch could destroy
   a live part: now staging, a verified move, and no deletes at content
   addresses.
2. Splits weren't deterministic: now `updateMetadata: false`, the library
   pinned, and a test.
3. The server re-hash didn't fit Edge limits: now one part per `verify`,
   `node:crypto` streaming, and measured.
4. The content type would be rejected: now an `application/pdf` Blob and
   type, and a test.
5. Desk feature spellings would split modules: now the pair is validated, the
   existing spelling is stored, and the `featureScopeOf` gap is a follow-up.
6. Encrypted PDFs would be wrongly refused, and page counts came from another
   parser: now pdfjs counts, and an encrypted file is uploaded unchanged
   within limits.
7. Parts could balloon, and halving was ambiguous: now annotations are
   dropped, the first range is estimated, and the work-list is specified.
8. A split document was never verified end to end: now "split every N" and an
   NTER run across a part boundary.
9. There was no way out of a bad upload: now `ingest_discard`.
10. Races and error mapping: now unique violations and message mapping give
    409 or 422.
11. The existing-document lookup: now multiple rows are handled, an index is
    added, and the legacy-duplicate limit is stated.
12. There was no server cost guard: now a 5,000-page cap, and embedding cost
    is noted.
13. `verify_jwt`: now off with `requireUser`, plus production probes.
14. Operations and UI: now attempts, next attempt and error are shown, the
    requester's email, fresh tokens, and the schedule's volume is noted.
15. Audit and scope: now actions are logged with the admin's id, any admin
    may act on any job, and the sensitive scopes are declared.
16. Nits: the body cap while reading, a field whitelist, `%PDF-` within 1 KB,
    the memory-measurement method, and orphan cleanup.
