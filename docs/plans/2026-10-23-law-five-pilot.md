# Five-document Law pilot

> **Status: Living.** Owner requested a five-document test before larger batches.

Scope: reproducibly extract five exact NCLT sources from the shared ZIP, run the existing supplied-text adapter and chunker offline, and document the client procedure. Scripts must bind ZIP member and record hashes, preserve original text, reject corrupted input, and never create production approval decisions automatically. Write scopes: scripts/law-five-*, docs/operations/law-five-pilot.md, this plan and open-work.md. No new ingestion engine. Hosted registration, real embeddings, activation and citation retrieval remain a subsequent release gate because the connector migration/functions are not deployed.

Verification: run the pilot on the actual local archive; mutate one byte and prove refusal; run importer tests and lint/build. Report offline checks separately from database ingestion.

## Executed evidence

Actual shared ZIP extraction and Node offline pilot passed: five documents, 97 pages, 241 chunks; original text preserved. All 15 adapter rejection checks passed. A one-byte modification of the actual extracted corpus failed the pinned record check before output. Existing importer tests: 7 passed. No ingestion or provider calls. Test result: `/tmp/law-five-result.json` (transient); client commands reproduce it. Hosted activation/retrieval and actual policy eligibility remain unverified.

## Authorized release and live pilot

Owner explicitly authorized connector release and actual Supabase ingestion of these five sources, citation/index verification and duplicate-safe rerun. Target: NTER `vfgcppstyzjarlzyqdac`. Ordered gates: final local tests and review; protected PR with both CI jobs; migration plus only admin-ingest, ingest-worker and ingest-documents; authenticated importer registration capped at 241 chunks; five succeeded jobs and exact stored hashes/chunk plans; retrieval/citation checks; identical rerun with unchanged IDs/counts/spend; client guide finalized. No larger batch or National continuation. Before admission, five source keys were absent and all three pack policy CSVs had no matching source entries. Original records declare public tribunal orders and NCLT attribution. Baseline: 3,459 documents, 3,456 indexed, 100,716 chunks, zero queued/running jobs. Rollback before admission: restore previous three function bundles; retain additive migration. After admission: hold further registrations and retain immutable source/job evidence; no deletion.

Release prerequisite: the full app suite reproduced two failures in `src/lib/feedServeRoute.test.js`; its fixed October 15 article aged out of the seven-day news filter on October 23. Scope extended only to that test fixture, using its existing relative FETCHED timestamp for the article date and expected result. No feed runtime change. Red evidence: full 6,553/6,555 and isolated 2/4; rerun required before publication.

Review: checked authenticated admin gating, bounded request sizes, source/payload hash binding, SQL privilege revocation/RLS, advisory registration locking, stale-claim fencing, immutable source enforcement, activation verification and original PDF-path preservation. Client completes reconciliation before network writes and records intent before submission. Known limit retained: document-text citations, not page/box citations; exact-repeat registration is idempotent, provider billing after uncertain failures is not guaranteed exactly once. Pre-release Supabase advisor baseline has existing SECURITY DEFINER warnings and service-only RLS informational findings; no new public grant is introduced.
