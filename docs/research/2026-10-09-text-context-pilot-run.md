# Existing-text context pilot execution

> **Status: Historical (2026-10-09).** Owner-authorized deployment and one-document execution; owner natural-language RAG acceptance remains pending.

The section-context implementation was deployed only to NTER's `ingest-documents` function (version18 →19). The Immigration and Foreigners Bill,2025 (`bill:2025:22`) was ingested in full: **91 version-4 chunks**, including85 with detected section context. This is a complete document, not a first100-chunk truncation. No schema or frontend deployment, broader re-embedding or persistent service was performed.

## Exact source and authorization

- Document ID: `ff08ddf5-21c3-4323-81a0-1a7cad98cb43`.
- Source key: `6c18b649806b7aa824a8226ffdb9701fed15e88f`.
- [PDF used by the listing Download action](https://sansad.in/getFile/BillsTexts/LSBillTexts/PassedBothHouses/IMMIRATION411202522157PM.pdf?source=legislation).
- Indexed at2026-10-09 11:39:30.343UTC (17:09:30IST).
- Owner's “go” authorized this function deployment and one pilot only, with USD0.015 ceiling. Authorized `pilot-release.json` SHA256: `b549c8dbed4b4acf1e4230ab38f8f797836e7d1246b36d42ce19797452f653f2`.

The original proposal and five-document /427-chunk follow-up remain unchanged unauthorized drafts. This execution stopped after one verified document.

## Executed evidence

Retrieved version19 source matched all11 deployed source files against the tested local bundle. Version18 source was saved for rollback. The first MCP deployment returnedHTTP502; listing still showed18. The scoped CLI deployment then succeeded, and retrieved source confirmed19. There was no assumption that an ambiguous response meant success.

The baseline, dry-run and foreground supervisor commands all succeeded:

```bash
supabase functions deploy ingest-documents --project-ref vfgcppstyzjarlzyqdac --no-verify-jwt --use-api
node scripts/corpus-stage-job.mjs --baseline <pilot-release.json> <manifest-sha256>
node scripts/corpus-stage-job.mjs --dry-run <pilot-release.json> <manifest-sha256>
node scripts/corpus-job-supervisor.mjs --execute <pilot-release.json> <manifest-sha256>
node /private/tmp/context-pilot-verification.mjs
```

The live dry run acknowledged chunker version4 and91 chunks before the paid request. The execution checkpoint is complete: one live attempt, no retries, failures or unknown usage. Provider receipt: **13,105 tokens /USD0.0002621**, one request using `openai/text-embedding-3-small`. Database decimal cost rounds toUSD0.000262; the full receipt is retained.

Independent read-only verification confirmed all91 exact original-text spans, content/context/input hashes and finite nonzero1536-dimensional vectors. Both Bill Passage Probability Index and Policy Intelligence Graph listing rows resolve to the same bill key and exact PDF URL through the actual UI model resolver. Indexed attachment lookup returns exactly this one document. No duplicate or orphan pilot chunks were found.

Two probes exercised the real retrieval search and text-citation builders with existing stored vectors, avoiding extra paid calls. All40 results in each probe remained scoped to this document; clauses9 and21 returned their matching source chunk, correct chapter/clause context, global character spans and PDF URL. This proves storage/scoping/citation plumbing; it is not a natural-language answer-quality test. Existing OCR provides text citations; this ingestion did not create PDF coordinates for yellow page highlighting.

Baseline broad/scoped retrieval p95 was370.690/373.261ms (20 samples each). Five subsequent windows used three samples per scope. One initial pre-write broad window was1285.853ms and recovered in the next window; later broad p95 values were438.161,400.498,670.352 and658.248ms. No two consecutive windows exceeded the manifest's2×baseline pause threshold. These measurements include network overhead and do not establish CPU/RAM capacity.

After the load, `ANALYZE public.document_chunks; ANALYZE public.documents;` succeeded. Planner live tuples match **57,244 chunks /2,456 documents**. Overall state: **2,456 documents /2,453 indexed /57,244 chunks /1,347 covered listing bill keys**. Covered bill keys count distinct indexed, chunk-bearing keys also present in `desk_rows`; it is not the count of all metadata keys. Database size988,679,315bytes; combined chunk indexes241,500,160bytes. No database restart occurred.

Both existing Mistral page-aware documents retain their original indexing/extract identity, version3 and40/81 chunks. The three earlier held text-only stubs were untouched.

## Evidence and remaining boundary

Artifacts are under `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/text-context-v4-final`: authorized manifest, checkpoint, baseline, deployment log/source fingerprints, rollback source, independent verification JSON/script, execution logs and post-load count/planner captures. Local implementation tests and warnings are recorded in [the implementation report](2026-10-09-text-section-context.md); no code changed during release, so unchanged suites were not repeated. Those results include874 Deno and2,465 application tests, focused checks, lint/build and two non-vacuous local SQL fixtures. Existing large-bundle and Node experimental type-stripping warnings remain.

Work remains uncommitted on `task/corpus-single-pilot-20261009`, preserving earlier corpus changes. Main matches origin/main; no merge or push occurred. The implementation paths are `_shared/textContext.ts`, `_shared/chunking.ts`, `ingest-documents/handler.ts`, their focused tests and the corpus preparation/runner scripts; this release adds documentation/evidence only.

Owner should attach **Immigration and Foreigners Bill,2025** in chat and ask:

1. “What information must universities provide when admitting a foreigner? Cite the relevant clause.”
2. “What penalty does this bill prescribe for entering India without the required passport or visa? Cite the clause.”

Check the cited text and listing Download PDF. Owner acceptance is pending; the five-document follow-up,42 larger mapping-approved medium sources and broader identity holds remain open under R7. No further ingestion is authorized by this pilot release.
