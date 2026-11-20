# Live TV: phase 2 plan

> **Status: Living (2026-11-19; released 2026-11-20).** Orders the development left on Live TV after the close-out
> ([2026-11-18-live-tv-closeout.md](2026-11-18-live-tv-closeout.md)) and the layout
> ([2026-11-19-live-tv-layout.md](2026-11-19-live-tv-layout.md)). The only list of open work is
> [open-work.md](open-work.md). The owner confirmed the plan on 2026-11-19 and reserved every merge to `main`.

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
  sources into their own work, and keep a whole session as a text file. Browser only, from the user's own sessions.
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
  Build only if it passes. The pass rule was written before the analysis and is kept outside the repository with the raw results.

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

Each track is one pull request against `feature/livetv-phase-2`, with one commit per item. Gates for every one: `npm test`, `npm run lint`, `npm run build`,
`npm run check:bundle`; the router import for track 1; `npm run test:sql` for track 3. A migration is applied on NTER only after the owner has approved
the whole branch, with no session running, by the documented method, before the merge to `main`.

## Branches and merges (owner, 2026-11-19)

All phase 2 work lives on the branch `feature/livetv-phase-2`. Each track builds on its own branch cut from it:
`task/p2-player`, `task/p2-panel` and `task/p2-usage`. The supervisor merges each track into
`feature/livetv-phase-2` after the independent review and after the supervisor's own re-run of the gates and of CI on
the track's pull request. Pull requests for the tracks target `feature/livetv-phase-2`, never `main`. Nothing is
merged to `main`. No migration is applied on NTER and no function is deployed until the owner has seen the whole
branch and approved. The reason is that another line of work, corpus ingestion, is releasing to `main` at the same
time. One pull request per track, with one commit per item, replaces "each item is its own pull request".

## Owner decisions (answered 2026-11-19)

1. F378: accept the worst-case cost as it is, or tighten the limits. Answer: accepted as it is for now.
2. B4: any YouTube video may be pasted and checked at the normal price. Answer: yes.
3. B6: "My list" kept in the browser first, or in the account from the start (a new table). Answer: in the browser
   first.
4. C1: a budget for the measurement runs. Answer: up to US$10. Step 1 uses only replies already collected, so it
   costs nothing.
5. The left-out list above is agreed. Answer: agreed.
6. Whether merges, migrations and deploys inside this plan may proceed after review, the supervisor's re-run and CI,
   without asking each time. Answer: the owner granted pull-request and merge permissions for the working branch, and
   reserved `main`.

## Results

- **C1, 2026-11-19: failed its rule at step 1, no fresh runs, nothing spent.** Details in the F352 entry of
  [open-work.md](open-work.md).
- **A1 (F376), built on the branch, 2026-11-19.** A claim still `pending` in a settled session reads "Not checked",
  but only after the server's finishing window (120 seconds after the session ended) plus the check timeout (45
  seconds). Before that it keeps "Checking…". Review finding fixed: the first version could say "Not checked" while the
  check was still allowed to finish.
- **A2 (F377), built on the branch, 2026-11-19.** In live mode the page plays a channel's live video when YouTube
  reports one and the written video is not live. The fact-check target follows it, and the video never changes under a
  session running on it. The page follows a newer live video, or returns to the written one when the stream ends. The
  channel list sends a `liveVideoId` field and keeps `status` meaning "the written video is live". Review findings
  fixed: a channel change during a running session left the new channel on its recording under a LIVE badge; a
  switched-to video stuck while the page stayed open. Not verified against the real YouTube service or in a browser.
- **B1, built on the branch, 2026-11-19.** A "Copy" button on every claim card with a verdict, and "Export" of a
  session as a text file, from the ended panel and from an opened past session. Text from claims and sources is cleaned
  of control, direction-override and line-separator characters. A printed page is not built.
- **B2, built on the branch, 2026-11-19.** Transcript search (works for Devanagari), copy and download, during and after
  a session and for a recorded video's readable parts. No server call.
- **B3, built on the branch, 2026-11-19.** A Summary tab made from the session's own claims, with no model call.
- **B4, built on the branch, 2026-11-19.** A pasted YouTube link plays in the page and can be fact-checked at the
  normal price. Only YouTube hosts are accepted, and the player address is always built from the 11-character video id.
  A pasted video is treated as recorded only when the player explicitly reports it is not live and gives a duration;
  otherwise it is live. Its sessions use the fixed channel id `youtube-link` and are never shareable. Read by the
  reviewer from the server code: the sharing check finds no such channel, so no transcript is stored. A video that
  cannot be embedded shows a message and a link to YouTube, and no fact-check is offered.
- **B5, built on the branch, 2026-11-19.** A refund of unlock credits is its own line in the usage history. New
  migration `20261124090000_factcheck_refund_usage.sql`, not applied anywhere but the disposable test database. Refund
  lines are returned only when the browser asks for them (`p_kind = 'all+refunds'`), so the migration and the browser
  can be released in either order. Review findings fixed: the release order in the migration header was backwards; the
  balance pop-up would have shown a refund as spending. Two things to remember: the refund amount is returned as stored
  and is not converted by `credit_current_amount`, so a future credit redenomination must handle it; and the channel of
  the session a user unlocked becomes visible to that user on the refund line.
- **B7, built on the branch, 2026-11-19.** For a recorded video the start screen preselects the length that covers the
  rest, up to 30 minutes, with the hint "Covers the rest of this video".
- **B6, built on the branch, 2026-11-19.** The channel inventory is done. Read-only research, executed by fetching each
  channel's public YouTube page: 108 attempted, 96 verified, 12 not verified and left out; all 13 existing channels'
  identities confirmed. The supervisor spot-checked 8 of the 96 against YouTube (executed, all matched). 83 verified
  channels were added to the 13 existing ones: 96 in all, in the client's ten lists, with a "Find a channel" box and
  "My list". "My list" is kept in the browser (key `nter.livetv.following.v1`, cap 60). Ids the server no longer lists
  are hidden, never deleted from storage. Search covers channel names (Latin only), list names and language words.
  Lookups never use `search.list`; their order and cost are in the second 2026-11-19 amendment of ADR 0009. The server
  budget and cache times are in the first 2026-11-19 amendment of ADR 0009. Built test-first, with two independent reviews, both findings
  sets fixed. Executed by the supervisor on the track: 9,144 tests, lint, build, bundle check, router import. Not
  verified: against the real YouTube service, in a real browser on the app, on a phone, with a screen reader.
- **State of the branch, 2026-11-19.** Tracks 1, 2 and 3 were each built test-first, re-run by the supervisor,
  independently reviewed, fixed, and merged into `feature/livetv-phase-2` (merge commit `dc88c3ed`). B6 was merged
  into the branch as well (merge commit `cc928cb3`). Executed on the combined branch before B6: 8,897 app tests, lint,
  build, bundle check, router import, and the SQL fixture `factcheck_refund_usage` with its vacuity proof. The
  supervisor's final run on the branch: 9,144 app tests, lint, build, bundle check, router import and the SQL fixture with its vacuity proof, all passing. Nothing is merged to `main`, applied on NTER or deployed. The live lookup work was merged as `e5643c72`.
- **Live lookup and refused videos, built on the branch, 2026-11-19.** The owner asked whether all channels load and
  work. A check of all 96 channels on public YouTube showed that the lookup missed many 24-hour streams. The same check
  showed that 15 channels' videos refuse to play inside another site (player error 150): wion, sansad-tv, cnbc-tv18,
  india-today, aaj-tak, zee-news, news18-india, cnn-news18, the-lallantop, cnbc-awaaz, zee-business, moneycontrol,
  zee-24-taas, news18-bihar-jharkhand and ptc-news. That is the channel owner's setting, and it cannot be changed from
  here. The fix has two parts. The lookup uses the order in the second 2026-11-19 amendment of ADR 0009. A video that the
  player refuses (errors 100, 101 and 150), or that YouTube marks as not embeddable, is not played. The page then falls
  back to the channel's written video with the line "{channel}'s live stream can't be played here.", or shows a card
  with a link to YouTube. A refusal never moves the video under a running fact-check, and the page says "This video
  stopped playing here. End the fact-check to get unused minutes back." Reload and Try again clear a remembered refusal.
  Built test-first, with one independent review (accept with fixes), and the fixes were made. Executed by the
  supervisor: 9,194 app tests, lint, build, bundle check, router import, and the SQL fixture, on the combined branch
  (merge commit `e5643c72`). Executed on the branch's preview deployment with the real key on 2026-11-19: all 96 channels were looked up once; 55
  answered live from YouTube data, 40 answered not live, and 1 (drishti-ias) timed out and fell back. Eight of the
  nine channels the public check feared missing (all but niti-aayog, which may not have been live at that hour) were
  found live. YouTube reported `embeddable` true for every live video, including the channels whose player refuses
  with error 150, so only the player's own error catches a refusal. Not verified: in a real browser on the app, or on
  a phone.
- **Release, 2026-11-20.** Pull request 197 merged to `main` as `818ad04a`; both CI jobs passed on the merge commit, and the production deployment completed. Production serves 96 channels from `/api/livetv/channels`, and `/api/livetv/videos?channelId=zee-news` answers `status: live` from the YouTube API. Migration `20261124090000_factcheck_refund_usage` was applied on NTER at about 02:20 UTC on 2026-11-20 with `supabase db query --linked -f` (the logged-in CLI, not `db push`), and its history row was inserted by hand afterwards. Before the migration: the source of `public.my_usage_activity` had md5 `e70f35ab…`, there was no helper, no history row, and every fact-check session was `settled`. After it: md5 `a5b51b75…` (the migration's own), `private.factcheck_refunds(uuid)` exists, `authenticated` cannot execute the helper and can execute `my_usage_activity`, and `anon` cannot. No Edge Function was deployed. Still owed after release: the refused-stream fallback seen in a signed-in browser, a phone check, the F375 checks that only a person can do, and a real refund line seen in a signed-in usage history.
