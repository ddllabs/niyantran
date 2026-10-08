# Carbon desk v6

> **Status: Living.** Approved next-page scope,2026-10-08, under F88. Owner instructed continuation with the same reference/data/verification principles.

## Current state and outcome

Carbon still uses the standard landing. The v6 HTML has four sectors and seven modules (3/1/1/2). All map to climate feature identities and carbonPack projectors. Existing source adapters supply embedded pricing/milestone tables, outlet RSS and a registry blend of live Verra plus stored other publications. No new provider/database is necessary. Preserve the reference hero resources.jpg and cards resources.jpg,trade.jpg,steel-web.jpg,earth.jpg, exact titles/order/geometry/hover/dialogs via DeskLandingFrame.

## Source contract

Global Carbon Pricing Tracker: jurisdiction observations; Carbon Price Monitor: jurisdiction-year price observations; ETS & Tax Adoption Timeline: jurisdictions with first-instrument years; Carbon Border (CBAM) Watch: dated EU/UK milestones; India CCTS & Green Credits: official-source milestones; Carbon Registry Wire: dated registry publications (mixed live/stored when API succeeds); Climate Newswire: outlet articles. Source response determines actual count/mode, never reference numbers/live tags. Future policy-effective dates are not source update dates. No CO2 emissions-as-price, price sums, mock market ticks, generic news-as-regulation or generic XLSX backup packs.

Summary version1: feature/resourceKey identity,nullable count,countBasis prepared-feed,availability ready/empty/error,sourceMode stored/feed-backed/unknown,sourceAdapter,fallback,unit,asOf metadata only,observationPeriod from actual year/date,retrievedAt,populated columns,safe public sources,limitations. Source_status never counts. Carbon pricing supplies bounded jurisdiction-record counts for the hero highlight; missing/unshown labels disclosed. Do not sum USD/t across jurisdictions or combine observations into an economic indicator. Combined entries have explicit heterogeneous-unit note. Failed source has null count/empty fields/chart; meaningful error metadata preserved.

GET /api/carbon-landing requires exact seven-feature allowlist, forces climate tier, same serveFeatureFeed handler locally/deployed,400 unknown/405 wrong method/502 source failure. Client queue3workers,45s per request,abort-on-navigation,identity validation,retry requested module only. Page uses existing optional dataHighlight interface. Canonical popup routes are /#/carbon/<feature>; callback goes to current Carbon tab. Do not bypass accounts or mark successful href inspection as signed-in terminal acceptance.

## Scope and acceptance

New Carbon presentation,projector/API,hook,page/tests; root registers endpoint,dispatcher,shell and updates this spec/plan/F88. No shared geometry rewrite unless a demonstrated scoped defect needs a plan amendment. No provider/account/billing/database/data-file changes. Local branch task/desk-v6-integration; no push/deploy/main merge. Economics access redirect remains a separately tracked issue. Sports follows Carbon review; State/Local deferred.

Acceptance: four exact-image cards/seven distinct correct popups; real populated fields and honest dates/source modes; source-specific chart only; meaningful red guards for counted status,news/CO2-as-price,backup fallback,false zero,route mistakes. Execute fixtures and actual local GET responses separately. Browser checks four sectors/seven hrefs,data dialog,Escape/focus,filters,directory,pause,360/768/1440/1700,both themes,Hindi accommodation. Signed-in first click/Back/native zoom/touch/reduced-motion/hidden-tab checks either executed or explicitly unverified. Full Vitest,Deno,lint,build,router import,exact asset verifier,diff check and independent review precede local commits. Existing build warnings remain reported.

## Executed local delivery —2026-10-08

Four exact-reference sectors/seven modules implemented locally. Dedicated summary/API, bounded client queue, shared-frame adapter and shell dispatcher added; Carbon-only dark gradient repaired observed low contrast over the reference photo. No existing workspace/provider/access-policy change.

Actual seven local GET responses200/ready:52 pricing jurisdictions (stored,2025),242 price observations (stored,1990–2025),52 adoption records (stored,1990–2025),7 CBAM milestones (stored,2023-05-17–2026-01-01),6 India milestones (stored,2022-12-19–2025-10-01),24 registry publications (API blend,2026-09-17–2026-10-06),72 climate articles (API,2026-09-11–2026-10-07). asOf unreported in all responses; observation periods are not update dates. Wire counts can change between requests. Offline pack fixtures separately returned52/242/52/7/6/24/38. No reference constants control runtime counts.

Verification:
- Full npm test:164 files/2,259 tests passed; Deno862 passed.
- Focused final Carbon/frame40tests passed; independent review clear.
- npm run lint passed without warnings; npm run build passed with existing >500kB chunk and mixed deskBrief import warnings.
- Router import,41 byte-identical assets/40namedimages/9configurations verifier and git diff --check passed.
- Root observed API-registration guard fail404before wiring and jurisdiction-chart guard fail before connecting pricing data. Source agent executed six failing defect-restoration guards (counted status,backup/news,emissions as prices,falsezero,future date as update,hidden registry blend) then restored them; independent reviewer re-executed rejection fixtures.

Browser: four cards/seven popup titles/seven distinct correct /#/carbon/<feature> hrefs verified. Data dialog showed twelve jurisdiction counts and explicitly disclosed40undisplayed records; no price sums. Escape,directory,coverage filter,pause controls worked. Visible desk images fully loaded and no overflow at360/768/1440/1700; inactive lazy directory images excluded from visible-image check. Light/dark screenshots inspected; dark hero corrected and re-inspected. Hindi desk name displayed; full translation not claimed. No captured Carbon preview console errors.

Current account marks Carbon Upgrade. Signed-in seven-workspace first-click/Back acceptance remains unverified, not equivalent to href or route-unit checks; account state was not altered. Native200%zoom,touch,OSreduced-motion,hidden-tab lifecycle and browser-induced provider retry remain unverified; cancellation/timeout/error fixtures passed. Owner review remains pending. Preview:http://127.0.0.1:5174/tmp/desk-v6-preview.html?desk=carbon. No push/deploy/main merge.
