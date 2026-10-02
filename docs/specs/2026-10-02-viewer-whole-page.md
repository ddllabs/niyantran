# Spec: the citation viewer shows the whole page (`viewer-whole-page`)

> **Status: Normative — approved by the owner on 2026-10-02:** "ship the quick fix first, then
> re-scope piece 2". It amends the default and the meaning of "Fit text" in
> `docs/specs/2026-10-01-rag-v2-citations-pdf.md` (amendment revision 4, point 2).
>
> Tracked as open-work F49.

## Current state

**Fit text is the default.** It scales the page to the union of its body blocks and crops
everything else away, horizontally and vertically. Header and footer blocks don't count as body.

**On page 1 of the National Anti-Doping (Amendment) Bill, 2025:**
- "As introduced in Lok Sabha" is a `header` block at 6–8% of the page height;
- the body starts at 64%.

So the viewer showed only the bottom third, enlarged. That reads as a different document from the
stored PDF, although it is the same file drawn by pdf.js.

**The saved zoom.** The viewer writes the zoom state to `localStorage` on every mount, so nearly
everyone who has opened it has "Fit text" saved without ever choosing it.

## Expected outcome

1. **The default is Fit width.** The whole page, at the pane's width; nothing is hidden.
2. **Fit text never hides content.**
   - It scales to the page's text column.
   - The column's left and right edges are the union of all of the page's blocks (headers,
     footers and margin notes included) and the citation's boxes, padded 2%.
   - Only blank side margins may fall outside the pane, where they scroll.
   - The page's full height is always shown.
3. **The zoom is saved only when the reader chooses it** (a fit, a zoom step, or ⌘/Ctrl + wheel).
   The saved key changes (`niyantranCitationZoomV2`), so the automatic "Fit text" written before
   this fix no longer applies. Every reader starts once from the new default.
4. **No other change.** Fit page, the zoom steps, the readout, the citation boxes and the
   scroll-to-citation are unchanged.

## Acceptance evidence

**Unit tests, shown red first:**
- the default is Fit width;
- Fit text's crop is the full height (`y0` 0, `y1` 1), and its horizontal extent includes header
  and footer blocks;
- a cited box widens the extent;
- the saved key is the new one, and the old one is ignored;
- mounting the viewer writes nothing to storage; choosing a fit does.

**Repository checks:** `npm test`, lint, build and the bundle check.

**The browser,** on the harness with the bill's page 1:
- Fit width shows the whole page, header included;
- Fit text shows the full height with the header;
- the cited box still lines up.

**Production:** a push with the owner's go-ahead.

## Scope

**Write scope:**
- `src/ai/page-viewer/zoomModel.js`, `PageViewer.jsx` and their tests;
- this spec, open-work, and an amendment note in the citations spec.

**Exclusions:**
- piece 2 (continuous scrolling, thumbnails, search, exact-text highlighting), which is re-scoped
  separately.
