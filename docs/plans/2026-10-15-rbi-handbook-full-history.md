# Plan: RBI Handbook registers keep every year (F201)

> **Status: Living.** Written 2026-10-15. Spec:
> [2026-10-15-rbi-handbook-full-history](../specs/2026-10-15-rbi-handbook-full-history.md) (option
> (c+): whole-year blocks of at most 2,000 figures in the feed store, with no migration). Work does not
> start until the owner approves the spec's "Decisions for the owner". The item is tracked as F201 in
> `docs/plans/open-work.md`.

## In plain words

1. **Store every figure.** Each table is stored whole. The two tables larger than one store variant
   (2,000 figures), Tables 176 and 151, are split into blocks of whole years.
2. **Serve every figure.**
   - The page reads a whole variant (up to four reads of 500 at once).
   - It offers a Years control where a table has more than one block.
   - The Comparison Engine gets a Year control.
3. **Prove it locally, then load production.** Load a local database, check it, then deploy and
   reload the eight registers on production with the owner's authorisation.

## Working rules

- **Branch.** One branch, `task/f201-handbook-full-history`, from `main`. The tasks are sequential:
  several of them share `server/featureFeed.mjs`, `src/lib/handbookRegister.test.js` and
  `src/desks/DeskView.jsx`. No concurrency and no worktrees.
- **Delegation.** A task agent may take one task at a time with its exact write scope. It does not
  delegate further. It leaves its work uncommitted and reports evidence. The supervisor commits each
  verified task.
- **Tests first.** Each task starts with a failing test that names its rule (a red run recorded),
  then the change, then the task's checks.
- **Out of scope.** A defect found outside the write scope is reported, not fixed.
- **Standard checks** (named "full checks" below), from the repository root:

  ```bash
  npm run lint
  npm run build
  npx vitest run
  deno test -A --config supabase/functions/deno.json supabase/functions
  node -e "import('./api/router.js').then(() => console.log('router import ok'))"
  ```

  The Deno suite is required because these tasks change `src/lib/` (AGENTS.md). The router import is
  required for any change under `server/`. `npm run test:sql` is needed only for the contingency
  migration (task X).

## Fixed interfaces

These are agreed before T1 and not changed by later tasks without the supervisor.

- **`src/lib/rbiHandbookTables.js`**
  - `HANDBOOK_BLOCK_MAX = 2000`. A test asserts that it equals `MAX_ITEMS` in
    `scripts/load-feed-register.mjs`, which is `feed_record`'s cap.
  - `handbookVariant(no, from = '')` returns `"176"` when `from` is empty, else `"176@2005"`.
  - `parseHandbookVariant(value)` returns `{ no, from }`, or null for anything that is not that form.
    `from` must be a handbook year token matching `/^(19|20)\d{2}(-\d{2,4})?$/`, as in "2005",
    "2019-20" or "1993-97".
  - `handbookTableVariant(spec, table, years = '')` returns the variant for a request: `''` when the
    module does not hold the table, else `handbookVariant(no, validYears)`. A `years` value that is
    not a year token is ignored, so it maps to the newest block.
- **`src/lib/rbiHandbook.js`**
  - `yearBlocks(records, max = HANDBOOK_BLOCK_MAX)` returns
    `[{ from, through, years, count, records }]`.
  - Blocks come newest first and hold whole years. `years` within a block is newest first. Records
    keep their input order.
  - The function throws `RangeError` when one year alone has more than `max` records. It never cuts
    one.
  - `blockList(no, blocks)` returns
    `[{ value: '' | from, variant, from, through, count }]`. The newest block has `value: ''` and
    `variant: "<no>"`. This list is what `meta.blocks` holds.
- **Stored and live `meta` of a handbook module answer** (the loader writes it as `meta.view`):
  - `{ heading, table, block: { from, through }, blocks: blockList, years: [all the table's years,
    newest first], as_of, status }`.
  - It stays under `metaFor`'s 4 KB view limit. Table 176's 7 blocks and 21 years are about 1 KB.
- **Request parameters.**
  - Handbook modules take `table` (as today) and `years`, a block's `from`; empty means the newest
    block.
  - The Comparison Engine takes `table` and `year` (as today).
- **`server/feedSchedule.mjs` `FEED_REGISTERS`, handbook entries.**
  - Each entry gains `variantFrom(searchParams)`, which applies `handbookTableVariant` to `table` and
    `years`, falling back to `defaultVariant`.
  - Each entry gains `wholeVariant: true`.
  - `variantOf(value)` also accepts a block variant of a table the module holds.
  - `registerRunsForDb(id, variants = register.values)`.
- **`server/feedServe.mjs`.**
  - For a register with `wholeVariant`, `serveFromStore` asks `feed_page` for offsets
    `0, 500, 1000, 1500` in parallel, with limit `STORE_PAGE_ROWS`.
  - It joins the pages in offset order.
  - It answers null unless every page has the same `fetched_at` and `total` and the joined rows
    number `total`.
  - Everything else is unchanged: `storeTotal`, `register: true`, and `meta` from `meta.view`.

## Tasks

### T1. Whole-year blocks (pure functions)

- **Goal.** Add the block rule and the variant names. No caller changes yet.
- **Write scope.** `src/lib/rbiHandbook.js`, `src/lib/rbiHandbookTables.js`,
  `src/lib/rbiHandbook.test.js`.
- **Depends on.** Nothing.
- **Acceptance.**
  - `yearBlocks` gives Table 176 in the saved fixture shape: 7 blocks of 3 years, the newest
    2023–2025 with 1,824 figures.
  - A table of 2,000 figures or fewer is 1 block.
  - No block exceeds `max` or splits a year.
  - A year over `max` throws.
  - `handbookTableVariant` rejects other modules' tables and malformed `years`. A test builds
    synthetic records shaped like Table 176 (21 years × 608).
  - The existing `newestYearsWithin` stays until T5 removes its last caller.
- **Verify.**
  - `npx vitest run src/lib/rbiHandbook.test.js` fails before the change and passes after.
  - Then the full checks.
- **Size.** S.

### T2. The fetcher writes every figure

- **Goal.** `scripts/fetch-rbi-handbook.mjs` stops capping tables.
  - Each table's summary gets `blocks` (from `yearBlocks` and `blockList`) in place of `cut`.
  - A `RangeError` from `yearBlocks` is reported and the run exits 1.
  - The log line per table gives its blocks.
  - `MAX_PER_TABLE` and its import of `STORE_PAGE_ROWS` are removed.
  - The header comment is updated.
- **Write scope.** `scripts/fetch-rbi-handbook.mjs`, `src/lib/handbookRegister.test.js`. The F196
  review R1 tests for the fetcher are replaced by tests for the new rule, which still proves that no
  year is ever partly kept.
- **Depends on.** T1.
- **Acceptance.**
  - On the test fixtures, the register holds every parsed record and no `cut`.
  - A table of more than 2,000 figures lists its blocks.
  - A synthetic year of 2,001 figures exits 1.
- **Verify.**
  - Focused: `npx vitest run src/lib/handbookRegister.test.js`, red then green.
  - The full checks.
  - Supervisor, local, no network:
    1. Copy the capped file once for the rollback:
       `cp tmp/rbi-handbook/handbook-2024-25.json tmp/rbi-handbook/handbook-2024-25.capped-2026-10-15.json`
    2. Run `node scripts/fetch-rbi-handbook.mjs --offline`
    3. Expect "Wrote 101277 records from 148 tables", with 7 blocks for Table 176 and 2 for
       Table 151.
- **Size.** S.

### T3. Registers and the loader by block

- **Goal.** Load each block as its own register variant, with the stored view the page needs.
  - **`server/feedSchedule.mjs`.** Apply the fixed `FEED_REGISTERS` changes (`variantFrom`,
    `wholeVariant`, block-aware `variantOf`) and `registerRunsForDb(id, variants)`.
  - **`scripts/load-feed-register.mjs`, block variants.**
    - The handbook registers group the module's rows by table, run `yearBlocks` per table, and give
      each row its block variant.
    - Runs come from `registerRunsForDb(id, <the variants found>)`.
    - Each variant is checked against `FEED_REGISTERS[id].variantOf`.
  - **`scripts/load-feed-register.mjs`, stored meta and note.**
    - `registerMeta` passes `meta.view` in the fixed shape.
    - `handbookNote` says which years the block holds, of how many figures in the table.
  - **`scripts/load-feed-register.mjs`, obsolete blocks.**
    - Before applying, the loader reads each split table's default variant (`feed_page`, limit 1).
    - It lists the stored `meta.view.blocks` that the new load does not produce.
    - It prints them and the exact
      `update public.feed_state set serve = false where tier = 'state' and feature = '…' and variant in (…);`
      for the supervisor. It writes nothing for them.
  - **`scripts/load-feed-register.mjs`, `--force`.** Confirm, and test, that `--force` on a variant
    the store has never seen goes on to claim it. `feed_claim_due` adds it as due now. A "not made
    due" line must not stop it.
- **Write scope.** `server/feedSchedule.mjs`, `scripts/load-feed-register.mjs`,
  `src/lib/handbookRegister.test.js`, `src/lib/feedRegister.test.js`.
- **Depends on.** T2.
- **Acceptance.**
  - Dry runs on the T2 file give the per-module counts in the spec: 158 variants and 102,569 items
    in all, the largest 1,855 (Table 16).
  - MLA Directory is unchanged: its test suite passes untouched.
  - A fake-rpc test shows the obsolete-block report and that nothing is written for those blocks.
- **Verify.**
  - Focused: `npx vitest run src/lib/handbookRegister.test.js src/lib/feedRegister.test.js
    src/lib/mlaRegister.test.js`.
  - The full checks.
  - Supervisor: `for m in "state:State Economic Data (GSDP, sectors)" "state:State Fiscal Deep-Dive"
    "state:NITI Aayog State Indices" "state:District Health & Nutrition Indicators" "state:District
    Education Indicators" "state:District Economic & Livelihood Indicators" "state:District
    Agriculture & Rural Indicators" "state:District Infrastructure & Connectivity"; do node
    scripts/load-feed-register.mjs --module "$m"; done` (dry runs). Record the totals.
- **Size.** M.

### Checkpoint A: the data

- The full checks are green.
- The dry-run totals match the spec (158 variants, 102,569 items).
- The supervisor reviews the variant names and the note text before any serving change.

### T4. The store answers a whole variant

- **Goal.** Read a whole handbook variant as fixed above. `storeVariant` uses `variantFrom` when a
  register has one.
- **Write scope.** `server/feedServe.mjs`, `src/lib/feedServe.test.js`.
- **Depends on.** T3.
- **Acceptance.** Fake-rpc tests show:
  - a 1,824-item variant served whole, in order;
  - a 480-item variant (today's capped data) served as today, with no blocks in `meta`;
  - pages disagreeing on `fetched_at` or `total` give null;
  - one page failing or passing the time limit gives null;
  - `serve` off gives null;
  - MLA Directory's `registerAcross` is unchanged;
  - a module without `wholeVariant` still makes exactly one `feed_page` call.
- **Verify.**
  - Focused: `npx vitest run src/lib/feedServe.test.js src/lib/feedServeRoute.test.js`.
  - The full checks.
- **Size.** S.

### T5. Module answers: the live path and the live key

- **Goal.** `serveHandbookTable` serves the asked block on the live path:
  - It parses the page, runs `yearBlocks` and chooses the block by `years`.
  - It writes `meta` in the fixed shape.
  - The note gives the block and the table's total.
  - `handbookLiveKeyParts` adds the block's `from` (validated, so keys stay bounded, as in F196
    review R3).
  - The store path for handbook ids gets the whole variant (T4).
  - `newestYearsWithin` and its tests are removed once nothing calls it.
- **Write scope.** `server/featureFeed.mjs`, `src/lib/rbiHandbook.js`, `src/lib/rbiHandbook.test.js`,
  `src/lib/handbookRegister.test.js`.
- **Depends on.** T4.
- **Acceptance.**
  - On the big-table fixture (`bigTablePage()`), the live path returns the newest block whole, and
    `years=<an older from>` returns that block.
  - An invalid `years` returns the newest block and shares its live attempt.
  - Two different blocks get separate live attempts.
  - The store answer's `meta.blocks` reaches the envelope.
- **Verify.**
  - Focused: `npx vitest run src/lib/handbookRegister.test.js src/lib/rbiHandbook.test.js`.
  - The full checks.
- **Size.** M.

### T6. The Years control on handbook modules

- **Goal.**
  - `src/lib/modulePicker.js` adds `yearsPicker(tier, feature, feed)`. It returns
    `{ id: 'handbook-years', param: 'years', label: 'Years', defaultValue: '', options }` from
    `feed.meta.blocks` when there is more than one block, else null. Option labels read "2023 to
    2025", or "2019-20" for a one-year block.
  - `src/desks/DeskView.jsx` keeps a second pick, scoped to the module and table (a table change
    resets it).
  - It sends `{ table, years }`.
  - It renders a second `ModulePicker` beside the Table control.
  - The "other list must not stay on screen" rule (F190) covers a change of Years too.
- **Write scope.** `src/lib/modulePicker.js`, `src/desks/DeskView.jsx`, `src/desks/ModulePicker.jsx`
  (only if a prop is needed), `src/desks/deskViewModulePicker.test.jsx`.
- **Depends on.** T5.
- **Acceptance.** Component tests show:
  - no Years control for a one-block answer or for today's capped data;
  - 7 options for a Table 176 answer;
  - picking one requests `table=176&years=2005`;
  - changing the table drops `years`;
  - MLA Directory's State control is unchanged.
- **Verify.**
  - Focused: `npx vitest run src/desks/deskViewModulePicker.test.jsx`.
  - The full checks.
- **Size.** M.

### Checkpoint B: module pages

- The full checks are green.
- The supervisor reproduces the focused tests.
- An independent review covers T3–T6 (server and data changes): correctness, the bounded live keys,
  and no secret or local path in a stored note.

### T7. The Comparison Engine ranks any year

- **Goal.** `serveStateComparison` reads the table's default variant through the whole-variant store
  path.
  - If the asked `year` is not in it, it finds the block in `meta.blocks` / `meta.years` and reads
    that block.
  - If the year is its block's oldest and an older block exists, it also reads that block for the
    year before.
  - It ranks with `rankedWithin(…, HANDBOOK_BLOCK_MAX)`, so every indicator of a year is shown.
  - `meta.years` lists all the table's years.
  - The note names the Year control, which lands in T8 before any deploy.
  - On the live path all records are at hand, as today.
  - For tests, the store reader is passed in (`{ store = serveFromStore }`), threaded from the route
    as `serveFeatureFeedStoredFirst` already does.
- **Write scope.** `server/featureFeed.mjs`, `src/lib/stateComparison.js`,
  `src/lib/handbookRegister.test.js`.
- **Depends on.** T5. T6 is not needed.
- **Acceptance.** Fake-store tests show:
  - Table 176 `year=2023` ranks all 19 indicators with `previous_year` 2022, read from the older
    block;
  - `year=2015` ranks from block "176@2014";
  - no year given ranks each indicator's latest;
  - capped data (today's) still ranks with `wholeYearsOf`'s guard.
- **Verify.**
  - Focused: `npx vitest run src/lib/handbookRegister.test.js`.
  - The full checks.
- **Size.** S.

### T8. The Year control on the Comparison Engine

- **Goal.** `src/lib/modulePicker.js` adds the Comparison's Year control:
  `{ id: 'comparison-year', param: 'year', label: 'Year', defaultValue: '' ("Latest"), options }`
  from `feed.meta.years`. DeskView sends `{ table, year }`. A table change resets the year.
- **Write scope.** `src/lib/modulePicker.js`, `src/desks/DeskView.jsx`,
  `src/desks/deskViewModulePicker.test.jsx`.
- **Depends on.** T6 and T7.
- **Acceptance.**
  - The Year control lists the table's years, with "Latest" first.
  - Picking "2015" requests `year=2015`.
  - A table change drops it.
  - Handbook modules show no Year control, and the Comparison shows no Years control.
- **Verify.**
  - Focused: `npx vitest run src/desks/deskViewModulePicker.test.jsx`.
  - The full checks.
- **Size.** S.

### Checkpoint C: code complete

- The full checks are green on the branch head.
- `git status` shows only the scoped files.
- An independent review covers T7–T8.
- The supervisor commits each task separately (no AI attribution).

### T9. Local end-to-end (supervisor; no code)

1. **Create the database.** Create `niyantran_feed_history_load_test` in `niyantran-corpus-test-db`
   from the chain `supabase/tests/run.sh` uses for `feed_nothing_new`: `bootstrap_auth.sql`,
   `auth_schema.sql`, migrations 0001–0015 and `research_turn_persistence`, then `20261015150000`,
   `160000`, `170000` and `230000`. Docker works only outside the sandbox.
2. **Load the capped data first, as production has it today.** Run with
   `--file tmp/rbi-handbook/handbook-2024-25.capped-2026-10-15.json` for the eight modules. Then
   serve-check Table 176 (480 rows, no blocks): this is the "new code, old data" case.
3. **Read the size before the full load.** Record `select public.db_size();`, run as an admin, or the
   table sizes with `pg_total_relation_size('public.feed_items')`.
4. **Load the full data** with `--force` for each module, using `node scripts/load-feed-register.mjs
   --module "<m>" --apply --target local --db niyantran_feed_history_load_test --force`. Each variant
   must be `ok`, and the obsolete-block report empty (Table 176's old variant "176" becomes the new
   newest block).
5. **Run the full load again.** It must be `unchanged` everywhere.
6. **Record the growth** from the size after the load. Above 150 MB, stop.
7. **Check the serving path** with
   `node --input-type=module -e "import { serveFromStore } from './server/feedServe.mjs'; import { localRpc } from './scripts/load-feed-register.mjs'; const rpc = localRpc({ db: 'niyantran_feed_history_load_test' }); for (const [id, table, years] of [['state:State Fiscal Deep-Dive','176',''],['state:State Fiscal Deep-Dive','176','2005'],['state:District Agriculture & Rural Indicators','95',''],['state:State Economic Data (GSDP, sectors)','21','']]) { const a = await serveFromStore(id, new URLSearchParams({ table, ...(years ? { years } : {}) }), { rpc, timeoutMs: 15000 }); console.log(table, years || 'newest', a?.rows.length, a?.storeTotal, a?.meta?.blocks?.length, new Set(a?.rows.map((r) => r.indicator)).size); }"`.
   Expect 1,824, 1,767, 651 (21 indicators) and Table 21 whole.
   - The block variants start with `serve` off, so set it on locally first: `update public.feed_state
     set serve = true where class = 'register';`.
8. **Check the Comparison** the same way, through the T7 store injection, for Table 176 with years
   2023 and 2015.

### Checkpoint D: ready for production

- Every T9 result is recorded in the plan's log below.
- The owner authorises the production steps.

### T10. Production (supervisor, only with the owner's exact authorisation)

1. **Deploy first.** Push `main` and let Vercel deploy. Then probe Table 176 on production: the old
   480 figures, no Years control. This is the "new code, old data" check.
2. **Read the size.** Record `db_size()` before the load. It was 1.5 GB on 2026-10-15.
3. **Canary.** Load State Fiscal Deep-Dive first:
   `SUPABASE_URL=… node --env-file=.env.local scripts/load-feed-register.mjs --module "state:State Fiscal Deep-Dive" --apply --target prod --confirm-prod --force`.
   - Its Table 176 blocks of 1,767–1,824 items are far larger than any handbook record sent before (500 at
     most).
   - The largest of all, Table 16 (1,855), follows in step 4.
   - If the gateway refuses a record, stop and use the fallback in the spec's risks.
4. **Load the other seven modules** the same way.
5. **Switch on the new block variants only:** `update public.feed_state set serve = true where tier =
   'state' and class = 'register' and variant like '%@%' and serve = false;`. Read the rows back first
   and expect 6 for Table 176 and 1 for Table 151.
6. **Probe.**
   - Each module answers from the store (`served: 'store'`).
   - Table 176 shows 7 Years options, and every option loads.
   - Table 95 shows 21 indicators.
   - The Comparison ranks 2015 for Table 176.
   - Ten timings of Table 176's newest block are recorded. The p95 target is 1.0 s or less; above
     the 1.5 s store limit, go to task X.
   - The admin screen shows 158 handbook variants and no failures.
   - `db_size()` is recorded after the load.
7. **Record** in `docs/agents/coordination.md`.

### T11. Records

- `docs/plans/open-work.md`:
  - F201 moves to Done with the commit hashes and the production evidence.
  - A new item is opened only if the owner asks for picks in the URL (spec decision 4).
- This plan becomes **Historical (dated)** with its results.
- The fetcher's and loader's header comments already describe the yearly reload (T2 and T3).
- **Write scope.** `docs/plans/open-work.md`, `docs/agents/coordination.md`, this plan.

### X. Contingency (only if T10 step 6 misses the time limit)

- **Goal.** A migration `2026101600xxxx_feed_page_block.sql` replaces `public.feed_page` with the
  `p_limit` clamp raised from 500 to 2,000. Nothing else changes, and every current caller passes at
  most 500. `serveFromStore` then makes one call for `wholeVariant` registers.
- **Write scope.** The migration, `supabase/tests/feed_page_block.sql`, the `run.sh` chain entry,
  `server/feedServe.mjs`, `src/lib/feedServe.test.js`.
- **Verify.**
  - `npm run test:sql` passes, and the vacuity check fails without the migration.
  - The full checks.
  - The supervisor applies it with `db push` only with the owner's authorisation, then re-probes.

## Rollback

The steps go from fastest to fullest. None of them deletes data without the owner's say.

1. **Instant.** Switch the handbook modules' `serve` off. The pages then fall back to the live path,
   which reads RBI's table page:
   `update public.feed_state set serve = false where tier = 'state' and class = 'register' and feature in (…the eight…);`.
2. **Code.** `git revert` the F201 commits and redeploy.
   - Old code reads the first 500 items of each variant. With the full data loaded, a module page
     could end inside a year.
   - So old code is used only with `serve` off (step 1) or after step 3.
3. **Data.**
   - Reload the capped file with `--file tmp/rbi-handbook/handbook-2024-25.capped-2026-10-15.json
     --force` for each module.
   - A variant that falls below half its size (for example 1,824 → 480) is refused as `shrunk` twice
     and accepted on the third run, so run the load three times.
   - Then switch `serve` off for the block variants (`variant like '%@%'`).
   - Then switch the eight modules' `serve` back on.

## Yearly reload (a new edition)

1. `node scripts/fetch-rbi-handbook.mjs --check`, then update `src/lib/rbiHandbookTables.js` as today
   (edition, date, page-id base, titles).
2. Fetch the new edition. It exits 1 if any single year is over 2,000 figures; that would need a new
   decision.
3. Dry-run each module, then load each with `--force` (the 30-day interval) on local, then on
   production.
4. Act on the loader's obsolete-block report with the SQL it prints. Switch `serve` on for any new
   `@` block variants.
5. A variant halved by a new split is refused as `shrunk` twice and accepted on the third load.

## Risks

See the spec's risk table. The two that decide the go or no-go are:

- the size of the largest `feed_record`, checked at the T10 canary;
- the time of a whole-variant read, checked at the T10 probe and handled by task X.

## Log

- 2026-10-15: plan written. Measurements are in the spec; they come from an offline re-parse of the
  saved pages with no requests. Nothing has been built.
