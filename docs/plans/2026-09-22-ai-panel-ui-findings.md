# AI panel — UI investigation findings

> **Status: Historical (2026-09-22).** Items 1–5 were implemented afterwards —
> see commits 227b354, 1329be8, a030847, e0716a2, 3a1e565 and 79a3530.
> Still open as of 2026-09-24 (checked against the code, not by running it):
> the chunker still classifies any line starting with a pipe as a table
> (`supabase/functions/_shared/chunking.ts:89`); the model and effort choice
> is still held only in memory (`src/ai/useResearchThread.js:26`) and resets
> on reload; `src/lib/reasoningSegments.js` and
> `supabase/functions/_shared/reasoningSegments.ts` still have no importers
> outside their tests; the pill row (`src/ai/SuggestionPills.jsx`) now has
> `role="group"` and an `aria-label` but still no list semantics. The line
> below records the state on the day it was written.

2026-09-22. Investigation only; nothing in this document has been implemented.
Five items raised by the owner, each checked against code, the live database
and OpenRouter's live catalogue. Where the owner's premise turned out to be
wrong it is corrected here explicitly, because two of the corrections change
what the fix should be.

Evidence standard used throughout: `file:line` for code, a SQL result for
anything about the corpus, and a live `GET /api/v1/models` for anything about
OpenRouter. No claim rests on inference alone.

---

## 1. The citation reader renders raw text. It should render Markdown + HTML.

**Confirmed, and the corpus is worse than the description suggests.**

`src/ai/SourceReader.jsx:88-98` puts the whole of `documents.ocr_text` inside a
`<pre style="white-space: pre-wrap">`. Every tag and every `#` is shown
literally. `src/ai/RowSource.jsx` has the same property for row snapshots.

What is actually stored, measured over all 54,219 chunks:

| pattern | chunks | share |
|---|---:|---:|
| Markdown heading (`^#{1,6} `) | 8,036 | 14.8% |
| `<td>` / `<tr>` | 5,085 | 9.4% |
| Markdown pipe-table row | 3,920 | 7.2% |
| `<table` | 1,845 | 3.4% |
| Markdown bullet (`^[-*] `) | 1,396 | 2.6% |
| `<p>` / `<div>` / `<br>` | 1,025 | 1.9% |
| `**bold**` | 16 | 0.03% |

And over the 2,338 documents the reader actually opens: 1,127 (48%) contain
Markdown headings, 470 (20%) contain pipe tables, 289 (12%) contain HTML
tables.

A real stored fragment, from the customs tariff schedule:

```html
<table border=1 style='margin: auto; word-wrap: break-word;'><tr>
<td rowspan="2">Tariff Item</td><td rowspan="2">Description of goods</td>
<td rowspan="2">Unit</td><td colspan="2">Rate of duty</td></tr>
```

This is the crux for choosing a renderer: **1,590 chunks use `rowspan` or
`colspan`.** A Markdown-only renderer cannot express those — Markdown pipe
tables have no merged cells — so a pure `marked`/`react-markdown` pass would
render the tariff schedules as a wall of escaped tags or, worse, silently
mangle them. Raw-HTML passthrough is not optional here; it is the requirement.

Sanitiser shape, measured rather than assumed:

- `<script>`, `onerror=`, `onclick=`, `javascript:` — **0 chunks**. The corpus
  is currently clean.
- `style=` — 5,623 chunks. Needed: the OCR tables carry their alignment there.
- `<img>` — 392 chunks. These would fetch remote resources from the reader.
- `<a href>` — 72 chunks.

"Currently clean" is not a security argument — the corpus grows by ingest, and
ingest reads third-party PDFs. The allow-list should be explicit
(`table/tr/td/th/thead/tbody/colspan/rowspan/style` in, `script/img/iframe/on*`
out), not inherited from today's luck.

**One thing that must be handled and is easy to miss.** `AiMarkdown.jsx` is not
a general Markdown renderer and must not be pointed at source text. It is a
hand-rolled 116-line renderer whose real job is splitting citation markers into
`<CitationBubble>` elements (`AiMarkdown.jsx:39-56`). It supports `#`–`###`,
`-`/`*`/`1.` lists, `**bold**`, `*em*`, `` `code` ``, `[text](url)` and `---`.
It does **not** support tables of any kind, code blocks, blockquotes, nested
lists or raw HTML. The assistant's *answer* and the cited *source* have
different rendering needs and should not share a renderer.

**Size.** `SourceReader` loads the entire `ocr_text` into one node. 30 documents
exceed 200k characters and one is 5.39 MB. Rendering that as `<pre>` is already
slow; parsing it as Markdown+HTML on the main thread would hang the tab. A
window around the cited span is needed as part of this change, not after it.

### The constraint that makes this more than a renderer swap

This is the part that is easy to miss and expensive to discover late.

The reader's whole purpose is the staleness check in RAG spec §H. A citation
carries `char_from`, `char_to` and `text_hash`; `resolveSpan`
(`src/ai/sourceReader.js:31-41`) re-hashes `ocr_text.slice(from, to)` and
returns `exact`, `moved` or `changed`, so a citation can never silently show
the wrong passage. `SourceReader.jsx:93-101` then slices the raw string three
ways — before, marked, after — to place the `<mark>`.

**That works only because the rendered output is the literal string.** Parse the
text into a DOM and `slice(from, to)` no longer names a contiguous rendered
region: a cited span can begin inside one `<td>` and end in a different row.
Dropping a Markdown/HTML renderer into `SourceReader.jsx:93` would render the
tariff tables correctly and break the highlight and the staleness notice at the
same time.

So the work is a renderer *and* a re-anchoring strategy. Three candidates were
considered; the decision and the measurements that forced it are below.

1. **Render rich, anchor on the cited chunk.** Keep the character span for the
   hash verdict, render only the cited chunk as rich content.
2. **Re-segment into blocks and anchor there.** Render the whole document block
   by block; map the character span onto blocks by interval overlap.
3. **Re-anchor on lines.** What TenderBase does — a line map
   (`src/lib/documentLineMap.ts`) instead of character spans.

### Decision: option 2

**Option 1 is dead on the data.** The assumption behind it — that a chunk is a
self-contained structural unit — is false for exactly the documents this item
is about. `CHUNK.tableAtomicMax` is 1,500 characters (`chunking.ts:24`); a
table block larger than that is cut line by line (`chunking.ts:103-109`) and
then re-packed greedily to `targetChars` 1,000 (`chunking.ts:140-161`). The
customs tariff tables are far larger, so they become long runs of chunks
holding a few `<tr>` each. Measured across all 54,219 chunks:

| | chunks |
|---|---:|
| open `<table>` | 1,845 |
| …and also close it | **1,145** |
| contain `</table>` with no opening `<table>` | **1,837** |
| contain `<td>` with no `<table>` at all | **3,239** |

Over five thousand chunks are table fragments with no enclosing element.
Handing one to any parser yields dropped content or garbage. The cited chunk is
not a renderable unit.

**Option 3 costs more than it returns.** The citation contract
(`char_from`/`char_to`/`text_hash`) is shared with the edge function and
already deployed against 54,219 rows. A line map would replace the byte-exact
hash check that makes `moved` and `changed` trustworthy, and that check is the
reader's reason to exist.

**Option 2 is cheap because the coordinate system already lines up.** The
chunker's `blocks()` (`chunking.ts:72-97`) is a pure function returning
`{kind, from, to}` in absolute character offsets — the same space as
`char_from`/`char_to` and `resolveSpan`. So:

1. `resolveSpan` runs **unchanged** on the raw string and yields
   `{from, to, status}` exactly as today. Verification never sees rendered
   output, so `exact` / `moved` / `changed` stays byte-exact. This is the
   property worth protecting, and option 2 protects it for free.
2. Segment `ocr_text` with `blocks()`.
3. Render per kind: `table` → sanitised HTML, `heading` → `<h*>`, `para` →
   `pre-wrap` text, which is what it already is.
4. Highlight blocks overlapping `[from, to)`. Inside a `para` block refine to
   the exact character range — it is still a string. Inside a `table` block
   mark the whole block: you cannot highlight half a merged cell, and marking
   the table is what a reader wants anyway.

Confidence in the offsets is high: `char_to - char_from = length(content)` for
**54,219 of 54,219 chunks**, so the stored spans are an exact index into
`ocr_text` with no drift.

**Windowing falls out of the same change.** Blocks give a unit to window on —
render the blocks around the cited one and expand on demand. That handles the
30 documents over 200k characters and the 5.39 MB outlier without a second
mechanism, which is why the size problem is listed above as part of this item
rather than after it.

**The one real risk is drift.** `blocks()` lives in a Deno `_shared` module and
the reader is browser code. If it is copied, the copy must not diverge — a
reader that segments differently from the chunker would place highlights in the
wrong block. Either extract it to one module both sides import, or keep a
documented duplicate with a parity test asserting identical output over the
corpus fixtures. The repo already has both patterns (`textNormalise` is
duplicated; `scripts/regenerate-desk-record-text.mjs` imports `src/lib`
directly rather than reimplement `deskRecordText`, for exactly this reason).

**TenderBase cannot be copied here.** It renders cited text with
`react-markdown ^10.1.0` + `remark-gfm ^4.0.1` and **no sanitiser and no
`rehype-raw`** at any of its ~14 call sites — so raw HTML is escaped, and
TenderBase does not render HTML tables either. Its real answer was pipeline
-side: extract tables at ingest into sidecar files referenced by `[p0:tbl-0.md]`
tokens, and render a typed `<StructuredTable>` component. That is an ingest
change, not a renderer change, and it is a larger project than this item.

For NTER the corpus is the deciding fact: 1,845 chunks carry `<table>` and
1,590 use merged cells. GFM alone does not reach them.

---

## 2. Clicking a citation should open and highlight the Work Mode tab.

**Confirmed — and this is an implementation bug against the written spec, not a
change of mind.**

`docs/specs/2026-09-20-streaming-research-agent-design.md:269-276` already says:

> Clicking a citation bubble or a source chip opens the layer with that source
> **and turns the button on**

It does the first half and not the second.

- `useResearchThread.js:191` — `openSource()` sets `viewer: {kind, source}`.
- `AiPanel.jsx:1171` — `viewer` non-null renders `<WorkSurface>`.
- `AiPanel.jsx:921-922` — the Work mode button's `on` class and `aria-pressed`
  are bound to **`workMode`**, the legacy localStorage flag
  (`AiPanel.jsx:290`, `niyantranAiWorkMode`).
- `AiPanel.jsx:936-944` — on the research path the click handler toggles
  `viewer` and **never calls `setWorkMode`**.

So on the live path `workMode` is written by nothing and read for styling only.
The button cannot light up. That is the whole of the reported symptom.

The second half is geometry. `research.css:27` makes the surface
`position:absolute; inset:0; z-index:5`, raised to `7` at `research.css:70`,
and `AiPanel.jsx:720` marks the entire background `inert`. The code says so
itself at `research.css:68-69`: *"The reader covers the whole panel, including
its z-indexed header."* So the overlay covers the toolbar that holds the button
— even a correctly-lit button would be hidden underneath it.

The toolbar it belongs to is `div.ai-v2-toolbar` (`AiPanel.jsx:869`), which
already reads as a tab strip: `[Attach] [Focus ▾] [Work mode]`. Turning this
into the intended behaviour is two changes — bind the button's selected state
to `viewer` rather than `workMode`, and inset the surface below the header and
toolbar instead of over them — not a rebuild. The state machine is already
correct; only its presentation is wrong.

---

## 3. Follow-up questions have nowhere to render.

**Partly wrong, and the correction matters: they are rendered. The defect is
narrower and more specific than "missing UI".**

The backend produces them and the database keeps them. Of 13 assistant messages
in `chat_messages`, **13 have follow-ups**, max 3 each. The most recent set:

> What other Corporate Affairs bills are currently pending in the Rajya Sabha? /
> How many Private Member Bills were introduced in the Rajya Sabha during the
> December 2025 session? / What historical Companies (Amendment) Acts are
> indexed in the National Desk repository?

They are well-formed and corpus-answerable. The pipeline is whole: prompt →
`{followUpQuestions}` SSE frame (`researchChat.js:480`) → `follow_ups jsonb`
column → re-read on load (`aiConversations.js:200,207`).

And there **is** a renderer, at `AiPanel.jsx:1001-1009`. It already uses the
same `.ai-suggest.ai-v2-suggest` classes as the starter-question pills at
`AiPanel.jsx:1029-1045` — so the component the owner remembered is in fact
already shared. Three real defects explain why it doesn't feel present:

1. **Live-turn only.** The condition is `stream?.followUps?.length` — the
   in-flight turn's transient state. The persisted `m.followUps`, loaded at
   `aiConversations.js:207`, is **never read by any component**. Reload the
   thread, switch chats and come back, or scroll up to an older answer: gone.
   There is one `stream`, so only the newest turn can ever show them.
2. **Wrong layout.** `.ai-v2-suggest` is `flex-wrap: wrap` with
   `button { flex: 1 1 100% }` (`index.css:2967-2989`) — every pill takes a
   full row. Three follow-ups are three stacked blocks, not a pill row. The
   horizontally-scrollable treatment the owner remembers **already exists in
   this codebase** at `index.css:2378-2381` (`flex-wrap: nowrap;
   overflow-x: auto`) — it is simply excluded from the v2 panel by the
   `:not(.ai-v2-suggest)` selector.
3. **Rendered inside the scroller**, after the last message
   (`div.ai-v2-history`, `AiPanel.jsx:972`), so they sit below the fold unless
   the thread is scrolled to the bottom. The starter pills, by contrast, are
   outside the scroller (`AiPanel.jsx:1029`) and always visible.

A fourth, smaller one: clicking a follow-up calls `setDraft(q)` but — unlike
the starter pills at `AiPanel.jsx:1038-1040` — does not call
`box.current?.focus()`. The text lands in a box the reader isn't looking at.

### How TenderBase does it, for comparison

`src/components/agent-hub/chat/FollowUpBubbles.tsx:11-41`. Container is
`flex items-center gap-2 overflow-x-auto border-t px-4 py-2`; pills are
`rounded-full … shrink-0 whitespace-nowrap` with a `Sparkles` icon. Mounted
*between* `</ChatSurface>` and `<ChatComposer>`
(`ChatInterfacePanel.tsx:1040-1043`), so it is pinned above the composer and
never scrolls with the thread. Click sets the composer text and focuses it —
it never sends (`ChatInterfacePanel.tsx:830-834`, and an explicit comment at
`AskAiPanel.tsx:796-801`: a bubble drafts the question so it can be edited).
The client caps rendering at five (`FollowUpBubbles.tsx:23`).

Two things there are worth *not* copying: the scrollbar is hidden on all three
engines (`[&::-webkit-scrollbar]:hidden`), so nothing signals that more pills
exist off-screen; and the container has no list semantics or `aria-label`, so
every pill is its own tab stop. Both repos share the second gap.

Also worth knowing before planning: **TenderBase did not unify the two
surfaces.** Its starter suggestions are a different component
(`ChatEmptyState.tsx:16-54`) — `<Card>` elements in a two-column grid with
hand-rolled `role="button"` keyboard handling. Unifying follow-ups and starters
is a design NTER would be introducing, not one it would be porting. NTER is
closer to it already, since both usages there carry the same class string.

### What the work is

Read `m.followUps` for the last assistant message, preferring the live set when
one exists — TenderBase's selector at `ChatInterfacePanel.tsx:817-827` is the
pattern. Lift the duplicated JSX at `AiPanel.jsx:1001-1009` and `:1027-1043`
into one component, taking the starter version's click handler (`setDraft` +
focus) and its `disabled={busy}`. Move the row out of `ai-v2-history` so it
sits above the composer like the starters already do.

On styling, one correction to the plan implied above: the horizontally
-scrolling rules at `index.css:2378-2381` and `:3360-3377` are **dead** —
scoped `.ai-suggest:not(.ai-v2-suggest)`, and every usage in the app carries
both classes, so nothing matches them. They are a written implementation of the
row layout, not a live one. Adopting the pill row means changing
`.ai-v2-suggest` from a wrapping full-width stack to that row — a deliberate
change to the panel's visual language, not a one-line unlock.

---

## 4. The model selector should match DDL Labs'.

**Confirmed as a UI gap — but the owner's premise about where each list lives
is exactly backwards, and that changes what should be ported.**

> "the model selector component … has a list of models, which is more like an
> allow list. That is server-driven. We have a similar implementation here
> also"

TenderBase's list is **hard-coded** — a TypeScript array at
`src/config/chatModels.ts:72-190`, duplicated byte-for-byte into
`supabase/functions/talk-to-tender/models.ts` and held together by a string
-equality parity test. Three such pairs exist (chat, ask-ai, agent builder).
Changing a model means editing six files and redeploying. There is no admin UI.

NTER's list is the server-driven one: table `ai_models`
(`20260921000005_allowlist.sql:9-21`), read at runtime
(`aiRegistry.js:16`), edited through `src/admin/AllowlistEditor.jsx` →
`admin-models` → `admin_models_upsert`, and guarded by a DB trigger that
refuses to enable a model absent from the OpenRouter catalogue or lacking tool
support (`allowlist.sql:39-46`). TenderBase has no equivalent of any of that.

**Port TenderBase's dropdown. Do not port its registry.**

What is genuinely better there, worth taking:

- **The per-model accordion** (`ModelSelector.tsx:488-616`). Effort is a
  property of a model, so the pills belong under the model row. NTER's single
  global pill row (`ModelPicker.jsx:116-129`) silently re-normalises when you
  switch model (`ModelPicker.jsx:58-61`) — "I set it to high" quietly becomes
  "low" if the new model lacks `high`, with no visible cue.
- **The disclosure chevron as a separate absolutely-positioned button outside
  the menu item** (`ModelSelector.tsx:519-544`). Non-obvious and load-bearing:
  inside the item, the chevron fires `onSelect`, commits a model and closes the
  popper.
- **A bare row click commits the default effort** (`ModelSelector.tsx:552-556`)
  — the accordion is optional depth, not a required step.
- **Everything in one Radix popper** rather than a second floating panel, which
  is a placement problem in a bottom-anchored composer.

### A concrete icon bug, found while comparing

`AiBrandIcon.jsx:6-42` switches on the vendor string with cases for `gemini`,
`deepseek`, `openrouter|openai|gpt`, and a default filled circle. But
`ModelPicker.jsx:105` passes `m.vendor` from the database, whose values are
`google`, `deepseek`, `openai`, `anthropic`.

`google` and `anthropic` match no case. **Five of the seven enabled models —
all four Gemini rows and Claude — currently render as an anonymous grey dot.**

The mismatch has a clear origin: the icon component was written against the
legacy hard-coded store, which uses `provider: 'gemini'`
(`aiModelsStore.js:13,21,60,76`), and was reused on the research path without
remapping the vocabulary. TenderBase keys on the same lowercased vendor string
but covers eleven vendors and degrades to a labelled initial chip rather than
an unlabelled dot (`VendorLogo.tsx:128-140`).

---

## 5. Do the low / medium / high clicks actually work?

**Yes — the value reaches OpenRouter intact. But the list of levels offered is
hand-typed and contradicts OpenRouter for three of the seven models, and the
choice does not survive a page reload.**

### The wire is correct

`research-chat/handler.ts:719` sends
`...(effortOf(t, model) ? { reasoning: { effort: effortOf(t, model)! } } : {})`,
built into the body at `_shared/openrouterStream.ts:107`. That is OpenRouter's
documented unified field. `off` means the block is omitted, which is right.
Unit tests pin it (`openrouterStream_test.ts:112-139`,
`handler_test.ts:1481-1503`). The deployed `research-chat` is version 21 from
2026-09-22T10:57:04Z; HEAD `406dd58` was committed ten seconds earlier, so the
deployed function is the code above.

Production telemetry confirms it lands. From `model_call_logs`:

| model | calls | reasoning_tokens > 0 | max |
|---|---:|---:|---:|
| `google/gemini-3.7-flash` | 60 | 9 | 70 |
| `google/gemini-3.5-flash-lite` | 52 | 5 | 189 |
| `anthropic/claude-sonnet-5` | 6 | 3 | 89 |
| `deepseek/deepseek-v4-flash` | 2 | **2** | 424 |
| `google/gemini-2.5-flash-lite` | 4 | **0** | 0 |

Non-zero reasoning tokens on four models is direct evidence the block is
honoured.

### What is wrong: the levels offered are fiction for three models

OpenRouter publishes, per model, a `reasoning` object on `GET /api/v1/models`
carrying `supported_efforts`, `default_effort` and `mandatory`. Fetched live
today (444 models), against what `ai_models.efforts` currently says:

| model | `ai_models.efforts` | OpenRouter `supported_efforts` | |
|---|---|---|---|
| `google/gemini-3.5-flash-lite` | low, medium, high | high, medium, low, **minimal** | ok |
| `google/gemini-3.7-flash` *(default)* | low, medium, high | high, medium, low | ok |
| `deepseek/deepseek-v4-flash` | low, medium, high | **xhigh, high** | **wrong** |
| `deepseek/deepseek-v4-pro` | low, medium, high | **xhigh, high** | **wrong** |
| `openai/gpt-6-astra` | low, medium, high | **max, xhigh,** high, medium, low | ok |
| `anthropic/claude-sonnet-5` | low, medium, high | **max, xhigh,** high, medium, low | ok |
| `google/gemini-2.5-flash-lite` | low, medium, high | *(none published)* | **wrong** |

Consequences:

- **DeepSeek accepts only `xhigh` and `high`.** OpenRouter's documented
  behaviour is to "map your requested effort to the nearest supported level",
  so Low and Medium are *the same request as High* — and bill like High. The
  424 reasoning tokens logged on a `low` DeepSeek call are consistent with
  exactly that. Three buttons, one outcome, at the highest price.
- **Gemini 2.5 Flash Lite publishes no efforts at all.** Its 4 logged calls all
  returned 0 reasoning tokens. The three buttons do nothing.
- **`max` and `xhigh` are unreachable** on Claude and GPT even though both
  accept them, because the client filter `Object.hasOwn(EFFORT_LABELS, e)`
  (`ModelPicker.jsx:36`, labels at `:15`) drops any value outside
  `off|low|medium|high`, and the server whitelist
  `REASONING_VALUES = ['off','low','medium','high']` (`validate.ts:7`) rejects
  them anyway. An admin can already type `xhigh` into the free-text field at
  `AllowlistEditor.jsx:138` — there is no CHECK constraint on the column — and
  it will save to the database and then be silently discarded by the picker.
- **`off` is offered on models that mandate reasoning.** `effortsFor`
  unconditionally prepends `'off'` (`ModelPicker.jsx:36`), but
  `gpt-6-astra`, `gemini-3.7-flash` and `gemini-3.5-flash-lite` all report
  `mandatory: true`.

### Nothing keeps the list honest

`refresh-model-pricing` already fetches OpenRouter's catalogue every 12 hours
(`pg_cron`, `20260921000007_pricing_reconcile_and_schedule.sql:104-115`) into
`model_pricing` — 450 rows, including `supported_parameters`. It maps id,
context length, five price columns and `supported_parameters`
(`refresh-model-pricing/handler.ts:67-79`) and **ignores `m.reasoning`
entirely**. The `ai_models_guard` trigger checks only for `'tools'`. So
`ai_models.efforts` is hand-typed, unvalidated, and drifts silently.

**This is the cheapest fix of the five.** The sync exists, is scheduled, is
tested, and runs against the exact payload that carries the answer; persisting
`reasoning.supported_efforts` / `default_effort` / `mandatory` alongside
`supported_parameters` is a few lines in a function that already parses that
object's siblings. Then `ai_models.efforts` can default to the truth instead of
to a guess.

Note that TenderBase does **not** do this either — its ladders
(`chatModels.ts:59-70`) are hand-curated too, which is the same defect with a
richer vocabulary. Its curation has already drifted: it declares
`['low','medium','high','max']` for Claude Fable 5.1, while OpenRouter
publishes `['max','xhigh','high','medium','low']` — `xhigh` is missing. So the
owner's instinct that real per-provider efforts exist is right, but the place
to get them is OpenRouter's API, not TenderBase's source.

### Secondary: the choice does not persist

`useResearchThread.js:26` initialises `choice: { modelId: '', effort: '' }`
in memory, and nothing writes it to storage. Only `focus` and the dead
`workMode` flag are persisted (`AiPanel.jsx:312,319,377,385`). Every reload
resets to the default model at `low`. This is almost certainly why all 13
production turns recorded `reasoning_effort = 'low'` and nobody has ever
exercised medium or high.

### Dead code found in passing

- `src/lib/reasoningSegments.js` and
  `supabase/functions/_shared/reasoningSegments.ts` — **no importers** outside
  their own tests. Raw provider reasoning is discarded at `handler.ts:629`, so
  nothing can use them.
- `ai_models.params` (jsonb) — selected in three places, typed at
  `handler.ts:71`, never applied to a request. `{}` for all seven rows.
- `StreamRequest.max_tokens` — declared and emitted, never set by any caller.
  Worth noting because Anthropic models *without* native effort support convert
  effort to a thinking budget derived from `max_tokens`; that path is unused
  today only because `claude-sonnet-5` supports effort natively.
- `AiPanel.jsx:586` computes `body.reasoning`, then `useResearchThread.js:151`
  overwrites it with the same value.

---

## Found in passing, outside the five items

**The chunker misreads OCR noise as tables.**
`supabase/functions/_shared/chunking.ts:84` classifies a line as a table block
on `/^\s*\|/` — any line starting with a pipe. Scanned OCR of printed tables
emits bare `|` characters for the ruled vertical lines, so noise lines are
grouped as table structure. In `ingest/national-desk/ten-smallest/06-coori_33_2020_h.md`,
8 of ~28 lines are affected. This changes how chunks are cut, so it is a
retrieval-quality issue, not a display one, and is independent of everything
above.

**Five of seven models render as an unlabelled grey dot.** Detailed under item
4; repeated here because it is a one-line fix with a visible payoff and does
not need the rest of item 4 to ship.

**The model and reasoning choice do not survive a reload.** Detailed under item
5. Likely the reason no production turn has ever used medium or high.

---

## Suggested order

Ordered by payoff over cost, not by the order the items were raised.

1. **Vendor icon mapping** (item 4). One switch statement. Fixes five of seven
   models.
2. **Work mode selected state + surface inset** (item 2). Two changes, both
   presentational; the state machine is already right, and the spec already
   says what the behaviour should be.
3. **Reasoning efforts synced from OpenRouter** (item 5). Extend the existing
   12-hourly `refresh-model-pricing` map to persist `reasoning.supported_efforts`,
   `default_effort` and `mandatory`; widen `EFFORT_LABELS` and
   `REASONING_VALUES` to the full vocabulary. Removes three models' worth of
   buttons that do nothing or cost more than they say.
4. **Follow-ups persisted, unified and repositioned** (item 3). One component,
   one selector change, one move out of the scroller.
5. **Per-model reasoning accordion** (item 4). The largest UI change of the
   five, and best done after 3 so the pills it reveals are true.
6. **Citation reader rich rendering** (item 1). The most visible of the five
   and the largest. Now unblocked — the re-anchoring decision is settled above
   (block-level anchoring, option 2). Acceptance test: open a citation into a
   customs tariff document, confirm the table renders with its merged cells
   intact, that the cited rows are marked, and that editing `ocr_text` by one
   character still flips the notice to `changed`.

---

## What could not be settled without running something

1. **Whether medium and high behave correctly in production.** Zero turns have
   used them. Settled by one turn at each level per model, read back from
   `model_call_logs.reasoning_tokens`.
2. **Whether `provider: { require_parameters: true }`** — set on every call
   carrying a `response_format` (`openrouterStream.ts:105`) — **turns reasoning
   support into a hard routing constraint.** OpenRouter's soft-preference
   exemption covers `tools`, `response_format` and `verbosity`, but not
   `reasoning`. The 4 `gemini-2.5-flash-lite` calls succeeded, suggesting not,
   but `model_call_logs` has no effort column so this is inference.
3. **Whether the DeepSeek snap-up actually bills as High.** n=2.
