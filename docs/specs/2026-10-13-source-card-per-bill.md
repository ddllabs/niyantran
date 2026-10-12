# One source card per bill (F118)

> **Status: Living.** The owner approved this on 2026-10-13 ("go ahead with
> both"). Branch `task/source-card-per-bill`, from `main` at `3495822`.

## Problem

An answer about the National Anti-Doping (Amendment) Bill, 2025 listed four
source cards with the same title: the "As introduced" PDF, an "As
introduced" text duplicate (F115), "As passed by Lok Sabha" and "As passed
by both Houses". 413 bills have several genuine versions (339 with 2
documents, 70 with 3, 4 with 4 or more), so an answer that cites more than
one version repeats the bill.

## Outcome

- `sourceGroups` in `src/ai/SourceList.jsx` groups the cited documents by
  normalised title and module. Citations carry no bill key, so title plus
  module stands in for it; the same title in two modules stays apart.
- A group with several documents is one card:
  - the bill title;
  - the module, all cited pages and all citation numbers;
  - below it, one tag per version in first-citation order ("As introduced ·
    PDF", "As passed by Lok Sabha", …).
  - Each tag opens that version's first citation, and the card opens the
    first citation overall.
- A group of one renders as before (F116 version in the meta line).
- The "Sources · N documents" count counts cards.
- Browser only; no server or `research-chat` change.

## Acceptance evidence

- Tests written first: three of the four new `SourceComponents.test.jsx`
  tests failed before the change. The fourth, "a single document keeps its
  card", guards the unchanged path. The F116 label test now uses distinct
  titles, so it still tests labels rather than grouping.
- Browser check on a local fixture, since deleted:
  - the anti-doping versions render as one card with four tags and one
    separate bill card;
  - clicking each tag opened `pdf:1`, `intro:2`, `ls:3`, `both:4`, and the
    card opened `pdf:1`.
- Lint, `npm test` (2,586) and the build pass.
