# Spec: paged module lists and the unavailable counts (F156)

> **Status: Living.** Owner request 2026-10-14 (verbatim): "since the server lists or the terminal
> lists are now server-driven, loading large datasets keeps the load time high. Can we just not do
> lazy loading, or maybe do paginated loading, so that it doesn't blow up the servers? And also
> improve speed". Follows F154 (`719a7eb`). Not approved yet: see section 13.
>
> **Evidence.** "Measured" means a command was run on 2026-10-14: read-only GET requests to
> production (`https://niyantran-six.vercel.app`, function in `bom1`) from the owner's Mac, and
> scripts run under `vite-node` against this checkout (the shipped archive files on disk, the real
> `src/lib` code). "Read" means read from the code at `fe249d9`. The measuring scripts were throwaway
> and are not in the repository.

## 1. Current state

### 1.1 Which modules are large (measured)

Every module in `src/data/html-feature-map.json` (169, of which 138 have data) was run through
`fetchArchiveFeature`, and 43 of the largest were requested from production
`/api/feature-feed`. The table lists every module over about 480 rows or about 150 KB, largest first.

| Module | Rows | Production API answer, raw / gzip | Shipped archive the browser also fetches, raw / gzip | API time, cold → edge hit |
|---|---|---|---|---|
| Bill Passage Probability Index (and Policy Intelligence Graph, same data) | 9,819 | **6.54 MB / 534 KB** (487 KB as sent, brotli) | `national_bill_tracker.json` 5.42 MB / 450 KB (389 KB brotli) | 0.59 s → 0.17–0.42 s |
| Parliamentary Question Database | 8,000 | **3.82 MB / 386 KB** (307 KB brotli) | `national_question_database.json` 3.50 MB / 371 KB (305 KB brotli) | 0.31 s → 0.14–0.19 s |
| Booth Register, Booth-level Results, and four other booth modules (local) | 1,731 each | 1.49–1.52 MB / 152–175 KB | None fetched: built from `src/data/niy-geo.json`, which is bundled into the terminal's JavaScript (378 KB / 120 KB) | 0.16–0.18 s cold |
| WTO Dispute Settlement | 646 | 534 KB / 50 KB | Four law files, 897 KB / 90 KB | 0.11 s |
| MP Profiles & Performance | 782 | 279 KB / 34 KB | 288 KB / 31 KB | 0.09 s |
| MLA Report Card + Statement Tracker | 498 | 253 KB / 57 KB | None (live only) | 1.39 s, live |
| NCLT / NCLAT (Insolvency) | 434 | 223 KB / 32 KB | 312 KB / 41 KB | 0.08 s |
| Candidate Affidavit Database | 483 | 163 KB / 27 KB | 168 KB / 25 KB | 0.08 s |
| MLA Directory | 500 (capped) | 162 KB / 13 KB | None (live only) | 3.68 s, live |
| Supreme Court Order & Judgment Feed | 220 | 152 KB / 10 KB | 312 KB / 41 KB | 0.07 s |

Every other module answers under about 125 KB raw and 25 KB gzip.

- **Only two modules are big.** Bills and Questions are about 0.9 MB and 0.6 MB as sent, counting
  the archive and the API answer together. The six booth modules are next, at about 165 KB.
  Everything else is 60 KB or less when compressed.
- **Live sources are already capped.** The server keeps at most 500 rows from any live source
  (`MAX_ROWS`, `server/featureFeed.mjs:126`). Only the shipped registers, which are files, can be
  large.
- **The big pages are downloaded twice (read, then measured).** On a module page, `archiveFirst`
  (`src/lib/featureFeed.js:123`) starts the shipped archive and the API together. For Bills that is
  up to 389 KB + 487 KB on a cold cache. The archive download is cancelled only if the API answers
  first, and by then most of it may already have arrived. For Bills and Questions, the archive and
  the API answer are the same register file.
- **Client processing time (measured on the Mac).** For 9,819 Bills: parse 17 ms, preparing the
  feed 44 ms, side-panel overview 8 ms, filter groups 19 ms and sort 31 ms, about 0.12 s in all. For
  8,000 Questions it is about 0.24 s, of which sorting by date takes 161 ms. Booths take about
  0.02 s. Phones will be several times slower; that was not measured.
- **The server is not under strain.** A cold Bills answer makes the function build 6.5 MB. After
  that, Vercel's edge serves repeat requests (`HIT`/`STALE`) for 300 s, then serves stale copies for
  up to a day while it refreshes. So the function runs about once per 5 minutes per URL while people
  are using it.
  - Paging does not reduce server work by much. Search and filter terms create new URLs, which
    means more, smaller function runs.
  - What paging does reduce is what each browser downloads and processes, and the time until the
    first rows appear.

### 1.2 What a module page does with the rows (read)

The page loads the whole list once. Everything below then works on that full list in the browser:

| Feature | Where | Needs every row? |
|---|---|---|
| Search: an index for 500 rows or more, otherwise a scan | `DeskView.jsx:195-205`, `tableSearch.js:62-63` | Yes |
| Chart-click filter and the Questions "Has answer" filter | `DeskView.jsx:206-209` (`applyVizFilter`, `matchesChoice` from `TableFilterPop.jsx:12`) | Yes |
| Sort | `DeskView.jsx:210` (`sortRows`) | Yes |
| Paging, 100 rows per page, already in the browser | `DeskView.jsx:61, 217-224, 771-777` | Only the current page is drawn |
| Columns, worked out from the filtered rows | `DeskView.jsx:226` (`feedColumns`) | Yes (a sample would do) |
| Row counts and "page x/y" | `DeskView.jsx:530-538` | A count only |
| Filter menu options and their counts | `TableFilterPop.jsx:54-62` → `tableFilterGroups` (`analytics.js:893`) | Yes, but the result is fixed for each module |
| Side-panel key figures and charts | `RailContent.jsx:109` → `feedOverview` (`analytics.js:964`) | Yes, but fixed for each module |
| Record panel's related rows (same sector, same member, other disputes) | `RailContent.jsx:34`; `nationalBills.js:74-76`, `nationalQuestions.js:78-83`, `lawWtoRegister.js:103` | The related rows only |
| Opening a cited row from an AI answer | `openRowSource.js:39-47` (`takePendingDeskRow`) | That one row |
| Attaching a sample to the AI | `aiDrop.js:351` | 6 rows |
| Policy Intelligence Graph | `PolicyGraphDesk.jsx:18-19` (`buildPigModel`) | Yes: the graph is the whole register |
| Export | Only on small dossier desks (Chokepoints, Energy, Conflicts, Leaders, Commodities); not on the table | Not relevant |

The functions involved (`filterRows`, `searchTableRows`, `sortRows`, `applyVizFilter`,
`feedOverview`, `tableFilterGroups`, `feedColumns`, `prepareDeskFeed`) are plain JavaScript in
`src/lib`. The server can import them as they are: `api/router.js` already imports from `src/lib`.
`matchesChoice` is the only one in a `.jsx` file.

### 1.3 Other heavy data paths

- **The State desk landing downloads whole modules to count them (read, then partly measured).**
  - `useStateLanding.js:15` calls `fetchFeature` for each of 26 modules. The other seven desks have
    `/api/*-landing` routes that return a count.
  - Measured or estimated, one cold visit downloads at least 440 KB compressed. The two booth
    modules are about 320 KB of that.
- **The Goa geography pack is in the terminal's JavaScript (measured).** `archiveFeed.js:62`
  imports `niy-geo.json` (378 KB / 120 KB). The build places it in a shared chunk
  (`AiMarkdown-*.js`, 727 KB / 215 KB) that every terminal visit loads, whether or not a booth
  module is opened.
- **Small bundled files.** The source registry (19 KB compressed) and the feature map (16 KB) are in
  the entry chunk. Other `src/data` files, under 22 KB compressed each, go with the terminal. These
  are small; no change is proposed.
- **Data served by the server vs shipped as files.**
  - Module pages and the seven landing routes are served by the server and edge-cached.
  - `/data/embedded_csv/*` and `/data/*.json` are static files that the browser fetches directly.
  - `src/data/*` is compiled into the JavaScript.
  - `desk_rows` in Supabase is used only for AI grounding (`deskRowsFeed.js`); no list on screen
    reads it.
  - The admin users list (`server/usersApi.mjs:40-41, 256-287`) is the one list that is already
    paged on the server: `{ ok, users, page, pageSize: 100, total }`. It is the pattern for this
    spec.

### 1.4 The "unavailable" counts and the backup packs

F154 recorded that the Morning Brief, Statement & Quote Tracker and Economic Overview landing counts
answer 502 because the deployed server cannot read the backup packs. That is half right.

- **The deployed function does not read the backup packs (read).**
  - Locally, the Vite middleware wraps answers in `applyBackupFallback` for `/api/feature-feed`
    (`server/featureFeed.mjs:3795`) and for the National, Global and Law landings (`:3730-3731`).
  - `api/router.js` calls `serveFeatureFeedWithinLimit` directly for both, so the fallback never
    runs. `applyBackupFallback` is not exported.
  - The function's files are `includeFiles: '{src/data/**,public/data/**}'` (`api/router.js:40`,
    `vercel.json`). `backup/` (82 MB, 107 tracked files) is not among them, so
    `backupFeed.mjs:11, 62` would find an empty index anyway.
- **The three modules have no backup pack (measured).** Run locally, `loadBackupForFeature` returns
  `null` for all three. Including the packs would not fix them.
- **The real cause (measured).** All three are live-only: news search or the World Bank API, with no
  shipped archive.
  - When the live attempt passes 4 s, the archive pass finds nothing. The landing answers
    `ok: false, served: 'archive'`, HTTP 502, `no-store`.
  - The live attempt keeps running, and its late answer is kept on that server instance for
    10 minutes (`LATE_LIVE_MS`).
  - Morning Brief landing, three requests about 12 s apart: 502 in 4.2 s, 502 in 4.1 s, then
    **200 with 219 reports in 1.6 s**.
  - Statement Tracker: the landing gave 502 in 4.4 s; the module answered live with 104 rows in
    2.1 s shortly after.
  - Economic Overview answered 200 live in 0.58 s (186 countries). It fails only when the World Bank
    is slow.
- **Where the backup packs would help (measured).** Some modules answered 0 rows on production after
  the 4 s limit, although a backup pack exists locally:

  | Module | Pack rows |
  |---|---|
  | Athlete Index | 8,668 |
  | Growth Indicators | 17,490 |
  | Global Trade | 17,490 |
  | Satellite Infrastructure | 16,506 |

  Locally, 70 modules have a pack.
- **The packs are slow to read (measured).**
  - `parseXlsxRows` (`backupFeed.mjs:263-265`) reads the whole first sheet before keeping 500 rows,
    and it blocks the server while it does.
  - Timings: 0.96–2.57 s per large workbook; 4.6 s for the whole Key Financial Indicators call on a
    cold start; 2.0 s for the Supreme Court call.
  - The same files read with `sheetRows: 600` take 0.18–0.35 s.

## 2. Problem

1. **Bills and Questions pages download about 0.9 MB and 0.6 MB** and process 8,000–10,000 rows
   before showing 100 of them. On a fast connection this costs well under a second. On a slow phone
   connection it costs several seconds. This is an estimate from the sizes, not a measurement.
2. **The State landing downloads whole modules** just to show counts.
3. **Every terminal visit downloads the Goa booth pack** (120 KB compressed) in its JavaScript.
4. **Live-only modules show "unavailable" counts** after 4 s, although the server gets the answer a
   few seconds later.
5. **The deployed site never uses the backup packs.** It shows nothing where the local server shows
   stored rows. Turning the packs on as they are would block the server for up to 4.6 s on a cold
   read.

## 3. Expected outcome

1. **Pages from the server for large modules.** Opening Bills or Questions downloads one page of
   rows (100, about 8 KB compressed) plus a short summary, and never the whole register.
   - Search, filters, sort and page changes ask the server.
   - Results are the same as today's, because the server runs the same `src/lib` code over the same
     rows.
2. **Small modules stay as they are.** Their whole list is at most about 60 KB compressed, and
   paging them would add requests without a visible gain.
3. **Pages are edge-cached** like the module answers today.
4. **Counts that are still loading are not shown as "unavailable".** A landing count that missed the
   4 s limit is retried, and the count appears when the late live answer arrives.
5. **The deployed site uses the backup packs** as the local server does, with a bounded read.

## 4. Paged read: API contract

`GET /api/feature-feed?tier=…&feature=…&page=1&pageSize=100&q=…&sort=…&dir=asc|desc&filter=…&answer=…&key=…`

- **When it pages.** Only when `page` is present and the module is on the paged list (section 5).
  Without `page`, the answer is exactly what it is today, so the graph, landings, other callers and
  older browsers are unaffected.
- **Parameters.**
  - `page`: from 1.
  - `pageSize`: one of 50, 100 or 200; default 100.
  - `q`: trimmed, at most 100 characters.
  - `sort`: a column key, with `dir`.
  - `filter`: a JSON array of chart-filter clauses `{col, value, map?, values?}`, as `applyVizFilter`
    takes them, at most 2 KB.
  - `answer`: the Questions answer filter, one or more of `yes`, `no`, `unknown`. A missing value
    counts as `unknown`, as it does today.
  - `key`: one row's `deskRowKey`, for opening a cited row.
  - A bad parameter answers 400, which is never cached.
- **Answer.** The usual envelope (`ok`, `tier`, `feature`, `source` with at most 20 links,
  `coverage`, `meta`, `fallback`, `served`) plus:
  - `paged: true`
  - `rows`: one page of rows, already prepared, marked `prepared: true`, so the browser does not run
    `prepareDeskFeed` again.
  - `page`, `pageSize`
  - `total`: rows matching the search and filters.
  - `totalAll`: rows in the register.
  - `columns`: `feedColumns` over the whole register.
  - `filterGroups` and `overview`: computed over the whole register, about 1.5 KB compressed
    together.
  - A page past the end is an empty page with the real `total`, as in `usersApi.mjs`.
- **How the server answers.**
  1. Load the module as today (`serveFeatureFeedWithinLimit`, then the backup fallback).
  2. Run `prepareDeskFeed` once.
  3. Search with `searchTableRows` or `filterRows`, as the browser does today.
  4. Apply `applyVizFilter` and the answer filter.
  5. `sortRows`, with the row key as a tiebreak so pages never overlap.
  6. Slice out the page.
- **Caching on the server.** Each server instance keeps the prepared rows, the search index and the
  last few sort orders in memory, keyed by module and source file. Search and sort then cost
  milliseconds after the first request.

## 5. Which modules are paged

- **Threshold.** A module is paged when its full answer is over **250 KB compressed or over
  5,000 rows**. Today that is exactly two: **Bill Passage Probability Index and Parliamentary
  Question Database**. They are listed in one shared allow-list, `src/lib/pagedFeatures.js`, which
  the server and browser both read and a test checks against the threshold.
- **Everything else keeps loading the whole list.**
  - The booth modules (165 KB): their rows are already in the browser's JavaScript, so paging them
    would save nothing until the geography pack leaves the bundle (open question 4).
  - WTO, MP Profiles and the rest are each at most about 60 KB compressed.
- **Policy Intelligence Graph keeps the whole register.** It draws every bill. It uses the request
  without `page`, as today.

## 6. Features that need every row, on paged modules

| Feature | How it works when paged |
|---|---|
| Search, sort, filters, paging | Sent to the server (section 4). The existing 100-row pager stays, with numbers from `total`. The search box waits 300 ms after typing stops before asking. |
| Filter menu options and side-panel figures | From `filterGroups` and `overview` in the answer. `TableFilterPop` and `RailContent` use them when `feed.paged` is set. |
| Columns | From `columns` in the answer. |
| Related rows in the record panel | When a row is selected, the side panel requests up to 200 rows that share its sector (Bills) or member (Questions), using `filter`. It passes them to the adapter as `ctx.rows`. The adapters do not change. |
| Opening a cited row | `takePendingDeskRow` falls back to a `key=` request when the row is not on the current page. |
| Attaching a sample to the AI | Uses the current page; it takes 6 rows. |
| Export | None on these desks; nothing to do. |
| Fallback when the API is not deployed or fails | The whole shipped archive, as today, browsing in the browser. A degraded path, not the normal one. |

## 7. Edge caching

- `/api/feature-feed` is already on the edge allow-list (`api/router.js:45-57`) for any query
  string. A successful page is kept for 300 s with a day of stale copies (60 s for an archive
  answer), and errors are never kept.
- The browser always builds the URL with its parameters in one fixed order. It lower-cases and trims
  `q`, and leaves out default values. The same view then always has the same URL, so it is more
  likely to be served from the edge.
- Unbounded search text could create many distinct URLs. That is why the parameters have limits and
  the search box waits for typing to stop.

## 8. The two server fixes from F154

### 8.1 Counts that are still loading

- **No server change.** A landing answer already carries `served: 'archive'`.
- The seven `use*Landing.js` hooks treat `availability: 'error'` with `served: 'archive'` as
  **pending**. They show "Loading live count…" and request it again after 6 s and 15 s, then give
  up and show "unavailable".
- The second or third request usually gets the late live answer (measured: Morning Brief on its
  third request). That 200 is then edge-cached for the next visitors.

### 8.2 The backup packs on the deployed site

1. **One shared function.** `server/featureFeed.mjs` exports one function that applies the backup
   fallback after `serveFeatureFeedWithinLimit`. Both the Vite middleware and `api/router.js` call
   it, so the local and deployed servers answer the same way.
   - It is used for `/api/feature-feed` and the National, Global and Law landings, exactly where the
     local server uses it today.
   - It keeps `served: 'archive'` on a backup answer. `applyBackupFallback` currently drops it,
     which would make the edge keep a backup answer for 300 s instead of 60 s.
2. **A bounded read.** `backupFeed.mjs` passes `sheetRows: cap + 100` to `XLSX.read`, so a read
   takes at most about 0.4 s.
3. **The packs go into the function.** `includeFiles` gains `backup/**`, in both `vercel.json` and
   `api/router.js` `config`. This adds about 82 MB to the function. It is a deployment change and
   needs the owner's approval (open question 3).

## 9. Acceptance evidence

**Measured before and after, recorded in F156:**

- Bills and Questions, opened on production with an empty browser cache:
  - transfer at most **20 KB compressed** for the first page and summary (today 0.9 MB and 0.6 MB);
  - never request `/data/embedded_csv/national_bill_tracker.json` or
    `national_question_database.json`.
- First rows on the page, from the owner's Mac:
  - at most 0.5 s on an edge hit and 1.2 s on a miss;
  - with Chrome DevTools' Slow 4G preset, at least 50% faster than today for both modules.
- Search, sort or a page change: an answer within 0.6 s on a miss and 0.3 s on an edge hit.
- A paged answer from the server is at most 100 KB raw. A warm search over Bills takes at most
  100 ms of server time, measured locally.

**Tests, each shown to fail without its code:**

- For Bills and Questions, and a fixed set of searches, sorts, chart filters and answer filters, the
  server's page equals the same slice of today's browser pipeline.
- Bad parameters answer 400 and are not edge-cached; a good page is edge-cached.
- A request without `page` is unchanged.
- `src/lib/pagedFeatures.js` matches the threshold.
- The landing hooks retry a pending count twice, then show "unavailable"; a real failure (no
  `served: 'archive'`) is not retried.
- The router's `/api/feature-feed` returns backup rows when the live and archive passes are both
  empty, as the Vite middleware does, and keeps `served: 'archive'`.
- A large pack is read in under 1 s.

**On production after the owner's push:**

- With a cold cache (right after a deploy), the Morning Brief and Statement Tracker counts appear
  within 25 s in at least 4 of 5 tries.
- Athlete Index, Growth Indicators, Global Trade and Satellite Infrastructure show stored rows when
  their live source misses the limit.

**Checks:** `npm test`, `npm run lint`, `npm run build`, `npm run check:bundle` and
`node -e "import('./api/router.js').then(() => console.log('router import ok'))"`.

## 10. Scope

- **Server:** `server/featureFeed.mjs` (the shared backup function and the paging entry point),
  `server/featurePage.mjs` (new, pure paging), `server/backupFeed.mjs` (bounded read),
  `api/router.js`.
- **Shared:** `src/lib/pagedFeatures.js` (new). `matchesChoice` moves from `TableFilterPop.jsx` to
  `src/lib/choiceFilter.js`, and `TableFilterPop.jsx` re-exports it.
- **Browser:** `src/lib/featureFeed.js`, `src/desks/DeskView.jsx`, `src/shell/RailContent.jsx`,
  `src/shell/TableFilterPop.jsx`, `src/ai/openRowSource.js`, and the seven `src/desks/use*Landing.js`
  hooks with a shared helper.
- **Deployment config (with approval):** `vercel.json` `includeFiles`.

## 11. Exclusions

- No database or Supabase changes, and no moving registers into the database.
- No infinite scroll: the existing pager stays.
- No change to `backup/` or `public/data/` and no regenerated packs.
- No change to Policy Intelligence Graph, the special desks (MP cards, dossiers), Morning Brief or
  Statement desk pages, or modules below the threshold.
- The State landing route, moving the geography pack out of the bundle, and the other F154 leftovers
  (new-tab start-up, desk images) are not in this spec. They need the owner's decision (section 13).

## 12. Risks

- **The server and browser could drift apart.** Both run the same `src/lib` functions, and parity
  tests compare them.
- **Search could create many uncached URLs.** Limited by the parameter limits, the URL rules in
  section 7 and the wait for typing to stop. Each request is cheap once the instance has the rows in
  memory.
- **A cold server instance is slower on its first paged request.** It has to read and prepare the
  register first: 0.3–0.6 s, measured as today's cold answer.
- **Rows could move between pages.** Prevented by the row-key tiebreak. The registers are files that
  change only on a deploy.
- **The function gets 82 MB bigger with the backup packs**, which may slow cold starts. That will be
  measured after the deploy. The alternative is a one-off conversion of the packs to compact JSON,
  which is a data task needing its own approval.
- **A pending count that never arrives** costs two extra requests before "unavailable" shows.

## 13. Tasks

The tasks run one after another, on `task/speed-paging`. Every task runs `npm test`,
`npm run lint`, `npm run build` and the router import. T3 and T4 also run `npm run check:bundle`.

| # | Task | Write scope | Depends on | Focused checks |
|---|---|---|---|---|
| T1 | Backup packs on the deployed site: the shared function, a bounded read, the router uses it | `server/featureFeed.mjs`, `server/backupFeed.mjs`, `api/router.js` (including `config.includeFiles`), `vercel.json` (`includeFiles` only, after approval), a new `src/lib/backupFallbackRoute.test.js` | Owner answer to Q3 for the config line | `npx vitest run src/lib/backupFallbackRoute.test.js src/lib/featureFeedTimeLimit.test.js src/lib/apiCachePolicy.test.js` |
| T2 | Pending landing counts are retried | `src/desks/landingRetry.js` (new), the seven `src/desks/use*Landing.js` and their tests | None | `npx vitest run src/desks/use*Landing.test.js` |
| T3 | Server paging | `server/featurePage.mjs` (new), `server/featureFeed.mjs` (paging entry in the middleware), `api/router.js` (paging entry), `src/lib/pagedFeatures.js` (new), `src/lib/choiceFilter.js` (new), `src/shell/TableFilterPop.jsx` (re-export only), new `src/lib/featurePage.test.js` | T1 | `npx vitest run src/lib/featurePage.test.js src/lib/apiCachePolicy.test.js` |
| T4 | Browser paging | `src/lib/featureFeed.js`, `src/desks/DeskView.jsx`, `src/shell/RailContent.jsx`, `src/shell/TableFilterPop.jsx`, `src/ai/openRowSource.js`, and their tests | T3 | `npx vitest run src/lib/featureFeed.test.js src/desks src/shell src/ai`, then a browser check of Bills and Questions on `npm run dev`: search, sort, chart filter, Has answer, pager, record panel, opening a cited row |
| T5 | Production check and record (after the owner pushes) | `docs/plans/open-work.md` (F156), `docs/agents/coordination.md` (operations record) | T1–T4 and the push | The production measurements in section 9 |

Only T5 records F156 as done in `open-work.md`.

## 14. Open questions for the owner

1. **Which modules get pages.**
   - **Recommendation:** only Bills and Questions. They are the only two over 250 KB compressed;
     every other module is at most about 60 KB.
2. **"Lazy loading" or pages.**
   - **Recommendation:** pages from the server behind the existing 100-row pager, not infinite
     scroll. It is simpler, the page numbers stay meaningful, and the URLs cache well.
3. **Put the 82 MB of backup packs into the deployed function** (a `vercel.json` change).
   - **Recommendation:** yes, with the bounded read. It lets four modules that show nothing today
     show stored rows.
   - The alternative is converting the packs to small JSON files, which is a separate data task.
4. **Two follow-ups outside this spec, measured here.**
   - (a) A count-only route for the State landing, like the other seven desks. It saves at least
     440 KB per State landing visit.
   - (b) Loading the Goa geography pack only when a booth module opens. It saves 120 KB compressed
     on every terminal visit.
   - **Recommendation:** add both to open work as small follow-ups after this one. (b) is about a
     one-line change in `archiveFeed.js`.
5. **Wording for a count still loading.**
   - **Recommendation:** "Loading live count…" while it retries, then the existing "unavailable"
     text.
