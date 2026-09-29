# Spec: a transient identity failure must not sign the user out (F13)

> **Status: Living.** Proposed 2026-09-29 for owner approval; not yet
> implemented. Open-work item F13. Authentication scope: the owner authorised
> the work on 2026-09-29, and the implementation waits for approval of this
> spec.

## Current state (read from the code on 2026-09-29, `main` at `31c3915`)

`src/lib/userStore.js` announces identity changes with `identityChanged(id)`.
Four places call `identityChanged(null)` (meaning "nobody is signed in"):

| Where | Trigger |
|---|---|
| `verifyLocalIdentity` (catch, line ~112) | **any** throw: no session, a failed `getUser`, a failed `get_my_profile`, an inactive profile, a failed admin check, *or a network error or 5xx in any of those calls* |
| `localIdentityIsCurrent` (line ~81) | `getSession` fails or throws (it can refresh the token over the network), or the session no longer matches |
| the admin directory read (line ~194) | **any** failed `GET /api/users`, including a network error or a 5xx |
| `patchUser` (line ~225) | a 401 from `PATCH /api/users/:id` (authoritative already) |

Every `identityChanged(null)` reaches these listeners:
- `researchChat.js`: it bumps `generation` and removes **every** retained
  operation, so every conversation loses its replay intent, not only the
  current one;
- `aiConversations.js`: it clears the conversation list and the owner;
- `useResearchThread.js`: it invalidates the thread;
- `userPrefsSync.js` and `adminSession.js`: they drop their state;
- `App.jsx`: it calls `setAuthed(false)` and `setPlanReady(false)`. **The UI
  shows the signed-out app while the Supabase session is still valid.**
  (Found while writing this spec, and read from the code only; not
  reproduced in a browser.)

Nothing is spent or written in error (the code fails closed), but one
network blip loses every retained turn and appears to sign the user out.

## The problem

The code treats "I could not ask" the same as "the answer was no".

## Expected outcome

Classify every failure in these paths as one of two kinds:

- **Authoritative:** the identity really is gone or different. The code
  keeps failing closed and calls `identityChanged(null)` exactly as today.
  - there is no session, it has expired, or the user logged out locally;
  - the session user differs from the verified or requested one;
  - `getUser` returns an Auth API error with HTTP 401 or 403, or no user;
  - `get_my_profile` answers a profile that isn't the caller's, or whose
    `status` isn't `active`;
  - `get_my_profile` or `/api/users` answers 401 or 403, or PostgREST
    returns a JWT error (`PGRST301`, `PGRST302`) or `42501`;
  - an admin check answers `false` (only for `admin: true`).
- **Transient:** the question couldn't be answered.
  - a fetch that throws (`TypeError`, `AuthRetryableFetchError`, an abort
    or a timeout);
  - HTTP status 0, 408, 429 or 5xx;
  - a response body that couldn't be parsed.

  The current request is still refused: `verifyLocalIdentity` returns
  `null`, and nothing protected is sent. But the code does **not** call
  `identityChanged`: the epoch, the listeners, the retained turns and the
  signed-in UI stay as they are.

A caller that gets `null` after a transient failure should show
"Connection problem. Try again." rather than a sign-in prompt. To support
this, `verifyLocalIdentity` records the kind of its last failure in a
module-level value, read through a new export `lastIdentityFailure()` that
returns `'transient' | 'authoritative' | null`. The return type of
`verifiedLocalIdentity` does not change, so no caller has to change for the
fail-closed behaviour to hold.

**Not changed:**
- the fail-closed rule for authoritative failures;
- the 401 handling in `patchUser`;
- the Auth event path (`onAuthStateChange` still announces every real Auth
  event, including `SIGNED_OUT`);
- P17 (`reconcileSavedTurn`'s return value).

## Acceptance evidence

Vitest in `src/lib/userStore.identityFailure.test.js`, with a mocked
Supabase client. Each case is run against the current code first and must
fail there (except the "authoritative still clears" cases, which pin
today's behaviour):

1. `get_my_profile` rejects with a `TypeError`. `verifiedLocalIdentity()`
   returns `null`, no identity listener is called, and
   `lastIdentityFailure()` is `'transient'`.
2. `get_my_profile` answers HTTP 503. Same as 1.
3. `getUser` fails with `AuthRetryableFetchError`. Same as 1.
4. `getSession` throws inside `localIdentityIsCurrent`. It returns `false`
   and no listener is called.
5. The admin directory read gets a network error or a 502. It returns `[]`
   and no listener is called. A 401 or 403 still calls `identityChanged(null)`.
6. Authoritative cases still clear: an inactive profile, a different user,
   `getUser` 401, and no session each call the listener with `null` exactly
   once.
7. Retained turns survive. With one retained operation in `researchChat.js`,
   a transient failure leaves it retained, and an authoritative failure still
   removes it.

Also: `npm test`, `npm run lint`, `npm run build`, the router import check,
and the Deno suite (because `src/lib/` changes). For the UI, one browser
check against the local dev server: with the network cut during a profile
read, the app stays signed in and shows the connection message.

## Scope

- `src/lib/userStore.js`: the classification, `lastIdentityFailure()`, and
  the three call sites above.
- The new test file.
- Callers that currently show a sign-in prompt when they get `null` (to be
  listed during implementation) show the connection message instead when
  `lastIdentityFailure()` is `'transient'`. There is no layout change.

## Exclusions

- A retry or backoff policy.
- Offline mode.
- Any change to the Edge Functions or the server routes.
- Any change to the Supabase Auth settings.
- P17.

## Question for the owner

Should a transient failure retry once automatically (after about 1 s)
before reporting "Connection problem"? The default in this spec is no
retry: it is simpler, and the user can retry.
