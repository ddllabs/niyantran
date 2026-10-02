# Spec: one side panel for Desk, Record and AI research (`side-panel`)

> **Status: Living.** Approved by the owner on 2026-10-03, with the open questions answered
> (below). On 2026-10-03 the owner said these
> three "are supposed to be a part of the same shared component with different tabs ... it's not
> production-grade". The owner chose:
> - tabs "Desk | Record | AI";
> - one width and one expand mode, shared by all tabs.

## Current state (read in the code, 2026-10-03)

**The right of the workspace holds two separate components** that take turns in the same grid
column:

| | Desk snapshot | Record | AI research |
| --- | --- | --- | --- |
| Component | `shell/RightRail.jsx` | `RightRail`, with a row selected | `ai/AiDock.jsx` → `AiPanel` |
| Header | `.rail-tabs`, a strip of 2 | the same strip, its first tab relabelled | its own `.ai-v2-head`, with icons and × |
| Width | `minmax(380px, 33%)` | `minmax(400px, 35%)` (`.bill-record`) | `minmax(340px, 38%)` (`.ai-open`) |
| Drag to resize | no | no | only while a citation is open |
| Expand / overlay | no | no | only for a citation (`CitationOverlay`) |

**The defects:**
- **The rail's "AI research" tab is not a tab.** It is a button that fires `niy-ai-open` and never
  shows as selected. In the AI panel there is no way back to Desk or Record except ×.
- **`TerminalShell` swaps components instead of switching tabs.** It sets
  `showRail = !aiOpen && …`, so the rail unmounts when the dock opens. The selection survives, but
  the rail's scroll and its open sections are lost.
- **The panel's width jumps on every switch** (33%, 35%, 38%), from separate grid rules, with
  more at 1180 and 900 px.
- **Resizing and the overlay** (`CitationOverlay` and `citationOverlayModel.js`, with storage,
  keys and pointer capture) are tested code, but only the AI citation viewer can use them.

**Worth keeping:**
- The AI panel stays mounted while hidden, so a reopen keeps the thread, the draft and a streaming
  answer (panel-loading spec A).
- The overlay widens in place without a portal, so the chat never remounts
  (`CitationOverlay.jsx`, header comment).

## Expected outcome

**One component, `shell/SidePanel.jsx`, owns the right of the workspace.** Each tab keeps its
current content: the desk snapshot, `NationalRecord` and the other record views, and `AiPanel`.

1. **Tabs: Desk | Record | AI.** A real tablist (ARIA `tablist`, `tab` and `tabpanel`, arrow keys,
   Home and End).
   - **Desk** is the current snapshot for the module.
   - **Record** is enabled only while a row is selected. Selecting a row opens it; clearing the
     selection returns to Desk.
   - **AI** is the research panel. `niy-ai-open` and every current "Ask AI" entry point select it,
     with the same seed (row, attachments, prompt) as today.
   - **Switching tabs never unmounts a tab once mounted.** The others are hidden, so AI's thread
     and draft, and Desk's and Record's scroll, survive.
   - **Where the rail is hidden today** (home, guide mode and the holistic desks), Desk and
     Record are absent. The panel shows only when AI is opened, as the dock does now.
2. **One width.** The panel's left edge is a separator, dragged with pointer capture and moved
   with the arrow keys, Home and End. Double-click resets it. The width is remembered per browser
   and is the same on every tab, so nothing jumps.
   - The default is 36% of the workspace (owner decision 1), within 340 px and 60%.
   - This replaces the three grid rules.
   - The maths moves out of `citationOverlayModel.js` into a shared model with tests.
3. **One expand mode.** Every tab gets an Expand control that widens the panel into the
   right-anchored overlay. It works as the citation overlay does today: `position: fixed`, the
   default `max(50vw, 960px)`, its own remembered width, and it does not reflow the desk.
   - **AI with a citation open** is the expanded AI tab, with the chat-and-viewer split as today.
     Its click-outside behaviour (revision 5) is kept.
   - **For Desk and Record,** Esc, Collapse or a click outside returns the panel to its docked
     width.
4. **One header.**
   - The tablist sits on the left.
   - The active tab's own actions follow: AI's new research, history, docs and download; Record's
     Full reasoning, Download PDF and All bills.
   - Expand and Collapse sit on the right (point 5).
5. **Collapse (owner decision 2).** On every desk the header has Collapse.
   - Collapsed, the panel leaves a slim handle on the workspace's right edge showing the tab
     names. Activating the handle, or any "Ask AI" entry point, reopens the panel on the chosen
     tab.
   - The collapsed state is remembered per browser.
   - On desks without a rail, AI's Close works as × does today.
6. **Phones.** Below 900 px the panel stacks under the desk, as both do now. At 640 px and below
   the AI tab takes the workspace, as chat-panel-fixes T3 did. The tab bar stays visible, so Desk
   and Record are reachable.

## Not changed

- **What each tab shows:** the desk charts, the record views, `AiPanel` and its research
  behaviour, and the citation viewer.
- **No server, database or data change.**

## Approach and risks

- **AiPanel must not remount.** SidePanel renders it at a fixed position in its tree from its
  first open, hidden while another tab is active. A test asserts the same instance survives tab
  switches.
- **The overlay must not use a portal.** The expand mode widens the panel's own element, as
  `CitationOverlay` does.
- **The CSS migration.** 85 rules name `.right-rail`, 36 name `.workspace.ai-open` and 15 name
  `.rail-`. Each is classified:
  - content rules stay, on the tab panels;
  - container rules move to `.side-panel`;
  - `.workspace.ai-open` maps to a workspace class for the AI tab (`.panel-ai`).

  A CSS test asserts no rule names a removed container class.
- **Existing tests move with the code:** `AiPanel.test.jsx`, `CitationOverlay.test.jsx`,
  `RecordDetail.test.jsx` and the layout tests in `panelLayout.test.js`.
- **The onboarding tour and the marketing demo** (`BillAiDropDemo.jsx`) name these classes. Each
  is checked and updated.

## Acceptance evidence

- **Vitest, failing first:**
  - the panel state model: the tab on select, clear and `niy-ai-open`; Record disabled with no
    selection; tabs absent where the rail is hidden today;
  - the width model: clamp, keys, reset and storage;
  - SidePanel: a tablist with correct ARIA, and AiPanel not remounted across tab switches;
  - CSS: no rule names a removed class, and the phone rules.
- **A local browser run** at 1440 × 900, 768 × 1024 and 375 × 812, with screenshots, measuring:
  - **width:** switching Desk, Record and AI keeps the panel's width to the pixel, and a drag on
    one tab holds on the others and survives a reload;
  - **expand:** it works on each tab; AI with a citation opens the split as before, and Esc and a
    click outside behave as specified;
  - **state:** an AI answer still streaming survives a switch to Desk and back; Desk's scroll
    survives a switch to AI and back;
  - **keyboard:** the arrow keys move between tabs, and the separator moves with the keys.
- **Lint, Vitest and the build pass.**
- **The push waits for a go-ahead.** This is a frontend change only.

## Scope

- `shell/SidePanel.jsx` (new) and its model (new);
- `shell/TerminalShell.jsx`, `shell/RightRail.jsx` (its content becomes the Desk and Record
  panels);
- `ai/AiDock.jsx` (folded into SidePanel);
- `ai/CitationOverlay.jsx` and `citationOverlayModel.js` (shared width and expand);
- `index.css`, `ai/citation-overlay.css`;
- the tests above.

## Exclusions

- No redesign of any tab's content, and no new panel features beyond tabs, width and expand.
- The desk-guide sidebar, the persona chooser and the Live TV modal are not part of the panel.

## Owner decisions (2026-10-03)

1. **The default docked width is 36%.**
2. **Collapse is added on every desk.** The handle reopens the panel, and the choice is
   remembered.

## Testing note

**Vitest runs in Node, without a DOM, and adding jsdom is a new dependency.** So the unit tests
assert the structure, and the browser run proves the behaviour:
- **Unit tests:** every mounted tab panel is rendered, hidden but never removed, and the mounted
  set only grows.
- **The browser run:** the AI panel's DOM node is the same object (`===`) before and after tab
  switches, and an answer still streaming survives them.
