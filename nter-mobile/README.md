# nter.pro mobile

The phone app for **nter.pro**, Niyantran's research terminal for government, policy, law and
global affairs. One codebase builds the Android app, the iPhone app and an installable web app.

It is the mobile version of the website, on the same backend: the same accounts, plan and AI
credits, conversations and watchlist, the same eight desks and 120 modules, and the same AI.

## What is in it

- **Welcome** — the nter.pro home page on a phone, with the site's own WebGL globe and the live "record at a glance" figures. Browse without an account, sign in, or create one.
- **Home** — the nter.news feed first (lead story, sections, hot topics), then the desks carousel, markets, your watchlist and the morning briefing.
- **Library** — the eight desks → sectors → modules → records, from the same `/api/feature-feed` the website reads. Large modules page and search on the server.
- **Desk card** — tap any bill, notice, order or row: the card slides in from the right as nter.pro's side panel does, the NTER animation plays while the AI brief is read (or written, the first time anyone opens the record), then nter.pro's own card shows — title, badge, 01 At a glance with its map, timeline or board, 02 About with the Niyantran analysis, Quick exit, related records, source and as-of. Below it: Quick Exit, PDF, pin and watch.
- **Ask AI** — three sections: *Library*, *AI chat* (default) and *Studio*. Attach records, PDFs or text files; choose model, effort, focus and web search; answers stream in with tappable citations, follow-up questions, copy, PDF, Word, share and re-run. Conversations are the same as on the website.
- **Quick Exit** — the five-blade shutter with the 94 working documents for your perspective. Pick one, answer one question, and the AI writes it from the record with every gap marked.
- **Studio** — edit what Quick Exit or an answer made; fill gaps or mark them verified; export to PDF or Word.
- **Me** — profile, plan and credits, perspective, writing profile, watchlist, your library, light/dark theme, about and image credits.

## Technology (all free)

| Layer | Choice |
| --- | --- |
| UI | React 19 + Vite 8, plain JavaScript — the same stack as the website |
| Phone apps | Capacitor 8 (Android and iOS projects are in `android/` and `ios/`) |
| Backend | The existing Supabase project and nter.pro API — no new server |
| Documents | pdf-lib (with Inter) and docx, made on the phone; pdf.js reads attached PDFs |
| Builds | GitHub Actions: tests, web build and an Android APK on every push |

**New here? Read `docs/START-HERE.md`, then `docs/HANDOVER.md` (state of the app and the steps to
take it live).** Rules for anyone changing this repo, people or AI agents: `AGENTS.md`.

## Run it

Node 24 (`nvm use` reads `.nvmrc`).

```bash
npm install
npm run dev:sample        # offline, with the bundled read-only snapshot — no sign-in needed
npm run dev               # live: nter.pro's backend on http://localhost:5173 (sign in with your nter.pro account)
```

`npm run dev` proxies `/api` to www.nter.pro (or `API_PROXY`), so the browser preview reads the
live public feeds. Port 5173 is the origin nter.pro's AI functions already accept.

## Test it

```bash
npm run lint              # ESLint, zero warnings
npm test                  # unit tests (Vitest), next to the code as *.test.js — incl. a desk card for every sample record
npm run test:smoke        # the whole app in a headless browser on sample data — 15 steps, no network
npm run test:smoke:live   # the live build against a stand-in backend — every request checked against NTER's contract
npm run test:buttons      # every button on every reachable screen and sheet, with a full log in test-results/buttons/
npm run check:backend     # read-only checks of the real nter.pro backend (docs/testing.md)
```

The smoke tests need Chromium once: `npx playwright install chromium`. CI runs all of the above
except `check:backend` on every push.

### Data modes

| `VITE_DATA_MODE` | What the app reads |
| --- | --- |
| `live` (default) | nter.pro's Supabase project and public API |
| `sample` | `src/sample/` — a read-only snapshot taken on 26 Oct 2026: 8 desks, 110 of 120 modules with real rows, 19 nter.news stories, markets, 40 AI briefs, the model list. Sign-in is simulated on the device and AI answers are canned and labelled. |

The snapshot was read with `SELECT` only and from the website's own archive files; nothing was
written to the database. `scripts/export-sample.mjs` regenerates the desk catalogue from the
website repository.

## Build the phone apps

```bash
npm run build          # web assets for the phone apps (in dist/)
npx cap sync           # copy them into android/ and ios/
npx cap open android   # Android Studio → Run, or Build → Generate Signed Bundle
npx cap open ios       # Xcode 26 (on a Mac) → Run, or Product → Archive
```

No Android Studio? Every push to GitHub builds `app-debug.apk` (Actions → CI → artifacts) that
installs on any Android phone.

Other builds: `npm run build:web` (installable web app with offline support, in `dist-web/`),
`npm run build:sample` (offline demo), `npm run build:preview` (demo that runs from any folder).

App id `pro.nter.app`. Phone builds sign in with email and password; Google sign-in on phones
returns to `pro.nter.app://auth/callback` once that redirect URL is added in NTER (see
`docs/HANDOVER.md`).

## Settings

Copy `.env.example` to `.env.local` to override:

| Variable | Default |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://vfgcppstyzjarlzyqdac.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the website's publishable key (public by design) |
| `VITE_API_BASE` | `https://www.nter.pro` (phone apps) |
| `VITE_WEB_API_BASE` | empty — browsers use the same site (`vercel.json` rewrites `/api`) |
| `VITE_DATA_MODE` | `live` |
| `VITE_STREAM_CHAT` | `0` — set to `1` once the app's origins are in `ALLOWED_ORIGINS` |
| `VITE_GOOGLE_ON_PHONE` | `0` — set to `1` once the redirect URL above is added |
| `API_PROXY` (dev only) | `https://www.nter.pro` — point at a local website server for a separate backend copy |

No secret keys are used or needed. Never put a service-role key in this app.

## The desk card comes from the website

`src/shell/record/`, `public/animation/` and the files listed in `src/shell/website-sync.json` are
copies of nter.pro's code (ddllabs/niyantran, commit in that file), so the phone shows the card the
website shows. Don't edit them here; change the website and run
`npm run sync:website -- <path to a website checkout>`. A unit test fails if a copy drifts.

## Database

The app has no database of its own and adds nothing to NTER, so there is nothing to migrate.
`supabase/README.md` lists where each thing the app saves lands in NTER, and how to run a separate
local copy of the backend; `supabase/schema/app-surface.sql` is a snapshot of everything the app
depends on, and `supabase/seed/mobile-sample.sql` is sample data for that local copy.

## Layout

```
src/
  services/   live.js (nter.pro backend) · sample.js (snapshot) · shape.js · chatState.js
  state/      app.jsx (account, navigation, sheets) · chat.jsx (Ask AI) · studio.jsx
  screens/    Welcome, Auth, Persona, Home, Story, Library, Sector, Module, Record, Search, Ask, Studio, Make, Me
  sheets/     every bottom sheet, and the Quick Exit shutter
  ui/         icons, markdown with citations, shared pieces
  deskcard/   the desk card on the phone: DeskCard.jsx (the website's markup), useDeskBrief.js (its brief flow), genericModel.js
  shell/record/  copied from nter.pro: the record adapters for 34 modules, visuals, card contract, recordPanel.css
  lib/        supabaseClient.js, HTTP, event stream, citation markers (same rules as the website), storage, exports, files,
              and the website helpers the adapters import (impactRecord, format, …)
  data/       desks, personas, plans, Quick Exit catalogue, stories
  sample/     the read-only snapshot
  **/*.test.js  unit tests sit next to the code they test, as on the website
scripts/      smoke tests, button sweep, backend checks, sample export, local seed, sync-website-record
public/animation/  the NTER record animation (the website's nter-record-loader, unchanged)
supabase/     schema snapshot, local seed, how to run a separate copy (no migrations: nothing to add)
android/ ios/ the native projects (Capacitor)
docs/
  START-HERE.md         reading order and how the setup works
  HANDOVER.md           state on 26 Oct 2026, verification results, steps to go live
  plans/open-work.md    open items and the done log
  backend-contract.md   every call the app makes, and its shape
  owner-actions.md      settings and accounts only the owner can change
  testing.md            how to test the app, the API and the database
  backend-checks.sql    read-only SQL health checks for the Supabase SQL editor
```

## Before releasing

Read `docs/HANDOVER.md` (steps to go live) and `docs/owner-actions.md`: streaming origins, Google
sign-in redirect URL, store accounts, the payment rule for phone apps, account deletion, and one
database security advisory.

Formatted, not filed: documents the app makes are drafts to check before signing. Answers and
briefs are information, not advice.
