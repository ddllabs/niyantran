# Live TV: layout polish and PDF download (F387)

> **Status: Living.** Spec and plan for one branch, `feature/livetv-ui-polish`. Browser only: no database,
> Edge Function or server change.

## Current state (read from the code, 2026-11-20, `main` at `818ad04a`)

- `header.ltv-header` (`src/shell/LiveTvPage.jsx`) sits between the site navigation and the channel bar: Back, the
  "Live TV" title (the page's focus target, `titleRef`), a tagline and a "Live feed" pill.
- `.ltv-main` scrolls the whole page. From 1081 px the fact-check panel is sticky inside `.ltv-panelcol`, which is
  only as tall as the video column, so the panel leaves the screen once the lower tabs are reached. The player
  leaves too.
- A "paste a YouTube link" form exists in the channel bar area (`form.ltv-paste`); it loads the video, and the
  fact-check then starts from the panel's own start screen with the price.
- The panel can export a session as text (`ClaimExport.jsx`, `claimExport.js`). There is no PDF.

## Owner's decisions (2026-11-20)

1. Remove the header strip completely, Back button included. The Live / Video status is shown with the channel
   name at the player. The focus target moves to the channel name at the player.
2. From 1081 px **the player and the panel never leave the screen; only the content below them scrolls.** The panel
   is as tall as the player column.
3. The link field moves into the top of the fact-check panel (one place to paste; the old form goes). Two steps
   stay: "Load video", then the existing start screen with the price. No new rules for errors or refused videos.
4. A **PDF download** (a real file, not the print dialog) from the panel.

## Design

### Layout, from 1081 px

- `.ltv-main` no longer scrolls. It is a column: the channel bar (natural height), the pinned zone (player column
  and panel), then the lower area (schedule, channel videos, archive, transcript, my sessions), which is the one
  scroll container and takes the remaining height.
- The lower area always keeps a useful height: at least 30% of the height under the channel bar, and never under
  200 px. The player takes the rest at 16:9, so on a short window the player is narrower than today and the panel
  takes the freed width (never under 440 px). The player's button row stays with the player in the pinned zone.
- The panel is exactly as tall as the player column, top edges aligned. Inside it only `.fc-body` scrolls, as today.
- **Revised 2026-11-20 after the first build was measured in a browser** (static previews of the real page): with
  the panel only as tall as the player column, a 1440 × 900 window gave a 508 × 286 player and a 399 px panel with
  almost no room for claims, and 1280 × 720 gave a 188 px wide player with the lower area off screen. The three
  bullets above are replaced by:
  - The panel is the right column for the **full height** under the channel bar (`clamp(440px, 32%, 520px)` wide).
  - The left column holds, top to bottom: a dark stage as wide as the column with the 16:9 player centred in it;
    the now-playing row on one line (identity left, buttons right; it may wrap when it must); the lower area, which
    scrolls. Stage height = the column height minus the now-playing row, the gaps and the lower area's minimum
    (`max(25cqh, 160px)`), never more than the column's width × 9/16.
  - When the height under the channel bar cannot give a 200 px player with that minimum (under about 460 px), the
    pinned rules do not apply and the page scrolls as it does on `main` today, with the panel sticky.
- **Revised again 2026-11-20 (F388)** after a client demo on a 13-inch laptop, where Chrome leaves about 715 to
  790 px of height and the page fell back to scrolling: the pinned rules now apply when `.ltv-main` is at least
  520 px tall inside its padding (a window of about 665 px). Under 640 px the lower area's minimum falls from a
  quarter of the height to 110 px so the player keeps what room there is, and the stage's floor is 120 px. At
  1440 × 715 the player is 391 × 220. Shorter windows keep the scrolling page.
- Anything that scrolled `.ltv-main` by script (scroll to a tab, scroll-padding) must target the new container.
- Below 1081 px: unchanged (stacked, the page scrolls as it does today).

### Link field

- At the top of the panel in every panel state where pasting is allowed today, with the same validation, error
  texts and behaviour under a running session as the current form. The panel's head stays pinned.

### PDF

- A "Download PDF" button beside the existing export in the panel and in a past session; disabled with no claim.
- Contents: NTER name in the header; video or channel title, link, date; the minutes checked; each claim with its
  time, verdict, reason and sources (links clickable); the existing automated-verdicts notice last.
- File name `NTER-factcheck-<channel or title>-<date>.pdf`, built with the same cleaning as `exportFileName`.
- Input is the same data `sessionExportText` takes; text from claims is untrusted and is cleaned the same way.
- Hindi must read correctly. Step 0 of the task is a proof: generate a sample with Devanagari conjuncts and
  matras (for example "पंजाब-हरियाणा हाईकोर्ट ने परीक्षा रद्द की", "प्रधानमंत्री", "क्षेत्र", "श्री") and render it
  to an image for the supervisor to read. If embedded-font text does not shape correctly, lines that contain
  non-Latin script are drawn by the browser on a canvas and placed as images, with link areas kept clickable.
- The PDF code and any font load only when the button is pressed (dynamic import); `npm run check:bundle` must
  still pass.

## Tasks

| Task | Write scope | Depends on |
|---|---|---|
| A. Strip removal, pinned layout, link field in the panel | `src/shell/LiveTvPage.jsx`, `src/shell/liveTv.css`, `src/shell/liveTv/pasteLink.css`, `src/shell/liveTv/aboveSplit.js`, `src/shell/factcheck/FactCheckPanel.jsx`, `src/shell/factcheck/factCheck.css`, and their tests | none |
| B. PDF builder | new `src/shell/factcheck/claimPdf.js`, `claimPdf.test.js`, a font asset if needed, `package.json` only for a font or `@pdf-lib/fontkit` | none |
| C. PDF button wiring | `ClaimExport.jsx`, `FactCheckPanel.jsx`, `PastSessions.jsx`, tests | A, B |

Interface fixed before A and B start: `claimPdf.js` exports
`async function sessionPdfBytes({ title, link, date, minutes, items, note, timeZone }) -> Uint8Array` and
`pdfFileName({ title, date, timeZone }) -> string`.

## Acceptance

- `npm test`, `npm run lint`, `npm run build`, `npm run check:bundle` pass.
- In a browser at 1440 × 900 and 1280 × 720: no strip; scrolling the lower area to its end leaves the player and
  the panel where they were; the panel's height equals the player column's; the lower area is at least 200 px.
- At 390 px wide: as before this change.
- Keyboard: on opening the page focus lands on the channel name at the player; the link field is reachable and
  its error is announced.
- A downloaded PDF of a session with Hindi claims reads correctly and its source links open.

## Not in scope

Any change to credit rules, session flow, the channel list, the server, or the database.
