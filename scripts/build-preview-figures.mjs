// Writes src/data/preview-figures.json from the snapshot files (F144). Run after the files change:
//   node scripts/build-preview-figures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePreviewFigures } from '../src/lib/previewFigures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'public/data/embedded_csv', name), 'utf8'));
const figures = computePreviewFigures({
  bills: read('national_bill_tracker.json'),
  fronts: read('geopolitics_war_tracker.json'),
  mps: read('national_mp_report_card.json'),
  macro: read('finance_macro_indicators.json'),
});
fs.writeFileSync(path.join(root, 'src/data/preview-figures.json'), `${JSON.stringify(figures, null, 2)}\n`);
console.log(JSON.stringify(figures));
