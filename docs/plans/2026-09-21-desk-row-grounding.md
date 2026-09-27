# Desk-row grounding — Implementation plan

**Date:** 2026-09-21
**Spec:** `docs/specs/2026-09-20-desk-row-grounding-design.md` (Normative;
Decisions 1–5, §A–§I). Module id `desk-row-grounding`.
> **Status:** Historical (2026-09-21) — executed and verified; merged to
> `main`. The verification record at the end is the evidence.

**Goal:** Every row the terminal's desk navigation can show is in `NTER`'s
`desk_rows` table with the same identity and text the desk itself uses; a
signed-in user can call `search_desk_rows` and get a true total; the model
has the `search_desk_rows` tool, the module catalogue and the grounding
rules as fixed exports; a `row` citation opens the record detail and can
jump to the desk. Bill rows carry `document_key` so the agent loop can
scope a document search to the bill the user is looking at.

**Architecture:** One generated catalogue JSON is the module list for both
the loader and the prompt. The loader runs the desk's own feed pipeline
(`fetchArchiveFeature` → `prepareDeskFeed`, with `fetch` served from
`public/`) for every catalogue module and stores the rows the desk shows,
keyed and flattened as the desk keys and flattens them, through a pure
module that exists twice — `src/lib/deskRows.js` for the browser and Node,
`_shared/deskRows.ts` for Deno — held identical by a shared fixture. One
migration adds the RPC and two columns/indexes. The tool executor wraps the
RPC. The frontend gains a record viewer component and a pending-selection
hand-off to the shell.

**Tech stack:** Node 23 + `@supabase/supabase-js` (loader), `vite-node`
(catalogue generator, because `catalog.js` imports JSON the Vite way),
Deno (tool, catalogue block, rules), Postgres (RPC), React 19 + Vitest
(viewer, parity tests).

**Branch:** `task/desk-row-grounding` from `main` (`63ef6a1`). Sequential.
If the corpus-ingest shards are still running from the main checkout when
Task 0 starts, the branch is checked out in a worktree under the session
scratchpad with `node_modules` symlinked from the main checkout; the
ingest branch (`task/corpus-ingest`) is not touched.

## Measurements this plan rests on (2026-09-21)

| Fact | Value | How measured |
|---|---|---|
| Catalogue (navigation) modules | 75 across 8 desks | `catalogModules()` through a JSON-import shim |
| …with a pack in the manifest | 43 modules over 41 distinct packs | manifest join |
| …rows in those packs | 34,209 (bills and SC orders counted twice: two features each) | pack lengths |
| Packs that are empty today | 10 (wires, exchanges, indicators, sports, music, TV) | pack lengths |
| Bill rows | 9,819; 9,817 distinct `rowPinKey` values | pack |
| Bill rows whose `bill:<year>:<number>` exists in the corpus link map | 5,418 with year from the title suffix, else the introduction date | `ingest/national-desk/links.json` |
| Rajya Sabha bill numbers are roman numerals on both sides | 3,297 rows; 111 distinct corpus numbers | pack + link map |
| Desk row shape | `flattenRow(raw)` adds `date`, `title`, `source_url` before display | `src/lib/archiveFeed.js:149-186` |
| Modules whose rows the desk builds from `niy-geo.json`, not the pack | 6 in navigation (Constituency Register, Roll Demography, Community Bloc Matrix, Booth-level Results, Booth Political History, Local Governance Brief) | `src/lib/niyGeo.js` |
| Modules with custom Global builders over the pack | Open Fronts, Global Intelligence, Infra, Heads of State, Global Commodities, Energy, Sanctions, Maritime Choke-Points | `src/lib/archiveFeed.js:349-700` |
| `documents.metadata->>'document_key'` index | none | migration 0009 |
| **Pack rows the desk reproduces key-for-key** (measured after Task 1) | 10 of 32 modules with packs: bills ×2, questions, affidavits, MP profiles, regulators, Sanctions, Choke-Points, Heads of State, Energy; 0 % for the other 22 | `deskRows.survival` probe, 2026-09-21 |
| Why: `prepareDeskFeed`'s record checklist assigns `<module>:<title-slug>:<index>` as `id` to rows without one, and custom builders rebuild rows (NCLT shows 434 rows from two sources, prediction markets the 31 political ones, tenders none) | — | `src/lib/recordChecklist.js:111-121`, probe |
| **Rows the desk shows, over all 75 catalogue modules** | 34 modules carry rows; 34,184 rows; 6 key collisions (bills 2 ×2, MP profiles 2); 41 modules show nothing today | `src/lib/deskRowsFeed.test.js` table |

## Decisions taken by this plan (inside the spec's scope)

1. **`tier` is the desk tab id** — `global`, `national`, `state`, `law`,
   `economics`, `carbon`, `sports`, `entertainment` — the values the tool
   enum (§C) already fixes and `documents.desk_tier` already uses. The
   feature map's `htmlTier` (`geopolitics`, `judiciary`, `finance`,
   `climate`, `local`, …) is translated through `TABS` in `catalog.js`;
   `local` modules load under `state`, where the navigation shows them.
2. **Rows loaded = what the desk shows, for every catalogue module** (75;
   34 carry rows today, 34,184 rows). Superseded on 2026-09-21 the earlier
   "43 modules with a pack" reading: the probe showed the desk rebuilds or
   re-keys rows for 22 of the 32 packed modules, so loading packs would
   have given the model rows the desk never displays. A pack shared by two
   features loads under both. Features outside navigation are not loaded;
   the model can only name catalogue modules.
3. **`row` is the displayed row**, produced by the desk's own pipeline
   (`src/lib/deskRowsFeed.js`: `fetchArchiveFeature` → `prepareDeskFeed`
   with disk-served `fetch`), then flattened and keyed by
   `src/lib/deskRows.js`. Parity with the desk and with the selection the
   panel sends holds by construction; the guard `deskRowsFeed.test.js`
   asserts that every stored row re-keys to its `row_key` from its slim
   form, that the big registers are complete, and that collisions stay
   under 1 % per module. `flattenRow` and `pick` are ported verbatim from
   `archiveFeed.js` (read, not edited); `deskRowKey` is `rowPinKey` over
   the flattened row, with a content hash where the frontend key is empty.
4. **`document_key` for bills** = `bill:<year>:<bill_number>`; year is the
   four-digit suffix of `bill_name` (", 2019") when present, else the year
   of `date_introduced`; `bill_number` unchanged (roman numerals stay).
   Other modules get no key in this cut (study: questions 0/82, regulators
   2/506 join).
5. **`snapshot_at`** per module = the pack's `.meta.json` `as_of`, else the
   greatest `as_of` value in its rows, else the pack file's mtime, else
   the loader's start time (modules built from `src/data` packs); the
   loader prints which.
6. **The RPC also returns `record_text` and `document_key`** (Decision 5
   needs the key; §C's `DeskRow` needs the text). `row` is slimmed by the
   executor (≤ 32 columns, ≤ 500 chars each), not by the RPC.
7. **No `pg_trgm`.** 34 k rows; a sequential `ilike` is measured in Task 4
   and recorded. Cut two replaces it.
8. **An expression index on `documents ((metadata->>'document_key'))`** is
   added here because this module's Decision 5 is the only consumer.
9. **Loader credentials:** `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
   (`sb_secret_…`) from the environment or `.env.local`, as the ingest
   script does; the spec's `SUPABASE_SERVICE_ROLE_KEY` name predates the
   key rotation. Never a browser, never committed.
10. **The catalogue generator and the loader run under `vite-node`**
    (shipped with Vitest 3) so they can import `catalog.js` and the desk
    feed pipeline unchanged. The generator's pure builder is exported and
    the staleness test runs in Vitest, where everything resolves natively.
    The Deno side reads only the generated JSON.
11. **Row loading is a mirror:** after upserting a module, rows of that
    `(tier, feature)` with `loaded_at` older than the run are deleted, so
    a re-run after a pack shrinks does not leave ghosts.

## Global constraints

- Parameters, never interpolation: `p_query` and `p_filters` are bound
  values; the executor never builds SQL.
- A true `total` and a `snapshot_at` on every result.
- `rowPinKey` and `rowRecordText` semantics are not changed (that would
  change every `row_key`); the ports copy them.
- `RecordDetail.jsx`, `AiPanel.jsx`, `aiDrop.js`, `sourceUrls.js`,
  `catalog.js`, `archiveFeed.js`, the desks and `public/data/` are read,
  not edited. `scripts/ingest-national-desk.mjs` is not edited (it is
  in flight on another branch).
- The only shell edit is one effect in `TerminalShell.jsx` that consumes a
  pending row selection (§G "selects the row by `row_key`" has no other
  path to `setSelected`). Flagged to the owner in the closing report.
- No push, no deploy without the owner naming it. The migration is
  applied to `NTER` by the supervisor as in the previous modules.
- `git checkout -- public/data` before every commit (the dev server
  rewrites feed JSON).

## Fixed interfaces

```ts
// src/lib/deskRows.js  (browser + Node; pure)          — mirrored by _shared/deskRows.ts
export function pick(obj, keys): string                    // verbatim from archiveFeed.js
export function flattenRow(item): Record<string, unknown>  // verbatim from archiveFeed.js
export function deskRowKey(row): string                    // === rowPinKey(flattenRow(row))
export function deskRecordText(row, opts?): string         // === rowRecordText(flattenRow(row), opts)
export function billDocumentKey(row): string | null        // Decision 4; null when no number or year
export function slimDeskRow(flat): Record<string, string>  // scalars as strings; empties and nested values dropped
export function toDeskRow({ tier, feature, raw, snapshotAt }): DeskRowInsert
// DeskRowInsert = { tier, feature, row_key, row, record_text, document_key, snapshot_at }

// src/lib/deskRowsFeed.js  (Node only: the loader and its guard)
export function installDiskFetch(publicDir): () => void     // serve fetch('/data/…') from disk; returns restore
export function loadableModules(): Array<{ mod, tab }>      // catalogModules() with their desk tab
export function tabForModule(mod): string | null           // htmlTier → tab id; local → state
export function packFileFor(mod): string | null
export function snapshotFor(mod, rows, publicDir, fallback): { at: string, source: 'meta'|'rows'|'mtime'|'run' }
export async function deskRowsFor(mod, { publicDir, fallbackSnapshot }):
  { tab, feature, pack, shown, rows: DeskRowInsert[], collisions: string[], snapshot }

// src/lib/__fixtures__/deskRows.json — shared by both runners
// [{ feature, raw, row_key, record_text, document_key }]  (rows from bills, SC orders, commodities, questions)

// scripts/build-desk-catalog.mjs   (run: npx vite-node scripts/build-desk-catalog.mjs)
export function buildDeskCatalog({ modules, tabs, registryFor, packRows }): CatalogEntry[]
// CatalogEntry = { tier, feature, bucket, pack: string | null, rows: number, note: string | null }
// writes supabase/functions/_shared/deskCatalog.json = { generated_at, entries: CatalogEntry[] }

// supabase/functions/_shared/deskCatalog.ts
export const DESK_CATALOG: readonly CatalogEntry[]
export function deskCatalogBlock(tier?: string): string
export function resolveFeature(tier: string, name: string): CatalogEntry | null   // exact, then case/space-insensitive

// supabase/functions/_shared/deskGroundingRules.ts
export const DESK_GROUNDING_RULES: string            // §E, verbatim
export function selectedRecordBlock(a: { handle: string; tier: string; feature: string; recordText: string }): string
//   `Selected record ${handle} — ${feature} (${tier} desk). The user has this row open; it is the record for its own fields.\n${recordText}`
//   §F: this module owns the text; the agent loop places it before the first model call.

// supabase/functions/_shared/tools/searchDeskRows.ts   — §C verbatim, plus:
export function renderDeskRows(result: DeskRowsResult, handles: string[]): string   // the text the loop shows the model
// executor errors are returned to the model as text, not thrown: unknown feature → the tier's module names

// scripts/load-desk-rows.mjs
//   npx vite-node scripts/load-desk-rows.mjs [--dry-run] [--tier <tab>] [--feature "<name>"] [--batch 500]
//   runs deskRowsFor over loadableModules(); prints per module: shown, rows, collisions, snapshot source, upserted, pruned

// src/ai/openRowSource.js
export function openInDesk(citation): void                         // writes the hash, dispatches popstate, stores the pending key
export function pendingDeskRow(): { tab, feature, row_key } | null
export function takePendingDeskRow(feed, tab): Record<string, unknown> | null   // the matching feed row, clears the pending key
// src/ai/RowSource.jsx
export default function RowSource({ citation, onClose })          // RecordDetail over row_snapshot + "Open in desk" + captured-on note
```

```sql
-- supabase/migrations/20260921000011_desk_rows_search.sql
alter table public.desk_rows add column if not exists document_key text;
create index if not exists desk_rows_document_key on public.desk_rows (document_key) where document_key is not null;
create index if not exists desk_rows_feature on public.desk_rows (tier, feature);
create index if not exists documents_document_key on public.documents ((metadata->>'document_key'));

create or replace function public.search_desk_rows(
  p_tier text, p_feature text default null, p_query text default null,
  p_filters jsonb default '{}'::jsonb, p_limit int default 20
) returns table (
  tier text, feature text, row_key text, row jsonb, record_text text,
  document_key text, snapshot_at timestamptz, total bigint
) language sql stable security invoker set search_path = public as $$
  with matched as (
    select r.* from public.desk_rows r
    where r.tier = p_tier
      and (p_feature is null or r.feature = p_feature)
      and (p_query is null or p_query = '' or r.record_text ilike '%' || p_query || '%')
      and (p_filters is null or p_filters = '{}'::jsonb or r.row @> p_filters)
  )
  select m.tier, m.feature, m.row_key, m.row, m.record_text, m.document_key, m.snapshot_at,
         count(*) over () as total
  from matched m
  order by m.feature, m.row_key
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke all on function public.search_desk_rows(text, text, text, jsonb, int) from public, anon;
grant execute on function public.search_desk_rows(text, text, text, jsonb, int) to authenticated, service_role;
```

## Tasks

### Task 0 — Branch and baseline

1. `git status` clean on `main`; `git checkout -b task/desk-row-grounding`
   (or the worktree, see Branch).
2. `npm test`, `deno test -A --config supabase/functions/deno.json
   supabase/functions`, `npm run build`: green (29 / 72 / two baseline
   warnings) before any change.

### Task 1 — `src/lib/deskRows.js`, the fixture, and the Deno mirror

**Write:** `src/lib/deskRows.js`, `src/lib/deskRows.test.js`,
`src/lib/__fixtures__/deskRows.json`, `supabase/functions/_shared/deskRows.ts`,
`supabase/functions/_shared/deskRows_test.ts`.

- Port `pick` and `flattenRow` verbatim from `archiveFeed.js:136-186`;
  `deskRowKey` and `deskRecordText` compose them with `rowPinKey` and
  `rowRecordText` imported from `sourceUrls.js` (the JS side) and ported
  verbatim (the Deno side; `sourceUrls.js` has no imports).
- `billDocumentKey(row)`: `bill_number` trimmed, non-empty; year =
  `/,\s*(\d{4})\s*$/` on `bill_name`, else `/^\d{4}/` on `date_introduced`;
  returns `bill:<year>:<number>` or `null`.
- Fixture: 12 raw rows copied from the packs — 4 bills (a Lok Sabha
  numeric, a Rajya Sabha roman numeral, one whose title year differs from
  its introduction year, one without a title year), 3 SC orders, 3
  commodities, 2 questions — each with the expected `row_key`,
  `record_text` and `document_key`. Both test files assert every fixture
  row exactly.
- **Vacuity:** change one expected `row_key` in the fixture → both runners
  fail on that row; change `flattenRow`'s `title` key order → the
  commodities rows fail.

### Task 2 — The loader's source: desk feed rows, and its guard

**Write:** `src/lib/deskRowsFeed.js`, `src/lib/deskRowsFeed.test.js`.

*(Replaced the pack-based "survival test" after its first run showed the
desk reproduces pack keys for only 10 of 32 packed modules — see
Measurements. The probe that established why is recorded there.)*

`deskRowsFor(mod, …)` runs the desk's own pipeline for one module with
`fetch` served from `public/` and returns the rows as inserts (last row
wins on a key collision; collisions listed) plus the snapshot and its
source. The guard runs it over every catalogue module (≈ 1 s) and
asserts: every module resolves to a desk tab; ≥ 30 modules carry rows;
the six fixed registers have their exact counts (bills 9,817 ×2,
questions 8,000, affidavits 483, MP profiles 780, regulators 121);
collisions ≤ 1 % per module; every stored row re-keys to its `row_key`
from its slim `row` (the panel's selection shape); every bill row carries
a `bill:<year>:<number>` key and no question row does; every snapshot is
an ISO timestamp with a named source. It prints the per-module table for
the verification record. **Vacuity:** change a fixed register count →
fails by name. (Dropping the hash fallback from `deskRowKey` does *not*
fail this guard: the desk's record checklist gives every displayed row an
`id`, so on the loader path the fallback is a safety net for rows that
bypass the checklist; `deskRows.test.js` covers it directly.)

### Task 3 — Catalogue generator, Deno catalogue block, grounding rules

**Write:** `scripts/build-desk-catalog.mjs`,
`supabase/functions/_shared/deskCatalog.json` (generated, committed),
`supabase/functions/_shared/deskCatalog.ts` + `_test.ts`,
`supabase/functions/_shared/deskGroundingRules.ts` + `_test.ts`,
`src/lib/deskCatalog.test.js`.

- Builder input: `loadableModules()`, `registryEntries(mod)[0]?.notes`,
  and per-module row counts from `deskRowsFor` (so the catalogue says what
  the loader loads). Output sorted by tier order of `TABS`, then navigation
  order. `note` = the registry note or `null`.
- `deskCatalogBlock(tier)`: for the current desk, one line per module —
  `- <feature> (<bucket>) — <rows> rows` plus ` · <note>` when present, or
  `— no rows loaded` for empty packs and unpacked modules; then the other
  desks as `<tab>: <feature>, <feature>, …`. Without a tier: every desk in
  the short form.
- `resolveFeature(tier, name)`: exact, then lower-cased and
  whitespace/dash-normalised match within the tier.
- Staleness test (Vitest): `buildDeskCatalog(...)` from the live
  `catalog.js` deep-equals the committed JSON's `entries`. **Vacuity:**
  delete one entry from the JSON → fails by name.
- Deno tests: every entry's `tier` is in the §C enum; the block for
  `national` names all 12 national modules and no other desk's module in
  long form; `resolveFeature('national', 'bill passage probability index')`
  hits.
- `DESK_GROUNDING_RULES`: §E verbatim; the test asserts the five rules'
  key phrases are present ("quoting TOTAL", "Selected record", "search_documents",
  "snapshot", "Never print a row_key").
- `selectedRecordBlock(...)` (§F): the test asserts the handle, feature,
  tier and record text all appear and the block starts with
  `Selected record`.

### Task 4 — Migration and loader; load and verify live

**Write:** `supabase/migrations/20260921000011_desk_rows_search.sql`,
`scripts/load-desk-rows.mjs`.

- Apply the migration to `NTER`; `notify pgrst, 'reload schema'`.
- Loader (under `vite-node`): `installDiskFetch('public')`, then for each
  of `loadableModules()` (optionally one `--tier` / `--feature`)
  `deskRowsFor` → batches of 500 through
  `.from('desk_rows').upsert(rows, { onConflict: 'tier,feature,row_key' })`
  with the secret key; then prunes that module's rows with
  `loaded_at < run_started_at`. `--dry-run` prints the per-module table
  and writes nothing. Collisions are printed (bills 2, MP profiles 2).
- Run `--dry-run`, then live, then live again (idempotence).

**Evidence (SQL, recorded below):**

- `select feature, count(*) from desk_rows group by 1 order by 2 desc` —
  Bill Passage = Policy Intelligence Graph = 9,817; questions 8,000;
  booths 1,731 ×2; NCLT 434; total 34,184 over 34 modules.
- Second run: identical counts; no row's `loaded_at` older than the second
  run.
- `count(*) where document_key is not null` = 2 × 5,418 minus collisions;
  `count(distinct document_key)` ≈ 5,000; rows whose key resolves to a
  `documents` row (`join documents on metadata->>'document_key'`) —
  recorded (bounded by the ≈ 1,620 bill documents that carry a key).
- `search_desk_rows('national','Bill Passage Probability Index',null,'{"house":"Lok Sabha"}',20)`
  → 20 rows, `total` = the direct `count(*)` (6,522 minus collisions).
- `p_limit = 500` → 50 rows. `p_query = 'co-operative'` → `total` > 0 and
  `explain analyze` time recorded (Decision 7).
- Under a real user session (the `rag-live.ts` pattern): the RPC answers;
  under `anon`: refused.

### Task 5 — The tool executor

**Write:** `supabase/functions/_shared/tools/searchDeskRows.ts` + `_test.ts`.

- `SEARCH_DESK_ROWS_TOOL` exactly as §C. `executeSearchDeskRows(deps, args)`:
  validates `tier` against the enum; resolves `feature` through
  `resolveFeature` (unknown → returns `{ rows: [], total: 0, snapshot_at: null,
  error: 'Unknown module "…" on the <tier> desk. Modules: …' }`, an added
  optional `error` field the loop renders verbatim); clamps `limit` to
  1–50 (default 20); passes `filters` as the `p_filters` object; slims
  `row` to 32 columns × 500 chars; `snapshot_at` = the newest row's.
- `renderDeskRows(result, handles)`: `${handle} | ${feature} | ${row_key}\n${record_text}`
  per row, then `TOTAL: ${total} rows match (snapshot ${snapshot_at}); showing ${n}`;
  `NO_RESULTS` on zero rows.
- Tests with a fake `rpc`: the injection payload
  `{ house: "'; drop table desk_rows; --" }` arrives as
  `args.p_filters.house` string; `limit: 500` → `p_limit: 50`;
  `limit: 0` → 1; a 40-column row is returned with 32; the unknown-feature
  message lists the tier's modules; `renderDeskRows` output format.
  **Vacuity:** remove the clamp → the limit test fails by name.

### Task 6 — Row viewer and "Open in desk"

**Write:** `src/ai/RowSource.jsx`, `src/ai/openRowSource.js`,
`src/ai/openRowSource.test.js`, `src/ai/RowSource.test.jsx`;
**modify:** `src/shell/TerminalShell.jsx` (one effect).

- `RowSource`: renders `RecordDetail` with `row = citation.row_snapshot`,
  `feed = { feature: citation.feature, tier: citation.tier, rows: [] }`,
  `onClear = onClose`; above it a bar with the module name, an
  **Open in desk** button, and, when `snapshot_at` is set, "as captured on
  <date>"; when `snapshot_at` is null (the injected selection) the button
  is hidden (the row is already selected on the desk).
- `openInDesk(citation)`: `resolveDeskRoute(citation.tier, citation.feature)`,
  `writeDeskHash`, `window.dispatchEvent(new PopStateEvent('popstate'))`,
  and stores `{ tab, feature, row_key }` in module state.
- `TerminalShell`: an effect on `[feed, tab]` calls
  `takePendingDeskRow(feed, tab)`; a hit → `setSelected(row)`. Nothing else.
- Tests: `openRowSource.test.js` — `takePendingDeskRow` returns the feed
  row whose `rowPinKey` equals the pending key and clears it; a feed
  without the key returns `null` and clears it; a different tab leaves it
  pending. `RowSource.test.jsx` (react-dom/server, as
  `SourceComponents.test.jsx`) — the snapshot's title and columns render;
  the captured-on date shows for a dated citation and not for a null one.
- Browser check (dev server, signed in): a hand-built `row` citation
  opens the viewer; "Open in desk" lands on the Bill Passage desk with the
  row selected in the right rail.

### Task 7 — Close

Verification record filled; plan → Historical; spec § "Plan amendments"
already carries the decisions above; coordination.md shared knowledge
gains the `desk_rows` facts (row counts, loader command, catalogue
regeneration command); merge to `main`; push only when the owner names
it.

## Risks

| Risk | Mitigation |
|---|---|
| A desk shows rows built differently from its pack, so a cited row's key does not select on the desk | Task 2 measures it per module; the viewer keeps the snapshot with its date (§G); geo-pack modules are the known case |
| `rowPinKey` collisions (two rows, one key) | printed by the loader; bills have 2; the last row wins and the count is recorded |
| The catalogue drifts from `catalog.js` | Vitest staleness test on every `npm test` |
| A model passes a filter value with different casing | documented in the tool description ("Exact column = value"); free text goes through `query` (`ilike`) |
| Upsert throughput | 500-row batches, ~70 requests, service-role timeout 300 s (migration 0010) |

## Verification record

Executed 2026-09-21 in a worktree on `task/desk-row-grounding` (the main
checkout was running the corpus ingest). Observed, not inferred.

| # | Check | Result |
|---|---|---|
| 0 | Baseline in the worktree | Vitest 29/29, Deno 72/72, build with the chunk-size warning (`.env.local` copied in: the dev auth plugin validates it at config load) |
| 1 | Fixture parity, both runners | 12 rows (4 bills, 3 SC orders, 3 commodities, 2 questions); Vitest 8/8, Deno 5/5. Vacuity: one tampered `row_key` → both runners fail on that row |
| 1 | Bill keys | title year wins over introduction year (`bill:2025:LXXII` for a 2025 amendment introduced 2026); trailing full stop accepted; every one of 9,819 rows keyed; one 1972 number carries a source space (`XXX II`) |
| 2 | Pack-based survival probe (superseded) | desk reproduces pack keys for 10 of 32 packed modules; 0 % for 22 → loader switched to the desk pipeline |
| 2 | Feed guard over 75 modules | 34 with rows, 34,184 rows, collisions 6 (bills 2 ×2, MP profiles 2); every stored row re-keys from its slim form (34,184 checks); registers exact. Vacuity: bills 9,817 → 9,818 fails by name. Removing the hash fallback does not fail it (checklist ids) — noted in Task 2 |
| 2 | `installDiskFetch` | relative `/data/…` from disk; absolute URLs 404 (the first version passed them through and ISL Tracker fetched live rows, changing its count — removed) |
| 3 | Catalogue | 75 entries, 34 with rows; bills carry the registry note; national block lists all 12 national modules in long form and other desks by name; `resolveFeature` exact / case / dash-insensitive; Deno 4/4, staleness test green |
| 4 | Migration 0011 | applied via the management API (`row` had to be quoted in `returns table`); history entry renamed from the API's timestamp to `20260921000011` to match the file |
| 4 | Loader, first attempt | reported 34,184 upserts twice, table stayed empty: the Supabase client used the swapped global `fetch` and the stub's empty 404s were not surfaced as errors. Fixed: client gets the real fetch, per-batch exact counts checked |
| 4 | Loader, live ×2 (07:27, 07:29 UTC) | 34,184 upserted each run, 0 pruned; `pg_stat`: 34,184 inserts then 34,184 updates; all rows from one `loaded_at` |
| 4 | Counts | Bill Passage 9,817 = Policy Intelligence Graph 9,817; questions 8,000; booths 1,731 ×2; MP profiles 780; affidavits 483; NCLT 434; SC orders 220 ×2; total 34,184 / 34 modules |
| 4 | Document keys | 19,634 keyed rows, 9,415 distinct; 741 bill rows resolved to an ingested document while the bill ingest was still running, **1,272 once it finished** (the ceiling is the 1,619 documents that carry a key). That is the live link: open a bill row, ask what it says, and the turn's first document search is scoped to that bill's text |
| 4 | RPC | Lok Sabha filter: 20 rows, `total` 6,521 = direct count; `p_limit 500` → 50 rows; `'; drop table desk_rows; --` as a filter value → 0 rows, table intact; free text `co-operative` → 49; `delimitation` + Lok Sabha → 11, first `bill:2005:14` |
| 4 | Query cost | `ilike` over 34,184 rows: sequential scan, 318 ms (Decision 7 stands; cut two indexes) |
| 4 | Sessions | throw-away confirmed user: 3 rows, total 11, dated snapshot, direct table count 9,817; anon: `permission denied for function search_desk_rows`; user deleted |
| 4 | Database outage | at ~07:24 UTC, with two ingest shards and the loader active, PostgREST answered 503 / "Could not query the database for the schema cache" for several minutes; the shards were stopped (108 documents errored, 5 requests failed — all re-indexed by the re-run since none was marked indexed), the loader ran alone, then the shards were restarted at 07:33. Project status stayed `ACTIVE_HEALTHY`; cause not established — recorded as a limitation of running bulk loads concurrently |
| 5 | Executor | Deno 7/7: fixed declaration; injection payload arrives as a string in `p_filters`; limit 500 → 50, 0 → 1, default 20; unknown module → error text listing the desk; 40-column row → 32 × 500; RPC failure throws; renderer format |
| 6 | Viewer and hand-off, unit | Vitest: `openRowSource` 4/4 (route + pending; match by desk key and clear; missing row → null and clear; other desk or module → stays pending); `RowSource` 3/3 (snapshot renders through `RecordDetail`, captured-on date and Open in desk shown, both hidden for the injected selection, nothing for a text citation) |
| 6 | Browser (worktree dev server on 5174, the app's built-in demo seat set through its own `setSessionUser`, no credential typed) | From the Global desk, `openInDesk` for the first bill: hash → `#/national/Bill%20Passage%20Probability%20Index`, request pending until the feed landed, then consumed; the bill's row highlighted in the table (`tr.on`) and the rail showing its record; no console errors. `RowSource` itself has no mount yet (the agent module's Work-mode surface mounts it) |
| all | Suites at close | Vitest 54/54 (14 files), Deno 88/88, build with the two baseline warnings |

## Known limitations and follow-ups

- **Snapshots, not live rows.** `desk_rows` mirrors the packs as shipped on
  2026-09-21; the loader is re-run by hand (`npx vite-node --config
  vitest.config.js scripts/load-desk-rows.mjs`). 41 catalogue modules show
  nothing today and load nothing; the catalogue says "no rows loaded".
- **Bill keys resolve for 741 rows now**, bounded by how many bill documents
  the corpus ingest has indexed with a key; the number rises as the ingest
  completes and needs no reload (the join is on the document side).
- **Free-text search is a sequential `ilike`** (318 ms over 34 k rows). Cut
  two's curated views replace it.
- **The Vite dev server warns** that `public/data/embedded_csv/_manifest.json`
  is imported from JavaScript; `archiveFeed.js` has done so since before this
  module and `deskRowsFeed.js` (Node only) does the same. Not user-visible.
- **Bulk writes and the embedding ingest should not run at once** on this
  instance: PostgREST went unavailable for several minutes while both ran.
- **Not mounted:** `RowSource` waits for the agent module's viewer;
  `SEARCH_DESK_ROWS_TOOL`, `DESK_GROUNDING_RULES`, `deskCatalogBlock` and
  `selectedRecordBlock` wait for its prompt and loop.
