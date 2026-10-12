# Existing-text section context

> **Status: Living.** Owner requested correction on 2026-10-09 after comparing legacy ingestion with two Mistral documents.

## Outcome and current problem
Legacy version 2 embeds bare exact source spans and can pack across headings. Page version 3 adds section context using OCR geometry. Existing corpus text lacks that geometry and usually lacks Markdown markers. Improve existing-text ingestion without re-OCR, fabricated page coordinates, changed source text, or citation-offset drift.

## Contract
An explicit `chunking_mode: "section_context_v1"` selects document version 4. Legacy requests retain version 2. Version 4 splits at explicit Markdown headings, printed CHAPTER headings, schedules/annexures and conservative numbered body markers. A table of contents is excluded from body context until the enactment formula; ambiguous structure falls back to paragraph/sentence chunking. Metadata labels are sourced from original lines; no invented legal titles or margin notes. Context carries to continuation chunks within the section, with overlap only inside that section. Content always equals the original UTF-16 slice.

Embedding inputs prefix bounded section context; chunk identity includes version and normalized embedding input, so changed context cannot reuse a bare-text vector. Store the input hash and section metadata through the existing chunk_commit contract. Version 4 cannot be downgraded by an omitted mode. Page-pipeline documents remain refused. Dry runs write nothing and invoke no provider. Retry and whole-document visibility rules remain intact.

## Acceptance and exclusions
Prove original spans, no cross-section packing, TOC separation, continued context, changed-context hash invalidation, legacy/page regressions, dry-run behavior and retry safety. Audit the 48 ready medium sources locally, reporting coverage and changed chunk counts. Run focused/full Deno tests, application tests, lint and build; exercise existing SQL contract on disposable local databases. No schema migration, frontend change, broad re-embedding, deployment, live ingestion or cleanup is part of local implementation. Context dry-run responses must confirm version 4 before the worker permits a paid call. A new frozen pilot replaces the old version-2 proposal before any release.

## Write scope
New shared text-context module/tests and opt-in helpers in `_shared/chunking.ts`; ingest-documents handler/tests; corpus preparation/runner code/tests as necessary for version-aware manifests and verification; this spec, its plan, R7 tracker and evidence report. Preserve all earlier manifests and execution evidence.
