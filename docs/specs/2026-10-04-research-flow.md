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
