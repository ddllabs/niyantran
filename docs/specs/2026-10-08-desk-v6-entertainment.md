# Entertainment desk v6

> **Status: Living.** Owner continuation under F88,2026-10-08.

## Outcome and scope

Replace standard Entertainment landing with four exact v6 image/card groups and eight canonical modules. Reuse DeskLandingFrame geometry, animations, dialogs, directory, filtering and accessibility. Counts and populated fields come only from existing serveFeatureFeed. TV is India/US schedules; box office is Indian film identities from 2024 with optional gross, never sum currencies; music is India/US most-played with iTunes fallback, not global. Song release dates are not chart freshness. OTT is Indian service/studio owner identities; celebrity is public follower observations, not composite influence. Chart counts TV rows by country.

Version1 summary: feature/resourceKey,nullable prepared-feed count,availability ready/empty/error/unavailable,sourceMode feed-backed/unknown,adapter,fallback,unit,asOf metadata only,observationPeriod,period,retrievedAt,populated columns,safe sources,limitations. Reject source_status,backup-pack,unknown adapters and GDELT stand-ins. No raw rows in response. Chart distribution bounded with missing/undisplayed counts. Preserve fallback notes from returned source; unknown count is not zero.

GET /api/entertainment-landing forces entertainment tier and exact eight-feature allowlist. Local/deployed direct serveFeatureFeed parity;400 unknown,405 non-GET,502 failure. Client3workers/45s deadline/abort/identity validation/retry. Popup canonical /#/entertainment/feature uses matching tier. Reference mock counts and dates excluded.

No provider,authentication,billing,database or data-file changes. Work locally on task/desk-v6-integration; no push/deploy/main merge. F90 locked-desk redirect remains separate, State/Local deferred.

## Acceptance

Meaningful red rejection/route/registration/chart guards; exact images and identities; actual API observations distinguished from fixtures; eight distinct popup hrefs; dialog/Escape,filters,directory,pause,both themes,Hindi accommodation,360/768/1440/1700 viewport checks. Full Vitest,Deno,lint,build,router import,asset verifier,diff check and independent review before local commits. Signed-in workspace and native-device verification reported separately when unavailable.

## Executed local checkpoint —2026-10-08

Four exact-image reference sectors/eight canonical popup URLs implemented. Dedicated summary/server/API, bounded client loader, presentation/page and shell dispatcher registered. Existing adapters/workspaces/access unchanged. Both GET routers use existing serveFeatureFeed directly. Sports governance unavailable; Entertainment US music and identity-only coverage labeled explicitly. Desk-scoped dark hero gradient preserves text contrast over photos.

Actual local GET audit twice:all eight HTTP200. TV125 listings (India1,US124); Indian film245 identities; Variety10 articles; Bollywood100 articles; India25tracks; US25tracks; OTT87 identities; celebrity246observations. Eight measured modules,863 combined heterogeneous entries. Film dates include2027: future dates do not certify release. Music release dates excluded from chart periods. asOf unavailable for all responses; observation/event/release periods are not update timestamps. Feed counts may change. Raw runtime evidence retained temporarily under /private/tmp/sports-ent-source-audit.json; no raw data committed.

Verification:full npm test174files/2,317tests; deno test -A --config supabase/functions/deno.json supabase/functions862tests; npm run lint; npm run build; router import; node scripts/verify-desk-v6-assets.mjs(41byte-identical assets/40namedimages/9configurations); git diff --check all passed. Existing build >500kB and mixed deskBrief import warnings persist. After final future-release explanatory copy,affected Entertainment summary/page16tests rerun passed. Independent read-only review ran10new+2shared files69tests,reviewed source/routes/identity/date/cancellation/wiring and found no blockers.

Root observed both registration guards return404 before wiring then correct405/400 after. Task agents executed non-vacuous defect guards for status/backup/headline substitution,null-versus-zero,date fabrication,chart quantities/truncation and canonical routes; review did not independently reproduce mutations.

Browser execution:all eight popup titles and distinct canonical hrefs inspected per desk; data dialog values inspected; Escape restores focus to triggering module; coverage filters,pause controls,directory and Hindi desk identity exercised. Both pages tested at actual360/768/1440/1700 widths without horizontal overflow or unloaded visible desk images after load. Initial immediate-load Sports image observations were unsettled and rerun after load; final all0broken. Light/dark visuals inspected and screenshots saved; full Hindi translation not claimed.

Signed-in eight-workspace first-click/Back acceptance remains unverified because account access gates are unchanged (F90 separate). Native200%zoom,touch,OSreduced-motion,hidden-tab lifecycle and browser-induced provider retry unverified; timeout/abort/error fixtures passed. Owner preview review pending. Preview:http://127.0.0.1:5174/tmp/desk-v6-preview.html?desk=entertainment. No push/deploy/main merge.

Source-summary checkpoint committed locally as 7f0f9c4; presentation checkpoint follows on task/desk-v6-integration.
