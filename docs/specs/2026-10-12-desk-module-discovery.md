# Desk module discovery

> **Status: Living.** Owner-approved specification, 2026-10-12.
> Approved capability: desk-module-discovery. Implementation authorized on task/terminal-follow-up.

## Objective and current state

Make sibling modules discoverable on all eight landing pages while preserving
one-click picture-card navigation. F95 replaced the lower selected-sector
module picker with direct picture-card links. The shared DeskLandingFrame now
renders sector cards followed by its footer. The internal sector menus and
catalogue still expose all 120 modules; all 35 picture cards have approved
defaults in deskDefaults.js. This is confirmed by code inspection and earlier
F95 execution evidence, not a fresh browser execution in this planning task.

## Proposed behavior

- Add a collapsed disclosure labelled “View all modules” immediately below
  the picture cards and above the footer. Expanding it reveals one native
  sector accordion per presentation group, in existing order. Each sector
  summary names the sector and its module count; multiple sectors can be open.
- Each module appears as a compact text card/link with its existing title and
  available coverage text. Click or keyboard activation opens the canonical
  workspace directly. No intermediate “Open in Terminal” popup.
- Picture cards retain their current approved default links and modified-click
  behavior. They do not select an accordion before navigating. The two paths
  have independent controls, so restoring discovery adds no step to card entry.
- The expanded catalogue always includes the complete desk, including modules
  without sources. “All / With sources” continues to filter picture cards only;
  the disclosure states that it lists all modules to make this explicit.
- State continues using its current state/district context. Switching context
  must not substitute another desk's routes or invent available counts.
- Use existing canonical presentations and summaries; introduce no parallel
  catalogue, extra record fetch, new realtime subscription or module default.
- Preserve the existing data-breakdown dialog and ModuleDetail export used by
  shared catalogue/search. Only the restored lower links bypass that popup.

## Structure and conventions

Scope: src/desks/landing/DeskLandingFrame.jsx and deskLandingV6.css, with
focused tests alongside the component. Reuse existing React function
components, CSS theme tokens, summary formatting and canonical deskHash.
Representative link pattern:

```jsx
<a href={`/${deskHash(presentation.id, module.feature)}`}>
  {module.title}
</a>
```

Match existing unmodified-click interception through onFeature; preserve
Ctrl/Cmd-click, middle-click and link destinations. Native details/summary
controls are the preferred disclosure implementation. Use visible focus,
semantic headings, touch targets and labels that work in existing language
mode. No nested buttons inside links. No new UI dependency.

## Acceptance and verification

1. All eight desks expose the disclosure below their picture cards.
2. Expanding all sectors exposes exactly the canonical 120 modules, with no
   duplicates or omissions; every generated URL resolves to its exact module.
3. All 35 picture-card URLs still match deskDefaults.js. Every restored text
   link opens directly and never creates a module-detail popup.
4. Disclosure and sector accordions work with keyboard and touch, retain focus
   predictably, fit at 390px and 320px without horizontal overflow, and remain
   readable in both themes, at 200% zoom and with reduced motion.
5. Source filtering, State context, loading/error/unknown summaries and existing
   sibling menus still work. Missing coverage remains visibly unknown.
6. AI outside-click/landing dismissal and retained drafts from F95 still work.

Focused command: `npm test -- src/desks/landing/DeskLandingFrame.test.jsx
src/desks/landing/deskDefaults.test.jsx src/desks/landing/deskCatalogue.test.js`.
Also run `npm run lint`, `npm run build` and browser interaction checks across
the eight real landing components. Prove new navigation/disclosure guards fail
with the restored section absent or a deliberately incorrect destination before
relying on them. Static rendering alone does not establish interactive behavior.

## Boundaries and review choices

No edits to datasets, corpus, approved defaults, internal module workspaces,
authentication, billing, AI backend or deployments. Default collapsed disclosure
and per-sector accordions are the proposed design choices for owner review.
