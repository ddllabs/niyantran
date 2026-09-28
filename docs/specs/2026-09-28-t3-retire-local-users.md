# Spec: T3, retire the local users store and seed accounts

> **Status: Historical (2026-09-28).** Task spec for T3 of
> `docs/plans/2026-09-28-serverless-state-to-supabase.md` (store S3), approved
> by the owner on 2026-09-28. Landed the same day in `e2aad15` (merged in
> `5a2ded0`). T5, "not approved" below, was approved later that day and landed
> in `19d25e6`.

## Current state (read from the code at `47977dc`)

- **Server.** `server/usersApi.mjs` keeps its own user directory in SQLite
  (`users` table, with a `password` column) and in `issued-users.json`,
  both under `writablePath()`, so both live in `/tmp` on Vercel.
  `mergeWithSeeds()` adds built-in accounts. `GET /api/users` returns the
  list without passwords. `PUT /api/users` replaces the whole list. Both
  require an internal admin through `authorizeLocalUser`, which T1 and T2
  also consume.
- **Client.** `src/lib/userStore.js` exports two seed accounts,
  `SEED_USER` and `SEED_STUDENT`, both with the password `12345678#`, so
  the credentials ship in the browser bundle.
  - `authenticateUser()` checks passwords against the local list. No
    screen calls it; only tests do.
  - `createUser`, `updateUser`, `removeUser` and `saveUsers` edit a
    verified admin snapshot and PUT the whole list back. For anyone who
    is not a verified admin they do nothing.
  - `sessionUser()` falls back to the seed enterprise analyst whenever no
    session user is stored.
- **Callers.**
  - `src/admin/AdminPages.jsx`: create, type change, active toggle,
    remove.
  - `src/admin/AdminApp.jsx`: loads the directory.
  - `src/marketing/SignupPage.jsx`: calls the local `createUser` with the
    plaintext password after native Supabase signup, plus local
    `updateUser` and hydrate calls. All are no-ops for a new user.
  - `src/lib/billing.js`: local `updateUser` and `loadUsers`, also no-ops
    for non-admins.
  - `sessionUser()` has many readers.
- **The authority is already Supabase.** `public.user_profiles` holds
  `user_id`, `email`, names, `persona` (`app_persona`), `role` (`user`,
  `admin`, `owner`), `plan` (`explorer`, `professional`, `enterprise`) and
  `status` (`active`, `inactive`, `suspended`). Migration 0012's guard lets
  `service_role` change any column.

## Objective

Supabase Auth plus `public.user_profiles` becomes the only user directory.
No password, seed account or local user list remains in the code, the
bundle or `/tmp`. Admin screens keep working through narrow, audited
actions.

## Decisions (supervisor, inside the approved scope)

1. **`GET /api/users` (internal admin).** Returns `user_profiles` rows
   through `getSupabaseAdminClient()`, oldest first, mapped to the
   existing directory shape:
   - `id` = `user_id`
   - `name` = first and last name, or the email's local part
   - `email`
   - `type` and `personaId` = `frontendPersona(persona)`
   - `plan` (`professional` becomes `pro`)
   - `active` = `status === 'active'`
   - `status`, `role`, `createdAt`
   - never a `password` field.
2. **`PUT /api/users` is removed** and answers 405.
3. **New `PATCH /api/users/:userId` (internal admin).** The body may
   contain only `active` (boolean, written as status `active` or
   `suspended`) and/or `type` (a frontend persona, written as
   `dbPersona(type)`). Other fields are rejected with 400.
   - An admin cannot change their own `active`, which prevents
     self-lockout.
   - Rows with role `owner` cannot be modified.
   - It returns the updated, mapped row.
4. **There is no admin create or delete.**
   - Accounts come only from Supabase sign-up. Admins cannot set
     passwords.
   - "Remove" becomes suspend, which can be undone; deleting an Auth user
     is destructive and out of scope.
   - The create form in `AdminPages.jsx` is replaced by a short
     explanation.
5. **Plan changes stay out of scope.** They are billing entitlements (T5,
   not approved), and `app_plan` differs from the frontend's plan names
   (backlog).
6. **Client cleanup.**
   - Delete from `userStore.js`: the seed accounts, all password
     handling, `authenticateUser`, the local `createUser`,
     `upsertGoogleUser`, `removeUser`, `saveUsers` and the whole-list PUT.
   - Admin actions become `setUserActive(id, active)` and
     `setUserType(id, type)`, which call PATCH and then re-read the
     directory.
   - `loadUsers()` returns the cached directory, or `[]`.
   - `sessionUser()` returns `null` when no session user is stored.
7. **Terminal gate.** `App.jsx` treats a user as signed in only when the
   session flag is set **and** `sessionUser()` is not null. Every
   `sessionUser()` reader must handle `null`; where a policy helper is
   involved (`src/lib/planEntitlements.js`), `null` means the explorer
   entitlement.
8. **Callers.**
   - `SignupPage.jsx` drops its local directory calls, including the
     plaintext-password `createUser`.
   - `billing.js` drops only its calls to the removed `updateUser` and
     `loadUsers`; `refreshSessionFromStore()` returns the current session
     user. No other billing logic changes. These calls are no-ops today;
     the change is noted to the owner because billing is a sensitive
     scope.

## Boundaries

- **Always:**
  - keep `authorizeLocalUser` and `localClientForToken` signatures
    unchanged, because T1 and T2 consume them;
  - remove both S3 lines from the T0 guard's `KNOWN_OFFENDERS`.
- **Never:**
  - delete an Auth user;
  - add a password path;
  - write outside the scope below;
  - delete a failing test to get green. A test of deliberately removed
    behaviour is rewritten to assert that the behaviour is gone (for
    example, that the seed credentials do not authenticate, or that no
    response carries a password).
- **Ask first:** anything touching plan or entitlement values, or any new
  migration. None is expected.

## Acceptance evidence

- Handler tests written first, failing against the SQLite handler. They
  cover: the admin gate, the GET mapping with no password field, PATCH
  validation, the self-lockout and owner rules, and PUT returning 405.
- Client tests for `setUserActive`/`setUserType`, `sessionUser()`
  returning null, and the App gate with the flag set but no user.
- `grep -rn "12345678#\|SEED_USER\|SEED_STUDENT" src server` finds
  nothing, and the built bundle does not contain `12345678#`.
- The T0 guard passes with the S3 lines removed, and fails when
  `writablePath('issued-users.json')` is restored.
- `npm test`, the Deno suite, `npm run build` and the router import all
  pass. No SQL fixture is needed, since no migration changes.
