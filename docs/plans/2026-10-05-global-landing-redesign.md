# Global landing implementation

> **Status: Living.** Local owner-authorized continuation. Branch `task/global-landing-redesign`, based on National checkpoint `49aef80`; no publication.

Spec: [Global](../specs/2026-10-05-global-landing-redesign.md). Tracker F82 in [open work](open-work.md). Sequential supervisor work; no delegates.

1. Audit all 16 existing feeds and reference assets; preserve current groups. Read-only API audit executed; commodity levels illustrative, Energy includes illustrative overlays, satellite feed is upcoming launches.
2. Projection/endpoint: `src/lib/globalLandingSummary.js` and test; `server/globalLandingSummary.mjs`; `src/lib/globalLandingApi.test.js`; route integrations `server/featureFeed.mjs`, `api/router.js`. Fixed summary fields as spec; feed shaping reused. No full rows.
3. Progressive hook: `src/desks/useGlobalLanding.js` and test. Three workers, abortable deadline, independent failures/retry. No National data changes.
4. Reference UI: `src/desks/GlobalLandingView.jsx` and test, `GlobalLandingArtwork.jsx`, `globalLanding.css`, `globalLandingGeometry.js`; export shared `ModuleRow`/`SourceControl` from `NationalLandingView.jsx` and dispatch in `DeskLandingView.jsx`; update the existing Global assertion in `src/lib/deskLanding.test.jsx`. Reuse National CSS and motion controller. Globe observes actual motion/offscreen state, handles resize and cleans up frames/observers. No new package.
5. Run red/green meaningful guards, focused checks then `npm test`, `deno test -A --config supabase/functions/deno.json supabase/functions`, `npm run lint`, `npm run build`, router import. Inspect actual signed-in Global and National regression; routes/search/disclosure/themes/responsive behavior. Record runtime limitations honestly; local coherent commit and show UI for review.

Known exclusions: existing illustrative workspace data remains outside this landing task; surface its limitation rather than silently treating it as measured. National native media/touch checks remain recorded separately.

Implementation and local verification completed. See [executed evidence](2026-10-05-global-landing-verification.md). Owner visual acceptance and native reduced-motion/hidden-tab/touch checks remain open in F82; no publication.

6. Fidelity continuation after owner “Continue”: correct reference gradients, SVG fill opacity, radar phases/fade envelope, ship bob/rotation and animated globe starting longitude in `src/desks/GlobalLandingArtwork.jsx` and `src/desks/globalLanding.css`. Preserve a static .6-radian orientation only for an initially reduced-motion render. Add `src/desks/GlobalLandingArtwork.test.jsx` for static frame, restriction transitions and cleanup. Verify native browser motion controls where automation permits; focused Global/National motion regressions, lint and build, then local commit. No data/API changes or publication.

Continuation evidence: [reference corrections and lifecycle checks](2026-10-05-global-fidelity-continuation.md). Native selector automation remained unsuccessful; the gate remains open.
