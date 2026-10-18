# D2: nter.pro application launch plan

> **Status: Living.** 2026-10-18. Owner approved Auth/CORS changes and Vercel
> domain preparation, then authorized handover after completing Pro upgrade.
> Owner explicitly approved the controlled interruption after the initial
> approval-review rejection. Technical handover completed: BasicDNS, ownership,
> both hostnames/HTTPS, canonical redirect and Supabase Site URL verified.
> Owner sign-in/reload, saved history and one-call answer/debit verified.
> Owner confirms recovery-email/reset/sign-in passed. Final observation found
> F226 Policy Pipeline summary502; D2 remains open; scoped fix implemented, release verification pending.

Specification: [D2 launch](../specs/2026-10-18-nter-domain-launch.md).
Progress: four exact Auth redirects saved, canonical Site URL now www.nter.pro,
ALLOWED_ORIGINS updated without removing existing entries,35/35 live OPTIONS
checks passed. Vercel routing recommendations and ownership challenge prepared
read-only; both domains subsequently attached and verified, with apex308 redirect
to www. BasicDNS and all routing/TXT records saved under explicit downtime
approval. Registry now delegates to dns1/dns2.registrar-servers.com; some public
caches initially retained old DNS. Ownership transfer and project verification
succeeded; www serves the exact expected production entry hash. Final15/15 CORS
checks and custom-domain API200 passed. Owner sign-in and reload persistence
passed; saved history and the single-call greeting/debit pilot also passed.
Owner confirms recovery-email delivery/reset/sign-in passed. Final observation
found Policy Pipeline summary502 on both aliases despite working stored module
data (F226). Owner then approved the scoped final fix; implemented locally,
release verification pending. D2 stays open. See the
[execution evidence](../research/2026-10-18-nter-domain-launch-evidence.md).

Only open-work.md tracks unfinished work; the phases below are its execution
breakdown, not a second tracker. Use task/nter-domain-launch or a fresh task
branch from verified main when execution begins.

## Assumptions and fixed targets

- Target domain nter.pro (not the other spellings in conversation).
- Recommended canonical URL https://www.nter.pro, preserving the existing
  apex-to-www direction; confirm in the release packet.
- Existing Vercel project/team and NTER project are those in the specification.
  Production follows main; an existing Vercel URL remains a test/fallback address.
- Registrar access is sufficient to regain DNS authority through BasicDNS;
  old Vercel and Cloudflare access are not prerequisites.
- Existing backend/data/credits remain; payment and corpus work stay excluded.

## Ordered execution

| Phase | Scope and operator | Dependency | Acceptance |
|---|---|---|---|
| L0 Inventory (S) | Read-only Vercel domains/release/hosting plan, public DNS, source and Auth/email configuration; owner identifies domain mail/services | None | Exact targets, records, DNSSEC state, affected origins and rollback limits recorded |
| L1 App readiness (M) | Configuration for app URL, Auth redirects, browser-facing Edge origins and email; source only for proven defects | L0 | Focused checks pass; no open origin/redirect defect; release packet lists exact mutations |
| L2 Verification preparation (S) | Our Vercel team/project domain screens/API; obtain actual ownership and project TXT requirements and routing records | L0, with L1 ready before any traffic-changing verification | Domain states understood; no ownership transfer or traffic switch yet |
| L3 DNS authority (M) | Owner in Namecheap: Domain List → Manage nter.pro → Nameservers → BasicDNS → Save; populate Advanced DNS | L1/L2, approved release, required zone inventory resolved | New authority answers required website/mail/service records and exact verification TXT; known DNSSEC chain correct |
| L4 Domain handover (M) | Verify/claim in our Vercel team, satisfy each project hostname check, assign both hostnames to production; finalize routing and apex redirect | L3 | DNS, certificates, domain association and production commit all verified |
| L5 Owner pilot (S) | Owner uses real app; supervising verification reads resulting evidence | L4 | Auth/email/reload/conversation and bounded answer/debit checks pass; checkout closed |
| L6 Observe and close (S) | Bounded request/runtime error scan, readonly accounting/source checks, exact CI/release evidence, D2 tracker and coordination | L5 | No unexplained launch failure; rollback route retained; D2 closed only on actual evidence |

L0 freezes the configuration write inventory. Expected external objects:
Namecheap delegation and zone; Vercel team/domain/project associations and
redirect; application base URL settings; Supabase Auth URL configuration and
the origins of browser-facing functions. Email/OAuth changes are conditional
on inspection, not automatic resets. Do not read dotenv/credential folders or
print keys while inspecting settings. New secret values must stay in protected
configuration; public URLs/record targets may be recorded without tokens.

## L0 details and first checkpoint

Record current main/remote state and the production deployment; account for
the separate local top-up-price approval commit without publishing it as an
incidental domain change. Export/snapshot the accessible DNS records and get
the owner's inventory of email and other hostnames. Query DS before switching
authority and resolve any signed-zone dependency. The current public www
CNAME and apex records are observations, not guaranteed future targets.

Production uses native Supabase Auth; the older server auth URL precedence is
not part of the mounted production router. No APP_URL/SITE_URL edit is needed
on that evidence. Check Auth redirect paths, sender-domain verification,
current confirmation mode and Google OAuth flow. Inspect configuration with
redaction and minimum fields. Identify whether any origin change needs an
affected-function deployment; do not redeploy every Edge Function. Capture
corpus-function hashes to prove no change if deployment work occurs.

Checkpoint A: publish the exact mutation/verification/rollback packet for the
owner's release approval. A lack of old-project access cannot be disguised as
a guaranteed old-site rollback. Resolve hosting-plan O10 and any unknown
required DNS/email records before public cutover. No transfer code or domain
registration transfer is required.

## L1/L2 verification and source write scopes

Prefer existing configuration interfaces. Do not modify source simply to put a
domain string into it. If a source defect is demonstrated, define a thin slice
before editing, confined to the relevant auth URL helper/client and tests or
the CORS helper/tests identified in the spec. Add a failing regression for the
observed defect, then run the affected checks.

Conditional source slices are sequential and individually reviewed: URL helper
(`server/authApi.mjs`, new `src/lib/authDomain.test.js`); client callback
(`src/lib/userStore.js`, `src/lib/userStore.bridge.test.js`); shared origin
matching (`supabase/functions/_shared/cors.ts`, `cors_test.ts`). Each is at most
two files. These are permitted candidate scopes, not instructions to edit
working behavior; a different required path needs an explicit scoped amendment.

Expected commands, when applicable (no standalone type-check exists):

```
NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs' npm run lint
NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs' npm test
NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs' npm run build
NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs' npm run check:bundle
NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs' node -e "import('./api/router.js').then(() => console.log('router import ok'))"
deno test -A --config supabase/functions/deno.json supabase/functions
```

Check required new origins and an unrelated denied origin with OPTIONS; assert
the actual Access-Control-Allow-Origin value, not merely HTTP204. Existing
production/preview origins needed for operation must continue to work.
Use the current Vercel URL for pre-cutover browser checks. A temporary custom
test hostname is optional: it cannot be promised before DNS control and any
ownership verification, and it shares the real backend.

Checkpoint B: compatible application/configuration is ready, exact Vercel
ownership/routing records are available, and owner-operated Namecheap actions
are scheduled. Preparing a verification challenge is distinct from completing
Verify & Claim, which may change live routing immediately.

## L3/L4 handover sequence

1. Owner signs into Namecheap in the in-app browser, retaining control of
   password, MFA and any security challenges. No plugin installation is needed.
2. Confirm exact domain nter.pro and the replacement-record inventory. Retain
   existing Cloudflare nameserver names and DNS records as rollback evidence.
3. **Checkpoint amendment after approval-review rejection:** first seek a way to
   pre-provision the zone (provider support or an accessible DNS host). Namecheap's
   current editor is unavailable under external NS; saving BasicDNS before adding
   records creates a possible outage interval. The owner must explicitly approve
   that interval before retrying the rejected sequence. Never bypass the review.
   Then switch to BasicDNS; enter the required TXT and preserved website/mail/service
   records in Advanced DNS. Do not assume the old zone is copied automatically
   or mix Cloudflare and BasicDNS nameservers. Check actual delegation/record
   propagation before proceeding; different resolvers may differ temporarily.
4. Complete Vercel's team and hostname-specific project verification prompts.
   Attach both names to the existing project production environment and apply
   its exact recommended A/CNAME records, coordinating traffic-changing actions.
5. Check authoritative/public DNS, HTTPS and certificates, canonical redirect,
   app release and browser CORS. Do not close the cutover on a green domain
   badge alone. Leave Namecheap as registrar and BasicDNS as DNS host.

## L5/L6 acceptance and recovery

The repository reserves production account creation/sign-in tests for the
owner. The release packet names the existing pilot account or explicit signup,
email deliveries and one bounded short answer; define the call/cost limit
before execution. Verify persistence, one-paisa deduction, no duplicate signup
grant and disabled checkout. A preview uses real NTER data. No live SQL fixture,
arbitrary credit grants, refund/order tests or corpus invocation is permitted.

On a failure, stop promotion or further domain changes, keep the original
Vercel application URL available and follow the verified fallback. Restore
saved origin/redirect/DNS values only when compatible with current traffic.
Restoring Cloudflare NS does not necessarily undo a completed Vercel ownership
or project move; confirm access and domain association separately. Report the
failure and recovery state, preserving accounts and newly written user data.

Successful completion records final commit/deployment, exact domain and DNS
verification, owner pilot, CI where code changed, bounded errors and unchanged
out-of-scope functions/data. No old-project deletion or Razorpay activation.

## Parallelism and unresolved decisions

Execution is sequential through the live handover. After L0 freezes interfaces,
independent code/readiness review may run separately from owner DNS-inventory
collection, with no overlapping configuration writers. No parallel production
mutations or agent delegation is needed for this planning phase.

Owner confirms canonical hostname, required mail/other services, hosting-plan
readiness and the release window/pilot bounds in the concrete release packet.
Old account access is optional. Exact verification tokens and actual current
Auth/email configuration are obtained during execution preparation, not guessed.


## F226 final-fix execution amendment — 2026-10-18

Owner approved proceeding with final fixes/checks. Sequential on the existing
task/nter-domain-launch checkout; no delegation needed. Write scope:
api/router.js, server/featureFeed.mjs, server/nationalLandingSummary.mjs,
new src/lib/nationalLandingStore.test.js, and existing D2 spec/plan/evidence,
open-work and coordination records. The extra projection file carries stored
fetch/stale metadata without changing filters or counts.

1. Add real-router tests with synthetic store/upstream boundary responses;
   demonstrate fresh stored-count regressions fail in both routers before fix.
2. Select stored-first only for the named National feature; preserve store
   provenance. Focused green tests include stale, unavailable store, validation,
   unrelated National route and live fallback.
3. Run lint, npm test, Deno suite, build, check:bundle and router import with the
   no-dotenv guard; inspect diff and committed-data cleanliness. No SQL migration;
   no need to start local database containers. CI still verifies SQL fixtures.
4. Commit scoped source/docs, push task branch for first-attempt CI; merge the
   verified commit to main and push to the existing auto-deploy project. Verify
   exact READY source commit, both aliases' summary/module counts, Auth/CORS,
   disabled checkout, no duplicate charge and bounded request/runtime logs.
5. Close F226 and D2 only after actual release evidence passes. Preserve owner
   recovery success. Record independent T15 and Auth redirect cleanup separately;
   payment/corpus remain excluded. Rollback target is the pre-fix production
   deployment dpl_3TAwkp7cPozmhA8EmM7J5jULc66F; no rollback without approval.
