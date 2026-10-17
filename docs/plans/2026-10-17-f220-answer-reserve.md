# F220 implementation plan

> **Status: Living.** 2026-10-17. Sequential; no delegation. Branch
> `task/f220-answer-reserve`, base `f3d5b59`. Scope and release authorization in
> [spec](../specs/2026-10-17-f220-answer-reserve.md). Sole tracker: F220/open-work.

1. Preserve the two local closure-observation edits. Inspect the reserve loop,
   checkpoint, existing timing tests and failed CI. Add controlled fake-clock
   cases in `agent_test.ts`, prove red on unchanged `agent.ts`. No runtime edits
   until the failure is reproduced. Standard-library fake clock is test-only.
2. If confirmed, latch reserve entry in the existing in-process checkpoint in
   `agent.ts`; preserve late override, cancellation and streaming contracts.
   Verify research/answer cutoff, provider retry, null override, streaming and
   caller abort without wall-clock assertions. Restore old runtime to prove
   guards detect the defect, then restore fix.
3. Run focused `deno test -A --config supabase/functions/deno.json --filter F199
   supabase/functions/research-chat/agent_test.ts`, full Deno suite, `npm test`,
   `npm run lint`, `npm run build`, `npm run check:bundle`, router import and
   `git diff --check`. Node commands use the existing no-dotenv preload. Record
   exact results/warnings. Review all code and scope before commit.
4. Push verified task branch and require first-attempt green CI including SQL.
   Merge/push main with existing owner authorization. Retrieve research-chat's
   deployed bundle and compare exact changes. Deploy only that function with
   preserved verify_jwt/handler authentication, then confirm version/hash and
   unauthenticated rejection/CORS. No live model charges or test conversations.
5. Record evidence in `docs/research/2026-10-17-f220-answer-reserve-evidence.md`,
   update comparison and sole tracker with landed hash. Keep the closure
   follow-up active and record actual CI sequence/refresh observations. Never
   substitute reruns/empty commits for three genuine green runs or forced calls
   for real source intervals. Corpus and payment remain excluded.
