# Identity and internal administration

> **Status: Historical (2026-09-29).** Implemented: migrations `0012` (profile authority), `0013` (conversation ownership) and `0015` (least privilege), T1 (preferences keyed to the signed-in caller) and T3 (local users store retired, `e2aad15`).
> Superseded 2026-09-29: the open remainder, an organisation product (seats, provisioning, billing), is P2 in `plans/open-work.md`.
> Module: `identity-boundaries`. Prepared 2026-09-21 from a read-only review.

## Objective and confirmed scope

There is one ordinary signed-in user class. Analyst, student, journalist and
other personas remain preferences for presentation and AI behavior, never
authorization roles. Platform administration belongs only to the internal
Niyantran team. Users cannot promote themselves, assign entitlements or
reactivate suspended accounts. This specification does not delete organisation
tables, existing personas or another developer's work.

## Evidence and problem

Live SQL definitions show self-row INSERT/UPDATE access on user_profiles,
including role, plan, status and organisation fields. is_platform_admin trusts
an active profile with role=admin. RLS ownership alone does not protect those
columns. This is a confirmed policy defect; no escalation was attempted.

src/admin/AdminLogin.jsx contains a static credential check and AdminApp.jsx
uses a browser session flag as its entrance gate. A browser flag cannot prove
internal-team authority. Local server/usersApi.mjs exposes a user-list route
and bulk replacement route without an authorization check; the data includes
password fields. server/userPrefsApi.mjs identifies users by supplied email.
These are code findings, not proof that those routes exist on Vercel.

chat_messages and chat_cancellations policies bind user_id to the caller but
do not independently enforce ownership of the referenced conversation.
create_organisation also assigns the caller owner and enterprise. Platform
admin and organisation owner are different concepts, but self-assigned paid
entitlements are not acceptable substitutes for trusted provisioning.

## Required behavior

1. Supabase Auth establishes identity. Unknown, expired and revoked sessions
   fail closed. Network failure must not fall back into a real authenticated
   session. Explicit demo behavior, if retained, cannot reach protected APIs.
2. Profile creation supplies server-controlled defaults. An ordinary caller
   can update only approved personal fields, including persona. Inserts,
   updates, upserts and onboarding RPCs cannot change role, plan, status,
   organisation membership or entitlement fields. Internal provisioning is
   a trusted server operation; no public admin-registration path is added.
3. Retain the existing role representation initially; protect its write
   authority instead of introducing a second parallel role system. Review
   column grants, RLS, triggers and definer RPCs together. A definer function
   must fix its search_path and explicitly authenticate/authorize its caller.
4. Every admin read or mutation authorizes the internal admin on the server.
   UI gating reflects that result. Forging localStorage/sessionStorage or
   directly navigating to /admin grants no data access or mutation rights.
5. A child message or cancellation belongs to both its stated user and its
   parent conversation. Clients cannot forge assistant messages, telemetry,
   billed usage or another user's cancellation. Trusted assistant persistence
   must verify conversation ownership before using elevated DB access.
6. New public organisation creation cannot self-grant owner authority or an
   enterprise plan. Preserve schema/data; keep that public operation disabled
   until a separate organisation product spec defines provisioning.
7. Billing entitlements are server-owned. This work closes self-assignment;
   it does not build subscription checkout, invoices or usage charging.

## Interfaces and write boundaries

Auth/profile input: verified caller ID, approved profile fields only.
Output: caller's profile, persona and trusted entitlement summary. Persona
does not influence is_platform_admin. Protected route rejection is 401 for
no valid identity and 403 for insufficient authority, with no sensitive body.

Implementation slices may touch backend/sql/auth_schema.sql, a new migration
after the reconciled 0011 baseline, focused SQL tests, the shared auth helper,
src/admin/{AdminLogin,AdminApp}.jsx and their auth adapter, and the separately
scoped marketing login/local-server adapters. Exact dispatch scopes appear in
the supervisor plan. No rewrite of billing or other developer branches.

## Acceptance evidence

Use a disposable local/shadow database with two ordinary users and an internal
admin. Test INSERT, UPDATE, upsert and RPC escalation payloads, not just the UI.
Ordinary persona updates succeed while role/plan/status changes fail. A user
cannot insert a message/cancellation into the other's conversation or write
an assistant row. Internal admin actions work through verified server access;
browser-flag forgery and expired/suspended sessions fail. Exercise every
retained local admin endpoint and verify passwords never appear in responses.

For each guard, restore the original defect in the disposable test target and
observe the intended test fail before accepting the fix. Production is not a
test fixture. Existing users or keys must never be deleted for verification.

## Implementation conventions and gates

Follow existing dependency-injected Deno handlers, camelCase JS/TS helpers and
snake_case database names. Extend existing helpers rather than create another
auth client. Tests live beside their corresponding modules; SQL authorization
tests live under supabase/tests/. Commands after implementation: `npm test`,
`deno test -A --config supabase/functions/deno.json supabase/functions`,
`npm run build`; SQL suite through `supabase test db` on the disposable local
target. Establish that target and inspect its identity before execution.

Always preserve unrelated changes. Never publish credentials or rely on a
browser gate. Production migration/deployment remains a later explicit step.
Vercel route availability and email delivery remain unverified launch gates.

### B4 scoped client clarification

The existing email helper exposes a shared anonymous client without token
options. For local user routes, a single request-scoped public client boundary
in usersApi.mjs, reused by userPrefsApi.mjs, is approved. It must carry the
request JWT without mutating shared SDK session state or using service keys.
This is a narrow exception to reusing the existing email helper; that helper's
unrelated scope need not expand. Verified Auth identity plus active profile
and internal admin checks remain required as specified.

B4 adapter verification also covers the existing session bridge: caller extras
cannot override a trusted profile plan, and missing or mismatched profiles
cannot appear active. Logging out invalidates the Supabase session regardless
of the AI transport feature flag. Preference hydration cannot upload an
unowned prior account's cached chats into a new account with empty preferences.
(Corrected 2026-09-28: the AI transport flag, `VITE_AI_BACKEND`, was removed in
`14b2344`, so logout has no flag to depend on; chats are no longer preferences
(`f05a5b6`), and the hydration rule now covers the watchlist and tours.)

### Preservation-safe local preference isolation

The original global preference keys may contain the only copy of unsynced
legacy chats. They must not be cleared or overwritten to enforce identity.
(Corrected 2026-09-28: by owner decision the legacy chat keys are now removed.
Research conversations live in `public.conversations`, the localStorage chat
store was deleted in `f05a5b6`, and `purgeLegacyAiChats()` in
`src/lib/userPrefsSync.js` deletes `niyantranAiChats`, `niyantranAiChats:user:<id>`
and their revision keys at startup, since they can hold private chat text on a
shared machine. The rest of this section applies to the watchlist and tours.)
Unbound stores return empty/default ephemeral views; after verified identity
they read and write only that user's separate keys. The sync module owns the
binding and invalidates it on logout, account change and expiry. Stores must
not import Auth modules, avoiding dependency cycles. No automatic assignment
or upload of old unowned data is permitted. Existing data stays recoverable
for a separately authorized migration. A failed network hydration must not
destroy an already-owned local copy.

Server-side preference ownership also uses the stable verified Auth user ID.
A verified email can change or be reused by a different account, so it cannot
be the durable authority key. API responses still return the current verified
email. (Corrected 2026-09-28: preferences are stored in
`public.user_preferences`, one row per `user_id`, with `user_id = auth.uid()`
policies (T1, `631be0f`); `/api/user-prefs` writes as the caller. The browser
keeps a per-user localStorage working copy (`<key>:user:<id>`) that syncs to
that row. The earlier SQLite rows, namespaced or email-keyed, were not
migrated.)

### Deliberate sign-in after local logout

A local logout remains closed even if the SDK emits a stale sign-in event or
remote sign-out fails. Marketing and internal-admin sign-in explicitly resume
the shared identity adapter only after deliberate successful authentication;
the adapter independently verifies the supplied session and active profile.
The marketing login no longer promotes bundled demo credentials or network
failure to a real session. Existing persona choices are unaffected.

Internal-admin logout must synchronously invalidate the shared local identity
and protected directory cache before awaiting SDK sign-out, including failures.
Use a local-only invalidation helper so each caller makes only one SDK sign-out
request. Ordinary logout reuses that same invalidation boundary.

After successful preference hydration, previously recorded dirty fields for
the verified owner may resume their debounced backup. Clean defaults, server
hydration results and legacy unowned keys must never be treated as new edits.
A pending old-token request cannot acknowledge a new generation's edits or
prevent their later retry once the request finishes. Network failure must not
create an unbounded immediate retry loop.
