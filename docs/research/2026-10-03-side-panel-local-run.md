# side-panel: local browser run (F54)

> **Status: Historical (dated 2026-10-03).** This is the browser evidence for
> `docs/specs/2026-10-03-side-panel.md`, gathered during T2–T5 on `task/side-panel`.
>
> **Setup:** local only; nothing touched NTER. A scratch Supabase stack, one local test account,
> the Bill Passage Probability Index desk loaded, and a seeded answer citing two documents. Vite ran
> on 5174.
>
> **Two limits:**
> - **The Browser pane changed width mid-run,** so the expand checks ran at about 1,471 px rather
>   than 1,440.
> - **`research-chat` was not served,** so no live answer streamed. "AI state survives tab
>   switches" is shown by DOM node identity, not by a stream (see below).

## Tabs and state (1440 × 900)

| Check | Result |
| --- | --- |
| Tabs on a rail desk | Desk and AI research; Record appears once a row is selected, and selecting one opens it. |
| One tablist | `role="tablist"`. The active tab has `aria-selected="true"` and `tabindex="0"`, and each tab controls its panel. |
| The AI chat never remounts | `#side-panel-ai .ai-shell` is the same DOM node (`===`) across Desk, Record, AI and back, and across collapse and reopen. React would replace it on a remount, so the thread, the draft and a streaming answer survive. |
| Desk keeps its scroll | Desk's body scrolled to its 55 px maximum, then AI and back: still 55, the same node. |
| Esc | On AI it returns to Record, or to Desk with no selection. On an expanded panel it first restores. |
| Collapse | The panel becomes a 32 px handle naming Desk, Record and AI research, and the grid is `1408px 32px`. The handle reopens straight to the chosen tab. |
| A desk without a rail (home) | AI only. Its button reads Close, and closing it gives the desk the full width (`1440px`). |

## One width (1440 × 900)

| Check | Result |
| --- | --- |
| Default | 518 px (36%) on Desk, Record and AI alike. Before, it was 33%, 35% or 38% depending on the tab. |
| Drag | A 120 px drag on the edge gives 638 px on all three tabs, stored. |
| Keys | → gives 622 px (16 px). End gives 864 px, exactly 60%. |
| Reset | A double-click gives 518 px and clears the stored value. |
| Memory | A stored 700 px is applied after a reload, on every tab. |

## One expand mode (pane about 1,471 px wide)

| Check | Result |
| --- | --- |
| Expand on Desk | The panel becomes a fixed overlay 961 px wide, `is-solo`. The workspace grid is unchanged, so the desk is not reflowed. |
| Across tabs | Switching to AI keeps the panel expanded. |
| Restore | A click outside restores it, and so does Esc. |
| A citation in AI | The panel expands to the 961 px split, with the chat beside a 480 px viewer pane holding the WorkSurface, portalled and outside the chat's markup. The chat is the same node. Expand is locked meanwhile. |
| Close citation | AI returns docked (529 px). |
| A click outside with a citation open | The citation and the chat close, back to Desk (revision 5). |

## Stacked layouts

| Check | Viewport | Result |
| --- | --- | --- |
| Stacked under the desk | 768 × 1024 | The panel is the second row (y 672, 353 px), with its tab bar. No resize edge. |
| Expand hidden | 768 × 1024 | Hidden. The first run found it visible: `.side-panel-expand` lost to `.side-panel-actions button`. It was fixed, and the test names the winning selector. |
| Collapsed | 768 × 1024 | A 35 px bar of tab names under the desk; the desk grows to 847 px. |
| Desk | 375 × 812 | Stacked under the desk (y 544, 269 px), with the tab bar. |
| AI | 375 × 812 | Takes the workspace below the header (y 143–812), with the tab bar at its top, so Desk and Record stay one tap away. The thread is 323 px. Nothing crosses the screen's edges. |
| A citation | 375 × 812 | The viewer is fixed over the app area (y 143, 669 px). The panel behind it is inert. Close returns to AI. |

## Checks

- **Lint:** passes.
- **Vitest:** 2,005 tests, up from 1,969 before F54. The new tests failed first, or fail under a
  deliberate mutation.
- **The build:** passes.
