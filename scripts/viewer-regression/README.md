# Local citation viewer regression fixture

> **Status: Living.** A local browser observation harness for F57, not an automated acceptance test.

Run from the repository root with the existing dependencies:

```sh
node ./node_modules/vite/bin/vite.js --config scripts/viewer-regression/vite.config.mjs
```

Open [the localhost fixture](http://127.0.0.1:5197/). Port 5197 is strict and bound to loopback. Stop with Ctrl+C. Use this development server: `vite preview` and the generated build do not serve the synthetic PDF endpoints.

The custom config uses no root Vite plugins, no `.env` files and no public data directory. A fixture-only module replaces default Supabase imports, and an injected client handles only deterministic table reads and the search RPC. A page CSP restricts connections to localhost. There are no signed URLs, accounts, storage writes or external services. The real `PageViewer` and its default legacy pdf.js/worker run against a PDF generated in memory with the already-installed `pdf-lib`. Nothing is written to a data collection.

The PDF has 18 numbered pages. Page 12 has one three-line passage, printed lower on the page. Its character offsets and SHA-256 hash match the stored page text. The citation's stored box is intentionally wrong, near the page top, so a return to that box is distinguishable from a return to the exact passage. Search for `copper heron` for one page/one hit, or `archive` for many pages and hits. The fake RPC counts non-overlapping folded matches and does not reproduce the live database's result cap or snippet generation.

The citation object and injected clients keep their identities. Every click on **Open the same citation · p12** changes only `revealRequest`; its numbered output records each event. `PageViewer` must implement the F57 `revealRequest` prop for repeated clicks to navigate. The fixture deliberately has no remount workaround and can therefore expose the old behavior.

## Manual scenarios

1. Open at p12. Wait for the text layer and `pv-cite` range. Compare its recorded text with the yellow passage in the fixture sidebar. Inspect the actual painted highlight too: a live Range alone does not prove painting. Check start and end nodes are connected, assigned to page 12, and have separate lines/rectangles.
2. Scroll naturally from page 12 to nearby pages and back several times. Inspect the citation highlight, range endpoints and `pageDOMOrder`. Slots should remain in ascending document order as draw priority changes. `canvasCount` should stay within the eight-page window. This panel reads DOM only and never sorts or repairs it.
3. Scroll far enough to unmount page 12, then return. Confirm the page draws and its citation range is rebuilt. Scroll to page 13, click the same citation button, and compare its range rectangle with the pane rectangle. It should return to the lower passage rather than the inaccurate top box. Repeat while already on page 12 after scrolling the passage offscreen. Check the request counter advances without resetting zoom or search.
4. On page 12, move away from the passage and use the viewer's cited-page control and Home key. Inspect the exact destination. Navigate elsewhere using page input, previous/next, or search while a citation return is pending. A later redraw must not jump back unexpectedly.
5. Use Fit width, Fit page, Fit text, then manual −/+ zoom. Repeat steps 1–4 and inspect the regenerated text ranges. Also switch fit modes quickly and immediately return to the citation: after the redraw, the fresh range should be centred, rather than using a range from the old scale. Drag **Split width** from 400 to 1000 pixels and back while reading page 12; observe both the highlight and scroll position. Wide panes may require a wider browser window.
6. Open the viewer's thumbnail rail, navigate to another page, return to p12, and repeat the citation. Open search; try `copper heron` and `archive`, move among matches, then repeat the citation. Observe `pv-match` and `pv-match-current` ranges and the retained query. Switch PDF/Text and back using the real controls.
7. Use the viewer's Expand control for full view. Repeat nearby/far scroll, cited-page return, Home, fit/zoom, search and thumbnail navigation. Exit full view and check the shared page/zoom/search state. Full view is the actual viewer portal; the fixture sidebar stays behind the modal. DOM status remains readable after exit and can be inspected in DevTools during full view.

Record browser/version, viewport, request number, visible page, relevant status snapshot, actual painted result and console/network errors for each observation. This fixture does not label a scenario passed or failed. Chrome/Safari versions without the CSS Custom Highlight API report `highlightAPI: false`, requiring fallback rather than exact-range evidence. No browser run is implied by successful compilation or HTTP delivery.

## Compile check

```sh
node ./node_modules/eslint/bin/eslint.js --max-warnings 0 scripts/viewer-regression
node ./node_modules/vite/bin/vite.js build --config scripts/viewer-regression/vite.config.mjs
```

The compile output goes to `/private/tmp/niyantran-viewer-fixture-build`. That build checks browser modules and worker bundling; runtime needs the development server's local PDF routes. The DOM monitor polls every 250 ms without modifying viewer nodes or highlighting state; account for that diagnostic overhead when observing stutter.
