# Client UI refinement: scope and acceptance contract

> **Status: Living.** Owner approved scope and implementation on 2026-10-12. Implemented locally; production remains unchanged.

## Objective and interpretation

Make the current Vercel application feel like one product from signup through
desk landing, module workspace and record inspection. The owner clarified that
the client's landing/theme comments concern the signed-in application, not the
outdated nter.pro homepage. Use https://niyantran-six.vercel.app as the runtime
reference and the existing cream terminal as the palette reference.

The approved capability map is below.
Each linked module defines its own observable acceptance criteria.

| Module | Responsibility | Dependency |
| --- | --- | --- |
| [desk-theme](desk-theme.md) | Eight landing pages and signed-in Home/news visual consistency | — |
| [signup-composition](signup-composition.md) | Visible, purposeful signup artwork and form composition | desk-theme palette contract |
| [desk-navigation](desk-navigation.md) | Top desk navigation everywhere; all-eight-desk access verification | desk-theme palette contract |
| [record-graph](record-graph.md) | Remove the current record linkage presentation | — |

Implementation order: desk-theme → signup-composition →
desk-navigation → record-graph → combined regression verification.
Work is sequential; no task delegation is authorized by this document.

## Current state and evidence

- Local main and origin/main were equal at 2a5be9c after a fresh fetch; clean
  checkout before this documentation task. Spec branch: task/client-ui-spec.
- Browser execution on 2026-10-12: owner signed in on Vercel; opened National,
  its Legislation & Policy picture card, selected the Kerala alteration-of-name
  bill, and expanded the Record panel. The visible graph is titled **What this
  bill connects to**, with Rebuild layout, link-strength legend, Links filters,
  and impact explanation controls. Its loaded state showed 2 nodes / 1 link.
  PDF and Source links and Ask AI remained visible. No AI request was submitted.
- Exact observed module URL:
  https://niyantran-six.vercel.app/#/national/Bill%20Passage%20Probability%20Index
  (record selection is state within this module, not a separately verified URL).
- Code inspection maps this graph to LinkageGraph in
  src/desks/BillRecordPane.jsx. It uses local record/analysis/ontology models,
  not a Neo4j connection. Do not call every underlying value fabricated.
- Live Home and Bill Passage use the left desk rail; National landing uses
  top desk tabs. No complete eight-desk runtime matrix was executed in this
  review; that is an implementation acceptance gate.
- src/index.css defines cream #f8f5f0, white panels, warm #e4ddd4 borders and
  neutral text. deskLandingV6.css overrides these with cool #f7f9fc and blue
  #315edd. Signup has background/globe artwork obscured by its central form.
- Public nter.pro and Vercel signup served different copy during the prior
  review. Domain/version reconciliation is outside this UI implementation.

## Stack, structure and conventions

React 19 / Vite 5, JavaScript JSX, CSS, colocated Vitest tests. Source owns UI;
docs/specs owns acceptance contracts; docs/plans/open-work.md tracks work.
Reuse existing components and semantic theme variables. Keep behavior handlers
and JSX conventions, for example:

```jsx
<button type="button" aria-current={active ? 'page' : undefined}
  onClick={() => onDesk(desk.id)}>{desk.label}</button>
```

Do not add a new theme engine, graph dependency or design library for this task.
The beige surfaces do not require every action or semantic status to become beige.
Retain distinguishable focus, selection and data-status colors with contrast.

## Verification contract

Run npm run lint, npm test, and npm run build. Focused tests must cover changed
components; prove new behavior regression guards fail against the old behavior.
If src/lib or src/admin is edited, also run:
deno test -A --config supabase/functions/deno.json supabase/functions.
No backend, SQL or API edits are part of this scope. There is no standalone
typecheck. A build pass does not prove runtime navigation works.

Browser matrix: 360, 768 and 1440 px; light/dark; keyboard focus; reduced motion;
eight desks; loading/empty/error/loaded states; picture defaults and all sibling
module destinations. Record screenshots and console/network outcomes without
using live writes as fixtures. Test signup submission with mocks/local fixtures,
not by creating production accounts. Inspect meaningful bundle/asset growth.

## Boundaries and concurrent backend work

- Always: preserve routes, module IDs, record facts, source provenance, PDF
  Download fix, authentication flow, free signed-in access and AI usage limits.
- Ask before widening scope: public marketing/pricing copy, paid-account logic,
  new artwork direction beyond approved preview, dependency or backend changes.
- Never: modify corpus/data collections, ingestion scripts, API/server code,
  Supabase functions/migrations, credentials, provider behavior, deploy config,
  domain routing or Neo4j integration under this task.
- Backend chat gets a separate branch **and checkout**. Branch names alone do
  not isolate two writers. Agree source interfaces and exclusive file scopes;
  this UI task must not edit src/lib merely to repair backend defects.
- No push or deployment is authorized. Current task ends at local implementation and verification; merge/release requires owner authorization.

## Review decisions

The owner approved these four boundaries and implementation. The public homepage
redesign is deferred by the signed-in scope interpretation.
Neo4j-driven graphs are a future backend/product scope, with no placeholder
replacement promised here.


## Executed acceptance evidence — 2026-10-12

- `npm test`: 186 files / 2,513 tests pass. New navigation/graph guards first
  failed against the old behavior (six failures), then the focused 29-test suite
  passed with the implementation.
- `npm run lint`: passes, zero warnings. `npm run build`: passes. Existing
  mixed static/dynamic deskBrief import and >500 kB chunk warnings remain.
- `node scripts/verify-desk-v6-assets.mjs`: passes; 41 byte-identical assets,
  40 named images, credits and nine visual configurations.
- `git diff --check`: passes. No standalone typecheck is defined. Deno/SQL/API
  gates are inapplicable because their source scopes were not changed.
- Local Chrome fixtures bundle actual UI components and isolate external calls.
  All eight desks retain 35 picture-card defaults and 120 sibling destinations;
  every destination was clicked. Coverage filtering, keyboard selection, native
  Command-click new tabs, data dialog and AI outside-click/landing dismissal pass.
  Draft chat text survives closing/reopening the fixture panel.
- 48 desk/theme/width combinations pass (eight desks, light/dark, 360/768/1440).
  Additional landing/explorer widths 320/390/1024 pass without overflow. Top desk
  navigation appears once in Home/workspaces/landings and no left desk rail
  renders. Signup is verified inside actual App/MarketingSite composition, with
  artwork and reachable form controls at 360/768/1440.
- 32 account-plan/desk fixture combinations pass; refresh, browser history,
  copy/export of 55 rows, and signup entry/verification paths also pass.
- Four record kinds (bill/pipeline/question/regulatory) pass summary/full-reasoning
  fixture checks: no linkage graph, retained facts, reasoning, Source and Ask AI.
  Live PDF was verified during target identification; PDF resolver/data were not
  changed. No production account creation, AI submission or backend writes.
- Independent review found dark-label contrast and signup content-box overflow.
  Fixed with semantic text/accent tokens and border-box sizing; final browser
  matrix rerun. Existing photographic assets are reused, with no new dependency
  or bitmap asset growth.

Runtime fixtures prove UI routing/presentation, not provider availability or
production data accuracy. Counts shown in local screenshots are fixture data.
The initial new-tab harness listened for a popup event; noopener links emit a
context page event. Correcting that harness proved native new-tab behavior.
Blocked external fixture requests are recorded separately from application errors.

Changed production source is confined to desk/shell/marketing presentation and
record graph presentation. No src/lib, backend, corpus, public/data, authentication
handlers, deployment configuration or billing changes. Nothing pushed/deployed.

Local source commits: `01634e4` (theme), `d072308` (signup), `b0ba405` (navigation),
`35366d8` (record graph). Independent final source recheck found no required
blockers. Final visual acceptance and integration remain with the owner.
