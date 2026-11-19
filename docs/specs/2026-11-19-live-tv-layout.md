# Live TV page: new layout after the client's mockup (F366)

> **Status: Living (2026-11-19).** Written 2026-11-19 for the branch `task/livetv-ui-redesign`, cut from `main`
> `f6acf7ee`. Builds on the [page spec](2026-11-18-live-tv-page.md) and the
> [close-out plan](../plans/2026-11-18-live-tv-closeout.md). Tracked as F366 in
> [open-work.md](../plans/open-work.md). The implementation plan is
> [2026-11-19-live-tv-layout.md](../plans/2026-11-19-live-tv-layout.md).

The client supplied a mockup of the Live TV page. The mockup is kept outside the repository and is not copied here.
The owner agreed on 2026-11-19 to rebuild the page's layout and look after it. Behaviour does not change: the
fact-check, billing, stored data, verdict names and channel list stay as they are. This spec states the target in
plain requirements.

## Current state

- The video takes the full width of the page.
- The fact-check panel appears only after the user clicks the button "Fact-check · 500 credits a minute" under the
  video. Before that click there is no panel on the page.
- The channels and their category filter sit in two thin rows above the video.
- Past sessions ("PastSessions") sit at the bottom of the page, below the tabs.

## Problem

- The user has to find and click a separate button before the fact-check panel shows. The start control is
  separate from the place where the claims appear.
- The page has no room beside the video for the claims. Long claim lists have to be reached by scrolling the page.
- Past sessions sit below the fold, so they are easy to miss.
- The channel rows are thin and do not show the status or the language of each channel.

The client's mockup shows the target. The owner agreed on it on 2026-11-19.

## Expected outcome

### Desktop (from 1081 px wide)

Top to bottom:

1. **Title row.** The Back button stays. The title is "Live TV", with the one-line tagline "Watch and fact-check
   debates, speeches and bulletins as they happen." The existing status badges (LIVE FEED, CURATED FEED, OFFLINE,
   VIDEO PLAYBACK, ARCHIVE PLAYBACK) and their pills sit in this row.
2. **Channel card.** One bordered card with two rows.
   - "TOP CHANNELS": the existing channel strip, drawn as large tiles. Each tile has a coloured square with the
     channel's initials or tag, the channel name, and a second line with the status the data already has (LIVE or
     RECENT) and the language when it is known. The selected tile has a strong outline. Left and right arrow
     buttons scroll the strip.
   - "SEGMENTS": the existing category filter (ALL, NEWS, EDUCATION and the others), drawn as chips. Each chip shows
     the number of channels in it, counted from the loaded channels. Filtering works as it does today.
   - There is no channel search box and no "My list", "Hindi" or "English" tabs.
3. **Main split.** A video column on the left and a panel column on the right. The panel column is 440 px wide and is
   the same height as the video column. Only the panel's list area scrolls. The panel never makes the page taller than
   the video column.
   - **Video column.** The video is 16:9 in a rounded dark card. Over the video, at the top left, sit a LIVE or
     RECENT badge and the channel name. At the top right sits a "Fact-check on" pill, shown only while a session
     runs. At the bottom left sits the latest-claim strip (see Panel). Under the video is the "now playing" row: the
     channel tile, the programme title, the channel, language and kind, and the existing action buttons (Open Desk,
     Pause, Unmute, Fullscreen, Reload Feed, Return to live).
   - The separate "Fact-check · 500 credits a minute" button under the video goes away, because the panel is always
     open and carries the start control. Its function stays reachable in the panel's idle state. The gating rules of
     `FactCheckEntry` stay. When the rules would not offer the feature, the idle state explains the same thing, or the
     panel shows the same unavailable state.
   - If the fact-check flag says the feature is not available to this account, the panel column is not shown and the
     video takes the full width, as today.
4. **Below the fold, full width.** The existing tabs stay, with one new tab, "Archive", labelled "My sessions". It
   holds the existing PastSessions component, which moves from the bottom of the page. Its behaviour, focus handling
   and Delete placement do not change.

### Panel (right column)

- **Header.** The heading is "Fact-check". A status line with a dot shows the states the controller already exposes:
  Off, Listening, Checking with the elapsed time as mm:ss, or Ended. No new states are invented. A Stop button sits on
  the right while a session runs. It is the existing end-session action.
- **Block line.** Under the header, a thin bar and one line show the minutes used of the minutes bought, and the
  credits of the block. Figures the view already has are used. A figure that is not in the view is left out. The UI
  does not compute billing. When one minute or less of the block is left, the line says "1 minute left in this block".
- **Idle state (no session).** A card with the heading "Check what's being said on {channel}" and one sentence. Below
  it sits the existing start screen: available credits, the muted-video warning, the seven session lengths with their
  prices, the billing notes, the start button, and the automated-verdicts notice. The price line reads "500 credits a
  minute, held up front. Unused whole minutes are returned." The real price comes from the flag, not a literal 500.
  The text must not say "only while it runs".
- **Running and ended.** Two tabs: "Claims · N" and "Transcript". "Claims" is the existing claim list. "Transcript"
  shows the session's transcript text that the panel already shows. Where the panel shows transcript and claims
  together today, they are split into the two tabs. Where no transcript text exists in a state, the tab says so
  plainly. There is no Summary tab.
- **Claims tab, top.** Five verdict count tiles: Supported (green), Contradicted (red), Partly true (amber), No
  evidence found (grey) and Opinion (blue). Each tile shows its count and toggles a filter. The filter runs in the
  browser and is a pure function with tests. A "Clear" control appears while a filter is on. When nothing matches, the
  list says "No claims match these filters yet." Claims with no verdict yet (checking, not checked, failed, no
  sources) are always shown when no filter is on, and are hidden when a verdict filter is on.
- **Claim card.** Restyled after the mockup: a verdict badge, a time button on the right when the claim has a position
  and seeking is available today (using the existing seek wiring only), the claim text, the reason, and the source
  links as pills. Every existing control on a card stays: Check again, Report, the earlier-analysis marks and the rest.
- **Latest-claim strip.** Over the video, while a session runs and at least one claim has a verdict, the strip shows
  the newest such claim: its verdict badge, its text on one line with an ellipsis, and a "See why" button. The button
  scrolls the panel to that claim and focuses it. The strip is hidden otherwise. It has `aria-live="polite"`.
- **Footer.** The automated-verdicts notice stays visible in the panel footer.

### Tablet (601 to 1080 px)

One column. The panel sits below the video, full width, at its natural height.

### Mobile (up to 600 px)

- A compact title row.
- The video on top. The video may stay sticky while the panel content scrolls, if this can be done without breaking
  fullscreen or keyboard focus. If it cannot, it is not sticky.
- The now-playing row.
- The panel.
- The tabs.
- The channel card stays a horizontally scrolling strip. No channel sheet is built.

### All sizes

- No horizontal page scroll at 375 px wide.
- Touch targets are at least 40 px high.
- Verdicts are never told apart by colour alone. Each keeps its existing glyph and its label.
- Every control is reachable by keyboard and has a visible focus state. Tabs use the roving tabindex and arrow keys
  already used by the deck tabs of the page.
- `prefers-reduced-motion` is respected.
- The page uses the site's existing design tokens and fonts. No Google Fonts and no new dependency are added. New
  variables are defined only inside the Live TV and fact-check stylesheets.
- Every new rule works in light and dark themes.

## Owner decisions of 2026-11-19

These are binding. Each one is final unless the owner changes it.

1. UI only. The fact-check's behaviour, costs, stored data and network calls do not change.
2. The fact-check panel is open by default on the right of the video. It shows the idle state when no session runs.
3. Billing stays as built: fixed blocks of 1, 2, 5, 10, 15, 20 and 30 minutes, credits held up front, and unused whole
   minutes returned. There is no Pause button for the fact-check. Stop only.
4. Verdict names stay ours: Supported, Contradicted, Partly true, No evidence found and Opinion.
5. Listening stays the browser tab's sound. The transcript stays part of a paid session. There is no free transcript.
6. The channels stay as they are, with the existing data source. The mockup's list of 108 channels is not added.
7. Everything the page does today is kept. Nothing is removed.
8. The player keeps YouTube's own controls and our existing buttons. The mockup's custom control bar is not built.
9. These are left out and are not drawn as dead or disabled controls: the paste-a-YouTube-link box, Follow and
   My list, the Summary tab, speaker names and the speaker filter, Pause for the fact-check, the whole-video check,
   the Share card, Copy, Add to report, Export report and Share, "How we check", "Explain in", "What to check",
   auto-stop, the schedule's "Remind me" and "Auto fact-check", "Notify me when live", and the claim timeline.

Reading of decision 9: "Pause" is the fact-check session's pause. The player's own Pause button stays, as decision 7
and the now-playing row require.

Decision 7 keeps the following, each reachable in the new layout: the session-length picker with its billing notes;
the "video is muted" warning and its unmute step; the tab-audio step; "Check again" on a verdict; the "Verdicts are
automated" notice; unlock of shared results on a recorded video; "Re-analyze this block"; report a claim; past
sessions, with Delete inside an opened session; Back; Open Desk; Pause, Unmute, Fullscreen and Reload Feed; Return
to live; the Broadcast Schedule, Channel Videos, Archived Segments and Transcript tabs; the offline and error cards;
and every existing state of the panel.

## Out of scope

- The items in decision 9.
- The custom control bar of the player (decision 8).
- The 95 extra channels from the mockup's list. The owner said they come with a later final change.
- Any change to the fact-check logic, the Edge Function, the database, prices, flags, session lengths, sharing or any
  network call. Any change under `src/lib/factcheck/`, `supabase/`, `server/` or `api/`.
- Any new font, dependency or route library.
- Any change under `backup/`, `public/data/` or `.env*`.

## Acceptance evidence

Each item must be shown before the change counts as done. Record the command and the result.

- **Tests, each seen failing first and then passing.** Every pure helper and every change of behaviour in a view has a
  test written first. These include the segment counts, the verdict filter, and the rule that places unverdicted
  claims. The test that pins the old layout may change. Each changed or deleted test is listed with its reason. No
  behaviour assertion is weakened.
- **The four gates, all passing:** `npm test`, `npm run lint`, `npm run build`, `npm run check:bundle`.
- **Browser check** at 1440 px, 900 px and 375 px wide, in light and dark themes:
  - the panel is open by default and is the same height as the video column;
  - only the panel list scrolls;
  - there is no horizontal page scroll at 375 px;
  - the console and the network show no new errors.
- **Retained items.** Every item in decision 7 is reachable in the new layout. This is checked by a list, item by
  item, in the browser.
- **Keyboard.** Every control is reachable and shows a visible focus state.
- **Not verifiable without the owner.** A real fact-check session in the new layout needs the owner present. It is
  not part of this change's acceptance. It is owed after release.

## Risks

- **Panel height tied to the video column.** The panel must not make the page taller than the video. If the video
  height changes, for example when it loads, the panel height must follow. A test or a browser check must show this.
- **Tests that pin the old layout.** Tests that check the position of the separate Fact-check button or of
  PastSessions will break. They are changed, and the change is listed with its reason.
- **Dark theme.** Colours chosen for the light theme can fail in the dark theme. Every new rule must be checked in
  both.
- **Sticky video on mobile against fullscreen.** A sticky video can break fullscreen or the focus order. If that
  cannot be avoided, the video is not sticky.
