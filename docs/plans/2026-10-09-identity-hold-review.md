# Corpus identity-hold review

> **Status: Living.** Owner continued after completion of the approved medium queue. Sequential investigation, no delegation.

Current state: all91 approved small sources and48 approved medium sources completed;325 small/medium identity/body holds remain. Start with54 header/title/version holds (48 small,6 medium); gazette/body disagreements and shared-key conflicts remain excluded.

Expected result: exact source/current listing/PDF evidence explaining every selected hold; recover a candidate only when bill number/year, chamber, document version, title and distributed body agreement are proven. Do not lower the90% body threshold, guess unreadable identity, or confuse a URL with proof.

1. Freeze54-source selection with historical hold reason in a new artifact directory.
2. Run the existing read-only preflight with an artifact diagnostic adapter that additionally preserves failed PDF/source text and identity metadata. Original corpus/pack hashes, current SQL/Download checks and PDF bounds remain. No ingestion transport.
3. Inspect failures for reproducible extraction/matcher defects versus actual mismatches/scanned headers. Any code correction requires narrow spec amendment, failing regression proof and relevant verification before new passes.
4. Report exact pass/hold/review counts and current production state; update R7. Only newly proven sources may enter a concrete later release. No OCR purchase, embeddings, production mapping changes, cleanup, deployment or service in this diagnostic phase.

Write scope: this plan, research report/R7 and local diagnostic artifacts. Repository code remains unchanged unless evidence justifies and documents a narrow correction. Preserve all earlier receipts.

## Narrow correction, 2026-10-09

The diagnostic run preserved all54 failures. Three modern headers use U+2012 FIGURE DASH between the exact bill number and passed-version suffix F. The parser currently recognizes only ASCII hyphen and en dash. Extend only that separator class in `scripts/corpus-job-preflight.mjs`, with regression cases in its test file proving valid spaced/unspaced headers pass and wrong number/year still fail. Do not normalize corrupt digits, alter titles, bypass version checks or lower body agreement. Verify red/green focused tests, all corpus tests, app tests, lint and build. Recheck cached diagnostics and then freshly fetch any newly eligible sources with current listing/hash checks in a new directory. This correction creates no authorization to ingest a document with an unresolved title/version disagreement.

Executed:54 fresh diagnostic holds; narrow figure-dash correction passed red/green and full verification. Corrected cached result:43 header,4 title,4 version and3 body holds; no eligible release. [Findings](../research/2026-10-09-identity-hold-review.md). Marginal-note row alignment is the next concrete defect to investigate, with baseline regression comparisons before changing layout. All three recovered identities reach100% agreement in a four-point diagnostic experiment, but that experiment is not release evidence. Resolve the Repealing/Amending2022 key versus2023 printed title explicitly. Production counts unchanged; no paid embedding/OCR or data mutation.

Owner's larger-job go includes continuing eligibility preparation. Add an observed-coordinate regression for displaced marginal baselines and a separate-close-line guard; compare four-point layout against all139 previously passing source/PDF receipts and the54 diagnostics. Require all prior passes retained before fresh release preflight. Retain the90% threshold, original text and all identity checks. Exclude the Repealing/Amending title-year exception from the next pilot pending explicit version review. Narrow additional write scope: preflight layout/test and evidence artifacts; no chunker/OCR changes.

Executed layout regression/comparison:139/139 prior passes retained; fresh two-source preflight100% body agreement. Delhi Laws2023 and Central Universities2023 ingested and independently verified under the capacity pilot (12 version4 chunks). [Report](../research/2026-10-09-corpus-500-worker-pilot.md).52 selected holds remain unreleased; larger body/gazette/key cohorts remain pending. No original text changed or threshold lowered.
