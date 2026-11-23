# Agent and developer instructions

> **Status: Normative.** These rules bind every person and coding agent working in this
> repository. Correct this file when the real workflow changes.

## Project intent

nter.pro mobile is the phone app for nter.pro (Android, iPhone and an installable web app). It is
a **client** of the existing nter.pro backend: the NTER Supabase project and www.nter.pro's public
`/api`. It has no server and no database of its own, and it adds no tables, columns, functions or
policies to NTER.

The website lives in `ddllabs/niyantran`; its `AGENTS.md` governs the backend. This repository
follows the same stack and conventions: React 19 + Vite, plain JavaScript (JSX), Node 24, ESLint 9,
Vitest with tests next to the code, `src/lib/supabaseClient.js`, `src/lib/citationMarkers.js`.

## Required reading

1. This file.
2. `docs/START-HERE.md` — reading order, setup, how the pieces fit.
3. `docs/backend-contract.md` — every call the app makes and its shape.
4. `docs/plans/open-work.md` — what is open and on whom.

## Authority

- The owner decides product scope, releases, store submissions and anything that touches NTER or
  the website.
- **Never change NTER or the website from this repository**: no migrations, no edge-function
  deploys, no secret or auth-setting changes, no writes with a service-role key. Changes the app
  would benefit from are written up in `docs/plans/open-work.md` for the website team to make.
- No service-role key, provider key or other secret may enter this repository. The only key the
  app ships is the Supabase publishable key, which is public by design.

## How work proceeds

- Read the code before changing it; keep changes small and inside the requested scope.
- Shapes of backend data are defined by the website's code and migrations. When they change there,
  update `docs/backend-contract.md`, the live service and the sample together.
- Database access while building or debugging is read-only (`select`, read RPCs). See
  `supabase/README.md`.
- **The desk card is the website's.** `src/shell/record/` (adapters, visuals, contract,
  stylesheet), `public/animation/` (the NTER record animation) and the `src/lib`, `src/data` and
  `src/desks` files listed in `src/shell/website-sync.json` are copies of `ddllabs/niyantran` at the
  commit named there. Do not edit them here (a unit test checks their hashes): change the website,
  then run `npm run sync:website -- <path to a website checkout>`. The phone-only parts are in
  `src/deskcard/`.

## Definition of done

All of these pass locally and in CI before a change is merged:

```bash
npm run lint
npm test                    # unit tests (src/**/*.test.js)
npm run build && npm run build:web && npm run build:sample
npm run test:smoke          # whole app in Chromium on the sample, no network
npm run test:smoke:live     # live build in Chromium against a stand-in backend
npm run test:buttons        # every button on every reachable screen and sheet; log in test-results/buttons/
```

`npm run check:backend` (against the real backend) is run before a release.

## Layout

```
src/services/   live.js (nter.pro backend) · sample.js (bundled snapshot) · shape.js · chatState.js
src/state/      app.jsx (account, navigation, sheets) · chat.jsx (Ask AI) · studio.jsx
src/screens/    one file per screen        src/sheets/   bottom sheets, Quick Exit shutter
src/deskcard/   the desk card on the phone: DeskCard.jsx, useDeskBrief.js, genericModel.js
src/shell/record/  copied from the website: record adapters, visuals, contract, recordPanel.css
src/ui/         icons, markdown, shared pieces
src/lib/        supabaseClient, http, sse, storage, exporters, files, citationMarkers
src/data/       desks (generated), personas, plans, Quick Exit catalogue, stories
src/sample/     the read-only snapshot used by VITE_DATA_MODE=sample and by the tests
supabase/       schema snapshot of what the app reads, sample seed, local replica guide
scripts/        export-sample, check-backend, smoke tests, button sweep, sync-website-record
android/ ios/   Capacitor native projects
docs/           start here, backend contract, testing, owner actions, open work, handover
```
