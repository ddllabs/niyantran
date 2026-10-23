# National corpus continuation plan

> **Status: Living.** Implements the owner-authorized [scope](../specs/2026-10-23-national-corpus-continuation.md). Sequential work; no delegation.

1. Capture fresh document and two-feature listing inventories, reconcile all local bill source keys and prior hold/completion ledgers, and report bill/document readiness separately.
2. Select up to 1,000 distinct pending bill identities. Validate candidate originals and current PDFs; review full text/layout and complete version-4 context. Preserve mapping/quality/version holds with evidence. No production writes in preparation.
3. Assemble independently reviewed absent sources into new bounded manifests using existing profiles. Refresh exact current mapping, provider pricing, budget, no-write dry runs, retrieval baseline and capacity. Establish writer exclusivity across mechanisms.
4. Execute with the existing foreground supervisor. At every 20 documents or 2,000 chunks, independently audit cumulative results, refresh planner statistics, reconcile exact counts and acknowledge only a passing checkpoint.
5. Audit final results and receipts, record coverage separately from document counts, retain unresolved candidates, and update R7 plus the execution report.

Write scope: this spec/plan, `docs/plans/open-work.md`, the operator continuation boundary, a dated research report, and new runtime evidence outside Git. Existing application/worker code, original corpora, historical manifests and source data are unchanged. Any demonstrated implementation defect must be scoped and tested separately before changing execution behavior.

Verification: `node --experimental-strip-types --test scripts/corpus-*.test.mjs` (113 passed during the preceding local prerequisite check); new manifest-bound baseline/dry-run, cumulative independent audit, SQL count/planner/orphan checks and source/citation probes. Historical full integration suites are evidence, not newly rerun checks. Runtime checks remain pending until executed.
