# Start here

Status: **Living.** Entry point for anyone picking up the nter.pro mobile app. Update it when the
setup below changes.

## Read in this order

| # | Document | What it gives you |
|---|---|---|
| 1 | `../AGENTS.md` | The rules: what this repo may and may not touch, definition of done |
| 2 | `HANDOVER.md` | The state of the app on 26 Oct 2026 and the steps to take it live |
| 3 | `backend-contract.md` | Every call the app makes to NTER and nter.pro, with shapes |
| 4 | `../supabase/README.md` | What the app stores where; separate local copy of the backend |
| 5 | `testing.md` | How to test the app, the API and the database |
| 6 | `plans/open-work.md` | Open items, owner actions and the done log |
| 7 | `owner-actions.md` | Store accounts, store rules, the security advisory |

When a document and the code disagree, the code wins and the document gets fixed.

## How the setup works

- **No backend of its own.** The app talks to the NTER Supabase project (auth, REST, RPC, the
  `research-chat` and `desk-brief` functions) and to `https://www.nter.pro/api/*` (news, markets,
  desk feeds). Same accounts, credits, conversations and watchlist as the website.
- **Two data modes.** `VITE_DATA_MODE=live` (default) and `sample` (a read-only snapshot in
  `src/sample`, used for demos and every automated test; no network).
- **Phone apps use native HTTP** (Capacitor), so they are not subject to CORS. Browsers are:
  `/api` goes through the Vite proxy (dev) or a host rewrite (`vercel.json`); the edge functions
  accept only origins on their `ALLOWED_ORIGINS` (default `http://localhost:5173`).
- **One codebase, three targets.** `npm run build` → `npx cap sync` for Android and iOS;
  `npm run build:web` for an installable web app.

## Setup

```bash
nvm use            # Node 24 (.nvmrc)
npm install
npm run dev:sample # offline, sample data
npm run dev        # live nter.pro backend, http://localhost:5173
```

Android: Android Studio (Ladybug or newer) and JDK 21 — `npm run android`.
iPhone: Xcode 26 on a Mac — `npm run ios`.
