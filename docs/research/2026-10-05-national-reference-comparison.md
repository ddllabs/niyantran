# National landing: reference fidelity comparison

> **Status: Historical (2026-10-05).** Read-only UI/code comparison requested by the owner. F81 remains open. No product source changes in this inspection.

## Inputs and evidence

Confirmed reference: `/Users/vighneshshukla/Downloads/nter-desk-landing-v2.html` (1,063 lines). Current: `src/desks/NationalLandingView.jsx`, `nationalLanding.css`, `NationalLandingArtwork.jsx`, `nationalLandingArtwork.css`, and actual component local preview. Also identified `/Users/vighneshshukla/Downloads/niyantran-v2 (2).html` and `Niyantran/niyantran_v3.html`; neither filename identifies the owner's separately mentioned NTER-S-V22 shell. A recursive filename search found no `*v22*` or exact `Niyantran.html` in Downloads. Exact vertical-tab reference remains unresolved; owner clarification requested.

The confirmed landing reference contains a horizontal National/Global/Law switch, not National/Global/State vertical navigation. Its currently rendered National page has 17 modules, whereas the current production catalog has 12. Earlier approximate reference inventory is not the acceptance inventory: use the currently rendered 17-entry reference plus canonical production catalog. Unsupported entries and static claims remain excluded.

Browser: loaded the original HTML unchanged from an ignored local copy, alongside the current component, at 1,440 × 977. Reference card interaction measured `matrix3d` transform (including -4 px lift), 26 px radius and blue-tinted lift shadow. Current card measured transform none, shadow none, 16 px radius. Screenshot evidence saved under the task visualization directory: `national-reference-comparison.jpg`, `national-reference-hover.jpg`, `national-current-comparison.jpg`. These screenshots are component/reference views, not proof of authenticated shell integration.

## Findings

| Current implementation (before) | Required reference-equivalent behavior (after) | Evidence / consequence |
| --- | --- | --- |
| Flat static group cards, 16 px radius, no shadow | 26 px glass cards, layered resting/lift shadows; pointer-relative tilt and lift | Reference CSS 129–138, JS 1009–1021; browser confirmed transform/shadow. This is a major fidelity gap. |
| Static illustrations, no illustration zoom | Preserve the original tile SVG composition and its distinct animation: chamber sweep, ballot slip, representative meters, sun, finance details; hover scale 1.06 | CSS 235–276 and original tile functions. Current artwork is redrawn and different. |
| Plain link text turns blue | Rounded tinted module-row highlight and equivalent floating column-chip preview on hover/focus/touch | CSS 153–179. Current inline native disclosure is accessible but visually different. Keep reliable explicit disclosure too. |
| Four neutral stat cells | Preserve glass stat-band geometry, semantic color accents and a mode-distribution donut using actual stored/feed-backed/curated/unknown states | CSS 93–109. Live/planned labels cannot be copied as truth. |
| No group row totals or row magnitude tracks | Real, shared-resource-aware group totals, mode counts, compact notes and row tracks with a stated logarithmic scale | Reference segments/moduleRow, 836–869. Counts can stay exact while decorative tracks reveal. Unknown/zero remain distinct. |
| Dropdown source selector | Segmented pills with counts and moving active indicator, mapped to actual source modes | CSS 113–127 and moveThumb. Dropdown removed a visible reference interaction. |
| Search removes nonmatches entirely, no match highlight | Reference-style matching emphasis and dimmed context; dimmed modules must also be noninteractive and removed from keyboard focus | applyFilter 998–1006. Faithful effect needs accessibility correction rather than copying pointer-events alone. |
| Contained/faded smaller Parliament, shorter hero, rewritten typography | Original Parliament SVG geometry, broad background placement, pastel sky/ground/veil, original hero proportions and rhythm | Reference background 36–47, hero 77–92 and parliament 483 onward. Exact truthful headline/source copy remains separate. |
| Single 240 ms hero entrance; everything else appears static | Reference word/lede/source/stat/card entrance hierarchy and lower-band reveal; bounded motion respects reduced motion and never delays real data/navigation | Reference 85–93, 131–135 and animate 978 onward. Previous spec explicitly simplified this, contrary to owner's current fidelity requirement. |
| Static 5 px chart bars and numeric shortcut markers | Reference chart grid, 12 px gradient bars, lower-card geometry, icon tiles and directional shortcut feedback | Reference 185–223. Real sector values and truthful chart title must be retained. |
| Standalone component preview; no desk switch | Shared desktop shell with owner-specified vertical National/Global/State tabs, URL-aware active state and preserved auth/module routing | Not in the confirmed landing HTML. Shell visual specification requires the missing reference. Existing right-side Desk/Record/AI panel tabs are a separate control. |

## Fidelity contract and next work

Verdict: **Block visual acceptance of this adaptation.** Data shaping/API/tests are useful completed foundation; they do not establish visual parity. Previous verification correctly left owner visual acceptance pending but understated how many reference interactions were omitted.

Retain the established canonical routes, prepared-feed counts, current adapters, loading/error/empty semantics and coverage limitations. Replace the presentation with direct reference asset/token/geometry/interaction mappings. Preserve real-count numerals rather than showing synthetic intermediate count-up values; animate decorative tracks only. Source-mode colors indicate coverage class, not freshness certification. Unsupported/planned modules, fabricated dates, attendance/utilisation/completion claims remain excluded.

Before implementation, amend F81 spec/plan to require reference fidelity, including exact reference-to-component mapping and a motion matrix (trigger, target, duration/easing, hover/focus/touch, reduced motion, hidden/offscreen pause). Review the exact shell reference before changing global navigation. Use a live-data shared shell preview; the standalone module-selection banner is not sufficient acceptance evidence. Compare resting, hover, focus, search/filter and switching states at matched desktop/phone widths. National parity is the gate before reusing the presentation for Global/State. No production source or deployment changes made in this inspection.
