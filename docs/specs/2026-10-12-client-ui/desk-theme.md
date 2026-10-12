# Module: desk-theme

> **Status: Living.** Owner approved scope and implementation on 2026-10-12.

## Outcome

Global, National, State, Law, Economics, Carbon, Sports and Entertainment landing
pages share the existing terminal's cream/beige visual language. Signed-in Home's
intro/featured story and news areas use the same surface, border and text roles.
Improve hierarchy and graphics integration without rebuilding the V6 layouts.

## Scope and design contract

- Reuse cream #f8f5f0 canvas, warm #e4ddd4 borders, white/cream layered surfaces,
  dark #131313 / #3d3a36 text. Approved palette direction; final visual acceptance remains with the owner.
- Replace cool blue-gray landing surfaces and image fades. Coordinate hero text,
  statistic strips, picture cards, explorer, selector, active/hover/focus states,
  charts and loading/error states. Blue may remain as an intentional restrained
  action color matching the terminal; no blanket replacement of semantic colors.
- Preserve desk-specific photographs/illustrations and composition. Improve
  their crop, blending and balance where needed; no automatic image regeneration.
- Home/news work concerns appearance and spacing, not freshness, polling,
  external nter.news pages or fabricated article/record counts.
- Preserve dark mode with terminal dark surfaces; beige is the light theme.

## Candidate UI write scope

src/desks/landing/deskLandingV6.css, DeskLandingFrame.jsx; corresponding
src/desks/*LandingView.jsx and desk-specific CSS only where necessary;
src/desks/HomeDesk.jsx; src/index.css limited to Home/landing/theme rules;
colocated tests. Keep styling localized where it would otherwise alter workspaces.

## Acceptance

1. No abrupt cool-background transition between landing and workspace.
2. All eight desks retain their current hero, counts, 35 picture-card defaults
   and restored sector explorer with 120 module destinations.
3. Text contrast >=4.5:1; large text and meaningful controls >=3:1. Focus is
   visible, long titles fit, images do not obscure copy, and mobile has no
   unintended horizontal page overflow.
4. Dark mode, reduced motion and existing loading/source-coverage disclosures
   work. News empty/error states remain honest and readable.
5. Preview one desk plus Home first, obtain visual direction, then apply across
   the remaining seven. Use verification commands/matrix in index.md.
