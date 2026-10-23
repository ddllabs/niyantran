# Connect supplied corpus text to ingestion

> **Status: Living.** Owner authorized implementation on 2026-10-23, explicitly reusing existing ingestion. Production migration, deployment, paid processing and corpus release are excluded.

## Scope and design

Implements a bounded connection under capabilities A/C of the [umbrella spec](../specs/2026-10-23-supplied-text-bulk-orchestration.md). The supplied text becomes an immutable job input; the existing admin authentication, job queue, worker index loop, shared section-context chunker, embedding provider and chunk commit remain authoritative. The client streams reviewed JSONL/gzip records, validates locally, defaults to dry-run, and submits one document at a time. No new OCR, queue, chunking algorithm or provider.

One source key identifies one immutable document in this connection. Exact retries return the existing job; any changed payload or preexisting source refuses without mutation. Business/case keys are provenance, not a unique document identity. This implementation does not invent historical desk rows, change current record links, collapse orders/translations, resolve ambiguous dedupe winners or automatically promote the reconciliation report's held records. Each input must carry a content-bound review decision and explicit catalogue feature routing. Citation pages/sections retain original code-point ranges plus validated UTF-16 ranges; text-only retrieval does not pretend to provide PDF geometry.

Limits: 600,000 UTF-16 units and 800 chunks per document; 1,000 documents per CLI invocation, sequential registration. Oversize sources are held, never truncated. This is not qualification for 18 million documents. Existing PDF registration and activation stay intact. Existing National manifests remain held.

## Ordered tasks and exact write scopes

1. Shared validated supplied-text input adapter and contract tests (including the shared existing hash-dedup helper in `chunking.ts`): `supabase/functions/_shared/suppliedText.ts`, `suppliedText_test.ts`, `suppliedText_fixture.ts`. Prove hashes, source identities, review binding, incomplete text and offset errors fail before writes; reuse `textContext.ts` unchanged.
2. Durable input/registration/fenced commit and activation: one additive migration, `supabase/tests/supplied_text.sql`, `supabase/tests/run.sh`. Reuse `ingest_jobs`; service-only immutable input table; no existing source update. Verify on disposable PostgreSQL including negative migration removal.
3. Admin registration and existing index-loop connection: `supabase/functions/admin-ingest/{contract,handler,index}.ts`, matching tests; `supabase/functions/ingest-worker/{types,index,index-step}.ts`, `supplied-step.ts` and matching tests; legacy `ingest-documents/handler.ts` and tests refuse durable-text overwrite. New optional dependency methods preserve existing PDF tests. Supplied jobs skip OCR; exact hashes, stale claim, resume and activation failures tested without real providers.
4. Client script and guide: `scripts/corpus-text-import.mjs`, `.test.mjs`, `docs/operations/supplied-text-import.md`. Stream bounded JSONL/gzip with strict size limits, dry-run, reviewed manifest hash confirmation, authenticated admin submission, per-source report and safe retry. Do not expose service credentials to client.
5. Review, full tests and documentation: this plan, umbrella spec, `docs/plans/open-work.md`, `.github/workflows/ci.yml` (add only the new client test command). Record actual outcomes and limitations; no release.

## Verification

`deno test -A --config supabase/functions/deno.json supabase/functions/_shared/suppliedText_test.ts`;
focused admin/worker Deno tests; `node --experimental-strip-types --test scripts/corpus-text-import.test.mjs`;
`./supabase/tests/run.sh supplied_text` (includes missing-migration negative control);
`npm test`; `deno test -A --config supabase/functions/deno.json supabase/functions`;
`npm run test:sql`; `npm run lint`; `npm run build`; `git diff --check`.

## Baseline

Fetched origin; HEAD equals origin/main. Local main is behind by 70 commits, left untouched. Created `task/supplied-text-connection` from current HEAD, preserving prior uncommitted reconciliation documents. No runtime files were dirty at start.

## Local implementation and verification — 2026-10-23

The connection is implemented locally, uncommitted, on `task/supplied-text-connection`.
No production migration, deployment, database write, OCR, embedding-provider call or corpus release was performed. Existing report changes and the National held checkpoint were preserved.

The shared chunker itself is unchanged. Its existing repeated-hash filter now lives in `chunking.ts` so both text paths use the same identity rule. `runIndexPlan` is extracted from the existing PDF index step; both inputs use its embedding/cache/commit loop. The supplied-text branch validates its complete immutable plan before paid work, uses fenced commits, and activates only after SQL verifies every expected vector and source span. Registration is atomic and exact retries return the original job; conflicts refuse without replacement. An immutable-document trigger closes the legacy find/upsert race. The existing claim function retains its cap/backoff for PDF jobs; expired supplied-text claims become explicit reconciliation holds.

| Executed command/check | Outcome |
|---|---|
| `npm test` | 421 files, 6,555 tests passed |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 1,199 passed, zero failed, final source |
| `node --experimental-strip-types --test scripts/corpus-text-import.test.mjs` | 7 passed; gzip, dry-run, conflicting occurrences, target submission, hash binding, uncertain response, incomplete text and oversized-line refusal |
| `npm run test:sql` | All 56 disposable fixtures passed, with required missing-migration negative controls |
| `./supabase/tests/run.sh supplied_text` after guard-removal experiment/restoration | Passed; fixture also fails without its migration |
| `npm run lint` | Passed, zero errors/warnings |
| `npm run build` | Passed, no build warning |
| Actual CLI subprocess, synthetic JSONL and decision manifest, no credentials configured | Exit 0; one ready source, zero submissions, three persisted report lines |
| Legacy overwrite guard temporarily removed | Focused regression failed as intended; source restored and full Deno suite passed |
| SQL immutable-source trigger temporarily removed | Fixture failed on accepted unsafe overwrite; migration restored and fixture passed |
| Known `cut_at_*`/partial-page refusal regression | Failed before fix and passed afterwards |
| `git diff --check`, documentation statuses/relative links, `git diff --exit-code -- public/ backup/` | Passed; data collections unchanged |

New client tests were added to the existing CI job. CI has not run remotely: nothing was pushed. No separate type-check is claimed; Deno's normal test command includes its own checking. No router source changed, so no new router-import execution was needed. Test suites emit their existing deliberate failure-path diagnostic logs (including mocked request/telemetry failures); all suite summaries pass. No standalone Supabase stack/advisor scan or real authenticated hosted pilot was performed; SQL was tested on the repository's disposable Postgres containers as a non-superuser migration role.

The public Supabase changelog and current database-function/Edge-auth documentation were checked. The cited TLS retirement and PG minor-version notices do not require a new API/client mechanism in this adapter; this is not an audit of production upgrades. References: [database functions](https://supabase.com/docs/guides/database/functions), [Edge auth](https://supabase.com/docs/guides/functions/auth), [TLS notice](https://supabase.com/changelog/cbc-tls-ciphers-deprecated), [PG minor-version notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## Deliberate limits / remaining release work

This implements the bounded supplied-text connection, not the full umbrella programme. The client still needs a reviewed decision manifest: package-wide rule interpretation/decision generation, new collection features and record relationships, restricted-serving enforcement, translation-parent resolution, PDF boxes/viewer integration and 18-million-source capacity qualification remain tracked in open work. A review checkbox is not a semantic/legal proof. Known policy exceptions are not auto-approved. The copied input and existing document text consume additional storage; this has not been sized for the entire corpus.

The client is authenticated as an existing platform admin; a dedicated narrower ingestion role was not added. Credentials, provisioning and rollout must be agreed before client handover. Registration can start embedding immediately after release. The chunk cap is a work-size limit, not an exact dollar reservation. Expired/uncertain paid steps require reconciliation, and manual retry may pay again for uncommitted provider work. Exactly-once provider billing is not claimed. Website job monitoring is reused, while new historical desk-row linkage and page highlighting are not implemented.

Changed paths are the scopes enumerated above, the new client guide, and the local migration `supabase/migrations/20261022230537_supplied_text_connection.sql`. Prior National/reconciliation artifacts remain uncommitted alongside this work. Acceptance, commits, publication and production operation are still pending.
