# Spec: the credits page, balance pill and visual credits UI (F184)

> **Status: Living.** Owner request 2026-10-15. The credits and billing UI is "pretty primitive". Make
> how much is used and how much is left easy to understand and interactive. Remove rupees: "The
> user is only buying credits and spending credits." Fix how the last messages roll up. Give credits
> their own page, reached from the profile menu. This is UI only: no backend, API or data changes.
> The owner chose all three options shown on 2026-10-15:
> - **A:** the visuals;
> - **B:** a credits page;
> - **C:** a balance pill with a glance popover.
>
> The placement is the profile menu. The owner then asked that nothing existing be dropped: the
> charts, legends, filters and messages stay, and the page is organised by category. Of three
> layouts on the design canvas, the owner approved **V1, sections by question** ("Good with your
> recommendation"), then asked to mix in V3's left side menu and its 90-day heat map below the
> chart. That mix is canvas board 9. The canvas, with its inventory of every element, is
> https://claude.ai/artifact/ARFqNjGYWvfMRSSXn8nBu1. Findings below were read from the code at
> `589d577`; none of these files changed by `1a9fcdb`. The live
> screens were not seen: the browser has no signed-in session, and no password is entered.

## Current state

| Surface | Code | Shows |
|---|---|---|
| Profile menu → "Credits usage" | `TerminalShell.jsx:396-480`, `usage/CreditsUsage.jsx` (full-screen modal) | Four tiles (used, left, calls, tokens); lifetime line; top 3 models as text; stacked bar chart and legend (`UsageChart`, `UsageLegend`, hand-made SVG); highlights; "By feature" text rows; credits by expiry |
| "View all AI activity" | `usage/ActivityDialog.jsx`, `ActivityTable.jsx` (second modal) | Table When / Chat / Calls / Tokens / Credits / Status. The chat title is first and the raw model id (`gemini-3.7-flash`) sits under it. An expanded row has the full question, then a nested table Role / Model / Thinking / Tokens / Credits |
| Profile menu → "Plan & billing" | `PlanBilling.jsx` (modal) | Balance, allowance, held, used this cycle, credits by expiry, `UsageMiniCard` (30-day sparkline), top-up notice, plan cards, invoices as plain rows (number, date, ₹ total, Open) |
| Chat | `ai/CreditBalance.jsx` under the composer; `MessageRow.jsx` footer | "1,820 credits · ≈ ₹x · Usage", low / blocked states; "N credits" under each answer |

**Rupee conversions beside credits.** `rupeeHint()` (`creditsStore.js:246`) is used in:
- `usageParts.jsx:11`;
- `UsageActivityCard.jsx:49, 76`;
- `UsageAnalytics.jsx:41, 60, 111`;
- `ActivityTable.jsx:90, 96`;
- `PlanBilling.jsx:41, 49, 60`;
- `CreditBalance.jsx:60, 73`.

The CSV export also has a "Rupees (₹)" column (`usageCsv.js:29-32`).

**Data the client already has** (no new endpoints):
- `my_credits()`: balance, held, available, debt, plan, allowance, cycle start and end,
  usedThisCycle, and lots by kind (monthly, rolled over, sign-up, top-up, adjustment) with expiry.
- `my_usage_summary(from, to)`: credits, calls, failed calls, tokens, web searches and their
  credits, byModel, byFeature, lifetime.
- `my_usage_timeseries(from, to, day|month)`: credits, calls and tokens per day or month, per model.
- `my_usage_activity(...)`: each turn with question, title, model, status, credits and calls, and
  per-call detail (role, model, effort, credits, free).

There is no per-chat total; a per-chat view would group activity rows on the client.

## Outcome

### 1. A credits page at `#/account/credits`, inside the terminal shell

- **Reached from:** the profile menu ("Credits", replacing "Credits usage" and "Plan & billing"),
  the header pill (§2), the chat's ring (§4), and every existing `openCreditsUsage()` /
  `openPlanBilling()` call (they navigate instead of opening a modal).
- **Back and forward work.** It replaces the main column and side panel the way a desk does. The
  desk navigation stays visible.
- **Layout.** A left side menu (about 240 px) opens with a balance card: the ring, credits left
  and the renewal date. Below it are the four sections. The open section lists its parts as
  in-page links; for Usage, these are Chart and legend, Daily use, and Highlights and features.
  The content sits to the right. On screens under 900 px the menu becomes a row of tabs above the
  content, with the balance card dropped (the header pill shows the balance).
- **Four sections, one question each, each with its own address:**
  - Overview (`#/account/credits`): how much do I have, and how fast am I using it?
  - Usage (`#/account/usage`): where did it go?
  - Activity (`#/account/activity`): what did each answer cost?
  - Plan and invoices (`#/account/billing`): what am I paying for?
- **Nothing on today's screens is dropped.** The inventory board on the canvas places all of them.
  - **Usage** is today's AI analytics, complete:
    - the Credits / Tokens / Calls switch;
    - the 7d / 30d / 90d / lifetime-by-month range;
    - "Show as table";
    - the five tiles (credits spent; model calls with failed; tokens; models used with providers;
      web searches with their credits);
    - the stacked chart with its tooltip;
    - the legend with its Model / Provider switch, click-to-hide, totals and shares;
    - the highlights (top provider, most used, best value);
    - "By feature".

    New on Usage: the 90-day heat map, full width under the chart (V3's strip, two rows of 45
    days, a hover or focus total, and "Busiest" above). Lifetime spend moves here, as the lifetime
    range.
  - **Activity** keeps every filter: model, status and kind; group by question; failures only;
    Export CSV; paging; the "before credits" note.
- **A status bar at the top of every section** carries the messages that exist today:
  - running low;
  - no credits, with Upgrade;
  - credits held for a running answer;
  - balance could not be checked, with Retry;
  - overdrawn ("taken from your next credits");
  - renews within 7 days.

  The same states keep their wording in the chat and colour the pill's ring (§2).
- **The pricing hand-off.** The `sessionStorage.niyOpenBilling` path from the public pricing page
  opens the Plan and invoices tab with the chosen plan.
- **The old modals are removed.** Their content moves into the tabs, with the existing components
  reused where they are already right: `UsageChart`, `UsageLegend`, `ActivityTable` filters and
  paging, CSV export, `CreditLots`, the plan cards and checkout.

### 2. Header balance pill and glance popover

- **The pill.** It sits beside the profile icon: a 20 px ring showing the share of this period's
  credits left, and the number left ("740 credits").
- **States:**
  - normal;
  - low (the existing `lowBalance()` rule): amber ring;
  - negative or blocked: red ring and "0 credits";
  - unchecked: a dash.
- **Clicking it opens a small popover** that grows from the pill (origin-aware, about 180 ms).
  It contains:
  - the number left, with "of N left · D days to renewal";
  - the period bar (§3.1);
  - "N held for a running answer" when non-zero;
  - the pace estimate (§3.2) when there is one;
  - the last two answers (§3.4, compact);
  - "Open credits page".
- **Closing:** it closes on Escape or a click outside. Focus moves into it on open and back to the
  pill on close.

### 3. The visuals

1. **Period bar** (Overview hero and popover). One horizontal bar for this period:
   - used;
   - held (striped);
   - left, split by lot kind (monthly, rolled over, sign-up, top-up), each lot with its own expiry
     in a tooltip and legend.

   The legend shows the numbers; colour is never the only signal. A negative balance shows as a
   red overdrawn segment past the start.
2. **Pace chart** (Overview).
   - Credits used so far in the period, cumulative per day, against a dashed even-pace line from 0
     to the allowance.
   - Where at least 3 days of use exist, a dotted projection at the average daily rate since the
     period began, labelled as an estimate: "At this pace you would run out around 9 Nov" or
     "…about 400 left at renewal".
   - No projection on the free plan's sign-up credits without an end date.
3. **Where credits went** (Overview).
   - One 100% bar for this period by model (top 5 plus "Other"), with web-search credits as their
     own segment, and a list below it. It replaces the text rows of `TopModels` on the Overview.
   - Each segment shows model name, credits and % on hover or focus.
   - The full breakdown (the chart, legend, highlights and "By feature") is on the Usage tab, with
     ₹ removed.
   - The 90-day heat map (five shades, keyboard-navigable cells) sits on Usage, under the chart.
4. **Recent answers** (Overview, top 5; Activity tab, paged, with today's filters).
   - Each row leads with the question (two lines, ellipsis), not the chat title. Under it: the chat
     title as a link, the time, a model chip with a human name ("Claude Sonnet · High"), and the
     number of web searches.
   - On the right, the credits, with a thin bar scaled to the largest row on the page.
   - Status shows as an icon and label only when the answer is not plain success.
   - Opening a row (the existing expand) shows one horizontal bar split by role (search and plan,
     answer, repair, dictation), with each segment's model, thinking level and credits listed
     below. This replaces the nested table.
   - A "Group by chat" switch on the Activity tab groups rows by `conversationId` on the client and
     shows each chat's total.
5. **Plan and invoices** (tab).
   - The current plan as a card: name, renewal date, the period bar and credits by expiry.
   - The plan cards and checkout, unchanged in behaviour.
   - Invoices as a list: number, date, plan, amount in ₹ (a real payment, so it stays), "Open".
   - An empty state for no invoices.

### 4. Chat

- **The balance line under the composer** becomes the same ring and "N credits left", with no ₹.
  - Clicking it opens the popover (§2) when the header is visible; otherwise it goes to the page.
  - The low, blocked and unchecked messages keep their wording, with no ₹, and keep the Upgrade
    button, which now opens the Plan and invoices tab.
- **"N credits" under each answer** stays text, with no motion. It updates after every answer.

### 5. Rupees

- **Removed everywhere a credit amount is converted:**
  - all `rupeeHint` call sites above;
  - the "≈ ₹ of AI" lines in Plan & billing;
  - the chat line;
  - the CSV "Rupees (₹)" column.
- **The dead code goes with them:** `rupeeHint` and the `inrPerCredit` read in the client, once
  unused. The server keeps `inr_per_credit`, because the backend is out of scope.
- **What stays in ₹:** plan prices and invoice totals. They are what the user pays.

### 6. Motion and accessibility (Emil Kowalski's design-engineering rules)

- **Motion:**
  - Bars and the ring fill once when the page or popover opens (200–300 ms, ease-out
    `cubic-bezier(0.23, 1, 0.32, 1)`, transform only).
  - Nothing animates on updates that happen after every answer.
  - Pressable controls get `scale(0.97)` on `:active`.
  - Hover effects only under `(hover: hover) and (pointer: fine)`.
  - `prefers-reduced-motion` keeps opacity changes only.
- **Accessibility:**
  - Every chart has a text equivalent: a legend list, `aria-label` summaries, and the existing
    "Show as table".
  - Tabs follow the WAI-ARIA tabs pattern.
  - Numbers use tabular figures.
  - Light and dark themes both work.
  - Phone layout at 320–640 px: tabs scroll, bars stack, rows wrap.

## Acceptance evidence

- **Unit tests:**
  - no `₹` or `rupeeHint` in any credits component or the CSV;
  - routing (`#/account/*` parses, back and forward work, old open events navigate);
  - period-bar maths, including lots, held, negative and zero allowance;
  - pace projection, including under 3 days, the free plan and no cycle;
  - "Group by chat" totals;
  - the popover's focus and Escape handling.
- **Mutation proof** for each guard.
- **Browser check** on the local dev server with a seeded test account (local Supabase, test
  credentials from the project's seed files only), at 1440, 1024, 768 and 390 px, light and dark:
  - Overview, Activity (expand a row, group by chat, export CSV), Plan and invoices;
  - the pill and popover;
  - the chat ring and its low and blocked states.

  Screenshots go in the report.
- **Gates:** `npm run lint`, `npm test`, `npm run build`, `node scripts/check-bundle.mjs`. The page
  is part of the lazy terminal chunk, so the entry bundle must not grow.

## Scope

**Files:**
- `src/shell/usage/*`;
- `src/shell/PlanBilling.jsx`;
- `src/ai/CreditBalance.jsx`;
- `src/shell/TerminalShell.jsx` (route, menu, pill);
- `src/lib/deskRoute.js` (the `account` route);
- `src/lib/creditsStore.js` (rupee removal; open events navigate);
- `src/lib/usageCsv.js`;
- new `src/shell/credits/` components and CSS, `upgrade.css`, `creditsUsage.css`;
- tests;
- `src/shell/terminalStyles.js`, regenerated by its script.

## Exclusions

- The backend, SQL, APIs and `inr_per_credit` on the server.
- Plan prices, checkout behaviour and invoice contents.
- Top-ups and budgets (they do not exist yet).
- The public pricing page.
- New chart libraries (everything stays hand-made SVG).

## Open questions

None blocking. The owner's choices are recorded above.

## Plan (sequential, one branch: `task/credits-ui`)

| # | Task | Write scope | Verify |
|---|---|---|---|
| T1 | Remove every credit-to-rupee conversion and the CSV column; delete `rupeeHint` once unused | `creditsStore.js`, `usageParts.jsx`, `UsageActivityCard.jsx`, `UsageAnalytics.jsx`, `ActivityTable.jsx`, `PlanBilling.jsx`, `CreditBalance.jsx`, `usageCsv.js`, their tests | A test that greps the credits components for `₹` / `rupeeHint` fails before and passes after |
| T2 | The `#/account/{credits,usage,activity,billing}` route and page shell: side menu with balance card, tabs under 900 px, status bar; `openCreditsUsage()` / `openPlanBilling()` and the pricing hand-off navigate there; the profile menu gets one "Credits" item | `deskRoute.js`, `TerminalShell.jsx`, new `shell/credits/CreditsPage.jsx` and CSS, `creditsStore.js`, `CreditBalance.jsx` | Route tests (parse, back and forward, events); old modal tests updated |
| T3 | Overview: period bar, pace chart, "where credits went", recent answers (top 5). Usage: today's analytics moved in whole, plus the 90-day heat map | new `shell/credits/*` components, `usageChart.js` (pure helpers) | Pure-function tests for the bar and pace maths and the calendar buckets; render tests |
| T4 | Activity tab: question-first rows, role bar on expand, "Group by chat"; existing filters, paging and CSV kept | `ActivityTable.jsx`, `ActivityDialog.jsx` (becomes the tab), `creditUsage.js` | Row render and grouping tests |
| T5 | Plan and invoices tab: plan card, plan cards and checkout moved from the modal, invoice list with empty state | `PlanBilling.jsx` (becomes the tab body), `upgrade.css` | Existing `PlanBilling` and checkout tests pass; invoice list test |
| T6 | Header pill and glance popover; chat ring | `TerminalShell.jsx`, new `shell/credits/BalancePill.jsx`, `CreditBalance.jsx`, `chat-presentation.css` | Popover focus, Escape and outside-click tests; state-colour tests |
| T7 | Browser check with a seeded local account, at four widths and both themes; independent review | none (evidence only) | Screenshots and measurements in this spec's "As built" section |

**Checkpoints:**
- After T2: the page opens from every old entry point.
- After T5: nothing from the old modals is lost.
- After T7: the owner reviews a local preview before any merge or push.

## As built (2026-10-15, branch `task/credits-ui`)

**Files.**
- New, under `src/shell/credits/`:
  - `CreditsPage.jsx`: the side menu, the sections and the status bar; each section reads only its
    own reports.
  - `OverviewSection.jsx`, `ActivitySection.jsx`: Activity was F153's dialog.
  - `CreditsVisuals.jsx`: the period bar, pace chart, heat map, where credits went and the status bar.
  - `BalancePill.jsx`: the pill, the glance popover and the ring.
  - `accountRoute.js`: `#/account/<section>`, and the one-time plan hand-off.
  - `creditsPage.css`.
- New pure helpers: `src/lib/creditsVisual.js` (`periodBar`, `paceModel`, `heatmapCells`,
  `groupByChat`, `roleSegments`, `statusMessages`, `periodLine`) and `modelLabel` in
  `creditUsage.js`, which gives readable model names such as "Gemini 3.7 Flash".
- Changed:
  - `PlanBilling.jsx` is now the Plan and invoices section: no modal, the plan card holds this
    period's bar, invoices show the plan.
  - `ActivityTable.jsx`: rows lead with the question; an opened row shows a bar by step, then every
    call; Group by chat.
  - `UsageAnalytics.jsx`: the heat map slot below the chart.
  - `CreditBalance.jsx`: the ring, and "Credits" in place of "Usage".
  - `TerminalShell.jsx`: the route, the pill, one "Credits" menu item, and every desk action leaving
    the page.
- Removed: `CreditsUsage.jsx`, `ActivityDialog.jsx`, `UsageMini.jsx`, `UsageActivityCard.jsx`, and
  their CSS (series colours now on `.cu-series`, which the page carries).

**Rupees.** No credit amount is converted anywhere: `rupeeHint`, `inrPerCredit` and the CSV
"Rupees (₹)" column are gone. `noRupees.test.js` failed on the old code and passes now. Plan prices
and invoice totals stay in ₹.

**Web-search credits** are part of each model's credits in `my_usage_summary`. So "Where your
credits went" shows models only, with "Including N credits for M web searches" below, rather than
the separate segment drawn on the canvas, which would count them twice.

**"Group by chat"** totals every matching answer, up to 2,000 (the export's cap), on the client.
There is no per-chat report.

**The desk stays mounted underneath.** While the page is open, the desk module bar (DeskNav) is
hidden and the workspace is hidden (`hidden`, not removed), so the AI panel keeps its thread, draft
and any answer still streaming. Back and forward on a credits address leave the desk as it was
(`deskRouteFor`). Opening a chat from the page returns to that desk.

**Independent review (2026-10-15).** The verdict was "request changes". Fixed:
- **Critical: the chat panel was unmounted** by the page. The desk now stays mounted, hidden.
- **Required:**
  - Back and forward reset the desk to Home.
  - The pace card stayed on "Loading…" with no open period: reports are now idle when not needed.
  - Free accounts were told their credits "renew"; they now "expire".
  - The renewal message had new wording; it now uses Plan and invoices' own, and is not repeated on
    that section.
  - An estimate appeared when overdrawn or with nothing left; there is none now.
  - The activity model filter covered only this period; it now covers every model ever used.
  - Two lots of one kind gave duplicate keys.
  - The lifetime label for no open period was missing.
  - The heat map was invalid as a grid: it now has real rows; left and right move a day, up and down
    a row; 2 × 45 on wide screens and 3 × 30 on phones; announced on key moves only.
  - Behaviour tests were missing for the popover, the ring and routing.
- **Optional, also done:**
  - The chosen plan now rides in the address (`#/account/billing?plan=pro`); the in-memory hand-off
    is gone.
  - The ring is a small module of its own, so the chat no longer pulls in the page.
  - The popover closes when focus leaves it, has `aria-haspopup`, and says "Loading" until the
    balance is read.
  - The heading takes focus when the page or a section opens.
  - Menu jumps follow reduced motion.
  - A period that starts mid-day counts every IST date.
  - Group by chat keeps deleted chats and dictation apart, and skips the unused paged request.
  - "All held" shows the held message rather than "running low".
  - The breakpoint is 900 px, matching the top bar.
- **Changed from the spec, not built:**
  - **The chat ring opens the credits page**, not the popover (§4). The page is one click and keeps
    the chat mounted.
  - **The sections are navigation links** with `aria-current="page"`, not WAI-ARIA tabs, because each
    has its own address (§6).
  - **The ring's fill-on-open animation** (§6) is not built. The bars animate.
  - **No contrast test yet for `creditsPage.css`.** Its colours are app tokens, or mixes of them.
  - **The pill and the page show credits left (balance minus held). The chat line shows the balance**
    with "N held" beside it, as before.

**Re-review (2026-10-15).** Ten of the 11 items were confirmed fixed. The rest of the desk reset is
now fixed too. The start-up effect re-runs on every entitlement refresh, and opening Plan and
invoices triggers one; it now returns before touching the desk on a credits address. Also fixed:
- Escape no longer reaches the hidden AI panel (`panelHidden`).
- Export under Group by chat follows the chats shown.

Left as nits:
- The header's Refresh still reloads the hidden desk, and its load bar shows on the credits page.
- A plan put in the address while Plan and invoices is already open is not picked up. Nothing can
  do that today: the chat is hidden while the page is open.

**Verification.**
- `npm run lint`: clean.
- `npm test`: 330 files, 5,033 tests (after the re-review fixes).
- `npm run build`: passes.
- `node scripts/check-bundle.mjs`: the entry script is 220,105 B gzip, +160 B, because the page sits
  in the lazy terminal chunk.
- Mutation checks, each caught by its test: a desk click that keeps the page; a credits address
  rewritten on load; held credits not taken from a lot; no three-day guard on the estimate; a chat
  opened without leaving the page.
- **Browser, with sample data, in a scratch preview that is not committed.** It rendered the real
  `CreditsPage`, `BalancePill` and `CreditBalance`, with `supabase.rpc` and the billing endpoints
  answered by samples. Checked:
  - at 1440×1000 in light and dark: all four sections; an opened answer; group by chat; the
    popover (focus moves in, Escape closes and returns focus to the pill);
  - the low and overdrawn states;
  - 390×844: the side menu becomes tabs, the heat map is 3 × 30, and nothing scrolls sideways.
  - After the review: the heat map's keys (up a row, left three days, each announced) and the
    free-plan wording ("18 days until they expire").
- **Not verified:** the terminal shell itself in a browser (the header pill, the profile menu, desk
  switching). The local app needs a real session, and no password is entered. Tests cover the
  wiring. To check it, open the local preview and sign in.
