# Keyword and vector search together on every desk (F393, `hybrid-sitewide`)

> **Status: Living (2026-11-21).** Module `hybrid-sitewide` of the
> [corpus and search completion programme](2026-11-20-corpus-and-search-completion.md). Open work: F393 (and F355 for
> Regulatory). The code is built and tested; no desk is switched on. Which desks gain is decided from the measurements
> below, desk by desk, by the developer. An independent review of the first build (2026-11-21) found three required
> defects and three smaller ones; this revision fixes them, each with a test that failed first (see "Review fixes").

## Current state (read from the code)

- `match_documents_hybrid` (`supabase/migrations/20261102120000_chunk_hybrid_search.sql`) applies keyword search to the
  NCLT desk alone: the constant `c_nclt` sends every other scope to `match_documents`. Its rule is NCLT's own: question
  words in at most 300 readable chunks that are also in the title of 1 to 50 documents, plus a list from a stated month.
- The keyword read runs in `retrieval_internal.hybrid_candidate_ids`, a definer function that copies the publication
  rule of `law_documents_serving` and compares the access policies to the ones it was written against; the invoker
  function reads every returned chunk back through the caller's row-level security. A keyword read as the signed-in
  user does not use the index (the match operator is not leakproof; measured 2026-11-19, F355).
- The Edge Function switch is one `app_flags` row, `hybrid_search`, read only for an NCLT feature search with no
  document ids (`supabase/functions/_shared/retrieval.ts`, `research-chat/index.ts`, `research-chat/hybridFlag.ts`),
  with a vector-only fallback under its own time budget (F288). The row exists on NTER since 2026-11-16.
- Every chunk partition has the keyword index `document_chunks_content_tsv` (read on NTER 2026-11-20).
- The NCLT rule measured no gain on Regulatory (40 of 55 either way). A general rule, R1, was measured read-only on NTER
  on 2026-11-19: first 10 from 40 to 45 of 55, none lost; bar 47 ([spec](2026-11-18-regulatory-search-after-load.md)).

## Problem

Keyword and vector search together are required on every desk (developer, 2026-11-20), but the only keyword rule is
tuned on NCLT party names and the switch exists for NCLT alone.

## Expected outcome

One general rule behind `match_documents_hybrid`, and a switch per desk: a row in `public.hybrid_search_desks`. A desk
without an enabled row returns exactly what it returns today. Each desk is switched on only where its own measurement
shows a gain; a desk that does not gain stays vector only, on record.

## The design

**The rule** (R1; `retrieval_internal.keyword_candidate_ids`):

1. The question is cut to 4,000 characters and analysed with the `simple` configuration. Of its first 64 words (digit
   words first, then the longest), a word is *rare* when it is in 1 to 2,000 chunks of the desk that the caller can read.
   Each word is probed with sequential and plain index scans forbidden for the duration of the probes (the caller's
   settings are put back after them): for a word in many chunks the default planner chooses a sequential scan of the
   partition, measured at about 200 ms a word against 12 ms with bitmap scans on a 40,000-chunk partition.
2. Rare words are kept, digit words first and each group rarest first, while their counts add up to at most 6,000.
3. A candidate is an embedded chunk of an indexed document of the desk (and tier) that holds at least two kept words
   (one, when only one was kept). Its score is the sum over the words it holds of `ln(2001 / count) + 1`, rounded to six
   decimals, so a rarer word weighs more and ties are exact.
4. The best 300 by score, and every candidate tied with the 300th, are ordered by score, then by cosine similarity to
   the question, then id; the first 100 are the list. A chunk's score depends only on which kept words it holds, so ties
   are the normal case; the first build cut the 300 by chunk id and kept 11 of the 100 nearest in the reviewer's
   measurement. The ties are bounded by the word budget (at most 6,000 rows are scored).
5. The list is fused with the 100 vector rows by reciprocal rank fusion, k = 60, weight 1 per list, as for NCLT. No
   candidate, or no list, returns the vector rows. `similarity` stays the chunk's cosine similarity.

**Access.** The read runs in `retrieval_internal` as the definer. It asks one function,
`retrieval_internal.hidden_document_ids()`, for the documents `law_documents_serving` does not admit and leaves their
chunks out before it counts, scores, cuts or ranks anything. That function first runs the NCLT helper's policy comparison
(an empty-text call that reads no row) and then returns the list; a changed policy raises 55000 and the search falls back
to vector only. It is executable by no role but its owner (it returns ids the caller may not read), and its statement
is a copy of the one in the NCLT helper, which this migration does not touch: the fixture requires the two to be the
same text. The invoker function reads every returned chunk again through the caller's own policies: the access check is
last. The search function stays executable by `authenticated` and `service_role`, not `anon`.

**The switch.** A row per desk in `public.hybrid_search_desks (desk_feature, enabled, hybrid_ms, fallback_ms)`,
readable by `authenticated` (the Edge Function reads it with the caller's client, 500 ms bound, cached 15 s, as for
NCLT), written by `service_role` only. The SQL checks the row itself, so a direct call for a desk without a row returns
`match_documents`' rows; the Edge Function checks it so that an unflagged desk makes no hybrid call. Budgets default to
2,500 ms (hybrid) and 4,000 ms (fallback), clamped as for NCLT. **Rollback for a desk: delete its row.** The migration
inserts no row.

A row for NCLT, or for a name that no document carries, is refused (SQLSTATE 23514: a check constraint for NCLT, a
trigger for the name; the database holds no list of desks, the catalogue is in the application), so a mistyped name
cannot sit in the table switching nothing.

**NCLT.** Unchanged: its own rule, switched by the `hybrid_search` row, whether or not `hybrid_search_desks` holds an
NCLT row. NCLT moves to the general rule only if the general rule measures no worse on NCLT's question set, as a
separate decision.

## Deploy order

The migration first, then the Edge Function. The function reads `hybrid_search_desks` for every desk except NCLT; before
the migration the table does not exist, so each such read fails, is logged (`research.hybrid_flag_read_failed`, scope
`desk`, no desk name, no question text) and is treated as "off", and the search stays vector only. The reverse order
therefore degrades safely, but costs a failed read per desk every 5 seconds until the migration lands. Rolling back is
the other way round: the function can stay (an absent row is off); the migration's rollback is in its header.

## Acceptance evidence (per desk, before its row is created)

From the programme spec. Each item is a measurement or a proof, not a reading of the code.

1. A question set written before tuning: at least 50 for a desk over 20,000 chunks, a short set otherwise (110 drafts
   exist for the five new desks).
2. Hybrid against vector only, in one sitting: no question lost that vector only finds; more found in the first 10.
3. A deliberately broken variant (the next question's keyword list) scores worse.
4. No search above 4 s warm or after an eviction; median no worse than 1.2 times vector only.
5. A fixture proving a desk without a row returns exactly what it returns today (built; below).
6. An independent review of the migration against the access rules (not done).

## What is built

| Item | Where |
|---|---|
| Migration: flag table (with its two refusals), the hidden-document list, the keyword helper, replaced function | `supabase/migrations/20261124100000_hybrid_sitewide.sql` |
| Fixture, with a mutation per defect | `supabase/tests/hybrid_sitewide.sql`, `supabase/tests/run.sh` (`hybrid_sitewide`) |
| Per-desk switch in the Edge Function | `supabase/functions/_shared/retrieval.ts`, `supabase/functions/research-chat/index.ts` and their tests |

The fixture proves: a desk with no row, or a disabled row, returns exactly `match_documents`' rows for every scope; a row
for one desk changes no other desk, no unscoped search and no search that names document ids; a flagged desk's rows equal
an independent re-implementation of the fusion; the rule's parts (two words, rarity, the 2,000 boundary, tier, unindexed
documents, chunks without a vector, other desks); an unpublished order's chunks neither appear nor make a word rare;
a changed policy fails the keyword path closed; `anon` is refused; the helper reads the keyword index and never scans a
partition even for a word in 30,000 chunks, under the session's default planner settings (and the check can fail);
more than 300 chunks tied on score return the 100 nearest of them; the hidden-document function is executable by no
role and its statement is the NCLT helper's text; a row for NCLT or for an unknown desk is refused; NCLT keeps its rule.
`run.sh` mutates the migration 19 ways and requires the fixture to fail on an assertion each time, and checks that the
migration's final statement (the policy comparison on the database being migrated) rolls it back on a drifted database
and is the statement that does so.

## Review fixes

The independent review of the first build (2026-11-21) found, and this revision fixes:

| Finding | Fix | Test that failed first |
|---|---|---|
| R1. The cut at 300 was by chunk id; ties are normal; 11 of the 100 nearest were returned | Cut with ties on the score, then order by score, distance, id | 400 chunks tied on score: the list must be the 100 nearest of them |
| R2. The rarity probe scanned the partition sequentially for a common word | The probes forbid sequential and plain index scans, then restore the caller's settings | A word in 30,000 chunks under default planner settings: no sequential scan (the old guard forced the setting itself) |
| R3. Two copies of the hidden-document rule | One private function holds the comparison and the list; the fixture compares its text with the NCLT helper's | Schema holds three helpers; the list is not executable by any role; the two texts are equal |
| O1. No rollback test for the final statement | `hybrid_sitewide_drift_rollback_check` in `run.sh` (drifted: 55000 and nothing left; undrifted: applies; drifted without the statement: applies) | The third case proves the statement is what refuses |
| O2. The flag-read failure line | Carries `scope` (`nclt` or `desk`), never the desk or the question; the deploy order is stated above | The two flag-failure tests in `research-chat/index_test.ts` |
| O3. A row for NCLT or an unknown desk | Check constraint and trigger, 23514 | Four refused inserts and updates, and a `service_role` insert that works |

Not changed, and why: the explicit restoring of the planner settings after the probes has no test of its own (the helper's
SET clause already restores them when the function returns; the explicit restore keeps the candidate scan's plans the
caller's own). The desk-name check is "some document carries it", the most the database can know.

## Measurements

**Not measured here (2026-11-21).** The measurement is per desk and needs a local database that copies NTER's chunks for
that desk together with the questions' reference passages. None exists in the local containers:

- `niyantran_ingest_load_regcab_test` (read only here, never written) holds 10,548 Regulatory chunks, not the 183,805
  of NTER, and not the reference passages of the 55 questions.
- `niyantran_ingest_load_test` (15 GB) is a load-proof database; its desk sizes are not NTER's and its text is not the
  corpus the question sets were written against, so word rarity, and with it every score and timing, would not mean
  what NTER's would.
- `niyantran_retrieval_replica` and `niyantran_rehearsal_hs` predate the partitioned chunk table (no `desk_feature` on
  chunks), so the function cannot run there.

What was run is the fixture on a synthetic local database (below). Nothing in this module has been measured for
quality or latency. The per-desk evidence list above (items 1 to 4 and 6) is therefore open. To measure on NTER
without writing to it, the supervisor can run the rule's SQL as `retrieval_internal.keyword_candidate_ids` is written,
inside `begin transaction read only; ... rollback;` over `psql service=nter-accept` (as R1 was run on 2026-11-19), or
apply the migration to a restored copy; raw output belongs in `~/niyantran-eval-cache/hybrid-sitewide-2026-11-21/`.

Proof run (2026-11-21, disposable local databases): `./supabase/tests/run.sh hybrid_sitewide` passes; its vacuity
check fails without the migration; the drift check passes; the 19 mutations of the migration each fail the fixture on
an assertion.

## Scope

The migration, its fixture and run.sh entries, the per-desk read in the Edge Function and its tests, this spec, and the
F393 entry of `open-work.md`.

## Exclusions

- No flag row, migration, deploy or setting on NTER; the supervisor applies and the developer decides.
- No change to NCLT's rule or switch, to `match_documents`, or to any desk's data.
- No re-ranking stage (module `rerank-measure`), no one-bit index (`one-bit-index`).
- Latency on NTER at its real size (warm and after an eviction) is not measured here; see Measurements.

## Unverified

- Behaviour at NTER's size (833,144 chunks; the Regulatory partition alone is 183,805): the cost of 64 probes, each
  building a bitmap of the word's matches in the partition, and of scoring up to 6,000 rows.
- A second review of this revision against the access rules (the first review's findings are fixed; the fixes are not
  yet re-reviewed).
- The cost of the probes' bitmap scans and of ordering up to 6,000 tied rows by distance at NTER's size.
- The tie rule (every candidate tied with the 300th is ordered by similarity) is a choice made here; R1 was measured
  with its own tie order.
