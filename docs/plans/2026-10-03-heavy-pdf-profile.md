# F58 heavy PDF profiling plan

> **Status: Living.** October 3, 2026.

Spec: ../specs/2026-10-03-heavy-pdf-profile.md. Task tracker: open-work.md.

1. Read-only inventory: locate the two authorized corpus folders, list PDFs by bytes/pages and inspect viewer rendering architecture. A delegated agent may read these folders and source only; no writes or delegation.
2. Supervisor writes a loopback offline profiling harness in scripts/viewer-regression/ (at most five files in each slice) using selected exact local file paths supplied through an environment variable. No corpus content enters git. Metrics interface: document metadata, rAF gaps, long-task counts/durations, elapsed time and maximum live canvases.
3. Run equivalent browser scrolling paths three times per representative document at a fixed viewport and zoom. Check cold loading separately and citation return after scrolling. Record measurements and limits in ../research/2026-10-03-heavy-pdf-profile.md.
4. If evidence identifies a bottleneck, amend spec with the precise hypothesis, budget and source/test write scopes before a sequential fix. Re-measure under the same conditions; discard results within noise. Independent review, regression guard vacuity, focused tests, lint and production build gate retained changes.
5. Integrate documentation reconciliation first, then verified profiling locally. Only supervisor edits specs/plans/open-work and commits/merges. No push or deployment is authorized by this plan.

Read-only inventory and F56 independent documentation review may run concurrently; their write scopes are empty. Harness implementation and integration remain sequential.
