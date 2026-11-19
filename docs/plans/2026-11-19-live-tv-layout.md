# Live TV page: new layout, build plan (F366)

> **Status: Living (2026-11-19).** Orders the work for the new Live TV layout. It follows the
> [layout spec](../specs/2026-11-19-live-tv-layout.md), which holds the requirements, the owner's decisions and the
> acceptance evidence. Tracked as F366 in [open-work.md](open-work.md). Nothing in this plan merges to `main` without
> the owner's go.

## Purpose

Rebuild the layout and look of the Live TV page after the client's mockup, with no change of behaviour. The
requirements and the owner's decisions are in the spec and are not repeated here.

## Roles and approvals

- The supervisor decides the order, reviews each slice against the spec, reproduces the gates, commits the verified
  work and checks the browser.
- A builder builds each slice test-first and leaves the work uncommitted. The builder does not commit, push, stash or
  switch branch.
- An independent reviewer reviews the change. The reviewer gets the code, the spec and the rules, not the builder's
  conclusions.
- The owner's go is needed to merge to `main`. A pull request is opened only with the owner's authorization, under
  `AGENTS.md`. The owner's real session in the new layout is needed after release.

## Scope and what this plan does not change

- No migration is part of this plan.
- No Edge Function deploy is part of this plan.
- No feature flag is changed by this plan.
- The fact-check logic, billing, stored data, verdict names and channel list do not change.

## Write scope

Each slice may change only these paths:

- `src/shell/LiveTvPage.jsx`
- `src/shell/liveTv.css`
- `src/shell/factcheck/*.jsx`
- `src/shell/factcheck/factCheck.css`
- `src/shell/factcheck/factCheckText.js`
- new pure helper files under `src/shell/factcheck/` or `src/shell/liveTv/`, and their tests
- the tests that pin the layout, named in the slice that changes them, with the reason listed

Nothing else is in scope. Any finding outside this list is reported, not fixed.

## Order

The slices run one after another. They share the same write scope, so they do not run in parallel.

### Slice A. Page layout

Changes:

- the title row, with the Back button, the title, the tagline and the existing status badges;
- the channel card, with the "TOP CHANNELS" tiles and the "SEGMENTS" chips with counts, computed by a pure helper;
- the main split, with the panel column 440 px wide, open by default and the same height as the video column, with only
  the list scrolling;
- the now-playing row under the video;
- the "My sessions" tab that holds PastSessions;
- removal of the separate "Fact-check · 500 credits a minute" button, with its function reachable in the panel's idle
  state, as the spec requires.

The panel's content in this slice is the existing content. The idle card and the tabs come in slice B.

Tests first:

- the segment counts (pure helper);
- the panel is open by default and the video is full width when the feature flag is off;
- PastSessions is in the "My sessions" tab, and its Delete placement is unchanged;
- the tests that pinned the old position of the button and of PastSessions are changed, each listed with its reason.

Acceptance for this slice: `npm test`, `npm run lint`, `npm run build`, `npm run check:bundle` all pass.

### Slice B. Panel

Changes:

- the panel header, with the status line, the Stop button while a session runs, the thin bar and the block line;
- the idle state, with the card and the existing start screen content, and the price read from the flag;
- the "Claims · N" and "Transcript" tabs, using the existing tab pattern with roving tabindex and arrow keys;
- the five verdict count tiles, each a toggle filter, with the "Clear" control and the empty message;
- the claim card restyle, keeping every existing control;
- the latest-claim strip over the video, with "See why" and `aria-live="polite"`;
- the "Fact-check on" pill;
- the automated-verdicts notice in the footer.

Tests first:

- the verdict filter (pure function): a claim with no verdict is shown when no filter is on and hidden when a verdict
  filter is on;
- the block line, including the "1 minute left in this block" case;
- the latest-claim strip is hidden when no claim has a verdict;
- the idle state shows the price from the flag and does not say "only while it runs";
- the verdict is shown by its label and glyph, not by colour alone.

Acceptance for this slice: the four gates pass, and every test in the list from slice A still passes.

### Slice C. Tablet and mobile

Changes:

- 601 to 1080 px: one column, the panel below the video at its natural height;
- up to 600 px: the compact title row, the video on top, the now-playing row, the panel, then the tabs;
- the sticky video on mobile, only if fullscreen and focus are not broken; otherwise it is not sticky;
- touch targets at least 40 px high;
- no horizontal page scroll at 375 px.

Tests first:

- the layout order at a narrow width, where the test can express it;
- the sticky rule is applied only when the feature allows it.

Layout checks that a unit test cannot show are made in the browser (see Verification).

Acceptance for this slice: the four gates pass.

## Review and land

1. After slice C, the independent reviewer reviews the whole change against the spec: the requirements, the decisions,
   the retained items and the write scope.
2. The builder fixes what the review finds, inside the write scope, test-first where behaviour changes.
3. The supervisor re-runs the four gates and the focused tests, and reproduces the browser check.
4. The supervisor checks the diff for secrets, for personal data and for any mention of a tool or vendor.
5. The supervisor commits in small, coherent commits, on `task/livetv-ui-redesign`.
6. With the owner's authorization, a pull request is opened. CI must pass on both required jobs before merge.
7. The owner gives the go to merge to `main`. Nothing merges before that.

## Verification

Gates, run in full after the last slice and again after the review fixes:

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run check:bundle`

Browser check, on the development server, in light and dark themes, at 1440 px, 900 px and 375 px wide:

- the panel is open by default and is the same height as the video column, and only its list scrolls;
- there is no horizontal page scroll at 375 px;
- every item of decision 7 in the spec is reachable, checked as a list;
- every control can be reached by keyboard and shows a visible focus state;
- the console and the network show no new errors.

Each check is recorded with its command or step, its result and any warning.

## Release and rollback

- A browser-only change. Merging to `main` deploys it, so the owner's go comes first.
- No migration, no Edge Function deploy and no flag change.
- Rollback is a revert of the browser change. The server side is not touched.
- The owner's real fact-check session in the new layout is owed after release. It is not part of this plan's acceptance.

## Out of scope

The items of decision 9 in the spec, the custom control bar of the player, the 95 extra channels from the mockup's list,
and any change to the fact-check logic, the server, the database, prices, flags or sharing. These are not part of this
plan.
