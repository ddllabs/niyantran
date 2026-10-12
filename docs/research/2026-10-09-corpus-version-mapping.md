# Alternate bill-version mapping audit

> **Reconciled 2026-10-13 (F105):** this work is in `main` and production (`d0a8020` (corpus integration, 2026-10-12)). Lines below that call it uncommitted, local only or unmerged describe its state on the date written.

> **Status: Living.** Executed2026-10-09. R7 mapping/preparation evidence; no new ingestion or publication. [Spec](../specs/2026-10-09-corpus-version-mapping.md), [plan](../plans/2026-10-09-corpus-version-mapping.md).

Yes, more files already have local mappings. The frozen broader bill inventory has6,829 unstored sources with local text, source URLs and bill keys. That is a candidate count, not a verified ingestion count.827 are marked as the same bill with another document version; they must not be conflated with links to a different bill.

This audit selected226 ordinary alternate-version sources /141 bill keys whose current Download link is also a conventional Sansad bill PDF, excluding errata and the existing size bounds.175 source documents /116 bill keys passed original text, pack identity, current two-feature listing, both live PDF identities and full version4 context preparation. All175 endpoint dry checks confirmed the expected12,842 chunks and chunker_version4, with no embeddings or stored documents.51 sources remain held. The remaining601 of the827 alternate-version candidates were not given this full two-PDF audit.

**All116 passing bill keys already have indexed documents.** These175 are additional versions, not175 newly covered bills, and not116 new bills. Mapping is proven; full production release and version-specific natural-language RAG acceptance remain separate.

## What the proof establishes

The source OCR text retains its exact original hash and character spans. Its own PDF passes bill number/year/title/chamber/version checks and distributed body agreement>=90%. The current bill listing's Download PDF independently passes those checks using its own pack text and original archive hash. Both have unique pack URL identity and different supported bill-version roles. Neither source is relabelled as the other's text.

The new optional worker proof binds the bill identity, source URL/hash/role, Download URL/hash/role, both PDF receipts and cached Download text. Source and Download PDFs are refetched and hash-checked before worker execution. The live listing is checked against the proven Download URL, while the document's citation file_url remains its own source PDF. Exact-URL behavior remains the default; gazette, errata, wrong-bill and ambiguous cases are excluded. No original data, frontend resolver, schema or backend was changed.

Prepared text:8,584,074 Unicode characters;12,842 complete version4 chunks;9,562 chunks with heading context;7,673 with note context; zero word-interior boundaries; maximum content5,999 UTF-16 code units. These are the existing section-context rules, without truncation or a100-chunk document clamp. Roles:105 introduced,51 passed Lok Sabha,19 passed Rajya Sabha.15 bounded drafts remain execution_authorized:false.

## Holds reconciled to all226 candidates

| Recorded reason | Sources |
| --- | ---: |
| Bill number/year missing, unreadable or disagreeing |17|
| PDF/source body disagreement |11|
| Title disagreement |8|
| Pack bill key mismatch/ambiguity |6|
| Original/pack text hash or length check |5|
| Manual year identity exception |2|
| Version missing, unreadable or disagreeing |2|
| Total held |51|

The five original/pack holds were investigated further. Their selected source OCR hashes and lengths agree with the archive. Three distinct **Download-side** pack source IDs are absent from the frozen original archive, affecting five selected versions; the pack's own text hashes/lengths are consistent. They remain held under the current two-original-text proof rule. This is not evidence that their source OCR is missing or that client intervention is required. Gazette-to-Act proof and pack-only Download provenance require separately defined validation.

## Concrete mapping examples

- New Delhi International Arbitration Centre Amendment2022, `bill:2022:186`: passed-Lok-Sabha source `186-C_2022_LS_E.pdf` maps to the same bill as current passed-both-houses Download `NDIA118202341117PM.pdf`.16 context chunks; source key `55c79832d24e7f2d1398c001da99dd4b10df5f9a`.
- Mines and Minerals Development and Regulation Amendment2023, `bill:2023:101`: introduced source `101_2023_LS_ENG726202312622PM.pdf` maps to the same bill as current passed-both-houses Download `mines&mineral8162023122316PM.pdf`.133 complete context chunks; source key `862162953553c4875543cdac5c565082b36e66b6`.

Both are prepared only; no new document IDs exist for these sources. The source URLs and Download URLs are retained separately in released-sources.json and every proof receipt.

## Executed verification

- Pure two-version tests initially failed because the helper did not exist. Two new worker tests initially failed because proof validation/fetch planning did not exist. Final focused Node suite:90/90 pass, including wrong key/year/house/title/version/body, incomplete proof, changed caches, path escape and URL/hash conflict guards.
- Independent defect mutations removed the conflicting-hash guard and Download cache guard in disposable copies; their targeted tests failed in both cases. Copies removed. One cache-test fixture initially used macOS's symlinked temporary path; corrected the fixture to its real path while retaining the worker's path guard.
- Fresh226-source audit:175 pass /51 held. All175 original text/PDF caches, manifest bindings, full context spans/hashes/input bounds revalidated by current worker helpers. No conflicting links were found in passing source pack records.
- All175 one-document ingest-documents calls used dry_run:true; expected chunk counts/version4 confirmed; zero embedding tokens/cost. These endpoint checks test preparation acceptance, not stored-vector retrieval for the new sources.
- Full corrected-worker probe on the16-chunk arbitration source: cached proofs, fresh source and Download hashes, current listing resolution, source identity and endpoint dry check passed. Manifest SHA `caa620d86ffacb5eeaac5ec5a89e4feccb4f3e2b9a846c55b0a4264d4d121958`. Idle retrieval20 samples/scope: broad p95~450ms, scoped~414ms; both subsequent3-sample/scope windows passed. Every future paid stage still requires its own fresh worker/price/capacity/health checks and maintenance.
- `npm test -- --run`:2,465/2,465 pass across184 files. `npm run lint`:pass with zero warnings. `npm run build`:pass; existing>500kB bundle warning remains. `git diff --check`:pass. Node type stripping and some PDF font-interpreter warnings occurred; failed identity/body evidence was held rather than bypassed. No new Supabase/src/lib change in this phase, so no new Deno/SQL fixture run.
- Supabase plugin SELECTs before and after confirm2,576 documents /2,573 indexed /72,917 chunks /1,464 covered current listing bill keys.1,543 distinct indexed metadata bill keys is a different count: some are absent from the current two-feature listings. No orphan chunks and no chunks attached to unindexed documents; restart unchanged2026-09-28T08:19:47.722698Z. No bulk load, so no new ANALYZE operation was needed.

## Remaining work and practical limit

Broad Download-link resolver work remains: the frozen unprocessed categories include4,367 links resolving to another bill key,831 missing Download PDFs,99 different URLs without identity proof,438 listing-identity holds,256 exact-Download sources pending full proof,11 oversize sources, plus other alternate-version candidates. These categories are frozen screening outcomes, not a fresh full-corpus identity audit. Nonbill attachment/scoping and gazette-to-Act identity remain excluded.

Read-only code review confirms `Chunk` in `_shared/retrieval.ts` carries title/filename/URL/section, but no document_role. `renderChunk` in research-chat/agent.ts formats handle/title/desk_feature and content without an explicit bill-version label. Source headers sometimes contain a version, but this does not establish consistent version awareness in every retrieved passage. Before bulk alternate-version ingestion, verify or implement version labels in a separately scoped backend change and run an owner-accepted version-specific RAG pilot. Mapping correctness alone does not prove the model will distinguish introduced and passed provisions. This remains tracked under R7; no opportunistic backend change or deployment was made.

Branch remains task/corpus-single-pilot-20261009; main and production application unchanged. New mapping scripts/docs and prior authorized corpus work remain uncommitted. No merge/push/service/cleanup or data-collection changes.

## Evidence location

Local artifact root: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-version-mapping-226/`.

Inventory, original-source-checks, original-hold-details, receipts, summary, released/held-sources, cached text/PDFs,15 stage drafts and approval hashes,175 endpoint-dry-checks, mapping-worker-probe health/checkpoint, focused tests and two mutation logs are saved there. Summary SHA `94fedcbe19c06d1ccdda01c1e2ac9e2c36926b9a6c67a0a58814af40a438c25e`.
