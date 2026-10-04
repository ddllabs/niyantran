# Chat reading space plan (F71)

> **Status: Historical (2026-10-04).**

[Spec](../specs/2026-10-04-chat-reading-space.md). Sequential on
 task/f71-chat-reading-space; no delegation.

1. Update default-width and user-facing duration guards, observe failure.
2. Keep CSS and resize arithmetic at 50%; permit table wrapping.
3. Show only known timing fields as Searching, Processing and Writing; pass
   timing from ActivityTicker. No stream interface change.
4. Focused/full frontend tests, lint/build, browser geometry and disclosure
   checks; update records and integrate locally. No push or backend deployment.

## Verification

Red: 5 focused guards failed against the old default/token UI. Green: 97
focused checks passed. npm test: 129 files / 2,090 tests passed. npm run lint
passed; npm run build passed with existing mixed-import and >500kB warnings.
No server/Edge Function changes; no additional backend or SQL checks needed.

Isolated real-component Chrome check: desk/panel 708/708px at 1416 and
512/512px at 1024. Three-column table scrollWidth equals clientWidth (673px,
477px); ten-column comparison remains scrollable (1320px). Explicit width
600px is honored. At 375px both panes span 375px and tables scroll within
341px. Completed flow can reopen to show duration split without token counts.
Fixture uses production CSS/components with mock data, not a live model query.
Initial fixture build required marking the unrelated world-map image URL
external; no application build failure. Browser automation used a file fixture
because CUA was unavailable earlier. Screenshot: /private/tmp/f71-chat-reading-space.png.

Review: CSS and resize arithmetic agree at 50%; remembered widths remain
explicit preferences; no timing values are fabricated or labeled reasoning.
No dependency, provider, authentication, data or deployment change.

## Publication, 2026-10-04

Owner authorized “push”. Six verified F70–F72 commits pushed to origin/main
through `660977e4f0821c8ab37636b364f840a590c5aed3`. Vercel deployment
`dpl_4cNfzsfQCGoR7DJy6TG43o8qGJjR` reached READY for that exact SHA, with
production alias niyantran-six.vercel.app and no alias error. Earlier local-only
statements above describe the pre-publication state. No Supabase deployment.
