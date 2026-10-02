# Plan: the sources list under an answer (`source-list`)

> **Status: Living.** Implements `docs/specs/2026-10-02-source-list.md`. The tasks run in order
> and test-first, and each is committed once verified. The push waits for its own go-ahead.

### T1. The row's content
- **Acceptance:** `documentChips` groups each document's pages and citation numbers. The rows
  render the label, title, meta line and tooltip as specified. Vitest fails first.
- **Files:** `src/ai/SourceList.jsx`, `src/ai/MessageRow.jsx`, `src/ai/SourceComponents.test.jsx`.

### T2. The styles
- **Acceptance:** `research.css` styles `.ai-sources` and its rows with the panel's tokens. A CSS
  test fails first. A local browser run at 1440 × 900 and 375 × 812 is recorded in
  `docs/research/`.
- **Files:** `src/ai/research.css`, `src/ai/panelLayout.test.js`.

### Checkpoint
- Lint, Vitest and the build pass.
- **Go-ahead:** the push.
