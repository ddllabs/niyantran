# First released trackable-text stage: execution and RAG samples

> **Status: Historical (2026-10-09).** Executed production evidence. [Plan](../plans/2026-10-09-trackable-corpus-jobs.md), [spec](../specs/2026-10-09-trackable-corpus-jobs.md). This is the new 25-document stage, separate from the earlier 23-document stage and its three holds.

The owner authorized this stage and requested one or two documents for RAG testing before continuing. Exactly 25 sources and 681 chunks were ingested through the existing text endpoint, sequentially, using existing local OCR/text. No re-OCR, schema change, deployment, cleanup or subsequent stage was performed.

## Counts and receipts

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Stored documents | 2,364 | 2,389 | 25 |
| Indexed documents | 2,361 | 2,386 | 25 |
| Embedded chunks | 54,803 | 55,484 | 681 |
| Current bill keys with indexed documents | 1,257 | 1,281 | 24 |

One of the 25 keys already had another indexed document; the other 24 gained their first indexed document. The three earlier text-only holds remain unchanged. Twenty-five live attempts completed without failed sources, retries or unknown usage. Endpoint receipts report **112,646 embedding tokens / USD 0.00225292**, below the USD 0.08 authorized ceiling. This is receipt-reported embedding cost, not an independently reconciled provider invoice.

## Verification executed

- The supervisor stopped with checkpoint status `complete`, all 25 entries verified.
- An independent post-stage read checked each source's exact text/hash, current listing key/title/chamber, document URL against the actual UI Download PDF resolver, expected chunk hashes/content/indices, UTF-16 citation spans, legacy source kind, and all 1,536-dimensional finite nonzero embeddings.
- The bill attachment's indexed-document lookup includes every newly ingested document. `match_documents` scoped to that lookup returned the intended document for all 25 sources. These checks used stored vectors; natural-language chat answer quality and live citation UI behavior await owner testing.
- Fresh idle baseline: broad p95 638.35 ms, scoped p95 383.43 ms (20 probes per scope, network-inclusive). All 27 in-stage/final health windows passed the configured threshold. Final window: broad 625.38 ms, scoped 369.67 ms. Small three-probe windows are operational signals, not a statistical CPU capacity guarantee; CPU/RAM telemetry remains unavailable.
- `ANALYZE public.document_chunks; ANALYZE public.documents;` succeeded. Planner `n_live_tup` matches real counts: documents 2,389; chunks 55,484; desk rows 34,184. Database start time stayed 2026-09-28 08:19:47.722698+00, so no restart-triggered desk-row refresh was needed.
- Database size after stage: 963,882,131 bytes. Combined chunk indexes: 233,897,984 bytes. These sizes do not establish physical RAM or an index memory limit.

Commands executed: `node scripts/corpus-stage-job.mjs --baseline <release-manifest> <release-sha>`; `node scripts/corpus-job-supervisor.mjs --execute <release-manifest> <release-sha>`; `node /private/tmp/corpus-stage-01-verify.mjs`; the ANALYZE statements above; independent SQL counts/size/start-time/planner checks; `git diff --check`. All passed. No application or runner code changed during execution, so earlier implementation suites were not repeated; their results remain in the preparation report.

## Two owner RAG tests

Find each bill in either bill listing, drag it into the chat, ask the prompt and open its citations. Confirm the cited text supports the answer and its source PDF matches the listing Download button. These documents use the existing text citation viewer; this ingestion does not add PDF page-coordinate highlights.

| Bill | Attachment key | Document UUID | Chunks |
|---|---|---|---:|
| The Public Examinations (Prevention of Unfair Means) Bill, 2024 | `bill:2024:15` | `cc6f55f4-a066-4a1e-b0de-95e67c079c3c` | 35 |
| The Anusandhan National Research Foundation Bill, 2023 | `bill:2023:115` | `2092f571-997e-4903-b684-c4b2dd98bf1d` | 54 |

Both keys had zero indexed documents before this stage and now have one each.

**Public Examinations prompt:** “What penalties and restrictions does this bill impose on service providers? Cite the relevant clauses.” The stored text includes a fine up to one crore rupees, proportionate examination cost recovery and a four-year bar from public-examination responsibilities. Evaluate against the ingested document version.

[Public Examinations PDF](https://sansad.in/getFile/BillsTexts/LSBillTexts/PassedBothHouses/public%20examination220202453413PM.pdf?source=legislation).

**Anusandhan prompt:** “Which funds does this bill establish, and what is each fund used for? Cite the relevant clause.” Clause 13 lists the Foundation Fund, Innovation Fund, Science and Engineering Research Fund, and one or more Special Purpose Funds, with their uses.

[Anusandhan PDF](https://sansad.in/getFile/BillsTexts/LSBillTexts/PassedBothHouses/Anusandhan818202342312PM.pdf?source=legislation).

## Frozen evidence and continuation boundary

Runtime evidence is in `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/preflight-v2/`:

- `stage-01-release.json`, SHA-256 `f27446ff510834cfd659ced6b6b8008cdf20f5dea771b20bc264944ca0489561`, binds approval to the unchanged proposal content/hash.
- `stage-01-release.json.checkpoint.json` and `.health.json` contain durable per-source receipts and health evidence.
- `stage-01-release-verification.json` contains all 25 document UUIDs, counts, keys, URLs, matching listing rows and scoped retrieval results; captured 2026-10-09T09:46:42.931Z.
- `stage-01-release-execution.log`, `stage-01-release-baseline.log` and `stage-01-release-checksums.json` preserve execution logs and final artifact hashes. Earlier proposal/dry-run/preparation evidence remains unchanged.

The job is stopped before the next stage. Sixty-six other passing small sources remain; medium sources and evidence holds remain separate pending work. No scheduler was installed. Local changes remain uncommitted on `task/corpus-single-pilot-20261009`; main is unchanged. This record establishes backend ingestion/linking/retrieval evidence, not owner UI acceptance. Continue only after the owner's sample test and next-stage authorization.
