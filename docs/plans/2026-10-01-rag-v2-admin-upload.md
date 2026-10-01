# Plan: RAG v2 — `admin-upload` (R8)

> **Status: Living (2026-10-01).** It implements
> `docs/specs/2026-10-01-rag-v2-admin-upload.md` (approved), and is tracked as
> open-work R8. It becomes Historical when B6 lands.

## Ground rules

These are the ingestion-v2 rules, plus the spec's own:
- **Migrations** are tested as a non-superuser, with no custom-setting `SET`
  clauses.
- **Paged reads.**
- **Server-side admin checks** on every action.
- **Staging, then a verified move.**
- **Deterministic splits.**
- **Agents never sign in to production.** Local test admins exist only on the
  local stack.
- **Agents work in worktrees.** If the worktree was created at an older
  commit, fast-forward it to the branch tip first.

## Fixed interfaces (so B1–B3 can run in parallel)

### `admin-ingest`: one POST endpoint, `{ action, ... }`

The canonical TypeScript is `supabase/functions/admin-ingest/contract.ts`
(B0). The browser mirrors it in JSDoc.

Every response is JSON:
- success: `{ ok: true, ... }`;
- failure: `{ ok: false, code, error }`.

| HTTP | `code` |
| --- | --- |
| 400 | `bad_request` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 409 | `already_uploaded` or `not_discardable` |
| 413 | `too_large` |
| 422 | `hash_mismatch` or `refused` |
| 503 | `unavailable` |

| Action | Request | Response |
| --- | --- | --- |
| `prepare` | `file_sha256`, `page_count`, `parts[] {sha256, byte_size, page_count}` | `documents[] {document_id, source_key, title, indexed, job_status}` and `parts[]`: `{sha256, stored: true}` or `{sha256, stored: false, staging_path, token}` |
| `verify` | `staging_path`, `sha256`, `byte_size` | `{stored: true, path}` |
| `register` | `file_sha256`, `page_count`, `parts[] {part_index, page_offset, page_count, sha256, byte_size}`, `title`, `desk_tier`, `desk_feature`, `file_url?`, `note?`, `file_name` | `{document_id, job_id}` |
| `jobs` | `limit?` (≤ 50), `before?` (an ISO timestamp cursor) | `jobs[]` and `next_before` (see below) |
| `retry` / `cancel` | `job_id` | `{status, stage}` |
| `discard` | `document_id` | `{discarded: true}` |

A `jobs[]` row has:
- `job_id`, `document_id`, `title`, `source_key`;
- `desk_tier`, `desk_feature`, `indexed` (the document is live, so it cannot be discarded);
- `status`, `stage`, `ocr_pages`, `pages_total`;
- `attempts`, `next_attempt_at`, `error_code`, `last_error`;
- `ocr_cost_usd`, `embed_tokens`, `embed_cost_usd`;
- `requested_by_email`, `created_at`, `finished_at`.

**Storage:** the browser uploads with
`supabase.storage.from('corpus').uploadToSignedUrl(staging_path, token, Blob(type application/pdf), { contentType: 'application/pdf' })`.
The staging path is always `staging/<uuid>.pdf`.

### SQL

- **`ingest_discard(p_document uuid) returns jsonb`:** service_role only.
  - It returns `{discarded: true}`.
  - Otherwise it raises `ingest_discard: <reason>`. The reasons are:
    `not an upload`, `already live`, and `has an active or succeeded job`.
  - A missing document also raises.
- **Index `documents_file_sha256`** on `documents(file_sha256)` where it is not
  null.

### `src/lib/corpusUpload.js` exports (B3 provides them, B4 uses them)

**Constants:** `MAX_FILE_BYTES = 300_000_000`, `PART_MAX_BYTES = 50_000_000`,
`PART_MAX_PAGES = 1000`, `USD_PER_1000_PAGES = 4`, `MAX_REGISTER_PAGES =
5000`.

**Functions:**
- `sha256Bytes(bytes) → Promise<hex>`
- `inspectPdf(bytes) → Promise<{ pages, encrypted }>`, using `pdfjs-dist`.
- `planUpload({ name, bytes }, { splitEvery? }) → Promise<Plan>`:
  - a `Plan` is `{ file_name, file_sha256, page_count, encrypted,
    estimated_usd, parts[] {part_index, page_offset, page_count, sha256,
    byte_size, bytes} }`;
  - it throws `UploadError(code, message)` with the code `not_pdf`,
    `too_large`, `encrypted_split`, `page_too_large` or `too_many_pages`.
- `estimateCostUsd(pages)`
- `deskPairs() → [{ tier, feature }]`, from
  `supabase/functions/_shared/deskCatalog.json`.
- `createAdminIngestApi({ fetch, url, accessToken }) → { prepare, verify,
  register, jobs, retry, cancel, discard }`. Each call fetches a fresh token
  and throws `UploadError(code, error)` on `ok: false`.
- `uploadPlan(plan, meta, { api, storage, onProgress }) → Promise<{
  document_id, job_id } | { existing: document }>`. Progress events are
  `{part_index, state}`, where the state is `queued`, `uploading`,
  `verifying` or `stored`.

## Tasks

**B0. Interfaces and the dependency** (supervisor, XS).
- `admin-ingest/contract.ts`;
- `npm install --save-exact pdf-lib@1.17.1`;
- the pdfjs worker in the browser via Vite (`pdfjs-dist/build/pdf.worker.min.mjs?url`);
- `deno check`, `npm run build`.

**B1. Migration and fixture** (agent, S). Files:
`supabase/migrations/<ts>_ingest_discard.sql`, `supabase/tests/ingest_discard.sql`,
`supabase/tests/run.sh` (a chain entry, applied as a non-superuser).
- **Acceptance:**
  - each refusal and the cascade, each shown red;
  - the full `npm run test:sql` green.

**B2. `admin-ingest`** (agent, M). Files:
`supabase/functions/admin-ingest/{handler,index}.ts` and tests,
`supabase/config.toml`.
- **Acceptance:**
  - the spec's Deno tests;
  - the streamed `node:crypto` hash;
  - staging-only deletes;
  - message-to-status mapping;
  - the desk pair resolved to the spelling `document_modules()` already uses;
  - every action logged with `user_id`.

**B3. The browser library** (agent, M). Files: `src/lib/corpusUpload.js` and
`src/lib/corpusUpload.test.js`.
- **Acceptance:**
  - the spec's Vitest list;
  - splitting the same input twice gives the same hashes;
  - `contentType`;
  - the edges of the part plan.

**B4. The Documents tab** (agent, S–M), after B3. Files:
`src/admin/DocumentsPage.jsx`, `src/admin/documentsPage.test.jsx`,
`src/admin/AdminApp.jsx` (NAV and render), `src/admin/admin.css` (one
progress style).
- **Acceptance:** the component tests from the spec; lint and build.

**Checkpoint F:** lint, build, both suites, `npm run test:sql`; the supervisor
reviews every diff.

**B5. Local end to end** (supervisor):
- the local stack, the dev server through the preview tools, and a local test
  admin;
- the spec's five checks and measurements;
- the report in `docs/research/<date>-admin-upload-local-run.md`.

**Checkpoint G (owner):** read the report.

**B6. NTER** (a go-ahead for each step):
1. apply the migration and verify it;
2. deploy `admin-ingest` and probe it from the production origin;
3. merge and push the frontend, then check the Vercel deploy is READY;
4. switch the schedule on and read back its cron row;
5. **the owner** uploads the budget document with "split every 10" and checks
   citations on pages 10 and 11;
6. record in `coordination.md` and mark R8 done.

## Order and parallelism

```
B0 ─┬─ B1 (SQL) ──────────────┐
    ├─ B2 (admin-ingest) ─────┤
    └─ B3 (corpusUpload) ─ B4 ┴─ F ─ B5 ─ G ─ B6 (go per step)
```

## Risks

| Risk | Mitigation |
| --- | --- |
| `pdf-lib` memory on large files | 300 MB cap; measured in B5 |
| Edge CPU for `verify` | One part per request; `node:crypto` streaming; measured in B5 |
| The pdfjs worker in Vite and the bundle size | Lazy `import()` in the admin tab only; checked with `npm run build` |
| Local Mistral access to split parts | Local OCR uses the override for whole files only; the split path is proven on NTER in B6 |
