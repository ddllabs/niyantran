# Open work

The one list of open items for the mobile app. Add new items here; move them to Done with the
commit hash when they land.

## To go live (website team / owner)

| # | Item | Who | Notes |
|---|---|---|---|
| L1 | Add the app's origins to `research-chat` and `desk-brief` `ALLOWED_ORIGINS` (keep existing ones): `https://app.nter.pro` (Android WebView), `capacitor://app.nter.pro` (iPhone), and the address of the installable web app if it is hosted | Website team | Only needed for browsers and for word-by-word answers on phones (`VITE_STREAM_CHAT=1`). Phone apps already work without it (native HTTP). `http://localhost:5173` is already accepted. |
| L2 | Supabase → Auth → Redirect URLs: add `pro.nter.app://auth/callback`, then build with `VITE_GOOGLE_ON_PHONE=1` | Website team | Turns on Google sign-in in the phone apps. Email and password work today. |
| L3 | Host the installable web app (optional): `npm run build:web`, `vercel.json` rewrites `/api` to www.nter.pro | Website team | Add its origin to L1. |
| L4 | `delete-account` edge function (service role) and point Me → Delete my account at it | Website team | Apple requires deletion inside the app; today it sends a prefilled email. |
| L5 | Google Play developer account; upload key; closed test (12 testers × 14 days if a personal account) | Owner | `owner-actions.md` |
| L6 | Apple Developer Program (D-U-N-S for a company); TestFlight; App Review | Owner | Xcode 26 builds only. |
| L7 | Reviewer demo account on nter.pro with credits | Owner | Both stores ask for one. |
| L8 | Signed release builds in CI (`.aab` for Play, archive for App Store) | Mobile | Needs the upload key / Apple certificates as GitHub secrets. |

## Product follow-ups

| # | Item | Notes |
|---|---|---|
| P1 | Pins, Studio documents and the writing profile are kept on the phone | A table in the website repo would sync them across devices. |
| P2 | In-app purchase (Apple IAP, Google Play Billing) | Phone apps show plans without checkout until then. |
| P3 | Word-by-word answers on phones | After L1, build with `VITE_STREAM_CHAT=1`. |
| P4 | Enable RLS on six `private.credit_*` tables | Security advisory in `owner-actions.md`; website team decides. |

## Done

| Date | Item | Commit |
|---|---|---|
| 26 Oct 2026 | First version: all screens on the live backend, sample mode, Android and iOS projects, CI with APK | 4b24b7f |
| 26 Oct 2026 | Phone apps sign in with email and password only while NTER is unchanged | 74c4616 |
| 26 Oct 2026 | AI model list loads after sign-in (ai_models is closed to anonymous visitors) | 0efc93b |
| 26 Oct 2026 | Handover package: website-style layout, database kit, sample smoke test in CI | bf3d5c6 |
| 26 Oct 2026 | Desk card: nter.pro's record panel and NTER animation on every record, website adapters for 34 modules, website brief flow and payload; Ask AI's Desk section renamed Library; every-button sweep in CI | f69b3d5 |
