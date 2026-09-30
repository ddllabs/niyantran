# Plan: RAG v2, part 2a — `ingestion-v2`

> **Status: Living (2026-10-01).** It implements
> `docs/specs/2026-10-01-rag-v2-ingestion-v2.md` (approved), and is tracked as
> open-work R4. It becomes Historical when I8 lands. The pilot (R5),
> `citations-pdf` (R6), `acquisition` (R7) and `admin-upload` (R8) get their
> own specs and plans.

## Ground rules

These are part 1's rules, plus the lessons from part 1:

- **Every migration** is tested as a non-superuser.
- **No custom-setting `SET` clauses.**
- **Paged reads** everywhere.
- **Secret values** are handled only by the owner.
- **Paid calls:** anything that calls Mistral or OpenRouter on NTER needs a
  go-ahead. Local runs that call them cost cents, and are covered by the
  approved local end-to-end test.

## Fixed interfaces (so tasks can run in parallel)

- **`supabase/functions/ingest-worker/types.ts`** is written first, by the
  supervisor. It defines:
  - `IngestJob` (the `ingest_jobs` row);
  - `FilePart` (a `document_files` row);
  - `RawOcrPage` (the `document_ocr_pages.raw` shape: markdown, header,
    footer, dimensions, blocks, tables, and images as
    `{id, bbox, sha256, mime}`);
  - `OcrCallResult` (pages, `usage_info`, `bytes`);
  - `StepOutcome` (the patch for `ingest_advance`);
  - `WorkerDeps`: the database via PostgREST (paged), storage, Mistral fetch,
    OpenRouter embed, clock, and log.
- **SQL function signatures,** exactly as in the spec: `ingest_register`,
  `ingest_claim`, `ingest_advance`, `ingest_retry`, `ingest_cancel` and
  `ingest_activate`.

## Tasks

**I0. Interfaces** (supervisor, XS). **File:**
`ingest-worker/types.ts`. **Check:** `deno check`.

**I1. Migration and fixture** (agent, M). **Files:**
`supabase/migrations/<ts>_ingestion_v2.sql`,
`supabase/tests/ingestion_v2.sql`, `supabase/tests/run.sh`.

- The migration contains the bucket, `document_files`,
  `document_ocr_pages`, `ingest_jobs` and the six functions.
- `run.sh` is generalised so the non-superuser wrapper takes any migration
  name.

**Acceptance:**
- the spec's SQL test plan, with each assertion shown red on its own;
- `page_contract`, `feature_filter` and `halfvec_retrieval` stay green.

**I2. OCR step and pure helpers** (agent, M). **Files:**
`ingest-worker/{hashes,mistral,images,ocr}.ts` and their tests.

- **hashes:** `ocr_hash` and `extract_hash` as canonical JSON.
- **mistral:** the request builder, response mapping, the index check,
  `usage_info` to cost, and classifying 429, 5xx and other 4xx.
- **images:** base64 decoding, SHA-256, the extension from the MIME type,
  and the size and count caps.
- **ocr:** the cursor from stored pages across parts, range selection, the
  adaptive range, and the step itself against `WorkerDeps` fakes.

**Acceptance:** the spec's Deno tests for these parts, including a
synthetic image fixture. Each test is shown red first.

**I3. Index step** (agent, M), in parallel with I2. **Files:**
`ingest-worker/index-step.ts` and its test; `_shared/pageText.ts`
(`COMPOSITION_VERSION` only); `ingest-documents/handler.ts` and its test
(refuse on `storage_path` too).

The step composes, writes pages, blocks and images (with the placeholder
mapping), then embeds and commits in slices of 100, resumes on the time
budget, and activates last.

**Acceptance:**
- resume from every sub-step;
- a stored pair is never embedded;
- slice-by-slice commits;
- activation last;
- the placeholder mapping on a synthetic image fixture;
- the `ingest-documents` refusal.

**I4. Worker entry** (agent, S–M), after I2 and I3. **Files:**
`ingest-worker/{index,handler}.ts` and its test; `supabase/config.toml`.

- the secret check in constant time;
- `202` plus `waitUntil` with a 100 s budget;
- claim one job, run its stage's step, advance or report failure with
  redaction;
- cost logged before writes;
- the localhost-only URL override, with a test that it is ignored
  elsewhere.

**I5. Operator scripts** (supervisor, S). **Files:**
`scripts/ingest-register.mjs` (`pdfjs-dist` page count, hashing, upload with
TUS above 6 MB, register) and `scripts/ingest-ops.sh` (`secret`,
`schedule on|off`, `kick`).

**Acceptance:** lint; a dry run of the register script against the local
stack (in I7).

**Checkpoint D:** both suites, lint, build, `npm run test:sql` and the
router import pass; the supervisor reviews every diff.

**I6. Downloads** (supervisor; **owner go-ahead**). The two public PDFs, the
12-page bill and the RBI International Investment Position release, go to a
gitignored `ingest/pilot/` folder.

**I7. Local end to end** (supervisor, on the full local Supabase stack).
1. `supabase start` from a scratch copy.
2. Serve the worker with a local env file holding the Mistral and OpenRouter
   keys.
3. `GET /v1/models` to pin the model.
4. Register both PDFs and kick the worker until both jobs are `done`.
5. Record every check from the spec, plus the `index` CPU time.
6. Stop the stack.

The report goes in `docs/research/<date>-ingestion-v2-local-run.md`.

**Checkpoint E (owner):** read the local report.

**I8. First document on NTER** (each step needs its own go-ahead):
1. Apply the migration and pin its version; verify it live (read-only).
2. **Owner:** `supabase secrets set MISTRAL_API_KEY=…`, then
   `scripts/ingest-ops.sh secret`.
3. Deploy `ingest-worker` and `ingest-documents`, and probe both.
4. Register the 12-page bill, which uploads it to NTER's `corpus`.
5. `ingest-ops.sh kick`, or the same call through SQL reading Vault, until
   the job is `succeeded`.
6. Verify: pages, chunks, the page columns in `match_documents`, and the
   costs.
7. **Owner:** a signed-in citation check.
8. Record in `coordination.md`, and mark R4 done.

The schedule stays **off**.

## Order and parallelism

```
I0 ─┬─ I1 (SQL) ──────────┐
    ├─ I2 (OCR, pure) ─┐  │
    ├─ I3 (index) ─────┴─ I4 ─ checkpoint D ─ I6 (go) ─ I7 ─ checkpoint E ─ I8 (go per step)
    └─ I5 (scripts) ──────┘
```

I1, I2, I3 and I5 have disjoint files and run in parallel worktrees. I4
waits for I2 and I3.

## Risks

| Risk | Mitigation |
| --- | --- |
| Mistral rate limits on the Scale plan's Tier 1 | Run at most 2 jobs; back off on 429; attempts counted at claim time |
| Very large responses (scanned pages with images) | Adaptive range and image caps; measured in I7 and the pilot |
| Recomputing the `index` step uses too much CPU on big documents | Measured in I7; persist the composed pages if it exceeds 1.5 s |
| A non-superuser migration fails on NTER | Tested as a non-superuser; no custom-setting `SET` clauses |
| A secret leaks | Owner-run operator steps; Vault read on the server; errors redacted |
