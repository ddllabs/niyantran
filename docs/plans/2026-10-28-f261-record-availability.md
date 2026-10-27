# F261 implementation

> **Status: Living.** Local implementation, supervisor integrates.

Spec: [Record availability](../specs/2026-10-28-f261-record-availability.md). Tracking: F261 in open-work.md.

Sequential, sole task-agent writer; no delegation or commits.

1. Reproduce metadata/snapshot/error states in corpusCoverage and AttachmentTray tests; separate record capability from text status while retaining existing coverageOf semantics for retrieval prediction.
2. Reproduce subject identity and Parliamentary absence claims; update deskRows/aiDrop/AiPanel as needed, shapeQuestions and nationalQuestions, RailContent host, RecordPanel cached brief context. Coverage is derived from the same current RPC and never rewrites row facts or stored briefs.
3. Reproduce nested-list table rendering and test prompt quotation honesty; update AiMarkdown and research-chat prompt only.
4. Run focused Vitest tests, npm test, deno test -A --config supabase/functions/deno.json supabase/functions, npm run lint, npm run build. Router import only if api/server changes. No SQL changes expected. Return exact evidence and uncommitted diff to supervisor.

## Verification — 28 October 2026

- Causal RED: metadata/snapshot/error contract, question subject identity, register banner, verified adapter coverage, cached brief basis and quotation prompt tests failed against baseline. The actual saved-response shape was reproduced by the nested-list Markdown table test, which failed with literal pipes. Restoring baseline AttachmentTray/AiPanel/RailContent produced three intended display failures. Restoring the stale-text defect produced `full` instead of `error`. New supervisor review regressions first failed for pending identity, snapshot preservation, older-success/newer-error races, ticking-clock error recovery and saved-chip subject labels; each passed after its fix. No guards were accepted on green-only evidence.
- Focused commands: `npm test -- src/lib/corpusCoverage.test.js src/ai/AttachmentTray.test.jsx src/ai/WebSearchToggle.test.jsx` — 83 passed; final saved-label addition: `npm test -- src/ai/AttachmentTray.test.jsx` — 10 passed. Adapter, Markdown, identity, brief, host and scope tests also ran focused before the full suite.
- Final `npm test` — 436 files, 6,663 tests passed (91.27 seconds).
- `deno test -A --config supabase/functions/deno.json supabase/functions` — 1,441 passed, 0 failed. Includes prompt quotation policy and existing retrieval/access boundaries.
- Final `npm run lint` — exit 0, no warnings. Final `npm run build` — exit 0 (5.08 seconds), no build warnings. `git diff --check` — clean.
- Vitest emits expected fixture diagnostics on simulated feed/network/error paths; no failing tests. No standalone type-check was claimed. No SQL/migration or api/server code changed, so SQL fixtures and router import were not required or run.
- No browser or production acceptance performed by this task agent. Supervisor owns browser/release acceptance. Prompt policy applies to future generations; stored answers and briefs were not rewritten or regenerated. No data, schema, dependencies, paid calls, ingestion, commits, pushes or release actions performed.
- Final branch: `task/f261-record-availability`; scoped changes remain uncommitted for supervisor integration. F261 remains open until the supervisor lands it.
