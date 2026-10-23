# Law listing client workflow

> **Status: Living.** Implementation handoff, 2026-10-24. Production activation and larger batches are not authorized by this guide. Check the implementation plan for verification/release state before using new server actions.

## Read before operating

Read `AGENTS.md`, `docs/agents/onboarding.md`, `docs/agents/coordination.md`, `docs/plans/open-work.md`, `docs/specs/2026-10-24-law-listing-publication.md`, the implementation plan of the same date, `docs/operations/supplied-text-import.md`, and `docs/operations/law-listing-backend-contract.md`. Read `docs/operations/law-cohort-screen-review-fix.md` for the scanner defect and schema-3 correction.

Start from current reviewed main on a separate `task/<purpose>` branch. Confirm branch/status/remotes and fetch before comparing histories. Do not reset or stash another agent's work. An ingestion run normally needs no code changes. Task agents leave scoped changes for supervisor review; publication/commits follow the owner's exact authorization. Do not assume a prior five-document approval authorizes another cohort.

The existing ingestion system remains responsible for chunking, embeddings and citation offsets. The new listing layer maps NCLT corpus documents to legal records and publishes verified attachments. A listing is not evidence that OCR is indexed. IBBI announcements and court orders remain distinct even when company names match. Unsupported forums, revisions, conflicting identities and sensitive records remain held.

## Release prerequisite

The additive Law migration, admin-ingest actions, canonical list/search readers and attachment resolver must be released in the documented order: inactive migration, matching handlers/readers, then seed and activation steps. The operator seeds current legacy listings preserving row keys, reconciles existing indexed documents using metadata only, then activates canonical serving after checks. Follow the backend contract for exact RPCs. These are operator release steps, not permission for the client to run arbitrary SQL. Do not change old document metadata, source hashes, chunks or completed manifests to make them fit the new schema.

Client needs Node24, the reviewed repository scripts, shared corpus and policy evidence, and a short-lived platform-admin token plus publishable key in a secure environment. Never provide a service-role key to these scripts. Keep tokens and corpus text out of Git and chat. Use `NTER_INGEST_ACCESS_TOKEN` and `SUPABASE_PUBLISHABLE_KEY` in the process environment. No new client package is required.

## New cohort preparation

1. Run the schema-3 `law-cohort-screen.py screen` against a pinned shard and verified policy hashes. It streams every record in the selected subtree, compares decoded identities, and holds incomplete/ambiguous scans. Repeated members and replacement rules remain relevant.
2. Finalize only an authorized eligible cohort. Do not edit schema-2 evidence to pretend it was screened by schema3. Preserve historical completed evidence.
3. Run the existing importer offline to calculate exact chunk counts and a conservative embedding-cost estimate. Ready means locally valid, not production-approved.
4. Run live reconciliation without registration:

```bash
node --experimental-strip-types scripts/corpus-text-import.mjs \
  --corpus /absolute/staging/candidates.jsonl \
  --decisions /absolute/staging/decisions.jsonl \
  --report /absolute/staging/live-reconciliation.jsonl \
  --target https://PROJECT.supabase.co --reconcile
```

This calls the admin reconciliation action using validated source records. It checks live identities before any registration. It does not run OCR, embeddings or publication. The report retains mapping reasons/fingerprints and existing document IDs, without OCR text.

After a future bounded cohort authorization, `--submit --approval <decision-manifest-sha256> --max-chunks <approved-count> --max-estimated-cost-usd <approved-ceiling>` uses the same importer. NCLT live checks run before all registration writes and the server rechecks atomically. Existing registered documents are skipped; registration is not replayed to fix a listing. New registrations carry durable publication intent before indexing starts. Index activation attempts publication; a publication failure leaves a separate retryable state.

The estimate uses the existing embedding price and a conservative byte/token envelope allowing three provider attempts. It is a client admission estimate, not a provider-enforced billing cap. No blanket capacity or spend approval is implied. Keep server concurrency and per-document limits unchanged. Review actual costs and receipts before expanding scope.

## Existing indexed documents: metadata-only repair

`law-listing-reconcile.mjs` cannot ingest, chunk or embed text. It accepts JSONL receipts containing `document_id` and `text_sha256`; new importer reports include those fields. For historical receipts lacking text hashes, obtain the exact immutable hashes from the reviewed decision manifest and read-only database inventory; never guess them.

Prepare a read-only plan:

```bash
node scripts/law-listing-reconcile.mjs \
  --receipts /absolute/staging/registration-receipts.jsonl \
  --report /absolute/staging/listing-plan.jsonl \
  --target https://PROJECT.supabase.co
```

Inspect the action, target listing, reasons and fingerprint for every document. The plan binds the project, document IDs, text hashes and current mapping. Only with an authorized metadata-publication decision:

```bash
node scripts/law-listing-reconcile.mjs \
  --plan /absolute/staging/listing-plan.jsonl \
  --report /absolute/staging/listing-publication-receipts.jsonl \
  --target https://PROJECT.supabase.co \
  --publish --approval <SHA256-of-exact-listing-plan-file> \
  --decision-id <authorized-decision-id> --approver '<authorized-name>'
```

An already-published result returns its existing receipt. A stale proposal is refused; prepare and review a fresh plan. A failed/lost acknowledgement stops further publication. Inspect remote status before replay; do not change a fingerprint to suppress a conflict. Writes are idempotent and never require resubmitting OCR.

Read remote publication status without writing:

```bash
node scripts/law-listing-reconcile.mjs \
  --plan /absolute/staging/listing-plan.jsonl \
  --report /absolute/staging/listing-verification.jsonl \
  --target https://PROJECT.supabase.co --verify
```

Reports are fresh files, private permissions, and fsynced after each intent/result. Keep them as restart checkpoints. `published` requires a stable record ID, row key and verified document key. Pending/held/uncertain states are not success. A status receipt is not proof of real natural-language retrieval: separately verify listing search, correct order/announcement identity, selected-record attachment, realistic question retrieval and citations in the website after release.

## Message to the client agent

The scanner's raw-byte optimization assumed a source key was always written literally in JSON. Valid JSON Unicode escapes can represent the same key with different bytes, so a competing revision could be missed while the report claimed a complete scan. Malformed lines were also skipped, and declared hashes were trusted for other occurrences. The fix decodes identities before comparison, rejects ambiguous/incomplete scans, computes actual text hashes and adds causal regressions. This is a validation defect; it does not establish that completed cohorts were corrupt. Use schema3 for unsubmitted cohorts and preserve completed receipts. Do not re-ingest existing documents.

The ingestion/listing contract now treats indexing and publication separately. Use live reconciliation and the supplied scripts; do not invent a second chunker, patch immutable document metadata, attach by company name, or equate source-register counts with indexed coverage. No larger batch is approved yet. Report the ready/held/already-registered/publication states and exact evidence for review.
