// Generates the synthetic spreadsheet fixtures used by src/lib/spreadsheetExtractor.test.js.
// All content is invented. Run from the repo root: node supabase/functions/ingest-worker/__fixtures__/make-fixtures.mjs
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';

XLSX.set_fs(fs);
const dir = path.dirname(new URL(import.meta.url).pathname);
const wb = XLSX.utils.book_new();

// Long descriptive values so the first sheet spans several 1200-character chunks.
const filler = 'Synthetic entry for chunking tests only.';
const overview = [
  ['Document Details', 'Value'],
  ...['Title', 'Version', 'Status', 'Owner', 'Audience', 'Last updated', 'Scope', 'Release target', 'Review cycle', 'Approvers', 'Notes', 'Confidentiality', 'Related documents', 'Glossary', 'Change log', 'Open questions'].map(
    (k, i) => [k, `Sample value ${i + 1}. ${filler}`]
  ),
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overview), 'Overview');

const names = ['Goals', 'Users', 'Features', 'Data Model', 'Integrations', 'Security', 'Performance', 'Milestones', 'Risks', 'Glossary'];
for (const name of names) {
  const rows = [['Item', 'Description', 'Priority']];
  for (let i = 1; i <= 6; i++) rows.push([`${name} ${i}`, `Sample ${name.toLowerCase()} entry number ${i}`, ['High', 'Medium', 'Low'][i % 3]]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
}
XLSX.writeFile(wb, path.join(dir, 'sample_platform_prd.xlsx'));

const csv = ['Feature ID,Feature,Layer,Status'];
for (let i = 1; i <= 8; i++) csv.push(`F-${String(i).padStart(3, '0')},Sample feature ${i},Layer I,Planned`);
fs.writeFileSync(path.join(dir, 'sample_feature_list.csv'), csv.join('\n') + '\n');
