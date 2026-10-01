# citations-pdf: the local end-to-end run (plan V7)

> **Status: Historical (dated 2026-10-01).** The local run that
> `docs/specs/2026-10-01-rag-v2-citations-pdf.md` (revision 3) requires before anything touches
> NTER (plan `docs/plans/2026-10-01-rag-v2-citations-pdf.md`, V7; checkpoint K is the owner
> reading this). Every result below was **executed** in the built-in browser against a full local
> Supabase stack, with real Mistral OCR and a real chat model. Cost: **$0.189** in total —
> $0.148 OCR, $0.028 chat answers and $0.001 embeddings, plus $0.012 for the box-alignment probe
> run beforehand. Nothing touched NTER except read-only copies of its model configuration.

## Set-up

- **Code:** branch `task/rag-v2-citations-pdf` at `21d0396`. Checkpoint J passed before the run:
  - lint clean; build ok;
  - `check:bundle` ok: the main entry is +1.2 KB gzip against a +2 KB limit, with no pdf.js in it;
  - Vitest 1,561, Deno 805 (40 in `document-file` after the review fixes);
  - all SQL fixtures pass; router import ok.
- **Security review:** none Critical, High or Medium. Low findings L1–L3 and I3 were fixed,
  each test red first (`21d0396`). L4 is recorded as F44.
- **Local stack:**
  - a scratch copy of `supabase/`; the 42 migrations; both bill desks loaded (9,817 rows each);
  - functions served with a mode-600 env file (deleted afterwards) holding the Mistral and
    OpenRouter keys, a worker secret, and localhost-only URL overrides for the two public PDFs;
  - **NTER's model configuration** (9 `ai_models`, 4 `ai_roles`, their 9 `model_pricing` rows)
    was copied read-only into the local stack so the chat could answer. The default model is
    `google/gemini-3.8-flash`.
- **Test admin:** created on the local stack only, with generated credentials deleted afterwards.
- **Documents:**
  - **the 12-page bill**, attached to `bill:2025:XLV` through the Documents page;
  - ***Budget at a Glance***, a standalone upload of 25 pages.
  - The uploader planned both correctly on the **new legacy pdf.js build** ("12 pages · 1
    part", "25 pages · 1 part").
- **Split document.** Mistral cannot fetch local parts, so a real split upload cannot be OCR'd
  locally (as in B5). After ingestion, the budget was converted into the exact shape of a 3-part
  upload instead:
  - pdf-lib split it into pages 1–10, 11–20 and 21–25;
  - each part was stored at `files/<sha256>.pdf`, and `document_files` became 3 rows with
    offsets 0, 10 and 20;
  - pages, blocks and chunks were unchanged, since a split does not change page numbers.

## Results

| # | Check | Result |
| --- | --- | --- |
| 1 | A citation opens its page; boxes sit on the passage | **Pass** |
| 2 | PDF and Text share one page; Text marks the span | **Pass** |
| 3 | Paging, "Back to citation"; boxes only on the cited page | **Pass** |
| 4 | Byte ranges through `document-file`, not a whole-file download | **Pass** |
| 5 | A split document: the cited page from its part; paging across part boundaries | **Pass** |
| 6 | A stay longer than 5 minutes, then paging into an expired part | **Pass** |
| 7 | The overlay: opens to 961 px, chat left and viewer right; closes back to 558 px; chat kept | **Pass** |
| 8 | Phone width: a full-screen viewer with Back; the chat behind is inert | **Pass** |
| 9 | Esc closes only the viewer | **Pass** |
| 10 | A deleted document | **Pass** |
| 11 | "Open stored copy" | **Partly**: the blocked-tab path passed; the tab itself is owner check 2 on NTER (the test browser blocks every `window.open`) |
| 12 | A legacy citation unchanged | **Not run locally**: the local stack has no legacy documents. Covered by Vitest (`WorkSurface` branch) and owner check 3 |

### Details

**1–3: the bill.**
- **The question:** "What penalties does this bill prescribe for unauthorised disclosure…?"
  The model took 43 s, the slowness tracked as F41, and answered with 15 citation bubbles.
- **Opening citation 4:**
  - the overlay opened, with class `cov is-open` and 961 px wide;
  - the viewer read "Page 9 of 12 · cited on page 9", in the PDF view, with two amber boxes
    sitting on the cited paragraphs;
  - the canvas was 447 CSS px (894 backing px at DPR 2) in a 479 px pane, with pdf.js's text
    layer on top.
- **Text view:** page 9, the span marked `exact` (3 marks), and no notice.
- **Paging and returning:**
  - Next went to page 10, with no marks in Text and no boxes in PDF;
  - "Back to citation" returned to page 9 with its 2 boxes.

**4: the transport.** Opening the bill made 1 `document-file` call (200) and 3 Storage
`GET`s, all **206 Partial Content**. The whole 159 KB file was never downloaded.

**5: the split budget.**
- **The question:** total expenditure and fiscal deficit for 2026-27. It answered in 29 s,
  citing pages 4, 5, 8 and 12.
- **Citation 3 (page 12):**
  - "Page 12 of 25 · cited on page 12", rendered from **part 2's file** (`df61bd3e…`) with 5
    range requests (206);
  - **3 boxes** outlining the cited "Expenditure of Government of India" table;
  - the button read "Open stored copy (part 2 of 3)".
- **Paging across parts:**
  - back to page 10 loaded **part 1's file** (`53a7b452…`) by range, labelled "part 1 of 3";
  - on to page 21 opened **part 3** (`58182338…`): `document-file` took 221 ms, the ranges
    about 100 ms, and the page settled in 3.6 s, mostly pdf.js rendering an image-heavy page;
  - ten rapid Next clicks fetched only what the final page needed.
- **Warm page change:** in an already-open part it took 1.3 s, with range requests of 1–5 ms.

**6: expiry.**
- After a **339-second** stay on page 21, Next to page 22 rendered with no request: pdf.js
  already held those bytes.
- Paging back into part 2, whose cached signature had expired, called `document-file` again
  (200) and the ranges succeeded (206).
- Renewing on a 400/401/403 in mid-read is covered by `rangeTransport` and controller tests.

**7–9: the layout.**
- **Closing:** the overlay went `is-closing` and then back to the dock width (558 px, right edge
  at the viewport edge). The answer and the attached chip were still in the chat.
- **At 375 px:** the viewer is fixed full width (375 × 669, below the top bars), with "← Back",
  and the page fits the width. The chat wrapper `cov-chat` is `inert` while covered.
- **Esc** with focus on the viewer's Next button closed the viewer. The dock stayed open and the
  chat was no longer inert.

**10: deleted.** The bill was deleted through the admin API (`ingest_delete`). Its citation,
reopened from chat history, showed "This document is no longer available", with no PDF and no
stored-copy button.

## Findings

1. **The budget's index step hit the local Edge runtime's CPU soft limit and was cut off**
   ("CPU time soft limit reached … early termination").
   - The lease expired, and the retry succeeded with 78 chunks, as the schedule would do on
     NTER.
   - The same 25-page document passed in one pass in the ingestion-v2 run. This is the F37 risk
     (`index` recomposes the whole document) showing at only 25 pages on a busy laptop.
   - Recommendation: raise F37's priority before large uploads.
2. **Rapid paging inside a part whose signature has expired asks `document-file` once per page**
   (3 calls about 3 s each locally), instead of once per part. The client shares in-flight
   requests per page, not per part.
   - It is harmless, but wasteful. The viewer already knows the part layout from
     `document_files`, so it could request per part.
   - **Follow-up F45.**
3. **"Ask about this document"** stays enabled on a deleted document's citation; using it would
   attach a document that no longer exists. Minor; part of F45.
4. **The box-alignment probe** (recorded in the plan): Mistral boxes match pdf.js on plain,
   `/Rotate 90` and CropBox pages, all 9 markers inside, with aspects equal to 0.1%.

## For NTER (V8)

- **Order:**
  1. deploy `document-file`, then probe its CORS, refusals and **hosted Storage range
     behaviour** (206 and a CORS `Range` preflight from the production origin);
  2. push the frontend.

  The function first, because the frontend calls it. The old frontend never calls it.
- **Owner checks:**
  1. open citations from the Espionage and Anti-Doping bills (page, boxes, Text view);
  2. "Open stored copy" opens a new tab with the PDF in a normal browser;
  3. a legacy citation still opens the old text reader;
  4. after the split test (*Budget at a Glance*, split every 10), a citation in part 2 or 3.

## State after the run

- The dev server, functions and local stack are stopped.
- The env file and test-admin credentials are deleted.
- The temporary launch entry is removed, and so are the fixtures (`ingest/r6/`).
- Nothing was written to NTER.
