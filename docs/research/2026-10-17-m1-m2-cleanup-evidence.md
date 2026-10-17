# M1/M2 cleanup execution evidence

> **Status: Living.** 2026-10-17. Local implementation and verification;
> production release, source repairs and paid evaluations remain unapproved.

## Checkout and safety

Base `b8d9e519ae16a9600fa60b00a7ea8f82746363a4`; fetched main and origin/main
agreed. Work is on `task/m1-m2-cleanup`; preceding planning documents preserved.
Node v24.21.0, npm 11.19.0, Deno 2.9.7, Supabase CLI 2.117.0.
Docker Desktop's CLI was used only for the existing `niyantran-recovery-db` and
`niyantran-corpus-test-db` containers. Every SQL fixture creates a disposable local
database. No production queries/writes, pushes, deployments or paid calls.

No environment file, credential folder or key was read. Node verification uses
`NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs'`: the temporary
preload reports environment files absent and returns empty content without opening
them. Vite's configuration otherwise calls loadEnv unconditionally. No package
install scripts ran. Shipped test/build fixture data was read without modifying
protected collections. Corpus ingestion jobs, workers, datasets and manifests were
not edited; existing corpus authorization tests ran only in disposable databases.

## Baseline and final commands

Commands below run from the repository root, with the Node preload above.

| Command | Baseline | Final |
| --- | --- | --- |
| `npm ci --ignore-scripts --offline --no-audit --no-fund` | 328 packages; ESLint deprecation warning | Same installed toolchain |
| `npm test` | 389 files / 6,088 tests passed, 177.51 s | 391 files / 6,110 tests passed, 95.42 s |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 1,147 passed | 1,149 passed, 0 failed, 7 s |
| `npm run lint` | Passed | Passed, zero warnings |
| `npm run build` | Passed; large chunk warning | Passed; large lazy chunk warning remains |
| `npm run check:bundle` | Entry 224,234 B gzip | Entry 180,398 B gzip; initial static closure clean |
| `node -e "import('./api/router.js').then(() => console.log('router import ok'))"` | Passed | Passed |
| `npm run test:sql` | Initial full attempt interrupted by concurrent runner edit; not claimed green | All 41 fixtures, 41 vacuity checks, 10 Down/reapply checks passed |
| `git diff --check` | Passed | Passed |

No standalone type-check exists. Expected mocked error-path telemetry appears in
both test suites. There is no production, CI or actual model-behavior claim here.
The first post-implementation full Vitest run found a stale MLA news-only success
expectation (6,108 passed, 1 failed); the test now separately exercises real
profiles and rejects coverage-only replacement, then the entire suite was rerun.

## Ordered task evidence

Focused checks failed for their stated defect before implementation unless
explicitly qualified below. SQL vacuity removes the relevant migration and must
fail; each new migration also restores its prior schema with Down and reapplies.

| Task | Change and evidence |
| --- | --- |
| T1 / F210 | Replaced 20 ms settling with observable persisted answer/unlocked thread. Requests identified by parsed research body; duplicate sends still rejected. Original historical flake did not reproduce in baseline, so no exact reproduction claimed. Both auth events exercised under explicitly held stream frames; other-account/sign-out guards retained. Original focused 7/7, later controlled-delay file 9/9; ownership/access/history focused set 30/30. |
| F217 (owner addition) | Morning Brief RSS fixture aged beyond three days during this session. Date-only fake clock at 15 October, restored after each test. Runtime retention untouched; focused 3/3. |
| T2 / F160 | Verified empty is a successful check with explicit empty availability, not unchanged content. Retained events preserve fetched_at while checked_at advances. Fixture failed on old empty outcome; fixture/vacuity/Down/reapply pass; existing nothing-new tests 14/14. |
| T3 / F160 | Compose caller/Request/module cancellation before the host queue. Held same-host request, cancelled chart, fallback on another host and surviving sibling prove cancellation without violating serialization. Red fallback assertion, then 56/56 focused. |
| T4 / F160 | Constitute version ID owns identity, independent of fetch date/display name. Two source responses identical; 47/188 in-force historical display keys changed under country-label cleanup. 26/26 focused after red identity assertion. Exact 188-key offline proposal in companion inventory. Actual production stored-key diff/repair remains T15. |
| T5 / F160 | Service-only run-pinned latest-run RPC filters current items before pagination, independent of accumulated historical count; reader bounds work to 10,000 current items and four concurrent requests. Mixed refreshes, disabled state, incomplete totals and duplicate keys rejected. SQL old RPC missing; SQL gates pass. Reader red at old 2,000 historical cap, then 115/115 focused. No ingestion limit raised. |
| T6 / F215 | Read-only diagnosis: old public configuration HTTP 403 for every league; documented configuration HTTP 200 for all eight windows, IPL next verified empty. Four-league next/past completeness required; incomplete checks not cached. Red configuration assertion, then 13/13 focused. Source check in companion record. |
| T7 / F160 | MLA identity profiles use reference retention and Wikidata item keys; dated reporting remains a distinct typed section. Coverage alone cannot replace missing profiles; sample limitations explicit. Old news classification/key assertions red, then 71/71 focused; updated note/profile/coverage-only tests 3/3. No completeness or performance scorecard claim. |
| T8 / F201 | Selected year is exact; gaps explicit and unranked. YoY only immediately preceding comparable calendar/financial period. Read all blocks of the selected table (bounded 16, batches four) to retain missing-indicator/state universe; no sibling tables. Red selected-period/YoY assertions, then 52/52 focused. |
| T9 / F201 | Whole variants request first page, then only pages their total needs: 1/500/501/2000 boundaries exercised. Old four-call behavior red; 124/124 focused after fix. |
| T10 / F201 | Handbook calendar/financial/survey intervals use inclusive overlap in the existing search RPC; exact JSON year filters stay exact. No reload or corpus change. Late-financial-window assertion red; all SQL gates pass. Catalogue changes exactly eight years descriptions, no IDs/counts/generated_at change. JS 18/18 and Deno tool 12/12 focused. |
| T11 / F216 | Qualifications require returned evidence, including Gaps/persona inference; unknown stays unknown. Prompt assertion red, then 43/43 focused. Five frozen behavioral cases documented; real model evaluation still pending, not inferred from prompt assertions. |
| T12 / F202 | Removed 57 proven duplicate feature-map source fields, preserving canonical registry addresses and active consumers. Exact before-value hashes in inventory. Presence guard red; restored-vs-clean offline feature envelopes/request URLs identical for all 57; focused set 58/58. Registry fields remain because code actually consumes them. |
| T13a/b / F208 | Presentation identity separate from terminal schema. Public tab/hash-only consumers import narrow modules; no auth/entitlement logic changed. App static graph guard red before remaining eager imports removed; 120 identities/search contracts preserved. Actual built initial static closure also rejects injected schema marker. Browser evidence below. |
| T14 / F202 M2 | Selected leader's exact HTTPS Wikidata /wiki/Q item becomes an accessible source link; generic/unsafe/lookalike/query URLs absent. Red link assertion, then focused M2/clock set 86/86. Browser confirms href, focus, new tab and noopener. |

## Browser and bundle evidence

Installed Chrome, isolated headless profile, temporary localhost servers and a
Vite harness with `configFile:false`; production API plugins were not loaded.
Every non-localhost HTTP request was blocked (observed blocked origin: Google
Fonts). Local summary API responses were isolated fixtures. No real account or
production client was used. Zero browser page errors.

Baseline source came from `git archive` of the base commit into /tmp, using the
same node_modules/toolchain and read-only link to shipped manifest data; no git
worktree or data collection changed. Initial entry baseline matches 224,234 B gzip.

| Observed initial JS | Base | Current |
| --- | --- | --- |
| Assets | entry + nterGlobe | entry + same nterGlobe |
| Raw bytes | 957,207 | 624,599 |
| Sum of per-asset gzip bytes | 229,274 | 185,438 |
| Entry gzip bytes | 224,234 | 180,398 |

Search: at 1280 px and 390 px, entered cricket, moved with ArrowDown/Enter,
opened the chosen module and verified the emitted destination matches the link
(`sports`, `Fixtures & Results — World Leagues`, kind `module`). Field/alias
search regression contracts remain in the full unit suite. Marketing had no
horizontal overflow at 390 px. Entry CSS is byte-identical before/after
(SHA256 `29cffa703b346c8f60829d209125538cdeb9cab362adb991b5fd0a33ee466e9d`). Wikidata link was keyboard-focusable with exact
item URL, target=_blank and noopener noreferrer. Generic/unsafe cases are unit
checks, not claims of opening external pages.

New bundle guard covers entry, modulepreloads and recursive static imports, so
moving eager schema bytes into another initial chunk does not evade it. Injecting
`workbookFunctions` into generated entry caused the expected failure; original
asset restored immediately. The 2,048-byte tolerance and previous PDF/CSS/geo
guards are unchanged. Lowered baseline: 180,398 B gzip.

## Review and release packet

Local review covered correctness, failure handling, scope, grants, parameterized
SQL, bounds and public loading. Existing migrations were not edited. New SQL
keeps privileged feed reads service-only and search invoker permissions unchanged.
No secret, account, billing or entitlement behavior was changed. User-type and
plan-entitlement changes are import targets only, covered by existing tests.

The following is a proposal for a separately approved release, not authorization:

1. Pin release commits and the existing known-good Vercel deployment and deployed
   `research-chat` source/version. Compare deployed function sources before choosing
   function deployments. The shared catalogue also has `desk-brief` consumers, so
   inspect its deployed dependency/source diff rather than redeploying it blindly.
2. Apply compatibility migrations in order: `20261017094845_feed_empty_outcome.sql`,
   `20261017095859_feed_latest_run_page.sql`, `20261017100644_handbook_period_ranges.sql`.
   The first two must precede consuming Vercel code. Tested Down contracts are
   embedded; any production rollback remains separately authorized.
3. Release pinned Vercel source; release affected function sources only after their
   deployed diff is reviewed. Timer configuration and ingestion functions unchanged.
4. Read actual constitution stored keys and prepare exact repair before executing
   any data repair; the offline inventory is not a production inventory. Refresh the
   MLA reference snapshot and verify class/kind/key transition before any serve
   decision. Identify a known-good fallback before changing any serve flag. No
   broad delete, bulk reload or data repair command has been executed/pre-approved.
5. Obtain a bounded model-evaluation environment/budget and run the five frozen
   cases; retain outputs, evidence, model/effort and usage. No live chats used here.
6. Record three expected source refresh opportunities and three consecutive
   first-attempt green CI runs; run the explicit-host module probe from T15 and
   reconcile health/failure counters and source coverage. Daily observations need
   their actual intervals. Vercel team access was 403 at orientation and needs an
   authorized operator or restored access. Do not bypass protection.

M1/M2 production closure and payment implementation remain pending. Corpus
OCR/chunking/embeddings/manifests are excluded. Payment gateway integration is the
next initiative after the approved closure gates, not part of this change.


## Local commit map

- `645a7aa`: approved specification and ordered plan.
- `8d6dec5`: research-thread synchronization and approved Morning Brief clock fix.
- `8cd624c`: three compatibility migrations, fixtures, vacuity and Down registration.
- `acadaa2`: scheduled feed retention/cancellation/identity/serving and source fixes.
- `81912bd`: exact-period comparisons and handbook descriptions/tool contract.
- `73cfd87`: grounded caveat instruction and frozen behavioral cases.
- `6657958`: inventoried duplicate search fields and parity checks.
- `e5f45c2`: public catalogue loading boundary and lower bundle baseline.
- `d4c0054`: selected leader source link.

These commits are local on the task branch; main was not merged or pushed.
The final documentation checkpoint records tracker progress without closing
production findings. Protected data and ingestion paths have no diff from base.

## Authorized rollout checkpoint — 2026-10-17

Owner approved push and deploy, with M1/M2 closure before payment work. Base
production rollback: Vercel `dpl_BHwBvmicYgiLUJQxvboxeJs4QneK`, commit `b8d9e51`.
The connector returned 403 for DDL Labs; the same-project authenticated CLI
fallback succeeded. No alternate scope or protection settings were used.

- Applied the exact three local migration versions in order using
  `supabase db push --project-ref vfgcppstyzjarlzyqdac --skip-vault --yes`.
  Dry-run listed exactly those three; no seed, role or vault changes. Remote
  history confirms all three. Latest-run RPC grants: anon false, authenticated
  false, service_role true.
- Pushed `task/m1-m2-cleanup` at `dd05adf`. First-attempt CI
  [39025298847](https://github.com/ddllabs/niyantran/actions/runs/39025298847)
  passed both app and SQL jobs, without retry.
- Retrieved and compared deployed bundles. Research v63 differed in exactly
  the three cleanup paths; deployed the changed bundle as v64, hash
  `edba0ec418d9b5294cf7d39e0e2b13cbc96cc3504e3177caa8c651e35e946f46`.
- Desk-brief v16 differed in the handbook catalogue and one unrelated deployed
  module entry. Preserved that entry and replaced only the catalogue; v17 hash
  `0722def616a1454da484999ffddb4648af4d46d2868476c2a6107751f50abca5`.
  Both functions retain their existing verify_jwt=false and handler authentication.
- Exact World Constitutions inventory: 188 rows / 188 distinct valid source IDs,
  no active lease. Prepared a key-only transaction guarded by snapshot/count and
  every old key/source-ID pair. It preserves row content, timestamps and positions.
- MLA before transition: news/news, serve=false; 1,616 accumulated rows but the
  latest successful source run contains 400 unique profiles and 39 coverage rows.
  Transition inventory/repair must avoid treating the accumulated news history as
  a reference list or defeating the source shrink guard without evidence.

Evaluation environment probe: Vercel refuses exporting 15 protected production
secret values. No dotenv/credential file was read and no value was printed.
The CLI environment-run helper unexpectedly interpreted its child command as a
preview deployment of the temporary probe directory (115 bytes), creating
`dpl_JEAvP7PsM7zKwmhxqmKwoxqvqKMz`, target=null/preview. It never promoted a
production alias; cleanup is recorded separately. That evaluation path was stopped.
