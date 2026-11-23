# Handover — nter.pro mobile app

For the developer taking the app live. Written 26 Oct 2026. Read `../AGENTS.md` first.

## What this is

The phone app for nter.pro: Android, iPhone and an installable web app from one React + Vite
codebase (Capacitor 8). It is a client of the existing backend — the NTER Supabase project and
www.nter.pro's `/api` — with no server or database of its own. It adds nothing to NTER, so there is
no migration to run (`../supabase/README.md`).

| Part | Status |
| --- | --- |
| Screens | Welcome (site globe), sign in / sign up / reset, perspective, Home (nter.news feed, desks, markets, watchlist), Library (8 desks → sectors → 120 modules → records), desk card (nter.pro's record panel with the NTER animation; PDF, pin, watch), search, Ask AI (Library · AI chat · Studio, attachments incl. PDFs, model/effort by plan, citations, follow-ups, history, stop), Quick Exit (94 documents) → Make → Studio (gap markers, PDF/Word), Me (plan, credits, perspective, writing profile, watchlist, library, theme, about) |
| Native projects | `android/` (app id `pro.nter.app`, target API 36), `ios/` (Swift Package Manager, no CocoaPods) |
| Builds | `npm run build` (phones), `build:web` (installable web app), `build:sample` (offline demo) |
| CI | `.github/workflows/ci.yml`: lint, unit tests, three builds, two browser smoke tests, the every-button sweep, Android debug APK |

## Verified on 26 Oct 2026

From a browser on the owner's Mac (http://localhost:5173, the live build), read-only:

| Check | Result |
| --- | --- |
| nter.news feed `/api/home/latest` | 23 stories, newest 26 Oct, ~200 ms |
| Markets `/api/home/markets` | 9 quotes, ~400 ms |
| Landing figures `/api/site-figures` | 9,817 bills |
| All 120 modules `/api/feature-feed` | **115 return live rows, 0 HTTP errors**, slowest 1.7 s. The other 5 (State: municipal and state tender aggregators, district performance, district governance, …) are "Module planned" on nter.pro itself. |
| Sign-in session, `get_my_profile`, `my_entitlement_manual`, `my_credits_cycle_v3` | pass |
| `ai_models` (11 enabled), `conversations`, `user_preferences`, `search_desk_rows` | pass |
| `desk-brief` (read mode) | pass, state `ready` |
| `research-chat` from `http://localhost:5173` | reachable (CORS allowed); refuses calls without a member token (401), as designed. A full answer spends credits and writes a conversation, so it is the first thing to try after `git pull` (step 1 below). |

Database (read-only SQL, `backend-checks.sql`): 257 live feeds, none failing or overdue;
1,811 feed runs in 24 h, 26 failed or timed out (1.4 %); 139,937 desk records; 11 AI models
enabled; 9 AI answers that day with no failures; average model latency 1.6 s. Latest NTER
migration is still 20261023192554 — nothing was changed by this work.

Automated, on the final build (and in CI on every push):

| Test | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm test` — 181 unit tests | pass. Includes a desk card for every record in the bundled snapshot (~100 modules) checked against the website's own card contract, the website brief flow (read → write once → poll), the request row matching the website byte for byte, nter.pro's citation fixture, and a hash check of every file copied from the website |
| `npm run test:smoke` — whole app on the snapshot, no network | 15 / 15 steps pass, including the NTER animation → desk card |
| `npm run test:smoke:live` — live build against a stand-in backend | 8 / 8 steps pass; 23 backend calls checked against NTER's contract; desk-brief called read then write |
| `npm run test:buttons` — every button on every reachable screen and sheet | 474 buttons on 53 screens and sheets pressed; **0 page errors, 0 console errors or warnings, 0 failed requests, 0 calls leaving the phone**. Log: `test-results/buttons/report.txt` (CI artifact `button-sweep-log`) |
| Builds | phones, installable web app and offline demo build; Android debug APK in CI |

Contract snapshot of every table, grant, policy and RPC the app uses: `../supabase/schema/app-surface.sql`.

**Fixed on 26 Oct:** the AI model list loaded before sign-in; `ai_models` is readable only by
signed-in members, so it came back empty and Ask AI looked disconnected. It now loads on sign-in
(commit 0efc93b).

## The desk card

Tapping any record (a bill, notice, order, front, register row) opens nter.pro's own desk card from
the right, as the website opens its side panel:

1. **The NTER animation** ("NTER is thinking") — the website's `nter-record-loader` web component,
   copied unchanged to `public/animation/` — plays for 2.5 s while the AI brief is read.
2. **The card** — the website's record panel: title, badge, links, *01 At a glance* (tiles plus a
   map, stage timeline or value board), *02 About* with the Niyantran analysis, Quick exit, related
   records, source and as-of. The 34 modules the website has a card adapter for (bills, questions,
   pipeline, regulators, MPs, affidavits, cabinet, morning brief, Open Fronts, alliances, sanctions,
   aid, nuclear, heads of state, trade, commodities, constitutions, courts, tribunals, WTO, ICJ/ICC,
   NCLT…) use the website's adapter code unchanged; every other module gets the same card built from
   its fields (`src/deskcard/genericModel.js`, the rules of the website's RecordDetail).
3. **The brief** follows the website exactly: read first (never writes); if nothing is stored, the
   card says "Writing the AI brief…" and the platform writes it once for every later reader; if
   another reader is writing it, the card waits. The row is sent byte-for-byte as the website sends
   it, so app and website share the same stored briefs.

The copied files and the website commit they came from are listed in `src/shell/website-sync.json`;
`npm run sync:website -- <website checkout>` refreshes them, and a unit test fails if a copy is
edited here.

## To take it live

In order. Items marked *website* change NTER settings and are for the website team to decide.

1. **Install and run** — `nvm use && npm install && npm run dev` (Node 24). Sign in with an
   nter.pro account at http://localhost:5173, open Ask AI and ask a question; the model picker
   should list the plan's models and the answer should arrive with citations.
   `npm run check:backend` checks the backend from the command line.
2. *Website* — **Origins for the AI functions.** Add to the `ALLOWED_ORIGINS` secret of
   `research-chat` and `desk-brief` (comma-separated, keep the existing values):
   `https://app.nter.pro`, `capacitor://app.nter.pro`, and the hosted web app's address if any.
   Needed for the installable web app and for word-by-word answers on phones
   (`VITE_STREAM_CHAT=1`). The phone apps already work without it: they use native HTTP.
3. *Website* — **Google sign-in on phones.** Supabase → Authentication → URL Configuration →
   Redirect URLs: `pro.nter.app://auth/callback`; then build with `VITE_GOOGLE_ON_PHONE=1`.
4. *Website* — **Account deletion.** A `delete-account` edge function (service role) and point
   Me → Delete my account at it (`src/screens/Me.jsx`). Apple requires deletion inside the app.
5. **Android release.** Android Studio → `npm run android` → Build → Generate Signed Bundle (.aab)
   with a new upload key (keep it safe; Play App Signing holds the app key). Upload to Play Console
   → Internal testing → store listing, Data safety, privacy policy `https://www.nter.pro/privacy`,
   reviewer login. A personal developer account needs a closed test with 12 testers for 14 days.
6. **iPhone release.** On a Mac with Xcode 26: `npm run ios` → set the Team (Apple Developer
   account) → Product → Archive → Distribute → App Store Connect → TestFlight → submit. Privacy
   labels, screenshots (6.9" and 6.5"), reviewer login.
7. **Installable web app (optional).** `npm run build:web` and host `dist-web` — `vercel.json`
   already rewrites `/api` to www.nter.pro. Add its origin in step 2.

## Things to know

- Plans are bought on nter.pro only; the phone builds show plans without a checkout button (store
  rules on outside payment links). In-app purchase is open item P2.
- Pins, Studio documents and the writing profile are stored on the phone, not in the account.
- The publishable Supabase key in `src/lib/config.js` is public by design. No secret is in the repo;
  never add one.
- Open items and their owners: `plans/open-work.md`.
