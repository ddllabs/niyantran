# Login globe and compact desk headers

> **Status: Living.** Owner approved scope on 2026-10-07; implement on task/login-globe-compact-desks, never main.

## Current state and problem
Login uses a flat spinning globe PNG and a second baked globe background. National/Global/Law share a 522px hero matching the reference HTML, but application navigation and a three-row statistics layout consume the viewport. Native browser inspection at 948px confirms cards almost below the fold.

## Outcome and acceptance
Reuse homepage NterEarth runtime on login with identical orientation/spin, poster fallback, reduced-motion and pause lifecycle. Keep accessible pause control outside decorative artwork. Place form and Earth side by side on wide screens; smaller subdued Earth behind the centered form on narrow screens. Preserve all authentication handlers and other auth pages.
Compact shared desk hero to 400px minimum on desktop, 52px heading and 22px top padding. At intermediate widths retain four summary cells in two rows with compact donut row; below 720px use natural hero height. Preserve all fourteen reference illustrations, card animation, source provenance and functional controls. Verify 320/768/948/1440 widths, login pause/resume, all three desks, no new horizontal overflow, and more card content above the fold.

## Scope and exclusions
Write scope: LoginPage.jsx, marketing.css, nationalLanding.css, this spec, matching plan, open-work.md. No auth logic, data, remote publishing, other auth pages, or unrelated marketing overflow repairs.
