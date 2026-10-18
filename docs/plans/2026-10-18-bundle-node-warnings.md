# Bundle and URL warning implementation

> **Status: Living.** Local-only execution 2026-10-18; F231/F232.

Spec: ../specs/2026-10-18-bundle-node-warnings.md.

Sequential tasks; each depends on the preceding verification. No implementation
delegation. Independent read-only review may follow under the review workflow.

1. Capture the current chunk graph/aggregate gzip and request-helper behavior.
   Trace DEP0169 through a pinned/local adapter or dependency. Write scope:
   this record, spec, open-work tracker; disposable probes under /tmp only.
2. Add a causal router/URL guard; observe failure, implement the smallest
   request-boundary fix preserving rewrite/query/encoding contracts. Scope:
   api/router.js, a focused api/router*.test.js and a URL helper under server/
   only if needed. No response, auth or business-policy change. If the caller
   requires a dependency/configuration fix, document exact evidence before a
   local package.json/package-lock.json/vercel.json edit; no production change.
3. Establish causal load-boundary tests and introduce lazy specialized views
   and optional panels; preserve chat mounting and view props. Scope:
   src/shell/TerminalShell.jsx, src/shell/SidePanel.jsx, src/desks/DeskView.jsx,
   src/desks/DeskLandingView.jsx, src/marketing/MarketingSite.jsx and focused
   adjacent tests; small loading-boundary wrappers colocated if necessary.
   Existing stable pure selectors retain synchronous APIs.
4. Rebuild and inspect module contributions; narrow heavy shared catalogue/
   reference dependencies only when necessary. Scope: src/lib/ read-only
   imports/presentation helpers, src/desks/catalog.js, src/ai/ light presentation
   boundaries, vite.config.js, scripts/check-bundle.mjs and its focused tests.
   Data collections, schema/row contents, AI prompts and billing math excluded.
   No build-threshold increase. Record each measured attempt; revert neutral
   or worse changes. Enforce aggregate initial-closure gzip, not merely entry.
5. Full focused/app/lint/build/bundle/router verification and Deno where
   required. Browser fixtures for loading, route switching, account panel and
   retained chat behavior; inspect cold/warm JS requests and console errors.
   Record skipped live acceptance explicitly. Review all changed paths and
   leave verified work on task/bundle-node-warnings without push/deploy.

Definitions: interfaces/props unchanged; suspense fallback must be honest,
accessible, and use existing presentation. A lazy boundary must not unmount an
active chat when opening account pages. No credential/dotenv access. Scheduled
M1/M2 monitor untouched, Razorpay held, corpus excluded.


## Boundary decisions before bundle edits

Measured terminal static closure baseline621,619B gzip, public initial180,383B.
Four archive JSON snapshots are large shared dependencies despite an existing
async archive API; load those four only inside their requested feature branch,
retaining exact rows/metadata. No data file changes. Defer HomeDesk, DeskView,
DeskLandingView, CreditsPage and LiveTvModal at existing conditional mounts.
Keep SidePanel mounted as before. React-only vendor chunking may keep the public
entry below500kB, but is not counted as a performance win; enforce aggregate
initial gzip. Preserve CSS order byte-for-byte: extend the CSS inventory walker
to optionally follow dynamic imports at their original source positions.
Additional exact scope: scripts/build-terminal-styles.mjs and its existing
src/shell/terminalStyles.test.js; src/shell/LazyView.jsx and focused boundary tests.

URL reproduction: official upstream Vercel commit
f7b5377d47a483699f0e3c80c02f25168c289ed0 fixes the lazy query parser's
parseURL(url,true).query. Local historical-helper child process reproduced
DEP0169 with a stack through api/router.js:134 (routePath reading req.query).
New guards failed3/3 before the fix, including real Node warning and getter
execution. Router now reads explicit query data properties or WHATWG URLSearchParams,
never lazy accessors. Four URL guards and68 adjacent router/auth/cache tests
passed (72 total). No vendor/runtime downgrade or warning suppression.
Production attribution/absence remains unverified until a later approved rollout.


## Increment evidence

- Bundle guards failed2/2 before lazy boundaries/data imports changed.
- First slice: TerminalShell938.35 ->602.33kB; retained for subsequent measured
  reduction, but not considered complete. Second slice defers AiPanel within
  its existing once-visited mount, keeping it rendered when hidden. TerminalShell
 495.69kB; all JavaScript chunks below500kB; build warning absent.
- Public initial closure180,383 ->180,722B gzip (+339B, within182,446B limit).
  React vendor extraction is not counted as a loading win. Terminal static
  closure621,619 ->436,190B gzip (-29.8%); home route including HomeDesk closure
 463,527B (-25.4%). Follow-up script enforces aggregate initial bytes and the
  existing500kB chunk limit; tests reject small-entry/oversized-vendor loophole.
  Additional scope scripts/bundle-budget.mjs, src/shell/bundleBudget.test.js.
- CSS inventory includes only the newly deferred views in source order, not
  the deliberately separate PDF viewer. terminalStyles.js remains byte-identical.
- Downstream query compatibility guard failed before materialization: usersApi
  reads the original query after a URL rewrite. Router now materializes its own
  safe null-prototype query object before routing, without evaluating getters.
  Five URL guards plus68 neighboring route/auth/cache checks pass (73 total).
  Body/cookie/auth/business handlers unchanged. Query snapshots are request-local.


## Review repairs before final verification

Independent review found a real first-open regression: Live TV event/hash
entry points also need the visited gate. New guard failed before updating both
openers. Header/event/hash now mark first visit and retain the modal thereafter.
Loading fallbacks now use a normal-flow scoped rule in src/index.css, preventing
an absolute feed overlay from covering another panel. These are within the
loading-boundary scope; add src/index.css and src/shell/TerminalShell.test.jsx
to the exact inventory. Full suite first run had6277 pass/1 failure because a
settled account-access snapshot now saw its deferred mock's fallback. Warm those
mock views before testing the same protected/unprotected authorization assertions;
no authorization assertion removed. Repeat the full suite after these repairs.


## Final local verification — 2026-10-18

Implemented locally on `task/bundle-node-warnings`, uncommitted. No push,
deployment, production access or production mutation. F231/F232 remain open
for owner-approved publication and subsequent live validation.

Final build measurements (gzip unless stated):

| Surface | Baseline | Final | Result |
| --- | ---: | ---: | --- |
| Aggregate public initial JavaScript | 180,383 B | 180,721 B | +338 B; below unchanged 182,446 B budget |
| Terminal static JavaScript closure | 621,619 B | 436,196 B | 29.8% smaller |
| Home route including its deferred view | 621,619 B | 463,530 B | 25.4% smaller |

TerminalShell is 495.71kB minified; the largest emitted JavaScript chunk is
xlsx at 499.55kB. No Vite large-chunk advisory remains. React vendor extraction
is included in the aggregate initial measurement, not counted as a loading win.

Verification executed with the no-dotenv guard for npm/router commands:

- `npm test`: 400 files, 6,279 tests passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:
  1,155 passed, zero failed.
- `npm run lint`: passed, zero warnings.
- `npm run build`: passed; no large-chunk warning.
- `npm run check:bundle`: passed, including aggregate initial and every emitted
  JavaScript chunk. The original checker accepted a temporary oversized initial
  vendor payload; the new checker rejected it. It also rejected a temporary
  oversized deferred chunk. Both generated files were restored byte-for-byte
  with SHA-256 checks, and the final check passed again.
- `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`:
  passed. Historical lazy-query adapter reproduction emitted DEP0169 before the
  fix; five router guards now pass without invoking that getter. The downstream
  query-materialization guard also failed before its repair. The child fixture
  uses the configurable descriptor used by the actual adapter; an intermediate
  nonconfigurable fixture was corrected before the final full run.
- Browser fixtures with external requests and writes blocked: optional chunks
  wait for intent; Live TV header/event/hash paths work and retain selection;
  AI draft survives a Credits-page visit with one mount and zero unmounts;
  loading status remains in normal flow. No browser exceptions or write requests.
  Desktop and mobile fixtures exercised the real shell, side panel, profile,
  credits page and loading boundary, with synthetic desk/AI/TV contents and
  in-memory identity. This is not live authenticated acceptance testing.
- `git diff --check`: passed. Generated CSS inventory and files under
  `src/data`, `public/data` and `backup` remain unchanged.

Independent read-only review identified the Live TV intent paths and an overly
broad loading overlay; both were repaired and re-reviewed without new required
findings. Query encoding, repeated values, explicit query identity and retention
across URL rewrites were independently probed. No SQL fixtures were needed:
there are no schema, migration or SQL authorization changes. No standalone
type-check is claimed.

Final changed-path inventory: `api/router.js`; `vite.config.js`;
`scripts/build-terminal-styles.mjs`, `scripts/check-bundle.mjs`,
`scripts/bundle-budget.mjs`; `src/index.css`; `src/lib/archiveFeed.js`,
`src/lib/routerUrlWarning.test.js`; `src/shell/LazyView.jsx`,
`src/shell/TerminalShell.jsx`, `src/shell/TerminalShell.test.jsx`,
`src/shell/SidePanel.jsx`, `src/shell/SidePanel.test.jsx`,
`src/shell/bundleBudget.test.js`, `src/shell/loadBoundaries.test.js`,
`src/shell/credits/creditsPageWiring.test.jsx`; this plan, its spec and
`docs/plans/open-work.md`.

Remaining limitation: production DEP0169 absence cannot be claimed from a
local reproduction. An approved rollout must confirm the deployed adapter path.
The existing 499.55kB xlsx chunk is close to the unchanged limit; future growth
will fail the new guard. Scheduled M1/M2 checks are untouched; Razorpay remains
on hold and corpus ingestion remains excluded.


## Authorized release — 2026-10-18

Owner approved push, merge and deployment of both warning fixes. Runtime commits:
`32c611e` (safe URL query materialization) and `f158aa8` (demand loading and
bundle guards). Local verification and independent review above apply unchanged.
Release targets only origin ddllabs/niyantran main and Vercel project
prj_6UiaDz2rkTOmqIOaXnCAs92V7d86 in team_QFu1p3ObeXmlMQczPBcZb582.
Existing Git integration deploys main to nter.pro and niyantran-six.vercel.app.
No Supabase, timer, data, corpus or payment changes. Prior READY deployment
is dpl_DtfvnFUWUZCQiFE2dtNGN2B2f2Wx at 79c0799; rollback requires owner approval.
Push the task branch, verify its genuine CI, then fast-forward main and verify
production CI/deployment, read-only public routes/assets and bounded runtime logs.
Live warning verification remains pending until those observations are recorded.


## Production verification — 2026-10-18

Both runtime fixes landed on main at `cd0e14daee7ac4d4df9f56690bb0dafd8ec9c08e`.
Task-branch CI39134798867 and main CI39135220208 each passed both application
and disposable SQL jobs on attempt1. No retries or empty commits. Production
Vercel deployment dpl_HV8UVwmvBe6dsfE59gsEBjXRypx8 is READY at that exact SHA;
aliases include nter.pro, www.nter.pro and niyantran-six.vercel.app.

Production build scan:256 events, Build Completed present, no large-chunk
advisory or DEP0169. TerminalShell495.71kB; xlsx499.55kB. Deployed public initial
entry plus React vendor total180,869B gzip using Node gzipSync (same budget
method), below182,446B. Entry assets agree across both hosts; React vendor
matches the local build byte-for-byte. The production entry hash differs from
the no-dotenv local build, as expected for environment-specific public build
configuration; no configuration values were read or printed.

Read-only HTTP checks on www.nter.pro and niyantran-six.vercel.app: home200,
/api/home/segments200, intentionally unknown query-bearing route404. Request
logs prove both probes reached /api/router on this deployment with cache MISS,
including repeated query values and encoded Unicode/separator input. Signed-out
fresh Chrome smoke loads home and Sign in route with no JavaScript exceptions,
no failed JavaScript assets and zero blocked write attempts. Optional shell
chunks load at sign-in intent. No production account or paid chat was invoked;
local fixture evidence remains the source for authenticated draft persistence.

Prior production deployment had eightDEP0169 log entries in the preceding hour.
Post-release bounded runtime scan returned one record, zeroDEP0169 and zero
error/fatal records. Empty early runtime scan was not used alone: uncached
request records independently demonstrate actual router execution. This verifies
the exercised live path and observation window, not every possible dependency.

Hourly M1/M2 heartbeat configuration remains ACTIVE, hourly interval unchanged.
T15 remains open for genuine reference daily opportunities and Growth writer
acceptance; no artificial refresh or closure claim. Razorpay held, corpus
excluded. Final closure records are a documentation-only follow-up to this
verified runtime release; verify its resulting deployment/CI separately.
