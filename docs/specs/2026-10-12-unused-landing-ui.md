# Remove obsolete landing UI

> **Status: Normative.** Owner-authorized on 2026-10-12; F93.

The eight current desk landings use the v6 frame, photos, presentations and motion hook. Import/export searches and an in-memory application bundle prove the old controls, artwork, motion and styles are outside the application dependency graph.

Remove exactly these files under `src/desks/`: `LegacyLandingControls.jsx`, `NationalLandingArtwork.jsx`, `nationalLandingArtwork.css`, `GlobalLandingArtwork.jsx`, `GlobalLandingArtwork.test.jsx`, `globalLandingGeometry.js`, `LawLandingArtwork.jsx`, `useNationalMotion.js`, `useNationalMotion.test.js`, `nationalLanding.css`, `globalLanding.css`, `lawLanding.css`.

Acceptance: unchanged production build output before/after removal; passing lint, application tests, Edge tests and asset verification; all eight real landing content components load and remain interactive in an isolated browser fixture; existing dirty corpus files remain byte-identical. No active UI, datasets, API, auth, billing, backend or production changes. Keep the generic landing fallback, current summary hooks, v6 code and active dark-mode styles. No push or deployment.
