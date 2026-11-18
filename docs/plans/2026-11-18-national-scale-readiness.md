# National ingestion: readiness for scale

> **Status: Living (2026-11-18).** Orders the work that takes National ingestion from "two collections loaded" to
> "the remaining packs load routinely". It follows [National ingestion: next steps](2026-11-11-national-ingestion-next.md)
> and the [close-out plan](2026-11-15-ingestion-closeout.md), under the
> [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §5.4, §7 and §10 and the scope in
> [ADR 0014](../decisions/0014-national-v1.1-ingestion-scope.md). The only list of open work is
> [open-work.md](open-work.md). Nothing here changes production without the developer's specific yes for that step.

## Current state (read 2026-11-18, `main` at `71aca0f9`, NTER read-only at 09:14 UTC)

- **Live:** partitions for Bills, NCLT and Regulatory; hybrid search for NCLT; batch registration, the runner,
  screening, acceptance, and batch stop, resume and close. Two collections went through the pipeline: Bills (5,680)
  and Regulatory v1.1 (2,605).
- **Corpus:** 25,894 documents; about 833,000 chunks by table statistics (Bills 355,952, NCLT 225,294, Regulatory
  183,805, default partition 68,110); database 18 GB, of which the Phase B backup table is 5.3 GB; 8 GB of memory.
- **Queue:** 22,437 jobs, all succeeded; limits `claim_batch` 2 and `max_running` 1.

## Problem

National ingestion cannot continue at scale today, for five reasons:

1. **The search gate is unresolved.** Spec §7 allows no desk's result to fall after a load. Regulatory fell from 50
   to 40 of 55 ([record](../operations/2026-11-16-regulatory-load.md)); nobody has judged whether the newer documents
   answer the ten lost questions equally well, and the script's verdict line compares the wrong mode.
2. **Capacity arrives inside v1.4.** Regulatory v1.4 is estimated at 570,000 chunks and Parliamentary Questions v1.4
   at roughly 300,000 (by character count, not measured). That is about 1.7 million chunks, about 30 GB on a 40 GB
   disk, and vector indexes of about 6.6 GB against 8 GB of memory. F279 was planned for 1 million documents; it is
   needed at about 100,000.
3. **Most remaining entries have no path.** No screen configuration for the other v1.1 collections; no partition for
   Parliamentary Questions or any new desk (F285's function is built, not applied); no way to replace existing text
   (v1.2's 1,819, v1.4's 7,801 RBI fixes, v1.6's 7,068); RBI's official files cannot be page-checked (F338).
4. **The inventory is incomplete.** v1.3, v1.5 and v1.6 are not read by collection, and five v1.1 collections are
   not counted.
5. **The runner depends on a laptop staying awake.** Acceptance ended without a report three times in the last load.

## Outcome

National ingestion is ready for scale when all of these hold:

- the Regulatory v1.1 load is accepted or corrected, on recorded evidence;
- F279 is decided from measurements and the chosen option is in place;
- every servable National entry in v1.1 to v1.6 is counted, and each has a route: a screen, a partition and a policy,
  or a recorded reason it waits;
- a load survives the operator's machine sleeping, and a failed acceptance keeps its error text;
- one v1.4 collection is loaded with no hand steps and passes the §7 gate.

## Roles

Per [coordination](../agents/coordination.md), "Model assignment":

| Role | Does |
|---|---|
| Documentation agent | pack counts, tracker and record edits; counts only, never traces code |
| Engineering agent | ordinary builds, test first, in a worktree the supervisor creates; never commits |
| Senior builder | migrations, admission, data movement, the replacement path; also independent code review |
| Supervisor | specs, dispatch, reproduces red and green, commits; every NTER action, on the developer's yes |
| Phase-gate review | whole-system review at each gate below |

A reviewer gets the code, the data and the rules, never the writer's conclusions.

## Phase 0: evidence (read-only; tasks run in parallel)

| Task | Who | Write scope | Done when |
|---|---|---|---|
| E1. Search-check evidence: for the ten lost questions, the reference document and the documents now ranked above it, judged blind for whether each answers the question | supervisor extracts (NTER read-only); senior reviewer judges without knowing which document is the reference | none (results outside the repository) | a count of the ten where a newer document answers at least as well; the index miss (`q-0133`) listed apart |
| E2. `eval-retrieval.mjs --compare` judges the mode that ran | engineering agent | `scripts/eval-retrieval.mjs` and its test | a test fails on today's code for a feature-mode loss, then passes; `npm test`, lint |
| E3. Inventory: v1.1's uncounted collections, and v1.3, v1.5 and v1.6 by entry | documentation agent, with `pack.ts select` | none (receipts outside the repository) | per entry: records, servable, licence class, characters, desk name, replacements |
| E4. Capacity figures for F279 | supervisor (NTER read-only), then engineering agent on the local load copy | none | per partition: bytes per chunk for table, vector index and keyword index; buffer hit rates; projected size and memory at 1.7 and 3 million chunks for each §5.4 option that needs no new vendor |

**Gate 0 (developer):** accept the Regulatory load or name the correction; choose the F279 option; say whether the
5.3 GB backup table may be dropped (a deletion, so its own specific yes).

## Phase 1: make every entry loadable (builds; worktrees with disjoint scopes)

| Task | Who | Depends on | Write scope |
|---|---|---|---|
| B1. Runner keeps acceptance error text, and resumes acceptance alone after an interrupted run | engineering agent | none | `scripts/bulk-runner/run.ts`, `acceptance.ts`, `cli.ts` and tests |
| B2. Screen configurations for the other v1.1 collections, on the search-only screen | engineering agent | E3 | `scripts/bulk-runner/screens/*.json`, `screens/index.ts` and tests |
| B3. Spec, then build: replacing a document's text through the runner, with the old text recoverable | senior builder | Gate 0 | new spec; `supabase/migrations/` (one file), `scripts/bulk-runner/prepare.ts`, a fixture |
| B4. Screen nits F333, F334, F336, F337 | engineering agent | B2 landed (same files) | `scripts/bulk-runner/screens/bills.ts`, `prepare.ts` |
| B5. Bills shared keys, F314 remainder and F325 | senior builder | none | per the [shared-keys spec](../specs/2026-11-10-shared-bill-keys.md) |
| B6. Parliamentary Questions screen spec | senior builder as planner | owner's Rajya Sabha key | `docs/specs/` only |
| B7. The chosen F279 option | senior builder | Gate 0 | set by its decision record |

B1, B2 and B5 may run together. B3 and B4 both touch `prepare.ts`, so B4 follows B3. Each build gets an independent
review before the supervisor commits.

Production steps in this phase, each with a rolled-back dry run and the developer's yes: apply
`20261114090000_create_document_chunks_partition`; create the Parliamentary Questions partition and move its 68,000
chunks out of the default partition (ingestion for that desk stopped, vector index rebuilt, no re-embedding).

**Gate 1 (phase-gate review, then developer):** every entry in the E3 inventory has a route or a recorded wait.

## Phase 2: loads, one collection at a time

Order, smallest risk first; each is policy, rehearsal on the local copy, a 100-document batch, the load, acceptance,
the §7 search gate, and a record:

1. the other v1.1 collections that need no owner answer;
2. Regulatory v1.4 (about 38,000 new records), after F338 is decided for RBI;
3. v1.2 and v1.4 replacements, through B3;
4. Parliamentary Questions v1.4 (49,330), after listing rows, the key and the partition;
5. MP profiles (3,157), after the personal-data note; then the 122,776 handover records as their own collection;
6. v1.6's servable entries.

**Gate 2 (phase-gate review):** after the first v1.4 collection, whether it loaded with no hand steps and whether
size and memory match E4's projection. Only then do the remaining loads run back to back.

## Waits on the owner

One message, sent by the developer: F346 titles, dates and source URLs; licence confirmation; the personal-data note
for MP profiles; orders naming individuals; the Rajya Sabha key; and inventories of v1.6 by collection if the owner's
agent holds them. Phases 0 and 1 do not wait for the answers.

## Verification

- Builds: the focused tests, `npm test`, the Edge Function tests, `npm run lint`, `npm run build`; `npm run test:sql`
  for any migration, with the fixture proved non-vacuous.
- Every new guard is shown to fail on the defect it guards.
- Loads: receipts complete, acceptance 50 of 50 per batch, verify equals plan, and the search check read from its
  figures, not from a verdict line, until E2 lands.

## Risks

| Risk | Mitigation |
|---|---|
| E1 shows the newer documents are worse answers | Phase 2 waits; the correction becomes Phase 1's first task |
| No §5.4 option fits 8 GB | Gate 0 offers a larger instance with its monthly cost beside the others |
| Moving Parliamentary Questions out of the default partition takes longer than a quiet window | rehearse on the local copy first and time it |
| The owner's answers arrive late | loads 4 and 5 wait; 1 to 3 do not |

## Not in this plan

Legal (v1.7 and F318), affidavits and the tender archive (out by ADR 0014), chunk headers (F289), and broad-search
latency at size (F292, deferred by the developer).

## Tracker

Items with numbers keep them (F279, F285, F307, F311, F314, F325, F333, F334, F336, F337, F338, F346). E2, B1, B3
and E3 have no line yet; their lines and numbers are added when this plan is pushed, taken from `main` at that time
so they do not collide with other work in progress.
