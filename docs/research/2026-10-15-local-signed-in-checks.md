# Local signed-in checks and the viewer measurement (A4, B3)

> **Status: Historical (dated 2026-10-15).** Browser evidence from a local copy on `main` at `71e64b8`.
> Plan: [next work](../plans/2026-10-15-next-work.md), A4 and B3.
>
> **Setup (local only; nothing touched NTER):**
> - **Stack.** A scratch Supabase stack (`niyantran-local-checks`) with all 54 migrations; the one
>   cron job that calls NTER (0007's pricing refresh) cut from the copy. db, auth, rest, storage.
> - **Accounts.** A local reader and a local admin, generated passwords, deleted at teardown.
> - **App.** A throwaway worktree's Vite app on :5188 with a mode-600 `.env.local` holding local keys
>   only; the client resolved to `http://127.0.0.1:54321`.
> - **Files.** A three-page test PDF (page 2 with no text layer) and a small spreadsheet, made with
>   `pdf-lib` and SheetJS; a 250-page, 64 MB generated PDF (an image and dense text on each page) for
>   the viewer. Nothing was downloaded.
> - **Teardown.** The stack stopped with `--no-backup`; the scratch folder, accounts, files, worktree and
>   launch entries removed.

## Results

| Check | What the browser showed | As specified |
|---|---|---|
| Live TV keyboard tabs (F61, B15) | The videos tab is selected on open. ArrowRight moves to the next tab and the panel follows (`aria-labelledby`); End selects the last, Home the first, ArrowLeft from the first wraps to the last. Only the selected tab is in the tab order (`tabindex` 0, others −1). Category filters are `aria-pressed` buttons. | yes |
| Phone header at 320 px (F47, B17) | Every header action fits: the account avatar sits at x 276–308 of 320, the credits chip at 238–272; the document is 320 px wide (no sideways scroll). The desk tabs are a scrolling strip, as designed. | yes |
| A PDF into chat (F171 B2, F178) | The chip shows, as visible text: "Page 2 has no readable text (scanned) and was not read."; the Remove button is described by it. In Hindi: "पृष्ठ 2 में पढ़ने योग्य पाठ नहीं है (स्कैन किया हुआ), इसलिए इसे नहीं पढ़ा गया।" (singular form). | yes |
| A spreadsheet into chat (F171 B2, B6) | Read with no warning and no "Not sent" badge; listed under "More attachments · 1". | yes |

No answer was sent, so no AI spend.

## The viewer measurement (B3, F59)

`scripts/viewer-regression` heavy-PDF profile, the real `PageViewer` and pdf.js, Fit width, 1440 ×
900 at DPR 2, pane 574 × 684, the 12-second scroll profile from page 1 to 15, three runs:

| Run | Frames | Gap p50 / p95 / p99 | Max gap | Frames over 50 ms | Long tasks | Live canvases |
|---|---|---|---|---|---|---|
| 1 | 598 | 16.7 / 17.6 / 17.7 ms | 1,015.7 ms | 2 | 0 | 4 |
| 2 | 660 | 16.7 / 17.6 / 17.7 ms | 1,000.0 ms | 1 | 0 | – |
| 3 | 718 | 16.7 / 17.6 / 17.7 ms | 49.7 ms | 0 | 0 | 4 |

Browser first cited canvas: 1,821 ms.

**The stutter does not reproduce.** Frames hold 60 fps at the 99th percentile with no long task. The
one-second gaps in runs 1 and 2 coincide with the page being hidden: the desktop app's browser pane
was not on screen (`document.hidden` true), where browsers clamp timers to one second, and run 3 has
none. Limits: a generated PDF, not a scanned government document with OCR text; one machine; the
pane hidden. F59 closes unless a reader reports it again with the document.

## Noticed

- **The page's `lang` stays `en` while the interface is in Hindi**, so a screen reader reads Hindi
  text with English rules. F192.
- **The EN/HI toggle has no accessible name** saying what it does (its text is the current language).
  F192.
