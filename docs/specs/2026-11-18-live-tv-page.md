# Live TV as a page of its own (F359, proposed)

> **Status: Living.** Written 2026-11-18 from code read at `main` `5204ed30`. Tracked as F359 in `docs/plans/open-work.md`.
> Builds on the [F344 spec](2026-11-15-live-tv-fact-check.md), the [F350 spec](2026-11-17-f350-shorter-pieces-and-session-lengths.md)
> and the F349 fixes. Nothing in this spec is built yet.

Evidence marks: **read** = seen in this checkout (file:line); **executed** = run, with the date; **unverified** = neither.
Every code reference below was opened and read on 2026-11-18. 

## Summary

- Live TV is a pop-up today. A paid fact-check session ends and is charged when the user presses Escape or clicks anywhere
  outside the pop-up. That is easy to do by accident.
- Live TV becomes a page at the hash `#/livetv`, drawn in the shell's main column the same way the account pages are drawn.
- Escape, an outside click and the profile menu no longer close Live TV. A visible "Back" control returns the user to
  where they were.
- Leaving the page still ends a running session, with the same reason and the same charge rule as closing the pop-up
  today. Only the text the user sees changes.
- On wide screens the player is on the left and the fact-check panel is on the right, for the full height of the page.
- No change to the Edge Function, the database, prices, session lengths, sharing, the Live TV server API, the channel list
  or the fact-check logic.

## Problem

- **Accidental charges.** A click outside the pop-up, or an Escape press, ends a running session with reason
  `modal_close`. The user is charged for the minutes used. The outside-click and Escape handling is in
  `src/shell/TerminalShell.jsx:290-305` (**read**): any `mousedown` outside `.tv-wrap` or `.ltv-modal` sets
  `liveTvOpen` to false, and so does any Escape key.
- **Little room for the panel.** The pop-up caps the fact-check panel at `max-height: min(600px, 75vh)`
  (`src/shell/factcheck/factCheck.css:12`) and sets its height to `min(640px, calc(90vh - 152px))`
  (`factCheck.css:40`) (**read**). In a real session on 2026-11-17 the panel measured 603 px while running and 640 px after the
  end (**executed**, F349 record). Traced 2026-11-18 (**read**): the height follows the window height and not the
  content, so the change fits the browser's sharing bar going away when capture stops; the window height was not measured.
- **Owner's direction.** On 2026-11-17 the owner agreed that Live TV becomes a page of its own (see the end of the F350 entry
  in `docs/plans/open-work.md`).

## Current state (read)

- The pop-up is `src/shell/LiveTvModal.jsx`, exported as `LiveTvModal({ open, onClose, onNavigateDesk })` (`:16`). It
  returns `null` when closed (`:301`) and renders its backdrop `ltv-modal-backdrop` with `onClick={onClose}` (`:304`).
  Its close button calls `onClose` (`:359`).
- `src/shell/TerminalShell.jsx` owns the state: `liveTvOpen` (`:71`) and `liveTvVisited` (`:72`). The component is loaded
  lazily (`:44`). It is mounted only after the first visit, inside `.tv-wrap` (`:456-461`), and stays mounted after that.
- The pop-up opens from four places:
  - the header "LIVE TV" button, a toggle (`:451-455`);
  - the window event `nter:open-livetv` (`:271-273`), sent by `src/desks/DeskLandingView.jsx:166`;
  - the hash `#livetv` (`:275-279`, checked on load and on `hashchange`);
  - `handleOpenDesk` in the modal also calls `onClose` after it navigates to a desk (`LiveTvModal.jsx:203-207`).
- The fact-check panel is mounted inside the modal through `useFactCheck` (`LiveTvModal.jsx:11`). The hook's effect runs
  `controller.load()` when `open` is true and `controller.close()` when it becomes false (`src/shell/factcheck/useFactCheck.js:33-34`).
- `controller.close()` (`src/shell/factcheck/factCheckController.js:161`) calls `session.stop('modal_close')` for an active
  session (`:169`). The wire value `modal_close` is mapped in `src/lib/factcheck/session.js:66`.
- The text shown for that reason is "Live TV was closed." (`src/shell/factcheck/factCheckText.js:106`).
- The app has no router library. Pages are hash routes handled by hand. Desks are parsed by `parseDeskHash`
  (`src/lib/deskRoute.js:56`). Account pages are parsed by `parseAccountHash` (`src/shell/credits/accountRoute.js:17`),
  which accepts `#/account/<section>`.
- The account page is shown in the main column: `CreditsPage` is rendered at `TerminalShell.jsx:560`, and the desk workspace
  gets `hidden={account ? true : undefined}` at `:574`. The address is synced on `hashchange` and `popstate`
  (`:104-109`). The document title follows the page (`:261-268`, using `setPageTitle` from `src/lib/siteHead.js`).
- Channel choice: the modal starts on channel `dd-news` (`LiveTvModal.jsx:19`). Because the component stays mounted
  after the first visit, the chosen channel survives a close within the same shell session. D8 keeps this.

## Decisions

These are the decisions for this change. Each one is final unless the owner changes it.

- **D1. Route.** Live TV is a shell page at the hash `#/livetv`, parsed the same way as the account pages. The old hash
  `#livetv` and the event `nter:open-livetv` both lead to the same page. Both still work, so existing links keep working.
- **D2. Where it is drawn.** The page is drawn in the shell's main column. The desk workspace stays mounted and hidden,
  as the account pages do (`TerminalShell.jsx:574`). The header "LIVE TV" button goes to the page and is marked active
  while the page is open. How the header marks the active state today is unverified; the build must check it. The browser's
  Back button returns to where the user was.
- **D3. No backdrop.** Escape, a click outside, and opening the profile menu no longer close Live TV. A visible "Back"
  control on the page returns to the previous desk or page.
- **D4. Leaving ends a session.** Any navigation away from `#/livetv` ends a running fact-check session, as closing the
  pop-up does today. The charge rule is unchanged. The reason sent to the server stays `modal_close`, so the Edge
  Function is not changed and nothing is deployed there. The text the user sees changes from "Live TV was closed." to
  "You left Live TV.". The ended-view text is in `factCheckText.js:106`.
- **D5. Layout.** At widths of 1100 px and above, two columns: the player with the channel tabs under it on the left, and
  the fact-check panel on the right for the full height of the column. Below 1100 px the parts stack as they do today.
  The panel's height is set by the page column and not by its content, in both the running and the ended state. This
  removes the 603 px to 640 px change.
- **D6. File and build.** The component file becomes `src/shell/LiveTvPage.jsx` and stays a lazy chunk. The style build
  list `DEFERRED_STYLE_ROOTS` (`scripts/build-terminal-styles.mjs:25-28`) and the boundary test
  (`src/shell/loadBoundaries.test.js:9`) name the file by path and are updated with it. `npm run check:bundle`
  (`package.json:12`) must still pass.
- **D7. Title.** While the page is open, the document title is "Live TV". This follows the pattern the account pages use
  (`TerminalShell.jsx:261-268`).
- **D8. Player on leave.** The component stays mounted after the first visit and draws nothing while another page is
  open, exactly as the pop-up does today (`LiveTvModal.jsx:301`, `TerminalShell.jsx:456-461`). So the video stops on
  leaving, and the chosen channel is kept while the shell is open. Nothing that is remembered changes.

## Open questions

- **OQ1. Confirmation before leaving a session.** Wanted or not? The default is none: leaving ends the session at once,
  as described in D4. This is for the owner to decide.

## Out of scope

- Any change to the Edge Function (`supabase/functions/factcheck/`), the database, prices, session lengths, sharing,
  the Live TV server API (`server/liveTvApi.mjs`), the channel list, or the fact-check logic.
- A confirmation prompt before leaving during a session (OQ1; the default is none).
- Any new route library. The hash routing stays hand-written, as the account pages do it.

## Tests that name `LiveTvModal` (to move with the rename)

A search for `LiveTvModal` under `src/` found these files (**read**). Each one that imports or mocks the file by path
moves to `LiveTvPage.jsx`, and its name changes where it names the component:

- `src/shell/LiveTvModal.hooks.test.js:1,22,26,30`
- `src/shell/TerminalShell.lang.test.jsx:18` (`vi.mock('./LiveTvModal.jsx')`)
- `src/shell/TerminalShell.test.jsx:12` (`vi.mock('./LiveTvModal.jsx')`)
- `src/shell/liveTvTabs.test.jsx:6,9`
- `src/shell/factcheck/LiveTvModal.baseline.test.jsx:7,12`
- `src/shell/factcheck/LiveTvModal.wiring.test.jsx:16,26`
- `src/lib/liveTv.test.js:124-137,198-204` (imports `../shell/LiveTvModal.jsx`)
- `src/shell/loadBoundaries.test.js:9` and `:18-20` (the `onOpenLiveTv` and `checkLiveTvHash` block checks)
- `src/shell/factcheck/useFactCheck.js:3` (a comment naming the component)
- `scripts/build-terminal-styles.mjs:27` (the deferred list)

The test at `src/shell/factcheck/FactCheckPanel.test.jsx:410` expects the text for `modal_close` to match `/closed/i`.
It moves to "left", so it changes with D4. The test at `src/shell/factcheck/factCheckController.test.js:283-288` still
checks the wire reason `modal_close` and keeps its assertion.

## Acceptance evidence

Each item must be shown before this change counts as done. Record the command and the result.

- **Unit tests, each seen failing first, then passing:**
  - `#/livetv`, `#livetv` and the event `nter:open-livetv` each open the page;
  - Escape and a click outside do not close the page and do not stop a running session;
  - navigating away from `#/livetv` stops a running session with the wire reason `modal_close`;
  - the header button is marked active while the page is open;
  - the ended view says "You left Live TV.".
- **Gates, all passing:** `npm run lint`, `npm run build`, `npm run check:bundle`, `npm test`.
- **Browser on the development server:**
  - at 1280 px, the two-column layout;
  - at 390 px, the stacked layout;
  - the panel is the same height before a session, during a session (as far as it can be shown without a capture) and
    after a session;
  - Back returns to the previous desk.
- **Owner's real session:** owed by the owner after release. It is not part of this change's acceptance.

## Risks

- Tests that name `LiveTvModal` break at the rename. The list above must be moved in the same change.
- The main entry bundle may grow if any new code is imported statically from the shell. The lazy import stays
  (`TerminalShell.jsx:44`). `check:bundle` guards the limit.
- A user with Live TV open in two tabs still ends the first session. This is unchanged.
- Leaving by a hash change that is not a user action (for example a link to a desk) ends a running session. This is the
  intended effect of D4, and the owner should know of it.

## Release

- A browser-only change. Merging to `main` deploys it.
- No migration. No Edge Function deploy. No change to prices or flags.
- The merge needs the owner's approval.
- Rollback is a revert of the browser change. The Edge Function is not touched, so no server rollback is needed.

## Plan

One branch, `task/livetv-page`, tasks in order. The task agent leaves its work uncommitted; the supervisor reproduces the
gates and commits.

1. **Route and shell.** `#/livetv` parsed beside the account route; `#livetv` and `nter:open-livetv` lead to it; the header
   button navigates and is marked active; Escape, outside click and the profile menu no longer close it; title "Live TV";
   the page is drawn in the main column with the desk workspace hidden. Write scope: `src/shell/TerminalShell.jsx`, a new
   `src/shell/liveTvRoute.js` with its test, `src/shell/TerminalShell*.test.jsx`, `src/shell/loadBoundaries.test.js`.
2. **Page component.** `LiveTvModal.jsx` becomes `LiveTvPage.jsx` (same props, `open` kept); backdrop and dialog role
   removed, a "Back" control added; tests and the style build list move with it. Write scope: `src/shell/LiveTvPage.jsx`,
   the tests listed above, `scripts/build-terminal-styles.mjs`, the comment in `src/shell/factcheck/useFactCheck.js`.
3. **Layout.** Two columns from 1100 px, stacked below; the panel takes the height of the page column. Write scope:
   `src/shell/liveTv.css`, `src/shell/factcheck/factCheck.css`.
4. **Text and guard.** "You left Live TV." for `modal_close`; a test for reopening while a session is finishing (the
   claim stays pending, then shows its verdict). Write scope: `src/shell/factcheck/factCheckText.js` and the tests under
   `src/shell/factcheck/`.

Verification after each task: the focused tests; at the end `npm run lint`, `npm run build`, `npm run check:bundle`,
`npm test`, then the browser checks under "Acceptance evidence".
