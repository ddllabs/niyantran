# ingestion-v2: the local end-to-end run (plan I7)

> **Status: Historical (dated 2026-10-01).** The local end-to-end run that
> `docs/specs/2026-10-01-rag-v2-ingestion-v2.md` requires before anything
> touches NTER (plan `docs/plans/2026-10-01-rag-v2-ingestion-v2.md`, I7;
> checkpoint E is the owner reading this). Every figure here was **executed**
> on the full local Supabase stack. Mistral OCR and OpenRouter were called for
> real, at a total cost of **$0.197**.

## Set-up

- **Code:** branch `task/rag-v2-ingestion-v2` at `d7f21c7` (checkpoint D
  passed). The two fixes found here are in `d1e5ef8` (see "Findings").
- **Local stack:** a scratch copy of `supabase/` in the session scratchpad.
  - Its migrations are the repository's 40 plus `backend/sql/auth_schema.sql`
    first (as `20260920000000`).
  - Migration `0007` was cut before its cron job, which would otherwise call
    NTER's `refresh-model-pricing` from the laptop. No migration in the copy
    names NTER.
  - Started with `supabase start -x analytics,vector,studio,realtime,imgproxy,mailpit,postgres-meta,supavisor`.
    A full start timed out on health checks of services this test doesn't
    use.
  - All 40 migrations applied, including `20261001140000_ingestion_v2.sql`,
    against Supabase's real storage schema: its first run outside the SQL
    containers.
- **Worker:** `supabase functions serve ingest-worker`, with an env file
  (mode 600, deleted afterwards). It held:
  - the Mistral and OpenRouter keys from `.env.local`;
  - a generated local `INGEST_WORKER_SECRET`;
  - the two localhost-only `INGEST_DOCUMENT_URL_OVERRIDE_<sha>` URLs.
  - Invoked by `curl` with the secret. `GET` gave 405 and a `POST` without
    the secret gave 401.
- **Model:** `GET /v1/models` listed `mistral-ocr-4-1`, aliased to
  `mistral-ocr-4` and `mistral-ocr-latest`, and the worker pins it. Mistral
  echoed `mistral-ocr-4-1` on every call.
- **Documents** (in the gitignored `ingest/pilot/`):

  | Document | Pages | Bytes | sha256 | Source |
  | --- | --- | --- | --- | --- |
  | The Classified Information and Espionage Control Bill, 2025 (Rajya Sabha, as introduced) | 12 | 159,325 | `cf4621b3…` | sansad.in |
  | Budget at a Glance 2026-2027 (Ministry of Finance, February 2026) | 25 | 2,744,811 | `c64dde09…` | indiabudget.gov.in |

  - The spec named RBI's International Investment Position release as the
    chart document. rbidocs.rbi.org.in answered the scripted download with a
    243-byte "Request Rejected" page, and the owner chose a substitute.
  - *Budget at a Glance* is bilingual, has tables and 167 image objects, and
    its cover uses a legacy Hindi font (the text layer is mojibake).

## Results

### The jobs

| Job | Claims | OCR | OCR cost | Chunks | Embedding tokens | Embedding cost | End |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bill | 2 (ocr, index) | 12 pages, 1 call, 3.6 s | $0.048 | 40 | 6,964 | $0.000139 | succeeded |
| Budget | 2 (ocr, index) | 25 pages, 1 call, 6.6 s, 719 KB response | $0.100 | 78 | 41,742 | $0.000835 | succeeded |
| Bill again, resume test | 3 (ocr, index failed, index) | 12 pages, 1 call, 3.0 s | $0.048 | 40 | 6,964 | $0.000139 (logged; see finding 1) | succeeded |

`model_call_logs` holds 3 OCR rows ($0.196, `raw_usage` with `job_id`,
`document_id`, `pages_processed`, `doc_size_bytes`, response bytes) and 3
embedding rows ($0.001113, 55,670 tokens). Each job's costs equal its rows.

### The spec's checks

| Check | Result |
| --- | --- |
| Pages as expected | 12 and 25 `document_pages` rows. **0** pages and **0** chunks whose text differs from their `ocr_text` slice. |
| Blocks | Bill: 176 blocks, all with a box, 166 located in the page text. Budget: 140 blocks, all boxed, 103 located. |
| Sections | Every chunk has one. The bill's carry the chapter heading and the margin note, e.g. `{"heading": "CHAPTER I PRELIMINARY", "note": "Definitions."}`, across pages. |
| Chunks linked to blocks | 40 of 40, and 78 of 78. |
| Images stored and linked | Budget: Mistral returned 16 figure images (not the PDF's 167 raw image objects). All 16 are stored once as `corpus/img/<sha256>.jpeg` (391 kB) and in `document_page_images`; 9 chunks carry `image_ids`. |
| `match_documents` returns the page columns | Called as `authenticated`: page number, `block_ids`, `image_ids` and `section` returned. The best hit is a page-1 chunk linked to a chart. |
| Legacy-font Hindi | Mistral read the cover's mojibake page as proper Devanagari ("बजट का सार"). |
| Re-registration refused | `ingest_register` for the bill again: "already extracted; re-extraction is refused". |
| Forced mid-`index` failure resumes with no new OCR row | A temporary trigger made `ingest_activate` fail once, after all 40 chunks were committed.<br>The activation rolled back whole: no `extract_hash`, no `indexed_at`, and the chunks stayed invisible.<br>The job was re-queued (`internal`, backoff 60 s). After the trigger was dropped, one claim published it.<br>**No new OCR row and no new embedding row**: every stored chunk was skipped. |
| Costs on the job and in `model_call_logs` | They agree, except finding 1. |
| Secrets | `serve.log` holds no key, bearer token, 64-hex value, signed URL or query token. Events only. |

A forced failure **between** slices was tried first, on the budget document.
It never fired: the document has 78 chunks, one slice. Resuming from "slice k
committed" is covered by the Deno tests.

### CPU of the `index` step

`planIndex` (compose, locate, chunk, build the rows), run in Deno on the
laptop from the stored raw pages:

| Input | Chunks | Time |
| --- | --- | --- |
| Budget, 25 pages (warm) | 78 | 17 ms |
| The budget's pages repeated 40 times, 1,000 pages | 3,120 | 547 ms |

The Edge limit is 2 s of CPU, and the spec's threshold for persisting the
composed pages is 1.5 s.
- **One part (≤ 1,000 pages) fits,** even allowing for a slower runtime.
- **A split document of 3,000 pages would not.** The persistence
  optimisation must land before such documents are ingested (open-work F37).

The linked bills are far below that size.

## Findings

1. **A failed activation lost the claim's embedding spend from the job**
   (`model_call_logs` had it). Fixed in `d1e5ef8`: activation moved inside
   the step's reported-error block. The new Deno test was shown red first.
2. **A job that succeeded kept its old error.** Fixed in `d1e5ef8`:
   `ingest_activate` clears `error_code` and `last_error`. The new fixture
   assertion was shown red first ("activate clears an earlier failure's
   error").
3. **The shared logger hides counts.** `_shared/logging.ts` redacts any field
   whose name contains "token", so `embed_tokens` appears as `[redacted]` in
   logs. The value is in the job row. Recorded as F36; out of this module's
   scope.
4. **rbidocs.rbi.org.in refuses scripted downloads.** It may refuse Mistral's
   fetch too. `acquisition` (R7) must plan for its 76 links, e.g. by an
   admin upload. Recorded under R7.
5. **The `index` CPU for split documents** (above). Recorded as F37.

## State after the run

- The local stack is stopped (`supabase stop --no-backup`), and the env file
  holding the keys is deleted.
- Nothing touched NTER. The only NTER interaction this session was read-only
  (the secret-name listing and the extension list).
