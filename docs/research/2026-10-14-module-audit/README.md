# Module audit, 2026-10-14

> **Status: Historical (dated 2026-10-14).** A measured record of every terminal module on that
> day. It is the baseline for the [module data repair spec](../../specs/2026-10-14-module-data-repair.md).

The owner asked for a complete module-by-module analysis after Cabinet Decisions showed one
listing. Five read-only auditors checked 123 modules on the 8 desks and the admin API status
screen. For each module they:

- requested it twice on production (`/api/feature-feed`, bypassing the edge cache), against the
  deployment of commit `11cc881`;
- pulled it locally with `serveFeatureFeed` and no time limit, and tested the upstream URLs;
- counted its shipped archive, the server's archive pass and its `backup/` workbook;
- read its git history.

Nothing was changed while auditing.

| File | What it holds |
|---|---|
| `report.html` | The owner's report: summary, cross-desk problems, a filterable table of all 123 modules. Also published as a private artifact. |
| `modules.json` | One compact record per module (desk, verdict, production rows, live rows, stored rows, backup rows, cause, fix, history). |
| `national.md`, `global.md`, `state-law.md`, `econ-carbon-sports-ent.md` | Per-desk tables and findings. |
| `api-status.md` | The admin API status screen: what it checks, its verdicts against production, and the "800 APIs" question. |

## Totals

| Verdict | Modules |
|---|---|
| Live and working | 44 |
| Live but often over the 4 s limit | 10 |
| Live source broken | 4 |
| Stored data only | 46 |
| Planned or never built | 19 |
