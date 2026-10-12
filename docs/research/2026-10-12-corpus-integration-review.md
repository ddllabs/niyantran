# Corpus integration review — 2026-10-12

> **Status: Living.** Local integration preparation complete; owner integration/production acceptance remains separate.

## Outcome and preservation

UI chat “Review project and agent rules” confirmed its Git work finished and no corpus writes were active before this task changed Git state. A fresh fetch confirmed both main and origin/main at `6acabfbfe1b2cf697c0c537f3b25576363161f78`.

Isolated branch: `task/corpus-integration-20261012`.
Checkout: `/Users/vighneshshukla/.codex/worktrees/corpus-integration/AI Project -> Niyantran AI`.

The original 92 pending files were copied with byte-for-byte checks: 61 documentation, 17 script, 13 Edge Function and one resolver-test file, totaling 1,061,110 bytes. All original shared files remain unchanged; shared branch stays main and its index remains empty. No stash, discard, relocation or overwrite occurred. No UI implementation or committed Download resolver/identity companion changed. No merge, push, deployment, production access, ingestion restart or migration occurred. Local SQL test containers were started for fixtures and returned to their original stopped state.

## Review findings resolved

1. **Document continuation context was lost before model generation.** Version-4 chunk embeddings and stored metadata carried section context, but renderChunk displayed sections only for page chunks. The correction renders bounded, whitespace-normalized, delimiter-escaped document section context too. An end-to-end chunker → retrieval row → model passage regression failed before and passed after. Legacy unsectioned passages remain unchanged. An older assertion that document sections cannot exist was updated to the new version-4 contract, preserving its legacy assertions. No embeddings need regeneration for this presentation correction.
2. **Final mapping validation accepted only one bill feature.** Modern worker and both preflight paths now require both Bill Passage Probability Index and Policy Intelligence Graph among the matching rows. The missing-feature regression failed before and passed after. The old directory-based 23-source runner fails closed under this rule and is explicitly retired; its historical files remain preserved.
3. **Runbook mixed outdated operational claims with later amendments.** The current runbook now states one consistent policy, distinguishes identity screens from complete quality review, documents directory-scoped locks and manual project-wide exclusivity, and makes the current no-production boundary explicit.

Independent read-only review verified both fixes and found no remaining required defect in the reviewed Edge/worker scope. Passing tests are not a certification of every corpus source or an unattended release.

## Integration order and exact paths

Apply the following commits in listed order after the owner authorizes integration. They are already a linear local stack based on 6acabfb. Do not cherry-pick the already committed resolver/companion again. Code commit 2 depends on context commit 1; preflight commit 6 depends on worker commit 5 and the baseline resolver. The documentation records dated decisions and execution, not permission to rerun them.

### 1. `78b23c1` — feat(corpus): preserve section context in existing-text embeddings

- `supabase/functions/_shared/chunking.ts`
- `supabase/functions/_shared/textContext.ts`
- `supabase/functions/_shared/textContext_test.ts`
- `supabase/functions/ingest-documents/handler.ts`
- `supabase/functions/ingest-documents/handler_test.ts`
- `docs/specs/2026-10-09-text-section-context.md`
- `docs/plans/2026-10-09-text-section-context.md`
- `docs/research/2026-10-09-text-section-context.md`

### 2. `a796383` — fix(retrieval): carry bill versions and continuation sections to the model

- `supabase/functions/_shared/retrieval.ts`
- `supabase/functions/_shared/retrieval_test.ts`
- `supabase/functions/research-chat/agent.ts`
- `supabase/functions/research-chat/agent_test.ts`
- `supabase/functions/research-chat/index.ts`
- `supabase/functions/research-chat/index_test.ts`
- `supabase/functions/research-chat/prompt.ts`
- `supabase/functions/research-chat/prompt_test.ts`
- `docs/specs/2026-10-09-corpus-version-labels.md`
- `docs/plans/2026-10-09-corpus-version-labels.md`
- `docs/research/2026-10-09-corpus-version-labels.md`

### 3. `2774511` — test(corpus): cover the committed Download identity resolver

- `src/lib/impactRecord.test.js`

### 4. `25c3510` — feat(corpus): prepare bounded mapping and context review cohorts

- `scripts/corpus-batch-review.mjs`
- `scripts/corpus-batch-review.test.mjs`

### 5. `946a969` — feat(corpus): add bounded supervised ingestion with recovery gates

- `scripts/corpus-capacity.mjs`
- `scripts/corpus-capacity.test.mjs`
- `scripts/corpus-source-repair.mjs`
- `scripts/corpus-source-repair.test.mjs`
- `scripts/corpus-job-supervisor.mjs`
- `scripts/corpus-job-supervisor.test.mjs`
- `scripts/corpus-stage-job.mjs`
- `scripts/corpus-stage-job.test.mjs`

### 6. `a9a0137` — feat(corpus): bind source and version preflight evidence

- `scripts/corpus-context-preflight.mjs`
- `scripts/corpus-context-preflight.test.mjs`
- `scripts/corpus-job-preflight.mjs`
- `scripts/corpus-job-preflight.test.mjs`
- `scripts/corpus-version-mapping.mjs`
- `scripts/corpus-version-mapping.test.mjs`
- `scripts/corpus-version-preflight.mjs`

### 7. `b78f3ff` — docs(corpus): retain pilot and small-stage execution evidence

- `docs/plans/2026-10-09-corpus-bulk-preparation.md`
- `docs/plans/2026-10-09-corpus-single-pilot.md`
- `docs/plans/2026-10-09-trackable-corpus-jobs.md`
- `docs/research/2026-10-09-corpus-bulk-readiness.md`
- `docs/research/2026-10-09-corpus-first-stage-run.md`
- `docs/research/2026-10-09-held-embedding-cleanup.md`
- `docs/research/2026-10-09-trackable-corpus-final-run.md`
- `docs/research/2026-10-09-trackable-corpus-inventory.md`
- `docs/research/2026-10-09-trackable-corpus-job-preparation.md`
- `docs/research/2026-10-09-trackable-corpus-stage-01-run.md`
- `docs/research/2026-10-09-trackable-corpus-stage-02-run.md`
- `docs/specs/2026-10-09-corpus-bulk-preparation.md`
- `docs/specs/2026-10-09-corpus-single-pilot.md`
- `docs/specs/2026-10-09-trackable-corpus-jobs.md`

### 8. `12f3618` — docs(corpus): retain context and capacity rollout evidence

- `docs/plans/2026-10-09-corpus-capacity-and-larger-batches.md`
- `docs/plans/2026-10-09-identity-hold-review.md`
- `docs/plans/2026-10-09-medium-corpus-preflight.md`
- `docs/plans/2026-10-09-medium-worker.md`
- `docs/plans/2026-10-09-next-50-preflight.md`
- `docs/research/2026-10-09-corpus-500-worker-pilot.md`
- `docs/research/2026-10-09-corpus-recovered-body-run.md`
- `docs/research/2026-10-09-identity-hold-review.md`
- `docs/research/2026-10-09-medium-corpus-readiness.md`
- `docs/research/2026-10-09-medium-progressive-run.md`
- `docs/research/2026-10-09-medium-worker-pilot.md`
- `docs/research/2026-10-09-next-50-preflight.md`
- `docs/research/2026-10-09-text-context-follow-up-run.md`
- `docs/research/2026-10-09-text-context-pilot-run.md`
- `docs/specs/2026-10-09-corpus-500-stage.md`
- `docs/specs/2026-10-09-medium-corpus-preflight.md`
- `docs/specs/2026-10-09-medium-worker.md`

### 9. `1a74b14` — docs(corpus): retain version mapping and resume evidence

- `docs/plans/2026-10-09-corpus-version-mapping.md`
- `docs/plans/2026-10-10-corpus-ingestion-resume.md`
- `docs/research/2026-10-09-corpus-version-mapping.md`
- `docs/research/2026-10-10-corpus-version-ingestion-run.md`
- `docs/specs/2026-10-09-corpus-version-mapping.md`

### 10. `db0968d` — docs(corpus): record pending-source continuation and holds

- `docs/plans/2026-10-10-pending-corpus-continuation.md`
- `docs/plans/2026-10-10-three-source-ingestion.md`
- `docs/research/2026-10-10-corpus-mapped-pending-monitor.md`
- `docs/research/2026-10-10-pending-corpus-continuation-run.md`
- `docs/research/2026-10-10-three-source-ingestion-run.md`
- `docs/specs/2026-10-10-pending-corpus-continuation.md`
- `docs/specs/2026-10-10-three-source-ingestion.md`

### 11. `3407aff` — docs(corpus): record Citation Pack mapping and larger batch outcomes

- `docs/plans/2026-10-11-corpus-batch-blockers.md`
- `docs/research/2026-10-11-citation-pack-passing-subset-run.md`
- `docs/research/2026-10-11-citation-pack-preflight.md`
- `docs/research/2026-10-11-corpus-270-reviewed-run.md`
- `docs/research/2026-10-11-corpus-batch-readiness.md`
- `docs/research/2026-10-11-corpus-next180-run.md`
- `docs/research/2026-10-11-corpus-wide-batch.md`
- `docs/research/2026-10-11-download-mapping-production-run.md`
- `docs/research/2026-10-11-shared-citation-mapping-fix.md`
- `docs/specs/2026-10-11-corpus-batch-blockers.md`

The final documentation commit contains this review, the integration plan, the current operations runbook and the R7 tracker update. Its hash is reported in the handoff rather than embedded recursively here.

## Executed verification

| Command/check | Final result |
| --- | --- |
| `npm ci` | Passed, lockfile unchanged; dependency advisories below |
| `npm test` | 185 files / 2,506 tests passed |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 881 passed |
| `node --experimental-strip-types --test scripts/corpus-*.test.mjs` | 113 passed |
| `npm run lint` | Passed, zero warnings/errors |
| `npm run build` | Passed; existing >500 kB chunk-size warning |
| `npm run test:sql` | All 22 fixtures and 22 migration-removal non-vacuity checks passed |
| New context / missing-feature regressions | Executed failing-before and passing-after |
| `git diff --check` and staged checks | Passed |
| Snapshot hash audit | All 92 shared files unchanged |
| Relative Markdown link targets | No missing targets in the corpus inventory |
| Secret-shaped scan | No credentials found; broad pattern only matched existing desk-plan filenames |

The first SQL attempt failed because both named disposable containers were stopped; the successful rerun used only those local containers. The first full Edge rerun exposed the obsolete document-section assertion described above; the final suite passes. No standalone type-check is claimed. Router import was not required because api/server files are untouched.

Logs, original snapshot hashes and commit/path inventory are preserved outside Git at `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-integration-20261012/`.

`npm audit` returned seven existing locked-dependency advisories: two moderate, three high and two critical. Packages: @vitest/mocker, esbuild, source-map-js, tinypool, vite, vitest and xlsx. No dependency or lockfile changes were made. Installation also warned that ESLint 9.39.5 is unsupported. These are repository dependency follow-ups, not introduced by this corpus stack.

## Release-ready versus unfinished

**Ready for owner integration review:** explicit section-context ingestion, context-aware hashes/spans, version/section retrieval presentation, resolver regressions, bounded supervised worker/reconciliation, provenance/mapping/preflight helpers and their tests, and dated evidence/current runbook. Scripts are suitable for supervised operation under the documented gates; the stack does not promise unattended or cross-job writer exclusion.

**Completed ingestion evidence:** the latest recorded release added 413 documents / 7,493 chunks and had 3,033 scoped citation probes. Its final recorded baseline is 3,434 documents / 3,431 indexed / 100,031 chunks / 2,143 covered bill keys. No fresh production reconciliation was performed during this integration task. All completed manifests remain complete and must never restart.

**Still pending and not released:**

- The 87 actual holds from the wider cohort; the 248 pending records reported in the earlier 500-source working pool; other unreviewed candidates. These are different dated cohorts and are not a new deduplicated ready-queue total.
- Government/University existing-source section corrections, recovery stubs/partial writes and page-OCR recovery, which require separately scoped review and authorization.
- Nonbill keys and attachment/scoping, Gazette/manual-year/version/shared-key conflicts, substantive OCR/table/section failures, and unreviewed source repairs.
- Runtime experiments such as incomplete Pension transcription, exploratory PDF reordering and mapping-only proposals. They remain in their original artifact/temporary locations, outside the committed application. An identity pass or locally generated chunks do not release them.
- Fresh future source/Download validation, capacity/price/budget/exclusive-writer preflight, complete source quality review and exact new manifests. This review authorizes none of those production actions.

No unfinished source repair or executable release manifest was promoted into Git. Historical reports containing incomplete findings are committed as evidence, not as accepted source data. R7 remains open.

## Production and migration dependencies

No new SQL migration is included. Context ingestion depends on the existing `20261001120000_page_contract.sql` support for embed_hash and section metadata; local fixtures verify that contract. Research-chat role hydration uses the caller's existing RLS, indexed filter, timeout and cancellation; metadata failure intentionally fails retrieval. No service-role permission expansion was introduced.

The latest section-rendering correction is local only. Activating it requires a separately authorized research-chat deployment and subsequent live RAG/citation checks. Historical reports describe prior ingest-documents/research-chat deployments, but this task did not compare current production function bytes. Do that comparison before any future deployment; do not assume Git integration updates Edge Functions automatically. No source re-embedding is needed merely to show already stored section metadata.

The resolver and companion at 6acabfb are unchanged. Further mapping changes, existing-source repairs, live evaluation/paid model calls, migration or compute changes need their own scope. Worker locks are per directory; a supervisor must establish project-wide writer exclusivity and independently audit maintenance/final results. Unknown usage retains a cost reservation until reconciled.

## Working tree handoff

The isolated checkout is intended to be clean after the final documentation commit. All 92 original pending files remain uncommitted in the shared main checkout exactly as received; they are preserved duplicates, not additional changes to merge. Do not discard them as part of this handoff. Owner-authorized later integration must coordinate with the UI chat and deliberately reconcile these shared copies. No branch cleanup or main integration was performed.
