# Live activity disclosure plan (F70)

> **Status: Historical (2026-10-04).**

Spec: [Live activity disclosure](../specs/2026-10-04-live-activity-disclosure.md).
Sequential task on task/f70-live-activity-disclosure. Fixed interface: existing
active prop signals the turn lifecycle; no data contract changes.

1. Update existing active-render guards and observe failure.
2. Reset disclosure only on active phase changes, preserving manual toggles.
3. Run focused tests, full npm suite, lint, build and runtime lifecycle check.
4. Record evidence, commit verified frontend change locally. No publication.

## Evidence

The updated initial-active guards failed first (2 failed / 44 passed), then
passed (46/46). npm test: 129 files / 2,089 passed. npm run lint passed;
npm run build passed with existing mixed-import and large-chunk warnings.
git diff --check passed. An isolated real ActivityTicker in headless Chrome
verified initial expansion, manual collapse surviving another event, terminal
collapse, completed-trace reopening and a subsequent start/finish cycle.
The first fixture attempt timed out because its file URL asset paths were
absolute; corrected relative paths passed. No production query was sent.
No backend, token usage, styles or provider changes. Not published.
