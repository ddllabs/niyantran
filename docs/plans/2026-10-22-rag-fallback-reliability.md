# F242 implementation plan

> **Status: Historical (2026-10-22).** Branch task/rag-fallback-reliability.

1. Confirm source/log causes and paid runtime limits; inspect deployed claim contract.
2. In disjoint scopes, first reproduce defects then implement:
   - UI agent: src/lib/researchChat.js, src/ai/ActivityTicker*, src/ai/MessageRow*, relevant frontend tests/styles. Preserve initial requested model; show accessible fallback explanation. No backend edits.
   - Telemetry agent: supabase/functions/research-chat/telemetry.ts and telemetry_test.ts only. Align bounded recording with actual database budgets; preserve charge logic.
   - Deadline agent: persistence.ts, persistence tests, one new chat claim migration and its disposable SQL fixture only. 300-second lease, old claims respected.
   - Supervisor: handler.ts and focused handler tests for original requested/actual served metadata; integration and documentation.
3. Independently inspect diffs; run npm run lint, npm test, npm run build, full deno test -A --config supabase/functions/deno.json supabase/functions, npm run test:sql and applicable bundle checks. Prove SQL fixture fails without its migration.
4. Fresh reviewer audits all changes, cancellation, persisted model truth, timeout budgets and unchanged billing. Resolve findings.
5. Commit/push and PR through both mandatory CI jobs; apply scoped migration and deploy reviewed Edge bundle, merge web changes and verify deployed commit/domain through CI. No bypass.
6. Read-only runtime verification and owner-visible acceptance where actual provider behavior cannot be simulated safely. Record exact evidence and limitations.

## Interfaces
The model frame remains {requested, served, reason}; requested means original user choice throughout the turn. Served means attempt actually generating the answer, not the next configured fallback when no response arrived. Database claim response shape is unchanged. Telemetry row and financial settlement contracts are unchanged. SSE comment keepalives refresh browser network inactivity without UI activity or extending the server deadline. Supervisor also owns shared chatStream heartbeat primitive/tests; deadline agent implemented that delegated subset.

## Rollback
Revert web/Edge code through CI. Keep existing turn leases valid until their stored expiry; a reverse claim-function migration can restore 120 seconds for future turns if required, without editing messages or balances.

## Investigation and initial evidence

NTER reports the Pro plan; [Supabase's runtime limits](https://supabase.com/docs/guides/functions/limits) permit 400 seconds wall time. New 300-second claims leave 100 seconds headroom, including post-answer telemetry and the existing 30-second late-cost job. The deployed claim function is service-only and security-invoker; parent serialization and monotonic chronology are preserved.

Causal regressions failed before fixes: four UI cases, two heartbeat transport cases, three telemetry cases, three deadline cases, two backend model-identity cases, the heartbeat interval and saved replay identity. The SQL fixture also fails without the migration and against a chronology mutant. Existing no-swap tests now distinguish same-model identity frames from actual switches.

## Integration verification

- `npm run lint`: pass. `npm test`: 421 files / 6,555 tests pass.
- `npm run build` and `npm run check:bundle`: pass; entry 121,085 bytes gzip, below budget. Router import passes; public data unchanged.
- Full Deno suite: 1,187 tests pass. Independent review identified missing replay metadata; authoritative terminal frames now preserve selected/served identities, including null. The reviewer reran 11 focused regressions and cleared the final diff.
- Deployed research-chat v70 compared byte-for-byte with checkout: exactly four runtime files differ (handler, shared chatStream, persistence, telemetry). The other 33 files, including production access lookup and financial adapters, remain identical.
- `npm audit --omit=dev`: zero vulnerabilities.
- Supabase advisory baseline: 20 existing authenticated SECURITY DEFINER warnings and three multiple-policy warnings; this migration adds no roles, tables or permissions. Broad security cleanup is outside scope.
- In-app production session initially signed out; owner asked to sign in for saved-chat browser acceptance while release continues.

## Release verification

- Full `npm run test:sql`: every disposable fixture and vacuity check passed.
- PR #10 at `9a81cd9b` passed both required jobs on push and pull_request; merged as `c0ad4355` without bypass.
- Applied only the chat claim migration. Readback confirms 300 seconds, monotonic chronology, SECURITY INVOKER and postgres/service_role-only execution.
- Deployed research-chat v71; all 37 returned files match the reviewed bundle byte-for-byte. Exactly four runtime files changed from v70. Anonymous POST still returns HTTP 401 (`missing bearer token`).
- Existing billing code, financial adapters, balances, settings and keys were not changed.
- Main CI run 39825387495 passed both jobs. Production deployment `dpl_EyZpb8AT8TqXJjzBuQt2Y5DV9p5E` is READY and assigned to nter.pro/www.nter.pro at merge `c0ad4355`.
- Signed-in production browser: the original six-message conversation shows both explicit Gemini → Claude Haiku notices with the activity panel collapsed.
- A short real DeepSeek Flash request completed in 24 seconds; saved requested/served IDs both equal `deepseek/deepseek-v4-flash`. Its new lease is 300 seconds. Three model-call records and two trace records were persisted. This smoke test does not claim a real five-minute provider run; longer execution, heartbeat, interruption and fallback paths were exercised with deterministic regressions.
- Existing provider 429/500 failures remain external availability conditions. The fix makes fallback explicit and avoids the application's premature cutoff; it cannot guarantee provider uptime.
- GitHub emitted an informational Ubuntu runner migration annotation. No failed checks or dependency vulnerabilities remain in this release.
