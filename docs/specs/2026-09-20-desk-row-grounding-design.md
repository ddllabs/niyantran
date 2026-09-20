# Desk-row grounding — Design

**Date:** 2026-09-20
**Module id:** `desk-row-grounding`
> **Status:** Normative — an open design, binding on its implementation plan.
> Becomes Historical (dated) when the plan is executed and verified.

**Origin:** The assistant answers questions about a desk from at most eight
rows, and its prompt tells it those rows are the record
(`docs/research/2026-09-20-ai-path-audit.md` §2). The Bill Passage desk has
9,819 rows. There is no tool the model can call. The owner chose option C:
do not block the RAG launch on moving desk data into Postgres, but do not
ship a tabular path known to be wrong either — fix the tool contract now
with a cheap implementation, and reimplement it as an SQL agent over curated
views in a later cut without changing the agent.

## Decisions

Recorded from the owner's answers, 2026-09-20:

1. **Rows are not embedded.** Tabular questions are answered by a tool that
   filters and counts, not by vector similarity.
2. **Both grounding paths coexist.** Documents through `search_documents`;
   rows through `search_desk_rows`; the model chooses per question.
3. **The selected row stays injected.** The user clicked it; it is already
   on screen; it is the authoritative record for questions about itself.
4. **The tool contract is fixed now** and survives the cut-two
   reimplementation unchanged.

Supervisor's recommendation, for the owner's approval (Open question 1):
**the JSON is staged into one generic Postgres table**, `desk_rows`, rather
than fetched from the deployed site by the edge function. Rationale in §A.

## What the owner receives

Ask "how many bills are pending in the Lok Sabha" on the Bill Passage desk
and the assistant calls a tool, gets a true count and the matching rows, and
answers "**412** bills, showing the first 20" with each cited row opening the
same record detail the desk itself opens. Ask about the row you clicked and
it answers from that row without a search. Ask what a bill *says* and it
searches the documents instead.

**Named limitation:** the tool reads a **snapshot** of the desk data loaded
from the same JSON files the terminal ships, dated at load time. The live
desk may have refreshed since. Every tool result carries `snapshot_at`, the
prompt requires the assistant to say so when it matters, and the loader is
re-runnable. A refresh pipeline is cut two.

## Design

### A. Where the rows live

`public.desk_rows (tier, feature, row_key, row jsonb, record_text, snapshot_at,
loaded_at)` — declared in the foundation schema — loaded by
`scripts/load-desk-rows.mjs` from `public/data/embedded_csv/*.json` (module
names from `_manifest.json` and `src/data/html-feature-map.json`), upserting
on `(tier, feature, row_key)`. Idempotent; reports counts per module.
Service role key from the environment; never from a browser.

`row_key` is computed by `rowPinKey()` — the frontend's own stable row
identity in `src/lib/sourceUrls.js:209-225` — ported to
`supabase/functions/_shared/deskRows.ts` and held identical by a parity
test over fixture rows. `record_text` is `rowRecordText()` from the same
file, likewise ported, so the model sees rows in the exact shape it sees
them today.

**Why a table and not a fetch.** The alternative — the edge function
fetching `https://<app>/data/embedded_csv/<file>.json` — needs no schema.
Rejected: the biggest file is 9,819 rows, fetched and parsed on every cold
isolate; counts and filters would be JavaScript scans over the whole array
per call; and correctness would depend on which frontend build is deployed.
A generic `jsonb` table gives indexed filters, a real `count(*)`, one load
step, and is the natural substrate for the cut-two curated views — which can
be views over this table. It is a staging of the same JSON, not the cut-two
migration: no per-module schema, no SQL agent, the model never writes SQL.

### B. The RPC

```sql
create or replace function public.search_desk_rows(
  p_tier text, p_feature text default null, p_query text default null,
  p_filters jsonb default '{}', p_limit int default 20
) returns table (
  tier text, feature text, row_key text, row jsonb, snapshot_at timestamptz, total bigint
) language sql stable security invoker set search_path = public as $$
  with matched as (
    select r.* from public.desk_rows r
    where r.tier = p_tier
      and (p_feature is null or r.feature = p_feature)
      and (p_query is null or r.record_text ilike '%' || p_query || '%')
      and (p_filters = '{}'::jsonb or r.row @> p_filters)
  )
  select m.tier, m.feature, m.row_key, m.row, m.snapshot_at, count(*) over () as total
  from matched m
  order by m.feature, m.row_key
  limit least(greatest(p_limit, 1), 50)
$$;
```

`p_filters` is a JSON object of `column: value` pairs applied with the
containment operator, so a value is never interpolated into SQL. `p_query`
is a parameter, never concatenated by the caller. The `gin (row
jsonb_path_ops)` index serves `@>`. `total` is the true count before the
limit.

### C. The `search_desk_rows` tool — fixed interface

Consumed by `streaming-research-agent` exactly as declared here.

```ts
// supabase/functions/_shared/tools/searchDeskRows.ts
export const SEARCH_DESK_ROWS_TOOL = {
  type: 'function',
  function: {
    name: 'search_desk_rows',
    description:
      'Look up rows in a terminal desk module and get the true total. Use for counts, lists, filters and comparisons across rows. Not for what a document says — use search_documents for that.',
    parameters: {
      type: 'object',
      properties: {
        tier:    { type: 'string', enum: ['global', 'national', 'state', 'law', 'economics', 'carbon', 'sports', 'entertainment'] },
        feature: { type: 'string', description: 'Module name from the catalogue, e.g. "Bill Passage Probability Index". Omit to search every module in the tier.' },
        query:   { type: 'string', description: 'Free text matched against every column.' },
        filters: { type: 'object', additionalProperties: { type: 'string' }, description: 'Exact column = value conditions.' },
        limit:   { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['tier'],
      additionalProperties: false,
    },
  },
} as const;

export interface DeskRow {
  tier: string; feature: string; row_key: string;
  row: Record<string, string>;          // slim: ≤ 32 columns, each ≤ 500 chars
  record_text: string; snapshot_at: string;
}
export interface DeskRowsResult { rows: DeskRow[]; total: number; snapshot_at: string | null }

export async function executeSearchDeskRows(
  deps: { rpc(fn: 'search_desk_rows', args: Record<string, unknown>): Promise<{ data: unknown[] | null; error: { message: string } | null }> },
  args: { tier: string; feature?: string; query?: string; filters?: Record<string, string>; limit?: number },
): Promise<DeskRowsResult>;
```

The executor returns structured rows. The agent loop labels each with a
handle and renders
`${handle} | ${feature} | ${row_key}\n${record_text}` per row, followed by
`TOTAL: ${total} rows match (snapshot ${snapshot_at}); showing ${rows.length}`.
On zero rows: `NO_RESULTS`.

### D. The module catalogue

The model must know which module to name. `scripts/build-desk-catalog.mjs`
generates `supabase/functions/_shared/deskCatalog.json` from
`src/desks/catalog.js` (`DESK_FEATURES`) and `src/data/html-feature-map.json`:
one line per module — `tier`, `feature`, `bucket`, and the registry note
when present. About ninety entries; small enough to sit in the prompt's
dynamic block for the current desk, with the other desks listed by name
only. The agent's prompt owner (`streaming-research-agent`) includes it
through a fixed export `deskCatalogBlock(tier?: string): string` from
`_shared/deskCatalog.ts`. A parity test fails when the generated file is
stale relative to `catalog.js`.

### E. Grounding rules — fixed text, consumed by the prompt

`_shared/deskGroundingRules.ts` exports `DESK_GROUNDING_RULES: string`:

- A question that asks *how many*, *which*, *list*, *compare* across a desk
  is answered by calling `search_desk_rows` and quoting `TOTAL`. Never
  estimate a count from the rows shown.
- The **selected record** (when present) is already in context with its own
  handle; answer questions about it directly and cite it. Do not search for
  it.
- Rows are the record for their **fields**; a document is the record for its
  **contents**. If a row carries a document URL and the question is about
  what that document says, call `search_documents`.
- When rows come from a snapshot older than the conversation's day, say so
  in one clause.
- Never print a `row_key`, a column's internal name, or a snapshot id in
  prose. Name the module and the record the way the desk labels them.

### F. Selected-row injection

Unchanged in substance from today: the request carries `selection` (the
`slimRow` shape from `AiPanel.jsx:103-118`, plus `tier` and `feature`). The
agent loop assigns it a handle **before** the first model call and injects it
as a `Selected record` block. It is therefore citable like any tool result
and resolves to a `row` citation. This spec owns the block's text; the loop
that places it belongs to `streaming-research-agent`.

### G. The `row` citation — fixed interface

```ts
// the `row` variant of CitationSource. The file src/types/citation.js is owned
// by document-rag-and-citations §H, which reproduces this declaration verbatim.
| { id: number; kind: 'row';
    tier: string; feature: string; row_key: string; title: string;
    row_snapshot: Record<string, string>;   // the slim row as cited
    snapshot_at: string | null }             // null for the injected selection
```

`src/ai/openRowSource.js` (new): clicking a `row` bubble opens
`src/shell/RecordDetail.jsx` with `row_snapshot` immediately (no fetch), and
offers **Open in desk**, which routes through `src/lib/deskRoute.js` to the
module and selects the row by `row_key` if the loaded feed contains it. If it
does not, the snapshot stays open with "as captured on <snapshot_at>". The
exact `RecordDetail` props are read in the plan; this spec fixes the
behaviour.

### H. Testing and verification

Deno, no network:

- `row_key` and `record_text` parity with the frontend on a fixture of rows
  from three modules (bills, court orders, commodities).
- The executor clamps `limit` to 50 and passes `filters` as a JSON parameter
  — a value of `'; drop table desk_rows; --` arrives at the RPC as a string
  literal inside `p_filters`.
- Catalogue staleness test.

Executed against the live project after `load-desk-rows`:

- Loader twice → identical row counts; `select count(*) from desk_rows where
  feature = 'Bill Passage Probability Index'` = 9,819.
- `search_desk_rows('national', 'Bill Passage Probability Index', null,
  '{"house":"Lok Sabha"}', 20)` returns 20 rows and a `total` equal to the
  same count computed directly.
- `search_desk_rows` with `p_limit = 500` returns 50.

Vitest:

- A `row` source opens `RecordDetail` with the snapshot; an unresolvable key
  shows the snapshot with the date.

**Vacuity:** remove `least(…, 50)` — the clamp test fails by name; delete
one module from the generated catalogue — the staleness test fails.

### I. Commands

```bash
node scripts/build-desk-catalog.mjs                   # regenerate the catalogue
node scripts/load-desk-rows.mjs --dry-run
node scripts/load-desk-rows.mjs                       # requires SUPABASE_SERVICE_ROLE_KEY
deno test supabase/functions
psql "$DB_URL" -c "select feature, count(*) from desk_rows group by 1 order by 2 desc limit 10"
```

## Write scope

`supabase/functions/_shared/{deskRows,deskCatalog,deskGroundingRules}.ts` and
tests, `supabase/functions/_shared/tools/searchDeskRows.ts`,
`supabase/functions/_shared/deskCatalog.json` (generated),
`supabase/migrations/*search_desk_rows*`, `scripts/load-desk-rows.mjs`,
`scripts/build-desk-catalog.mjs`, `src/ai/openRowSource.js`.

`src/types/citation.js` is **not** in this scope: the `row` variant (§G) is
declared verbatim in `document-rag-and-citations` §H, which owns the file.
The two modules run concurrently; this one consumes the type and never
edits it.

**Not touched:** `AiPanel.jsx`, `aiDrop.js`, `sourceUrls.js` (read; ported,
not edited), `catalog.js` (read; generated from), `RecordDetail.jsx` (used,
not edited unless the plan finds a prop is missing — then ask first), the
desks, the legacy path, `public/data/`.

## Boundaries

- **Always:** parameters, never interpolation; a true `total` on every
  result; `snapshot_at` on every result.
- **Ask first:** any edit to `RecordDetail.jsx`; any change to `rowPinKey`
  semantics (it would change every `row_key`); any deploy.
- **Never:** let the model author SQL in this cut; embed rows; read
  `public/data/` from the edge function.

## Accepted consequences

- The snapshot can lag the live desk. Stated in every result and in the
  prompt; fixed by the cut-two refresh pipeline.
- `ilike` over `record_text` is crude. It is bounded, indexed if `pg_trgm`
  is enabled (the plan decides), and replaced by curated views in cut two.
- Modules whose rows carry inconsistent column names across files (the
  audit did not survey all 74) filter less well. The catalogue's registry
  note helps the model; it does not fix the data.

## Out of scope

- Curated per-module views and an SQL-writing agent (cut two; see
  `docs/research/2026-09-20-tenderbase-reference-patterns.md` §16 for the
  guard pattern it will use).
- A refresh pipeline from live feeds into `desk_rows`.
- The `backup/*.xlsx` packs.
- Embedding rows or module descriptions.
