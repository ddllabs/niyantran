# Reproduce the five-document Law pilot

> **Status: Living.** 2026-10-23. Offline real-corpus preparation passed; hosted ingestion remains pending.

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

## Before the five-document hosted test

The local test deliberately uses ephemeral test attestations, never exports an eligible decision manifest and cannot submit. Do not convert its result into release approval. Check the five identities against current database records and pack sensitivity/dedupe/replacement rules; confirm licence/serving eligibility and resolve applicable companion-file discrepancies. The historical exact-URL matches are mapping evidence, not fresh database reconciliation. Current desk-row attachment is a separate relationship capability and is not created by this connector.

Release the connector migration and three affected Edge Functions only with owner authorization and passing release checks. Confirm worker/provider configuration and an authenticated platform-admin session. Then create the real content-bound reviewed decisions for these exact five original records, using the SHA-256 of the extracted JSONL as their file hash. Follow [the importer guide](supplied-text-import.md) for dry-run and submission. Require exactly five ready sources, no held sources and the same 241 planned chunks before submitting; cap this pilot at 241 chunks. Use fresh report paths throughout. Registration can start paid embedding work immediately.

After submission, all five returned job IDs must reach succeeded/done. Verify exact text hashes, expected chunk counts/vectors, zero OCR costs, preserved citations/source spans, and actual retrieval results. Rerun the unchanged manifest and verify the same document/job IDs with no additional documents. A lost acknowledgement requires reconciliation, not a different source ID. Record actual embedding spend. Do not expand the cohort until this hosted acceptance record exists.

This pilot does not prove all legal collections, page highlighting, current-row attachments or 18-million-document throughput. Expand only after five succeed: a bounded representative cohort across supported formats, then larger reviewed cohorts with measured storage, throughput, spend and held reasons.
