# Spec: platform-admin document upload (`admin-upload`)

> **Status: Normative — draft, revision 2, for the owner's review
> (2026-10-01).** Module `admin-upload` of
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

In one statement, it deletes the document only when all of these hold:
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
- Matching an upload to a legacy or R7 corpus record (decision 3).
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
