# Profile credit summary implementation

> **Status: Historical (2026-10-18).** Owner-approved implementation and release, verified.

Spec: ../specs/2026-10-18-profile-credit-summary.md; sole tracker F230.
1. Adapt existing BalancePill controller into ProfileCredits (same file) with
   controlled profileOpen state and render slot for existing account contents.
   Keep current subscriptions, notice rules, lifecycle and watchPopover helpers.
2. Render credit Glance as embedded section without nested dialog or duplicate
   page button. Update TerminalShell profile composition; remove redundant
   profile dismissal effect, retain live-TV mutual exclusion.
3. Add scoped avatar-ring and embedded-summary CSS in creditsPage.css; preserve
   BalanceRing calculations and account route. No src/lib/backend changes.
4. Tests: BalancePill.test.jsx plus profileCredits.test.jsx and existing
   creditsPageWiring.test.jsx. Prove new guards red before green, run focused,
   full npm test, lint/build/check:bundle using no-dotenv guard. Local preview
   without model calls or account writes; record limitations honestly.
Write scopes: above source/tests, these spec/plan files, open-work.md. Owner
approved push, merge and frontend deployment after local review. No backend
mutation. Keep closure monitor active, Razorpay/corpus held.

## Local verification — 2026-10-18

Implemented in TerminalShell.jsx, BalancePill.jsx and creditsPage.css. The
controller retains the original subscription, notice and dismissal helpers;
profileOpen remains controlled by the shell. CreditGlanceBody is an embedded
section within one Account dialog. Credits keeps its existing account route.

- New profileCredits.test.jsx guards failed 4/4 before source changes: old
  pill, absent combined dialog, absent embedded body and absent loading state.
- Focused command: `npm test -- src/shell/credits/profileCredits.test.jsx src/shell/credits/BalancePill.test.jsx src/shell/credits/creditsPageWiring.test.jsx src/ai/panelLayout.test.js` — 49/49 passed.
- Local browser fixture uses the real profile controller, summary and shell
  account markup, synthetic wallet/activity values and blocked external
  requests. Desktop, 390×700 phone and dark-mode rendering inspected. Phone
  popup bounds after correction: x=20, y=54, width=360, height=610.
- Browser execution confirmed one Account dialog, recent charges, Credits
  navigation to #/account/credits, dismissal on outside click, Escape return
  focus, quiet simulated refusal without focus theft, and working retry/close.
  No browser exceptions. This is fixture evidence, not a live-account test.
- Review: account metadata/actions and all credit detail retained; no new
  dependency, service call, provider/billing logic, or credit calculation.
- Full suite, lint, build, bundle and whitespace outcomes recorded below.

At the local-verification handoff, work remained on task/profile-credit-summary
awaiting owner review and release instruction. Scheduled closure checks remain active; Razorpay held,
corpus ingestion excluded. No production mutation, commit, push or deployment.

`npm run lint` passed with zero warnings. `npm run build` passed; existing
large-chunk (>500 kB) advisory remains. `npm run check:bundle` passed: initial
JavaScript 180,383 bytes gzip against 182,446-byte limit (15 bytes below baseline).
`git diff --check` passed. Commands used the existing local no-dotenv guard
through NODE_OPTIONS; no dotenv or credential files were read. No Deno/SQL
checks required for these shell-only changes; backend and src/lib untouched.
Changed paths: src/shell/TerminalShell.jsx, src/shell/credits/BalancePill.jsx,
src/shell/credits/creditsPage.css, src/shell/credits/creditsPageWiring.test.jsx,
src/shell/credits/profileCredits.test.jsx, this plan, its spec and open-work.md.
Final `npm test` after the embedded-section cleanup: 397 files / 6,268 tests
passed (145.66 seconds). Expected mocked feed-error diagnostics occurred; no
failed tests. At that handoff, the working tree contained only the eight task
paths listed above, uncommitted on task/profile-credit-summary.

## Authorized release — 2026-10-18

Owner accepted the local result and explicitly requested push, merge and deploy.
Release review covered correctness, readability, architecture, security and
performance; no blocking findings. No backend, credit math or data change.
Repeated focused 49 tests passed before commit. Prior full-suite, lint, build,
bundle and browser evidence applies to the unchanged source being released.
Origin fetched; main and origin/main both at 6e57a31. Target is Vercel project
prj_6UiaDz2rkTOmqIOaXnCAs92V7d86 in team_QFu1p3ObeXmlMQczPBcZb582,
production from main at www.nter.pro, retaining niyantran-six.vercel.app.
Known-good rollback candidate dpl_fiosRdMWzi6hzRgoEhEWDXvFLfak is READY at
6e57a31. No Supabase deployment or migration is needed. Branch CI, main CI,
exact deployed commit and public asset checks are required before closure.


Source commit 7756c6792fb280ccc82cf70af7d21ca05759ebde passed branch CI
39131057499 on attempt1 (app and SQL). Read-only independent review found no
blocking source issues; its tracker-status observation is reconciled here.
Branch preview dpl_vNW9A7uq13pNMBKzkEmPtrph4dwH READY. Fast-forward merged
main and pushed; production dpl_AbnvcMevyeMwtL71YxpoeoMMsTZg READY at exact
7756c67, serving www.nter.pro, nter.pro and niyantran-six.vercel.app.

Production root/CSS/JS reads on www.nter.pro and niyantran-six.vercel.app passed:
HTTP200, avatar ring and viewport-sizing CSS, combined profile trigger, embedded
summary, Account dialog, no separate credit-pill text. Both served terminal
chunk TerminalShell-D0lx6hG3.js. No authenticated credit/model calls made.
Bounded error-level runtime scan returned7 entries, all known DEP0169 Node
url.parse deprecation warnings (already recorded with domain launch); no new
application exception in those entries. Existing build-size advisory remains.
Main CI39131455379 passed app and SQL on attempt1. Bounded request-log scan
for this exact deployment returned0 HTTP5xx records, with no excluded intervals
or additional pages. No Supabase function, timer, data, credit or payment change.

F230 is closed in the sole tracker with source7756c67. Closure records are
published separately; that documentation-only push uses the same verified
application source and follows normal CI/deployment. Scheduled M1/M2 closure
checks continue unchanged, with Razorpay held and corpus excluded. Live
signed-in interaction was not repeated: acceptance is the owner's local preview,
with automated fixture interaction and deployed asset verification as above.
