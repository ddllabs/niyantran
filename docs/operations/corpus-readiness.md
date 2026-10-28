# Corpus readiness inspection and public capability

> **Status: Living.** F264 released and accepted on NTER, 2026-10-28 ([release evidence](2026-10-28-f264-release.md)). No ingestion or mapping approval.

## Two public capabilities

Full text means current accessible complete indexed text is verified. Record only means research can use the displayed record details; it does not prove absence of OCR, embeddings or mappings and does not make a saved snapshot authoritative. Internal partial/held/incomplete/unknown states remain available to administrators. Ready partial passages remain usable and citeable. Public labels never authorize ingestion, mapping, publication or repair.

Server resolution remains authoritative each turn. Explicit web overrides and model/privacy restrictions apply; verified metadata-only records can ground automatic web, while unknown identity/access cannot imply absence or permission to widen. Document, row and web citations retain their distinct evidence origin.

## Administrator inspection

Admin → Documents adds read-only records/documents inspection. Select the desk and optionally exact row/document IDs; document inspection supports exact cohort review decision. The endpoint and database RPC independently require a platform-admin caller. No arbitrary user impersonation is accepted. Results describe privileged inspection, not proof of ordinary-user visibility.

Contract v1 reports observation time, bounded entities and next cursor. Default50/max100 entities, max24 associations per record, max100 distinct document inspections per request and up to1001 chunk probes per document to detect the1000 completeness ceiling. Limited inspection remains unknown; it is not indexing failure. No source bodies or embeddings are exported. Exact complete-source/alias reconciliation remains a separate reviewed inventory.

The read-only actions are `readiness-records` and `readiness-documents`; the API uses existing authenticated `admin-ingest`. Inspection never invokes legacy Bill link/unlink/swap/delete or any ingestion operation. Existing management controls remain separate.

## Runnable export — after the release is approved and deployed

`scripts/corpus-readiness-export.mjs` writes a new private JSONL report and refuses overwriting. Supply a short-lived platform-admin token through `NTER_INGEST_ACCESS_TOKEN` and the public API key through `SUPABASE_PUBLISHABLE_KEY`; never paste or commit secrets. The release value must identify the actually verified deployment, not this draft branch.

```bash
node scripts/corpus-readiness-export.mjs \
  --target https://PROJECT.supabase.co \
  --release VERIFIED_RELEASE_COMMIT \
  --kind records --tier national \
  --feature 'Parliamentary Question Database' \
  --limit 50 --max-pages 2 --report readiness-new.jsonl
```

Use `--kind documents` with optional `--id DOCUMENT_UUID` or `--cohort DECISION_ID` for document inspection. Default one page; maximum20 pages per invocation. An incomplete page-limit checkpoint can be continued with `--resume-from prior.jsonl`, a new report filename and identical target/release/filters. A failed response is unknown and stops without retries. Reports contain scope binding, bounded-segment hash chaining and timestamps; multiple pages are an observation window, not an atomic snapshot or approval manifest. A resumed segment binds the preceding receipt hash but does not recursively verify earlier segments (`preceding_segments_verified:false`). Unsigned hashes detect accidental edits, not a deliberately rewritten and rehashed report. The release reference is supplied by the operator and must be verified separately; the export does not attest deployment identity. A complete export means that filtered traversal ended, not that the whole corpus or all alias identities are reconciled.

## Release and client gates

Review the migration and index-build impact, apply only after owner authorization, deploy admin-ingest and research-chat with their matching frontend, then verify authenticated public/admin separation and representative retrieval/web answers. Current local checks cannot establish live provider latency or post-deployment permission behavior.

Existing client imports/chunking/embeddings remain unchanged. Require supported adapters, exact source identity, immutable input/receipt hashes, bounded spend/chunks, retry idempotency and separate indexed/mapped/published/website-accepted counts. Prepare100 before1000 only after explicit batch authorization; no task in this increment starts a queue.
