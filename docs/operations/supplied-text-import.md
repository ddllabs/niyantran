# Import reviewed Law text through the existing ingestion system

> **Status: Living.** Connector released to NTER on 2026-10-23 after owner authorization. Exactly five Law sources are authorized for the hosted pilot; larger batches remain excluded. Hosted acceptance is recorded in the pilot guide. See [implementation evidence](../plans/2026-10-23-supplied-text-connection.md) and [corpus reconciliation](../research/2026-10-23-corpus-reconciliation.md).

## What this connects

`corpus-text-import.mjs` → authenticated `admin-ingest/register_text` → existing `ingest_jobs` → existing `ingest-worker` index loop → existing section-context chunker, embeddings and `chunk_commit` → verified activation in `documents` and `document_chunks`.

Supplied OCR text is used unchanged. There is no PDF download or OCR call on this path. The script sends text and source metadata, not client-generated vectors or authoritative chunk rows. The server recomputes the same existing version-4 chunk plan. The existing website Documents job list shows progress, failed/cancelled jobs and retry controls. OCR counters remain zero. This does not add a new website upload screen.

This is a **text retrieval connection**, not PDF ingestion. Original citation metadata, licence/attribution, suggested keys, page and section ranges are retained. Validated code-point ranges also receive UTF-16 equivalents. Text chunks keep the existing exact text offsets. No PDF, page images, bounding boxes or PDF highlights are fabricated; supplied page metadata is not a newly implemented page-viewer contract.

## Prerequisites for client handover

For another environment, an operator must first review and release the additive `20261022230537_supplied_text_connection.sql` migration and the changed `admin-ingest`, `ingest-worker` and legacy `ingest-documents` functions together. The existing worker schedule and embedding provider configuration must be verified on the target. Apply neither migration nor deployment from this guide without the owner's release authorization. A preview points at the same live Supabase project; it is not an isolated test database.

Client requirements:

- Node 24 and this repository checkout; no new package is required for the importer.
- Selected original JSONL or JSONL.gz document shards and a reviewed decision manifest (below). Keep source archives unchanged. Do not flatten all archive members into one file: member/revision precedence matters.
- A platform-admin account and its short-lived user access token, plus the project's publishable key. Database access alone is insufficient. The script does not read `.env.local`, request a service key or obtain the worker secret.
- Explicit target project URL, a fresh output report path and the reviewed manifest hash when submitting.
- An approved pilot, capacity/spend envelope and serving policy. Existing credentials and OCR text do not establish these approvals.

The 74 GiB ZIP is a container, not a single importer input. A package operator selects the exact checked member from the reconciled inventory and streams/copies that JSONL.gz member to a staging directory. Use its verified checksum. Repeated ZIP names require the central-directory entry identity; never take an arbitrary first/last entry. Do not unpack the whole corpus for one cohort. The importer reads compressed JSONL directly; it does not currently read ZIP central directories.

## Decision manifest and mapping responsibility

The pack has source IDs, text, citation metadata and suggested keys. It does **not** contain this application's release approvals. The reconciliation inventory is evidence for preparation; its `held_*` rows must not be relabelled automatically.

A decision manifest is UTF-8 JSONL, at most 1,000 source documents and 8 MB. Each row selects one **source + text revision + exact compressed/uncompressed input-file hash**. Example shape (placeholders are not runnable approvals):

```json
{"source_key":"law:hc:COURT/BENCH/YEAR/ORDER","text_sha256":"<64 lowercase hex>","file_sha256":"<SHA-256 of the exact input .jsonl.gz file>","desk_feature":"Order Archive by Topic (Cross-Court)","review":{"status":"eligible","source_key":"law:hc:COURT/BENCH/YEAR/ORDER","text_sha256":"<same text hash>","rules_sha256":"<hash of the reviewed rules/evidence manifest>","package_id":"<package/version>","mapping_version":"<reviewed adapter version>","decision_id":"<traceable decision>","checks":{"identity":true,"completeness":true,"sensitivity":true,"dedupe":true,"rights":true}}}
```

These decisions may be generated in bulk from deterministic mapping and policy evidence; they do not require hand-editing every file. **This connector does not yet generate those decisions from the entire legal ZIP's policy files.** The reviewer is responsible for verifying the referenced rules/evidence and selecting eligible revisions. Setting the booleans is an attestation, not proof created by the script. The importer verifies file/text integrity and contract conformance; it cannot establish legal rights, semantic OCR accuracy or dedupe policy simply from those booleans.

Feature routing must name an existing Law feature in `supabase/functions/_shared/deskCatalog.json`. Do not assign Acts or regulations to an unrelated feed simply to get past validation. Unsupported collections remain held until an approved feature adapter exists. `document_key_suggested` is retained as provenance; it is **not** written into the current desk record's attachment key. This avoids conflating a case with all its orders and avoids changing the existing one-document-key constraint. Historical corpus rows, current feed attachments and translation relationships need the separately scoped relationship adapters before they appear as linked records in the website. Translation identity/parent references remain in citation metadata; the connector does not create a missing parent.

Resolve `__full` replacement precedence, repeated member occurrences, revision-specific duplicate winners, sensitive serving policy and the report's exceptions before generating eligible decisions. Do not import a duplicate alias as a second searchable document just because it has identical text. The three companion checksum differences also remain a package-release check. Known `partial`/`cut_at_*` page declarations, bad hashes/spans and unsupported features fail even with an eligible review.

## Preparing a bounded cohort with the screener

`scripts/law-cohort-screen.py` prepares one bounded cohort from one pinned ZIP member, offline and read-only. It is not the whole-pack decision generator, and it does not change what the importer checks.

```bash
python3 -I scripts/law-cohort-screen.py screen --archive "$ZIP" \
  --member documents/tribunals/IBBI_NCLT/<shard>.jsonl.gz --expect-member-sha256 <member sha256> \
  --start-line <n> --count 5 --max-scan 20 --feature 'NCLT / NCLAT (Insolvency)' \
  --exclude-decisions docs/operations/law-five-release/decisions.jsonl \
  --exclude-decisions docs/operations/law-cohort-2-release/decisions.jsonl \
  --expect-policy-hashes docs/operations/law-five-release/eligibility-evidence.json \
  --output-dir /absolute/staging/cohort-N
# only after the owner approves the screened keys:
python3 -I scripts/law-cohort-screen.py finalize --screen /absolute/staging/cohort-N/screen.json \
  --output /absolute/staging/cohort-N/decisions.jsonl --decision-id <owner decision id> --approved-by '<approver>'
```

`screen` holds any record that fails the adapter-contract checks, lacks a URL/licence/attribution, is flagged in the pack's internal sensitivity, dedupe (`keep=0`, or a keeper naming another file) or not-in-pack lists, has a `__full` replacement or competing text hash in its collection folder, or is already listed in an `--exclude-decisions` manifest. Every central-directory occurrence of a repeated name is hashed and read; only byte-identical repeats are skipped. It writes `screen.json` (evidence, no text) and `candidates.jsonl` (original lines of passing records).

`finalize` refuses held keys, a changed `candidates.jsonl`, a screen from an older schema, and any screen that is not complete: all three policy files must be present and match `--expect-policy-hashes` in every occurrence, and the collection conflict scan must have run (`--no-scan-subtree` is exploratory only). A new pack release needs a newly reviewed expectation file; do not reuse the pilot hashes for different bytes.

Known limits: existing-record screening uses only the `--exclude-decisions` manifests, not the live database (the importer reconciles at registration; take a read-only `verify.sql`-style baseline before submitting). The conflict scan covers the member's collection folder only. Exact chunk counts come from the importer dry run. Dedupe is a hold, not a winner decision. The review booleans written by `finalize` remain the approver's attestation. Its tests run in CI (`python3 -I scripts/law-cohort-screen.test.py`). Cohort-2's evidence is in `law-cohort-2-release/`.

## Dry run first

```bash
node --experimental-strip-types scripts/corpus-text-import.mjs \
  --corpus /absolute/staging/selected-shard.jsonl.gz \
  --decisions /absolute/staging/reviewed-cohort.jsonl \
  --report /absolute/staging/cohort-dry-run.jsonl
```

Repeat `--corpus` for more selected shards. Sources absent from the decision manifest are not submitted. Exact repeated occurrences collapse; conflicting occurrences of a selected identity are held before any network request. The script finishes scanning and verifies input-file stability before submitting anything. It spools selected payloads into private temporary files to bound memory and removes only those temporary files on exit. Input archives/shards remain unchanged. Output reports are created exclusively and never overwritten.

The result includes manifest SHA-256, selected, ready, held and chunk counts. **Ready here means locally valid against the supplied review, not already reconciled with live Supabase or release-approved.** This offline command makes no network requests. `ready`/`held` are local preparation counts; `submitted` counts confirmed job registrations, and `registration_held` counts explicit server refusals. The CLI exits 2 on an uncertain request and 3 on explicit registration holds. It cannot tell you whether another operator just ingested a source. Live registration reconciles that atomically.

A malformed JSON line or an over-8-MB line stops the scan before any submission; it cannot safely identify the selected source inside corrupt JSON. Valid selected records that fail validation are individually held. A missing selected source is held. Records over 600,000 UTF-16 units or 800 existing-chunker chunks are held without truncation. Smaller independent eligible records can proceed.

## Submit only the reviewed cohort after release

Provide `NTER_INGEST_ACCESS_TOKEN` (an authenticated platform-admin session token) and `SUPABASE_PUBLISHABLE_KEY` through the client's secure environment. Do not paste values into source files, reports, shell commands captured in shared logs or the browser bundle. Expired sessions must be renewed through the normal authorized sign-in flow.

```bash
node --experimental-strip-types scripts/corpus-text-import.mjs \
  --corpus /absolute/staging/selected-shard.jsonl.gz \
  --decisions /absolute/staging/reviewed-cohort.jsonl \
  --report /absolute/staging/cohort-submit.jsonl \
  --submit \
  --approval <manifest-sha256-from-reviewed-dry-run> \
  --target https://PROJECT.supabase.co \
  --max-chunks 10000
```

The default cohort ceiling is 10,000 planned chunks; a lower approved budget can be supplied. Increasing it requires a separately reviewed capacity/spend envelope. This is a work-size guard, not a guaranteed dollar cap. Registration is sequential, one document per request; the existing queue still caps concurrent running jobs at two and writes at most 100 chunks per commit. A 1,000-business-record cohort may contain more than 1,000 documents and must be split across invocations; a cohort size is not concurrency.

A registration can immediately start paid embedding work through the existing schedule. Review the manifest, target and budget **before** submission. `registered` means accepted into the queue, not indexed. Check the returned job IDs in the existing website Documents jobs list. A failed or cancelled existing job is returned as such; it is never automatically restarted by resubmitting the script.

## Retry and verification

The database is the authoritative checkpoint. Rerunning the exact unchanged manifest into a **new report path** returns the same jobs and document IDs. Changed text, metadata, routing or review evidence for an existing source is refused without overwriting it, including preexisting legacy/PDF documents. Existing-source revisions require a separate reviewed revision workflow; changing the source key to force admission is not a valid workaround.

The client records `submitting` before each request and records the receipt afterwards. A network timeout, unexpected response, authorization failure or service failure stops further submissions and records an uncertain outcome. Reconcile the existing job first; rerunning the unchanged manifest is safe for registration. Do not infer absence from a lost response.

The worker reuses committed chunks with matching embedding hashes. An expired supplied-text claim, or a caught failure after entering the index loop, is held for operator reconciliation rather than automatically retried. Paid provider work may have succeeded before a lost commit/acknowledgement; **exactly-once billing is not guaranteed**. Manual retry after reconciliation can incur additional cost for uncommitted vectors. A normal time-budget yield queues the next bounded step without invoking OCR.

Before activation SQL verifies all planned chunks/vectors, hashes and source text. Indexed text is immutable through legacy updates. Operator verification after an approved pilot should additionally check the job's succeeded/done state, document/index/chunk counts, zero OCR costs, sampled source spans and retrieval citations, remaining held reasons and actual spend. Run the repository-required ANALYZE only as part of the authorized load procedure. Do not proceed to 18 million documents based on this connector's fixture tests.

## Current release limits

This implementation connects reviewed Law text to the existing orchestrator and search storage. It is not a complete 18-million-document deployment: automated package-policy decision generation, full historical record relationships/current desk attachments, sensitive serving enforcement, boxes/PDF-viewer integration and large-scale capacity qualification remain open. The National frozen stage is untouched. The separately authorized [five-source hosted pilot](law-five-pilot.md) passed, including exact-repeat registration and semantic retrieval. That does not authorize larger batches.

Rollback before admission: retain the old functions and do not release the migration. After admission: pause the existing worker schedule, cancel pending jobs through existing controls and retain immutable input/receipt data for reconciliation. Do not drop the new table or migration while jobs exist; removal/replacement of indexed records is a separately authorized data task.
