# ADR 0007: NTER.news Live Rail, NyAI Thinking Lifecycle, and Desk Landing Contracts

> **Status: Normative.**
> **Date:** 2026-09-27
> **Deciders:** Supervising Agent, Architecture Review
> **Consulted:** AGENTS.md, docs/flow.md, docs/design.md, docs/decisions.md
> **Amended:** 2026-09-28 (the NyAiThinking render rule and the news store; see the end)

---

## Context

Prior to this decision:
1. The public landing page lacked direct live exposure to `nter.news` developments, and the internal Home desk featured delayed/frozen Market Metrics at the top of its sidebar rail.
2. In-flight AI turns in research mode provided no distinctive branded thinking state before initial streaming markdown tokens arrived, leaving a visual void or plain text.
3. Desk routes without an active module selection rendered a static textual guide (`DeskGuide.jsx`) with instructional walkthrough text and module lists, rather than live intelligence counters and real data visualizations.

---

## Decisions

### 1. NTER.news Live Latest Rail (CR-12)
- The primary position on the public landing page and the top of the Home desk rail now present the Live Latest Rail (`NterLatestRail.jsx` and `.nh-rail-latest-box`).
- Market Metrics quotes are explicitly labelled as delayed snapshots and positioned secondary to live public reporting.
- The Latest Rail consumes `GET /api/home/latest` backed by `server/nterNews.mjs` and seeded fallback `public/data/nter-news.json`.
- In-browser polling updates the rail at 60-second intervals when the document is visible.
- Anti-fabrication invariant: Zero synthetic headlines, mock dates, or invented counters are permitted.

### 2. NyAI Thinking Animation Lifecycle (CR-13)
- An accessible, branded component (`NyAiThinking.jsx`) represents the in-flight thinking state of the assistant.
- Displays a faceted neural diamond mark in the brand gradient (`#012ea1` to `#38bdf8` to `#f43f5e`), status text ("NyAI is thinking"), and an animated neural wave indicator.
- Semantic contract: `role="status"` and `aria-live="polite"`, with complete reduced-motion compatibility (`@media (prefers-reduced-motion: reduce)`).
- State transition rule: Renders when `research.submitting || stream?.isPending || streaming` while `!stream?.streamingText`. The moment `streamingText` contains content, `NyAiThinking` unmounts in favor of `AiMarkdown`.
- Cancellation invariant: Unmounts immediately on complete, error, cancel, or route transition. No orphaned loading indicators are tolerated.

### 3. Desk Landing Pages Architecture
- When navigating to any desk without a sub-module selected (`guideMode`), the system mounts `DeskLandingView.jsx`.
- Replaces explanatory walls of text with:
  1. **Live Counters:** Real counts calculated directly from backend records (`data.rows.length`, distinct categories, verified source links, available modules).
  2. **One Real Chart:** A categorical distribution chart (via `BarList` or `DonutChart`) using actual row data (e.g. legislative status, geopolitical theatre, economic sector). Zero decorative mock curves.
  3. **Module Cards:** Structured capability cards for each registered desk feature, displaying title, purpose blurb, capability tag, and direct "Launch Module →" action invoking `onFeature(name)`.
- Mockup synchronization: Architecture and data bindings are established to receive user-provided visual mockups without backend redesign.

---

## Consequences

- Landing page delivers immediate live intelligence from `nter.news`.
- Research experience provides immediate, polished, accessible feedback during LLM reasoning and generation phases.
- Desk landing pages become live data dashboards rather than static user manuals.
- Complete compatibility with existing Supabase Auth and OpenRouter execution pipelines.

---

## Amendment (2026-09-28)

**Decision 2, state transition rule.** The rule above does not match the code
and is kept only as the record. In `src/ai/AiPanel.jsx` (the "One indicator at
a time" comment, from 80342a3), `NyAiThinking` renders when:

```
!streaming && !stream?.streamingText && (research.submitting || stream?.isPending || research.live)
```

Here `streaming` is `stream?.isStreaming`. The card therefore covers only the
wait before the stream opens. Once the stream opens, the card unmounts and the
`ActivityTicker` shows progress, even before any text arrives. `AiMarkdown`
renders as soon as `streamingText` has content. The whole in-flight block is
hidden when the stream or the turn reports an error. The cancellation
invariant still holds.

The panel's local-chat branch, which showed `NyAiThinking` while a legacy
send was busy, was deleted with the legacy AI path in 14b2344. The research
turn above is the only case.

**Decision 1, backing store.** `server/nterNews.mjs` now reads articles from
`public.nter_news_articles` in Supabase (7160391). The committed
`public/data/nter-news.json` is only a read-only fallback seed.
