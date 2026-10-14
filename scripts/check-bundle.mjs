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

console.log(`check:bundle ok: ${summary}; no "${PDFJS_MARKER}"; no stylesheet outside the entry and the PDF viewer.`);
