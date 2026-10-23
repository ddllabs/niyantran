import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { runImport } from './corpus-text-import.mjs';
import { input } from '../supabase/functions/_shared/suppliedText_fixture.ts';
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function fixture(t, records) {
  const dir = await mkdtemp(join(tmpdir(), 'corpus-import-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const r = await input();
  const bytes = gzipSync((records ?? [r]).map((x) => JSON.stringify(x)).join('\n') + '\n');
  const file = join(dir, 'corpus.jsonl.gz');
  await writeFile(file, bytes);
  const decisions = join(dir, 'decisions.jsonl');
  const decision = {
    source_key: r.source_key,
    text_sha256: r.text_sha256,
    file_sha256: hash(bytes),
    desk_feature: r.desk_feature,
    review: r.review,
  };
  const manifest = JSON.stringify(decision) + '\n';
  await writeFile(decisions, manifest);
  return { files: [file], decisions, report: join(dir, 'report.jsonl'), approval: hash(manifest), dir };
}
test('dry run reads gzip and reports eligible documents without network', async (t) => {
  const f = await fixture(t);
  const out = await runImport(f, () => {
    throw Error('no network');
  });
  assert.equal(out.ready, 1);
  assert.equal(out.submitted, 0);
  assert.match(await readFile(f.report, 'utf8'), /ready/);
});
test('a duplicate source with changed metadata is held before any submission', async (t) => {
  const r = await input();
  const f = await fixture(t, [r, { ...r, title: 'Changed' }]);
  const out = await runImport(f, () => {
    throw Error('no network');
  });
  assert.equal(out.held, 1);
  assert.equal(out.ready, 0);
});
test('submission uses admin endpoint and never uploads chunks or calls OCR', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const out = await runImport({
    ...f,
    submit: true,
    target: 'https://fixture.supabase.co',
    token: 'admin-token',
    publishableKey: 'public',
  }, async (url, opts) => {
    calls++;
    assert.equal(url, 'https://fixture.supabase.co/functions/v1/admin-ingest?input=supplied-text');
    const body = JSON.parse(opts.body);
    assert.equal(body.action, 'register_text');
    assert.equal(body.expected, undefined);
    assert.equal(body.record.text, (await input()).text);
    return new Response(
      JSON.stringify({
        ok: true,
        status: 'queued',
        document_id: 'doc',
        job_id: 'job',
        payload_sha256: body.confirm_sha256,
      }),
      { status: 200 },
    );
  });
  assert.equal(calls, 1);
  assert.equal(out.submitted, 1);
});
test('changed approval and unbound corpus refuse before network', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => runImport({ ...f, submit: true, approval: 'bad' }), /approval/);
  const rows = (await readFile(f.decisions, 'utf8')).replace(
    /"file_sha256":"[a-f0-9]+"/,
    '"file_sha256":"' + 'b'.repeat(64) + '"',
  );
  await writeFile(f.decisions, rows);
  const out = await runImport({ ...f, report: join(f.dir, 'other.jsonl') });
  assert.equal(out.held, 1);
  assert.equal(out.ready, 0);
});
test('lost registration acknowledgement is reported as uncertain, without automatic replay', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const out = await runImport({
    ...f,
    submit: true,
    target: 'https://fixture.supabase.co',
    token: 'admin-token',
    publishableKey: 'public',
  }, async () => {
    calls++;
    throw Error('connection lost after write');
  });
  assert.equal(calls, 1);
  assert.equal(out.uncertain, 1);
  assert.match(await readFile(f.report, 'utf8'), /submitting/);
});
test('known incomplete text is held even with an eligible decision', async (t) => {
  const r = await input();
  const f = await fixture(t, [{ ...r, page_split: 'cut_at_250' }]);
  const out = await runImport(f);
  assert.equal(out.held, 1);
  assert.equal(out.ready, 0);
});
test('malformed and oversized lines fail before any network writes', async (t) => {
  const f = await fixture(t);
  await writeFile(f.files[0], gzipSync('x'.repeat(8_000_001)));
  let calls = 0;
  await assert.rejects(() =>
    runImport(f, async () => {
      calls++;
    }), /line limit/);
  assert.equal(calls, 0);
});
