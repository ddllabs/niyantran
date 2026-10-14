# Plan: module data repair (F169)

> **Status: Living.** The working log for the [module data repair spec](../specs/2026-10-14-module-data-repair.md).
> Proposed 2026-10-14; nothing starts before the owner approves the spec's open questions.

## Overview

Four phases, in order. Phases 1 to 3 are small, independent code changes that each ship on their
own and fix what readers see today. Phase 4 is F160 (scheduled module data), seeded with the
larger registers. Every task runs on its own `task/<slug>` branch from `main`, is verified by the
supervisor, and is pushed only with the owner's go-ahead.

**Standard checks for every code task:** `npm run lint`, `npm test`, `npm run build`,
`npm run check:bundle`, and `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`.
Each new test is shown to fail without its fix (mutation check). After a push, the supervisor
re-runs the probe (T0) for the modules the task touched and records before and after in
`open-work.md` and `docs/agents/coordination.md`.

## Dependency graph

```
T0 probe script ─┬─> Phase 1: T1 backups off
                 ├─> Phase 2: T2 PIB · T3 briefs · T4 Geopolitics · T5 ISL · T6 Regulatory
                 │            T7 Manifold + Wikidata · T8 refresh route + pending no-store
                 ├─> Phase 3: T9 "As of" dates · T10 admin status screen + registry labels
                 └─> Phase 4: F160 tasks (its own spec) + T11 seed registers
```

Phase 2 tasks touch different loaders and can run in parallel; T2 and T6 both touch
`server/nationalFeed.mjs`, so they run one after the other.

## Phase 0: measurement

### T0. Production probe script
**Description:** Turn the audit's probe into `scripts/module-probe.mjs`: for a list of modules (or
all), request `/api/feature-feed` on a given host with a cache-busting parameter, sequentially at
most 1 request a second, and print rows, `served`, `fallback`, adapter, newest row date and time
taken, as a table and JSON. Read-only.

**Acceptance:**
- [ ] `node scripts/module-probe.mjs --host https://niyantran-six.vercel.app --desk national` reproduces the audit's production numbers for National.
- [ ] Output JSON matches the audit's `modules.json` fields so runs can be compared.

**Verification:** run against production and against a local dev server; standard checks.
**Dependencies:** none. **Files:** `scripts/module-probe.mjs`, `package.json` (script entry). **Size:** S.

## Phase 1: stop showing the wrong data

### T1. Backup files off on the live site
**Description:** `server/backupFeed.mjs` reads a pack on the live function (`process.env.VERCEL`)
only when the module is in `LIVE_BACKUP_PACKS` (empty at start). `vercel.json` and the router
`config` add `excludeFiles: "backup/**"` and drop the four names from `includeFiles`. The local dev
server is unchanged. A module that has nothing else shows the plain "no records yet" state.

**Acceptance:**
- [ ] On production, no module answers with a `backup-pack` adapter (probe over all desks).
- [ ] Box Office, OTT, Sports Governance, Satellite Infrastructure, Growth Indicators and Global Trade never show another dataset.
- [ ] The function bundle no longer contains `backup/` (checked from the deployment, or by a request that would have read a pack).

**Verification:** a test that, with `VERCEL=1`, a module not on the list gets no backup rows and one on a test list does; standard checks; probe after deploy.
**Dependencies:** T0. **Files:** `server/backupFeed.mjs`, `server/featureFeed.mjs` (only if the fallback call needs the flag), `vercel.json`, `api/router.js`, tests. **Size:** S.

### Checkpoint 1
- [ ] Probe over all desks: no backup answers; the modules that lost rows are listed in `open-work.md` with what phase 4 will give them.
- [ ] Owner sees the list before phase 2 starts.

## Phase 2: repair broken and thin sources

### T2. PIB English feed
**Description:** add `reg=3` to every PIB RSS address (`server/featureFeed.mjs` `PIB_PRESS_RSS`
and the copy near line 1818; `server/nationalFeed.mjs` `PIB_PRESS`, `PIB_FEATURES`) and keep one
constant per feed. Apply the owner's Cabinet rule (spec question 2) in the Cabinet filter.

**Acceptance:**
- [ ] AI & Tech returns English PIB rows on production.
- [ ] Cabinet Decisions includes "Cabinet approves…" releases filed under a ministry (if approved), and still excludes general news.
- [ ] Policy Pipeline unchanged or richer.

**Verification:** tests on a recorded English and a recorded Hindi PIB response; probe for the three modules.
**Dependencies:** T0. **Files:** `server/featureFeed.mjs`, `server/nationalFeed.mjs`, tests. **Size:** S.

### T3. Morning Brief and Statement Tracker on the live site (F166)
**Description:** both pages read `/api/feature-feed` (which already builds their content in
`server/nationalFeed.mjs`) instead of `/api/rss`, and no longer depend on `VITE_LIVE_API`. The
Statement Tracker asks for the selected leader. No open URL proxy is added.

**Acceptance:**
- [ ] Both pages show items on production.
- [ ] Switching leader in the Statement Tracker shows that leader's statements.

**Verification:** component tests with a recorded feed answer; a browser check on the local copy; probe.
**Dependencies:** T0; T2 (same PIB feeds). **Files:** `src/desks/MorningBriefDesk.jsx`, `src/desks/StatementsDesk.jsx`, `server/nationalFeed.mjs` (leader parameter), tests. **Size:** M.

### T4. Geopolitics News Wire source order, GDELT out of the request path
**Description:** try BBC first (0.3 s), then Google News; remove GDELT calls and the 5 s retry
from the request path (spec question 3). Other modules that call GDELT first get the same order.

**Acceptance:**
- [ ] Geopolitics News Wire's newest story is under 24 h old on 9 of 10 production requests.
- [ ] No request path calls `api.gdeltproject.org` (a test greps the loaders' call list).

**Verification:** tests with recorded BBC and Google News responses; probe 10 times.
**Dependencies:** T0. **Files:** `server/featureFeed.mjs` (GDELT blocks around lines 130–180 and their callers), tests. **Size:** S.

### T5. ISL Tracker season
**Description:** request the ESPN ISL scoreboard for the season (`dates=<season>&limit=400`) instead of today only.

**Acceptance:** [ ] ISL Tracker shows at least 100 matches on production, upcoming ones marked.
**Verification:** test on a recorded season response; probe.
**Dependencies:** T0. **Files:** `server/sportsApi.mjs` (`loadIsl`), tests. **Size:** XS.

### T6. Regulatory Body Watch reads every feed
**Description:** read RBI notifications, RBI press releases and SEBI together (in parallel), merge
and sort by date, and keep the stored rows behind them instead of stopping at the first feed that answers.

**Acceptance:** [ ] production shows RBI notifications, RBI press releases and SEBI items together.
**Verification:** test with three recorded feeds; probe.
**Dependencies:** T2 (same file). **Files:** `server/nationalFeed.mjs`, tests. **Size:** S.

### T7. Manifold in parallel; Top Business Players query
**Description:** run the three Manifold calls together; rewrite the Wikidata query behind
`loadIndiaCeos` so it finishes (limit, simpler joins) and keep its last good answer as a stored
snapshot in memory for the instance.

**Acceptance:**
- [ ] Prediction Markets answers live within 4 s on 9 of 10 production requests.
- [ ] Top Financial & Business Players shows rows on production.

**Verification:** tests with recorded responses; timing from the probe.
**Dependencies:** T0. **Files:** `server/financeApi.mjs`, tests. **Size:** S.

### T8. Protect the refresh route; do not cache pending answers (F167, F168)
**Description:** `/api/home/refresh` requires a server-side secret (never a `VITE_` variable) or is
removed from the live router; a pending answer (`served: 'archive'` with no real rows) is sent with
`Cache-Control: no-store`.

**Acceptance:**
- [ ] An unauthenticated call to `/api/home/refresh` on production answers 401 or 404 and fetches nothing.
- [ ] A pending module answer carries `no-store`; a normal answer keeps the edge-cache headers.

**Verification:** router tests; a production header check.
**Dependencies:** none. **Files:** `api/router.js`, `server/homeApi.mjs`, `src/lib/apiCachePolicy.test.js`. **Size:** S.

### Checkpoint 2
- [ ] Probe over all desks; every phase 2 acceptance line checked and recorded.
- [ ] Owner review before phase 3.

## Phase 3: tell the truth about freshness

### T9. "As of" on every stored module
**Description:** when an answer is stored (`served` is not live, or the adapter is a register),
the module header shows "As of <date>" from the newest row date or the stored file's snapshot
date; "Date not recorded" when neither exists. Notes that promise live connections that do not
exist (for example Energy's "swaps to EIA/Trading Economics live") are corrected.

**Acceptance:**
- [ ] Every stored module in the audit shows a date or "Date not recorded" (render test over all of them).
- [ ] NSE/BSE shows "As of 15 Jul 2026".

**Verification:** tests; a browser check on the local copy.
**Dependencies:** T0. **Files:** `src/desks/DeskView.jsx`, `src/lib/plainSourceNote.js`, notes in the server loaders, tests. **Size:** M.

### T10. Admin API status screen shows real status
**Description:** remove the hand-written `CURATED` statuses and the "any Google News URL is live"
rule from `src/lib/apiStatus.js`; each row shows what `/api/feature-feed` returned (live or
stored, rows, newest date, reason) and when it was checked. The registry's "Direct feed configured"
labels are corrected to match the code.

**Acceptance:**
- [ ] For every row, the screen's verdict equals the probe's verdict for that module.
- [ ] No status in the screen comes from a hard-coded list.

**Verification:** tests over the registry; compare the screen's output with a probe run.
**Dependencies:** T0, T9 (shares the "as of" logic). **Files:** `src/lib/apiStatus.js`, `src/lib/refreshFeeds.js`, `src/admin/AdminPages.jsx`, `src/data/source-registry.json` (labels only), tests. **Size:** M.

### Checkpoint 3
- [ ] The admin screen's "Live" count matches the probe.
- [ ] Owner review; then O6 (Razorpay) or phase 4, as the owner decides.

## Phase 4: scheduled module data (F160) and the registers

Follow the [F160 spec](../specs/2026-10-14-scheduled-module-data.md) and its implementation plan,
with the owner's decisions of 2026-10-14: the timer runs every 5 minutes (not every minute), and
the other section 11 recommendations are adopted. The admin screen from T10 becomes F160's
"Feeds" view; no second screen is built.

### Phase 4 prerequisites and overlaps with the F160 spec
Carried over from the F160 spec so nothing it left open is lost:

- **Unverified limits, checked before F160's T1:**
  - the Vercel plan (F160 question 8; the records say Hobby, which Vercel limits to non-commercial
    use, and about 2.8 h of function time a day must fit it);
  - NTER's Supabase plan and compute size;
  - the `pg_net` request timeout ceiling against a refresh run of up to 60 s;
  - the current `desk_rows` row count on production (the spec used the 2026-09-28 record of
    34,184).
- **Already moved into this plan:** F166 (Morning Brief and Statement Tracker) is T3, F167 and
  F168 are T8, and the optional admin "Feeds" tab is T10's screen.
- **Overlap with F160's T5:** T3 already moves both brief pages onto `/api/feature-feed`, and its
  leader parameter is the `person` parameter F160's T2 adds to the refresh; F160's T5 then only
  changes where the server reads the answer from, not the pages.
- **Overlap with F160's T2:** T4 has already removed GDELT from the request path; F160's schedule
  has no GDELT class.

### T11. Seed stored copies from the registers
**Description:** a one-off, reviewed load of the chosen registers (spec question 4) from
`backup/` into F160's stored copies, each with its source and date: Cabinet's 158 decisions
first, then the MLAs and constituencies; live rows merge on top by a stable key. `backup/` itself
is not modified.

**Acceptance:**
- [ ] Cabinet Decisions shows the 158 decisions plus new live ones, newest first, with "As of" on the stored part.
- [ ] Loading is repeatable and does not duplicate rows (SQL fixture).

**Verification:** SQL fixtures on the local stack; dry run on the local stack; probe after go-live.
**Dependencies:** F160 storage tasks. **Files:** a load script under `scripts/`, an F160 migration if a column is needed, tests. **Size:** M.

## Risks and mitigations

See the spec, section 6. In addition:

| Risk | Impact | Mitigation |
|---|---|---|
| Several phase 2 tasks touch `server/nationalFeed.mjs` | Medium | T2 → T6 → T3's server part in that order on one branch, or rebased one after another. |
| Recorded upstream responses in tests go stale | Low | They test our parsing, not the source; the probe catches real upstream changes. |
| Phase 1 empties modules readers use | Medium | Checkpoint 1 lists them for the owner before phase 2. |

## Open questions

The five in the spec, section 7. Phase 1 needs question 1; T2 needs question 2; T4 needs
question 3; T11 needs question 4; the order of phase 4 and O6 needs question 5.
