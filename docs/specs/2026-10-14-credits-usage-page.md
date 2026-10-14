# Credits usage page (F153)

> **Status: Living.** Owner request 2026-10-14: "a detailed usage page or
> credits usage page, just like … tenderbase … charts with legends, model
> calls, and everything, along with usage, leftover balance, and credit usage,
> on a separate page … a small version in the pop-up". The owner sent six
> TenderBase screenshots the same day: the AI activity card, the AI activity
> dialog with an expanded row, and AI analytics on credits, tokens and calls.
> The page follows them. It extends the
> [AI credits spec](2026-10-14-ai-credits.md) (F111): §7 privacy and §12 gain
> the three functions below. The owner approved building it from the
> screenshots ("Analyze everything and accordingly do it", 2026-10-14). It is
> built after the F147–F151 branches land, because it shares Plan & billing
> and the credits store.

## Objective

A signed-in user can see where their credits went:
- what they have left;
- what they used this cycle and over time;
- which models and how many AI calls;
- each answer's cost, down to the calls behind it.

The view is credits only, never dollars. A small version sits in Plan &
billing.

## Reference

TenderBase's "Storage & Credits" area was reviewed read-only on
2026-10-14:
- the usage card;
- the analytics section, with credits/tokens/calls tabs and 7, 30, 90-day
  and lifetime ranges;
- a stacked bar chart per model, with a clickable legend and % shares;
- the activity dialog, with a per-question ledger, filters, failures only and
  a CSV export;
- budgets and a storage bar.

**What we take:** the chart, the legend, the measure tabs, the ranges, the
per-answer ledger with expandable calls, failures only and the CSV export.

**What we leave out:**
- the storage bar (there is no storage product yet);
- budgets (none yet);
- user, tool and testing filters, and role gating (Niyantran is per user);
- provider grouping;
- the web-search split;
- anything in USD (TenderBase sends `cost_usd` to owners; we never do);
- its mouse-only table rows (our rows are buttons).

## The page (modelled on the owner's TenderBase screenshots, 2026-10-14)

The page is a full-screen "Credits usage" panel (Decision 6) with three
sections that mirror TenderBase's screens. Each credit figure carries a ₹
hint below it (credits × `inr_per_credit`), never dollars.

### A. AI activity (this cycle)

- **Header.** A sparkle icon and "AI activity". Below it, "Billing period ·
  {cycle start} – {cycle end} · renews {date}"; on Free, "Sign-up credits ·
  valid until {date}".
- **Four figures:**
  - **Credits used,** with ₹.
  - **Credits left:** "of {allowance} this period". Debt shows as negative,
    with "taken from your next credits".
  - **Model calls.**
  - **Tokens:** abbreviated (2.27M), with a dotted underline whose tooltip
    gives the exact Indian-grouped number.
- **Lifetime line:** "Lifetime spend: N credits (₹…)".
- **Top models · this billing period:** up to three rows of the model id,
  then "N calls · N credits" on the right.
- **"View all AI activity ↗"** opens section C.

### B. AI analytics

- **Header.** A chart icon, "AI analytics", and "Usage by model · {range} ·
  {from} – {to}".
- **Controls.** A Credits / Tokens / Calls segmented control. A range menu:
  last 7 days, last 30 days (the default), last 90 days, lifetime (monthly
  bars).
- **Five figures:**
  - **Credits spent,** with ₹.
  - **Model calls,** with "N failed".
  - **Tokens,** abbreviated with the exact value on hover.
  - **Models used,** with "N providers".
  - **Web searches,** with their credits. Web-search credits come from each
    row's `web_search_cost_usd` share of the row's cost, converted to
    credits inside the database.
- **Caption:** "Rolling window in IST — independent of your billing period,
  so these totals can differ from AI activity above."
- **Stacked bar chart** by model for the selected measure:
  - dashed gridlines with four ticks;
  - day labels;
  - a hover or tap tooltip listing the day's models and their values, then a
    total.
- **By model legend** beside the chart (below it on phones):
  - a model / provider switch;
  - each row has a colour dot, a provider mark, the name, the value and a %
    share;
  - each row is a button that shows or hides its series.
- **Highlights:**
  - **Top provider:** % of credits.
  - **Most used:** calls.
  - **Best value:** lowest credits per call, among models with at least 5
    calls.
- **By feature:** in place of TenderBase's "By tool / agent". Lists AI
  research (calls · credits · searches) and dictation (calls · free).
- **Left out:** TenderBase's "Tool health", which has no equivalent here.

### C. All AI activity (opens over the page, like TenderBase's dialog)

- **Filters:** model, status (all / succeeded / failed), and kind (answers /
  dictation). There are no user or tool filters, because each person sees only
  their own activity.
- **Switches:** "Group by question" (on by default) and "Failures only".
  "Export CSV" downloads credits and ₹.
- **Table, grouped by question:** when · chat (the conversation title and the
  model under it) · calls · tokens · credits (with ₹) · status pill.
  - Each row with more than one call expands, through a real `<button>`. The
    expanded part shows the question, then each call: role (answer, search
    and plan, repair, dictation), model, thinking level (from the P3
    `reasoning_effort` column), tokens, and credits or "free". A TOTAL row
    closes it.
- **Ungrouped:** one row per call, with the same columns.
- **Paging:** "Showing 1–50 of N", with Previous and Next.
- **The chat title** opens the conversation (F149's `niy-open-conversation`).

### D. Credits by expiry

The lots list (kind, remaining, expiry), as in Plan & billing today.

### Small version, in Plan & billing

- Section A's four figures in a compact row.
- The top three models.
- A 30-day sparkline.
- "See credits usage →".

The 20-row "Recent answers" list moves to section C.

### Navigation

- A "Credits usage" item in the profile menu.
- The event `niy-open-usage`, fired from Plan & billing and the chat's credit
  chip.

## Charts (no library)

The charts are hand-built SVG, in the style of `src/shell/AnalyticsViz.jsx`:
`viewBox`, theme tokens, `.theme-dark` overrides, and its 8-colour palette
assigned by a stable hash of the model id. Beyond seven models, the rest are
grouped as "Other".

- **Size.** Measured with `ResizeObserver`, so it works at 375 px (30 bars
  are about 10 px each).
- **Accessibility.**
  - The SVG has `role="img"` with a summary label.
  - Each bar segment has a `<title>`, and each bucket group is focusable.
  - A "Show as table" disclosure renders the same data as a real `<table>`.
  - Legend entries are `<button aria-pressed>`.
  - The chart respects `prefers-reduced-motion`.
- **States.** Loading, empty and error each show a different message.

## Data (adds to spec §12; executable by `authenticated` only)

Every function below:
- is `SECURITY DEFINER`, `SET search_path = ''`, `SET TimeZone = 'UTC'`,
  `STABLE`, and executable by `authenticated` only;
- is scoped to `auth.uid()`;
- buckets days in IST;
- clamps its inputs;
- returns credits only: no USD and no exchange rate.

The browser computes ₹ from `inr_per_credit`, as it already does.

**A model's share of an answer.** It is
`ledger.credits × row.cost_usd ÷ Σ row.cost_usd`, computed in SQL. A row's
web-search credits are its `web_search_cost_usd` share, computed the same way.

**`my_usage_summary(p_from timestamptz, p_to timestamptz)`** returns:

```text
{credits, calls, failed_calls, tokens, answers, answers_free,
 web_searches, web_search_credits, models_used, providers,
 by_model:[{model, provider, credits, calls, tokens}],
 by_feature:[{feature, calls, credits, searches}],
 lifetime_credits}
```

Section A calls it with the cycle bounds from `my_credits()`. Section B calls
it with the range.

**`my_usage_timeseries(p_from timestamptz, p_to timestamptz, p_bucket text)`**,
where the bucket is 'day' or 'month', returns:

```text
{bucket, series:[{bucket_start, model, credits, calls, tokens}]}
```

- The server fills empty buckets.
- Credits are bucketed by charge time (Decision 3).

**`my_usage_activity(p_offset int, p_limit int, p_grouped boolean, p_model text, p_status text, p_kind text)`**
returns:

```text
{total,
 rows:[{turn_key, created_at, conversation_id, title, question, status,
        model, calls, tokens, credits,
        detail:[{role, model, effort, tokens, credits, free, status}]}]}
```

- When `p_grouped` is false, each row is one call and `detail` is empty.
- Grouped rows come from `research_turns`, so free and failed answers appear.
  Messages are found with the `private.credit_turn_messages` fallback.
- Dictation rows come from `model_call_logs` where `caller` is
  `transcribe-audio`.

**Indexes:** `research_turns (user_id, created_at DESC)`, plus whatever the
query plans show is needed on `model_call_logs (user_id, created_at)`, which
already exists.

**`my_credits().recent`:** limited before it aggregates.

**SQL fixtures:**
- no other user's rows;
- no USD key;
- model shares add up to each answer's charge;
- web-search credits never exceed their row's credits;
- buckets in IST;
- `anon` cannot execute.

The `pg_proc` privilege enumeration now covers these functions too.

## Decisions (supervisor's recommendations, adopted with the owner's go-ahead)

1. **Spec amendment.** Add the three functions to §12. Recommended.
2. **Per-model credits.** These show each model's relative cost, which can
   already be derived from credits. Acceptable.
3. **Bucket time.** Bucket by charge time, so the chart totals equal "Used
   this cycle". An answer settled by a later sweep can land on the next day.
4. **Before launch.** Calls before 2026-10-14 05:46 UTC show as 0 credits,
   with the note "Credits started on 14 Oct 2026".
5. **Question text.** It is shown only to its owner, as the chat already
   does. A deleted chat shows "Deleted conversation".
6. **Placement.** A full-screen panel from the profile menu, like Plan &
   billing (no hash route; the terminal's routes are desk routes).
7. **Answer links.** Use F149's `niy-open-conversation`. The page is built
   after F149 lands.
8. **CSV export.** Now, in credits with ₹.
9. **₹ on every credit figure.** As in TenderBase's screens: credits ×
   `inr_per_credit`, never dollars.

## Acceptance

- The SQL fixtures above, run as the non-superuser migrator, pass and are
  non-vacuous.
- Vitest covers:
  - the chart: buckets, legend toggles, the table fallback, and no USD
    anywhere;
  - the activity paging and expand;
  - the CSV contents;
  - the small version.
- Lint, the build and both test suites pass.
- A local browser run (desktop, 375 px, light and dark) on seeded usage.
  Screenshots go to the owner.

## Scope

**Out of scope:**
- storage;
- budgets;
- per-team views;
- the web-search split;
- Razorpay (O6).
