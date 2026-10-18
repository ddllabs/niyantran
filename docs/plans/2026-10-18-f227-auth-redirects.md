# F227 Auth cleanup execution plan

> **Status: Living.** Approved2026-10-18. Sequential on task/f227-auth-redirects.

Spec: [F227](../specs/2026-10-18-f227-auth-redirects.md).
Tracker: open-work.md, the sole unfinished-work list.

1. Read current 10-entry configuration (expected final count: 9) and inspect Google/recovery/signup
   redirect construction. Preserve pre-change public inventory.
2. Write only NTER Auth redirect destinations: add exact Vercel root/recovery
   first, then remove obsolete bare root, global wildcard and malformed entry.
   Do not touch Site URL, provider, CORS or account settings.
3. Reload settings; assert final9 destinations and unchanged Site URL. Use safe
   credential-free invalid-link redirect probes only after inspecting upstream
   verification behavior; no real token, email send or account mutation.
4. Verify owner-operated Google and recovery/reset/sign-in. Update existing
   tracker, coordination and a focused evidence record. No code build/tests
   required for configuration-only changes; git diff --check for documentation.

Write scope: two F227 spec/plan files, docs/research/2026-10-18-f227-auth-evidence.md,
docs/plans/open-work.md and docs/agents/coordination.md; live Auth list only.
Local commits allowed after verification. No source publication/deployment,
SQL writes, provider calls, forced refresh, timers, serve flags or corpus work.
Scheduled M1/M2 closure monitor stays active, Razorpay held until closure.


Completed2026-10-18: owner applied configuration after dashboard-control issues;
11/11 live redirect probes pass. Owner confirms saved nine-entry reload and
Google/recovery/reset/sign-in acceptance. See linked F227 execution evidence.
No source deployment required. T15 remains independent and open.
