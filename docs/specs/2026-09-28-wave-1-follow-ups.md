# Spec: wave-1 follow-ups

> **Status: Living.** The owner approved the wave-1 follow-ups on
> 2026-09-28. Mark it Historical when every item below lands or moves to its
> own spec.

## Current state

Wave 1 of `docs/plans/2026-09-28-serverless-state-to-supabase.md` moved
preferences, analytics and app flags to Supabase. Its "Follow-ups from
wave 1" list left these defects, each confirmed in the code on 2026-09-28:

1. `src/lib/productAnalytics.js` sends no bearer, so the server records
   every event with `user_id` null. It also still copies the signed-in email
   into each event and into the localStorage queue, although the server has
   ignored it since T2.
2. The same client re-queues every failed event, so an event the server
   rejects with 400 is retried on every page load, forever.
3. `server/aiApi.mjs` checks the testing-phase flag through
   `assertAiAllowedInTesting`, which reads a process-local copy that starts
   at the defaults on a cold instance. On a fresh Vercel instance the flag
   reads as off whatever the database says.
4. `src/lib/apiVerification.test.js` "state persistence" only toggles that
   process-local copy, so it tests no persistence.
5. `src/admin/AdminSitePages.jsx` tells admins the video limit is 120 MB. The
   bucket and `server/marketingMediaApi.mjs` enforce 50 MB.
6. Anonymous `POST /api/analytics/event` has no rate limit.

## Expected outcome

1. Events carry the Supabase access token when a session exists; the server
   already verifies it and records `user_id`. No email is sent or queued, and
   queued events written by older builds lose their email on the next flush.
2. A 4xx response other than 408 and 429 drops the event. Network errors,
   408, 429 and 5xx keep it queued, as before.
3. `assertAiAllowedInTesting` is async and reads the durable flag through
   `fetchAppFlags()` on every call. If storage is unreachable, it falls back
   to the last value this process read, which matches the old cold-start
   behaviour.
4. The test checks that the durable flag decides, and that the
   process-local view does not.
5. The admin page says 50 MB.
6. Rate limit: **needs an owner decision** on the design (below). It is not
   part of this change.

## Acceptance evidence

- A test for each of items 1–4 fails before its fix.
- `npm test`, `npm run build`, the router import and the Deno suite pass.

## Scope and exclusions

- Write scope:
  - `src/lib/productAnalytics.js` and a new test beside it;
  - `server/appFlags.mjs`, `server/aiApi.mjs`, `src/lib/apiVerification.test.js`;
  - `src/admin/AdminSitePages.jsx`.
- Excluded:
  - the rate limit (item 6);
  - the remaining wave-1 notes: the `pg_cron` branch in a test database,
    merge-upsert through PostgREST, the signed-URL flow against real
    Storage, and the dev server's secret key.
  - Research-chat does not apply the testing-phase flag at all. That is a
    separate product question.

## Item 6: proposed rate-limit design (for the owner)

- The limit must hold across Vercel instances, so the counter lives in
  Postgres.
- A table would hold `(bucket, window_start, hits)`, with a
  security-definer function
  `analytics_rate_hit(p_bucket text, p_limit int, p_window_seconds int)
  returns boolean`. The function increments the current window and says
  whether the caller is still under the limit.
- The analytics route would call it once per event, keyed by a SHA-256 of
  the client IP (from `x-forwarded-for`) salted with a server secret. It
  would reject with 429 above 60 events a minute. No raw IP is stored, and a
  cron job deletes windows older than an hour.
- **Open questions:**
  - Is hashing the IP acceptable for analytics under your privacy policy?
  - Is 60 a minute the right limit?
