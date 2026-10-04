# Global landing verification

> **Status: Historical (2026-10-05).** Executed local evidence on `task/global-landing-redesign`, based on National checkpoint `49aef80`. This is not owner acceptance or production deployment.

## Implementation and source audit

Global replaces its generic landing with the supplied Global reference composition: dot globe, five vector tiles, shared National glass cards, tilt/lift and tile loops, segmented source controls, coverage disclosures, schematic source-coordinate map and three canonical shortcuts. Existing catalog grouping and all 16 workspace routes remain intact. Source summaries load independently with three workers, abort/deadline handling and per-module retry; no new dependency or data collection edits.

Read-only local feature-feed audit executed for all 16 modules. Global Commodities explicitly contains illustrative prices, so its count is unknown and its limitation visible. Energy counts curated mineral references and excludes illustrative prices. Satellite Infrastructure returns upcoming launches; the landing calls it Upcoming launches and exposes Launch/Provider/Launchpad/Scheduled launch fields. Observation years remain separate from source dates. No mock counts, prices or coordinates were added.

Read-only GET execution against every `/api/global-landing` endpoint returned200. Maximum observed summary size was 12,881 bytes (Nuclear Watch); all observed payloads were below 30 KB. Nuclear Watch supplied 112 coordinate records and Maritime Choke-Points 18, with original precision qualifiers. The map plots these 130 supplied locations and discloses schematic/approximate coverage. Counts vary with retrieval: news was 22 during the UI check and 34 during a later API check. Counts are not hardcoded, and the aggregate explicitly represents heterogeneous register entries rather than unique entities or completeness.

## Executed verification

- `npm test`: 143 files, 2,137 tests passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 862 passed, 0 failed.
- `npm run lint`: passed with 0 warnings.
- `npm run build`: passed. Existing mixed static/dynamic deskBrief import and large-chunk warnings remain.
- `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`: passed.
- Focused projection/API/loader/Global/National/dispatcher checks passed. Defect-injection checks failed when illustrative benchmarks were counted or invalid coordinates admitted; restoring the implementation passed. A separate defect run without the launch-field override failed its semantic field-label test, then passed after restoration.
- Signed-in in-app browser: clicked all 16 canonical module buttons, verified each workspace URL/title and Back to Global. This proves routing, not full correctness of each existing workspace or its upstream feed.
- Search for nuclear left only Nuclear Watch active and 15 rows inert; Curated left only Energy active. Restored All/empty search. Coverage opened actual launch fields; Escape closed it and returned focus to the module button.
- Manual motion pause stopped the canvas and radar loop; resume restored motion. Scrolling the backdrop offscreen stopped the canvas. Re-entering the hero resumed it.
- Explicit 360/768/1440 browser widths had matching viewport/document widths; phone card width 328 at 360. Overrides reset. Light/dark rendered; original light theme restored. Hindi desk label rendered and English restored.
- National regression: actual signed-in landing rendered 12 canonical modules and 11/11 source resources. Existing National component tests passed. No Global console errors were captured in the inspected log.

## Review and remaining gates

Supervisor reviewed projection, request orchestration, API handlers, component integration and motion cleanup for correctness, security, scope and performance. Fixed canonical whitelist and tier, encoded query arguments, safe HTTP(S) source links, React text rendering, bounded coordinate count/field lengths and cancellation keep this within the existing architecture. National data shaping, auth, billing, homepage globe, workspace tables and State/Law were deliberately untouched. No new packages or secrets.

Native reduced-motion, hidden-tab and coarse-pointer/touch execution remain unverified. The code handles those states, but reading it is not execution evidence. Owner visual acceptance remains pending; do not claim exact experience accepted or mark F82 Done. Local changes only: no push, deployment, PR or main merge.
