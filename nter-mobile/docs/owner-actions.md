# What the owner needs to do

The app works against the live nter.pro backend as it is today. These steps unlock the parts that
need a setting changed or an account that only the owner can hold. None of them was done for you:
the database and the website were only read while the app was built.

## Owner decision, 26 Oct 2026: nter.pro and NTER stay unchanged

The nter.pro website code (`ddllabs/niyantran`) and the NTER Supabase project are not to be
changed for this app. The app works within that: email and password sign-in, desks, AI answers,
briefs, credits, conversations and the watchlist all use what NTER already offers. Items 2–4 below
change NTER settings, so they are **not planned**; they are listed only so the trade-off is known
(without them: no Google sign-in in the phone apps, and answers arrive whole rather than word by
word). The security advisory at the end is information only.

## Before the first release

1. **Let Claude push to GitHub (optional).** Install the Claude GitHub app on `tamanesh1993/NTER-Mobile-App` (https://github.com/apps/claude/installations/select_target), or push the code yourself from the zip.
2. **Google sign-in on the phone.** Supabase → Authentication → URL Configuration → Redirect URLs: add `pro.nter.app://auth/callback`. Email and password sign-in works without this.
3. **Word-by-word answers on the phone (optional).** In the `research-chat` function's secrets, add these to `ALLOWED_ORIGINS` (comma-separated, keep the existing ones): `https://app.nter.pro` (Android) and `capacitor://app.nter.pro` (iPhone). Then build with `VITE_STREAM_CHAT=1`. Without it, answers arrive whole when they finish.
4. **The installable web app (optional).** To host `npm run build:web` on its own address (for example `m.nter.pro`), add that origin to `ALLOWED_ORIGINS` too, and to Supabase's redirect URLs for Google sign-in.

## Store accounts

| Store | Cost | What you need |
| --- | --- | --- |
| Google Play | US$25 once | A Play Console developer account; an upload key (Android Studio → Build → Generate Signed Bundle) |
| Apple App Store | US$99 a year | An Apple Developer account (an organisation account needs a D-U-N-S number), a Mac with Xcode 26 or later — App Store Connect has accepted only Xcode 26 / iOS 26 SDK builds since 28 April 2026 |

Both stores ask for a privacy policy URL (`https://www.nter.pro/privacy`), a support contact, and a
demo login for the reviewers (make a test account on nter.pro with some credits).

- **Google Play testing rule.** A personal developer account created after 13 November 2023 must run a closed test with at least 12 testers opted in for 14 consecutive days before it can publish to production. Organisation accounts are exempt. Google Play also requires new apps to be uploaded as an Android App Bundle (.aab), and from 31 August 2026 to target Android 16 (API 36) — this app already does.

## Store rules to know

- **Payments.** Apple and Google do not allow a phone app to send people to a website to buy a digital subscription. The phone builds therefore show the plans without a checkout button; a member who buys on nter.pro gets the plan in the app straight away. Selling inside the app later means adding Apple In-App Purchase and Google Play Billing (RevenueCat has a free tier) and crediting the plan from their webhooks.
- **Account deletion.** Apple requires a way to delete the account from inside the app. Today "Delete my account" sends a prefilled email to niyantranai@gmail.com. For a smoother review, add a `delete-account` edge function (service role, deletes the auth user and their rows) and point the button at it.
- **Sign in with Apple.** If Google sign-in is offered on iPhone, Apple usually asks for Sign in with Apple too. Enable the Apple provider in Supabase and add the button, or hide Google on iOS.

## Security advisory found while reading the database

Supabase's advisor lists six tables in the `private` schema with row-level security turned off:
`credit_launch_grants`, `credit_turn_messages`, `credit_epoch`, `credit_legacy_entries`,
`credit_lot_conversions`, `credit_wallet_conversions`. The `private` schema is not exposed through
the API by default, so this is low risk, but turning RLS on closes it for good. Not applied — the
fix, for you to run when ready:

```sql
alter table private.credit_launch_grants enable row level security;
alter table private.credit_turn_messages enable row level security;
alter table private.credit_epoch enable row level security;
alter table private.credit_legacy_entries enable row level security;
alter table private.credit_lot_conversions enable row level security;
alter table private.credit_wallet_conversions enable row level security;
```
