# Carbon v6 slice plan

> **Status: Living.** 2026-10-08; owner authorized continuation. [Spec](../specs/2026-10-08-desk-v6-carbon.md). Tracked only by F88 in open-work.md.

Stay on task/desk-v6-integration, preserve existing commits, leave main/remote untouched. Source contract fixed in spec. Default sequential: C1 → C2 → C3 → C4 → C5 → C6. One scoped worker may implement C2/C3 server boundary while supervisor freezes presentation; disjoint files, no shared interface edits. Independent read-only review follows; agents receive onboarding,no commits/push/delegation.

1. C1 presentation: new src/desks/landing/carbonPresentation.js and .test.jsx. Four reference sectors3/1/1/2,seven exact climate identities,image/title parity. Test each canonical hash and feature-map identity plus rendered href; prove wrong route guard red.
2. C2 summary projection: new src/lib/carbonLandingSummary.js and .test.js. Fixed version1 contract from spec; reject status/generic backups/news or emissions masquerading as prices; preserve zero versus null,populated columns,date periods,safe sources,bounded jurisdiction count distribution. Execute all seven embedded projectors as fixtures; restore defects to prove guards red. Run focused/full suites.
3. C3 server boundary: new server/carbonLandingSummary.mjs and src/lib/carbonLandingApi.test.js (worker); root api/router.js and server/featureFeed.mjs registration. Exact allowlist/climate tier; direct serveFeatureFeed parity;400/405/502. Test paths and import router.
4. C4 client: new src/desks/useCarbonLanding.js and .test.js. Bounded3worker queue,timeout,cancellation,error metadata,retry identity. Focused tests for abort/malformed/502/unknown counts.
5. C5 page: new src/desks/CarbonLandingView.jsx and .test.jsx; optional scoped carbonLanding.css only for proven theme defect. Root src/desks/DeskLandingView.jsx,src/shell/TerminalShell.jsx dispatch. Reuse dataHighlight counts-by-jurisdiction; truthful combined units/source coverage. All paths distinct; no sibling workspace substitution. Ignored tmp/desk-v6-preview.html supports existing Carbon selector already.
6. C6 supervisor acceptance: actual local source audit,separate offline/source dates; full npm test,Deno suite,lint,build,router import,node scripts/verify-desk-v6-assets.mjs,git diff --check. Browser cases in spec. Independent read-only reviewer checks final source/route/coverage diff; root fixes scoped findings. Update spec,this plan,overall plan,F88 with exact evidence and limits; local coherent commits only. Owner review precedes Sports.

Checkpoint: source truth before page polish; independent review and verification before commit. Failed provider truthfully displayed, not substituted by mock values. Current account locks can prevent terminal execution; report that explicitly, never change entitlements in this slice.

## Local checkpoint

C1–C5 complete; C6 independent code/source review clear,40focused/2,259fullVitest/862Deno pass plus lint/build/router/assets. Exact source/browser limits recorded in spec. Owner preview review,signed-in workspace acceptance and native-device checks remain pending. Sports follows review; F90 access-redirect behavior remains separate.
