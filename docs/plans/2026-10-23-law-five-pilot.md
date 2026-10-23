# Five-document Law pilot

> **Status: Historical (2026-10-23).** Owner requested a five-document test before larger batches.

Scope: reproducibly extract five exact NCLT sources from the shared ZIP, run the existing supplied-text adapter and chunker offline, and document the client procedure. Scripts must bind ZIP member and record hashes, preserve original text, reject corrupted input, and never create production approval decisions automatically. Write scopes: scripts/law-five-*, docs/operations/law-five-pilot.md, this plan and open-work.md. No new ingestion engine. Hosted registration, real embeddings, activation and citation retrieval remain a subsequent release gate because the connector migration/functions are not deployed.

Verification: run the pilot on the actual local archive; mutate one byte and prove refusal; run importer tests and lint/build. Report offline checks separately from database ingestion.

## Executed evidence

Actual shared ZIP extraction and Node offline pilot passed: five documents, 97 pages, 241 chunks; original text preserved. All 15 adapter rejection checks passed. A one-byte modification of the actual extracted corpus failed the pinned record check before output. Existing importer tests: 7 passed. No ingestion or provider calls. Test result: `/tmp/law-five-result.json` (transient); client commands reproduce it. Hosted activation/retrieval and actual policy eligibility remain unverified.

## Authorized release and live pilot

Owner explicitly authorized connector release and actual Supabase ingestion of these five sources, citation/index verification and duplicate-safe rerun. Target: NTER `vfgcppstyzjarlzyqdac`. Ordered gates: final local tests and review; protected PR with both CI jobs; migration plus only admin-ingest, ingest-worker and ingest-documents; authenticated importer registration capped at 241 chunks; five succeeded jobs and exact stored hashes/chunk plans; retrieval/citation checks; identical rerun with unchanged IDs/counts/spend; client guide finalized. No larger batch or National continuation. Before admission, five source keys were absent and all three pack policy CSVs had no matching source entries. Original records declare public tribunal orders and NCLT attribution. Baseline: 3,459 documents, 3,456 indexed, 100,716 chunks, zero queued/running jobs. Rollback before admission: restore previous three function bundles; retain additive migration. After admission: hold further registrations and retain immutable source/job evidence; no deletion.

Release prerequisite: the full app suite reproduced two failures in `src/lib/feedServeRoute.test.js`; its fixed October 15 article aged out of the seven-day news filter on October 23. Scope extended only to that test fixture, using its existing relative FETCHED timestamp for the article date and expected result. No feed runtime change. Red evidence: full 6,553/6,555 and isolated 2/4; rerun required before publication.

Review: checked authenticated admin gating, bounded request sizes, source/payload hash binding, SQL privilege revocation/RLS, advisory registration locking, stale-claim fencing, immutable source enforcement, activation verification and original PDF-path preservation. Client completes reconciliation before network writes and records intent before submission. Known limit retained: document-text citations, not page/box citations; exact-repeat registration is idempotent, provider billing after uncertain failures is not guaranteed exactly once. Pre-release Supabase advisor baseline has existing SECURITY DEFINER warnings and service-only RLS informational findings; no new public grant is introduced.

## Release execution

PR #11 merged as `ff13a9533fab1444b85c9ea772e4b6030a01e091`; runtime source `ecdd25ac2a03500644cb0a5c93cf3e7389fd1489`. Branch CI39939942171 and PR CI39939951993 both app/SQL green; preview green. Local final evidence: 6,555 app, 1,199 Deno, 7 importer tests, all 56 SQL fixtures with non-vacuity, lint/build, original five-source offline run and git diff checks pass. Calendar-fixture prerequisite commit `1cd6d38b` passed isolated4/4 and fullsuite.

Applied local migration `20261022230537_supplied_text_connection.sql` using Supabase MCP; hosted migration history assigned `20261023104107` with name `supplied_text_connection`. Do not apply the local file a second time because of the different history timestamp. Functions deployed from verified runtime source: admin-ingest v6 (`3c108af639333fde4575ceba03b82579604cc7556c4c214623098e4ec5936b3e`), ingest-worker v5 (`9c55861a7a4ef69f9b744976ea91129c2d6af1c7a60121e6252bbc33722e7a21`), ingest-documents v23 (`5492cbe10c80915a60f8dba46124d917772a9d0bb23da2a26284d5277c177126`). Existing application-level auth configuration preserved; all three reject unauthenticated requests401. New input table inaccessible to authenticated role; direct registration RPC service-only. Previous bundles saved locally for rollback.

Release carries already-reviewed shared baseline updates absent in the older deployed bundles: logging redaction, catalogue additions and section-context chunking. No other Edge Functions deployed. Main CI39940810069 passed both required jobs on the merged commit. No document registered yet: awaiting the normal platform-admin session required by the client endpoint.

Post-release advisors: the existing 20 SECURITY DEFINER warnings remain unchanged; the only new informational item is the intentional service-only ingest_text_inputs table with RLS and no public policy. All three unauthenticated HTTP probes returned401.

## Hosted acceptance evidence

Owner supplied an authenticated platform-admin session. Five no-write endpoint preflights matched local hashes/chunks, followed by five successful registrations through the unchanged client script and released admin endpoint. All jobs reached succeeded/done through the existing worker. Exactly 5 documents/241 chunks added; total3,464 documents/3,461 indexed/100,957 chunks. Every source text/hash, citation metadata, URL, attribution, page range, chunk content/hash/embed_hash/offset and 1536-wide finite vector checked against the frozen plan. Real query embeddings and authenticated feature searches returned the intended document first 5/5; existing citation construction retained correct source title/URL/text-span identity. No generated chat completion or PDF-highlight/desk-attachment claim.

Exact unchanged manifest rerun returned existing=true and the original five document/job IDs; all chunk IDs/fingerprints and indexed timestamps unchanged. Worker logs remain exactly 5 successful embedding calls and 52,649 tokens. Job costUSD 0.00105298 (logs roundUSD 0.001053); separate search checks165 tokens/USD 0.00000330. OCR0. ANALYZE performed on documents, document_chunks and desk_rows; n_live_tup matches actual counts3,464/100,957/136,752. No active jobs. Temporary session file deleted; no refresh token used or stored.

Client handover: docs/operations/law-five-pilot.md plus law-five-release/{decisions.jsonl,eligibility-evidence.json,verify.sql,results.json}. Raw corpus/execution reports remain outside Git under the task's law-five-live-20261023 evidence directory. National checkpoint unchanged. Larger cohorts remain separately scoped.
