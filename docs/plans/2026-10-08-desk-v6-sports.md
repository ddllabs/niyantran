# Sports v6 slice plan

> **Status: Living.** 2026-10-08. [Spec](../specs/2026-10-08-desk-v6-sports.md); F88 is open-work tracker.

1. Read existing source adapters and exact reference groups. Freeze version1 contract in spec.
2. Scoped task agent owns only new sports files: src/lib/sportsLandingSummary.js/tests,server/sportsLandingSummary.mjs,src/lib/sportsLandingApi.test.js; src/desks/landing/sportsPresentation.js/tests,src/desks/useSportsLanding.js/tests,src/desks/SportsLandingView.jsx/tests and scoped sportsLanding.css. No shared file edits/commits/delegation. Onboarding required.
3. Supervisor owns API/local registrations,DeskLandingView/TerminalShell dispatch,documentation and preview integration. Sports and Entertainment file scopes disjoint with fixed shared-frame and summary interfaces; may run concurrently after investigation.
4. Agent proves source rejection/date/zero/route guards fail for restored defects; focused checks. Supervisor reproduces registration red before wiring.
5. Supervisor tests actual local sources and browser cases, fixes only scoped defects, requests independent read-only review. Full suites/build/lint/router/assets/diff gates.
6. Record evidence and limits in spec/plan/F88,make coherent verified local commits. No publication.

## Local checkpoint

Implementation,source runtime audits,focused/full checks and independent review complete; exact evidence/limits in spec. Owner visual review,signed-in terminal acceptance and native checks remain pending. No publication; F90 and State/Local remain separate.
