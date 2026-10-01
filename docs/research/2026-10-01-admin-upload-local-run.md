# admin-upload: the local end-to-end run (plan B5)

> **Status: Historical (dated 2026-10-01).** The local end-to-end run that
> `docs/specs/2026-10-01-rag-v2-admin-upload.md` requires before anything
> touches NTER (plan `docs/plans/2026-10-01-rag-v2-admin-upload.md`, B5;
> checkpoint G is the owner reading this). Every result here was **executed**
> through the real Documents tab in the built-in browser, against the full
> local Supabase stack. The real OCR and embedding cost **$0.048**, for the
> bill only.

## Set-up

- **Code:** branch `task/rag-v2-admin-upload` at `d24f641`. Checkpoint F
  passed: lint, build, Vitest 1,221, Deno 743, and all 21 SQL fixtures.
- **Local stack:** a fresh scratch copy of `supabase/`, built as in the
  ingestion-v2 run.
  - `auth_schema.sql` first, and migration 0007 cut before its NTER cron job.
    No migration names NTER.
  - All 41 migrations applied, including `20261001160000_ingest_discard`.
  - Started with the minimal service set.
- **Functions:** `supabase functions serve` for every function, with a mode-600
  env file deleted afterwards. It held the Mistral and OpenRouter keys, a
  generated worker secret, the localhost-only URL override for the bill, and
  the local origins.
- **Dev server:** Vite on :5175 with `VITE_SUPABASE_URL` pointed at the local
  stack. The page's client resolved `admin-ingest` to
  `http://127.0.0.1:54321/functions/v1/admin-ingest`.
- **Test admin:** created on the local stack only and promoted with SQL. Its
  credentials were generated, kept in a mode-600 scratch file, and deleted
  afterwards. A second, non-admin local user was used for the 403 probe.
- **Feeding files:** the built-in browser can't drive the OS file dialog. Each
  PDF was fetched from the dev server and assigned to the tab's real `<input
  type=file>`, followed by a `change` event. Everything after that ran through
  the tab's own code.

## The spec's five checks

| # | Check | Result |
| --- | --- | --- |
| 1 | Upload the 12-page bill through to "succeeded" | **Pass.** See below. |
| 2 | A generated 1,200-page PDF: 2 parts, verified, moved, `document_files` correct; cancelled, then discarded | **Pass.** See below. |
| 3 | Upload the bill again | **Pass.** See below. |
| 4 | A tampered staged part is refused, and only the staged object is removed | **Pass.** See below. |
| 5 | Measurements: a 300 MB PDF in the browser, and `verify` of a ~45 MB part | **Pass.** See "Measurements". |

**Check 1, the bill:**
- The summary read "12 pages · 1 part · 0.16 MB · estimated $0.0480". The
  browser path of pdfjs (the modern build and its worker) ran here for the
  first time.
- Title typed; desk *national · Bill Passage Probability Index*; Upload.
- The tab reported "registered; processing will start shortly", and the job
  appeared RUNNING at attempt 1: `admin-ingest` had started the worker.
- OCR: 12 pages for $0.048. One manual kick, standing in for the schedule,
  ran the index step: 6,964 tokens. The job succeeded.
- Storage held one object, `files/cf4621b3….pdf`; the staging copy had been
  moved, not copied.

**Check 2, the 1,200-page PDF:**
- It was planned in 1.0 s as "1200 pages · 2 parts · 0.27 MB · estimated
  $4.8000".
- Parts: 0 is pages 1–1,000 (225,049 bytes) and 1 is pages 1,001–1,200
  (45,301 bytes), each stored at its own content address at the declared
  size. Nothing was left in staging.
- The worker's OCR was refused by Mistral, because the part's local URL is
  `http`. The job failed permanently at **$0**, with the redacted error shown
  in the table.
- Discard was offered only on that row, with the in-page confirmation. After
  "Confirm discard", the document, its file rows and its job were gone, and
  the three stored objects remained for the sweeper.

**Check 3, the bill again:** "already uploaded as 'The Classified Information
and Espionage Control Bill, 2025' (succeeded)". No bytes were sent.

**Check 4, tampering:**
- (a) Declared hash X, uploaded other bytes: `hash_mismatch` 422, and the
  staged object was deleted.
- (b) A valid copy of the already-stored bill through a fresh staging path:
  `stored: true`; the staged copy was deleted, and the stored object's
  `updated_at` was unchanged (never overwritten).
- (c) An untyped upload: the bucket refused it ("mime type
  text/plain;charset=UTF-8 is not supported"). This confirms review finding 4;
  the library always sends `application/pdf`.

**Further checks:**
- **Discard of a live document:** `not_discardable` 409 "already live".
- **A signed-in non-admin:** 403 "platform admins only" on all 7 actions.
- **No token:** 401 with the function's own body.
- **The jobs row's `indexed` flag** (added in `d24f641`): the live bill showed
  `indexed=true`, and Discard was hidden on it.
- **Logs:** every action is logged with the admin's `user_id`. `serve.log`
  holds no bearer token, JWT, secret key or signed-URL token.

## Measurements

**The browser, on a 290.7 MB PDF** (269 pages of incompressible images):

| Measure | Value |
| --- | --- |
| Plan (hash, pdfjs inspect, pdf-lib split, per-part checks) | **2.2 s**, 7 parts |
| JS heap: before, peak, after planning | 39 MB, **1,019 MB**, 930 MB |
| Heap limit | 4,396 MB |
| Upload, verify and register of all 7 parts | **13.1 s** |

- The pass bar was no crash and under 2 GB: passed.
- The first range was 41 pages: 45 MB at about 1.08 MB per page.
- The parts were contiguous: offsets 0, 41, … 246, totalling 269 pages.
- The parts were then discarded.

**`verify` on the server** (the function's `admin_ingest.verify` log;
wall-clock, streamed read plus SHA-256):

| Part | Time |
| --- | --- |
| 44.3 MB | 276, 310, 312, 316, 341, 467 ms |
| 24.8 MB | 157 ms |

The Edge runtime container used 240 MB in total across every function served,
so memory stays flat while streaming. This is well inside the 2 s CPU and 256
MB per-request limits; CPU time is a fraction of the wall-clock figures.

## Findings

1. **Local CORS headers are the gateway's.**
   - Locally, a refused `admin-ingest` request carries
     `access-control-allow-origin: *`, plus methods and headers our function
     never sets. `research-chat` shows the same.
   - So it is the local API gateway, not our code; the body is the function's
     own.
   - Production CORS is checked with the B6 probe from the production origin.
2. **The Overview header's `/api/users` call gave 503 in this set-up.** The
   Vite route uses `.env.local`'s NTER service key with a local-stack JWT. It
   has nothing to do with this module, and doesn't happen in production.
3. **Splitting can't be fully tested locally.** Mistral can't fetch local
   parts, which are `http`. The OCR of a split document is proven on NTER
   (B6, "split every 10 pages").

## State after the run

- The dev server and the local stack are stopped.
- The env file and the test-admin credentials are deleted.
- The temporary launch entry is removed, and so are the test PDF copies
  (`ingest/b5/`).
- Nothing touched NTER.
