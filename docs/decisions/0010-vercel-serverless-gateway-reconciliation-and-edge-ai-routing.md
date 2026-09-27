# ADR 0010: Vercel Serverless Gateway Routing Reconciliation and Edge AI Routing

> **Status: Normative.** Binding architectural decision for Vercel production deployment routing and AI proxying.

## Context

When deploying NTER to Vercel (`niyantran-six.vercel.app`), all `/api/*` requests are rewritten to the consolidated serverless entrypoint `api/router.js` in accordance with Vercel Hobby plan limits (≤12 function files).

During initial deployment testing, the production console surfaced several issues:
1. `GET /api/marketing/intro-video` returned 404.
2. `GET /api/analytics/event` returned 404.
3. `GET /api/user-prefs` returned 404.
4. `POST /api/ai/chat` returned 502 Bad Gateway.
5. Supabase session clock skew warning was emitted in the browser console.
6. Browser extension warnings (`ObjectMultiplex orphaned data`, `MaxListenersExceededWarning`) appeared in the console.

## Root Cause Analysis

1. **Missing Route Registrations in `api/router.js`:**
   While Vite local dev configured `marketingMediaApiPlugin`, `analyticsApiPlugin`, and `userPrefsApiPlugin` in `vite.config.js`, the consolidated Vercel serverless gateway `api/router.js` omitted imports and handlers for `handleMarketingMediaApi`, `handleAnalyticsApi`, `handleUserPrefsApi`, and related server routes (`handleBillingApi`, `handleTransitApi`, `handleDiplomacyRequest`, `handleAssetsRequest`). Requests to these paths reached the fallback `res.status(404).json({ ok: false, error: 'No API route for ...' })`.

2. **Serverless Request Body Handling:**
   On Vercel, requests with JSON bodies often arrive pre-parsed (`req.body` as an object). Handlers in `analyticsApi.mjs` and `userPrefsApi.mjs` were attempting stream consumption via `for await (const chunk of req)`, which stalled or yielded empty buffers on pre-parsed streams.

3. **`POST /api/ai/chat` 502 Bad Gateway:**
   - On Vercel, `OPENROUTER_API_KEY` is not present in server environment variables (stored securely in Supabase Secrets per ADR 0008).
   - In `server/aiApi.mjs`, when `key` is absent and no authentication header is supplied, `runAiChat` throws `AI research service requires authentication.`. In `api/router.js`, this error fell through to a default 502 HTTP status instead of 401 Unauthorized.
   - When authenticated, `proxyResearchChat` was calling the Supabase `research-chat` Edge Function without the mandatory `turn_key` string and `attachments` array required by `validateRequest` in `supabase/functions/research-chat/validate.ts`, causing `research-chat` to reject requests with HTTP 400, which the proxy caught and transformed into 502.

4. **Supabase Clock Skew Warning:**
   The warning `@supabase/gotrue-js: Session as retrieved from URL was issued in the future? Check the device clock for skew` originates within `@supabase/auth-js` (`GoTrueClient.ts` line 3951) when `Date.now() / 1000 < iat`. This occurs when the client device's clock lags slightly behind Supabase Auth UTC server time. It is a non-breaking informational warning; session validation succeeds immediately after.

5. **External Extension Warnings:**
   `MaxListenersExceededWarning` and `ObjectMultiplex orphaned data` originate from web3/MetaMask browser-extension content scripts (`contentscript.js`), completely external to NTER application code.

## Decisions

1. **Consolidate All API Handlers in `api/router.js`:**
   Wire `handleMarketingMediaApi`, `handleAnalyticsApi`, `handleUserPrefsApi`, `handleBillingApi`, `handleTransitApi`, `handleDiplomacyRequest`, and `handleAssetsRequest` directly into `api/router.js`.
2. **Defensive Body Parsing:**
   In all server handlers, inspect `req.body` first: if already parsed as an object or string, use it directly before attempting stream reads.
3. **Harmonize `proxyResearchChat` with `research-chat` Contract:**
   - Supply `turn_key` (generated or client-provided UUID bounded to 64 chars).
   - Supply `attachments` array and bounded message length.
   - Pass `apikey` header (`SUPABASE_ANON_KEY`) alongside the `Authorization: Bearer <token>`.
   - Classify unauthenticated / auth-required errors as `401 Unauthorized` in `api/router.js`.
4. **Preserve Client-Side Edge Streaming:**
   The primary interactive research path in `AiPanel.jsx` continues to utilize `sendResearchTurn` connecting directly to Supabase Edge Functions with full SSE streaming and NyAiThinking animations.
