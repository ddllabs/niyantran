# Compact chat footer plan (F72)

> **Status: Historical (2026-10-04).**

[Spec](../specs/2026-10-04-compact-chat-footer.md). Sequential CSS-only work on
 task/f72-compact-chat-footer. Capture baseline real-component footer height;
edit only scoped CSS; compare browser geometry and dark/light styling; run
focused presentation tests, lint/build and diff check; record and integrate
locally. No new test mirroring static styles; no push or backend deployment.

## Evidence

Scoped CSS only. Footer padding 12/16→8/12px vertically, section gap 8→6px;
attachment padding 6→3px and row padding 3→1px; composer padding 8→6px and
internal gap 6→4px. Pills retain 32px minimum height and theme foreground,
with pale soft-blue mix and restrained border; hover strengthens the tint.

Real SuggestionPills and AttachmentTray fixture at 600px: footer 222.19→194px
(28.19px saved), attachment 47→37px, remove remains 28px and send remains
36px. At 375px, question list scrolls (654px within 351px), full attachment
title remains wrapping. Keyboard focus outline remains visible. Browser
fixture contains mock context and composer markup, no live query or credentials.

61 focused tests passed (panelLayout, SuggestionPills, AiPanel); npm run lint
passed; npm run build passed with existing mixed-import/large-chunk warnings.
git diff --check passed. No new tests duplicating static CSS and no backend
or SQL changes. Screenshots: /private/tmp/f72-footer-light.png and
/private/tmp/f72-footer-dark.png. Not published.

Theme check: actual theme-dark class gives light foreground on deep blue-gray
pills; hover uses existing accent-soft. The first dark fixture attempt used an
unrecognized data-theme attribute; corrected class verified the real theme.
Review found no changed behavior, selector leakage or reduced control sizes.

## Publication, 2026-10-04

Owner authorized “push”. Six verified F70–F72 commits pushed to origin/main
through `660977e4f0821c8ab37636b364f840a590c5aed3`. Vercel deployment
`dpl_4cNfzsfQCGoR7DJy6TG43o8qGJjR` reached READY for that exact SHA, with
production alias niyantran-six.vercel.app and no alias error. Earlier local-only
statements above describe the pre-publication state. No Supabase deployment.
