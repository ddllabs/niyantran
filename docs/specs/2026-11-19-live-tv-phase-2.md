# Live TV phase 2: the items, their evidence and their limits

> **Status: Living (2026-11-19).** Turns the [phase 2 plan](../plans/2026-11-19-live-tv-phase-2.md) into one
> spec: what each item must do, how it is accepted, and what stays out. The only list of open work is
> [open-work.md](../plans/open-work.md), where the items are F367 and F375 to F378. The owner confirmed the plan on
> 2026-11-19 and reserved every merge to `main`.

## Current state

The channel list now reads live status from a per-channel lookup, and the page shows LIVE only for a live video
(F367, live since 2026-11-19). Four 24-hour channels still play a recorded video, not their live stream (F377). A
claim left unchecked at the end of a session shows "Checking…" for ever in past sessions (F376). The owner accepted
the worst-case cost of the fact-check as it is for now (F378).

## Items

### A1. An unchecked claim shows "Checking…" for ever (F376)

**Problem.** In a past session, a claim that was never checked still reads "Checking…". The session has settled, so
the user sees it as unfinished. In the one-minute session of 2026-11-19 at 11:44 UTC, 12 of 15 claims have a verdict
and one stays `pending`.

**Expected outcome.** A `pending` claim of a settled session reads "Not checked". Browser only.

**Acceptance evidence.** A browser check of a past session with one `pending` claim shows "Not checked" on that claim
and never "Checking…". The stored row is not changed by the display.

### A2. Four 24-hour channels play an old video (F377)

**Problem.** NDTV 24x7, ET Now, India Today TV and Aaj Tak each have a live stream now, but the video written in the
channel list is not live. The page plays a recording, so the fact-check listens to the wrong sound.

**Expected outcome.** In live mode the page plays the channel's detected live video when YouTube reports one and the
written video is not live. The fact-check then listens to what is on air. The channel list marks such a channel live.
Server and browser.

**Acceptance evidence.** On the live site, each of the four channels plays its live video while YouTube reports one,
and the channel list marks it live. The lookup makes no `search.list` call, as ADR 0009 requires. Sansad TV uses the
`live_stream` address, which cannot be looked up, so this item gives it no evidence.

### B1. Copy a claim and export a session

**Problem.** A journalist or researcher cannot lift a verdict, with its reason and sources, into their own work. They
also cannot keep a whole session.

**Expected outcome.** The user can copy one verdict. The user can save a whole session as a text file.
Only the user's own sessions are used. Browser only.

**Acceptance evidence.** The copied text holds the verdict, its reason and its sources. The rest is to be fixed in the
item's brief.

### B2. Transcript search, copy and download

**Problem.** The user cannot find a sentence in what was said, and cannot take the text away.

**Expected outcome.** The user can search the transcript, copy it and download it. This works during a session and for
the stored transcript of a recorded video. Browser only.

**Acceptance evidence.** A search finds a sentence from the transcript. Copy and download give the same text. The
details are to be fixed in the item's brief.

### B3. Summary tab

**Problem.** The user must read every claim to see the overall picture of a session.

**Expected outcome.** A summary shows how many claims there are and how many of each verdict. The contradicted claims
are listed first. It is made from the session's own claims with no model call, so it costs nothing.

**Acceptance evidence.** The counts equal the stored claims of the session. The contradicted claims come first. No
model call is made to build the summary.

### B4. Paste a YouTube link

**Problem.** The user can watch and check only the listed channels.

**Expected outcome.** The user can paste any YouTube video or live stream, and check it at the same price as a listed
channel. A video whose owner forbids embedding is refused with a plain message and a link to YouTube.

**Acceptance evidence.** An embeddable pasted video plays and can be checked at the normal price. A video that forbids
embedding shows the plain message and the link. The other details are to be fixed in the item's brief.

### B5. Refunds in the usage history

**Problem.** A refund shows in the balance but not as its own line in the usage history.

**Expected outcome.** Each refund is its own line in the usage history. This needs a change to a database function,
so it is a migration.

**Acceptance evidence.** A SQL fixture shows a refund as its own line. The migration passes `npm run test:sql`. The
fixture is proved to fail without the migration, as the vacuity rule requires.

### B6. More channels, with lists, search and "My list"

**Problem.** The page offers too few channels, and the user cannot find a channel or keep their own.

**Expected outcome.** The client's channels appear in the client's ten lists. A "Find a channel" box searches them.
Channels the user follows are shown first, under "My list", which is kept in the browser first. Each channel's YouTube
identity is verified before the channel is added, because the client's file has names only. Of the client's 108
names, 12 could not be verified and are left out.

**Built on the branch (2026-11-19).**

- 83 verified channels were added to the 13 existing ones: 96 in all, in the ten lists. The Parties & Leaders list
  notes that only verified channels are listed.
- Search covers channel names (Latin script only), list names and language words. Devanagari language words match as
  whole words.
- "My list" is kept in the browser under the key `nter.livetv.following.v1`, capped at 60 channels. Ids the server no
  longer lists are hidden and never deleted from storage. Two open tabs stay in step.
- Lookup, per channel, when the user picks it: `playlistItems.list` on the channel's uploads, then `videos.list`
  (2 units). No `search.list`. 47 channels carry a hint video id, which is checked first.
- Rule on the page: an answer from YouTube data is the truth for its channel at once, "none" included. A positive
  answer is believed for 10 minutes, then the page stops showing the LIVE badge, keeps playing and makes no request.
  The list's live fields count only while the lookup is outstanding or has failed, and the list is under 10 minutes
  old. The video never changes under a running fact-check session. No request is made without a user action (page
  open, a pick, Reload or Try again).
- Three states when nothing plays: connecting; "isn't live right now" (YouTube data says none); and "Couldn't check
  {channel} right now" for any failed check, with Open on YouTube and Try again.
- Server budget, cache times and error handling: ADR 0009, 2026-11-19 amendment.
- The Open Desk button is hidden when a channel's desk is not a real tab. Added channels map to `economics`, `global`
  or `national`.
- The phone channel sheet is modal with a focus trap; focus returns to the Channels button after it closes.

**Acceptance evidence.** Built test-first. Two independent reviews: the first found one critical issue, fixed; the
second found no critical issue and four important ones, fixed. Executed by the supervisor on the track: 9,144 tests,
lint, build, bundle check and router import. The Start button measured 586 px in a 1459 x 714 page (a preview
page). Eight of the 96 channel identities were spot-checked against YouTube, all matched.

**Not verified.** Against the real YouTube service; in a real browser on the app; on a phone; with a screen reader.
The checks that need a person are listed in F375.

### B7. "Check to the end"

**Problem.** For a recorded video, the user must work out the block length that covers the rest of the video.

**Expected outcome.** The start screen offers one block that covers what is left of the video, up to 30 minutes.
Browser only.

**Acceptance evidence.** The offered block equals the time left in the video, capped at 30 minutes. The details are to
be fixed in the item's brief.

### C1. Unsteady verdicts and rounding (F352, F365)

**Problem.** The same claim can get different verdicts on different runs.

**Expected outcome.** A second-step judge for numeric claims is measured against the reference answers. The build
goes ahead only if the measurement passes. The measurement budget is up to US$10.

**Acceptance evidence.** The measured runs meet the pass rule. The pass rule was written before the analysis and is kept
outside the repository with the raw results, so this spec does not repeat it. If the rule is not met, nothing is built.

## Scope and exclusions

Scope is items A1, A2, B1 to B7 and C1. They run in three tracks that write to separate files: the player and
channels, the panel, and the usage history. Two read-only tracks run beside them.

A3 (F378) has no build. It changes only if the owner asks for tighter limits.

Left out, with the reason:

- A check of a whole video without playing it, and leaving the page while it runs. The server would need to fetch the
  audio, which the owner decided against. Listening stays in the browser tab.
- Speaker names and filters. The chunked transcription gives no speakers, and that needs a streaming provider key.
- Reasons in Hindi. Shared results on a recorded video are stored once for all users, so a language choice needs a
  storage decision first.
- Reminders, "notify me when live" and automatic fact-check. There is no notification system and no published
  schedule to hang them on.
- A custom player bar with captions, quality or picture in picture. YouTube's own controls already give these.

What stays as decided: listening is the browser tab's sound. Billing is fixed blocks with the credits held up front.
The five verdict names stay. The transcript is part of a paid session. Nothing in this phase changes a price.

## Risks

- **A2 and B6, YouTube quota.** ADR 0009 forbids `search.list` calls. Every lookup must fit the quota the ADR sets.
- **B4, forbidden embedding.** A video whose owner forbids embedding cannot play on the page. It must be refused with
  the plain message, not left to fail.
- **B5, billing data.** The migration changes a database function on billing data. It is proved on a disposable
  database first, and it is applied to the live database only with no session running, by the documented method, and
  only after the owner has approved the branch.
- **B6, channel identities.** A wrong identity puts the wrong channel in front of users. Each identity is verified
  before the channel is listed.
- **First-load bundle limit.** New channel data and new panel code must not push the first load past the limit that
  `npm run check:bundle` enforces.

## Build record (2026-11-19)

The items are built on `feature/livetv-phase-2`, not merged to `main`. The facts, gates and per-item notes are in the
[phase 2 plan's Results](../plans/2026-11-19-live-tv-phase-2.md#results).

Not verified:

- Nothing has been seen against the real YouTube service or in a real session.
- The panel was seen only as static preview pages.
- Phones and screen readers were not checked.
