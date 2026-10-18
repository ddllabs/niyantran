# F233: preserve fresh sign-in across passive session checks

> **Status: Normative.** Owner approved specification, plan, local implementation
> and verification on 2026-10-18. No push or production action authorized.

## Current state and objective

Baseline main db5793f. A controlled reproduction using the actual user store and
synthetic Auth showed: fresh login succeeds; logout/re-login without a competing
check succeeds; logout/re-login with passive publication during verification
fails. App.jsx schedules publishVerifiedSessionUser on a positive Auth event
when no session user is published. The user store's logout latch rejects that
passive check and broadcasts a null identity, invalidating the concurrent fresh
sign-in. LoginPage interprets that notification as a newer logout. The existing
111 store/form tests pass but miss this interaction.

A successful deliberate password sign-in must survive passive checks while its
new session is being verified. A passive check refused by the existing local
logout latch must return no authority without manufacturing another logout.
Only successful independent session/user/active-profile verification can reopen
the latch. Real invalidation, SIGNED_OUT, account/token switches, expired sessions
and failed verification must continue to refuse stale requests and publication.

## Scope and contracts

Keep changes in src/lib/userStore.js and focused store/form integration tests.
No public API change is expected. Preserve synchronous local logout invalidation,
SDK signOut scope/local call ownership, event callbacks, SDK/session persistence,
OAuth behavior, profile and admin checks, preferences and data isolation. Do not
solve this by clearing the latch on every SIGNED_IN, disabling cancellation or
skipping account verification. A real/delayed SIGNED_OUT still cancels a pending
attempt. General logout transport/retry redesign is excluded from this scoped
fix; SDK failure must remain fail-closed.

No backend, SQL, Auth settings, CORS, dependencies, payment, credit, corpus or
feed changes. No production credentials/session inspection. No Docker needed.
Repository documents: this spec, companion plan, sole open-work tracker.

## Acceptance and verification

Vitest integration uses the real LoginPage handler and real shared user store,
with synthetic Auth/profile/network and controlled promises. Prove the overlap
case fails before implementation, then passes; test repeated passive calls and
both completion orders. Check cancellation by real local logout/SDK sign-out,
account/token changes and invalid user/profile, and passive denial after failed
logout. Existing protections must remain green with assertions intact.

Run focused auth tests, npm test, Deno function suite, npm run lint,
npm run build and npm run check:bundle. All npm/config commands use the existing
no-dotenv guard. Browser fixture exercises login → logout → home → re-login with
controlled latency and no real network or identity. No standalone type-check.
No SQL fixtures needed without SQL changes. Keep tests descriptive and change
only the verified defect. Leave local changes for owner review before release.

References checked: official Supabase onAuthStateChange and signOut documentation
and installed auth-js notification ordering; changelog index was unavailable.
No new SDK API, dependency or runtime behavior is introduced.
