# Next50 corpus preflight

> **Status: Living.** Owner requested a next50 preflight after the context follow-up. Sequential read-only investigation; no delegation.

Current state: six bounded context sources ingested and verified;42 previously mapping/PDF-approved medium sources remain larger than the live worker policy. Select these42 plus eight non-gazette medium holds ordered by legacy chunk count then source key. The additional eight are audit candidates, not approved replacements. Exact inventory and historical status are frozen in `corpus-job-plan/next-50-preflight/selection.json` outside the repository.

Expected result: reconcile all50 to current original/citation-pack text hashes, current SQL listing/Download identity, live PDF bill/version/body agreement, section-context chunk/span/input quality and current endpoint no-write counts. Separate identity readiness from worker capacity. No guard weakening, truncation, OCR, embedding purchase, production writes, schema/deployment, cleanup, merge or push.

1. Refresh checkout/production counts; use a fresh artifact directory, preserving old evidence.
2. Run existing read-only `corpus-job-preflight.mjs` against the exact50 inventory, original corpus and citation pack, medium policy. Save every pass/hold.
3. Run `corpus-context-preflight.mjs` on fresh passing version2 receipts; audit all context chunks and actual `dry_run:true` endpoint counts without ingestion. Record worker/stage capacity separately; never bypass live100-chunk document cap.
4. Compare before/after production counts, save an exact per-source review inventory and report. Update only this plan, new research report, R7 and local artifacts. No implementation edits are expected; unchanged code suites need no repeat. Verify `git diff --check`.

Acceptance: all50 accounted for, source/hash/link evidence and holds explicit, current backend/chunk/size limits demonstrated, production count changes attributed or absent. CPU/RAM capacity cannot be established through read-only retrieval checks alone.

## Result

All four steps complete:50 candidates reconcile to42 refreshed identity/PDF passes and eight unchanged holds.42 version4 endpoint dry runs pass /10,171 chunks, exact spans and zero word-interior cuts, no input clamp. Executed current worker guard rejects all42 (103–790 chunks);38 also exceed75,000 characters. No ingestion/paid calls; production counts unchanged. [Evidence](../research/2026-10-09-next-50-preflight.md). Larger-worker implementation and measured release remain open in R7.
