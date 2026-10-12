# Sector selector polish

> **Status: Living.** Owner requested visual polish on 2026-10-12; task/terminal-follow-up only.

Current native selector looks like an unstyled form field in the restored V6
explorer. Match the existing visual language with a white themed surface,
stronger typography, restrained border/shadow, generous inset and a decorative
chevron. Retain the native select, label, options, keyboard/typeahead, 44px
control and canonical navigation. No new dropdown dependency or behavior.

Scope: DeskLandingFrame.jsx and deskLandingV6.css; this record and additive
F101 tracker entry only. No corpus, defaults, explorer layout, auth, AI,
header or access changes; no merge/push/deploy.

Sequential plan: snapshot dirty files; apply minimal wrapper/chevron and CSS;
run existing discovery/default checks, lint/build; browser-check all eight
selectors with long names/mobile and both themes, native keyboard selection.
Inspect screenshots and exact diff; verify corpus hashes and stage only this
scope plus reconstructed F101 tracker. Record verification before local commit.

## Execution evidence

Implemented in `19ffef6`. Existing
29 discovery/default/catalogue tests passed; npm run lint and npm run build
passed. Existing >500 kB chunk warning remains. Isolated local Chrome checked
all 35 sector options across eight real landing components, 320/390/1440
widths, 44px controls, native keyboard typeahead and both themes; no page
errors. Desktop/light and mobile/dark captures inspected. Native OS option
menu remains native. Full suite was not repeated for this styling-only change;
the preceding restoration baseline passed 2,506 tests. No new tests or
dependencies. All original dirty corpus paths and tracker content preserved.
