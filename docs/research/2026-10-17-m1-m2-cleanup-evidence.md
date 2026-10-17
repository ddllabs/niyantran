# M1/M2 cleanup execution evidence

> **Status: Living.** 2026-10-17. Local and authorized production implementation/verification.
> Real scheduled refresh observation gates remain open; payment work has not started.

## Checkout and safety

Base `b8d9e519ae16a9600fa60b00a7ea8f82746363a4`; fetched main and origin/main
agreed. Work is on `task/m1-m2-cleanup`; preceding planning documents preserved.
Node v24.21.0, npm 11.19.0, Deno 2.9.7, Supabase CLI 2.117.0.
Docker Desktop's CLI was used only for the existing `niyantran-recovery-db` and
`niyantran-corpus-test-db` containers. Every SQL fixture creates a disposable local
database. During the initial local phase there were no production queries/writes, pushes,
deployments or paid calls; the later authorized rollout is recorded separately.

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


## Production verification checkpoint — 2026-10-17

- Main `0e970f4` deployed READY as `dpl_5UfXHXpSkp4BhVyZFBT8HPMpYqtT`,
  https://niyantran-53cwnm8h4-ddl-labs.vercel.app, production alias
  https://niyantran-six.vercel.app. Second first-attempt CI
  [39025660396](https://github.com/ddllabs/niyantran/actions/runs/39025660396)
  passed app + SQL. Original rollback deployment remains recorded above.
- Exact constitution transaction applied successfully: all 188 keys now match
  constitute:source-ID; oldest first_seen and latest last_seen preserved. No
  source records, positions, freshness or serving flag changed.
- Exact MLA inventory is `2026-10-17-mla-reference-transition.json`. A disposable
  local Docker schema proved 1,616 -> 439 rows: 400 profiles / 39 coverage rows,
  with all 439 retaining content, timestamps and positions. The transaction
  checks the complete key-set hash, count, snapshot, lease and changed-row counts;
  a replay fails its inventory guard. Applied to production, retaining only the
  latest successful snapshot and re-keying its profiles. One-time MLA due-now
  transition; planned reference interval 1,440 minutes, no global cron changes.
- The next actual scheduled MLA run at 10:45 UTC succeeded with 500 rows:
  400 distinct stable profile keys + 100 typed coverage rows; zero failures.
  Enabled only that module's serve flag with a guard on the successful snapshot,
  reference kind/class, 500 items, 400 stable profile keys and no lease.
- Read-only after-check: World Constitutions 188/store/488 ms; fixtures
  7/store/126 ms; MLA Profiles 500/store/300 ms, all HTTP 200. Fixtures' 10:40 UTC
  refresh succeeded and reset its previous 18 consecutive failures to zero.
- Full read-only production probe: all 120 modules HTTP 200, no HTTP failures.
  Before the MLA serve flip: 69 store / 50 live / 1 archive. NSE/BSE remains the
  sole archived module. Existing Central Tender fallback remains labelled;
  the five planned modules remain planned. After the flip, 70 distinct modules
  / 257 variants serve from storage; District Performance is the sole disabled
  store module and remains planned, outside this cleanup.
- Verified refresh architecture: Supabase pg_cron `feed-refresh` job 5 is active
  every five minutes and calls the deployed Vercel /api/feeds/refresh endpoint.
  Last hour: 12 succeeded cron executions. Last half-hour: 14 ok / 20 unchanged
  source checks, no failed/timeout/shrunk runs; no source above three consecutive
  failures. `feed-purge` remains the existing daily job; no schedule changed.
  Feed refresh is a Vercel function called by Supabase, not a missing Edge
  Function. `refresh-model-pricing` is a separate existing Edge Function.
- Isolated Chrome on actual production, 1280/390 px: homepage HTTP 200, heading
  visible, no horizontal overflow or page errors. All writes and external
  requests blocked. Production entry index-YrIF11mq.js plus unchanged globe.
- F216 faithful evaluation found one remaining count/coverage omission. Added
  the narrow prompt guard red-before-green, committed `00aaf99`, and deployed
  research-chat v65, hash
  e9f084cd83f2006dce7b92f979736bb3470e04c63fd785579893d54fd94e6eb5.
  Final local rerun: 391 files / 6,110 Vitest tests (80.84 s), 1,150 Deno tests,
  lint/build/bundle/router import pass. No SQL change since the 41-fixture pass.
- Model evaluations: 5 + 5 + 1 expressly authorized calls; all five rubric cases
  now have passing faithful evidence (four on v64; corrected count case on v65).
  Total observed cost $0.03677325. Every temporary evaluator deleted; no provider
  key left Supabase and no production chats/database rows were created.
- Unintended temporary preview dpl_JEAvP7PsM7zKwmhxqmKwoxqvqKMz was removed
  successfully with the exact native remove command. No production alias changed.
- Ingestion functions unchanged: ingest-documents v21, ingest-worker v3,
  admin-ingest v4, identical pre/post bundle hashes. No corpus jobs, dataset,
  OCR, chunking, embedding or manifest changes.

Owner requested follow-ups: active hourly heartbeat
`niyantran-m1-m2-closure-checks` on this chat, read-only production checks, quiet
unless meaningful failure/completion. Actual daily reference opportunities
cannot be replaced with forced calls. MLA's next reference run is 18 October
16:15 IST; constitution's next is 17 October about 21:10 IST. Three post-rollout
opportunities require the real subsequent dates (approximately through 19 October
evening IST), with actual completion recorded by the follow-up. Payment gateway
work must wait for the closure report.


Additional read-only production checks: the run-pinned fixtures RPC returned
TOTAL 7 and page lengths 2/2/1 at offsets 0/2/6. No qualifying latest-run variant
yet holds >2,000 items in production; that boundary is covered by the local SQL
and reader regressions, not a fabricated live fixture. Handbook search for exact
2019-20 with January–March 2020 returned financial-year rows (TOTAL 446), proving
the deployed overlap contract against real stored records. No production state
currently reports empty availability; empty semantics are proven by the local
fixture and deployed migration rather than claimed as a live empty-source event.

Durable full probe and after-transition samples:
`2026-10-17-m1-m2-rollout-module-status.json`. Temporary eval functions and the
unintended preview are deleted; corpus function hashes remain unchanged.


## Final code-release gates — 2026-10-17

Final code/evidence commit `d63192b17b55c02acd271138e2c34bcf1fcb8c36` is deployed
READY as `dpl_jK49disGoPccuVkPsoDGsegPEFzS`,
https://niyantran-bicrwvonl-ddl-labs.vercel.app, with production aliases including
https://niyantran-six.vercel.app. Three consecutive genuine first-attempt CI runs
passed app and SQL jobs, with no retries, cancellations or empty commits:
[39025298847](https://github.com/ddllabs/niyantran/actions/runs/39025298847),
[39025660396](https://github.com/ddllabs/niyantran/actions/runs/39025660396),
[39026919956](https://github.com/ddllabs/niyantran/actions/runs/39026919956).
F210 is closed. A later documentation-only checkpoint may create its ordinary CI
run; it does not replace these code-release runs.

Final public entry: index-YrIF11mq.js, 180,546 B gzip with production configuration;
no feature-map/column markers. Fixtures store response: NBA 2, Premier League 2,
La Liga 2, IPL 1. Per-window coverage: all next/past checked, IPL next verified
empty, remaining windows ok. No missing league is hidden by partial success.

Bounded production logs, 10:29–10:59 UTC: 20 error-level runtime records were all
Node DEP0169 url.parse deprecation warnings, not application exceptions. Request
logs on the final deployment, 10:45–11:00 UTC: two /api/global-landing HTTP 502s.
A read-only 16-summary check identified Satellite Infrastructure as the only
failed Global summary; its module still has a serving store and the 120-module
probe itself had no HTTP failures. The unchanged live-first summary route bypasses
that store. Logged separately as F218; no unapproved summary-route fix. Runtime
warning origin was not changed in this cleanup.

Post-DDL Supabase security advisor: 22 INFO no-policy tables and 15 WARN
signed-in-callable SECURITY DEFINER functions, all objects unchanged by these
migrations; no finding names the new run-page/period helper. Service-only feed
storage and guarded self-service RPCs are intentional existing architecture;
this task did not broaden their permissions. General review remains P12.
[No-policy advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[definer-execution advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

All temporary evaluator functions are confirmed absent. Ingestion versions/hashes
remain identical. Only T15's real scheduled refresh opportunities remain open
within the approved M1/M2 programme; F218 is separately tracked. The owner-requested
hourly read-only follow-up will report meaningful failure or completion before any
payment gateway work. No further paid calls are authorized or scheduled.

## Scheduled closure observation — 2026-10-17 11:42 UTC

Read-only checks at approximately 11:42–11:44 UTC. Checkout started clean on
`main`, matching fetched `origin/main` at `f3d5b59`; no source changes. Results
recorded locally on `task/m1-m2-closure-observations`, without push/deploy.

- Supabase cron job 5 `feed-refresh` remains active every five minutes and its
  command targets the expected production Vercel refresh route (checked as a
  boolean, without retrieving command/credentials). Last 30 minutes: six cron
  executions succeeded; feed runs were 16 ok / 30 unchanged, no failed outcomes.
- Store health: 70 distinct modules / 257 serving variants; zero states above
  three consecutive failures. All four monitored sources have zero failures.
- Fixtures: second real post-rollout hourly opportunity succeeded at
  `2026-10-17T11:40:14.375Z`, seven current-run events. Four-league counts remain
  Premier League 2, NBA 2, La Liga 2, IPL 1. All next/past windows checked:
  IPL next is verified empty, the other seven windows ok. Store `item_count=13`
  includes retained history; latest-run count is seven. Next due 12:40:16 UTC;
  only two qualifying hourly opportunities so far, not three.
- MLA reference unchanged since the actual 10:45 UTC run: 400 profiles with
  stable `mla-profile:` keys plus 100 reporting records. Serve enabled, next due
  October 18 10:45 UTC. No additional daily opportunity has elapsed.
- Constitutions: 188 distinct `constitute:` keys, exactly matching the approved
  inventory. MD5 of newline-joined sorted keys is
  `c14635ffbc17cef3a5ace4fc74273578` in both inventory and database. No refresh
  since October 16 15:40 UTC; first post-rollout daily opportunity still due
  October 17 15:40 UTC. This confirms current identity, not multi-run stability.
- No live state has `meta.availability=empty`; no new production empty-source
  outcome is claimed. Existing local fixture/deployed-contract evidence stands.
- Vercel exact project/team: `dpl_DAxtC1E1waeajVfYAZRjyEsfBUWx` READY at
  `f3d5b59a378dc34b13b2844e965fea3882c45d5f`, matching current main.
- Latest main CI [39028941094](https://github.com/ddllabs/niyantran/actions/runs/39028941094)
  completed successfully on attempt 1. Immediately preceding run 39028606428
  remains failed (F220); only one new first-attempt green follows that failure.
  This is a separate genuine documentation commit, not a rerun, and does not
  resolve the intermittent answer-reserve finding or provide three new greens.
- Approved behavioral evaluation already ran and is recorded above (total
  $0.03677325); it is not pending and no new calls were made.

No new actionable failure or completion. T15 and F220 remain open; no repeat
failure notification. No forced refresh, production writes, corpus operations,
payment work, paid calls or secret-file reads. Follow-up remains active.

## F220 release — 2026-10-17

Owner separately approved fixing, verifying and pushing/deploying F220.
`256f042` retains the answer-reserve transition in the per-turn in-process
checkpoint; controlled fractional timers reproduce the original high-effort
restart. Old runtime fails four guards; fixed nine-case set passes ten executions.
Full Deno 1,155 pass; final local Vitest 6,126 pass. Initial Vitest interference
is retained as separate F221, with no preference source/test edits. Lint, build,
bundle and router import pass; branch CI 39030425827 and main CI 39030716589
both pass app/SQL jobs first attempt, without retry/cancellation/empty commits.

Research-chat v66 ACTIVE, bundle hash
`61c10a6983518003f2cdeb18007a6933618c55442e62392af9576a1e17c053b7`.
Only agent.ts differs from v65; all 36 deployed files match the prepared release.
All other Edge Function versions/hashes are unchanged, including corpus functions.
No corpus operation, database/data/job change or paid model call. Production
POST without bearer returns 401, preflight 204, expected production CORS; bounded
post-deploy logs show boot/check responses without errors. Vercel main deployment
READY at the code commit. Detailed [F220 evidence](2026-10-17-f220-answer-reserve-evidence.md).

F220 moved to Done. F221's separate isolation issue and T15's real source
intervals/current CI checkpoint remain open. The requested hourly read-only
follow-up remains ACTIVE. Corpus ingestion excluded; payment integration on hold.

## Scheduled closure observation — 2026-10-17 12:48 UTC

Read-only Supabase, Vercel and GitHub checks at approximately 12:48–12:50 UTC.
Checkout began clean on local `task/f222-market-ids` at `bd25379` (verified local
metadata improvement, not released). Fetch succeeded; main and origin/main
remain equal at `2dd8ecd`. Only this evidence record and the sole tracker were
updated for this observation; no source changes or production mutations.

- Supabase cron job 5 `feed-refresh` is active at `*/5 * * * *`; the expected
  production Vercel `/api/feeds/refresh` URL is present (boolean check only,
  without retrieving the command or its secret). Six executions succeeded in
  the last 30 minutes; feed outcomes were six ok and four unchanged, no failures.
- Seventy distinct modules / 257 variants are serving. Zero states above three
  consecutive failures; all monitored sources have zero failures.
- Fixtures completed its third genuine post-rollout hourly opportunity at
  `2026-10-17T12:45:00.422Z` (prior starts 10:40:00.509 and 11:40:14.375).
  Seven latest-run events: English Premier League 2, NBA 2, Spanish La Liga 2,
  Indian Premier League 1. All eight next/past windows are checked; IPL next is
  explicitly empty, the other seven ok. Fourteen retained items include history.
  State fetched at 12:45:01.865946; next due 13:45:01.865946 UTC. The five-minute
  scheduler first reached this opportunity at 12:45 after its prior 12:40:16 due
  time; this is one ordinary scheduled opportunity, not an extra retry.
- Both Music Charts modules have three successful hourly opportunities at
  10:40, 11:40 and 12:45 UTC, 25 items each. First outcomes unchanged, later ones
  ok. Both remain hourly, serving and healthy; next due around 13:45 UTC.
- MLA Report Card + Statement Tracker (the MLA Profiles & Coverage reference
  store) remains at its actual 10:45 UTC successful run: 400 profiles with 400
  `mla-profile:` keys plus 100 statement/coverage records. Serve is on, next due
  October 18 10:45 UTC; no second daily interval has elapsed.
- World Constitutions still holds exactly 188 distinct `constitute:` keys;
  sorted newline-joined key MD5 remains `c14635ffbc17cef3a5ace4fc74273578`.
  Last actual refresh October 16 15:40 UTC, next due October 17 15:40 UTC. Its
  first post-rollout daily opportunity remains pending; current key identity
  alone does not establish multi-run stability.
- No live state has `meta.availability=empty`; no new production whole-feed
  empty outcome is claimed. The explicit IPL-next empty window is source
  coverage metadata. Existing local empty-contract evidence remains applicable.
- Authenticated Vercel CLI API fallback for the exact approved team/project
  confirms READY production deployment `dpl_4K3mQJmw37bVcGUbpvSG1VSBGfXz`,
  `niyantran-2eahx5qy0-ddl-labs.vercel.app`, source
  `2dd8ecd3c5fd66775bdaf8343fda7202cb6357de`, matching origin/main.
- The final three consecutive genuine post-F220 CI runs were individually read
  back: [39030425827](https://github.com/ddllabs/niyantran/actions/runs/39030425827),
  [39030716589](https://github.com/ddllabs/niyantran/actions/runs/39030716589) and
  [39031190292](https://github.com/ddllabs/niyantran/actions/runs/39031190292).
  Each is attempt 1, conclusion success, with both Build and tests and SQL
  fixtures jobs successful. The last run completed SQL at 12:10:48 UTC on
  `2dd8ecd`. CI component is satisfied; no manufactured run or retry counted.
- Approved behavioral evaluation already ran as recorded above; no new calls
  were made. F221 remains separately open despite subsequent green runs.

T15 remains open for real daily reference observations. No actionable failure
or overall completion, so no notification. Follow-up remains active. No forced
refreshes, writes to production data, config/flags/timers, deployments, corpus
operations, payment work, model calls or dotenv/credential-file reads.

## F222 release follow-through — 2026-10-17 13:10 UTC

Owner separately approved the additive Manifold ID metadata release (`294a273`,
production `e1a5557`, Vercel `dpl_CPAJgveM9dZ5AZSYKP7mjDaf5wmx` READY).
Branch/main CI 39034204827 / 39034521190 passed both app and SQL jobs on
attempt 1. The ordinary 13:10 scheduled refresh updated 204 Political Odds and
17 Election Forecast items with distinct IDs, zero new item keys; served APIs
return HTTP 200 from store with all IDs. All 598 older daily observations are
fingerprint-identical. No forced refresh, timer/serve flag or migration change.
All ten Edge Function versions/hashes remain unchanged, including corpus.

Latest read-only health: zero feed states above three failures; all six last
30-minute feed-refresh cron executions succeeded, latest 13:10 UTC. The hourly
closure monitor remains ACTIVE; reference sources have not reached their next
daily opportunity. No additional reference opportunity is inferred from the
market refresh or passing CI, and T15 remains open. Authorized behavioral
evaluation remains the already executed evidence, with no new paid calls.

A bounded 12:56–13:11 UTC request scan also found two GET `/api/state-landing`
HTTP 502s at 13:08 UTC; logged F223 in the sole tracker, cause/feature unknown.
No state-summary changes were made. Final documentation checkpoint CI will be
checked after push rather than counted in advance. Full release and log limits:
[F222 evidence](2026-10-17-f222-manifold-identity-evidence.md).
Corpus excluded; payment integration held pending M1/M2 closure.

## Scheduled closure observation — 2026-10-17 13:52 UTC

Read-only Supabase, GitHub and Vercel checks at approximately 13:52–13:54 UTC.
Started on clean main `5302dc3`; fetch confirmed main equals origin/main.
Documentation recorded locally on `task/m1-m2-closure-observations`; no push,
deployment or production mutation.

- Feed-refresh job 5 active at `*/5 * * * *`, expected production Vercel refresh
  URL confirmed as a boolean without retrieving its command/secret. Six recent
  cron executions succeeded, latest 13:50 UTC. Last 30-minute feed outcomes:
  17 ok, 10 unchanged, no failed outcomes.
- Seventy distinct modules / 257 variants serving, zero states above three
  consecutive failures. Fixtures and both charts completed their fourth genuine
  ordinary hourly opportunity at 13:50 UTC (prior 10:40, 11:40, 12:45); no retries
  or manually triggered refreshes counted. Both charts retain 25 items and zero
  failures, next due approximately 14:50 UTC.
- Fixtures current-run seven events: English Premier League 2, NBA 2, Spanish
  La Liga 2, Indian Premier League 1. All eight next/past windows checked;
  IPL-next empty, remaining seven ok. Fourteen retained items include history.
  Fetched 13:50:02.498930 UTC; next due 14:50:02.498930; zero failures.
- MLA Profiles reference remains the genuine 10:45 UTC run, 400 profiles with
  400 stable `mla-profile:` keys plus 100 coverage rows, serve on and healthy.
  Next due October 18 10:45 UTC. No new daily opportunity has elapsed.
- World Constitutions: 188 rows/distinct keys, all `constitute:`, sorted
  newline-joined MD5 `c14635ffbc17cef3a5ace4fc74273578`, identical to inventory.
  Still last refreshed October 16 15:40 UTC; first post-rollout daily opportunity
  due October 17 15:40 UTC. Identity is verified, multi-run stability not yet.
- Zero states have whole-feed `meta.availability=empty`; no new production empty
  outcome claimed. IPL-next remains an explicit truthful empty coverage window;
  existing local empty-contract evidence stands.
- Exact Vercel project/team API fallback: production
  `dpl_9x4jNNLXBW1iNySGQ6WADtji4JNs` READY,
  `niyantran-cd3zeypqd-ddl-labs.vercel.app`, source
  `5302dc302a21cd8571c1ad8ca6226e6fc75cd86b`, matching origin/main.
- Latest three genuine CI runs remain green:
  [39034204827](https://github.com/ddllabs/niyantran/actions/runs/39034204827),
  [39034521190](https://github.com/ddllabs/niyantran/actions/runs/39034521190),
  [39035656870](https://github.com/ddllabs/niyantran/actions/runs/39035656870).
  Their attempt-1 app/SQL success was verified during release; the final run was
  read back again in this observation, both jobs success, attempt 1. No retries,
  cancellations or manufactured commits counted. CI component remains satisfied.
- Approved behavioral evaluation already executed as recorded above; no new
  paid calls. F221 remains open. Owner's separate F223 read-only diagnosis was
  reported: reproduced MLA Directory live-first timeout/store bypass; the exact
  original two failing feature names remain unknown. Proposed two-module fix
  awaits approval, no backend changes. Sole tracker reconciled with that report;
  no repeat failure notification or extra diagnostic production probe here.

T15 remains open for actual daily reference opportunities. Follow-up ACTIVE;
no new actionable failure or overall completion, so no notification. No forced
refreshes, production writes/config/timer changes, deployments, corpus operations,
payment work, dotenv/credential-file reads or provider calls.

## Scheduled closure observation — 2026-10-17 14:48 UTC

Read-only checks at approximately 14:48–14:50 UTC. Checkout began clean on
`task/m1-m2-closure-observations` at `1107bff` (local documentation only).
Fetch confirms main equals origin/main at `5302dc3`; no source changes.

- Feed-refresh cron job 5 remains active every five minutes with the expected
  production Vercel refresh URL (boolean-only check, no command/secret readback).
  Six last-30-minute cron executions succeeded, latest 14:45 UTC; feed runs
  were 19 ok / 22 unchanged, no failed outcomes.
- Seventy distinct modules / 257 variants serving, no state above three
  consecutive failures. Monitored references, fixtures and charts all healthy.
- No new monitored-source run since the prior check. Fixtures and both charts
  remain at their fourth ordinary opportunity at 13:50 UTC; next due just after
  14:50 UTC, so no opportunity was missed at the 14:48 query. Do not force it or
  count another request as an opportunity. Both charts retain 25 items each.
- Fixtures still has seven current-run events: Premier League 2, NBA 2, La Liga
  2, IPL 1; 14 retained items include history. All eight windows are checked:
  IPL-next explicitly empty, the other seven ok. Zero failures.
- MLA Profiles reference unchanged: 400 profiles with stable profile keys plus
  100 coverage records, fetched October 17 10:45 UTC, next due October 18 10:45
  UTC. No new daily interval has elapsed.
- Constitutions unchanged: 188 distinct `constitute:` keys, MD5
  `c14635ffbc17cef3a5ace4fc74273578`, identical to the approved inventory. Last
  refresh October 16 15:40 UTC; first post-rollout opportunity still due
  October 17 15:40 UTC. No extra stability credit from repeated reads.
- No live whole-feed `meta.availability=empty`; no new production empty outcome
  claimed. Existing empty-contract evidence and explicit IPL-next metadata stand.
- Exact-scope Vercel CLI API readback: production
  `dpl_9x4jNNLXBW1iNySGQ6WADtji4JNs` remains READY at
  `5302dc302a21cd8571c1ad8ca6226e6fc75cd86b`, matching origin/main.
- Latest three genuine CI runs are unchanged and successful: 39034204827,
  39034521190, 39035656870. Their attempt-1 app/SQL outcomes were already
  individually verified; the listing has no intervening/new run. CI gate remains
  satisfied, no retry/empty commit counted.
- Approved behavioral evaluation remains executed as documented, no new paid
  calls. F221 remains open; F223's diagnosed store-bypass proposal still awaits
  owner approval. No new diagnostic probe or backend changes in this follow-up.

T15 remains open for real daily reference observations. Automation remains
ACTIVE. No new actionable failure or completion; no notification. Only these
local evidence/tracker records changed; no push/deploy, production writes,
timer/serve changes, forced refresh, corpus operation, payment work, provider
call or dotenv/credential-file read.


## F223 release and closure observation — 2026-10-17 15:40 UTC

Owner explicitly approved the scoped MLA Directory/Profiles implementation and
push/deploy after diagnosis. Runtime `0c1319c` is READY at
`dpl_8cMAHjxjfBroGdaPLeHz1MwNuJdp`, matching main. Branch/main CI 39045568101
and 39045994021 passed both app and SQL jobs on attempt 1. Local 6,166 Vitest /
1,155 Deno, lint/build/bundle/router pass; original runtime fails nine new guards.
Production summary/module pairs answer 200/store with matching source notes,
fetch times and counts: Directory 496 sampled rows (4,104 full stored), Profiles
500. MLA store fingerprints and all ten Edge Function versions/hashes/settings
are unchanged. Bounded logs through about 15:41 show no 5xx, only existing Node
DEP0169 warnings. Detailed scope, failures and limitations are preserved in
[F223 release evidence](2026-10-17-f223-state-summaries-evidence.md). No schema,
Edge Function, data/timer/serve or forced-refresh changes were part of F223.

Read-only closure queries at 15:40–15:42 UTC:

- Cron job 5 remains active `*/5 * * * *` with the expected production refresh
  URL (boolean only); six recent cron successes, latest 15:40 UTC. Last-30-minute
  feed outcomes 12 ok / 29 unchanged, zero failures.
- Seventy serving modules / 257 variants; zero sources above three consecutive
  failures and zero whole-feed meta.availability=empty outcomes.
- Fixtures and both charts completed their fifth genuine hourly opportunity
  at 14:55 UTC, all ok. Charts 25 items each. Fixtures current run has seven
  items, 17 retained items including history; all four league windows checked,
  IPL-next explicitly empty and seven other windows ok. No full-schedule claim.
- MLA reference still 400 distinct stable profile keys + 100 coverage records,
  fetched October 17 10:45 UTC; next daily opportunity October 18 10:45 UTC.
- World Constitutions still 188 distinct stable constitute: keys, inventory MD5
  c14635ffbc17cef3a5ace4fc74273578, unchanged. Last refresh October 16 15:40 UTC;
  first post-rollout daily opportunity was due just after the 15:40 poll, so
  ordinarily becomes eligible for the 15:45 poll. This query precedes that
  opportunity; do not credit a run that has not happened.
- Approved bounded behavioral evaluation remains executed as recorded; no new
  provider calls. F221 remains separate. The hourly follow-up is ACTIVE.

T15 remains open for three real daily reference opportunities. This F223 release
has separate explicit owner authority; it does not broaden the read-only monitor
or authorize corpus/payment work. No credentials/dotenv read, forced refresh,
corpus operation or payment work. Final documentation checkpoint CI/deployment
is verified after its push in the completion report.
