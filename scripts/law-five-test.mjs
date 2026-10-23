// Offline real-corpus contract test. No network, credentials, or decision-manifest output.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { prepareSuppliedText } from '../supabase/functions/_shared/suppliedText.ts';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const [corpus, report] = process.argv.slice(2);
if (!corpus || !report || process.argv.length !== 4) throw Error('Usage: node --experimental-strip-types scripts/law-five-test.mjs CORPUS REPORT');
const selectionBytes = await readFile(new URL('./law-five-selection.json', import.meta.url));
const selection = JSON.parse(selectionBytes);
const lines = (await readFile(corpus, 'utf8')).trimEnd().split('\n');
assert.equal(lines.length, 5);
const results = [];
for (const [index, line] of lines.entries()) {
  const expected = selection.records[index];
  assert.equal(hash(line), expected.record_sha256, 'original record changed');
  const record = JSON.parse(line);
  assert.equal(record.source_key, expected.source_key);
  // Test-only attestations exercise the adapter; they are neither saved nor release approvals.
  const input = { ...record, desk_feature: selection.feature, review: {
    status: 'eligible', source_key: record.source_key, text_sha256: record.text_sha256,
    rules_sha256: hash(selectionBytes), package_id: 'OFFLINE-TEST-ONLY',
    mapping_version: 'offline-five-v1', decision_id: `offline-${index}`,
    checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true },
  } };
  const prepared = await prepareSuppliedText(input);
  assert.equal(prepared.text, record.text);
  assert.ok(prepared.chunks.length > 0);
  assert.equal(prepared.pages.length, record.n_pages);
  await assert.rejects(() => prepareSuppliedText({ ...input, text: record.text + '!' }), /hash mismatch/);
  await assert.rejects(() => prepareSuppliedText({ ...input, page_split: 'partial' }), /page split/);
  await assert.rejects(() => prepareSuppliedText({ ...input, review: { ...input.review, checks: { ...input.review.checks, rights: false } } }), /rights/);
  results.push({ source_key: record.source_key, title: record.title, text_sha256: record.text_sha256,
    feature: selection.feature, pages: prepared.pages.length, chunks: prepared.chunks.length,
    citation: record.citation, source_url: record.file_url, negative_checks: 3 });
}
const result = { status: 'offline-contract-passed', documents: results.length,
  chunks: results.reduce((n, r) => n + r.chunks, 0), production_eligible: false,
  database_writes: 0, embedding_calls: 0, documents_detail: results };
await writeFile(report, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...result, documents_detail: undefined }));
