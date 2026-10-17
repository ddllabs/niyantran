# F223 implementation and release plan

> **Status: Historical (2026-10-17).** Approved sequential execution completed
> on `task/f223-state-summaries`; runtime `0c1319c` released, no delegation.
> Final publication verification is recorded in the release evidence/report.

Spec: [stored MLA summaries](../specs/2026-10-17-f223-state-summaries.md).
Task status lives only in [open-work](open-work.md), F223. Preserve the existing
local closure documentation commits, with no changes to their dated evidence.

## Ordered tasks and fixed interfaces

1. **Regression evidence.** Write scope: this plan/spec, sole tracker and
   `src/lib/stateLandingStored.test.js`. Prove both routes' current live-first
   choice fails despite healthy store, metadata loss and missing safe diagnostics.
   Use existing stored-first/live fallback, no fake database permissions or live
   writes. Run focused new tests and inspect expected failures before runtime edits.
2. **Scoped implementation.** Depends on 1. Write scope: four runtime files in
   the spec. One shared exact-feature predicate controls the two routers;
   State adapter logs only validated identifiers/fixed codes and preserves
   truthful failures. State projection carries stored fetch/stale metadata
   without changing counts/asOf. Verify fresh and stale store, missing store,
   live fallback, failed/empty archive and unrelated route behavior.
3. **Verification and review.** Depends on 2. Run, with the external no-dotenv
   guard for Node/npm:

   ```sh
   npm test -- src/lib/stateLandingStored.test.js src/lib/stateLandingApi.test.js src/lib/stateLandingSummary.test.js src/lib/stateLandingParity.test.js
   npm test
   deno test -A --config supabase/functions/deno.json supabase/functions
   npm run lint
   npm run build
   npm run check:bundle
   node -e "import('./api/router.js').then(() => console.log('router import ok'))"
   git diff --check
   ```

   Inspect the complete diff against scope, input/logging safety and compatibility;
   record exact failures, warnings and unavailable checks. Write evidence to
   `docs/research/2026-10-17-f223-state-summaries-evidence.md`; update tracker.
4. **Approved release.** Depends on 3. Commit verified changes, push task branch,
   wait for original CI success, then fast-forward main and push. Confirm the
   exact team/project's READY deployment and main app/SQL CI. No Edge Function
   deployment, migration, manual refresh or timer adjustment. Use authenticated
   Vercel CLI API fallback for this scope if connector remains 403.
5. **Production evidence and cleanup.** Depends on 4. Read-only GET the two
   summaries/modules: stored provenance, matching fetchedAt/notes/sample counts,
   no rows in summary, HTTP 200. Check a bounded deployment log window and feed
   health. Update evidence, tracker Done with runtime hash, coordination entry
   and existing cleanup record. Push the final documentation checkpoint, confirm
   its deployment/CI, then remove merged task/observation branches. Keep hourly
   closure follow-up running; never infer daily stability from repeated reads.

## Risks and limits

The Directory summary must stay a 496-row sample, not silently claim 4,104
complete records. Never substitute fetchedAt for source publication/asOf. Logs
must not carry raw errors. Both originally logged feature names remain unknown;
the reproduced timeout mechanism is the basis for this approved narrow fix.
Existing F221 isolation work stays separate. Rollback uses pre-release Vercel
deployment 5302dc3 with owner approval, no database cleanup.
