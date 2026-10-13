# Implementation plan: National record panels (F124)

> **Status: Living.** It implements the [National record panels spec](../specs/2026-10-13-national-record-panels.md).
> Branch `task/national-record-panels` from `main` at `879b917`. It is tracked as F124 in
> [open-work](open-work.md). It reuses the F121 kit and process
> ([Global plan](2026-10-13-global-record-panels.md)).

## Approach and sequencing

**N1–N2 are sequential, done by the supervisor.** They extend the kit for National (the packs in
`ctx` and the dispatch) and build the Bills adapter, which fixes how a bill-style adapter uses the
analysis pack and the ontology. The three other bill-style modules copy that pattern, so it has to
exist first.

**N3–N9 run in parallel, each with a Sonnet task agent in a supervisor-created worktree.** Each
write scope is one adapter and its test. At most four agents run at once; the supervisor reviews
each diff.

**N10 is the supervisor's:** register the modules, cover dispatch with tests, run browser checks,
get an independent review on Fable, merge locally, and push on the owner's go-ahead.

Supervisor-owned files:

- the F121 kit files: `registry.js`, `RecordPanel.jsx`, `modelContract.js`, `recordPanel.css`, `visuals/*`;
- `RailContent.jsx`, `NationalRecord.jsx`;
- any new pack-loading hook.

## Tasks

| Task | Owner | Content | Depends on |
|---|---|---|---|
| N1 | Supervisor | Pack-loading host: load the module's analysis map and the ontology (as `BillRecordPane` does) and pass `ctx.packs`; the AI-brief behaviour per the owner's answer; registry and dispatch gate for National, with tests | owner answers |
| N2 | Supervisor | Bills adapter (`adapters/nationalBills.js`): tiles, stage-history timeline, impact lanes from `buildRecordModel`, honest labels for probability, precedent and days in stage | N1 |
| N3 | Sonnet | Parliamentary Questions | N2 |
| N4 | Sonnet | Regulatory Body Watch | N2 |
| N5 | Sonnet | Policy Pipeline Tracker | N2 |
| N6 | Sonnet | Cabinet Decisions | N1 |
| N7 | Sonnet | MP Profiles & Performance | N1 |
| N8 | Sonnet | Candidate Affidavit Database (licence caveat) | N1 |
| N9 | Sonnet | National Morning Brief | N1 |
| N10 | Supervisor | Register all eight; dispatch tests (the other nine still reach `NationalRecord`); browser at 375, 939 and 1440px, light and dark; Fable review; merge | N2–N9 |

Each adapter task's acceptance:

- the contract passes for every real row;
- tiles, visual and lanes follow the spec table;
- only held fields appear, with labels that do not overstate;
- self-exclusion holds in counts and related links;
- each guard is shown to fail when its defect is restored.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Losing AI briefs readers rely on | Medium | Owner decides (spec question 1); the saved-brief card stays either way |
| "Passage probability" read as a forecast | High | Label each case: outcome for resolved bills, historical base rate for pending, none otherwise |
| Packs load late, so the panel jumps | Low | Render without the pack-derived parts, then fill in; tested |
| Breaking the nine modules that stay on `NationalRecord` | Medium | Registry gate and dispatch tests for every one of them |
| Reference review notes leaking into reader text | Medium | The contract's placeholder check, plus a test that bans the review-note phrases |

## Verification commands

```bash
npm run lint
npm test
npx vitest run src/shell/record
npm run build
```
