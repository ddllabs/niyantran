# Spec: Live TV — show that the session is hearing the video (F422)

> **Status: Living.** Corrected in place while F422 is built; becomes Historical (dated) when it is released.

## Current state (2026-11-28; rendered from main at `f5255529`, and an independent UI audit by reading)

During a running fact-check session the panel opens on the Claims tab. Until the first claim, that tab
shows the price line, five verdict tiles all at 0 and "No claims yet." over an empty panel. The live
transcript shows only as captions on the video (F417): about 14 seconds behind the speaker
(`DELAY_SECONDS`), in jumps of about 10 seconds (one line per audio piece), and hidden by YouTube's own
fullscreen. YouTube can show its own subtitles in the same place (the embed sets no caption option, so
the viewer's YouTube setting decides), and Indian news channels burn tickers into that area.

## Problem

The owner, 2026-11-28: the live transcription is not obvious; the panel looks blank until a claim is
found. Users cannot tell that the session is working while they are being charged.

## Owner decisions (2026-11-28)

The live transcript moves back into the panel, without a fixed row; the captions come off the video.

## Expected outcome

1. **Live empty state.** While the session is `running` (or `ending`) and has no claims, the Claims tab
   shows, in place of the verdict tiles and "No claims yet.": a pulsing dot and "Listening to the video"
   (when the video is muted: a steady amber dot and "Muted · not hearing", the muted alert with Unmute stays above;
   when nothing was heard beyond `SILENT_NOTICE_MS` and it is not muted: a steady amber dot and "Not hearing
   anything"; while `ending`: a steady dot and "Finishing…"),
   one line "Claims appear here as they are checked. Speech shows about 14 seconds after it is said."
   (using `DELAY_SECONDS`), then the newest 3-4 transcript lines (newest last, `dir="auto"`), then a
   "Full transcript" button that switches to the Transcript tab. With no transcript yet the lines are
   replaced by nothing (the heading and the line are enough). The verdict tiles appear from the first claim.
   Not a live region (the Transcript tab is the accessible text).
2. **"Now hearing" line.** Once there is at least one claim, while the session is live, a single line at
   the top of the Claims list (inside the scrolling body, not a fixed row) shows "Now hearing:" (while hearing; "Last heard:" when muted, silent or ending) and the
   newest transcript line (`dir="auto"` on an element holding only that text, not on the labelled paragraph), clipped to one or two lines, with the same "Full transcript" button. It
   scrolls with the list. Not a live region.
3. **Live dot on the Transcript tab.** While live, the Transcript tab's label carries a small dot that
   pulses briefly when a new transcript line arrives (respecting `prefers-reduced-motion`); its accessible
   name stays "Transcript". The top row must still fit a 440px panel without wrapping.
4. **No captions on the video.** `LiveCaptions` and its CSS and tests are removed; the latest-claim strip
   and the "Fact-check on" pill stay.
5. **The pill says when nothing is heard.** While live, when the video is muted or nothing has been heard
   for the silence threshold (`SILENT_NOTICE_MS`), the pill turns amber and reads "Muted · not hearing" (muted) or "Not hearing anything" (silent, not muted),
   the same words as the Claims tab; otherwise "Fact-check on".
6. **Last minute.** When a block's last minute starts, the clock turns amber and bold and screen readers
   hear "Less than a minute left in this block" once ("Less than 30 seconds left in this block" for a one-minute
   block; the same words are the progress bar's value text). A one-minute block is not "low" from its first second: it
   turns low at 30 seconds left.
7. **Silence notice wording.** "No speech heard for 30 seconds. The session ends by itself if this goes on
   for 90 seconds, and the time is still charged. Is the video muted or paused?" (use the real constants).
8. **Screen-reader milestones.** The panel announces, once each, through its existing announcer: the
   session started ("Fact-check started"), the first words heard ("Listening: words are coming in"),
   the last minute, and the session ended (with its reason). A milestone is spoken only when its condition
   changes from false to true, never for one already true when the panel mounts; milestones reached in one update
   are joined into one message. The Transcript tab's dot pulse is reset when the session is not live.

## Acceptance

- Rendered at 1590 × 780 with a running session and no claims: the Claims tab shows the heading, the
  line and the newest transcript lines; no verdict tiles; nothing on the video but the pill.
- With claims: the "Now hearing" line is the first item of the list and scrolls with it; tiles show.
- The top row stays one row at a 440px panel; at 375px it wraps as before.
- The pill is amber with "Muted · not hearing" when muted and "Not hearing anything" when silent, green otherwise.
- Idle, choosing, ended and error panels are unchanged except the wording in 7.
- Controls at least 40px at 1080px and below and on touch; keyboard order unchanged.

## Scope

Panel: `src/shell/factcheck/FactCheckPanel.jsx`, `factCheck.css`, `FactCheckTabs.jsx`, `panelStatus.js`,
`factCheckText.js` (wording), their tests. Page: `src/shell/LiveTvPage.jsx`, `src/shell/liveTv.css`,
`src/shell/factcheck/LiveCaptions.jsx` and its test (removed), `src/shell/LiveTvPage*.test.jsx`.

## Exclusions

YouTube's own fullscreen and subtitles (owner left the embed as it is); transcription timing on the server;
prices.

## Risks

- The empty state and the "Now hearing" line repeat words that also sit in the Transcript tab: wanted.
- A pulsing dot on the tab must not distract: brief pulse on a new line only, none with reduced motion.
