# Reproduce the five-document Law pilot

> **Status: Living.** 2026-10-23. Connector released and hosted five-document pilot passed on NTER. The exact rerun created no duplicates and made no new embedding calls.

Use Python 3, Node 24 and this exact repository revision. Both operators use the same original `NTER_legal_pack_v1.1_FULL_2026-10-18-001.zip`. Its internal folder says v1.2; do not rename or rebuild the archive. Run from the repository root with paths appropriate to your laptop:

```bash
python3 scripts/law-five-extract.py \
  --archive '/path/to/NTER_legal_pack_v1.1_FULL_2026-10-18-001.zip' \
  --output '/path/to/fresh-pilot.jsonl'
node --experimental-strip-types scripts/law-five-test.mjs \
  '/path/to/fresh-pilot.jsonl' '/path/to/fresh-pilot-report.json'
```

The output directory must exist. Output files must not already exist. No credentials, npm installation, archive-wide extraction, network, OCR or database access is needed. The extractor reads one compressed shard, checks its pinned SHA-256 and central-directory identity, then verifies all five raw records and text hashes. It never extracts archive paths onto disk. The original archive is unchanged. The test reuses the existing application adapter and chunker.

Expected result: `offline-contract-passed`, 5 documents, 241 chunks, 0 database writes, 0 embedding calls. The five NCLT orders concern JRN Pharma, Swadesh Green Infra, FNM Property Services, Coastal Automobiles and Sunima Steel Marketing. Their 97 declared pages pass the source offset checks. Exact source IDs, shard location and hashes are in `scripts/law-five-selection.json`; citations and individual counts appear in your report. Routing is to the existing `NCLT / NCLAT (Insolvency)` feature; the raw generic feature remains unchanged in the extracted original records.

Every document also exercises three negative checks: altered text, incomplete pages and an unapproved rights check must refuse. A separately executed one-byte corruption of the extracted input was rejected before any result file was created. These tests establish integrity and adapter compatibility, not semantic OCR accuracy or legal clearance.

## Eligibility and deployment checks for a new environment

The local test deliberately uses ephemeral test attestations, never exports an eligible decision manifest and cannot submit. Do not convert its result into release approval. Check the five identities against current database records and pack sensitivity/dedupe/replacement rules; confirm licence/serving eligibility and resolve applicable companion-file discrepancies. The historical exact-URL matches are mapping evidence, not fresh database reconciliation. Current desk-row attachment is a separate relationship capability and is not created by this connector.

NTER already has the connector migration and three affected Edge Functions. For another environment, release them only with owner authorization and passing release checks. Confirm worker/provider configuration and an authenticated platform-admin session. Then create the real content-bound reviewed decisions for these exact five original records, using the SHA-256 of the extracted JSONL as their file hash. Follow [the importer guide](supplied-text-import.md) for dry-run and submission. Require exactly five ready sources, no held sources and the same 241 planned chunks before submitting; cap this pilot at 241 chunks. Use fresh report paths throughout. Registration can start paid embedding work immediately.

After submission, all five returned job IDs must reach succeeded/done. Verify exact text hashes, expected chunk counts/vectors, zero OCR costs, preserved citations/source spans, and actual retrieval results. Rerun the unchanged manifest and verify the same document/job IDs with no additional documents. A lost acknowledgement requires reconciliation, not a different source ID. Record actual embedding spend. Do not expand the cohort until this hosted acceptance record exists.

This pilot does not prove all legal collections, page highlighting, current-row attachments or 18-million-document throughput. Expand only after five succeed: a bounded representative cohort across supported formats, then larger reviewed cohorts with measured storage, throughput, spend and held reasons.

## Released NTER pilot commands

Release PR: https://github.com/ddllabs/niyantran/pull/11. The reviewed decisions are `docs/operations/law-five-release/decisions.jsonl`; their evidence is adjacent. These decisions select only the pinned five original records. Do not edit them to select another cohort. Their SHA-256 is `01bdfb8c901c3a63062bd66d7d8b5b0e2f941afbfd480a08fb992d68c566d70b`.

After extracting the same five records, run the importer offline, then use your short-lived platform-admin session and the project publishable key in the environment. Signing into the website alone does not populate a terminal environment. Keep credentials out of the repository and shared logs.

```bash
node --experimental-strip-types scripts/corpus-text-import.mjs \
  --corpus '/path/to/fresh-pilot.jsonl' \
  --decisions docs/operations/law-five-release/decisions.jsonl \
  --report '/path/to/pilot-dry-run.jsonl'
```

Expected: five ready, zero held, 241 chunks. With `NTER_INGEST_ACCESS_TOKEN` and `SUPABASE_PUBLISHABLE_KEY` configured securely, submit the authorized pilot:

```bash
node --experimental-strip-types scripts/corpus-text-import.mjs \
  --corpus '/path/to/fresh-pilot.jsonl' \
  --decisions docs/operations/law-five-release/decisions.jsonl \
  --report '/path/to/pilot-submit.jsonl' \
  --submit --approval 01bdfb8c901c3a63062bd66d7d8b5b0e2f941afbfd480a08fb992d68c566d70b \
  --target https://vfgcppstyzjarlzyqdac.supabase.co --max-chunks 241
```

All five NTER jobs have already succeeded. To reproduce the rerun, run the same command with only a fresh report filename for the repeat test. Save the operator results from `law-five-release/verify.sql` before and after. Expected per-document chunks: JRN 53, Swadesh 38, FNM 40, Coastal 75, Sunima 35. All document/job IDs, chunk counts, indexed timestamps and embedding spend must stay unchanged. Both operators share the database: once these records exist, the client's exact rerun should reuse them, not create another five.

## Verified hosted result — 2026-10-23

| Check | Observed result |
|---|---|
| Authenticated server preflight | 5/5; identical local/server hashes and 241 chunks |
| Existing queue/worker | 5/5 succeeded/done |
| Stored sources | All five original texts, text hashes, citation metadata, source URLs, attribution and page ranges match |
| Stored chunks | All 241 contents, hashes, embedding hashes and offsets match the frozen plan; all vectors finite, width 1536 |
| Semantic retrieval | Five real query embeddings through authenticated `match_documents`; expected document ranked first for all five |
| Citation construction | Existing citation builder returns correct title, source URL and text-span identity |
| Exact rerun | Same five document/job IDs, all `existing=true`; same chunk IDs/fingerprints and indexed timestamps; no additional embedding calls/spend |
| OCR | Zero pages/cost |
| Ingestion embedding usage | 52,649 tokens, USD 0.00105298; model logs round to USD 0.001053 |
| Separate search verification | 165 query tokens, USD 0.00000330 |
| Database totals | 3,464 documents, 3,461 indexed, 100,957 chunks; exact delta +5/+5/+241 |

Full per-source IDs and citation evidence: [results.json](law-five-release/results.json). Read-only operator queries: [verify.sql](law-five-release/verify.sql). The existing three unindexed records predate this pilot. ANALYZE completed; document/chunk planner counts match real counts. No queued/running jobs remain.

These are **document-text citations**. Original legal citation metadata is retained, but this test does not establish PDF page-number highlighting, boxes, automatic attachment to existing desk rows, or generated chat-answer quality. No chat completion was purchased. It verifies the actual embedding/retrieval/citation-builder path. Wider collection/format coverage and capacity checks are still required before bulk expansion.

### Supplying the session safely

Use the normal NTER platform-admin sign-in. The terminal needs its short-lived `access_token`, not the `refresh_token` or service-role key. An operator can supply it through a private environment file outside the repository (owner read/write permissions only):

```dotenv
NTER_INGEST_ACCESS_TOKEN=<short-lived authenticated admin access token>
SUPABASE_PUBLISHABLE_KEY=<project publishable or legacy anon key>
```

Add `--env-file=/absolute/private/nter-session.env` immediately after `node` in the submit command. Do not send credentials in chat, client handover materials, reports or source control. Delete the temporary session file when finished. An expired session must be renewed through normal sign-in; do not regenerate decisions or source IDs.
