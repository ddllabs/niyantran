# F344 slice 2 plan: shared results and paid unlock on recorded videos

> **Status: Living (draft).** Outline for slice 2 of the
> [Live TV fact-check spec](../specs/2026-11-15-live-tv-fact-check.md) (L11, L12, L24, L25). Written 2026-11-15 on
> branch `task/f344-livetv-fact-check`. Not approved for build: two gates below must pass first, and the interfaces
> here are proposals, not fixed. Tracker: F344 in [open-work](open-work.md).

## What slice 2 delivers

On a recorded video, results belong to the video. A user who opens a video that others have checked sees which
stretches are checked. Their own stretches are open. Another user's stretch opens for 100 credits a minute (L25) and
then shows the transcript, claims and verdicts at their positions. Live-stream results stay private to the user who
ran them, as in slice 1.

## Gates before any slice 2 build

- **G-live. Slice 1 has run for real.** An admin has completed a live session on production (slice 1 plan, T7).
  Slice 2 builds on the session, the transcript path and the checks; fixes from that session come first.
- **G-position. The player reports its position.** Sharing pins results to a position in the video, and today the
  browser does not know it: the modal embeds a plain iframe and slice 1 sends `start_position_s` as null. The modal
  must drive the embed through YouTube's IFrame Player API (current time, state, mute without a reload). That is the
  same change F348 needs, so **F348 is a prerequisite of slice 2** and is built and released on its own first.
  Open point: whether the Player API works with the `youtube-nocookie.com` host the modal uses; to be proven in a
  browser before the F348 plan is written.

## Why the server must hold the transcript

Found by the security audit of slice 1. In slice 1 the browser sends the text to extract claims from, and the
video id, and only that user sees the result. If such results were shared, any user could attach an invented quote
about a named person, with a real-looking verdict, to any video for everyone to see. So in slice 2:

1. The `transcribe` action stores each piece's text on the server, keyed to the session, the piece number and the
   position in the video.
2. The `extract` action no longer accepts text. It takes a range of piece numbers and builds the turn from the
   stored pieces. The overlap clean-up that the browser does today moves to the server (one shared implementation,
   so the browser's display and the server's text cannot differ).
3. The `start` action accepts a recorded video only if the server can confirm that the video belongs to one of the
   Live TV channels (from the channel's uploads, within the YouTube quota rules of ADR 0009: no `search.list`).
4. Positions come from the player (G-position) and are checked for sanity on the server: inside the video's
   length, moving forward at playing speed. A piece captured while the player is paused or seeking is not stored
   as shared text.

A user can still play other sound into a shared tab. Server-held text removes typed forgeries, not that. The
report link and the review below cover what remains.

## Proposed data

- `factcheck_transcript_pieces`: session, user, video id, piece number, start and end position, text, created at.
  Written only by the server. No direct read for any API role.
- `factcheck_unlocks`: user, video id, from and to position, credits charged, created at.
- `factcheck_reports`: claim, reporting user, reason, created at, handled at.
- A read function for the caller: for one video, the checked stretches (open or locked for this caller), and for
  open stretches the transcript lines, claims, verdicts, sources and check dates. It never returns who ran a
  session.
- An unlock function: charges 100 credits for each started minute of the stretch through the ledger, once per user
  and stretch, and refuses a stretch the caller already holds.

Live sessions: transcript pieces are deleted when the session settles (L24).

## What users see

- Markers for checked stretches on a recorded video before any purchase; verdict labels are not shown for locked
  stretches.
- Open stretches: transcript lines and verdict cards as in slice 1, each verdict with its check date.
- A locked stretch: its length, the unlock price, and the user's balance.
- Buying a block over a stretch that is already checked: the user is told, and offered the unlock instead.
- "Report this verdict" on every shared card. A reported verdict is marked as reported for everyone until it is
  re-checked or reviewed.

## Open design points (decided when this plan is finalised)

- How overlapping runs of the same stretch by different users are merged: first run wins, or newest wins with the
  older kept (the spec's L17 says newer first, older kept).
- Whether a stretch is shared at once or only after a delay that leaves time for a report.
- Who reviews reports, and what an admin can remove.
- How long stored transcripts are kept, and removal when a broadcaster objects (ADR 0015).
- Whether the user who paid full price for a stretch gets anything when others unlock it. Not planned.

## Tasks (outline only)

- S2-0. F348: the Player API in the Live TV modal, on its own branch and release.
- S2-1. Server-held transcript: table, `transcribe` writes it, `extract` reads it, overlap clean-up shared.
- S2-2. Video check at `start`, and position checks.
- S2-3. Read function, unlock function and their fixtures (the audit's forged-quote case as a regression).
- S2-4. Panel: stretch markers, locked and open stretches, unlock, report.
- S2-5. Reviews (Opus per task, security audit of the whole slice), then release to admin accounts.

Each task gets fixed interfaces, a write scope and tests when this plan is finalised after the two gates.
