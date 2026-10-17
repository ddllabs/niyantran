# F220: retain the answer-reserve transition

> **Status: Normative.** Owner authorized fix, verification and push/deploy as
> needed on 2026-10-17. Base `f3d5b59`; existing local closure observations preserved.

## Current state and problem

Documentation CI 39028606428 failed the unchanged F199 answer-reserve test:
the fourth request used high effort instead of low. Later CI passed without
source changes. The watchdog receives fractional remaining milliseconds and
the next loop independently recomputes lateness. Suspected timer rounding can
therefore undo a reserve cut. Establish this with controlled time before fixing.

## Expected behavior

Once the reserve watchdog cuts an idle call, every subsequent attempt in that
turn uses the configured late reasoning. The transition survives an in-process
checkpoint/provider retry and never restores research. Calls already producing
text/tool calls are not cut. Caller cancellation remains terminal. Existing
turn/model/search/continuation budgets, evidence, accounting and authentication
are preserved. Null late reasoning removes the setting; an absent override keeps
the caller's configuration. No longer deadlines or softened assertions.

## Acceptance and boundaries

Use Deno's standard fake clock to reproduce a fractional timer firing before
the exact reserve boundary. Original runtime must fail the controlled research
and answer cases; corrected runtime must pass with actual low-effort requests.
Verify checkpoint retry, null override, active streaming and caller abort.
Convert affected wall-clock deadline tests to controlled time rather than
increasing sleeps. Run focused tests, full Vitest/Deno, lint/build/bundle/router
import and CI. No local SQL change/container needed; CI retains its SQL checks.

Write scopes: `supabase/functions/research-chat/agent.ts`, `agent_test.ts`,
this spec, its plan and execution record; `docs/plans/open-work.md`,
`docs/research/2026-10-17-m1-m2-cleanup-evidence.md`, and
`docs/research/2026-10-17-orientation-closure-comparison.md` for status/evidence.
Deployment scope is only research-chat on NTER `vfgcppstyzjarlzyqdac`, preserving
its existing entrypoint, authentication and unrelated deployed source. Compare
deployed bundle before release. No paid model calls, corpus/ingestion changes,
database writes/migrations, refresh changes or payment integration.

## Risk and rollback

Checkpoint is in-process, not a database format. Keep the latch turn-local;
never leak it to another turn or alter configured late reasoning. Known-good
research deployment is v65. Preserve its complete bundle/hash before deployment;
rollback requires owner authorization under the existing runbook. Closure
still requires genuine first-attempt CI runs and real refresh opportunities.
