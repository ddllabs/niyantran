# Globiz listing correction

> **Status: Living.** Scoped fix authorized by the owner: investigate and fix Globiz's missing NCLT listing without re-ingestion.

## Current state and cause

Globiz source `law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a` is indexed as document `1597c9df-162a-4d74-860d-1cbf8f5a3bb2`, with 80 chunks. Neither the embedded NCLT register nor live desk_rows has its title or exact PDF URL. Search filters cannot return an absent row. Other company matches can be independent IBBI announcements rather than linked orders. No document_key attachment exists for Globiz.

## Scope and outcome

Add exactly one reviewed metadata-only listing correction through the shared lawRows path used by browser fallback, server feed and desk-row mirror. Bind the listing to its exact corpus source_key and official URL. Retain the original register unchanged and preserve all existing row identities by appending the correction after the legacy sort, with an explicit stable ID. Avoid duplicate listing when the original register later includes the exact source URL. This is a bounded correction, not automatic publication of every ingested source or implementation of document_key attachments.

Inventory: one new listing for Globiz Exim Private Limited; date 2026-07-08; case C.P. (IB)/595/MB/2025; disposition Rejected; URL https://ibbi.gov.in/uploads/order/7c2928dab0f907c71d2c2aa47f13b6ce.pdf. Evidence: original legal-pack record at member index 16966, line 63, record hash 594b4ed704789df038e652a600c974a942047a28413fc485676e92ee5896dc41; independently verified during PR13 review. Stored document metadata agrees.

## Ordered plan and write scopes

1. Add regression proving Globiz missing through real shared feed and searchable by title/case after correction; verify legacy row identities unchanged and exact-URL dedupe.
2. Add metadata correction in src/lib/lawListingCorrections.js and connect only NCLT lawRows in src/lib/lawPack.js. Tests in src/lib/lawListingCorrections.test.js.
3. Run focused/full Vitest, Deno suite, lint, build, router import. Record evidence here and track F243 in open-work.
4. Prepare exact one-row mirror delta; no broad reload/deletes. Preserve document/chunk/job fingerprints. Publication follows repository release gates and explicit owner publication authorization if not already available.

## Acceptance / exclusions

Title and case searches return exactly one Globiz order in shared listing; source URL and source_key exact; existing rows identical. No OCR, embeddings, ingestion invocation, text/chunk/job update, migration, or PR13 modification. No general relationship or full-corpus publication mechanism. Production fix is not complete until released UI/API and mirror are verified.

## Verification — 2026-10-23

- Root cause: live read found zero NCLT desk rows by Globiz name or exact PDF URL; indexed document ID and metadata confirmed. Future Consumer matches an independent IBBI announcement with null document_key, not the indexed order's attachment.
- Regression before fix: `npx vitest run src/lib/lawListingCorrections.test.js` failed two checks (missing search result and 434 instead of 435 rows). After fix, four tests pass, including the actual feature-feed handler, both search implementations, unchanged 434 legacy rows/IDs, and exact-URL duplicate suppression.
- Focused law/row suite: 26/26 passed before adding the API case. Final full `npm test`: 422 files, 6,559 tests passed. First full run caught the stale catalogue count; corrected only NCLT rows 434→435, then full rerun passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 1,199 passed. `npm run lint`, `npm run build`, router import, and `git diff --check` passed. No standalone type-check claimed. Full SQL migration suite not rerun: no migration or SQL runtime function changed.
- Standard read-only mirror dry run proposed rewriting 435 rows. A separate comparison identified 434 pre-existing row/record_text differences (not just local snapshot timestamps); the correction adds exactly one new key and removes none. Do not use the broad loader for this fix. Existing drift is out of scope and unchanged.
- `docs/operations/globiz-listing-correction.sql` is the exact guarded one-row insert for release. Validated against minimal disposable Postgres tables: initial run and exact rerun left 1 listing / 1 document / 80 chunks; deliberately wrong document hash refused. This is syntax/guard/idempotency evidence, not a production-schema migration test. No live writes executed.
- Source packs under public/data and backup unchanged. Existing document_key remains null; source_key and official URL provide explicit provenance, not a newly implemented corpus attachment capability. No ingestion or paid calls performed. No live browser verification or production release performed.

## Release prerequisites (completed below)

The local fix is ready. AGENTS.md requires exact prior authorization for push/PR/deploy and production operations. Release requires CI-gated branch/PR publication and merge, verification of the deployed NCLT listing/API, then the scoped one-row mirror insert and ANALYZE desk_rows. Re-check live search, and preserve the original Globiz document/chunk/job IDs, fingerprints and spend. The changed catalogue count can remain a recorded stale count in already-deployed Edge bundles until an authorized Edge release; no ingestion function deployment is needed for the listing correction.


## Production release — 2026-10-23

Owner explicitly authorized push, PR, CI-gated merge/deployment and one-row production correction. Runtime commit `6b5d138804294f7bb66a0a71d6946dbd7dc6b35a`, PR https://github.com/ddllabs/niyantran/pull/14, merge `258827a0649401fe02ea5d1507ed3b0aa7fd9134`. Branch CI40001442944 and PR CI40001450300 passed both required jobs; main CI40002312605 also passed. Production `dpl_EoCgcSUURY3u1icG2wmqA2U1AxpN` READY at merge SHA; www.nter.pro and nter.pro assigned after the main gate. Previous deployment `dpl_VXXzpeXsfZbSQSoPCZv5Yg5hLtJb` is the rollback reference (rollback requires owner authorization).

Live feature-feed API: before 434 rows / zero Globiz; after 435 / exactly one Globiz. The browser's two search implementations run against the actual deployed API response each returned exactly one result for Globiz Exim and C.P. (IB)/595/MB/2025. Applied the committed guarded SQL once, then ANALYZE desk_rows. Live search_desk_rows returns exactly one result for both terms, including a read-only authenticated-role query. No ingestion function or provider called.

Before/after MD5 of complete JSON rows, with stable aggregation order:
- Existing 434 listing rows: fb11d5869438fd1e673a85c17eeee80d (unchanged).
- Globiz document: 535e3c5c4205b78cd37b72c9af6fd48b (unchanged).
- All 80 chunks, including vectors: 6fa4d4bce5f9b3cc46cc7a2141cae092 (unchanged).
- Ingestion jobs, including spend: 4a96f8222d7dbfafe7044e30cc9418d1 (unchanged).

Browser limitation: in-app session signed out; Chrome connection timed out. No signed-in visual verification claimed. Verification covers the production API, real response through both UI search functions, and authenticated database search. Source-key/URL provenance is present; formal document_key attachment remains out of scope. PR13 and broader ingestion untouched.
