// Copies nter.pro's desk card — the record panel, its module adapters, the NTER record animation and
// the helpers they import — from a checkout of the website repo (ddllabs/niyantran) into this app,
// at the same paths, so the phone shows the card the website shows.
//
//   node scripts/sync-website-record.mjs ../niyantran        (or WEBSITE_DIR=../niyantran)
//
// Reads the website checkout; never writes to it. Files are copied unchanged except for the
// PATCHES below (the phone app has another origin and base path). Writes
// src/shell/website-sync.json with the website commit and every file's SHA-256; a unit test checks
// the copies still match, so an edit here is caught — change the website, then sync again.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.resolve(process.argv[2] || process.env.WEBSITE_DIR || path.join(APP, '..', 'ddllabs', 'niyantran'));

// Where the dependency walk starts. RecordPanel.jsx and useRecordBrief.js are not copied: they pull
// in the website's routing, account store and Supabase client, so the app has its own versions
// (src/deskcard/) with the same markup and the same brief flow.
const ENTRIES = [
  'src/shell/record/registry.js',
  'src/shell/record/packs.js',
  'src/shell/record/modelContract.js',
  'src/shell/record/recordAnimation.js',
  'src/shell/record/touchRules.js',
  'src/shell/record/visuals/index.js',
];
// Copied as they are, outside the walk: the stylesheet, the animation and the self-contained tests.
const EXTRA = [
  'src/shell/record/recordPanel.css',
  'public/animation/nter-record-loader.js',
  'public/animation/logo.svg',
  'src/shell/record/modelContract.test.js',
  'src/shell/record/visuals/visuals.test.jsx',
  'src/shell/record/adapters/common.test.js',
  'src/shell/record/adapters/feedHelpers.test.js',
];

const PATCHES = {
  // The app is served from its own origin and, for the demo build, from a relative base.
  'src/shell/record/recordAnimation.js': [
    ["export const RECORD_ANIMATION_SRC = '/animation/nter-record-loader.js';", 'export const RECORD_ANIMATION_SRC = `${import.meta.env.BASE_URL}animation/nter-record-loader.js`; // app: base-relative'],
    ["export const RECORD_ANIMATION_LOGO = '/animation/logo.svg';", 'export const RECORD_ANIMATION_LOGO = `${import.meta.env.BASE_URL}animation/logo.svg`; // app: base-relative'],
  ],
  // The analysis packs live on www.nter.pro; the phone apps reach them there (src/lib/websiteData.js).
  'src/lib/impactRecord.js': [
    [/^/, "import { websiteDataUrl } from './websiteData.js'; // app: packs are read from www.nter.pro\n"],
    ['fetch(`/data/embedded_json/${key}`)', 'fetch(websiteDataUrl(`/data/embedded_json/${key}`))'],
    ["fetch('/data/embedded_json/national_bill_analysis_identity.json')", "fetch(websiteDataUrl('/data/embedded_json/national_bill_analysis_identity.json'))"],
    ["fetch('/data/ontology.json')", "fetch(websiteDataUrl('/data/ontology.json'))"],
  ],
};

function resolveImport(from, spec) {
  let p = path.resolve(path.dirname(from), spec);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  for (const ext of ['.js', '.jsx', '/index.js']) if (fs.existsSync(p + ext)) return p + ext;
  throw new Error(`Cannot resolve ${spec} from ${path.relative(SITE, from)}`);
}

function walk(file, seen) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!/\.(js|jsx)$/.test(file)) return;
  const src = fs.readFileSync(file, 'utf8');
  const re = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of src.matchAll(re)) {
    const spec = m[1] || m[2] || m[3];
    if (spec.startsWith('.')) walk(resolveImport(file, spec), seen);
  }
}

if (!fs.existsSync(path.join(SITE, 'src/shell/record/registry.js'))) {
  console.error(`Not a website checkout: ${SITE}`);
  process.exit(1);
}
const seen = new Set();
for (const e of ENTRIES) walk(path.join(SITE, e), seen);
const files = [...new Set([...[...seen].map((f) => path.relative(SITE, f)), ...EXTRA])].sort();

const manifest = { source: 'ddllabs/niyantran', commit: '', syncedAt: new Date().toISOString().slice(0, 10), files: {} };
try { manifest.commit = execFileSync('git', ['-C', SITE, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }

for (const rel of files) {
  let text = fs.readFileSync(path.join(SITE, rel));
  const patches = PATCHES[rel];
  if (patches) {
    let s = text.toString('utf8');
    for (const [from, to] of patches) {
      if (typeof from === 'string' && !s.includes(from)) throw new Error(`Patch no longer applies to ${rel}: ${from}`);
      s = s.replace(from, to);
    }
    text = Buffer.from(s);
  }
  const out = path.join(APP, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  manifest.files[rel] = createHash('sha256').update(text).digest('hex');
}
fs.writeFileSync(path.join(APP, 'src/shell/website-sync.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Copied ${files.length} files from ${manifest.source}@${manifest.commit || '?'}.`);
