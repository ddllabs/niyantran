# Citations name the bill version (F116)

> **Status: Living.** The owner approved this on 2026-10-13 ("go ahead with
> F116"). Branch `task/citation-version-labels`, from `main` at `fcbcfb8`.

## Problem

An answer about the National Anti-Doping (Amendment) Bill, 2025 listed three
sources with the same title. One was the "As passed by Lok Sabha" version, a
different text from "As introduced", but nothing said so. 413 bills have
several documents. Retrieval already verifies each passage's
`document_role`, and the model sees it as `version: …`, but the citation
dropped it.

## Outcome

- The server: `textCitation` copies the verified `document_role` into the
  citation, and omits the key when there is none. `TextCitation` gains an
  optional `document_role`.
- The browser:
  - `DOCUMENT_ROLE_LABELS` in `src/types/citation.js` mirrors the server map.
  - `sanitizeCitation` drops a role it does not know.
  - Source cards show the version first in the meta line ("As introduced").
  - The reader header shows a version pill beside the title, and the reader's
    source list names it too.
- Answers saved before the deploy carry no role and look as before.
- The change is visible only after a separately authorized `research-chat`
  deploy. Before it, the browser changes are inert.

## Acceptance evidence

- Tests written first and seen failing:
  - Deno `citations_test.ts`: the role is carried, and absent when unknown;
  - `SourceComponents.test.jsx`: two versions labelled, a forged role ignored;
  - `WorkSurface.test.jsx`: header pill, unknown role dropped by `resolveViewer`.
- Browser check on a local fixture, since deleted: source cards show "As
  introduced" and "As passed by Lok Sabha", the reader header shows the pill,
  and the reader's list names the version.
- Lint, `npm test` (2,582), the build and Deno (882) pass.

## Exclusions

- Stating whether a source opens as PDF or text.
- The duplicate and misattributed documents (F115).
- Backfilling roles into saved answers.
