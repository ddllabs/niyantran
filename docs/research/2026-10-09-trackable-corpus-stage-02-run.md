# Second trackable-text stage: execution evidence

> **Status: Historical (2026-10-09).** [Plan](../plans/2026-10-09-trackable-corpus-jobs.md), [spec](../specs/2026-10-09-trackable-corpus-jobs.md). Owner confirmed the first-stage RAG sample works and instructed: “Working, continue.”

The next prepared batch completed: **25 documents / 693 chunks**, adding indexed text for **25 previously uncovered bill keys**. Existing corpus text was ingested through the existing text endpoint, one document at a time. No re-OCR, cleanup, schema change, service installation or deployment occurred.

| Metric | Before | After |
|---|---:|---:|
| Stored documents | 2,389 | 2,414 |
| Indexed documents | 2,386 | 2,411 |
| Embedded chunks | 55,484 | 56,177 |
| Current bill keys with indexed documents | 1,281 | 1,306 |

All 25 stage keys had zero indexed documents in the pre-write read. The three earlier text-only holds are unchanged. Endpoint receipts report 107,711 embedding tokens / **USD 0.00215422** against the existing USD 0.08 budget ceiling. There were 25 live attempts, no failed sources/retries and no unknown usage. Receipt-reported cost has not been independently reconciled against a provider invoice.

## Executed verification

- Worker checkpoint completed with every entry verified; supervisor stopped at this stage boundary.
- Independent read-only audit verified all 25 source texts/hashes, attachment keys, current listing title/number/chamber identities, actual UI Download PDF URLs, expected unique chunks, chunk hashes, exact UTF-16 citation spans and finite nonzero 1,536-dimensional embeddings. Both bill listing features were checked.
- The current bill attachment lookup includes each document. Stored-vector `match_documents` queries scoped to that lookup retrieved the intended source for every document. This proves backend scoping, not natural-language answer quality or second-stage UI acceptance.
- Fresh idle baseline: broad p95 813.89 ms / scoped p95 367.08 ms, 20 probes per scope, 40-result queries, including network overhead. All 27 in-stage/final windows passed the configured threshold; final broad p95 618.14 ms / scoped 350.96 ms. Three-probe operational windows and unavailable CPU telemetry limit capacity conclusions.
- Authorized `ANALYZE public.document_chunks; ANALYZE public.documents;` completed. Planner live counts match actual counts: documents 2,414; chunks 56,177; desk rows 34,184. Database start time remained 2026-09-28 08:19:47.722698+00; no restart-triggered desk-row ANALYZE was needed.
- Database size: 973,409,427 bytes. Combined chunk indexes: 236,904,448 bytes. No compute or index configuration was changed.

Commands: `node scripts/corpus-stage-job.mjs --baseline <release-manifest> <release-sha>`; `node scripts/corpus-job-supervisor.mjs --execute <release-manifest> <release-sha>`; `node /private/tmp/corpus-stage-02-verify.mjs`; the ANALYZE statements; independent SQL counts/start-time/size/planner queries; `git diff --check`. All passed. Existing Node experimental type-stripping warning remains. No application/runner implementation changed, so earlier implementation suites were not repeated.

## Evidence and optional RAG sample

Artifact directory: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/preflight-v2/`.

- `stage-02-release.json`, SHA-256 `ef7933c0aa4ea71e805a700e252081ba9477525baad7516ded6a594fa07455a6`, preserves proposal content with explicit release authorization. Proposal hash: `eb5a474f107564f62516dcd3275948e550ac7803dd8acdc9faeeb21d8731eac5`.
- `stage-02-release.json.checkpoint.json` / `.health.json`: receipts and health baseline/windows.
- `stage-02-release-verification.json`: all document UUIDs, source IDs, titles, keys, URLs, listing rows and scoped retrieval results; captured 2026-10-09T09:58:52.626Z.
- `stage-02-release-sql-counts.json`: independent post-stage database totals/sizes/planner checks.
- Execution/baseline logs, `stage-02-verification.mjs` and `stage-02-release-checksums.json` preserve reproducible evidence. Original proposals and stage-01 evidence remain unchanged.

For an optional test, drag **The Energy Conservation (Amendment) Bill, 2022** (`bill:2022:177`, 32 chunks) into chat and ask: “How does this bill provide for carbon credit certificates and non-fossil energy requirements? Cite the relevant clauses.” Click the citations to check the supporting text and source PDF against the listing Download button. This path provides existing text citations, not newly generated PDF page-coordinate highlights.

Forty-one other passing small sources remain in stages 3–4. Medium sources and identity/body/header holds remain separate pending work. The job is stopped; no later stage was released. Local documentation changes remain uncommitted on `task/corpus-single-pilot-20261009`; main is unchanged. First-stage owner RAG acceptance is recorded; second-stage backend verification is complete, without claiming owner UI acceptance.
