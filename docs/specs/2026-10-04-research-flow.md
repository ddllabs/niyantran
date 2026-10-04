# F65 research flow presentation

> **Status: Normative.** Owner approved the supplied image references and the
> proposed adaptation on 2026-10-04. Supersedes F63/F64 source/activity styling.

The current activity disclosure puts diagnostic definition lists in the main
reading flow. Source rows have an extra Cited passages disclosure. The owner
wants the open monoline trace from image 2, with restrained badges from image 1,
inside the existing resizable AI Research panel.

Expected outcome: highlighted compact model/effort/activity summary, connected
stages with clear icons, actual queries and inline result/duration badges,
measured reasoning-token count when supplied, and a secondary Technical details
disclosure for exact IDs, top-K and timing tables. No invented thinking prose,
deductions, token totals, completion states or phase durations. Keep failed,
cancelled and incomplete actions distinct. Animate only currently active work;
completed stages and answer text stay still. Keyboard toggles are immediate.
Use restrained CSS opacity/transform motion and reduced-motion/static feedback.

Restore inline citation numbers with title/pages in one source action. Replace
the enclosing border with a subtle theme-aware source surface and separators.
No extra Cited passages row or nested interactive citation controls. Preserve
the source row's existing first-citation navigation contract and accessible name.
Keep Work mode, composer, attachments, Copy/time, panel tabs and Terminal shell.

Scope: `src/ai/ActivityTicker.jsx`, new `ResearchFlow.jsx`, panel/message usage
wiring, `SourceList.jsx`, scoped chat CSS and focused tests; docs/specs/plans.
No server, retrieval, data, authentication, billing, deployment or dependencies.
The existing connection recovery issue is tracked separately as F66.

Acceptance: red/green guards for inline source numbers, plain timeline/default
versus technical disclosure, token missing/zero/positive, active/completed/error
states; full Vitest, lint/build; real-component offline browser at narrow,
tablet and desktop, dark/light, keyboard expansion, source action, live stage
motion/completed static state. Source-review reduced motion if OS emulation is
unavailable. No production queries/model calls, push or deployment.

Owner amendment, 2026-10-04: the activity summary has no tinted background or
card shape. Model emphasis, muted effort/metrics, leading icon and trailing
caret provide hierarchy on the chat surface. Reasoning telemetry correction
is separate from this reversible visual amendment.

Second owner amendment, 2026-10-04: remove Technical details entirely. Exact
served/requested-fallback model ID is visible beneath its human-readable label
when different; requested thinking effort sits beside the label. Preserve actual
query, result count and per-search duration in the timeline. Remove diagnostic
definition lists and their unused aggregation helper. The reasoning count is
usage metadata, not exposed private thinking text. This supersedes the original
secondary-disclosure requirement above; telemetry accuracy is open-work F67.

Third owner amendment, 2026-10-04: compact model version sits inline beside
the model label and thinking effort. Exact ID remains its tooltip, instead of
a separate line. Follow-up questions are one horizontally scrollable pill row,
with every question directly actionable; remove the More questions disclosure.
Picking a pill still fills/focuses the draft, never sends automatically.

Fourth owner amendment, 2026-10-04: remove visible You/आप from user bubbles;
preserve text, color, alignment and timestamp. Copy is icon-only with localized
accessible name/tooltip, a checkmark for two seconds after success, and a polite
screen-reader announcement. Failures remain visible. The AI sparkle sits in a
28px rounded, theme-aware muted lavender badge; answer text remains unboxed.

Fifth owner amendment, 2026-10-04: tighten only the research flow's vertical
spacing: top padding 16→8px, token-row bottom margin 14→8px, stage bottom
padding 18→10px and query top margin 5→3px. Preserve horizontal dimensions,
typography, content and behavior. AI badge uses existing accent/soft-accent
theme tokens, superseding the lavender choice.

Sixth owner amendment, 2026-10-04: user messages also have icon-only Copy.
Their timestamp/Copy row is a sibling below the blue question bubble, aligned
right. Copying a user message copies only its literal text; it never appends
attached sources. Preserve answer-copy references, localized names, success
feedback, clipboard-failure reporting, timestamp data and question alignment.

Seventh owner amendment, 2026-10-04: a further vertical-only tightening uses
flow padding 4px 12px 2px, usage bottom margin 4px, stage bottom padding 6px
and query top margin 2px. Text size, line height and horizontal geometry stay
unchanged. This supersedes the fifth amendment's vertical gap values.

Eighth owner amendment, 2026-10-04: composer model selector uses a compact
soft-accent pill, retaining model name/effort and showing one-to-three cost
diamonds from the existing tier hint. Tooltip explains relative cost tier.
Remove the trigger chevron; preserve menu keyboard/disclosure behavior and
selected model/effort accessible states. Restore selected-row theme styling.
No pricing/provider changes, attachment/source redesign or deployment.

Ninth owner amendment, 2026-10-04: replace the composer's filled model pill
with a neutral interior and thin gradient shimmer border. Preserve cost diamonds,
effort, selected menu states and chevron removal. Feedback is a brief,
interruptible opacity transition on fine-pointer hover only; keyboard and
reduced-motion interactions are static. Attachments become content-width chips
above the composer, with bounded/truncated titles and full-title tooltips,
coverage and remove controls together. Never invent a shortened official title.
Source documents remain full-width, more prominent rows beneath the answer,
with pages and inline citation numbers; no separate cited-passages disclosure.
Preserve all data, opening/removal behavior, locked states and surrounding UI.

Tenth owner amendment, 2026-10-04: attachments and composer share one dynamic
full-width bordered surface, with zero gap between them. Attachment titles wrap
to show their full text; preserve coverage/remove controls and the additional
attachments disclosure. Empty composers retain their existing appearance.
Attachment notices remain inside the shared surface. Supersedes the ninth
amendment's content-width/truncated chip choice. No data or behavior changes.

Eleventh owner amendment, 2026-10-04 (F70/F71): open live stages automatically
while the response is generated and collapse on completion; manual chevron
toggles persist within a phase. Remove reasoning-token counts from normal chat
presentation. Expanded flow shows known Searching, Processing and Writing
durations. Processing includes waiting and is not measured model reasoning.
Omit unavailable/invalid fields; preserve measured zero. Wide tables wrap text
and retain horizontal scrolling for comparisons beyond the available width.
[Reading-space spec](2026-10-04-chat-reading-space.md).
