# Spec: platform-admin document upload (`admin-upload`)

> **Status: Normative — draft for the owner's review (2026-10-01).** Module
> `admin-upload` of `docs/specs/2026-09-30-rag-v2-capability-map.md`
> (open-work R8). It feeds the pipeline of
> `docs/specs/2026-10-01-rag-v2-ingestion-v2.md` (R4, live on NTER since
> 2026-10-01) through its single entry point, `ingest_register`. The owner
> moved this module ahead of R5–R7, because admin upload is the milestone.

## Objective

A **platform admin** opens the admin panel, picks one or more PDFs of **any
size**, fills in a title and the desk they belong to, and presses one button.

- The PDFs land in the private `corpus` bucket.
- They are registered with `ingest_register`, OCR'd, chunked and embedded by
  the worker already live on NTER.
- They become searchable, with page citations, without anyone opening a
  terminal.

The admin sees each job's progress, cost and errors, and can retry or cancel
it.

**Who:** users for whom `is_platform_admin()` is true (`user_profiles.role =
'admin'`, `status = 'active'`). Nobody else can upload, see the tab's data, or
call its backend. Chat uploads and a file manager are out of scope (capability
map).

**Done looks like:**
1. The owner, signed in as an admin on production, uploads a PDF from the
   admin panel.
2. Within minutes it is searchable in the chat with page citations, without
   any terminal step.
3. A PDF of more than 1,000 pages or more than 50 MB is split in the browser
   and ingested as one document with continuous page numbers.

## Current state (read and executed 2026-10-01)

- **Admin panel:** at `/admin`, gated in the UI by `verifyAdminSession`
  (`src/admin/adminSession.js:12-56`), which checks `is_platform_admin` and
  `get_my_profile`.
  - "UI gate only": every backend call checks again. Two patterns exist:
    - Vercel routes: `server/usersApi.mjs:46-80` `authorizeLocalUser({admin:true})`;
    - the Edge Function `admin-models`: `requireUser`, then
      `rpc('is_platform_admin')` with the caller's JWT, then
      `serviceClient()` for the writes.
  - Tabs are a `NAV` array plus one conditional render (`AdminApp.jsx:14-24`
    and `:184-192`). Styles are in `admin.css` (`.adm-card`, `.adm-table`,
    `.adm-form`, `.adm-btn`, `.adm-msg`, `.adm-hint`).
- **The one existing admin upload** is the homepage video.
  - A server route mints `createSignedUploadUrl` (secret key, fixed path).
  - The browser calls `uploadToSignedUrl` straight to Storage.
  - A finalize call checks the object (`src/lib/marketingIntroVideo.js`,
    `server/marketingMediaApi.mjs`).
  - The `marketing` bucket has no object policies.
- **The pipeline (live):**
  - bucket `corpus`: private, 50,000,000 bytes, PDF/JPEG/PNG/WebP, **no
    object policies**;
  - `ingest_register(p)`: service_role only. It validates that parts are
    contiguous, that each path is `files/<sha256>.pdf`, and that each object
    exists at the stated size. It refuses legacy documents, re-extraction and a
    changed file;
  - the worker `ingest-worker`, with `INGEST_WORKER_SECRET`;
  - the **schedule is off.** Today jobs advance only when someone runs
    `scripts/ingest-ops.sh kick`.
- **Browser tooling:**
  - `pdfjs-dist` is a dependency but is **not** used in `src/`.
  - No PDF-writing library is installed.
  - `crypto.subtle` SHA-256 exists for text (`src/lib/textNormalise.js`).
- **Tests:**
  - Vitest in the node environment. There is no DOM library; component tests
    use `renderToStaticMarkup` (`src/admin/usersPage.test.jsx`).
  - Edge Functions use Deno tests (`admin-models/handler_test.ts`).
- **Desk catalog** for the tier and feature: `src/lib/deskCatalogBuild.js`.
  `documents.desk_feature` must match a catalog feature exactly, or the desk
  filter (`match_documents`' `p_desk_feature`) will never find the document.

## Owner decisions (recommendations in bold)

1. **Backend: a new Edge Function `admin-ingest`** (the `admin-models`
   pattern), not a Vercel route.
   - It sits next to the pipeline, and can start the worker with the secret
     all functions already share. That keeps `INGEST_WORKER_SECRET` off
     Vercel.
   - It adds no route to ADR 0010's list and no Vercel function.
2. **Upload: signed upload URLs per part** (the video pattern). The `corpus`
   bucket keeps **no** object policies, and the browser never holds a key.
3. **Integrity: the server re-hashes each uploaded part before registering.**
   It downloads the object and computes SHA-256. A mismatch deletes the object
   and refuses the upload. Paths are content-addressed, so a wrong-hash object
   would poison every later upload of that file.
4. **Document key: `upload:<file_sha256>`.** The same file uploaded twice is
   the same document: the second upload shows the existing one instead of
   creating a copy.
5. **Splitting: in the browser with `pdf-lib`** (MIT, 1.17.1). This is **a new
   dependency: ask first.**
   - It is lazy-loaded only in the admin tab, so the public bundle doesn't
     grow.
   - `pdfjs-dist` can read PDFs but cannot write them.
   - A file within Mistral's limits (≤ 50,000,000 bytes and ≤ 1,000 pages) is
     uploaded **unchanged**. Only larger files are split.
6. **Metadata the admin fills in:**
   - title (required; defaults to the file name);
   - desk tier and feature (required; from the catalog, so the desk filter
     works);
   - source URL (optional);
   - a note (optional).
7. **Processing: switch the schedule on at go-live** (`ingest-ops.sh schedule
   on`, every 30 s, at most 2 jobs running). In addition, `admin-ingest` starts
   the worker once right after registering, so the OCR begins at once. **This
   is an owner go-ahead.**
8. **Browser size ceiling for v1: 300 MB per file,** measured in the build.
   "Any size" is bounded by the admin's browser memory, since `pdf-lib` holds
   the whole file. It is raised when measurements allow. A larger file is
   refused with a clear message.

## Design

### The flow, per file

1. **Read** the file as an `ArrayBuffer`. Refuse it unless it starts with
   `%PDF-` and is at most 300 MB.
2. **Inspect** it with `pdf-lib`: page count, and refuse an encrypted PDF
   ("password-protected PDFs can't be ingested"). SHA-256 of the whole file is
   `file_sha256`.
3. **Plan the parts:**
   - within the limits: one part, the original bytes, `sha256 = file_sha256`;
   - otherwise: consecutive ranges of at most 1,000 pages. Each is built with
     `copyPages` and saved. If a saved part exceeds 50,000,000 bytes, its range
     is halved and rebuilt. A single page over the limit refuses the file.
   - Each part gets its own SHA-256; `page_offset` is the pages before it.
4. **Show a summary** before anything is sent: pages, parts, size, and the
   estimated OCR cost at $4 per 1,000 pages. The admin confirms.
5. **`prepare`:** the server returns, per part, either "already stored" or a
   signed upload URL for `files/<sha256>.pdf`. If a document with this
   `file_sha256` already exists, it returns that document instead, and the
   browser shows it without uploading.
6. **Upload** each missing part with `uploadToSignedUrl`, showing progress per
   part.
7. **`register`:**
   - the server checks each part's size and SHA-256 (decision 3);
   - it calls `ingest_register` with `source_key = upload:<file_sha256>`,
     `requested_by` = the admin's id, and metadata: the original file name,
     the note, the uploader and the part list;
   - it starts the worker once.
8. The file appears in the **jobs list**.

Several files are processed one after another in a queue. Closing the tab
before step 7 leaves stored objects but no document. Uploading again finds
them (step 5) and continues.

### `admin-ingest` (Edge Function, `verify_jwt` on)

Every request:
- is POST;
- carries `authorization: Bearer <user JWT>`;
- passes `requireUser`, then `rpc('is_platform_admin')` with the caller's
  token (401 or 403 otherwise, and nothing is touched).

The work uses the service client. JSON bodies are capped at 64 KB.

| Action | Input | Result |
| --- | --- | --- |
| `prepare` | `file_sha256`, `page_count`, `parts[] {sha256, byte_size, page_count}` | `{existing}` or `{parts[] {sha256, path, stored, token?}}` |
| `register` | the above, plus `title`, `desk_tier`, `desk_feature`, `file_url?`, `note?`, `file_name` | `{document_id, job_id}`, or 409/422 with a reason |
| `jobs` | `limit ≤ 50`, `before?` (cursor) | recent jobs with document title, stage, pages, costs, error, `requested_by` |
| `retry` / `cancel` | `job_id` | the job's new status (`ingest_retry` / `ingest_cancel`) |

**Validation:**
- hashes are 64 lowercase hex;
- sizes are between 1 and 50,000,000;
- page counts are ≥ 1, and the parts sum to `page_count` in order;
- tier and feature are in the catalog (a copy shared with the function, or
  checked against `_shared/deskCatalog.json`);
- title is 1–300 characters;
- `file_url` is http(s) or empty.

**Integrity (decision 3):**
- The function streams the object from Storage through SHA-256. A 50 MB part
  fits in memory and CPU; this is measured in the build.
- On a mismatch it deletes that object and returns 422.

**Starting the worker:** a `fetch` to `ingest-worker` with
`INGEST_WORKER_SECRET`, not awaited beyond the 202. Its failure only logs; the
schedule catches up.

### The admin tab: "Documents"

- **Upload card:** a file picker (multiple, `application/pdf`), the per-file
  summary and form, a confirm button, and per-part progress.
- **Jobs table:** title, desk, pages done of total, stage, status, OCR and
  embedding cost, error (already redacted by the pipeline), requested by,
  when; Retry and Cancel where allowed. It refreshes every 10 s while any job
  is queued or running.
- It follows `admin.css`, adding at most one progress style.

### Code layout

- `src/lib/corpusUpload.js`: pure and injectable pieces. It holds `sha256Bytes`,
  `planParts`, `splitPdf` (pdf-lib, lazy `import()`), `estimateCostUsd`, and
  the client orchestration with `fetch` and storage injected (the video
  client's pattern).
- `src/admin/DocumentsPage.jsx`: the tab; a `NAV` entry in `AdminApp.jsx`.
- `supabase/functions/admin-ingest/{handler,index}.ts` and tests.
- **No migration is expected.** The service client reads `ingest_jobs` with
  the related document through PostgREST. If one turns out to be needed, it
  is an ask-first change.

## Security

- Admin-ness is checked on the server on **every** action. The UI gate is not
  trusted.
- The browser never gets a service key. Signed upload URLs are:
  - one per object;
  - only for `files/<64 hex>.pdf`;
  - never with upsert, so an existing object is never overwritten.
- Content addressing is enforced by the server's re-hash (decision 3).
- The worker secret stays in Supabase; the browser never sees it.
- Uploaded PDFs are untrusted data: they are parsed only by `pdf-lib` in the
  admin's own browser and by Mistral, never by our servers beyond hashing.
- Job errors shown to admins are the pipeline's redacted `last_error`.

## Testing strategy

- **Vitest (`src/lib/corpusUpload.test.js`):**
  - hashing bytes;
  - `planParts` at the edges: exactly 1,000 pages and 50,000,000 bytes, 1,001
    pages, oversized parts halved, a single oversized page refused;
  - `splitPdf` on PDFs generated in the test with `pdf-lib`: page counts,
    order, offsets and continuity;
  - refusals: encrypted, non-PDF, over 300 MB;
  - the orchestration with a fake `fetch` and storage: an existing document
    short-circuits, stored parts are skipped, errors surface;
  - the cost estimate.
- **Component test (`DocumentsPage`),** in the `usersPage.test.jsx` style:
  the summary, the confirm gate, the jobs table, and the Retry and Cancel
  buttons by status.
- **Deno (`admin-ingest/handler_test.ts`):**
  - 401 and 403 with nothing touched;
  - every validation;
  - `prepare`: existing document, stored and missing parts;
  - `register`: a hash mismatch deletes and refuses; success calls
    `ingest_register` with the right `p` and starts the worker; a failed start
    still registers;
  - `jobs` paging;
  - `retry` and `cancel`.
- Each test is shown red first.
- **Local end to end** on the local stack, with the dev server and a local
  test admin (test credentials on localhost only):
  1. upload the 12-page bill from the tab, through to "succeeded", and
     search it;
  2. upload a generated PDF of 1,200 pages: split into 2 parts, both stored,
     `document_files` correct. The job is **cancelled before OCR** to avoid
     $4.80;
  3. upload the bill again: "already uploaded" is shown;
  4. a tampered part (a fake `prepare` response) is refused;
  5. measure the browser's memory and time on a 300 MB PDF, and the server's
     re-hash time on a 50 MB part.
- **On NTER:** after the deploy, **the owner** uploads one PDF signed in as an
  admin (agents do not sign in to production).

## Commands

- `npm run lint`, `npm run build`, `npm test`
- `deno test -A --config supabase/functions/deno.json supabase/functions`
- `npm run test:sql` (unchanged unless a migration is added)
- The router import check, if anything under `api/` or `server/` changes (not
  planned).

## Boundaries

- **Always:**
  - check admin-ness on the server;
  - content-addressed parts, re-hashed before registering;
  - one pipeline (`ingest_register`);
  - paged reads;
  - a cost shown before the upload.
- **Ask first:**
  - adding `pdf-lib`;
  - any migration;
  - deploying `admin-ingest` and the frontend;
  - switching the schedule on;
  - any upload on NTER.
- **Never:**
  - object policies that open `corpus` to users;
  - a service key or the worker secret in the browser;
  - Mistral called from the browser;
  - splitting inside an Edge Function;
  - overwriting a stored part;
  - touching the 2,338 legacy documents.

## Acceptance evidence

1. Lint, build, both test suites (and the SQL fixtures if a migration is
   added) pass, with per-test fail-first evidence.
2. A local end-to-end report (`docs/research/<date>-admin-upload-local-run.md`)
   with the five checks above.
3. After the go-aheads: `admin-ingest` and the frontend are deployed, and the
   schedule is on.
   - The owner uploads a PDF from the production admin panel.
   - It reaches "succeeded" with no terminal step.
   - The owner finds it cited with a page number in the chat.
   - It is recorded in `coordination.md`.

## Exclusions

- Deleting or replacing an ingested document, and re-extraction (a later
  module).
- Uploads by non-admins, a chat composer upload, and a file manager.
- Formats other than PDF.
- The PDF viewer and box highlights (R6).
- Automatic metadata extraction (the admin types the title).
- Matching an upload to a legacy or linked corpus record. An upload gets its
  own `upload:` key; R7 keeps the corpus record ids.

## Open questions for the owner

1. The eight decisions above. I recommend each as written; decisions 5
   (`pdf-lib`) and 7 (the schedule) are explicit go-aheads.
2. **The 300 MB browser ceiling for v1.** Is there a real document you expect
   to be larger?
3. **Who may upload:** every platform admin, as recommended, or only the
   owner?
