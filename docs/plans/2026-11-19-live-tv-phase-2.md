# Live TV: phase 2 plan

> **Status: Living (2026-11-19).** Orders the development left on Live TV after the close-out
> ([2026-11-18-live-tv-closeout.md](2026-11-18-live-tv-closeout.md)) and the layout
> ([2026-11-19-live-tv-layout.md](2026-11-19-live-tv-layout.md)). The only list of open work is
> [open-work.md](open-work.md). Nothing here is built until the owner confirms the plan and answers the decisions below.

## Purpose

The owner asked on 2026-11-19 for every remaining development item to be planned, with what each gives the user.
Checks that need a person are not in this plan; they are listed once in F375.

## What stays as decided

Listening is the browser tab's sound. Billing is fixed blocks with the credits held up front. The five verdict names
stay. The transcript is part of a paid session. Nothing in this plan changes a price.

## Items, with what each gives the user

### Group A: defects

- **A1 (F376). A claim left unchecked shows "Checking…" for ever in past sessions.** The user sees a past session
  that looks unfinished. Fix: a `pending` claim of a settled session reads "Not checked". Browser only.
- **A2 (F377). Four 24-hour channels play an old video.** On a page called Live TV, NDTV 24x7, ET Now, India Today TV
  and Aaj Tak show a recording. Fix: in live mode, play the channel's live video when YouTube reports one and the
  written video is not live; the fact-check then listens to what is really on air. The channel list marks such a
  channel live. Server and browser. The YouTube quota rule of ADR 0009 holds: no `search.list`.
- **A3 (F378). The worst-case cost of a hostile user.** No build unless the owner asks for tighter limits.

### Group B: features that fit today's design

- **B1. Copy a claim and export a session.** A journalist or researcher can lift a verdict with its reason and
  sources into their own work, and keep a whole session as a text file or a printed page. Browser only, from the
  user's own sessions.
- **B2. Transcript search, copy and download.** The user can find a sentence in what was said and take the text
  away. During a session and for a stored recorded-video transcript. Browser only.
- **B3. Summary tab.** At a glance: how many claims, how many of each verdict, and the contradicted ones listed
  first. Made from the session's own claims, with no model call, so it costs nothing.
- **B4. Paste a YouTube link.** The user can watch and check any YouTube video or live stream, not only the listed
  channels. Same price. A video whose owner forbids embedding is refused with a plain message and a link to YouTube.
- **B5. Refunds in the usage history.** A refund is visible as its own line, not only in the balance. Needs a change
  to a database function, so a migration.
- **B6. More channels, with lists, search and "My list".** The client's list of 108 channels, in the client's lists
  (Hindi news, English news, Politics and Debates, Parties and Leaders, Parliament and Government, Education,
  Economy, Research, International, Regional), a "Find a channel" box, and channels the user follows shown first.
  Each channel's YouTube identity is verified before it is added; the client's file has names only.
- **B7. "Check to the end".** For a recorded video the start screen offers the block that covers what is left of the
  video, up to 30 minutes. Browser only. Small.

### Group C: research before any build

- **C1 (F352, F365). Unsteady verdicts and rounding.** The user gets the same verdict for the same claim. Measure a
  second-step judge for numeric claims against the reference answers, with the pass rule fixed before the runs.
  Build only if it passes.

### Left out, with the reason

- **A check of a whole video without playing it, and leaving the page while it runs.** Needs the server to fetch the
  audio itself, which the owner decided against (tab listening).
- **Speaker names and filters.** The chunked transcription gives no speakers; needs a streaming provider key.
- **Reasons in Hindi.** Shared results on a recorded video are stored once for all users, so a language choice needs
  a storage decision first.
- **Reminders, "notify me when live", automatic fact-check.** There is no notification system and no published
  schedule to hang them on.
- **A custom player bar (captions, quality, picture in picture).** YouTube's own controls already give these.

## Order and agents

Roles as in the coordination rules: the supervisor writes the briefs, reproduces every gate, commits and opens pull
requests; builders build test-first and leave work uncommitted; an independent reviewer reviews each track; a
documentation agent writes each track's spec and the tracker entries from the supervisor's brief.

Three tracks run at the same time, each in its own worktree, with write scopes that do not overlap:

| Track | Items, in order | Write scope |
|---|---|---|
| 1. Player and channels | A2, then B4, then B6 | `server/liveTvApi.mjs`, `src/shell/LiveTvPage.jsx`, `src/shell/liveTv/**` |
| 2. Panel | A1, then B2, B3, B1, B7 | `src/shell/factcheck/**` |
| 3. Usage history | B5 | `supabase/migrations`, `supabase/tests`, the usage screen files |

Two read-only tracks run beside them: the channel inventory for B6 (each channel's YouTube identity and whether it has
a 24-hour stream, as a file the supervisor checks before track 1 reaches B6), and the measurement C1.

Each item is its own pull request. Gates for every one: `npm test`, `npm run lint`, `npm run build`,
`npm run check:bundle`; the router import for track 1; `npm run test:sql` for track 3. A migration is applied on NTER
only with no session running, by the documented method, before its merge.

## Decisions needed from the owner

1. F378: accept the worst-case cost as it is, or tighten the limits.
2. B4: any YouTube video may be pasted and checked at the normal price.
3. B6: "My list" kept in the browser first, or in the account from the start (a new table).
4. C1: a budget for the measurement runs.
5. The left-out list above is agreed.
6. Whether merges, migrations and deploys inside this plan may proceed after review, the supervisor's re-run and CI,
   without asking each time.
