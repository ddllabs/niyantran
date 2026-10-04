# Global landing redesign

> **Status: Normative.** Local implementation authorized by “Continue with global”, 2026-10-05. Publication is excluded.

## Outcome and current evidence

Replace only Global's generic landing with the Global composition in `Downloads/nter-desk-landing-v2.html`: dot globe, radar/flags/satellite/mine/port illustrations, glass cards, reference hover/motion, segmented source controls, field disclosures, location map and shortcuts. Reuse the National visual system and existing shared rail. Preserve production catalog grouping, all 16 canonical callbacks, access checks and sibling views. The mockup's different grouping is decorative guidance, not a catalog migration.

Read-only local API execution found 88 fronts, 10 procurement programmes, 46 alliances, 18 sanctions programmes, 16 aid appeals, 10 infrastructure projects, 112 nuclear sites, 12 upcoming launches, 18 chokepoints, 188 constitutions, 20 growth economies, 22 news stories, 44 leaders, 20 trade economies and 14 mineral records. These are observations, never initial production counters. Global Commodities returns 24 benchmarks with explicitly illustrative prices; exclude it from measured totals and label coverage unavailable/illustrative. Energy's 14 mineral references may be counted as curated records, but illustrative price overlays must not enter the landing.

## Data contract

GET `/api/global-landing?feature=<canonical>` uses existing prepared feed shaping and environment-specific feed adapter. No rows, prices, invented source dates or mock coordinates in the summary. Return count/availability/sourceMode, populated columns, explicit source links/limitations, source date or period, and bounded coordinate records for nuclear sites/chokepoints only. Mark these as supplied approximate/schematic coordinates, not new risk scores. Summary budget 30 KB; maximum 3 simultaneous client requests, 45s per request, abort and per-module retry. Errors remain unknown, legitimate empty remains0. Aggregates represent heterogeneous register entries, not unique entities or completeness.

## Acceptance

- All16 routes, current five bucket groups, Back/shared rail and locks retain existing behavior.
- No fabricated/mock counts, market prices, completeness, live freshness or mock map pins. Disclose stored, curated, feed-backed and unknown coverage.
- Responsive360/768/1440, light/dark, Hindi label, keyboard/touch disclosures and inert filters.
- Reference asset geometry and motion; pause/reduced-motion/hidden/offscreen behavior and cleanup. Canvas static frame remains visible when motion is disabled.
- Data guards fail first for illustrative-as-real and invalid coordinates; bounded loading/cancellation tested. Focused/full Vitest, Deno, lint, build and router import required for lib/server changes.

## Scope

New Global projection/server/hook/artwork/view/tests/scoped CSS; shared row/source controls exported from National; Global dispatcher and local/Vercel router entries. No data collection edits, ingestion, homepage globe, module tables, auth, billing, State/Law redesign, main merge, push or deployment. National's outstanding native checks/visual acceptance remain F81.
