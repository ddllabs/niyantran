# Medium corpus audit and next ingestion proposal

> **Status: Historical (2026-10-09).** [Spec](../specs/2026-10-09-medium-corpus-preflight.md), [plan](../plans/2026-10-09-medium-corpus-preflight.md). Owner authorized investigation/preparation. No medium document was ingested or embedded in this task.

**48 of 117 medium candidates pass the current source/mapping/PDF checks, representing 10,093 chunks and 48 bill keys that presently have no indexed documents.** All 48 passed the actual ingestion endpoint's `dry_run:true` check. Eight have at most 100 chunks and are the clearest next group: they exceed only the existing character guard. The other 40 require larger-document execution verification. The 69 held sources require internal evidence review; this audit has not established a concrete missing-data requirement for the client.

## What was actually checked

The new read-only medium tier reuses the tested small-tier identity checks, with audit bounds of 700 chunks /600,000 characters /500 PDF pages and the unchanged 20 MB PDF download cap. These are preparation bounds, not live worker limits. Small-tier defaults stay unchanged. Draft stages are capped at ten documents /1,000 chunks, without splitting a document, and are all execution-unauthorized.

- Reread the original compressed corpus and pack, confirming source IDs, text SHA-256 and character counts for the selected sources. Re-ran the current chunker with first-occurrence hash deduplication.
- Checked current listing title/chamber identity across both bill features and the actual `analysisFor` / `buildBillModel` Download PDF URL. Refused ambiguous identities or URL mismatches.
- For sources that reached the PDF gate, fetched the actual Sansad PDF without redirects, extracted layout-aware text and checked bill number/year, title, explicit version, chamber path and distributed body agreement (at least 90%). Gazette cases stop before PDF download because the existing rules cannot yet establish bill-to-Act identity.
- Independently re-chunked every passing source and compared exact hashes and UTF-16 spans; verified cached text/PDF hashes. The 48-source union exactly matches the twelve draft stages and their 10,093 chunks.
- Submitted each passing source to the actual endpoint with `dry_run:true` only. All 48 reported the expected chunk count. No embedding invocation or production document/chunk write occurred.
- Read the embedding request and commit batching code. None of the 48 passing documents has a chunk longer than the current 28,000 UTF-16-character embedding clamp, so no passing source would lose chunk text to that clamp. This is a code/size check, not proof of an embedding model's semantic coverage.

## Findings

| Classification | Documents |
|---|---:|
| Source/mapping/PDF pass; no-write endpoint pass | 48 |
| Gazette bill-to-Act identity requires review | 47 |
| PDF/source body-text comparison below threshold | 16 |
| Bill number/year mismatch or unreadable header | 4 |
| Title mismatch | 1 |
| Version mismatch or unreadable version | 1 |
| Total | 117 |

A comparison failure is a hold, not proof the text is intrinsically unusable. Reading order, extraction artifacts or a version mismatch may explain it. Header/version holds need actual cover-page review; gazette holds need a defensible bill-to-Act relationship. None is automatically a client-data blocker. `held-source-review.csv` identifies every source/key/URL/reason and the next internal check.

Passing sizes: 70–697 chunks and 51,745–487,258 characters. Source readiness does not establish a safe maximum invocation duration. Public model price was confirmed at USD 0.00000002/token. Chunker estimate for all 48: 2,337,089 tokens / USD 0.04674178. One-attempt UTF-8-byte reservation ceiling totals USD 0.18730352. Estimates exclude retries, hosting, storage, OCR and chat; no such embedding charge was incurred here.

## Concrete next group: eight documents /672 chunks

| Bill | Attachment key | Chunks | Characters |
|---|---|---:|---:|
| Immigration and Foreigners, 2025 | `bill:2025:22` | 83 | 56,866 |
| National Sports Governance, 2025 | `bill:2025:76` | 92 | 70,807 |
| Bharatiya Vayuyan Vidheyak, 2024 | `bill:2024:74` | 94 | 71,735 |
| Biological Diversity (Amendment), 2021 | `bill:2021:158` | 78 | 59,105 |
| Scheduled Castes and Scheduled Tribes (Prevention of Atrocities) Amendment, 2013 | `bill:2013:148` | 74 | 58,119 |
| Authority for Advance Rulings on Central Taxes, 2007 | `bill:2007:99` | 70 | 51,745 |
| Private Detective Agencies (Regulation), 2007 | `bill:2007:XL` | 99 | 68,416 |
| Industrial Finance Corporation (Amendment), 1985 | `bill:1985:210` | 82 | 53,486 |

These fit the existing 100-chunk bound and require at most one 100-row commit per document. They need a tested increase of the worker's character cap from 50,000 to **75,000**, keeping all other controls intact. Estimated tokens 155,423  / USD 0.00310846 for the eight.

Recommended first pilot: **Immigration and Foreigners Bill, 2025**, source `6c18b649806b7aa824a8226ffdb9701fed15e88f`,83 chunks. Proposed ceiling USD 0.015; fresh hash/PDF/mapping/health checks, independent text/vector/span/bill-scoped retrieval verification and authorized ANALYZE after execution. Then owner RAG/citation testing; the remaining seven would add 589 chunks under a separate USD 0.08 follow-up proposal. These are concrete proposals, not execution authorization.

- `pilot-proposal.json` SHA-256 `26f50bfca6a11d56e1ea877c0a0b3b72d858877909984dacbf22c87d12e43e08`.
- `post-pilot-seven-proposal.json` SHA-256 `d5aa02daf4e52859a44ac8d079da4cb7d02be6dc0b76ee34eec8b57951fd4daa`.
- `low-chunk-proposal.json` is the alternative all-eight inventory, not an additional sequential batch. Never ingest it as well as the pilot/seven manifests.

## Why the other 40 need a separate execution step

The current live worker has hard limits of 100 chunks and 50,000 characters and reads at most 101 stored chunks during reconciliation. Merely raising its manifest limits would either fail or truncate verification. Medium execution needs tested bounds and complete chunk reads before release. The production handler slices commits into groups of 100, but it embeds all missing chunks within one invocation before committing. Historical interruption around 700 chunks demonstrates an invocation concern; a server upgrade does not prove the function/gateway time limit changed. The 697-chunk Merchant Shipping source should not be the first pilot.

Keep one document per request and staged health checks. Measure progressively larger sources; hold partial writes with an exact repair inventory rather than accumulating unusable embeddings or blindly retrying. No worker/endpoint/schema recovery behavior was changed in this investigation. CPU/RAM telemetry and live medium throughput remain unmeasured.

## Verification and state

- New medium acceptance/policy tests failed before implementation; then 51 focused checks passed: `node --experimental-strip-types --test scripts/corpus-job-preflight.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-job-supervisor.test.mjs`.
- `npm test`: 184 files / 2,465 tests passed. `npm run lint` passed. `npm run build` passed; existing >500 kB bundle warning remains. Node experimental type-stripping and PDF.js `TT: undefined function: 21` font warnings occurred; no check was weakened to pass them.
- Executed `node --experimental-strip-types scripts/corpus-job-preflight.mjs <new-job-dir> <pack-dir> <original-dir> medium` and `node --experimental-strip-types <readiness-audit.mjs>`; no-write/source checks all completed. `git diff --check` passed.
- Independent before/after SQL: **2,455 documents  / 2,452 indexed  / 57,153 chunks**, unchanged. Database start remained 2026-09-28 08:19:47.722698+00. No ANALYZE was needed because no bulk write/restart occurred.

Changed paths: preflight script/tests, this spec/plan/report, operator guide and R7 tracker. All remain uncommitted on `task/corpus-single-pilot-20261009`; main unchanged and 0/0 against origin/main after fetch. No deployment, service, destructive repair or medium ingestion.

Evidence root: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/medium-preparation/`. It contains the immutable input inventory, preflight/readiness logs, audit script, hold-review CSV, summary and verification logs. `preflight-v2/` holds original-source checks, 117 receipts, 48 cached text/PDF pairs, expected spans, 12 unauthorized draft stages, 48 no-write results and pilot/follow-up proposals. Prior small-cohort evidence is unchanged. Broader small-source holds and ambiguous-key/listing-link work remain open.
