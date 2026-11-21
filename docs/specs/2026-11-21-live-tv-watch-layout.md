# Spec: Live TV watch layout (F402)

> **Status: Living.** Corrected in place while F402 is built; becomes Historical (dated) when it is released.

## Current state (measured 2026-11-21)

The page's real markup was rendered with the built CSS and measured in a browser, with a 125px stand-in
for the site header (the height in the client's screenshot). From 1081px wide, when the window is tall
enough (F388, F395), the page body does not scroll: the channel bar, the player row, the now-playing row
and the lower tabs share the window height, and the player is sized by the height left over.

| Window | Player column | Player | Dark bars | Channel bar |
| --- | --- | --- | --- | --- |
| 1590 × 840 (client) | 916px | 467 × 263 | 49% of the row | 143px |
| 1440 × 760 (13-inch) | 826px | 426 × 240 | 48% | 143px |
| 1920 × 960 | 1228px | 627 × 353 | 49% | 143px |
| 1366 × 650 (short, page scrolls) | 782px | 782 × 405 | 0% | 143px |

The channel bar sits in the left column only; the fact-check panel starts beside it.

## Problem

The client (feedback of 2026-11-21, relayed by the owner) wants a YouTube-style watch page:

- the player taller, as wide as its column, at 16:9, with no dark bars beside it;
- the whole page scrolling as one, the panel included, instead of only the lower tabs;
- the channel bar (top channels and segments) much shorter, and across the full width of the page;
- under it, the player on the left and the fact-check panel (claims, verdicts, transcript) on the right.

## Owner decisions (2026-11-21)

1. The channel bar is one row about 60px tall: the list buttons (My list, Hindi, English), smaller
   channel tiles, a segment chooser and the search box.
2. The panel starts as tall as the visible window under the bar; its content scrolls inside it; it
   scrolls away with the page (it is not sticky).
3. On short windows the player is limited to the window's height and the panel takes the spare width,
   so the whole player is always visible and there are no dark bars.
4. The right column below the panel stays empty when the page is scrolled down.

## Expected outcome

From 1081px wide, with the panel:

- Row 1, full width: the channel bar, 60px tall (border included), one row, no wrapping.
- Below it, two columns. Left: the player, then the now-playing row, then the lower tabs. Right: the
  panel, from the top of the player.
- The player is exactly 16:9 and fills its column's width; no dark area beside or above it.
- The left column is as wide as possible with the panel at least `clamp(440px, 40%, 640px)` wide, but
  never so wide that the player and the now-playing row would not fit in the window under the bar; any
  width the player cannot use goes to the panel.
- The panel's height is the visible height of the page body under the bar (the window, not the page);
  its content scrolls inside it as today (tabs and transcript strip pinned at its top, F395, F389).
- The page body (`.ltv-main`) is the one scroll container. The lower tabs have their natural height and
  no scroll of their own; their tab row is not sticky.
- Without the panel (fact-check not offered) the channel bar is still full width and the player is
  centred, 16:9, as large as fits the width and the window height, with no dark bars (the page
  background shows beside a narrow player, not a black stage).

Below 1081px the page keeps its stacked, scrolling layout; the bar may wrap to more rows there. Phones
(600px and under) keep the Channels sheet. Fullscreen is unchanged.

The channel bar's overlay (the "All channels" and segment list) opens under the bar, across the full
width, as a dialog over the page; the body stays inert while it is open (as today).

## Acceptance (measured in a browser on the rendered page)

At 1590 × 840, 1440 × 760, 1920 × 960 and 1366 × 650, with a 125px header stand-in:

- the bar's height is at most 64px and its left and right edges match the page body's content box;
- the player's width / height is 16/9 (± 1px) and its width equals the stage's width (no bars);
- the player's bottom and the now-playing row's bottom are inside the window before any scroll;
- the panel's top equals the player's top (± 1px) and its height equals the window height minus the
  panel's top (± 2px) before any scroll;
- scrolling the page moves the bar, the player and the panel together;
- at 1590 × 840 the player is at least 900px wide.

Also: dark theme, 1080px and 1081px wide, a 390px phone, a pasted video (two more control buttons),
and the "All channels" overlay, each checked by screenshot; keyboard order unchanged (bar, player,
controls, panel, lower tabs); no horizontal page scroll at any of these sizes.

## Scope

- `src/shell/liveTv/ChannelBar.jsx`, `src/shell/liveTv/channelBar.css` and their tests (the bar).
- `src/shell/liveTv.css`, `src/shell/factcheck/factCheck.css` (the panel's sizing rules only),
  `src/shell/LiveTvPage.jsx` (layout wrappers and comments only) and their layout tests (the page).

## Exclusions

The site header and desk navigation; the fact-check panel's content; the player's behaviour; the
phone sheet; data, server and API code.

## Risks

- This replaces the container-query layouts of F388, F395 and F396. Their tests pin CSS text and must
  be rewritten, not deleted: each still-valid property gets a new assertion.
- A full-width overlay covers the panel while it is open (accepted: it is a dialog).
- Container-query units measure the content box of `.ltv-main` (padding excluded).
