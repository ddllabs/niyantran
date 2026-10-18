# F227 Auth redirect cleanup evidence

> **Status: Living.** 2026-10-18; closed with owner confirmation and live redirect evidence.

## Scope and checkout

Owner approved only the scoped NTER Auth redirect cleanup. Site URL, providers,
CORS, DNS, accounts, feeds, corpus and payments stay unchanged. Spec and plan:
[spec](../specs/2026-10-18-f227-auth-redirects.md),
[plan](../plans/2026-10-18-f227-auth-redirects.md).
Task branch task/f227-auth-redirects starts at e46091d, matching fetched origin/main.
Initial working tree clean. No source edits, live configuration writes, commits,
pushes or deployments performed during this attempt.

## Before-change inventory

Site URL: `https://www.nter.pro/`.

1. `https://niyantran-six.vercel.app`
2. `http://localhost:5173/`
3. `https://*.vercel.app/**`
4. `https://https://niyantran-six.vercel.app/**`
5. `http://localhost:5173/**`
6. `https://niyantran-*-ddl-labs.vercel.app/**`
7. `https://nter.pro/`
8. `https://www.nter.pro/`
9. `https://nter.pro/#/reset-password`
10. `https://www.nter.pro/#/reset-password`

Source inspection confirms Google uses origin plus `/` in
src/marketing/GoogleSignInButton.jsx; recovery uses origin plus
`/#/reset-password` in src/marketing/ForgotPasswordPage.jsx.

## Executed baseline

A single credential-free GET to NTER `/auth/v1/verify`, type recovery, used a
literal nonhex invalid token and redirect_to
`https://f227-unrelated-check.vercel.app/`. No key, email, user identity, session
or real recovery token was supplied; callback redirects were not followed.
Response: HTTP303, destination origin `https://f227-unrelated-check.vercel.app`,
path `/`, error_code `otp_expired`. No access/refresh tokens returned. This
reproduces acceptance of an unrelated Vercel destination before cleanup.
It does not test successful authentication or email delivery.

Probe safety was checked against official Auth verify.go and
utilities/request.go: destination selection precedes invalid-token lookup;
lookup failure returns an error callback before recovery/account mutation.
[Redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls).
URL fragments represent client routing, not independent server-side paths.

## Initial execution limitation

Arc dashboard reload stalled at loading placeholders; reconnecting the existing
Arc session and reloading did not expose configuration controls. No additions,
removals or save action occurred. Owner was asked to restore the NTER URL
Configuration page/sign-in if required. F227 remains open, including live save,
reload verification, post-change redirect checks and owner-operated Google plus
recovery/reset/sign-in pilot. Approval remains valid; no new approval requested.

Hourly niyantran-m1-m2-closure-checks monitor verified ACTIVE, interval one hour.
T15 remains independent and open. Razorpay held until closure; corpus excluded.

## Owner-applied cleanup and live verification — 11:23 UTC

Owner supplied the 16:52 IST screenshot showing the expected final nine entries,
unchanged Site URL and disabled Site URL save control. The broad wildcard,
malformed URL and obsolete bare Vercel root are absent; exact Vercel root and
reset destinations are present. Other seven entries match the pre-change list.
The owner performed dashboard changes; no configuration write was executed from
this checkout. A separate dashboard reload was not independently observed.

Final list:

1. `http://localhost:5173/`
2. `http://localhost:5173/**`
3. `https://niyantran-*-ddl-labs.vercel.app/**`
4. `https://nter.pro/`
5. `https://www.nter.pro/`
6. `https://nter.pro/#/reset-password`
7. `https://www.nter.pro/#/reset-password`
8. `https://niyantran-six.vercel.app/`
9. `https://niyantran-six.vercel.app/#/reset-password`

Executed Python urllib no-follow verification: 11/11 HTTP303 destination checks
pass. The same nonhex invalid token was used throughout; no credentials, email
send, real token, account mutation or callback navigation. Eight intended targets
retained their origin/path: both custom roots and reset callbacks, retained
Vercel root/reset, project preview niyantran-8cjb7u0ny-ddl-labs.vercel.app and
localhost5173 root. Three untrusted targets fell back to https://www.nter.pro/:
f227-unrelated-check.vercel.app, nter.pro.evil.invalid, and the wrong-team
niyantran-check-otherteam.vercel.app. The identical unrelated-Vercel case was
accepted before cleanup and rejected after it, providing before/after evidence.
Assertions prohibit access_token/refresh_token in callback output. Runtime
checks compare origin/path; they do not prove client fragment routing or actual
successful authentication, email delivery or password reset.

F227 remains open only for owner-operated post-change Google sign-in and
recovery/reset/sign-in pilot (and saved-list reload confirmation). Existing D2
pilot predates cleanup and is not relabeled as post-change evidence. No source
build, deployment, paid-model call or production data write was needed.
`git diff --check` passes. Documentation remains local and uncommitted on
 task/f227-auth-redirects. Hourly monitor rechecked ACTIVE; T15 and holds unchanged.

## Final owner acceptance — 2026-10-18

Owner confirms: "Reloaded and confirmed all 9 URLs persist. Google sign-in,
recovery email, password reset and sign-in all worked. Close F227".
This completes the saved-configuration and real-flow acceptance gates after
cleanup. F227 is closed; earlier pending statements above describe the sequence
of evidence and are superseded by this acceptance. Only documentation changed
in this checkout. No source deployment or additional production mutation needed.

Read-only closure query at 11:25:33 UTC: MLA reference has two genuine daily
successes (October17/18 10:45 UTC), next eligible October19 10:45:19 UTC.
Constitutions has one (October17 15:45 UTC), next eligible October18 15:45:01 UTC.
Growth retains20 items/zero failures, next eligible October18 15:55:02 UTC;
post-F224 scheduled writer acceptance still pending. All257 serving variants
have zero nonzero failure counters. Cron5 active */5, exact expected Vercel
refresh route confirmed boolean-only. No refresh forced or retry counted.
T15 remains open; hourly monitor ACTIVE. Razorpay held and corpus excluded.
