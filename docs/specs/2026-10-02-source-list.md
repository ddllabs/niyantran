# Spec: the sources list under an answer (`source-list`)

> **Status: Living.** Owner-approved design, 2026-10-02: the compact list. The owner's words
> were "this section really needs redesigning, it looks like windows 98".

> **Amendment, 2026-10-04 (F63, owner-approved chat polish):** the document
> row's metadata shows citation count; numbers are available under a separate
> Cited passages disclosure. The document row remains one button opening its
> first citation. Neither numbers nor disclosure are nested interactive controls.
> This supersedes the always-visible numbered labels below.

## Current state

`src/ai/SourceList.jsx` renders one `<button class="ai-source-chip">` per cited document under
an assistant answer. Each shows the document's title and then its stored file name.

**No stylesheet has a rule for `.ai-sources` or `.ai-source-chip`.** The browser therefore draws
its default grey bordered buttons in a bulleted list, which is the "Windows 98" look. The second
line is the storage file name (`_BillsTexts_LSBillTexts_Asintroduced_doping7232025123417PM.pdf`),
which is noise to a reader.

## Expected outcome

The compact list:

```
SOURCES · 2 documents
┌──────────────────────────────────────────────┐
│ ▤  THE NATIONAL ANTI-DOPING (AMENDMENT)       │
│    BILL, 2025                              ›  │
│    Bills · pp. 3, 5, 7 · cited 23 24 25       │
├──────────────────────────────────────────────┤
│ ▤  The Farmers (Old Age Allowance Bill,2000 › │
│    Bills · p. 2 · cited 2                     │
└──────────────────────────────────────────────┘
```

- **The label.** A small uppercase label reads "Sources · N documents" ("1 document" for one).
  It is in Hindi when the panel is in Hindi.
- **The list.** One bordered list of rows, in first-citation order (as today), with dividers
  between rows. It uses the panel's tokens (`--ai-line`, `--ai-muted`, `--ai-blue`,
  `--ai-blue-soft`).
- **Each row** is one button that opens the reader at the document's first citation (as today).
  It holds:
  - a document icon;
  - the title, at most two lines, then an ellipsis;
  - a muted meta line: the desk feature when there is one, then the cited pages, then the
    citation numbers;
  - a trailing chevron.
- **Cited pages** are the distinct `page_number`s of that document's citations, ascending:
  "p. 2" for one, "pp. 3, 5, 7" for several, and "+N" after five. They are left out when no
  citation has a page.
- **Citation numbers** are the `id`s of that document's citations, ascending. These are the
  numbers on the answer's bubbles. They are shown as small bubble-styled labels, which are not
  separate buttons.
- **The file name** moves into the row's tooltip, and its visible line is removed.
- **Interaction.** Hover and keyboard focus are visible: a soft blue background, and a focus ring
  on `:focus-visible`. The title has no underline.
- **Phones.** At 375 px rows wrap within the panel, and nothing crosses its edge.

## Acceptance evidence

- **Vitest (`SourceComponents.test.jsx`):** pages and citation numbers are grouped per document;
  "p." and "pp." are used, with "+N" after five pages; the label pluralises; there is no
  file-name line, and the file name is in the tooltip; row citations are still ignored. The tests
  fail first.
- **A CSS test** shows `.ai-sources` and `.ai-source-chip` have rules. It fails first.
- **A local browser run** at 1440 × 900 and 375 × 812, on a seeded answer with two documents, takes
  a screenshot and measures that no row crosses the panel's edge and that clicking a row opens the
  reader.
- **Lint, both Vitest suites and the build pass.**

## Scope

`src/ai/SourceList.jsx`, `src/ai/MessageRow.jsx` (to pass `lang`), `src/ai/research.css`, and
the tests.

## Exclusions

- **Document titles are shown as stored.** For example "The Farmers (Old Age Allowance Bill,2000"
  has an unbalanced parenthesis and a missing space. That is a data defect, reported separately.
- **No change to which sources are listed**, and no server change.
- **The inline citation bubbles and the reader** are not changed.
