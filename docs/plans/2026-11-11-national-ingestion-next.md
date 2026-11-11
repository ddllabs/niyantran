# National ingestion: next steps (F278)

> **Status: Living (2026-11-11).** Orders the work that lets National ingestion resume and become routine, after the
> Bills load. The work is tracked under F278 in [open work](open-work.md). The spec is
> [bulk ingestion](../specs/2026-11-01-bulk-ingestion.md), section 10 (the ordered steps) and section 7 (the ramp and
> its gates). The scope is [ADR 0014](../decisions/0014-national-v1.1-ingestion-scope.md).

## Purpose

The pipeline is built and has loaded one collection, Bills. This plan puts the remaining work in order, so that the
next collections load the same way with no hand steps. Each phase names what it waits for.

## Where things stand (2026-11-11)

- Partitions, registration, the runner, screening (Bills only) and automated acceptance are live. They are proved on
  the Bills load (5,680 bills).
- No remaining National collection is ready to load:
  - library bills (1,046) and library questions (144,694) are `servable=false`;
  - the 49,330 v1.4 answers have no listing rows on NTER, and there is no Rajya Sabha key;
  - Regulatory and the other v1.1 collections have no screen.
- Hybrid search is on NTER and unused. It waits for one cold measurement after an eviction.
- The developer expanded the NTER disk to 40 GB. This is reported by the developer on 2026-11-11. The supervisor has not
  read it back from the dashboard.

## How the work is divided

- Builders work test first in their own worktree. They never commit.
- Migrations, admission rules and worker failure handling go to the stronger builder.
- An independent reviewer, who did not write the spec, reviews the code.
- Documentation and pack counts go to a documentation agent. It counts only and does not trace code.
- The supervisor dispatches the work. Before every commit, the supervisor reproduces red and green. The supervisor fixes
  what review finds. The supervisor performs every NTER action and every merge, with the developer's approval.
- A whole-system review happens at the phase gate.

## Phase 0: decisions

- Disk: done. The NTER disk is 40 GB.
- Owner message: the owner message with five decisions. The developer sends it.
- Regulatory stays search-only, as today, unless the developer says otherwise. This is to be confirmed.

## Phase 1: Regulatory as the next load

| Task | Who | Done when |
|---|---|---|
| 1. Profile the regulatory entries in v1.1, v1.4 and v1.6 against the 474 live | documentation agent | counts, licences, sizes and overlaps recorded; read-only |
| 2. Spec: regulatory screen, policy, size and cost | stronger builder as planner | approved by the developer |
| 3. Build the screen, test first | builder | tests fail, then pass; Bills tests unchanged |
| 4. Independent review, then fixes | reviewer, then supervisor | review accepted; red and green reproduced |
| 5. Rehearsal on a local copy | builder runs, supervisor verifies | what the screen passes, admission admits |
| 6. NTER: policy, a 100-document batch, then the load | supervisor, each step on the developer's yes | acceptance passes on every file |
| 7. Cold measurement straight after the load | supervisor | hybrid (T9) decided: ship or hold |

## Phase 2: hardening

Phase 2 runs in parallel with Phase 1, on its own branches.

- F308: large records files. `split` streams, and `plan` and `run` refuse an oversized file.
- The two findings from the F321 review: receipt read errors in `screen.ts`, and `pack.ts` with a byte-order mark.
- F301 and F291: design first, then the stronger builder.
- The shared-key refusal for Bills (the open part of F314). Trace first. Build after Phase 1 task 3, because both touch
  the Bills screen file.

## Checkpoint: whole-system review after the Regulatory load

The review checks two things:

- a second collection is loaded with no hand steps;
- hybrid is decided.

If both hold, ingestion is routine, and feature development can restart alongside it.

## Phase 3: Parliamentary Questions v1.4

This phase starts only after the owner answers. The steps are: listing rows, a Rajya Sabha answer key, a question
partition, the screen, then the load. See [PQ screen](../specs/2026-11-11-pq-screen.md), section "T0 count, 2026-11-11".

## Phase 4: the other v1.1 collections

The collections are MP profiles, budget documents, cabinet decisions, industry documents, transfer orders and bill
corrigenda. They are planned after Phase 1, because the regulatory screen may cover several of them. MP profiles need a
personal-data note to the owner first.

## Risks

| Risk | Mitigation |
|---|---|
| The Regulatory profile finds a blocker | Switch Phase 1 to the next collection |
| Large entries exceed memory | F308 first |
| SQL fixtures job time, 20 of 30 minutes (F302) | Measure before adding fixtures |
| Owner answers arrive late | Phases 3 and parts of 4 wait. Phases 1 and 2 do not. |

## Open questions

- Is Regulatory search-only confirmed?
- Which collection follows Regulatory?
