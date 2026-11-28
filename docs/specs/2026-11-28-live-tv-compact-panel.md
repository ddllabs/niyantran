# Spec: Live TV fact-check panel while a session runs (F417)

> **Status: Living.** Corrected in place while F417 is built; becomes Historical (dated) when it is released.

## Current state (from the owner's screenshot of 2026-11-26, approximate)

While a fact-check session runs, five fixed rows sit above the claims in the panel (about 560px tall):
the paste-a-link form (~45px), the header with "Fact-check", "Checking · 0:50 elapsed", "0:10 left"
and Stop (~45px), the block line with its bar and "1 minute left in this block" (~30px), the two-line
transcript strip with its "Transcript / Full transcript" column (~55px), and the tabs (~40px). About
215px of chrome leaves about 210px for the claims, about one claim card. Chrome's "Sharing this tab"
bar (required for every session) takes about 60px more from the window.

## Owner decisions (2026-11-28): options 1, 2, 3 and 4

1. **One row for the tabs, the clock and Stop.** While a session runs (`running` or `ending`), the
   panel's top row is the tabs (Claims · N, Transcript, Summary), then the time left and Stop. The
   block's progress is a 2-3px line under that row. The separate header ("Fact-check" title and status
   line), the "elapsed" time and the "N minutes left in this block" line are not shown. The "Fact-check"
   heading stays for screen readers (visually hidden) and keeps taking focus as today. The status words
   stay visible only when they are not the normal checking state (for example muted, reconnecting, an
   error); the normal state is the coloured dot alone, with its words visually hidden.
2. **The live transcript as captions on the video.** The two newest transcript lines show at the
   bottom of the player, subtitle style (white on a translucent dark band, centred, at most two lines,
   newest words visible), just above the latest-claim strip, clear of YouTube's control bar, and also
   in fullscreen. "Listening…" shows there while a running session has no words yet. The captions do not
   take clicks (the player stays usable under them) and are hidden from screen readers; the Transcript
   tab is the accessible text, as the strip's was. The transcript strip in the panel is removed.
3. **The paste form folds away during a session.** While a session runs, the paste-a-link form is not
   shown at the top of the panel; a small "Paste a video link" button (an icon button, its accessible
   name in full) in the top row opens it under that row, and it closes again with the same button or
   after a link is loaded. Outside a session the form is where it is today.
4. **Shorter claim cards.** Copy, "Check again" and the time checked sit on one row (wrapping only
   when there is no room). Sources fold into a "N sources" disclosure button (aria-expanded) that opens
   the existing pills. This applies to the card everywhere it is used (live, past sessions, shared parts).

## Expected outcome and acceptance (measured on the rendered page with a running session)

- With the paste form closed, the panel's chrome above the claims is one row plus the progress line:
  at most 52px, at panel widths of 440px (1081px window) and above, with no wrapping and no sideways
  scroll in that row (10+ claims, a two-digit count included).
- At 1590 × 840 the claims area is at least 320px tall during a session.
- Captions: on the player, at most two lines, above the latest-claim strip when it shows, never over
  YouTube's control bar (bottom 52-64px), centred; `pointer-events: none`; present in fullscreen.
- A claim card with sources and Check again is visibly shorter than today (measured before and after).
- Idle panel (no session) and ended sessions look as today except the shorter cards.
- Keyboard: the tabs keep their roving behaviour; Stop, the link button and the card controls are
  reachable in order; Escape or the button closes the open paste form and returns focus to it.
- Controls at least 40px high on touch screens and at 1080px and below (the page's rule).

## Scope

Panel: `src/shell/factcheck/FactCheckPanel.jsx`, `src/shell/factcheck/factCheck.css`,
`src/shell/factcheck/FactCheckTabs.jsx` and their tests. Page and video: `src/shell/LiveTvPage.jsx`,
`src/shell/liveTv.css`, `src/shell/factcheck/LiveTranscriptStrip.jsx` (becomes the captions) and their
tests.

## Exclusions

Server, data and prices; the idle panel's content; the channel bar and page grid of F402; phones beyond
keeping them usable.

## Risks

- Captions cover part of the picture (often the channel's own ticker). Accepted by the owner; a toggle
  is not in this change.
- The claim card change also changes past sessions and shared parts (wanted: one card).
- The tabs, clock, Stop and link button must fit 440px; the tab labels may need to be tighter.
