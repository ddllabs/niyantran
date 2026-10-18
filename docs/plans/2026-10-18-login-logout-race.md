# F233 local implementation plan

> **Status: Living.** Local-only execution, 2026-10-18.

Spec: [login/logout race](../specs/2026-10-18-login-logout-race.md).
Branch task/login-logout-race, baseline db5793f; sequential implementation.

1. Register F233 and write this spec/plan. Exact scope: these two documents and
   docs/plans/open-work.md. No other tracker or production mutation.
2. Build a causal integration regression with real LoginPage and userStore;
   stub only Auth, profile, presentation and preference transport. Scope:
   src/marketing/loginSessionRace.test.jsx (new) and, if necessary,
   src/lib/userStore.bridge.test.js. Control verification latency and reproduce
   App's deferred passive publisher. Require successful same-account re-login
   and no false null event before successful publication. Capture red evidence.
3. Smallest shared-boundary repair in src/lib/userStore.js: distinguish refusal
   by the local logout latch from an authoritative new sign-out. Keep all
   verification/epoch checks and signatures. No LoginPage/App edits expected;
   record additional exact scope here before changing it if evidence requires it.
4. Adversarial focused verification: passive checks before/during/after resume,
   repeated checks, real logout, SDK SIGNED_OUT, changed account/token, invalid
   user/profile and provider logout failure. No caller may gain authority from
   a passive cached event. Run existing store/form/admin/preferences tests.
5. Full npm/Deno, lint/build/bundle; local browser fixture with external network
   and writes blocked. Independent read-only security/correctness review per
   review skill, followed by any repairs and their regression checks. Scope of
   review includes all changed files; implementation remains sequential.
6. Record exact commands, causal proof, outcomes, limitations and clean data
   inventory in this plan and the sole tracker. No push, merge to main, deploy
   or production mutation; Razorpay held, corpus excluded, monitor unchanged.

Shared interface: a refused passive check returns null; it may not reopen the
logout latch or impersonate a newer logout. A deliberate sign-in still supplies
its exact SDK session and must independently verify it before authority returns.


## Local execution and evidence — 2026-10-18

Implemented on task/login-logout-race, baseline db5793f. User approval includes
specification, plan, implementation and verification in this local session;
publication remains withheld. No merge, commit, push, deployment or production
operation. No Docker or new dependency required.

### Causal regression and minimal repair

New integration file src/marketing/loginSessionRace.test.jsx imports the actual
LoginPage handler and userStore, stubbing only Auth/profile, presentation and
preference transport. It reproduces App's deferred passive publisher. Controlled
promise holds deliberate getUser verification while passive consumers run.
Before the repair: one failure (slow-verification login success count0 instead
of1), eight passes. After: nine passes. Existing assertions were not weakened.

Only runtime edit is in src/lib/userStore.js: refusal by the existing local
logout latch returns null without broadcasting identityChanged(null). This
refusal grants no authority and cannot reopen the latch. Session/user/profile,
epoch/token/account checks and actual logout notifications remain intact.
The SDK signOut call and its failure handling are unchanged. A true SIGNED_OUT,
including a delayed one, still invalidates a pending sign-in; general logout
transport/retry redesign is outside this repair.

Cases: slow/fast verification order; repeated passive consumers; local logout;
SDK SIGNED_OUT; account switch; token switch; invalid verified user; suspended
profile; provider logout failure with cached passive SIGNED_IN. Existing suites
also retain hydration-time logout/account/token changes and admin isolation.

### Executed verification

All npm commands used
`NODE_OPTIONS=--import=/tmp/niyantran-cleanup-no-env/guard.mjs` to prohibit dotenv
reads. Commands and outcomes:

- `npm test -- src/marketing/loginSessionRace.test.jsx`: red1/9, then green9/9.
- `npm test -- src/marketing/loginSessionRace.test.jsx src/marketing/loginAuthorization.test.js src/lib/userStore.bridge.test.js src/lib/userPrefsSync.test.js src/admin/adminSession.test.js`:
  210 passed across5 files.
- `npm test`: 6,288 passed across401 files.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:
  1,155 passed, zero failures.
- `npm run lint`: passed, zero warnings.
- `npm run build`: passed; no chunk warning. TerminalShell495.71kB, xlsx499.55kB.
- `npm run check:bundle`: passed, initial180,727B gzip below182,446B limit.
- `git diff --check`: passed. Data directories and terminalStyles.js unchanged.

Browser fixture: real App component, LoginPage and userStore; synthetic in-memory
Auth/profile,150ms verification delay; marketing home/terminal/globe/head and
preference transport are fixture boundaries. Fresh Chrome performed four login
cycles and three logouts, returning home and entering sign-in each time. Final
counts4 sign-ins/3 sign-outs; zero page exceptions, write requests or external
requests. No real credentials, production sessions, OAuth, email/reset or provider
requests were used. Python Playwright was unavailable; cached JavaScript
Playwright with dedicated headless Chrome was used. Local server required sandbox
network permission; no production permission was requested or exercised.

Independent read-only correctness/security review found no Critical/Required
findings. It independently executed the new integration, existing login/store,
identityFailure and reverify suites:140 tests across5 files passed. It confirmed
that the repair returns no authority and preserves current epoch/token/account
checks; pre-fix failure was primary execution evidence, not an independent rerun.

### Final scope and limitations

Changed runtime path: src/lib/userStore.js (nine-line diff). New tests:
src/marketing/loginSessionRace.test.jsx. Documentation: this plan, companion
spec and docs/plans/open-work.md. No App/LoginPage runtime edits needed. No
backend/API/schema/configuration or data changes, so no SQL/router-import gate.
No standalone type-check is claimed. Local synthetic browser evidence does not
substitute for eventual owner-approved production logout/re-login acceptance.

Official references consulted:
[Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange),
[signOut](https://supabase.com/docs/reference/javascript/auth-signout).
Installed auth-js source confirms SIGNED_IN notification precedes the password
sign-in promise return. Changelog index fetch failed; no SDK API/version change
was required. Existing hourly M1/M2 monitor untouched, Razorpay held, corpus
excluded. F233 remains open pending owner review and separately approved release.


## Authorized release — 2026-10-18

Owner approved push, merge and production deployment of F233. Release target:
origin ddllabs/niyantran main, Vercel project prj_6UiaDz2rkTOmqIOaXnCAs92V7d86,
team_QFu1p3ObeXmlMQczPBcZb582. Git integration assigns nter.pro,
www.nter.pro and niyantran-six.vercel.app. No Supabase/config/data changes.
Pre-release focused rerun:120 tests across loginSessionRace, loginAuthorization
and userStore.bridge passed; diff check passed. Existing hourly monitor ACTIVE.
Prior known-good deployment dpl_4GxihNxpJ63dL7FeFyv29gvdQ19n at db5793f;
rollback still requires owner approval. Push task branch, require genuine green
CI, merge main, verify deployment/CI/public routes and production login/logout
acceptance using the owner's browser without reading or exporting credentials.
