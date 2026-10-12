# Corpus batch preparation and shared blockers

> **Status: Historical (2026-10-11).** Local implementation and preparation evidence, not ingestion authorization or production acceptance.

## Outcome

Local fixes now reject ambiguous/cross-year bill analysis joins, bind 65 explicit bill identities to unchanged analysis PDF-link objects, and support independently reviewed Download-text repairs with separate original/repaired hashes. A new quality screen catches missing later clause contexts even when clause 1 was recognized. No chunker/Edge Function implementation was changed in this task.

The next **500 absent-source candidates** are prepared as a review inventory, with **4,769 complete draft chunks / 2,675,926 source characters**. **Zero are released for ingestion.** This is not a claim that the remaining corpus is unusable: identity, layout and deployment gates remain unresolved. No ingestion, paid OCR/embeddings, live database writes, deployment, existing-source overwrite, push or merge occurred.

Evidence directory:
`/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-batch-20261011`

Review files: `next-batch.review.csv` (500 rows), `next-batch.review.json` (exact per-source URLs, hashes, counts and holds), `visual-quality-review.json` (14 closer candidates / 57 rendered pages), and original detailed screening ledgers. Review JSON SHA-256: `84cfd82e966b646205622e3d11bafc980e03774943e415327aafd272872ae03f`. It has a review-only schema and `execution_authorized:false`; it is not an executable stage manifest.

## Fresh inventory and evidence strength

Read-only REST snapshots returned 2,767 document records and 19,634 listing rows across the two bill features. Within the original 7,064 bill-source pool, 423 source identities are present with an indexed timestamp, three are existing recovery records, and 6,638 are absent. Presence/indexed timestamps are not complete vector audits. This turn did not independently recount every live chunk/vector or re-audit previously indexed sources. The historical 87,886-chunk count is not presented as a new measurement.

The preparation streamed original and Citation Pack data and checked the 7,064 candidate source hashes. It produced 3,267 analysis identity proposals and 1,309 ambiguous/missing-identity holds across the 4,576 analysis entries. Proposals are not published mappings or ready documents. The selected 500 form one bounded review cohort, not a representative statistical sample of every absent source.

| Check on the selected 500 | Count | Meaning |
| --- | ---: | --- |
| Whole original text and v4 draft chunks prepared | 500 | No source/chunk truncation |
| Source PDF identity screen passes | 269 | Identity sampling, not full text quality |
| Both source and proposed Download PDF identity screens pass | 81 | 740 draft chunks across 65 bill identities |
| Full source PDF text-layer equality ignoring only whitespace | 50 | Preserves punctuation/case, but PDF OCR layers can themselves be wrong |
| No missing clause markers in additional automated screen | 14 | Still requires image/layout/semantic review |
| Rendered pages inspected for those 14 | 57 | Concrete quality holds recorded |
| Fully quality-accepted and production-release-ready | **0** | No ingestion started |

All 81 paired-identity passes have a different proposed Download from the saved pre-change resolver's result. The comparison uses fresh listing data and saved resolver code; it is not a new deployed-browser verification. All require deployment/actual-UI proof before release. The other 419 are held at one or both PDF identity screens, including unsupported Gazette URLs; failure of that screen alone does not prove no usable document exists.

## Shared fixes and their limits

1. `src/lib/impactRecord.js` now matches bills by unique number/year/chamber/title. Number-only, ordinal and unchecked direct-ID shortcuts cannot override bill identity. Other desks retain their keyed contract. A companion file supplies identity only where the exact original PDF-link object and bill number still match.
2. `public/data/embedded_json/national_bill_analysis_identity.json` contains **65 entries / 65 keys**, SHA-256 `a4a23757fcd405585221aa8fe5139d8d043fba9f03d954c609896d8785c83e7d`. These bindings concern identity, not OCR quality. The original analysis collection remains untouched. Most entries still have no proven full identity, so they fail closed. **Deploying this limited companion would reduce analysis/Download enrichment coverage; broader binding verification is a rollout prerequisite.** Nothing was deployed.
3. The browser and local corpus preflight/worker validation now use the same binder/companion. Candidate proposals used during broad screening remain distinguished from this smaller local binding inventory.
4. `verifyDownloadRepair` allows the Download's own reviewed repair proof: original raw hash, repaired hash, PDF hash, exact edit ledger and hash-bound full-body quality review, with safe contained paths. The actual manifest loader accepts proven repairs and rejects changed evidence. It does not certify quality automatically, change original hashes, or authorize existing-source writes. No actual Download repair was released here.
5. `corpus-batch-review.mjs` provides bounded whole-document selection and independent missing-clause screening. It always returns `quality_accepted:false`; automatic pass counts never grant execution permission.

The special registration-year/version hold for `bill:2022:290`, shared-key collisions, Gazette identity, existing recovery records, and Government/University existing-source correction holds remain. Their proof requirements were not removed.

## Why the closer candidates remain held

The visual review found actual defects, not a CPU or schedule limitation. Gold (Control) Repeal 1990 has printed clause 2 rendered as OCR `Z`, leaving it under clause 1 context. Delimitation Commission 1954 has inserted section 9A recognized as SA. Other historical candidates contain visibly corrupted operative headings/words. These cannot be accepted because a PDF's text layer repeats the same errors.

Five appropriation candidates need complete schedule row/column reconciliation and verification that each chunk retains column meaning. Plain-text fixed-width schedules are not equivalent to Markdown tables; a `THE SCHEDULE` section prefix does not recover missing column context. Five other native-PDF candidates retain marginal labels interleaved with body text and/or trailing back-cover text under prior section context. Their reading order and section boundaries require source-specific repair/review. These are recorded individually in `visual-quality-review.json`; none has been silently accepted or deleted.

The remaining 36 of the 50 whitespace-equal sources have missing clause-context markers in the stricter screen. The other 31 paired-identity candidates require fuller text/layout review. These categories are holds requiring investigation, not permanent rejection counts.

## Chunking contract preserved

Preparation passes the **entire original OCR text** through `chunkTextWithContext`, the same shared function selected by `ingest-documents` for `section_context_v1`. It does not reuse old database chunks or perform paid OCR/embedding locally. The endpoint would recompute/validate the chunks and generate embeddings during an approved ingestion.

Current code defaults are **1,000 target characters / 200-character overlap**, with paragraph/word boundaries, explicit Markdown and legal-section detection, context prefixes, exact source spans and complete document coverage. They are not a 1,200-character overlap setting. The chunker/context SHA-256 values before and after preparation match. Per-source limits remain 800 complete chunks / 600,000 characters; no 100-chunk truncation was applied. Quality failures remain visible instead of changing these rules to force a pass.

## Verification and working-tree state

- Resolver regressions failed before the fix: cross-year, incomplete identity, ordinal collision, wrong title/chamber and duplicate matches. They pass after it. Companion binding regression also failed before implementation.
- Download-repair loader regression failed under the old original-equals-repaired requirement, then passed with the evidence contract. Mutated raw/text/PDF/review/proof and path-containment failures remain rejected.
- Missing-clause regression failed when one recognized clause hid a later unrecognized clause; it now passes.
- `node --experimental-strip-types --test scripts/corpus-*.test.mjs`: **110 passed**.
- `npm test`: **2,472 passed / 185 files**.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: **880 passed**.
- `npm run lint`: passed, no warnings.
- `npm run build`: passed; existing bundle-size warning above 500 kB remains.
- No SQL migration/auth changes or production failure injection. No deployed UI/browser acceptance performed.

Logs and final chunker hashes are in the evidence directory. Work remains uncommitted on `task/corpus-single-pilot-20261009`; substantial pre-existing changes were preserved. The earlier 82-file conversation diff is not a count of changes from this task.

## Next release sequence

Complete/verify additional identity bindings and assess analysis coverage before any separately authorized deployment. Repair/review source and Download reading order with originals preserved and exact proof ledgers; validate substantive clauses and table context. Assemble only sources that pass those checks into an exact draft release, up to 500. Then perform fresh live attachment/Download checks, endpoint no-write dry run, price/budget and manifest-bound health/capacity checks. Show that exact release and its counts to the owner before ingestion. Do not infer permission from this review inventory or an earlier heartbeat instruction.
