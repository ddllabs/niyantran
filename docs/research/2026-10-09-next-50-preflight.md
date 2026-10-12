# Next50 corpus preflight

> **Status: Historical (2026-10-09).** Requested read-only preflight; no production ingestion, OCR, embeddings, cleanup or deployment.

**42 of50 candidates pass refreshed original-text, citation-pack, listing/Download URL and live PDF identity/body checks. Eight remain held.** All42 passes also match the deployed context chunker's no-write endpoint counts. They represent **10,171 version4 chunks** and42 currently unindexed sources. None is executable through the current bounded worker: every document exceeds100 chunks. Source readiness and execution capacity are separate findings.

## Selection and source evidence

The previous six-source context cohort was excluded. This audit selected all42 remaining previously approved medium sources, plus eight non-gazette medium holds ordered by ascending legacy chunk count/source key. These eight were selected for review, not presumed safe. The exact50-source inventory and old statuses are frozen under the artifact directory below. Thus this is a50-candidate audit, not a claim that50 documents are ready.

Fresh execution streamed the original corpus `_clean.jsonl.gz` and citation-pack `bills.jsonl.gz`, checking source IDs, hashes and lengths. It read current Supabase source absence and bill-key listing identities, checked both bill-feature rows and the actual UI Download resolver, fetched original public PDFs with host/size bounds and reconstructed their reading text. Bill number/year, title, chamber path, explicit document version and at least90% distributed OCR/PDF body-sample agreement were required. Previous receipts were not reused as current approvals.

All42 prior passes passed again. All eight prior holds remain held:

| Candidate | Current hold |
| --- | --- |
| Coastal Shipping2024 | PDF/OCR text disagreement |
| Boilers2024 | PDF/OCR text disagreement |
| Foreign Contribution Regulation Amendment2026 | PDF/OCR text disagreement |
| Maruti Acquisition and Transfer1980 | Version mismatch or unreadable version |
| National Highways Authority1988 | PDF/OCR text disagreement |
| Tribhuvan Sahkari University2025 | Bill number/year mismatch or unreadable header |
| Surrogacy Regulation2016 | PDF/OCR text disagreement |
| Banning of Unregulated Deposit Schemes2018 | PDF/OCR text disagreement |

These are internal evidence holds. This audit neither proves that their text is unusable nor establishes a client missing-data requirement. They need source/version/body investigation before release; a working URL alone is insufficient.

## Context and execution readiness

Fresh passing version2 receipts yielded9,614 chunks. Regenerating through `section_context_v1` yielded10,171 version4 chunks,9,064 with heading context and6,569 with clause/label context (overlapping counts). Exact UTF16 source spans and frozen chunk/context/input hashes reproduced; zero word-interior boundaries were found. All42 `dry_run:true` endpoint calls acknowledged version4 and the exact local counts, with no writes or provider invocation. Largest prefixed embedding input is6,045 characters, below the current28,000-character provider-input clamp; no input would be truncated.

Documents range **103–790 chunks /68,416–487,258 source characters**. All42 fail the unchanged worker's actual `validateEntries`100-chunk guard; local rejection evidence was executed and saved. Additionally38 exceed its75,000-character limit. The worker reads at most101 chunk rows during reconciliation, limits stages to30 documents /1,000 chunks and permits one document per request. Increasing only a manifest would not provide complete verification. The largest context source, Merchant Shipping2024, has790 chunks, even above the earlier700-chunk legacy audit policy; no live medium limit was raised.

Expected per-document embedding batches:2–9;100-row commit groups:2–8. The handler embeds missing chunks before committing/indexing, so read-only dry-run success does not establish safe paid invocation duration, gateway timeout or recovery from a partially committed large document. Direct CPU/RAM telemetry remains unavailable. A50-document batch should become a sequence of bounded whole-document stages after tested larger reads/limits and measured progressively larger pilots, retaining exact spans/context, receipts, health pauses and partial-state holds. Do not truncate a document or bypass the100-chunk guard.

Public `openai/text-embedding-3-small` price remainedUSD0.00000002/token. Chunker estimate for42 sources:2,180,378 tokens /USD0.04360756. Conservative one-attempt UTF8-byte reservation ceiling:USD0.17527916. These are estimates/reservations, not charges; retries, hosting and other operations are excluded. No execution-authorized manifest was created.

## Verification and artifacts

Executed successfully:

```bash
node scripts/corpus-job-preflight.mjs <next-50-preflight-dir> <citation-pack-dir> <original-corpus-dir> medium
node scripts/corpus-context-preflight.mjs <next-50-preflight-dir>/preflight-v2 <next-50-preflight-dir>/context-v4
node <next-50-preflight-dir>/context-readiness-audit.mjs
```

The first preflight launch had a citation-pack path typo and exited before reading data; the corrected launch completed50/50. Node experimental type-stripping and PDF.js `TT: undefined function: 21` font warnings occurred. They did not bypass identity/body checks. `git diff --check` passed. No implementation changes occurred, so unchanged application/Deno suites were not repeated.

Before/after independent SQL agrees: **2,461 documents /2,458 indexed /57,671 chunks**, postmaster start unchanged2026-09-28 08:19:47.722698UTC. No ANALYZE was needed because no load or restart occurred.

Artifacts: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/next-50-preflight`. Includes exact inventory/selection, per-source `review.csv`, original-source checks,50 pass/hold receipts,42 cached text/PDF pairs, immutable unauthorized version2 draft stages, version4 receipts/frozen spans, no-write endpoint results, worker-rejection evidence, public-price estimates and before/after SQL/logs. The eight held candidates are excluded from the context-ready receipt set.

Changed repository paths: this report, [preflight plan](../plans/2026-10-09-next-50-preflight.md) and R7 tracker. Local artifacts/audit script are outside Git. Existing task branch and earlier uncommitted work are preserved; main equals origin/main after fetch. No push, merge, service, production data write or embedding charge.

Next required work is a tested larger-document worker and measured staged execution for the42 identity-approved sources, plus separate review of the eight holds. This preflight does not establish a safe single-shot50-document production run.
