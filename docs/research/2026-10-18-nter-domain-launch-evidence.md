# D2 application launch execution

> **Status: Living.** 2026-10-18 IST. Owner approved proceeding with the D2
> plan, checking/saving the old Vercel URL first, and requesting Namecheap login
> when needed. Razorpay held; corpus ingestion excluded.

## Old website retained address — verified before any handover

**https://niyantran-weld.vercel.app/** is publicly accessible, HTTP200.
The former source repository `ItsCloudDev/niyantran` publishes this address
in its homepage metadata. No upstream remote was added or fetched.

Its public entry HTML and https://www.nter.pro/ both contain701 bytes and have
the same SHA256:

`ece75a0151d0b53baaa9d5160e00d0d3947701c99b4a032739739c0596732a58`

Both reference `/assets/index-CSPSnG4I.js` and
`/assets/index-CRDikyBL.css`. This is evidence of matching public entry pages,
not an assertion about the unknown owning project's Git commit. The Vercel
address is a project alias, not a verified immutable deployment URL; its owner
can change/remove it. No old project or deployment is to be deleted. Moving
nter.pro does not intentionally remove this alias, but continued ownership and
availability cannot be guaranteed from our account.

Initial public DNS confirms Cloudflare NS julio/sara, apex A64.29.17.1 and
216.198.79.1, and www CNAME `d88d44ae01c786a8.vercel-dns-017.com.`.
No DS answer was returned. MX answers identify Namecheap forwarding:
eforward1/2/3.registrar-servers.com priority10, eforward4 priority15 and
eforward5 priority20. Root SPF is
`v=spf1 include:spf.efwd.registrar-servers.com ~all`; no DMARC answer observed.
These forwarding records must be preserved, and the owner must confirm the
forwarding destinations and any other services. Public DNS is not a complete
zone export. Exact records are rechecked immediately before switching.

Local HTTP/DNS capture files are under /tmp/niyantran-d2-* and are untracked.
Credentials, frontend keys and dotenv contents were not read or printed.
No DNS, domain association, backend configuration or public traffic change
has occurred at this checkpoint.

## Approved Auth/CORS preparation — 2026-10-18, 14:37 IST

Owner explicitly approved Supabase Auth/CORS changes and Vercel preparation,
while holding nameserver changes. Client confirms no existing domain email
service. Known public mail records will nevertheless be preserved at cutover.

### Auth configuration saved and inspected

Added exactly these four destinations in NTER Authentication → URL Configuration:

- `https://nter.pro/`
- `https://www.nter.pro/`
- `https://nter.pro/#/reset-password`
- `https://www.nter.pro/#/reset-password`

The saved page lists10 destinations, versus6 beforehand. Site URL remains
`https://niyantran-six.vercel.app/` until the new domain serves the application.
Signup/resend use that default; Google returns to the browser origin and recovery
returns to `/#/reset-password`. The production router explicitly excludes the
older `/api/auth/*` server handler, so its APP_URL/SITE_URL variables were not
changed. Confirmation settings, providers, Google Console, accounts and email
delivery were not modified or exercised. This verifies configuration persistence,
not a completed user sign-in or delivered message.

Existing broad `https://*.vercel.app/**` and malformed
`https://https://niyantran-six.vercel.app/**` entries were observed and left
unchanged. Review removal against actual required preview destinations before
the owner pilot; no broader wildcard was added for the custom domain.

### CORS configuration and verification

The existing public origin list in the September29 operations record hashes
exactly to the digest observed in the dashboard:
`d1716e14a56ca10670edaf6de5ad9bd1c3cf4481a27a94682ffbf9810130e7ac`.
It contains production, localhost5173 and the existing project preview pattern.
This established the full old value without reading credential values.

Executed successfully with the authenticated CLI, explicitly targeting NTER:

```sh
XDG_CONFIG_HOME=/tmp/niyantran-supabase-config SUPABASE_TELEMETRY_DISABLED=1 supabase secrets set 'ALLOWED_ORIGINS=https://niyantran-six.vercel.app,http://localhost:5173,https://niyantran-*-ddl-labs.vercel.app,https://nter.pro,https://www.nter.pro' --project-ref vfgcppstyzjarlzyqdac
```

CLI reported one setting updated. Dashboard digest after refresh matches
`4d6b5062b51ff25819c39c45f63fd3fedd8a93ba250bbf6d737e2916b16e0a35`,
updated09:07:12 UTC (14:37:12 IST). No dotenv/credential folders were read.

Python urllib OPTIONS checks against each of `research-chat`, `desk-brief`,
`document-file`, `transcribe-audio` and `admin-models` passed35/35. Each returned204;
both custom origins, current production, localhost5173 and a project branch
preview received the exact Access-Control-Allow-Origin value. An unrelated
origin and `https://nter.pro.evil.invalid` received no such header. The same
five functions rejected both custom origins before preparation. No model call,
email send, account creation, ingestion invocation or database test was used.

Supabase incremented every Edge Function version counter following the shared
setting update. Before/after list_edge_functions confirms all10 bundle SHA256
values are identical; no deploy command was executed. Ingestion versions changed
only as part of that platform configuration update: ingest-documents21→22,
ingest-worker3→4, admin-ingest4→5; their hashes stayed respectively
`7b92a8353d958d44d2c589d306585a00d252539b4373f7a673680fc31ea3021c`,
`ea5c76cc28ffde52d935d84516aecdcc3b847b54dba604b1e2df47e9737bdbd1`,
`415a90afab11860e09b4762229c71ffbdefd28501ba0d50f2f8ff8b6b0633d9d`.
Corpus code, worker inputs and timers were not changed.

### Vercel preparation and unchanged routing

Authenticated read-only domain configuration requests for the exact project/team
returned these rank1 routing recommendations:

| Type | Namecheap host | Value |
|---|---|---|
| A | @ | 216.198.79.1 |
| A | @ | 64.29.17.1 |
| CNAME | www | 1636509a93bb7d79.vercel-dns-017.com. |

The ownership challenge is prepared at `_vercel.nter.pro`; its current value is
kept outside Git and must be rechecked at handover. Claim/verification and any
additional project-hostname challenge remain pending. Preparing the records is
not a verified domain association. Our project still has only its vercel.app
hostname; no Vercel association, redirect, ownership or certificate change was
made. Do not publish ownership tokens into the repository.

After preparation, public NS still answers julio/sara Cloudflare and DS has no
answer. Old www entry HTML retains the identical SHA256 above; the existing
niyantran-six.vercel.app application responds HTTP200. Thus neither website
was moved by these changes.

### Remaining launch gates and recovery

O10 hosting readiness, DNS/service inventory beyond the client's email answer,
coordinated Namecheap authority switch, Vercel ownership/project verification,
HTTPS/redirect checks, canonical Site URL change, actual email delivery and
owner-operated sign-in/answer pilot remain pending. Razorpay and corpus ingestion
remain excluded; this preparation does not close M1/M2 T15 or D2.

If preparation must be reverted before cutover, remove only the four newly
added Auth URLs and restore the exact three-origin value documented above.
Do not restore unrelated settings or change nameservers. Current Site URL and
old routing already remain in place. After cutover, reassess recovery against
active traffic rather than blindly applying this pre-cutover rollback.

Only specification, plan, tracker and this evidence document changed locally;
no source changes or push. npm/Deno/build checks were not run for configuration
and documentation-only work. Runtime acceptance here is the saved Auth page,
matching CORS digest,35 preflight checks, unchanged bundle hashes and unchanged
DNS/old-site checks. Google Console and actual email delivery remain unverified.

## Handover authorized; Pro verified; DNS save blocked — 2026-10-18

Owner reports completing Pro upgrade and explicitly authorizes nter.pro
handover. Authenticated GET /v2/teams/team_QFu1p3ObeXmlMQczPBcZb582 confirms
slug ddl-labs, billing.plan pro, billing.status active. O10 is complete.

Executed authorized POST /v10/projects/prj_6UiaDz2rkTOmqIOaXnCAs92V7d86/domains
with the exact team scope, sequentially for www.nter.pro and nter.pro. Both
responses identify the intended project and verified=false. The apex is
configured for308 redirect to www.nter.pro. Each returned a distinct project
TXT challenge at _vercel.nter.pro. Challenges stay outside Git; satisfy both
plus any required team claim challenge during handover. No force reassignment,
ownership claim or verify call executed yet. The existing app alias remains.

In Arc, selected Namecheap BasicDNS for nter.pro without saving. The Save action
was rejected by automatic approval review: changing DNS authority before the
Vercel/TXT/A/CNAME/preserved-service records are entered risks an avoidable
production outage, and the existing handover approval did not clearly authorize
that intermediate state. No indirect workaround or repeat save attempted.
Canceled the unsaved selection; page again shows Custom DNS with julio/sara.

Subsequent public DNS still returns the two Cloudflare nameservers. Old www
returns HTTP200 and its entry HTML retains SHA256
ece75a0151d0b53baaa9d5160e00d0d3947701c99b4a032739739c0596732a58.
No active traffic or Supabase Site URL change occurred in this phase.

Provider documentation confirms BasicDNS record editing requires that DNS mode.
FreeDNS documents zone pre-setup, but for domains registered elsewhere and with
TXT/domain-email authorization; neither route is established for this domain
without the old DNS access. No safe pre-provisioning route has been verified.
Next: ask support to prepare BasicDNS before delegation (no support message sent),
obtain old DNS access, or obtain explicit owner approval of a controlled outage
interval before retrying the rejected sequence. Propagation/recovery duration
cannot be guaranteed. Razorpay and corpus ingestion remain excluded.

## Controlled cutover explicitly approved and saved — 2026-10-18

Owner explicitly approves the controlled cutover and possible temporary downtime.
The same BasicDNS Save action now succeeds. Namecheap's reloaded Domain page
shows Namecheap BasicDNS; no redirect/forwarder is configured. The newly exposed
zone contained stale A @75.2.60.5 and www CNAME niyantran-chronicle.netlify.app,
which were inactive under Cloudflare and could not be inventoried earlier.

Updated the existing apex A to216.198.79.1 and www CNAME to the prepared project
target, then added A @64.29.17.1 and three _vercel TXT records (two hostname
challenges plus team ownership). Every row saved and inspected. Left Email
Forwarding enabled with its existing SPF. Direct dns1/dns2.registrar-servers.com
queries confirm both A records, www CNAME, all three TXT values, five forwarding
MX records/priorities and unchanged SPF. BasicDNS NS answers dns1/dns2.

As of the initial post-save checkpoint, .pro registry servers a0 and b0 still
delegate to julio/sara Cloudflare;1.1.1.1 and8.8.8.8 agree. This is a pending
delegation update, not a completed handover. An initial www project verify call
returns400 (domain on different project); team ownership claim first returned415
without a JSON content type, then400 TXT-not-found with the documented JSON
request. No claim succeeded, no bypass/force operation occurred. Wait for real
delegation and TXT visibility before another verification attempt. The current
application alias returns HTTP200. Keep Supabase's current Site URL until the
custom domain actually reaches the intended application.

Screenshot of the saved zone is /tmp/niyantran-d2-basicdns-records.png; ownership
challenge values stay outside Git. No provider keys, dotenv files or credential
folders read. No source, payment, ingestion or application database operation.

Expected release captured read-only from Vercel production: READY deployment
dpl_3TAwkp7cPozmhA8EmM7J5jULc66F, URL
niyantran-dj7fusqzs-ddl-labs.vercel.app, Git commit
e45f2983f67527b1c20382b1bb24cb9cf61f04dd. Current application entry HTML is701
bytes, SHA256780f3c662586dc19eb0a5417a703f30bea7306b860386726bf327b38cd05983d,
referencing /assets/index--lFxNCpC.js and /assets/index-Dn1RzqUY.css. At this
checkpoint both old www and niyantran-weld still return200 and the earlier old
entry hash. These distinguish a real release handover from merely valid HTTPS.

## Technical handover verified — 2026-10-18, 15:22 IST checkpoint

A bounded read-only registry watch observed delegation change to
dns1.registrar-servers.com and dns2.registrar-servers.com. The subsequent
authenticated JSON POST /v9/domains/nter.pro/claim succeeded: verified=true,
teamId=team_QFu1p3ObeXmlMQczPBcZb582, serviceType=external. Sequential project
verify requests for www.nter.pro and nter.pro both succeeded with verified=true
and projectId=prj_6UiaDz2rkTOmqIOaXnCAs92V7d86; apex redirect=www.nter.pro,
redirectStatusCode308. No registrar transfer or old deployment deletion.

Normal HTTPS urllib requests (certificate validation enabled, no TLS bypass):

| Address | Result |
|---|---|
| https://nter.pro/ |308, Location https://www.nter.pro/ |
| https://www.nter.pro/ |200, current production entry SHA256780f3c662586dc19eb0a5417a703f30bea7306b860386726bf327b38cd05983d |
| https://niyantran-six.vercel.app/ |200, identical current production entry hash |
| https://niyantran-weld.vercel.app/ |200, old entry SHA256ece75a0151d0b53baaa9d5160e00d0d3947701c99b4a032739739c0596732a58 |

Set NTER Authentication Site URL to https://www.nter.pro/ only after the above
routing checks. Saved and reloaded the page: new Site URL persists, all10 Auth
redirect entries remain. No confirmation/provider/OAuth Console settings changed.
The existing malformed and broad preview entries remain separately noted above.

Arc renders the new marketing application on the custom domain, with current
record counts; its Sign in button opens /#/login and shows the password/Google
controls. No account was created, no sign-in submitted and no model invoked.
GET https://www.nter.pro/api/home/segments returns200 JSON with ok/timestamp/
segments keys. Final15/15 OPTIONS checks across five browser-facing functions
allow both custom origins and deny an unrelated origin. The earlier35/35 checks
also cover existing production, localhost, preview and lookalike rejection.
list_edge_functions confirms all10 versions and hashes unchanged since the
earlier CORS configuration update; no ingestion invocation or code deployment.

Public DNS propagation remains mixed at the final sample: Google8.8.8.8 sees
new nameservers while Cloudflare1.1.1.1 retains older delegation/www CNAME in
cache. Registry delegation and direct BasicDNS records are correct; actual
public HTTPS nevertheless serves the new release. Both forwarding MX/SPF
inventories match the preserved values, DS remains absent. Do not rewrite correct
records to chase resolver caches; allow normal expiry.

Saved screenshots outside Git: /tmp/niyantran-d2-basicdns-records.png,
/tmp/niyantran-d2-site-url-live.png, /tmp/niyantran-d2-live-site.png.
Only documentation changes locally; no source/Git publication, payment,
application-data migration, credit change or corpus operation. git diff --check
passes. npm/build/Deno suites are not applicable to this configuration-only
handover. Owner-operated actual sign-in, recovery/confirmation email delivery,
reload/conversation and bounded answer/debit pilot remain pending, so D2 stays
open despite the completed technical domain handover. M1/M2 T15 is independent.

## Owner sign-in and reload persistence verified — 2026-10-18

Owner reports sign-in complete. Read-only Arc inspection confirms the custom
domain /#/national renders the authenticated National desk, the admin account
menu, Log out control and10,000-credit badge. Reloaded that page without signing
in or sending any request manually: authenticated desk, source counts, account
menu and10,000-credit badge remain visible. This proves observed session
persistence and wallet display, not ledger reconciliation or model behavior.
No chat message, model call, credit charge, corpus operation or production
configuration change was triggered by the verification. Actual recovery/
confirmation email delivery and conversation/answer/debit pilot remain pending.
Updated the existing D2 tracker and living spec/plan; git diff --check passes.


## Saved conversation and bounded credit pilot — 2026-10-18, 15:43 IST

Owner authorized saved conversations and one bounded chat/credit deduction.
The active owner session is now the existing `vs` account, distinct from the
admin session in the earlier checkpoint. Before sending, read-only SQL at
10:12:33 UTC verified balance3309.553 credits, debt0,20 ledger rows and676
model-call rows. Opening the October17 Indian Statistical Institute saved chat
restored its existing question, answer, citations and receipt; its two persisted
messages remain unchanged. No follow-up was sent in that conversation.

A separate fresh conversation used Gemini2.5 Lite (`google/gemini-2.5-flash-lite`),
reasoning off, no attachments/selected record and automatic web search off.
The only message sent was `Hello`, which the server's narrow small-talk path
recognizes and excludes from retrieval/presearch. The UI answered
`Hello! How can I help you today?` in about3 seconds and displayed5.06 credits.
The normal application has automatic failover, so the initial single-call intent
was verified against actual call evidence rather than treated as a configurable
hard call limit. No manual retry, second prompt or forced refresh was performed.

Read-only production reconciliation:

| Evidence | Result |
|---|---|
| New conversation | `cbadd8a4-c651-4951-b686-58377a081540`, title Hello, exactly2 complete messages |
| New call | `fb20f4d7-df4c-481a-8b42-04b194471ab6`, research-chat/chat_answer, success, requested/served Gemini2.5 Lite |
| Usage |5143 prompt tokens,47 completion tokens, costUSD0.000533 |
| Charge | `77746ec0-c8b2-46b6-8047-66b8520af937`, one charge row, -5.0635 credits |
| Accounting |USD0.000533 ×95 INR/USD ÷0.01 INR/credit =5.0635 credits =INR0.050635 |
| Wallet |3309.553 →3304.4895, debt0; movement exactly equals charge |
| Cost mapping | One credit_charge_rows mapping joins the above call and ledger IDs, costUSD0.000533 |
| Hold | Turn `4d7f016a-d97b-4e24-bf17-bdd780d75214` settled10:13:12 UTC at one-paisa rate |
| Bound | Exactly1 additional call and1 additional ledger row; cost belowUSD0.10 ceiling |

Reloaded the page, reopened History and selected Hello. Both messages, model,
timing and5.06-credit receipt reappear. Subsequent SQL still reports677 calls,
21 ledger rows and3304.4895 credits: no replay charge or extra grant on reload.
The saved hold row is an audit record with settled_at populated, not an active
unsettled reservation. An exploratory SELECT first referenced a nonexistent
hold status column and failed; schema inspection followed by settled_at query
succeeded. All production SQL was read-only.

History interaction showed an empty New research deletion confirmation while
opening the menu; no deletion was submitted. Selecting the intended saved chat
worked, and the old/new conversation counts remained correct. This observation
does not establish a product defect separately from native interaction behavior.

Screenshot: /tmp/niyantran-d2-chat-pilot.png (outside Git). Source, configuration,
DNS and deployment were not changed. Only the authorized normal chat persisted
its messages, call log, settled hold and charge. No source-test rerun is applicable
because this slice changes documentation only; git diff --check is the local gate.

Recovery remains owner-operated and unverified. Owner was guided to open a
private window at https://www.nter.pro/#/forgot-password, submit their account
email once, check actual inbox/spam delivery, open the latest link themselves,
complete password entry/submission themselves and sign in again on nter.pro.
The generic success notice is intentionally anti-enumerating and appears even
on send errors, so it cannot prove delivery. Do not capture reset tokens or
passwords. D2 remains open pending actual email/reset/sign-in evidence and final
observation; T15 is independent, Razorpay held and corpus ingestion excluded.


## Final launch gate — 2026-10-18, 15:50–15:55 IST — held on F226

Owner explicitly confirms recovery email, password reset and subsequent sign-in
all worked. This is owner-reported execution evidence; no recovery token,
password or inbox content was inspected. The email/reset requirement is passed,
not pending. The existing custom-domain session remains visible in Arc.

Final read-only verification:

- Fetched origin successfully with the permitted network/Git access. origin/main
  remains `e45f2983f67527b1c20382b1bb24cb9cf61f04dd`; current task HEAD6711578
  contains local domain documentation, not a different live application build.
- Same-scope authenticated Vercel CLI API confirms both custom domains verified
  on `prj_6UiaDz2rkTOmqIOaXnCAs92V7d86`, apex308 to www, production deployment
  `dpl_3TAwkp7cPozmhA8EmM7J5jULc66F` READY at exact origin/main commit.
- Normal certificate-validating HTTPS: apex308; www and niyantran-six200 with
  expected SHA256780f3c662586dc19eb0a5417a703f30bea7306b860386726bf327b38cd05983d;
  old niyantran-weld200 retains old hash. /api/home/segments200, valid JSON.
- Google8.8.8.8 sees BasicDNS NS and expected www CNAME. Cloudflare1.1.1.1 still
  caches earlier Cloudflare NS/CNAME. Both return expected apex A addresses,
  preserved five MX targets and no DS. This is partial resolver propagation,
  not permission to rewrite correct records. Actual tested HTTPS is correct.
-20/20 OPTIONS checks pass across research-chat, desk-brief, document-file,
  transcribe-audio and admin-models: both custom origins and retained production
  allowed exactly, unrelated origin denied. No function invoked via POST.
- Billing config200 reports enabled=false, checkoutOpen=false, demoFallback=true;
  only non-key flags were projected. No checkout/order action performed.
- At10:20:23 UTC the pilot wallet is still3304.4895, debt0, ledger21, calls677;
  two pilot messages, one -5.0635 charge at INR0.01 and zero active pilot holds.
  No duplicate debit/grant after recovery or reload. A SELECT initially used
  nonexistent credit_settings flag columns and failed; schema inspection and
  corrected read-only query succeeded. No database mutation.
- Supabase read-only Edge list confirms all10 versions/hashes unchanged since
  CORS preparation. No corpus function invoked, modified or redeployed.
- Supabase log window09:52–10:21 UTC has zero HTTP5xx in edge_logs and
  function_edge_logs. One earlier auth400 is invalid_credentials; subsequent
  token/user200s and owner-reported successful recovery/sign-in establish that
  this is not evidence of a domain redirect failure. No repeated auth5xx found.

The Vercel request gate **does not pass**. Bounded CDN request scan09:52–10:20
UTC found four GET /api/national-landing502s on www.nter.pro at09:55:51,
09:57:05,10:05:19 and10:08:15 UTC. Runtime error/fatal scan09:52–10:19:22
returned only two DEP0169 url.parse deprecation warnings (site-icon and
analytics/event), not an exception explaining the502s. No excluded intervals
or additional page of results in either scan. Logs and runtime warnings are
separate evidence; a clean exception stream does not erase failed requests.

A bounded pass of16 unique National summary resources identified one failure:
Policy Pipeline Tracker (Draft-to-Gazette) returns502, ok=false, count=null,
availability=error, served=live. The other15 return200, including truthful
Central Tender empty count0. Policy Intelligence Graph shares the Bills
resource and was not redundantly requested. The same Policy Pipeline summary
returns502 on niyantran-six.vercel.app, so failure is not specific to the
custom hostname.

Its module /api/feature-feed returns200, ok=true, served=store, fallback=false,
with3 prepared rows. Direct SELECT confirms its scheduled store has26 rows,
serve=true, fetched/checked09:25:00 UTC, zero consecutive failures and no error.
These raw-store and prepared-module counts are different layers, not a claim
that the module must expose all26 rows. Existing source shows both routers
send the National landing through serveFeatureFeedWithBackup (live-first),
while the module uses serveFeatureFeedStoredFirst. A successful stored module
can therefore coexist with an unavailable live-first landing summary.

**F226 proposed scope, not implemented:** route only Policy Pipeline's National
summary through the existing stored-first loader in api/router.js and the
local server/featureFeed.mjs handler. Add focused tests proving that this
feature uses stored rows when the live source fails, freshness/fallback behavior
remains truthful, and other National features keep their current loader.
Verify focused guards red-before-green, lint, both required suites for server/
src/lib scope, build, router import and bundle gate; after separately approved
release verify both aliases and bounded request logs. This is the same narrow
loader-choice pattern already used for Satellite/MLA summaries. No data backfill,
forced refresh, schedule/serve change, corpus or payment work is proposed.

D2 stays open because its final observation gate found this reproducible fault;
owner recovery success is retained as passed. F226 is recorded in the sole
open-work tracker, with backend implementation/release awaiting owner approval.
No source edits, production configuration writes, paid calls, push or deployment
in this final-check slice. Documentation changes remain local; git diff --check
is the applicable gate. Initial sandbox DNS/fetch attempts failed due to local
network restrictions; approved read-only retries outside that sandbox succeeded,
so these are not classified as production availability failures. No broad CI or
source-test rerun was claimed for documentation-only updates. Razorpay held;
corpus ingestion excluded; independent M1/M2 T15 is not closed by D2.


## F226 implementation — 2026-10-18, release pending

Owner authorized final fixes/checks after the scoped diagnosis. Amended the
existing D2 spec/plan before source edits. api/router.js and the local
server/featureFeed.mjs handler now select serveFeatureFeedStoredFirst only for
National Policy Pipeline. server/nationalLandingSummary.mjs preserves fetchedAt
and permitted stale/age metadata, matching the existing Global pattern. No
filter, row count cap, schedule, serve flag, data or freshness-rule change.

New src/lib/nationalLandingStore.test.js exercises both real routers with
synthetic external boundaries: relevant-row count with no upstream request,
retained stale provenance, missing/disabled/empty/over-ceiling stores, live
fallback, unrelated National route and pre-read validation. The source-failure
fixture reproduces PIB index success followed by inaccessible release pages;
a total network failure can legitimately return an embedded fallback, which
is a different existing behavior and was not changed. Before the fix four
fresh/stale regressions failed because both routers returned502 instead of200;
14 existing-contract assertions passed. After the fix all18 cases pass, and
all102 focused assertions across National API/store, Global API and cache policy
pass. A first green attempt exposed an underspecified three-word synthetic
policy title, correctly excluded by the existing four-word relevance guard;
corrected only the fixture to a four-word title, retaining expected3 rows.
The full suite already in flight used that old fixture (6238 pass/4 fail), so
it is rerun once on the final fixture. No production filter was loosened.

Deno1155 tests pass; lint, router import, build and bundle gate pass. Build
retains the known >500kB chunk warnings; bundle initial gzip180405 bytes is
within182446-byte limit. No SQL change or local database container use; branch
CI will run its ordinary disposable SQL fixtures. Committed public data remains
unchanged. Source review confirms exact feature/path gating, identical local/
Vercel behavior, existing store failure/age handling, bounded projection and no
new secrets, auth/payment routes, fetch/write path or dependency. Live evidence
and final full-suite/CI results must follow before closure.


The final-fixture full run finished6241 pass/1 timeout: existing
featurePage.test.js Bill Passage default-view case exceeded its unchanged5s
limit (7.294s during a334.15s run, compared with the earlier99.49s run).
All18 new regressions passed. No assertion mismatch or production code fault
was established by this timing failure. Recheck that file and retry the full
suite once at the original limits; do not change unrelated paging code or
raise timeouts to obtain green. Report both attempts, not only the retry.


Final local gate: featurePage recheck46/46 passed (4.86s); unmodified full-suite
retry6242/6242 passed across395 files (115.34s), including the previously timed
out paging case. Deno1155/1155,102 focused assertions, lint, build, router import,
bundle and git diff --check pass. No test skipped or timeout raised; public/
remains unchanged. Source committed locally as441343e (four paths,110 additions/
3 deletions including the18-case regression file). D2 configuration/pilot/final
checks are documented alongside the fix; branch/main publication and production
verification follow. No unrelated local top-up-price branch is included.


## F226 release verified; D2 closed — 2026-10-18, 16:20 IST

Branch CI39120245451 at6c08b48 passed both application and SQL jobs on attempt1;
main was fast-forwarded and pushed to origin at the same exact commit.
Main CI39120540412 also passed both jobs attempt1. Application jobs execute
lint/build/router,6242 app tests, public-data cleanliness and1155 Deno tests;
SQL fixtures execute only in CI's disposable Postgres containers. No container
on the owner's laptop was started or used. Source441343e is included; separate
local top-up-price branch0bab1fc was not merged/published incidentally.

Vercel production dpl_3zLWhoTXdAycyofcGAwU7BquJ2JJ is READY at exact
6c08b48ac527524a04a8b102eea8d2ce86c2db52, with aliases www.nter.pro,
nter.pro and niyantran-six.vercel.app. No CLI source upload or Edge deploy.
At10:47:06 UTC both www and retained Vercel URL return200 for Policy Pipeline
summary and module: summary count3, module3 rows, served=store, fetchedAt
2026-10-18T10:30:00.244Z, fresh (no stale flag). The normal schedule refreshed
the store; no refresh endpoint was called. Both current entry hashes remain
780f3c662586dc19eb0a5417a703f30bea7306b860386726bf327b38cd05983d (frontend
unchanged); old alias200 retains its separate old hash. Home segments API200.
A post-release pass of16 unique National resources returns16/16 successful200s,
including the fixed Policy Pipeline and truthful empty Tender result.

20/20 OPTIONS checks again allow both custom origins and retained production,
deny the unrelated origin across five browser-facing functions. GET billing
config still enabled=false, checkoutOpen=false. At10:46:43 UTC pilot wallet
3304.4895/debt0; pilot conversation exactly2 messages/1 call/1 charge -5.0635,
no active hold. No further paid request. Read-only function inventory compares
all10 versions and bundle hashes exactly equal to the post-CORS baseline.

New-deployment request scan10:46:23–10:48:16 UTC returns zero HTTP5xx;
no pagination or excluded intervals. Runtime error/fatal scan10:46:23–10:48:44.990
returns10 entries, all Node DEP0169 url.parse deprecation warnings, zero other
exceptions, no pagination or excluded intervals. Full result set was classified
after initial text truncation, rather than inferring omitted lines were safe.
These are bounded observations, not a guarantee about future upstream uptime.
The last public DNS sample still had Cloudflare resolver caches on the old
NS/CNAME while registry/BasicDNS and Google resolver were correct; HTTPS worked.
No DNS rewrite is warranted merely to change a cached resolver answer.

Owner previously completed the real browser sign-in/recovery/reset/sign-in,
saved-conversation reload and bounded debit pilot. Post-fix verification uses
actual public API responses through both production hosts; no new browser
sign-in or paid chat was repeated. The owner browser had moved to unrelated
work, so it was not navigated or changed and no new visual assertion is made.
Source/frontend contracts and prepared module count remain verified by tests
and actual responses.

All scoped D2 gates now pass. F226 and D2 moved to Done with source/release
hashes; the existing broad/malformed Auth allowlist cleanup is now F227, so it
is not lost when D2 closes. Independent T15 scheduled daily observations remain
open. Razorpay remains held and corpus ingestion excluded. Closure record
publication is documentation only; no further production configuration, model,
feed-data, source timer or ingest action is authorized by closing D2.
