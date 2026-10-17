#!/usr/bin/env node
// Bundle check (docs/specs/2026-10-01-rag-v2-citations-pdf.md, Testing; plan V3). Run after
// `npm run build`:
//
//   npm run build && npm run check:bundle
//
// It finds the main entry chunk that dist/index.html loads and fails (exit 1) when:
//   1. it contains `GlobalWorkerOptions`, i.e. pdf.js leaked out of its lazy chunk;
//   2. its gzip size exceeds the recorded baseline (scripts/bundle-baseline.json) by more than
//      2 KB. Gzip uses zlib's default level, which is what vite's build report prints;
//   3. a stylesheet other than the entry's and the PDF viewer's is emitted (F145): the terminal,
//      admin and persona chooser load lazily, and a stylesheet that moved with them would load after
//      index.css and change the cascade. Their styles are kept in the entry by
//      src/shell/terminalStyles.js (npm run build:terminal-styles).
//   4. the Goa geography pack (src/data/niy-geo.json, F158) is not in its own lazily loaded chunk:
//      the pack must sit in exactly one chunk, its own (niy-geo-*.js), which no chunk imports
//      statically (only through `import()`), so a terminal visit downloads it only when a geography
//      module opens. The pack is recognised by its `vintage` string.
//
// When the main bundle is meant to grow, re-measure and update the baseline file in the same
// change, saying why.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const TOLERANCE_BYTES = 2048;
const PDFJS_MARKER = 'GlobalWorkerOptions';

function fail(message) {
  console.error(`check:bundle FAILED: ${message}`);
  process.exit(1);
}

let html;
try {
  html = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  fail('dist/index.html not found; run `npm run build` first.');
}

const entries = [...html.matchAll(/<script\b[^>]*\bsrc="\/assets\/(index-[^"/]+\.js)"/g)].map((m) => m[1]);
if (entries.length !== 1) {
  fail(`expected one /assets/index-*.js entry script in dist/index.html, found ${entries.length}.`);
}
const entry = entries[0];
const code = readFileSync(join(dist, 'assets', entry));

if (code.includes(PDFJS_MARKER)) {
  fail(`the main entry chunk assets/${entry} contains "${PDFJS_MARKER}": pdf.js is in the main bundle. ` +
    'Load it only through the dynamic loader in src/lib/pdfjs.js.');
}

const ALLOWED_CSS = /^(index|PageViewer)-[\w-]+\.css$/;
const strayCss = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.css') && !ALLOWED_CSS.test(f));
if (strayCss.length) {
  fail(`unexpected stylesheet(s) ${strayCss.join(', ')}: a lazily loaded chunk carries CSS, which would load after ` +
    'index.css. Run `npm run build:terminal-styles` (and keep the import in App.jsx) so it stays in the entry.');
}

const geoMarker = JSON.parse(readFileSync(join(root, 'src', 'data', 'niy-geo.json'), 'utf8')).vintage;
if (!geoMarker) fail('src/data/niy-geo.json has no vintage string to recognise the geography pack by.');
const jsChunks = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
const chunkText = new Map(jsChunks.map((f) => [f, readFileSync(join(dist, 'assets', f), 'utf8')]));
const geoChunks = jsChunks.filter((f) => chunkText.get(f).includes(geoMarker));
if (geoChunks.length !== 1 || geoChunks[0] === entry || !geoChunks[0].startsWith('niy-geo-')) {
  fail(`the Goa geography pack is in ${geoChunks.join(', ') || 'no chunk'}; it must be in one lazily loaded chunk of its ` +
    'own, not the entry. Load src/data/niy-geo.json only through the dynamic import in src/lib/archiveFeed.js (F158).');
}
// F208: inspect the entire initial static chunk closure, including modulepreloads.
// These identifiers survive minification and belong to the complete feature map / columns.
const initial = new Set([entry, ...[...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/assets\/([^"/]+\.js)"/g)].map(m => m[1])]);
const visitInitial = name => {
  const text = chunkText.get(name);
  if (!text) fail(`initial JavaScript asset ${name} is missing.`);
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*)["']\.\/([^"']+\.js)["']/g)) {
    if (!initial.has(m[1])) { initial.add(m[1]); visitInitial(m[1]); }
  }
};
for (const name of initial) visitInitial(name);
for (const name of initial) {
  for (const marker of ['workbookFunctions', 'VENDOR / ORIGIN']) {
    if (chunkText.get(name).includes(marker)) fail(`terminal schema marker "${marker}" in initial asset ${name}; keep the full catalogue behind terminal loading (F208).`);
  }
}
const initialGzipBytes = [...initial].reduce((sum, name) => sum + gzipSync(chunkText.get(name)).length, 0);

const geoChunk = geoChunks[0];
const escaped = geoChunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const staticImport = new RegExp(`(?:\\bfrom|\\bimport)\\s*["']\\./${escaped}["']`);
const staticImporters = jsChunks.filter((f) => staticImport.test(chunkText.get(f)));
if (staticImporters.length) {
  fail(`assets/${geoChunk} (the Goa geography pack) is imported statically by ${staticImporters.join(', ')}, so it ` +
    'loads with them. Import it only through `import()` (F158).');
}

const { mainEntryGzipBytes: baseline } = JSON.parse(readFileSync(join(root, 'scripts', 'bundle-baseline.json'), 'utf8'));
if (!Number.isInteger(baseline) || baseline <= 0) {
  fail('scripts/bundle-baseline.json has no valid mainEntryGzipBytes.');
}
const gzipBytes = gzipSync(code).length;
const limit = baseline + TOLERANCE_BYTES;
const delta = gzipBytes - baseline;
const summary = `assets/${entry}: ${gzipBytes} bytes gzip (baseline ${baseline}, ${delta >= 0 ? '+' : ''}${delta}; limit ${limit})`;
if (gzipBytes > limit) {
  fail(`${summary}. The main bundle grew by more than ${TOLERANCE_BYTES} bytes gzip.`);
}

console.log(`check:bundle ok: ${summary}; no "${PDFJS_MARKER}"; no stylesheet outside the entry and the PDF viewer; ` +
  `Goa geography pack lazy in assets/${geoChunk}; initial JavaScript ${initialGzipBytes} bytes gzip across ${initial.size} assets, no terminal schemas.`);
