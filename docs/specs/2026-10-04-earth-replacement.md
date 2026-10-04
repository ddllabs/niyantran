# Homepage Earth replacement

> **Status: Normative.** Owner authorized integration on a new branch after recoverable cleanup on 2026-10-04.

## Objective and current state
The marketing homepage rotates an opaque rectangular globe PNG with CSS. Its background image also contains a faint globe. Replace only this homepage artwork with the supplied NTER-Earth-Replacement Canvas spherical renderer: 48-second eastward rotation, 23.44-degree presentation tilt, transparent exterior, depth-aware orbit effects. The shared homepage must behave identically irrespective of account role.

## Outcome and boundaries
Keep homepage copy, CTAs, persona labels and brand geometry. Remove the baked globe background from this hero only and rebuild its geometry in CSS. Keep other pages and their existing assets unchanged. Adapt the supplied wrapper to React 19 JSX/Vite, with stable poster fallback for loading/error, a pause/resume control, and no runtime external requests or new dependency. Reduced motion, offscreen/hidden-tab pausing and disconnect cleanup must work. Do not modify auth, billing, data, APIs, provider configuration or deployment. Do not merge into main or push.

## Files and style
Source: src/marketing/NterEarth.jsx, HomePage.jsx and marketing.css; focused tests in src/marketing/NterEarth.test.jsx. Supplied self-contained script and poster under public/brand/earth/. Documentation under docs/specs/ and docs/plans/. Use existing JSX functions and CSS classes; keep loading logic colocated with its component.

## Geographic provenance
The supplied script embeds Natural Earth public-domain 1:110m land silhouettes; no political boundaries. Decorative city routes are not live data. Renderer and poster copied byte-for-byte from the owner-supplied folder.

## Acceptance and commands
Run npm test -- src/marketing/NterEarth.test.jsx, npm test, npm run lint, npm run build, and git diff --check. Verify actual homepage at 320, 768, 1024 and 1440px: artwork rendering, no old PNG/background globe, readable unchanged copy, usable persona buttons, no new horizontal overflow from the hero. Verify live globe advances while unpaused, pause/resume, offscreen and reduced-motion states, route-away disconnect/reconnect, and poster fallback. Record browser evidence separately from supplied QA. No standalone type-check or physical-device performance claim.
