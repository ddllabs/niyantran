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
2. **Capacity is short by several times.** The packs' own manifests (read 2026-11-18, see "What the packs hold")
   list about 210,000 servable, in-scope documents not yet loaded, with about 1.5 million pages. At roughly two chunks
   a page (the v1.4 questions: 148,224 pages, 238.6 million characters) that is 3 to 4 million more chunks: an
   estimate, not a measurement. At today's 14 kB a chunk that is 45 to 60 GB on a 40 GB disk, and vector indexes of
   15 to 20 GB against 8 GB of memory. F279 was planned for 1 million documents; it is needed before v1.4.
3. **Most remaining entries have no path.** The packs feed 16 desks. Three have a partition and an admission path
   (Bills, Parliamentary Questions without a partition, Regulatory). The others, among them Statement & Quote
   Tracker, National Morning Brief, Policy Intelligence Graph, Budget and Cabinet Decisions, have no screen
   configuration, no partition (F285's function is built, not applied) and no approved policy. Existing text cannot
   be replaced through the runner (v1.2's 1,819, v1.4's 7,801 RBI fixes, v1.6's 7,068), and RBI's official files
   cannot be page-checked (F338).
4. **The inventory is by manifest only.** v1.4 does not state `servable` in its manifest, and licence classes, desk
   names and character counts per entry are read for Bills, questions and part of Regulatory only.
5. **The runner depends on a laptop staying awake.** Acceptance ended without a report three times in the last load.

## What the packs hold (manifests, read 2026-11-18; counts only)

| Pack | Records | Pages | Not servable | Main contents |
|---|---|---|---|---|
| v1.1 | 24,821 | not stated | not stated | Bills 9,709, questions 6,840, Regulatory 3,319, MP profiles 3,157, cabinet 868, budget 486, corrigenda 365, transfer orders 29, industry 28 |
| v1.2 | a delta | | | text replacements, recovered bills; affidavits (out of scope) |
| v1.3 | 8,359 new | 3,415 | not stated | Regulatory 8,311 (RBI releases and notifications, SEBI), industry 37; also page boxes for 14,959 earlier documents |
| v1.4 | 117,631 | 1,115,897 | not stated | questions 49,330, Regulatory 38,091, Morning Brief 8,939, Budget 7,091, Policy Intelligence Graph 6,352, Cabinet 4,100, statements 1,501, library bills 1,104 |
| v1.5 | 108,217 | 1,664,405 | 42,974 | Regulatory 36,071 (IBBI orders 10,056, SEBI orders 13,709, RBI 12,305), statements 21,079, library items 19,541, Morning Brief 12,525, Policy Intelligence Graph 12,096, affidavits 5,248 (out) |
| v1.6 | 204,975 | 1,128,303 | 175,669 | library questions 144,694 (not servable), Regulatory 21,669 (IBBI 17,976, CCI 3,690), library items 17,018, statements 12,373, 7,068 replacements |

Not yet loaded, servable and in scope, by subtraction: v1.1 about 4,900, v1.3 8,359, v1.4 up to 117,631, v1.5 about
60,900, v1.6 about 26,800. The Parliament Library entries wait on the owner's permission; if it arrives it adds about
190,000 documents. Open scope question for the owner: the 28,032 IBBI insolvency orders sit under Regulatory in the
packs while legal is on hold.

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
| E2. `eval-retrieval.mjs --compare` judges the mode that ran | engineering agent | `src/lib/retrievalEval.js` and its test; the script's header | a test fails on today's code for a feature-mode loss, then passes; `npm test`, lint |
| E3. Inventory by entry. Manifest counts are done (above). Remaining: per entry of v1.3 to v1.6, servable, licence class, characters and the desk name as spelled | documentation agent, with `pack.ts select` | none (receipts outside the repository) | one row per entry; chunk estimate from characters |
| E4. Capacity figures for F279 | supervisor (NTER read-only), then engineering agent on the local load copy | none | per partition: bytes per chunk for table, vector index and keyword index; buffer hit rates; projected size and memory at 2, 4 and 6 million chunks for each §5.4 option that needs no new vendor |

### Phase 0 results (2026-11-18)

- **E1, done.** Read-only on NTER, the ten lost questions were searched again and, for each, the reference passage
  and the three passages now ranked first were judged blind by an independent reviewer (excerpts of 1,800
  characters). In 7 of 10 the reference passage answers the question and none of the three does: they are the same
  regulator on another matter. In 3 a newly loaded passage answers at least as well. So the fall is real. The same
  questions through `match_documents_hybrid` scored the same 40 of 55, because that function applies keyword search
  to the NCLT desk only and returns the vector result for every other desk.
- **E2, done locally** (`task/eval-compare-mode`): the cause was that two feature-only runs compared nothing. Run
  against the pre-load baseline it now reports "worse" and names the lost questions.
- **E3, manifest counts done** (above); the per-entry profile remains.
- **E4, first figures.** Per chunk on NTER: 14 kB in all, of which stored text and vector 7.9 kB, vector index
  4.0 kB, row 1.1 kB, keyword index 0.3 kB. Vector indexes total 3.2 GB against 2 GB of shared buffers.

**Gate 0 (developer):** accept the Regulatory load or name the correction; choose the F279 option; say whether the
5.3 GB backup table may be dropped (a deletion, so its own specific yes).

## Phase 1: make every entry loadable (builds; worktrees with disjoint scopes)

| Task | Who | Depends on | Write scope |
|---|---|---|---|
| B0. Spec, measure on the local copy, then build: keyword and vector search together for Regulatory, judged on the 55 questions and a fresh set written after the load | senior builder | Gate 0 | new spec; one migration; fixtures |
| B1. Runner keeps acceptance error text, and resumes acceptance alone after an interrupted run | engineering agent | none | `scripts/bulk-runner/run.ts`, `acceptance.ts`, `cli.ts` and tests |
| B2. Screen configurations for the other v1.1 collections, on the search-only screen | engineering agent | E3 | `scripts/bulk-runner/screens/*.json`, `screens/index.ts` and tests |
| B3. Spec, then build: replacing a document's text through the runner, with the old text recoverable | senior builder | Gate 0 | new spec; `supabase/migrations/` (one file), `scripts/bulk-runner/prepare.ts`, a fixture |
| B4. Screen nits F333, F334, F336, F337 | engineering agent | B2 landed (same files) | `scripts/bulk-runner/screens/bills.ts`, `prepare.ts` |
| B5. Bills shared keys, F314 remainder and F325 | senior builder | none | per the [shared-keys spec](../specs/2026-11-10-shared-bill-keys.md) |
| B6. Parliamentary Questions screen spec | senior builder as planner | owner's Rajya Sabha key | `docs/specs/` only |
| B7. The chosen F279 option | senior builder | Gate 0 | set by its decision record |

B0 comes first: no further Regulatory load until it passes. B1, B2 and B5 may run together. B3 and B4 both touch `prepare.ts`, so B4 follows B3. Each build gets an independent
review before the supervisor commits.

Production steps in this phase, each with a rolled-back dry run and the developer's yes: apply
`20261114090000_create_document_chunks_partition`; create the Parliamentary Questions partition and move its 68,000
chunks out of the default partition (ingestion for that desk stopped, vector index rebuilt, no re-embedding).

**Gate 1 (phase-gate review, then developer):** every entry in the E3 inventory has a route or a recorded wait.

## Phase 2: loads, one collection at a time

Order, smallest risk first; each is policy, rehearsal on the local copy, a 100-document batch, the load, acceptance,
the §7 search gate, and a record:

1. the other v1.1 collections that need no owner answer;
2. Regulatory v1.3 and v1.4 (about 46,000 new records), after F338 is decided for RBI;
3. v1.2 and v1.4 replacements, through B3;
4. Parliamentary Questions v1.4 (49,330), after listing rows, the key and the partition;
5. MP profiles (3,157), after the personal-data note; then the 122,776 handover records as their own collection;
6. the desks that are new to the corpus, one policy each, v1.4 to v1.6 together per desk.

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
