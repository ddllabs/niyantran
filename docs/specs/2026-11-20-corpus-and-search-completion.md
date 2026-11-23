# Completing National ingestion and search: loads, sitewide hybrid, one-bit index

> **Status: Living (2026-11-20). Decisions taken by the developer on 2026-11-20; see Decisions.** One programme spec that joins the
> open threads of the corpus ingestion and hybrid search programmes: what is loaded, what is left, and the builds
> that stand between today and a corpus that is fully loaded and searched the same way on every desk. It is a
> capability map with an outcome and acceptance evidence per module. A module that changes the database or the search
> path gets its own design spec before it is built. It narrows, and does not replace, the
> [loads and close-out plan](../plans/2026-11-19-v1.1-to-v1.3-loads-and-closeout.md). The only list of open work is
> [open-work.md](../plans/open-work.md).

## Objective

Every servable National document in the delivered packs is on NTER, and every desk is searched by keyword and vector
together, on an index small enough to stay in memory as the corpus grows. A reader asking about any desk gets passages
from that desk's documents, with the publisher named, within the app's 4-second search limit.

## Current state (NTER read 2026-11-20, read-only)

- 26,194 documents; 22,737 ingest jobs, all succeeded; database 18 GB on a 40 GB disk; 8 GB of memory,
  `shared_buffers` 2 GB; pgvector 0.8.2.
- Chunks are partitioned by desk. Each partition has a half-precision HNSW vector index and a keyword (GIN) index.

  | Partition | Chunks | Table | Vector index | Keyword index |
  |---|---|---|---|---|
  | Bills | 356,084 | 3,208 MB | 1,311 MB | 78 MB |
  | NCLT | 225,257 | 2,066 MB | 877 MB | 67 MB |
  | Regulatory | 183,805 | 1,678 MB | 710 MB | 58 MB |
  | Default (Parliamentary Questions, Cabinet, others) | 69,356 | 632 MB | 271 MB | 32 MB |

  The four vector indexes total 3,169 MB, which is already more than `shared_buffers`. Cold searches after an
  eviction are the known cost ([hybrid plan records](../plans/open-work.md), F324).
- Hybrid search (keyword and vector fused) is live for NCLT only, behind a flag row. Every other desk is vector only.
  The NCLT keyword rule, measured on Regulatory, changes nothing; a rule that scores rare question words lifts
  Regulatory from 40 to 45 of 55 against a bar of 47
  ([Regulatory search spec](2026-11-18-regulatory-search-after-load.md)).
- Loaded on 2026-11-20: 300 Cabinet decisions from v1.1 (1,246 chunks), through the five-desk search-only route
  ([record](../operations/2026-11-20-cabinet-first-batch.md)). The acceptance check of the third batch is still owed:
  the operator's machine slept with its lid closed during it.
- Measured load speed at the raised worker limits: 100 documents in 6.5 to 7 minutes, three runs, about 900 an hour.
  The runner and its acceptance checks run on the operator's machine.
- What is left in v1.1 to v1.3:

  | Set | Records | State |
  |---|---|---|
  | Cabinet (v1.1) | 547 | route live; loading |
  | Budget (v1.1) | 346 | route live |
  | Bills fixed and recovered (v1.2) | 115 | Bills route |
  | Industry (v1.1; v1.3) | 21; 37 | route live; the 37 not screened |
  | MP profiles (v1.1; v1.2) | 2,950; 565 | route live; the 565 not screened |
  | Regulators archive and SEBI refresh (v1.3) | about 8,300 | screen refuses web-page text (F369); desk held for search (F355) |
  | Bill corrigenda (v1.1) | 365 | no route (F372) |
  | Budget with faulty extracted text | 116 | needs re-extraction (F391) |
  | Transfers (v1.1; v1.3) | 29; 11 | source links dead (F390); the 11 not screened |
  | Corrected texts for live documents (v1.2) | 1,796 | no replacement route (F357) |

- Beyond v1.3: v1.4 holds 117,631 records; v1.5 and v1.6 are delivered and not counted by entry (F358); v1.7 (legal)
  is on hold.

## Developer decisions already given (2026-11-20)

1. All approvals to continue ingestion exist. MP profiles are not held for a note from the owner. Loads through a
   built route proceed in order, each with a rehearsal and a small first batch, and stop on any failure.
2. Hybrid search is required on every desk.
3. The Regulatory re-ranking measurement has no spending cap.
4. The one-bit index is wanted now, for its smaller index, not left until v1.4.

Deletes, migrations, function deploys, pushes and anything touching billing still take a named yes each.

## Capability map

| Module id | Responsibility | Depends on | Open items |
|---|---|---|---|
| `loads-ready` | Load what has a route: Cabinet, Budget, Bills v1.2, Industry, MP profiles | `default-partition` before Budget and MP profiles are both in | F374 |
| `default-partition` | Keep the default partition under its working bound; the runner refuses a desk without a current chunk count | none | F285, F392 |
| `hands-off-loads` | The operator's machine screens and registers; Supabase does the rest unattended; acceptance runs later on its own | none | F356, F394 |
| `hybrid-sitewide` | One general keyword rule, fused with vector search, with a switch per desk; on for every desk that passes | none | F355, F393 |
| `rerank-measure` | Measure a second-stage re-ranker on Regulatory; build it only if `hybrid-sitewide` misses the bar | `hybrid-sitewide` measurement | F355 |
| `one-bit-index` | A one-bit vector index with re-ranking on the stored vectors, per partition, measured against today's index | `hybrid-sitewide` on, so both are measured together | F279 |
| `regulatory-archive` | Accept web-page text for Regulatory, then load v1.3's archive | `hybrid-sitewide` passing on Regulatory | F369, F338 |
| `repairs` | Corrigenda route, Budget re-extraction, Transfers source, text replacement, row links, row files | `loads-ready` for row links | F372, F391, F390, F357, F368, F373 |
| `next-packs` | Inventory v1.4 to v1.6 by entry, then load | `one-bit-index`, `default-partition` | F358, F278 |

Build order: `hands-off-loads` first, then `loads-ready`; `hybrid-sitewide` with `rerank-measure`; `default-partition`;
`one-bit-index`; `regulatory-archive`; `repairs` alongside, each on its own spec; `next-packs` last.

## Outcome and acceptance evidence per module

### `loads-ready`
Outcome: 547 Cabinet, 346 Budget, 115 Bills, 58 Industry and up to 3,515 MP profile records are on NTER or held with
a counted reason. Evidence, per desk, as the [five-desk spec](2026-11-19-five-desk-search-only-route.md) point 5:
screen counts, rehearsal on the local copy, first batch of at most 100, acceptance on every batch, `analyze`, one
desk search that returns a loaded document, other desks' counts unchanged, a record in `docs/operations/`. After a
first batch passes, a desk's later batches may be larger.

### `default-partition`
Outcome: no partition passes 100,000 chunks without a decision. By estimate the five desks take the default partition
from 69,356 to about 96,000. Recommendation: move Parliamentary Questions (68,110 chunks) to its own partition before
Budget and MP profiles are both loaded, by the method used for the first partitions (new partition built beside,
swapped in one transaction, old rows kept until checked). Evidence: its own design spec; fixture; rolled-back dry
run; search check for Parliamentary Questions identical before and after.

### `hands-off-loads`
Developer decision 2026-11-20: the operator's laptop is not to carry a long load. A small batch is tested first; the
bulk then runs on Supabase.

What runs where today: chunking, embedding and indexing already run on Supabase (the `ingest-worker` function on its
30-second schedule). The laptop reads the pack from Drive, screens it, registers each batch (one call of about 4 s
per 100 records), then waits for that batch to index and runs its acceptance check before registering the next. Only
that waiting ties a load to the laptop.

Outcome: after the first batch of a desk has passed with the laptop attending, the remaining batches are registered
in one short sitting and the laptop may close. Supabase works through the queue. Acceptance for every batch is run
afterwards, by a command that registers nothing. The worker limits are raised for the load and put back by a
scheduled step on Supabase when the queue is empty, not by the laptop.
Evidence: a test that the register-only path makes no acceptance or watch call and that the accept-only path makes
no registration call; the stop thresholds of the policy shown to hold without a client attached, or moved into the
database if they are enforced by the client today (to be read from the code before design); one load of several
batches completed with the laptop closed, every batch accepted afterwards.
Not chosen: a function on Supabase that reads the packs from Drive itself. It would also remove the screening step
from the laptop, but screening is minutes, and the page check fetches official PDFs that do not suit a function's
time limit.

### `hybrid-sitewide`
Outcome: every desk is searched by keyword and vector together, through one function and one rule, with a flag row
per desk and the vector-only path as fallback, as NCLT has today.
- The rule: question words that are rare in the desk's chunks, each candidate scored by the rarity of the words it
  holds, the first 100 fused with the vector list. The keyword read runs in the private schema with the access check
  last, because a keyword search as the signed-in user does not use the index (measured 2026-11-19).
- NCLT keeps its present rule unless the general rule is measured to be no worse on NCLT's question set.
- Evidence, per desk, before its flag is set: a question set written before tuning (at least 50 for a desk over
  20,000 chunks, a short set otherwise; 110 drafts exist for the five new desks); hybrid against vector only in one
  sitting, no question lost that vector only finds, and more found in the first 10; a deliberately broken variant
  scores worse; no search above 4 s warm or after an eviction, median no worse than 1.2 times vector only; a fixture
  proving a desk without a flag row returns exactly what it returns today; an independent review of the migration
  against the access rules.
- A desk that does not gain stays vector only, on record, until a better rule exists. "Sitewide" means every desk has
  been measured and switched where it helps, not that one switch is thrown for all.

### `rerank-measure`
Outcome: a measured answer to whether re-ordering the first 100 passages with a re-ranking model lifts Regulatory past
its bar (ceiling 50 of 55, since 10 of 15 misses are in the first 100). Evidence: the 55 questions and a fresh set, in
one sitting against vector only and against the keyword rule; cost and added time per search recorded. No cap on the
measurement; spend is reported. Building it into the search path is a separate decision, because it adds a model
call, a cost and a failure path to every search.

### `one-bit-index`
Outcome: each partition is searched through a one-bit vector index, with the candidates re-ranked on the stored
half-precision vectors, so the index held in memory is a fraction of today's 3,169 MB. The stored vectors are kept,
so the change is an index build on NTER and not a re-ingestion.
- This is not needed to fit v1.1 to v1.3: they add about 73,000 chunks, near 280 MB of today's index. It is needed
  before v1.4, and it helps now because today's indexes already exceed `shared_buffers`.
- Evidence, measured before any switch: index size per partition; agreement of the first 10 and first 40 passages
  with today's index on each desk's question set, hybrid on; the cold read after an eviction; the desk and document
  filters; build time and locks. The switch is per partition, the old index kept until the new one has served for an
  agreed period. Dropping an old index is a delete and takes its own yes.
- Its own design spec first; pgvector's documented behaviour for bit indexes is to be read from its documentation,
  not assumed.

### `regulatory-archive`
Outcome: the Regulatory screen accepts web-page text on the density-only basis the desk already has, and v1.3's
archive is loaded. Depends on `hybrid-sitewide` passing on Regulatory, because the last load dropped the search check
from 50 to 40 of 55 and this load is three times larger. Evidence: as `loads-ready`, plus the Regulatory search check
no worse after the load than before it.

### `repairs`
Each on its own short spec: a corrigenda route (F372); re-extraction of 116 Budget records (F391); a source or a
decision for 29 Transfers (F390); replacing a live document's text with the old text recoverable (F357); row links
for search-only documents (F368); row files and page boxes (F373).

2026-11-23, F390: the runner has a `relink` command (`scripts/bulk-runner/cli.ts relink`, rules in
`scripts/bulk-runner/relink.ts`), because nothing could change a record's `file_url` without breaking the reader's
receipt. It replaces the dead links of the 29 Transfers records from a map of checked new links on the same official
host, refuses the whole run on any map line that fails a rule, and writes `relinked.jsonl` with a receipt that chains
the reader's, so `screen` page-checks the new links and `split`, `plan` and `run` take the output as usual.

### `next-packs`
Outcome: an inventory by entry of v1.4 to v1.6, then loads by the same procedure. Not started before
`one-bit-index` and `default-partition` are in place.

## Commands

    npm run lint && npm run build && npm test
    deno test -A --config supabase/functions/deno.json supabase/functions
    npm run test:sql
    deno run -A --config supabase/functions/deno.json scripts/bulk-runner/screen.ts --screen <name> ...
    deno run -A --config supabase/functions/deno.json scripts/bulk-runner/cli.ts split|run ...
    node scripts/eval-retrieval.mjs --target nter --compare ...

## Where things live

Migrations in `supabase/migrations/` with a fixture each in `supabase/tests/`; the runner in `scripts/bulk-runner/`;
search functions and shared constants in `supabase/functions/`; question sets in `eval/retrieval/`; specs, plans and
records under `docs/`. Raw measurement and load output stays outside the repository.

## Boundaries

- Always: a rolled-back dry run before any migration on NTER; every guard shown to fail on its defect; a fixture shown
  to fail without its migration; counts only in records, never document or user text; a rollback named before a step.
- Ask first: applying a migration, deploying a function, setting a desk's hybrid flag, switching a partition to a new
  index, pushing or opening a pull request.
- Never: `supabase db push`; deleting existing rows or objects without a named yes (the 5.3 GB backup table stays);
  billing or account changes; credentials in the repository; a load of the legal corpus while it is on hold.

## Exclusions

No change to chunking or to the embedding model. No change to billing, accounts or analytics. No move to another
vector store. The legal corpus (v1.7) is out.

## Decisions, 2026-11-20

The developer took the recommendations:

1. **Re-ranker in the live search:** decided after its measurement. The measurement did not run on 2026-11-20: it
   needs a model key on the operator's machine, which the developer does not want. It is deferred until the keyword
   rule has been measured; if still needed it is run from a function on Supabase, where the key already is.
2. **Order:** sitewide hybrid, the Parliamentary Questions partition, the one-bit index, then the Regulators archive.
3. **Regulatory hold:** the archive stays held until hybrid passes on Regulatory.
4. **Transfers:** the 29 are held; the owner is asked for a working source.
5. **Where long loads run:** on Supabase, as `hands-off-loads` sets out. This replaces the earlier recommendation of
   the operator's machine with its lid open.

## Not verified

- The chunk estimates for the remaining loads come from character counts.
- Search speed on the default partition near 100,000 chunks has not been measured.
- The size and agreement of a one-bit index on NTER have not been measured; the saving is expected, not shown.
- The general keyword rule has been measured on Regulatory only.
