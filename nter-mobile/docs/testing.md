# Testing the app

Three levels: the app on a phone, the backend calls the app makes, and the database underneath.
Nothing here changes nter.pro's code or NTER's structure; the only data written is what any
member creates by using the product (a question, a watchlist change, a brief).

## 1. The app on a phone

**Android.** GitHub → this repo → Actions → the newest *CI* run → Artifacts → `nter-pro-debug-apk`.
Unzip, copy `app-debug.apk` to the phone, open it, allow installs from that source once.

**iPhone.** On a Mac with Xcode 26: `npm install && npm run build && npx cap sync ios && npx cap open ios`,
choose your iPhone, press Run (a free Apple ID installs it on your own phone for 7 days).

Sign in with an nter.pro account, then work down this list. The last column is the check in
`docs/backend-checks.sql` that confirms the same thing from the database side.

| # | Do this in the app | You should see | Database check |
| --- | --- | --- | --- |
| 1 | Open the app | Welcome page with the globe; figures (bills, modules) load | — |
| 2 | Sign in | Home; your perspective is remembered | D |
| 3 | Home | "LIVE · LATEST" (not SAVED), today's nter.news stories, markets with today's numbers | A, C |
| 4 | Library → National → Legislative → Bill Passage | 9,800+ records, search works, Next page works | C (desk records) |
| 5 | Open a bill | The desk card slides in from the right; "NTER is thinking" plays for 2.5 s; then the card as on nter.pro: title, stage badge, 01 At a glance, stage history, 02 About this bill with the Niyantran analysis | H |
| 6 | Open a record nobody has opened before | "Writing the AI brief…" during the animation, then the brief (written once, at nter.pro's cost, for every later reader) | H (new row at the top) |
| 7 | Tap the bell on a module | "Added to your watchlist"; it shows under My watchlist on Home and on nter.pro | G |
| 8 | Ask AI about this record | An answer with numbered citations; tap a number to see the source | E |
| 9 | Me → credits | The balance went down by the answer's cost | D, F |
| 10 | Ask AI → history (clock icon) | The conversation is listed, also on nter.pro | E |
| 11 | Quick Exit → pick a document → Make | The document with marked gaps; Open in Studio; export PDF | E, F |
| 12 | Me → Light / Dark | The whole app switches theme | — |
| 13 | Airplane mode, reopen a module | "The live feed did not answer, so this is the copy saved with the app" | — |

Send screenshots of anything that looks wrong.

## 2. The backend calls the app makes

From a Mac or PC with Node 24, in this repo:

```bash
npm install
npm run check:backend                                  # public feeds: news, markets, all 8 desks
NTER_EMAIL=you@example.com npm run check:backend        # + sign-in, plan, credits, models, conversations, search, brief
NTER_EMAIL=you@example.com npm run check:backend -- --ask   # + one short AI answer (costs a few hundred credits)
```

It prints PASS or FAIL per call with its timing, asks for the password without showing or saving
it, and only reads — except `--ask`, which asks one normal question.

## 3. The database

Supabase dashboard → project **NTER** → **SQL Editor** → New query → paste one block from
`docs/backend-checks.sql` → Run. Every block is a single SELECT (it only reads):

- **A** feeds that are failing or overdue (empty = healthy)
- **B** feed runs in the last 24 hours by result
- **C** the service at a glance: live feeds, desk records, models, AI answers and failures today
- **D–G** one member: account and credits, conversations, credit movements, watchlist
- **H** the newest AI briefs

Other places in the dashboard, all read-only to look at:

- **Edge Functions → research-chat / desk-brief → Invocations and Logs**: every AI answer and brief, with status and duration
- **Logs → Postgres / Auth**: sign-ins and database errors
- **Advisors → Security**: the six `private.credit_*` tables listed in `owner-actions.md`

Or ask Claude to run checks A–H: it uses the same read-only queries.
