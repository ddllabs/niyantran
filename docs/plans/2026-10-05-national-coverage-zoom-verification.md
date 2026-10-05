# National coverage clarity and native zoom checkpoint

> **Status: Historical (2026-10-05).** Local execution evidence for T11; not owner visual acceptance or publication.

## Changes and functionality evidence

- The Parliamentary Question Database row now says `Stored · Sampled questions`. Its 8,000 records remain the existing stored sample. Loading/error rows do not present this coverage claim. No data, source dates, canonical routes or authentication behavior changed.
- Local summary response confirmed 8,000 ready stored records, source `elibrary.sansad.in`, snapshot `2026-09-07T16:49:32.669Z`, and the limitation that substantive answer text is not available for all sampled records.
- The ignored `tmp/national-preview.html` formerly used register callbacks to change a selected-module header. Those callbacks now navigate to the real app's canonical hash, and the header explicitly identifies this as a layout preview with real summaries. The question register button navigated to `/#/national/Parliamentary%20Question%20Database`; the current anonymous session reached the existing marketing/auth gate. Browser Back restored the preview. No auth bypass or account mutation was performed. Previous signed-in evidence covers all twelve actual app routes separately.
- Native in-app browser clicks verified source filters: Stored seven matches, Feed-backed three, Curated two, All twelve. Nonmatching rows remained inert. The question coverage disclosure displayed columns, snapshot, source and the sampled-answer limitation. `national-question-coverage.png` records the visible result in the task visualization directory.
- The existing bill-sector chart uses 9,819 stored bill records, including 1,774 not classified and 3,811 grouped under Other sectors. It does not claim source freshness when the source date is absent.

## Executed checks

- Red presentation guard failed before the label implementation (one failed, two passed); green focused file passed all three tests afterward.
- `npm test`: 139 files, 2,124 tests passed.
- `npm run lint`: passed without warnings.
- `npm run build`: passed; existing deskBrief mixed-import and large-chunk warnings remain.
- `git diff --check`: passed before commit.

## Native Chrome after owner unlocked the Mac

- Chrome's native toolbar showed `Zoom: 200%`. A read-only DevTools expression returned `{"viewport":577,"pageWidth":577,"reduced":false,"motion":"off"}` with DevTools docked. This proves no page-level horizontal overflow for that zoomed preview viewport, not every authenticated topbar control at that zoom.
- Rendering controls were inspected, but attempts to select reduced-motion did not change their visible `No emulation` state. Native input/window binding intermittently failed; the Chrome extension connection timed out. Reduced-motion, hidden-tab and coarse-pointer runtime gates therefore remain unverified. The previously passing synthetic lifecycle tests are separate evidence and do not close those browser gates.
- Native zoom was reset through Chrome's Reset button; the popup showed `Zoom: 100%`. Device toolbar remained off and media controls remained `No emulation`. DevTools and the agent-created native preview tab were closed; the pre-existing New Tab was preserved.
- The ignored preview requested `favicon.ico`, which returned 404 in native Chrome. This is a local harness asset warning, not evidence of a production failure. It was not fixed outside the assigned product scope.

## Remaining work

Native reduced-motion/hidden-tab/coarse-pointer acceptance and owner visual review remain open in F81. Existing workspace filters and source completeness are not exhaustively verified by landing-route checks. No push, deployment, PR or main integration occurred.
