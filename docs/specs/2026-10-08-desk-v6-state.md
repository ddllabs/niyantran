# State desk v6 — proposed scope

> **Status: Living.** Owner approved State-only implementation with “go” on 2026-10-08; local candidate under verification.

## Outcome

Apply the reference State design to the production State landing using the existing shared v6 frame, exact supplied images and verified source summaries. Match the other seven desks' sector selection, All Sections dialog, module popups, motion, themes, accessibility and canonical terminal handoff. Reference numbers are not data requirements.

## Current state and evidence

Source inspection at `8f1e12e`, on `task/desk-v6-integration`:

- `DeskLandingView.jsx` dispatches seven specialized v6 landings; State still uses `StandardDeskLandingView`.
- `catalog.js` curates 14 State navigation entries across five legacy groups. It deliberately includes Local-tier booth and municipal modules. There is no separate Local navigation tab.
- The v6 reference inventory contains 35 State modules and 31 Local modules, currently excluded from the approved seven-desk catalogue. The State reference groups are Elections & Electoral Rolls; Government & Legislature; Public Finance & Operations; Districts & Development; District Media.
- `landing/deskImages.js` already records the State Vidhana Soudha hero and five reference section images. Use those existing assets, with byte parity checked against the supplied HTML before acceptance.
- `html-feature-map.json` maps Constituency Register to State, but Booth-level Results Database to Local. `featureFeed.js` can fall back to a same-name feature outside the requested tier; the State flagship currently requests that booth feature with tier State. The new mapping must preserve exact source identity rather than rely on this fallback.
- Mapping metadata and embedded row counts are not proof of currently working feeds. Read-only source probes and subsequent browser execution are recorded in the State source audit; source dates remain unknown unless explicitly supplied.

Remote references refreshed with `git fetch origin --prune`; `main...origin/main` comparison is `0 0`. This is not publication or acceptance of the local integration candidate.

## Owner-confirmed scope

On 2026-10-08 the owner confirmed: the actual website has no Local page, so transfer the reference State page only. Reuse its five sections and 35-module inventory as the presentation target. Do not introduce a separate Local page or import the reference Local page's 31-module catalogue.

Audit reference State names against existing-only State entries, aliases and canonical destinations. Preserve the existing MLA Directory, municipal and booth destinations rather than silently deleting them; their presentation placement must be explicit in the inventory. Existing Local-tier entries may remain accessible through State without creating a Local navigation tab. Keep their exact source tier and destination internally; presentation scope does not rename data identities or change entitlement rules.

## Data contract

Each module summary identifies canonical tier and feature, resource key, source mode, availability, measured count and unit, source URL, source date and limitations. Counts remain unknown on unavailable/error responses; empty verified sources may report zero. Do not add incompatible units or double-count shared sources. No invented live status, freshness or analytical scores.

A State/district selector is included only after proving that the actual sources support stable geographic keys and the approved scope defines its behavior. Otherwise disclose source coverage in the popup. Never label all-India data as selected-state coverage. Choose any chart only after inspecting actual fields; chart source records, not estimated election outcomes or fabricated demographics.

## Acceptance

1. Approved inventory and exact reference assets/groups have a documented parity checklist; departures are owner-approved and data-driven.
2. Every enabled terminal CTA opens the exact canonical module on first click, Back/reclick and reload; none falls through to Home or National. Existing Local destinations remain reachable.
3. Loading, empty, unavailable, error, partial coverage and retry states are truthful; filters reflect measured summaries rather than mock values.
4. Real signed-in access and controlled entitlement checks preserve current policy. Navigation expansion does not change the 75-entry grounding/ingestion inventory.
5. Responsive light/dark and English/Hindi-label views, keyboard dialog focus, 200% zoom, touch, reduced motion, hidden-tab behavior, hover/pan/stagger and Pause/Resume meet the existing shared-frame quality bar.
6. Focused regression tests, lint and build pass. Both test suites run if `src/lib/` changes; router import runs for server/API changes. Newly added guards first fail against the protected defect.

## Boundaries

Reuse React component and summary conventions from the completed v6 desks. Do not modify authentication, billing, database schemas, data collections, providers, AI ingestion or production configuration. No publication, branch deletion or main merge is authorized by this planning request. Source onboarding beyond working existing connections is separate scope.

Implementation sequence and file boundaries: [State plan](../plans/2026-10-08-desk-v6-state.md). Open work is tracked under F88 in `docs/plans/open-work.md`.

## Implementation record

The local implementation contains35 reference modules plus6 retained existing-only destinations in five reference sections. Summary cards report measured modules to avoid mixing incompatible units. Sources use the existing feature-feed/archive adapters; no server route, database or provider change was needed. See [executed source audit](../research/2026-10-08-state-source-audit.md).
