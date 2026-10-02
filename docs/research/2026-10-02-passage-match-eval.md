# viewer-continuous T1: does the exact-passage matcher find cited passages in the PDF?

> **Status: Historical (dated 2026-10-02).** The matcher evaluation that
> `docs/specs/2026-10-02-viewer-continuous.md` requires before the exact mark is built.

## Method

**What was matched.** Every chunk of the two documents live in the page viewer was cut at page
boundaries (121 pieces):
- *The Classified Information and Espionage Control Bill, 2025*: 12 pages, 40 chunks;
- *The National Anti-Doping (Amendment) Bill, 2025*: 22 pages, 81 chunks.

**How.** Each piece was read from the stored page text with the chunk's offsets, as the viewer
reads it, and located with `locatePassage` in that page's PDF text layer, as pdf.js renders it.

**Data:**
- the page text and chunk offsets, read-only from NTER (Management API);
- the PDFs:
  - the Espionage bill from `ingest/pilot/bill-rs-371-2025.pdf` (the same Rajya Sabha bill);
  - the anti-doping bill from its public sansad.in source (downloaded with the owner's approval).

**Harness:** `scripts/eval-passage-match/run.mjs`.

## Results

**First version** (the first anchor found at each end): 115 of 121 marked exactly, 95%.
- **All six misses were on the anti-doping bill,** and every word of each passage was in the
  layer.
- **The cause:** OCR folds margin notes ("Powers and functions of Agency", "2 of 1974") into the
  body, and the passage then begins or ends with one. The PDF keeps the note in its side column, so
  the first anchor found matched the note, far from the passage.

**The fix:** every anchor within the allowed slack at both ends is a candidate, and the best
window wins. Pinned by two tests.

**After the fix:** 121 of 121 marked exactly, 100%. The spec's target is 90%.
- **The wrong-page check** (each passage against the neighbouring pages that hold none of its
  chunk): 0 matches in 237 attempts.
- **The coverage of accepted matches:**
  - the median is 0.986 of the passage's words in order;
  - the 10th percentile is 0.917;
  - the minimum is 0.806, just above the 0.8 floor.
- **The window length** against the passage: median 1.00, maximum 1.37. That is the PDF's line
  numbers and notes inside the passage.

## Reading

- **The exact mark is feasible on the corpus as it stands.** No change to ingestion is needed.
- **The 0.8 floor has little room:** the lowest accepted match was 0.806. A document whose OCR and
  PDF disagree more would fall back to the dashed approximate rectangles, as designed, rather than
  be marked wrongly.
- **Re-run this evaluation when new kinds of documents** (budgets, gazettes, scanned papers) go
  live.
