# D2: First application launch on nter.pro

> **Status: Living.** 2026-10-18. Owner approved Auth redirect and CORS
> preparation plus Vercel domain preparation. Owner subsequently completed Pro
> upgrade and authorized handover, then explicitly approved controlled downtime.
> BasicDNS, ownership, HTTPS/routing and canonical Auth URL are verified live;
> Owner sign-in/reload, saved history and one-call answer/debit verified;
> Owner confirms recovery-email/reset/sign-in passed. Final observation
> found F226 (Policy Pipeline summary502); scoped final fix approved and
> implemented locally, release verification pending. D2 remains open.

## Objective

Serve the existing Niyantran React/Vite application and Vercel API on
`www.nter.pro`, redirecting `nter.pro` to that address. Preserve the current
Supabase NTER project, accounts, conversations, grants and one-paisa accounting.
The owner confirms the old public website has no backend to migrate.

D2 in open-work.md is the sole tracker. The existing Vercel project is the
deployment target, not a new project or backend. Razorpay remains disabled;
corpus ingestion, feed schedules, data republishing, database migrations and
deleting the old Vercel project are excluded.

## Initial pre-cutover evidence, October 18

- Namecheap screenshots show domain registration and custom Cloudflare DNS.
  Public NS lookup confirms `julio.ns.cloudflare.com` / `sara.ns.cloudflare.com`.
- Public `nter.pro` returns308 to `www.nter.pro`; www returns200, server Vercel.
  This proves hosting/routing, not the old site's exact Git commit.
- Our project `prj_6UiaDz2rkTOmqIOaXnCAs92V7d86` in team
  `team_QFu1p3ObeXmlMQczPBcZb582` lists only `niyantran-six.vercel.app`.
  The current team cannot access nter.pro's existing association.
- Vercel connector returns a scope403; same-scope authenticated CLI inspection
  succeeds for our project. Existing access is sufficient for our side of the
  handover; old Vercel/Cloudflare access is optional.
- Before preparation, research-chat OPTIONS requests from both custom-domain origins returned204
  without Access-Control-Allow-Origin. Configuration must allow the required
  origins before launch; a204 by itself is not a passing CORS check.
- Production authenticates directly with Supabase: `api/router.js` deliberately
  does not mount `/api/auth/*`. The older `server/authApi.mjs` URL settings are
  not a demonstrated production dependency. Google uses the current browser
  origin as its return URL; recovery uses `/#/reset-password`; signup/resend
  omit an explicit return URL and therefore depend on the Supabase Site URL.
- Approved preparation is recorded in the [execution evidence](../research/2026-10-18-nter-domain-launch-evidence.md):
  four exact Auth destinations added, current Site URL preserved, both custom
  CORS origins added and35/35 preflight checks passed. No dotenv or credential
  files were inspected. Owner later confirms recovery delivery/reset/sign-in;
  Google Console branding was not part of this acceptance slice. No
  confirmation/provider settings were changed.

## Deployment and DNS contract

The public application uses Vercel production from main, with Supabase
`vfgcppstyzjarlzyqdac`. Nameservers select DNS hosting; Vercel domain assignment
selects the application. Both must be correct. Existing Vercel URLs may remain
for operational checks; canonical links and new email redirects use www.

Recommended DNS authority: Namecheap BasicDNS. The owner can replace the old
Cloudflare delegation from the registrar without those old account logins.
Obtain the actual team/project/hostname verification records from Vercel;
never invent a token or assume a universal A/CNAME target. Team ownership and
project verification can be separate, including separate checks for www.

Switching authority does not copy existing records. Before switching, inventory
required website, mail and other service records, TTLs and DNSSEC/DS state.
Public lookups do not prove a complete zone inventory. Resolve unknown mail,
subdomain and DNSSEC dependencies with the owner/provider. Preserve all known
required records in the replacement zone. Preserve old routing initially where
possible, then coordinate verification/assignment with the final routing change.
Do not promise uninterrupted service or treat nameserver rollback as immediate.

No move to Vercel nameservers is necessary. If requested later, first establish
Vercel ownership and a complete replacement zone, then change authority once
more as a separately reviewed step.

## Application acceptance

- Both hostnames resolve, have valid HTTPS and reach the intended production
  release, with one canonical redirect and no loop.
- The required custom origins receive the exact allowed origin on preflight
  for every browser-facing Edge Function used by the application; unrelated
  origins remain denied. Inventory functions before changing configuration.
- App base URL, Supabase Site URL/redirect allowlist and email links resolve to
  the canonical application. Verify actual Google OAuth architecture before
  changing provider settings; its Supabase callback may already be correct.
- Confirm current Resend/email-confirmation behavior. D2's older instruction
  about mailer_autoconfirm is not authority to toggle it blindly. Any necessary
  change must be named in the release packet, with delivery and recovery proof.
- Owner-operated sign-in, sign-out, password recovery and refresh work. New
  signup/email tests and a short answer are explicitly bounded real production
  actions, not disposable database fixtures. No signup grant resets or remints.
- Saved conversations and an existing wallet survive reload. A declared owner
  pilot verifies an answer and its actual debit in the one-paisa unit.
- Checkout stays closed. Corpus, source refresh configuration, data collections
  and unrelated Edge Function code/versions remain untouched.

## Scope and verification

The approved preparation changes configuration and its execution records.
Implementation should prefer configuration-only changes. Candidate source
scopes, only if inventory proves a defect: `server/authApi.mjs` with a new
`src/lib/authDomain.test.js`, `src/lib/userStore.js` with
`src/lib/userStore.bridge.test.js`, and
`supabase/functions/_shared/cors.ts` / `cors_test.ts`. Do not broaden to billing
or ingestion. A shared helper change requires caller inventory and tests; do
not redeploy unrelated functions merely because they share a directory.

For runtime changes, use red-before-green focused regressions, npm run lint,
npm test, npm run build, npm run check:bundle, router import for server/API
changes, and the Deno suite for shared/Edge changes. SQL changes are not planned.
Use the established no-dotenv Node guard; never print secret configuration.
Configuration-only execution requires real DNS/HTTPS/redirect/CORS observations
and the owner pilot, not an invented type-check or unnecessary source tests.

## Release and recovery

Before launch, record the exact commit/deployment, old domain association,
readable DNS inventory, origin/redirect configuration and rollback actions.
Do not delete or assume access to the old website deployment. If reassignment
cannot be reversed from our account, document that limit and a controlled
temporary fallback serving the current application or maintenance page. DNS
rollback cannot restore a Vercel association that ownership transfer removed.

Approval covers a concrete sequence and exact targets, including owner-run
email/model tests. The owner subsequently completed the Pro upgrade, approved
controlled BasicDNS/traffic cutover and authorized final launch checks. Those
checks passed Auth/email/conversations/accounting but found F226; backend fixes
require a separately approved scope and release. No further paid upgrade,
checkout activation or ingestion operation is authorized.
M1/M2 T15 stays separately tracked; domain preparation does not close it or
authorize payment implementation. Other broad M6 tasks are not silently
included in D2.

References: [Namecheap nameserver changes](https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/how-to-change-dns-for-a-domain/),
[Vercel ownership](https://vercel.com/docs/domains/working-with-domains/claim-domain-ownership),
[Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls).


## F226 approved final-fix amendment — 2026-10-18

Owner authorized final fixes and launch verification after the scoped proposal.
Change only Policy Pipeline's National summary to the existing stored-first
loader, in both local and Vercel routers. Preserve fetchedAt and stale/age
provenance in server/nationalLandingSummary.mjs, as the Global summary already
does. No filter, displayed-row inflation, schedule, feed data or freshness-rule
change. Acceptance: working stored records yield200 and the same prepared count
as the module despite upstream failure; permitted stale copies remain marked;
missing/disabled/empty/over-ceiling store retains truthful fallback/error;
non-target National summaries keep their loader and validation stays ahead of
reads. Release is limited to the existing Vercel production project through
reviewed main; no Supabase function/config/schema deployment or paid model test.
