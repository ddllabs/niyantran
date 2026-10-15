# Spec: RBI Handbook registers keep every year (F201)

> **Status: Normative.** Written 2026-10-15 for open-work F201. The owner wants the full history.
> The approach below is a recommendation until the owner approves it (see "Decisions for the
> owner"). Plan: [2026-10-15-rbi-handbook-full-history](../plans/2026-10-15-rbi-handbook-full-history.md).
> Builds on F196 batch 2 (`6e32b72`, `5f54439`) and
> [ADR 0012](../decisions/0012-scheduled-feeds-records-first.md).

## Current state

The facts below come from reading the code. The numbers come from one execution: the 148 saved
table pages in `tmp/rbi-handbook/html/` were parsed again with `parseHandbookTable`
(`src/lib/rbiHandbook.js`), with no cap applied and no network request. They were then compared with
the saved register `tmp/rbi-handbook/handbook-2024-25.json`.

- **How a table is stored.**
  - Each handbook table is one store variant of its module, named by the table number ("21"). The
    variants are listed in `server/feedSchedule.mjs` `FEED_REGISTERS`.
  - The variants are loaded with class `register` and kind `reference`, so each load replaces the
    variant's list.
  - Loads are done by `scripts/load-feed-register.mjs`, through `feed_claim_due` and then
    `feed_record`.
- **Why tables are cut.**
  - `scripts/fetch-rbi-handbook.mjs` caps each table at `MAX_PER_TABLE` = `STORE_PAGE_ROWS` = 500.
  - The cap keeps only the newest whole years (`newestYearsWithin`).
  - Both module pages and the Comparison Engine read a variant with a single `feed_page` call, which
    returns at most 500 items. That limit is why the cap exists.
- **What the database already allows.**
  - `feed_page(p_tier, p_feature, p_variant, p_limit, p_offset)` already takes an offset. `p_limit`
    is clamped to 1..500.
  - `feed_record` refuses more than 2,000 items in one record.
  - `feed_items.position` is checked to be between 0 and 1999.
  - So one variant can hold at most 2,000 items. Migration `20261015150000_feed_records.sql` sets all
    three limits.
- **How it is served.**
  - The page calls `serveFromStore` (`server/feedServe.mjs`), which reads one page at offset 0.
  - `storeVariant` turns a request's `table` into its variant. When the request names no table, the
    module's first table is used.
  - The live path (`serveHandbookTable` in `server/featureFeed.mjs`) reads the table's RBI page, then
    applies the same 500-figure cap.
- **How the Comparison Engine works.**
  - `serveStateComparison` reads the table's stored variant (one page), or the live page when that
    fails.
  - It drops a year the page may have cut (`wholeYearsOf`).
  - It ranks each indicator's latest year, or the `year` asked for, and limits its output to 500 rows
    of whole indicators (`rankedWithin`).
  - The page has no Year control. The server reads `year`, but the page never sends it.
- **The page's controls.**
  - `src/desks/DeskView.jsx` keeps one pick per module (`modulePick`) and sends it as `table`.
  - `src/lib/modulePicker.js` builds the Table control. The pick lives in component state, not in the
    URL: the desk hash (`src/lib/deskRoute.js`) holds only the tab and the module. MLA Directory's
    State pick is not in the URL either.
  - A whole answer of up to 5,000 rows is paged in the browser (`LARGE_PAGE`,
    `src/lib/pagedFeatures.js` `PAGED_THRESHOLD`).
- **How the AI uses this data.**
  - Handbook figures are not in `desk_rows`. ADR 0012 decision 5 keeps feed items separate, and
    `scripts/load-desk-rows.mjs` reads only the shipped archive.
  - An "Ask AI" on the module attaches six sample rows of the visible answer (`src/lib/aiDrop.js`),
    so a larger answer does not change what the AI receives.
- **The admin feed screen** (`feed_admin_status`, `src/admin/FeedStoreSection.jsx`) lists one row per
  variant. Today that is 151 handbook variants.

### Measured sizes (2024-25 edition)

| | Stored today (capped) | Full history |
|---|---|---|
| Distinct tables | 148 | 148 |
| Figures in the register | 64,445 | **101,277** |
| Store items (tables 19, 20 and 150 are in two modules each) | 65,737 | **102,569** (+36,832) |
| Store variants | 151 | **158** with whole-year blocks of at most 2,000 items |
| Tables over 500 figures | 85 cut | 85 shown in full |
| Tables over 2,000 figures | (cut) | 2: Table 176 (12,565), Table 151 (2,210) |
| Largest single year of one table | (cut) | 651 (Table 95, 2024); Table 176 has 589–608 a year |
| Largest single indicator of one table | | under 2,000 in every table (60 tables have one over 500) |
| Table-years missing today | 523 of 2,458 | 0 |
| Indicators missing entirely today | 127 in 17 tables (e.g. 176: 4, 95: 5, 152–163: 9 each) | 0 |
| Oldest year | | 1993-94 |
| Average figure as JSON | 428 bytes | 428 bytes |

- Open-work gives "152 tables". The real count is 148 distinct tables in 151 module-table variants.
  The 152nd variant in F196's count is the SDL tracker.
- Table 176 split into whole-year blocks of at most 2,000 gives 7 blocks: 2023–2025 (1,824 figures),
  2020–2022, 2017–2019, 2014–2016, 2011–2013, 2008–2010 and 2005–2007.
- Table 151 gives 2 blocks: 2020-21 to 2024-25 (1,850 figures) and 2019-20 (360 figures).
- Every other table fits in one variant. The largest is Table 16, with 1,855 figures.

## Problem

- 85 tables show only their newest years.
- 127 indicators do not appear at all. Table 176 leaves out "Outstanding Liabilities" and three
  others.
- The Comparison Engine cannot rank any year it does not hold. It also cuts Table 176's 608-row year
  to 15 of its 19 indicators.
- The owner wants every figure the handbook publishes to be served and researchable.

## Options compared

| Option | Variants | Read cost per view | Migration | Comparison (one complete year) | Admin screen | Yearly reload | Verdict |
|---|---|---|---|---|---|---|---|
| (a) One variant per table × year, with a Year picker | about 2,520 | 1–2 `feed_page` calls (22 table-years are over 500) | No | 2 calls (the year and the year before) | About 2,500 more rows | About 2,500 claims and records; the variant names come from the data, and the edition's years change every year | Rejected: too many variants; a table's history is never visible in one view |
| (b) One variant per table × indicator | about 1,500 | Still over 500 for 60 tables, so offsets are needed anyway | No | Every indicator variant of a table (up to 22 calls) | About 1,400 more rows | As (a) | Rejected: no saving, and ranking needs every indicator |
| (c) One variant per table, read whole with offset pages | 151 | Up to 4 `feed_page` calls in parallel | Only if the 2,000-item cap is raised for Tables 176 and 151 (`feed_record` and the `position` check) | 1 read | No change | No change | Good for 146 of 148 tables; the two largest still do not fit |
| **(c+) As (c), with whole-year blocks only for tables over 2,000** | **158** | **Up to 4 calls in parallel, 2,000 items** | **No** | **1 read, 2 when the year before is in an older block** | **7 more rows** | **Unchanged commands; a split table's block names can shift with an edition (reported)** | **Recommended** |
| (d) A dedicated table (`handbook_figures`) outside the feed store | 0 | 1 query by table and year | Yes: a new table, RLS, grants, 3 RPCs, an SQL fixture | 1 query | Not shown unless added | A new loader | Deferred: right if the figures later need SQL queries across tables or AI search; for serving them, it would re-build what the feed store already does |

### Why (c+)

1. **No production schema change.** It keeps every limit the store already enforces: the 2,000 items
   of `feed_record`, the `position` check, and `feed_page`'s 500 per call. It uses the offset that
   `feed_page` already has.
2. **146 of 148 tables become one complete variant.** The page shows the whole history (up to 1,855
   rows), paged in the browser as other modules are. Only Tables 176 and 151 need a Years control.
3. **It reuses the loader, the lease, `feed_make_due`, the admin screen, the `serve` switch and the
   ADR 0012 rollback, all proven in production on 2026-10-15.** The yearly reload uses the same
   commands.
4. **A complete year is always in one block,** so the Comparison Engine ranks a whole year from one
   read. It reads one more block only when the year before is in it.
5. **Option (d) stays open.** The register JSON and the item keys
   (`hb:t<no>:<state>|<indicator>|<year>`) do not change, so moving to a dedicated table later loses
   nothing.

## Expected outcome

- **The fetcher** (`scripts/fetch-rbi-handbook.mjs`) writes every figure of every table:
  - It never cuts a table for size, and the `cut` summary is removed.
  - Each table's summary lists its blocks.
  - A single year larger than the block limit makes the run exit 1. It is never cut silently.
- **Blocks** (a pure function in `src/lib/rbiHandbook.js`):
  - A table's figures are split into whole-year blocks, newest first, each holding at most
    `HANDBOOK_BLOCK_MAX` (2,000) figures.
  - The newest block keeps the variant name it has today ("176"). Each older block is named
    `"<table>@<its oldest year>"` ("176@2005").
  - A table of 2,000 figures or fewer is one block, "21", so its variant name does not change.
- **The loader** stores each block as its own register variant:
  - 158 variants and 102,569 items across the eight modules, each variant at most 2,000 items.
  - Each variant's stored view (`meta.view`) carries the table, its own block, the table's blocks and
    all of the table's years, so the page can offer the other blocks.
  - Before a reload, the loader compares the table's previous block list (read from the stored view)
    with the new one. It prints the blocks that are no longer produced and the exact SQL to switch
    their `serve` off. It never deletes anything.
- **Serving a handbook module:**
  - The store answers the whole variant: up to 4 `feed_page` calls of 500, made in parallel.
  - The calls must agree on `fetched_at` and `total`, and together return every item. Otherwise the
    answer is null and the live path answers.
  - A request may name `table` and `years` (a block's oldest year); `years` empty means the newest
    block.
  - The live path builds the same blocks from the table's RBI page and serves the asked block.
- **The page:**
  - The Table control is unchanged.
  - A **Years** control appears only when the answer lists more than one block (today Tables 176 and
    151).
  - Changing the table resets Years.
  - The Cross-State Comparison Engine gets a **Year** control, listing the table's years from its
    answer.
- **The Comparison Engine:**
  - It ranks the asked year, or each indicator's latest, from the block that holds it.
  - It reads the next older block when the year before is there.
  - It shows every indicator of that year, up to 2,000 rows of whole indicators (Table 176: all 19).
- **Existing (capped) store data keeps working** under the new code: no Years control, and the same
  rows as today. The order "deploy, then load" is therefore safe.
- **Notes say what is shown.** A table's note gives its block ("Years 2023 to 2025, 1,824 of the
  table's 12,565 figures; older years under the Years control") or "all N figures, YYYY to YYYY".

## Acceptance evidence

Each item is proven by an execution.

1. **Every figure is in the file.** `node scripts/fetch-rbi-handbook.mjs --offline` on the saved
   pages writes 101,277 records from 148 tables, with no `cut` in any table's summary. Table 176 is
   7 blocks summing to 12,565, Table 151 is 2 blocks summing to 2,210, and every other table is 1
   block.
2. **The dry runs match.** A dry run of each module (`node scripts/load-feed-register.mjs --module
   "<module>"`) gives 158 variants and 102,569 items in total, every variant at most 2,000.
   - State Fiscal Deep-Dive: 21 variants, 21,491 items.
   - State Agriculture & Rural Indicators: 48 variants, 27,358 items.
3. **The local load works.** It is run with `--apply --target local --db
   niyantran_feed_history_load_test`.
   - Every variant records `ok`. A second run with `--force` records `unchanged`.
   - `db_size()` is read before and after the load, and the growth is recorded.
   - The expected growth is about 40–60 MB. Over 150 MB stops the work for review.
4. **The store reads are correct**, checked with `serveFromStore` against the local database through
   `localRpc`:
   - Table 176 with no `years` returns 1,824 rows and 7 blocks.
   - `years=2005` returns 1,767 rows.
   - Table 95 returns 651 rows with 21 indicators, including the 5 missing today.
   - Table 176 has all 19 indicators, including "Outstanding Liabilities".
   - Tables 152–163 have 22 indicators each.
5. **The Comparison ranks any year.** Against the local database, Table 176 with `year=2023` ranks
   all 19 indicators of 2023 with the year before (2022, from block "176@2020"). `year=2015` ranks
   2015.
6. **Tests prove each rule, and each was seen failing first.** The rules are:
   - whole-year blocks, never a cut year;
   - a year over the limit refused;
   - pages that disagree giving null;
   - old capped data served as today;
   - Years and Year controls appear only when there is something to pick;
   - a table change resets Years;
   - the live key bounded for `years`.
7. **The full checks pass:** `npm run lint`, `npm run build`, `npx vitest run`, the Deno suite, and
   the router import.
8. **Production** (supervisor, after the owner authorises the deploy and the load):
   - Each module answers from the store, and Table 176 shows the Years control.
   - Ten probes of Table 176's newest block finish within the 1.5 s store limit, with a p95 target of
     1.0 s or less.
   - The admin screen shows 158 handbook variants, none failing.
   - `db_size()` growth is recorded.

## Scope

Files that may change (exact write scopes per task are in the plan):

- `src/lib/rbiHandbook.js`, `src/lib/rbiHandbookTables.js`, `src/lib/stateComparison.js`,
  `src/lib/modulePicker.js`
- `scripts/fetch-rbi-handbook.mjs`, `scripts/load-feed-register.mjs`
- `server/feedSchedule.mjs`, `server/feedServe.mjs`, `server/featureFeed.mjs`
- `src/desks/DeskView.jsx`, `src/desks/ModulePicker.jsx`
- Tests: `src/lib/rbiHandbook.test.js`, `src/lib/handbookRegister.test.js`,
  `src/lib/feedServe.test.js`, `src/lib/feedRegister.test.js`,
  `src/desks/deskViewModulePicker.test.jsx`
- Records: `docs/plans/open-work.md` (F201), `docs/agents/coordination.md` (the production record),
  and this spec and its plan.

## Exclusions

- **No database migration.** A migration is used only under the plan's contingency task, and only if
  the production probe misses the time target.
- **No dedicated handbook table** (option (d)).
- **No new RBI requests.** The full register is rebuilt offline from the saved pages of the same
  edition.
- **No new edition.**
- **Handbook figures are not added to `desk_rows`** or AI search (ADR 0012 decision 5; F170 rules
  4–9).
- **Table, Years and Year picks are not put in the URL.** No module's pick is in the URL today. A
  separate open-work item is proposed if the owner wants shareable links.
- **No change to the admin screen's code.** It lists the 7 new variants as it lists the others.
- **Tables the modules do not use** (13, 17, 99–105, 116–137, 149, 181, 182) and the three no-year
  blocks of Tables 1, 12 and 151 are left out, as decided in F196.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A `feed_record` of 1,767–1,855 items (about 1.5 MB of JSON; the largest is Table 16) is refused or slow at Supabase's REST gateway. The handbook loads so far sent at most 500 items per record; whether a larger earlier load exists (Cabinet Decisions backfill) was not checked. | Medium | Proven on the local database first. On production, Table 176's newest block is loaded first as a canary. Fallback: lower `HANDBOOK_BLOCK_MAX` to 1,000. That is one constant, and 10 tables would split instead of 2. |
| Four parallel `feed_page` calls take more than the 1.5 s store limit, so the page falls back to RBI's slower page | Low to medium (one 500-item call measured 0.2–0.7 s) | The production probe in acceptance item 8. Contingency: a one-function migration raising `feed_page`'s clamp to 2,000 (one call), with an SQL fixture and a vacuity check. |
| A reload happens between the parallel calls and mixes two loads | Very low (loads are yearly) | The calls must agree on `fetched_at` and `total`; otherwise the answer is null. |
| A later edition shifts a split table's blocks, leaving block variants nobody asks for | Certain for split tables, once a year | The loader reports them with the exact SQL to switch their `serve` off (the supervisor runs it). Their notes name their edition. |
| The reference-kind shrink guard rejects a reload that halves a variant (for example, a table split for the first time) | Low | The third shrunk answer in a row is accepted (`feed_record`). The runbook in the plan says so. |
| A 2,000-row answer is slow to draw | Low (`LARGE_PAGE` pages in the browser; a 5,000-row answer is the paging threshold) | Checked on production in acceptance item 8. |
| New block variants start with `serve` off (the `feed_state` default) | Certain | A production step switches `serve` on for exactly the new block variants. Until then they fall back to the live path. |
| The database grows | Certain, small (about +40–60 MB against 1.5 GB) | Measured locally (acceptance item 3) and on production. ADR 0012 warns at 5 GB. |

## Decisions for the owner

1. **Approve option (c+):** whole-year blocks of at most 2,000 in the feed store, with no migration.
   The alternative is option (d), a dedicated table.
2. **The default view of a table is its whole history** in one view when it has 2,000 figures or
   fewer (146 tables), rather than its newest year with a Year picker. Recommended: whole history.
3. **Add a Year control to the Comparison Engine.** Recommended: yes. Without it, older years can be
   reached only through a request the page never makes.
4. **Picks in the URL:** keep them out of F201. If wanted, a new open-work item covers the Table,
   Years, Year and MLA State picks together.
5. **Production:** authorise the deploy and the reload of the eight handbook registers with
   `--force`, the `serve` switch for the 7 new block variants, and the contingency migration only if
   the probe fails.
