# Corpus bulk inventory and execution contract

> **Status: Living.** Owner authorized preparation after accepting the one-document live RAG pilot. Bulk writes require review of this inventory and a separate go-ahead.

## Current state and problem

The accepted single pilot has six embedded chunks under `bill:2025:113`. Current NTER totals: 2,341 documents and 54,346 chunks. The local citation pack contains the original corpus text plus mapping metadata. The previous screened direct-PDF pool was 13,920 records; fresh production identities remove the accepted sample, leaving 13,919.

The current Download PDF resolver joins bill analysis by direct row identity, or bill number and category, without year in its fallback. A valid document-to-bill mapping does not guarantee that this resolver selects the correct PDF. Preparation must distinguish those relationships before ingestion.

## Expected outcome and evidence

Produce a frozen, source-ID-addressed inventory, per-document actual chunk counts and token estimates, current price and database capacity measurements, a small verified proposed first-stage manifest, holds and a bounded resumable execution plan. No bulk endpoint invocation is part of preparation.

Source text hashes and lengths must agree with the pack; all candidate chunk spans must reproduce the original text exactly. Existing source IDs are excluded against fresh live data. Bill candidates require unique current keys, matching listing title/number/chamber, and explicit document versions. PDF links and the actual Download PDF resolver are checked independently. Reachability alone does not prove identity.

## Scope and exclusions

Documentation under this spec, its plan, research evidence summary and R7 tracker; local nonsecret evidence/manifest/text outside Git. Read-only Supabase/API/public PDF inspection. No UI fix, migration, secret change, re-OCR, bulk write, deletion, deployment, push or merge. Nonbill attachment/scoping, oversized documents and ambiguous identities remain separate gates.

## Execution amendment — owner approved 2026-10-09

Following review of the report, the owner said “go”. Authorize exactly the frozen 23-document first stage (518 expected chunks), its normal embedding-call logs and post-stage planner maintenance. Add the bounded runner and its isolated tests at `scripts/corpus-stage-job.mjs` and `scripts/corpus-stage-job.test.mjs`; local receipts/checkpoints remain outside Git. Application code, listing resolver, schema, later cohorts, deployment and publication remain excluded. Test stop/resume/identity/error guards, run repository lint/tests/build, then execute sequentially with per-document dry-run and verification. Stop after the 23-source checkpoint. Record execution and retrieval evidence; do not infer owner acceptance of the new stage.

## Held-vector cleanup amendment — owner approved 2026-10-09

Owner explicitly approved deleting the 61 chunk/embedding records belonging to the three held first-stage documents only: `1b801b87-c069-4545-8771-2681b566ea6d`, `0384f9b5-5b99-4798-827a-f45dffcc0fa2`, `624ae9cb-f168-4667-be51-16239cff1191`. Preserve all three documents, original source text/hash, source IDs and PDF URLs. Keep indexed_at null and clear chunker_version so a later correctly mapped ingestion cannot take the unchanged-text early-return path. Require exact held/source/count guards before deletion; verify zero chunks/embeddings afterwards and unchanged source hashes/text/URLs. This is the only authorized deletion; no re-ingestion, listing-key fix or later batch is included.
