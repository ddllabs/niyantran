# F224 implementation and release plan

> **Status: Living.** Approved sequential execution on task/f224-growth-budget.

[Spec](../specs/2026-10-17-f224-growth-budget.md). Only open-work tracks status.
Preserve all existing local closure observation/diagnosis commits.

1. Write `src/lib/growthRequestBudget.test.js`, mocking only network and RPC;
   prove old runtime fails retry, diagnostics and queue/cancellation guards.
2. Add private source-attempt helper and opt-in gate lifecycle bridge; implement
   sequential Growth series with 6-second attempt / 18-second active total,
   bounded retry, safe diagnostics and all-or-failure projection. No other loader
   behavior, scheduler or worker budget changes. Run focused suites after each slice.
3. Review exact runtime/test diff for budget races, body cancellation, queued
   clock exclusion, no leaked hooks/signals and no arbitrary log fields. Execute:
   `npm test -- src/lib/growthRequestBudget.test.js src/lib/feedStore.test.js src/lib/apiCachePolicy.test.js`;
   `npm test`; `deno test -A --config supabase/functions/deno.json supabase/functions`;
   `npm run lint`; `npm run build`; `npm run check:bundle`; router import;
   `git diff --check`. Node/npm use external no-dotenv guard. No standalone
   type check; no local SQL needed because no schema/SQL change.
4. Record evidence and commit verified runtime. Push task branch, require original
   CI app+SQL success, then fast-forward/push main. Inspect exact approved Vercel
   project/team READY and source SHA; no Edge Function deployment or forced refresh.
5. Public read-only Growth module parity and bounded deployment logs; compare
   store fingerprint/Edge Function inventory. Record released runtime hash in
   Done but keep natural writer acceptance explicitly pending under T15/F224
   rollout observation until next ordinary refresh. Publish final release docs,
   verify original CI/READY again. Keep branches if cleanup lacks authorization.

Rollback requires owner approval to the pre-release READY deployment at 731428f;
no database rollback needed. Existing F221/F219 stay separate, corpus excluded,
payment held, hourly closure monitoring active.
