// The decisions of scripts/f281-repair (lib.mjs): manifest, spend cap, write gate and order, read-back, review.
// Vitest-collected so CI runs it; it was a node:test file before F281 widened the tool.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it, it as test } from 'vitest';
import {
  OCR_MODEL, OCR_REQUEST_FLAGS, addBatch, checkSpend, clip, credentials, dependencyProblems, deskNames, deskQuery, documentQuery, driftProblems, embedCapProblems,
  embedEstimate, formatSums, idRange, ingestJobsQuery, liveClaimProblems, loadManifest, lockDecision, makeReader, manifestProblems, metadataHash, nextBatch,
  nextBatchNumber, ocrCacheProblems, ocrPlan, orderForWrite, pageRuns, parseArgs, parseSums, readbackProblems, readbackWrittenAfter, renderReview, retryRead,
  riskOf, selectDocuments, sha256, snapshotProblems, spentOnParts, stableJson, unpinned, usesPdf, withAuthorization, withPins, writeGateProblems,
} from '../../scripts/f281-repair/lib.mjs';

const MANIFEST = fileURLToPath(new URL('../../scripts/f281-repair/manifest.json', import.meta.url));
const HEX = (c) => c.repeat(64);

// The batch, as the coordinator and docs/research/2026-11-01-f281-triage.md set it out.
const CLEAN_REKEYS = {
  '0485a5ac': 'bill:2001:51', '0e4cbb57': 'bill:1999:124', '144dc8ae': 'bill:2000:205', '1a3b0519': 'bill:1998:85', '24c09071': 'bill:2005:94',
  '335d3607': 'bill:2006:83', '390311bf': 'bill:2005:79', '424e0d04': 'bill:2000:81', '46b96b19': 'bill:2000:167', '4a665c8b': 'bill:2000:80',
  '6393d754': 'bill:2000:62', '671bcf49': 'bill:2000:200', '77ffa7df': 'bill:2006:81', '94fe0078': 'bill:1998:32', '98abd091': 'bill:2004:88',
  '99250d51': 'bill:1998:49', a8403f6d: 'bill:1998:67', b8b00f0c: 'bill:1998:8', c4472f57: 'bill:2000:130', d4f8c709: 'bill:1998:43',
  e4a7d7d2: 'bill:2005:96', e81c044c: 'bill:2001:50', eb58009f: 'bill:2001:47',
};
const SYNOPSIS_REKEYS = { '648594ab': 'bill:2000:LXXII', '5fca207d': 'bill:2001:XXVIII', '3d51552f': 'bill:2000:LXXVI' };
// Four of the coordinator's first fourteen became re-keys (review finding 8): the keys exist or may exist without a desk record.
const LATE_REKEYS = { f5ddf657: 'bill:2000:75', '0cfda1b0': 'bill:2000:72', a17e769c: 'bill:2000:LXXI', b2d4bfff: 'bill:2001:XXX' };
const UNLINKED = ['7268af49', '6f94685d', 'cbd4dbc1', '8bffca18', 'ee462209', '7020ee78', 'afd4f0e8', '8777b653', '1b7862fb', '300194ff'];
const GARBAGE_OCR_BILLS = ['06dc6288', '0c258b6d', 'e777c56d', '366b1414', '9611101e', '26b571c5'];

describe('the committed manifest', () => {
  it('is valid, and its counts per action are the batch', async () => {
    const { manifest, sha256: sha } = await loadManifest(MANIFEST);
    assert.equal(sha.length, 64);
    const byAction = Object.groupBy(manifest.documents, (d) => d.action);
    assert.deepEqual(Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, v.length])), { decode: 2, reextract: 1, strip_cover: 2, ocr: 51, rekey: 31, retitle_unlink: 10 });
    assert.equal(manifest.documents.length, 97);
    // ids are null until the supervisor fills them after prepare; a filled manifest is valid too (manifestProblems checks the form)
    assert.ok(manifest.documents.every((d) => d.id === null || /^[0-9a-f-]{36}$/.test(d.id)));
  });

  it('names the documents of each action', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const by = Object.groupBy(manifest.documents, (d) => d.action);
    const ids = (action) => by[action].map((d) => d.prefix).sort();
    assert.deepEqual(ids('decode'), ['1f1ce52a', 'fb64d5ac']);
    assert.deepEqual(ids('reextract'), ['c8289e6b']);
    assert.deepEqual(ids('strip_cover'), ['40b1cec9', '7fd68cf2']);
    assert.deepEqual(ids('retitle_unlink'), [...UNLINKED].sort());
    assert.deepEqual(Object.fromEntries(by.rekey.map((d) => [d.prefix, d.new_document_key])), { ...CLEAN_REKEYS, ...SYNOPSIS_REKEYS, ...LATE_REKEYS, '4530253a': 'bill:2000:76' });
    const ocr = ids('ocr');
    for (const id of [...GARBAGE_OCR_BILLS, '712b7dab', '456b8787', '3f6669d6', '961175e5', '0c47142d', 'e3dd1af0', 'e77b7df8']) assert.ok(ocr.includes(id), id);
    assert.ok(!ocr.includes('c8289e6b'), 're-extracted, not OCR');
  });

  it('OCRs the whole of 456b8787 and the Bills with a file_url only, from an official URL', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const d = Object.fromEntries(manifest.documents.map((x) => [x.prefix, x]));
    assert.equal(d['456b8787'].action, 'ocr');
    assert.equal(d['456b8787'].pages, 8);
    for (const id of ['091d3758', 'b3b2095c', '0d05cf75']) assert.equal(d[id], undefined, `${id} has no file_url`);
    for (const x of manifest.documents.filter((y) => y.action === 'ocr')) assert.match(x.source_url, /^https:\/\/(www\.cci\.gov\.in|www\.trai\.gov\.in|sansad\.in)\//, x.prefix);
    assert.deepEqual(manifest.documents.filter((x) => x.action === 'ocr' && x.source_url.startsWith('https://sansad.in')).map((x) => x.prefix).sort(), [...GARBAGE_OCR_BILLS].sort());
  });

  it('OCR total is the batch: about 940 pages, inside the default cap of 5 dollars', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const pages = manifest.documents.filter((d) => d.action === 'ocr').reduce((n, d) => n + d.pages, 0);
    assert.ok(pages >= 930 && pages <= 960, `pages ${pages}`);
    assert.ok((pages * 4) / 1000 < parseArgs(['ocr']).maxUsd);
  });

  it('pins every OCR, decode and re-extract source except, until pin has run, the six Bills whose PDFs were not fetched yet', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const unpinned = manifest.documents.filter((d) => ['ocr', 'decode', 'reextract'].includes(d.action) && !d.source_sha256).map((d) => d.prefix).sort();
    assert.ok(unpinned.every((id) => GARBAGE_OCR_BILLS.includes(id)), `unexpected unpinned: ${unpinned}`);
  });

  it('orders the two re-keys that take a key another document is still holding', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    assert.deepEqual(manifest.documents.filter((d) => d.after?.length).map((d) => [d.prefix, d.after]).sort(), [['0cfda1b0', ['648594ab']], ['4530253a', ['3d51552f']]]);
  });

  it('records why four documents became re-keys and may have no desk record (review finding 8)', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const by = Object.fromEntries(manifest.documents.map((d) => [d.prefix, d]));
    for (const id of Object.keys(LATE_REKEYS)) {
      assert.equal(by[id].action, 'rekey', id);
      assert.ok(by[id].reason.length > 20, `${id} has no reason`);
      assert.equal(by[id].allow_missing_desk, true, id);
    }
    assert.equal(by.f5ddf657.new_title, 'The Constitution (Amendment) Bill, 2000 (Insertion of new article 16A)');
    assert.equal(by['0cfda1b0'].new_house, 'Lok Sabha');
    assert.equal(by.a17e769c.new_house, 'Rajya Sabha');
  });

  it('gives the Rajya Sabha unlinks the bill number the text prints, for the identity check', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const by = Object.fromEntries(manifest.documents.map((d) => [d.prefix, d]));
    assert.deepEqual([by.afd4f0e8.new_bill_number, by.afd4f0e8.new_bill_year], ['XXIV', 2000]);
    assert.deepEqual([by['8777b653'].new_bill_number, by['8777b653'].new_bill_year], ['LXVII', 2001]);
    assert.deepEqual([by['7020ee78'].new_bill_number, by['7020ee78'].new_bill_year], ['LXXI', 2000]);
  });

  it('marks the documents whose stored text is garbage, so the identity check asks for a look instead', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const garbage = manifest.documents.filter((d) => d.old_text_garbage).map((d) => d.prefix).sort();
    assert.deepEqual(garbage, ['06dc6288', '0c258b6d', '26b571c5', '366b1414', '3f6669d6', '456b8787', '961175e5', '9611101e', 'c8289e6b', 'e777c56d'].sort());
  });

  it('gives each re-key a distinct key, a title, and house and status where the listing gave them', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const rekeys = manifest.documents.filter((d) => d.action === 'rekey');
    assert.equal(new Set(rekeys.map((d) => d.new_document_key)).size, rekeys.length);
    for (const d of rekeys) assert.ok(d.new_title && d.new_house && d.new_status, d.prefix);
    assert.equal(rekeys.length, 31);
    const by = Object.fromEntries(rekeys.map((d) => [d.prefix, d]));
    assert.equal(by['648594ab'].new_house, 'Rajya Sabha');
    assert.equal(by.e4a7d7d2.new_title, 'The National Child Welfare Board Bill, 2005');
    assert.equal(by['98abd091'].new_title, 'The Buy Indian Bill, 2004');
  });

  it('lists the exclusions with a reason and none of them is also in the batch', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const inBatch = new Set(manifest.documents.map((d) => d.prefix));
    const excluded = manifest.excluded.flatMap((e) => e.ids.map((id) => [id, e.reason]));
    for (const [id, reason] of excluded) {
      assert.ok(reason.length > 10, id);
      assert.ok(!inBatch.has(id), `${id} is both in the batch and excluded`);
    }
    const ids = excluded.map(([id]) => id);
    for (const id of ['7e43d403', 'ca1b65ba', '091d3758', 'b3b2095c', '0d05cf75', 'cc99b0d2', '0384f9b5', '1b801b87', '624ae9cb', '410ebf75', '9726bbf4']) assert.ok(ids.includes(id), id);
    assert.equal(manifest.excluded.find((e) => e.ids.includes('0060da7b')).ids.length, 108, 'the key-less false alarms');
    assert.equal(new Set(ids).size, ids.length, 'no document is excluded twice');
  });
});

test('manifestProblems names what is wrong', () => {
  const good = { prefix: 'abcdef01', id: null, action: 'decode', source_url: 'https://example.org/a.pdf', source_sha256: HEX('a') };
  assert.deepEqual(manifestProblems({ documents: [good] }), []);
  const bad = (patch) => manifestProblems({ documents: [{ ...good, ...patch }] }).join('|');
  assert.match(bad({ prefix: 'abc' }), /prefix/);
  assert.match(bad({ id: 'abcdef01' }), /id must be/);
  assert.match(bad({ id: '12345678-0000-0000-0000-000000000000' }), /id must be/);
  assert.equal(bad({ id: 'abcdef01-0000-0000-0000-000000000000' }), '');
  assert.match(bad({ action: 'delete' }), /action/);
  assert.match(bad({ source_url: 'http://x' }), /https/);
  assert.match(bad({ source_sha256: 'zz' }), /source_sha256/);
  assert.match(bad({ action: 'strip_cover' }), /cover_marker/);
  assert.match(bad({ action: 'ocr' }), /pages/);
  assert.match(bad({ action: 'ocr', pages: 3, ocr_kind: 'poem' }), /ocr_kind/);
  assert.match(bad({ action: 'rekey' }), /new_document_key/);
  assert.match(manifestProblems({ documents: [good, good] }).join('|'), /duplicate/);
  assert.match(manifestProblems({}).join('|'), /no documents/);
});

test('selectDocuments takes exact prefixes and refuses an unknown one', () => {
  const m = { documents: [{ prefix: 'aaaaaaaa' }, { prefix: 'bbbbbbbb' }] };
  assert.equal(selectDocuments(m).length, 2);
  assert.deepEqual(selectDocuments(m, ['bbbbbbbb']).map((d) => d.prefix), ['bbbbbbbb']);
  assert.throws(() => selectDocuments(m, ['cccccccc']), /cccccccc/);
});

test('parseArgs: defaults, flags, and refusals', () => {
  const a = parseArgs(['ocr']);
  assert.equal(a.command, 'ocr');
  assert.equal(a.go, false); // nothing is spent without --go
  assert.equal(a.maxUsd, 5);
  assert.equal(a.batch, 20);
  assert.equal(a.maxEmbedUsd, 1);
  assert.deepEqual(a.rewrite, []);
  assert.equal(a.authorizedBy, null);
  assert.equal(a.workDir, join(homedir(), '.niyantran', 'f281-repair'), 'outside the worktree by default');
  const b = parseArgs(['write', '--confirm', HEX('a'), '--only', 'abcdef01', '--only', '12345678']);
  assert.deepEqual(b.only, ['abcdef01', '12345678']);
  assert.equal(b.confirm, HEX('a'));
  assert.equal(parseArgs(['ocr', '--go', '--max-usd', '0.6']).maxUsd, 0.6);
  assert.throws(() => parseArgs(['launch']), /unknown command/);
  assert.equal(parseArgs(['pin', '--apply']).apply, true);
  assert.equal(parseArgs(['dry-run', '--redo']).redo, true);
  assert.throws(() => parseArgs(['ocr', '--nope']), /unknown argument/);
  assert.throws(() => parseArgs(['ocr', '--max-usd', '0']), /max-usd/);
  assert.throws(() => parseArgs(['ocr', '--max-usd']), /needs a value/);
  assert.throws(() => parseArgs(['ocr', '--via', 'url']), /unknown argument --via/, 'OCR always sends the verified bytes');
  assert.equal(parseArgs(['write', '--work-dir', '/x/y']).workDir, '/x/y');
  assert.equal(parseArgs(['write', '--work', '/x/z']).workDir, '/x/z', 'the old name still works');
  assert.equal(parseArgs(['write', '--batch', '5', '--max-embed-usd', '0.2', '--authorized-by', 'owner, 2026-11-02, F281', '--rewrite', 'abcdef01', '--rewrite', '12345678']).batch, 5);
  const w = parseArgs(['write', '--max-embed-usd', '0.2', '--authorized-by', 'owner, 2026-11-02, F281', '--rewrite', 'abcdef01', '--rewrite', '12345678', '--rollback']);
  assert.deepEqual([w.maxEmbedUsd, w.authorizedBy, w.rewrite, w.rollback], [0.2, 'owner, 2026-11-02, F281', ['abcdef01', '12345678'], true]);
  assert.throws(() => parseArgs(['write', '--batch', '0']), /--batch/);
  assert.throws(() => parseArgs(['write', '--max-embed-usd', '-1']), /max-embed-usd/);
  assert.equal(parseArgs(['rollback-build']).command, 'rollback-build');
  assert.equal(parseArgs([]).command, null);
});

test('credentials: either URL variable, and only an sb_secret_ key', () => {
  assert.deepEqual(credentials({ VITE_SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_abc' }), { url: 'https://x.supabase.co', key: 'sb_secret_abc' });
  assert.equal(credentials({ SUPABASE_URL: 'https://a', VITE_SUPABASE_URL: 'https://b', SUPABASE_SECRET_KEY: 'sb_secret_x' }).url, 'https://a');
  assert.throws(() => credentials({ SUPABASE_URL: 'https://a' }), /must be set/);
  assert.throws(() => credentials({ SUPABASE_URL: 'https://a', SUPABASE_SECRET_KEY: 'eyJhbGciOi' }), /sb_secret_/);
});

test('idRange and documentQuery: by prefix range, or by exact id once the manifest has it', () => {
  assert.deepEqual(idRange('fb64d5ac'), { gte: 'fb64d5ac-0000-0000-0000-000000000000', lte: 'fb64d5ac-ffff-ffff-ffff-ffffffffffff' });
  const byPrefix = documentQuery({ prefix: 'fb64d5ac', id: null }, 'id,title');
  assert.match(byPrefix, /^documents\?select=id%2Ctitle&id=gte\.fb64d5ac-0000/);
  assert.match(byPrefix, /&id=lte\.fb64d5ac-ffff/);
  assert.match(documentQuery({ prefix: 'fb64d5ac', id: 'fb64d5ac-2d60-4125-8398-b0f1601381e5' }, 'id'), /id=eq\.fb64d5ac-2d60-4125-8398-b0f1601381e5$/);
});

test('the reader only ever sends GET, with the key in the headers and never in the URL', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 206, text: async () => '[{"id":"x"}]', headers: { get: (h) => (h === 'content-range' ? '0-0/42' : null) } };
  };
  const get = makeReader({ url: 'https://p.supabase.co', key: 'sb_secret_k', fetchImpl });
  const r = await get('document_chunks?select=id&document_id=eq.x', { count: true });
  assert.deepEqual(r, { rows: [{ id: 'x' }], total: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'GET');
  assert.ok(!calls[0].url.includes('sb_secret_'));
  assert.equal(calls[0].init.headers.prefer, 'count=exact');
  assert.equal(get.length, 1); // one positional argument: there is no method to pass
});

test('the reader reports a failure without echoing the key', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'nope', headers: { get: () => null } });
  await assert.rejects(makeReader({ url: 'https://p', key: 'sb_secret_k', fetchImpl })('documents?select=id'), (e) => /HTTP 401/.test(e.message) && !e.message.includes('sb_secret_k'));
});

test('ocrPlan prices only the pages not already cached', () => {
  const docs = [{ prefix: 'a', pages: 5 }, { prefix: 'b', pages: 3 }];
  const plan = ocrPlan(docs, { a: new Set([0, 1, 2]) }, 0.004);
  assert.deepEqual(plan.rows.map((r) => [r.prefix, r.cached, r.todo]), [['a', 3, [3, 4]], ['b', 0, [0, 1, 2]]]);
  assert.equal(plan.todoPages, 5);
  assert.ok(Math.abs(plan.usd - 0.02) < 1e-12);
  assert.equal(ocrPlan(docs, { a: new Set([0, 1, 2, 3, 4]), b: new Set([0, 1, 2]) }, 0.004).usd, 0);
});

test('checkSpend stops at the cap, counting what is already spent', () => {
  checkSpend({ spentUsd: 0, pages: 120, usdPerPage: 0.004, maxUsd: 1 });
  checkSpend({ spentUsd: 0.5, pages: 125, usdPerPage: 0.004, maxUsd: 1 }); // exactly the cap
  assert.throws(() => checkSpend({ spentUsd: 0.5, pages: 126, usdPerPage: 0.004, maxUsd: 1 }), /above --max-usd/);
  assert.throws(() => checkSpend({ spentUsd: 0, pages: 120, usdPerPage: 0.004, maxUsd: 0.3 }), /above --max-usd/);
});

test('pageRuns cuts at the call size and at gaps', () => {
  assert.deepEqual(pageRuns([0, 1, 2, 3, 4], 2), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(pageRuns([0, 1, 5, 6], 40), [[0, 1], [5, 6]]);
  assert.deepEqual(pageRuns([], 3), []);
});

const AUTH = 'owner, 2026-11-02: write the F281 batch after the dry run';
function gateFixture() {
  const reviewSha = HEX('5');
  const manifestSha = HEX('1');
  const doc = { prefix: 'abcdef01', id: 'abcdef01-0000-0000-0000-000000000000' };
  return {
    confirm: reviewSha,
    reviewSha,
    manifestSha,
    authorizedBy: AUTH,
    docs: [doc],
    review: { manifest_sha256: manifestSha, documents: { abcdef01: { ok: true, payload_sha256: HEX('2'), text_sha256: HEX('4') } } },
    currentIds: { abcdef01: doc.id },
    payloadShas: { abcdef01: HEX('2') },
    textShas: { abcdef01: HEX('4') },
    dryRuns: { abcdef01: { payload_sha256: HEX('2'), status: 'dry_run' } },
    writtenPayloadShas: {},
    rewrite: new Set(),
  };
}

test('writeGateProblems: passes only when every condition holds', () => {
  assert.deepEqual(writeGateProblems(gateFixture()), []);
  const f = gateFixture();
  f.dryRuns.abcdef01.status = 'unchanged';
  assert.deepEqual(writeGateProblems(f), []);
});

test('writeGateProblems: each way of being wrong is refused', () => {
  const problems = (patch) => writeGateProblems({ ...gateFixture(), ...patch }).join('|');
  assert.match(problems({ confirm: null }), /--confirm .* is required/);
  assert.match(problems({ confirm: 'abc' }), /64-hex/);
  assert.match(problems({ confirm: HEX('9') }), /does not match the reviewed build/);
  assert.match(problems({ review: null }), /run build first/);
  assert.match(problems({ review: { ...gateFixture().review, manifest_sha256: HEX('7') } }), /different manifest/);
  assert.match(problems({ docs: [{ prefix: 'abcdef01', id: null }] }), /no full document id/);
  assert.match(problems({ currentIds: { abcdef01: 'abcdef01-1111-0000-0000-000000000000' } }), /not the row prepare read/);
  assert.match(problems({ review: { ...gateFixture().review, documents: { abcdef01: { ok: false, payload_sha256: HEX('2'), text_sha256: HEX('4') } } } }), /did not pass/);
  assert.match(problems({ payloadShas: { abcdef01: HEX('3') } }), /not the reviewed one/);
  assert.match(problems({ dryRuns: {} }), /no dry run/);
  assert.match(problems({ dryRuns: { abcdef01: { payload_sha256: HEX('3'), status: 'dry_run' } } }), /different payload/);
  assert.match(problems({ dryRuns: { abcdef01: { payload_sha256: HEX('2'), status: 'refused', reason: 'page-aware document' } } }), /refused.*page-aware/);
  assert.match(problems({ dryRuns: { abcdef01: { payload_sha256: HEX('2'), status: 'error', error: 'boom' } } }), /error.*boom/);
});

test('the confirmation binds to the reviewed content (build/review.json), not to the manifest file', () => {
  // The manifest hash alone is no longer a key: a manifest-sha confirm does not open the gate
  assert.match(writeGateProblems({ ...gateFixture(), confirm: gateFixture().manifestSha }).join('|'), /does not match the reviewed build/);
  assert.deepEqual(writeGateProblems({ ...gateFixture(), confirm: HEX('5') }), []);
});

test('write refuses if a payload or a text differs from the review', () => {
  const f = gateFixture();
  assert.match(writeGateProblems({ ...f, payloadShas: { abcdef01: HEX('9') } }).join('|'), /not the reviewed one/);
  assert.match(writeGateProblems({ ...f, textShas: { abcdef01: HEX('9') } }).join('|'), /text.*not the reviewed one/);
  assert.match(writeGateProblems({ ...f, review: { ...f.review, documents: { abcdef01: { ok: true, payload_sha256: HEX('2') } } } }).join('|'), /holds no text_sha256/);
});

test('write refuses to overwrite a document already written with a different payload unless --rewrite names it', () => {
  const f = { ...gateFixture(), writtenPayloadShas: { abcdef01: HEX('8') } };
  assert.match(writeGateProblems(f).join('|'), /already written with a different payload.*--rewrite abcdef01/);
  assert.deepEqual(writeGateProblems({ ...f, rewrite: new Set(['abcdef01']) }), []);
  assert.deepEqual(writeGateProblems({ ...f, writtenPayloadShas: { abcdef01: HEX('2') } }), [], 'the same payload is a resume, not an overwrite');
});

test('write refuses without an authorization line', () => {
  assert.match(writeGateProblems({ ...gateFixture(), authorizedBy: null }).join('|'), /--authorized-by/);
  assert.match(writeGateProblems({ ...gateFixture(), authorizedBy: '   ' }).join('|'), /--authorized-by/);
  assert.match(writeGateProblems({ ...gateFixture(), authorizedBy: 'ok' }).join('|'), /--authorized-by.*who authorized/);
});

test('readbackProblems compares title, key, hash, count, version and indexing', () => {
  const expected = { title: 'T', document_key: 'bill:2005:96', content_sha256: HEX('a'), n_chars: 100, chunk_count: 8, chunker_version: 2 };
  const actual = { title: 'T', document_key: 'bill:2005:96', content_sha256: HEX('a'), n_chars: '100', chunk_count: 8, chunker_version: 2, indexed_at: '2026-11-02T10:00:00Z' };
  assert.deepEqual(readbackProblems(expected, actual), []);
  assert.deepEqual(readbackProblems(expected, actual, { writtenAfter: '2026-11-02T09:00:00Z' }), []);
  assert.match(readbackProblems(expected, { ...actual, title: 'old' }).join('|'), /title/);
  assert.match(readbackProblems(expected, { ...actual, document_key: 'bill:2012:74' }).join('|'), /document_key/);
  assert.match(readbackProblems(expected, { ...actual, content_sha256: HEX('b') }).join('|'), /content_sha256/);
  assert.match(readbackProblems(expected, { ...actual, chunk_count: 3 }).join('|'), /chunk_count/);
  assert.match(readbackProblems(expected, { ...actual, chunker_version: 1 }).join('|'), /chunker_version/);
  assert.match(readbackProblems(expected, { ...actual, indexed_at: null }).join('|'), /not searchable/);
  assert.match(readbackProblems(expected, actual, { writtenAfter: '2026-11-02T11:00:00Z' }).join('|'), /before the write/);
  assert.deepEqual(readbackProblems(expected, null), ['row not found']);
  assert.deepEqual(readbackProblems({ ...expected, document_key: undefined }, { ...actual, document_key: null }), []);
});

test('sha256 and clip', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(clip('  one\n  two  ', 80), 'one two');
  assert.equal(clip('x'.repeat(100), 10).length, 10);
});

test('manifestProblems: each action asks for what it needs, and only the PDF actions need a source', () => {
  const base = { prefix: 'abcdef01', id: null };
  const problems = (d, extra = {}) => manifestProblems({ documents: [{ ...base, ...d }], ...extra }).join('|');
  // reextract is a PDF action
  assert.equal(problems({ action: 'reextract', source_url: 'https://example.org/a.pdf', source_sha256: HEX('a') }), '');
  assert.match(problems({ action: 'reextract' }), /source_url/);
  // an unpinned PDF is allowed (null), a malformed one is not
  assert.equal(problems({ action: 'ocr', pages: 3, ocr_kind: 'any', source_url: 'https://example.org/a.pdf', source_sha256: null }), '');
  assert.match(problems({ action: 'ocr', pages: 3, ocr_kind: 'any', source_url: 'https://example.org/a.pdf', source_sha256: 'zz' }), /source_sha256/);
  // rekey, strip_cover and retitle_unlink read the stored text: no source needed, but a URL given must be https
  assert.equal(problems({ action: 'rekey', new_document_key: 'bill:2005:96', new_title: 'T' }), '');
  assert.equal(problems({ action: 'strip_cover', cover_marker: 'AS INIRODUCED IN' }), '');
  assert.equal(problems({ action: 'retitle_unlink', new_title: 'T' }), '');
  assert.match(problems({ action: 'retitle_unlink' }), /new_title/);
  assert.match(problems({ action: 'rekey', new_document_key: 'bill:2005:96', new_title: 'T', source_url: 'http://x' }), /https/);
  assert.match(problems({ action: 'rekey', new_document_key: 'bill:2005:96', new_title: 'T', new_house: 5 }), /new_house/);
  assert.match(problems({ action: 'ocr', pages: 3, ocr_kind: 'any', source_url: 'https://e.org/a.pdf', source_sha256: null, guard_title: 'yes' }), /guard_title/);
});

test('manifestProblems: after must name another document and may not loop; a key may be used once; exclusions may not overlap', () => {
  const doc = (prefix, extra = {}) => ({ prefix, id: null, action: 'rekey', new_document_key: `bill:2000:${prefix.slice(0, 2).replace(/\D/g, '1')}${prefix.slice(-3)}`, new_title: 'T', ...extra });
  const probs = (documents, extra = {}) => manifestProblems({ documents, ...extra }).join('|');
  assert.equal(probs([doc('aaaaaaa1'), doc('bbbbbbb2', { after: ['aaaaaaa1'] })]), '');
  assert.match(probs([doc('aaaaaaa1', { after: ['cccccccc'] })]), /after.*cccccccc/);
  assert.match(probs([doc('aaaaaaa1', { after: ['aaaaaaa1'] })]), /itself/);
  assert.match(probs([doc('aaaaaaa1', { after: ['bbbbbbb2'] }), doc('bbbbbbb2', { after: ['aaaaaaa1'] })]), /cycle/);
  assert.match(probs([doc('aaaaaaa1'), doc('bbbbbbb2', { new_document_key: doc('aaaaaaa1').new_document_key })]), /same new_document_key/);
  assert.match(probs([doc('aaaaaaa1')], { excluded: [{ ids: ['aaaaaaa1'], reason: 'because of a long reason' }] }), /excluded.*aaaaaaa1/);
  assert.match(probs([doc('aaaaaaa1')], { excluded: [{ ids: ['zz'], reason: 'because of a long reason' }] }), /excluded/);
  assert.match(probs([doc('aaaaaaa1')], { excluded: [{ ids: ['bbbbbbb2'], reason: '' }] }), /reason/);
});

test('orderForWrite puts a document after the ones it names, otherwise keeps the manifest order', () => {
  const docs = [{ prefix: 'aaaaaaaa', after: ['cccccccc'] }, { prefix: 'bbbbbbbb' }, { prefix: 'cccccccc' }];
  assert.deepEqual(orderForWrite(docs).map((d) => d.prefix), ['bbbbbbbb', 'cccccccc', 'aaaaaaaa']);
  assert.deepEqual(orderForWrite(docs.slice(1)).map((d) => d.prefix), ['bbbbbbbb', 'cccccccc']);
  // a dependency outside the selection is not pulled in; dependencyProblems judges it
  assert.deepEqual(orderForWrite([docs[0]]).map((d) => d.prefix), ['aaaaaaaa']);
});

test('dependencyProblems: write refuses out of order', () => {
  const doc = { prefix: 'aaaaaaaa', after: ['cccccccc'] };
  assert.match(dependencyProblems(doc, new Set()).join('|'), /cccccccc.*first/);
  assert.deepEqual(dependencyProblems(doc, new Set(['cccccccc'])), []);
  assert.deepEqual(dependencyProblems({ prefix: 'bbbbbbbb' }, new Set()), []);
});

test('the write gate takes a selection whose dependency was written in an earlier run', () => {
  const f = gateFixture();
  f.docs = [{ ...f.docs[0], after: ['cccccccc'] }];
  assert.match(writeGateProblems({ ...f, written: new Set() }).join('|'), /cccccccc/);
  assert.deepEqual(writeGateProblems({ ...f, written: new Set(['cccccccc']) }), []);
  // inside the selection and ahead of it in the write order is fine
  f.docs = [{ prefix: 'cccccccc', id: 'cccccccc-0000-0000-0000-000000000000' }, { ...f.docs[0], after: ['cccccccc'] }];
  f.currentIds.cccccccc = 'cccccccc-0000-0000-0000-000000000000';
  f.review.documents.cccccccc = { ok: true, payload_sha256: HEX('2'), text_sha256: HEX('4') };
  f.payloadShas.cccccccc = HEX('2');
  f.textShas.cccccccc = HEX('4');
  f.dryRuns.cccccccc = { payload_sha256: HEX('2'), status: 'dry_run' };
  assert.deepEqual(writeGateProblems({ ...f, written: new Set() }), []);
});

test('deskQuery reads desk_rows by document_key, and deskNames takes the bill names the Bill desk shows', () => {
  assert.equal(deskQuery('bill:2005:96'), 'desk_rows?select=tier%2Cfeature%2Crow_key%2Cdocument_key%2Crow&document_key=eq.bill%3A2005%3A96');
  const rows = [
    { feature: 'Bill Passage Probability Index', row: { bill_name: 'The Buy Indian Bill, 2004  ' } },
    { feature: 'Policy Intelligence Graph', row: { bill_name: 'The Buy Indian Bill, 2004' } },
    { feature: 'Bill Passage Probability Index', row: { bill_name: '' } },
    { feature: 'Something Else', row: { title: 'A title column only' } },
  ];
  assert.deepEqual(deskNames(rows), ['The Buy Indian Bill, 2004']);
  assert.deepEqual(deskNames([]), []);
  // two different names under one key (bill:2012:74 held two bills before): both are returned, the caller does not choose
  assert.deepEqual(deskNames([{ row: { bill_name: 'The A Bill, 2000' } }, { row: { bill_name: 'The B Bill, 2000' } }]), ['The A Bill, 2000', 'The B Bill, 2000']);
});

test('readbackProblems also checks the unlink marker when it is expected', () => {
  const expected = { title: 'T', document_key: null, content_sha256: HEX('a'), n_chars: 5, chunk_count: 1, chunker_version: 2, file_url_ambiguous: true };
  const actual = { title: 'T', document_key: null, content_sha256: HEX('a'), n_chars: '5', chunk_count: 1, chunker_version: 2, indexed_at: '2026-11-02T10:00:00Z', file_url_ambiguous: 'true' };
  assert.deepEqual(readbackProblems(expected, actual), []);
  assert.match(readbackProblems(expected, { ...actual, file_url_ambiguous: null }).join('|'), /file_url_ambiguous/);
  assert.match(readbackProblems(expected, { ...actual, document_key: 'bill:2000:75' }).join('|'), /document_key/);
});

// ---------------------------------------------------------------------------------------------
// review.md: every document, riskiest first
// ---------------------------------------------------------------------------------------------
function entry(prefix, over = {}) {
  return {
    prefix, action: 'rekey', ok: true, failed: [], notes: {},
    old: { chars: 1000, title: 'The Old Bill, 2012.', document_key: 'bill:2012:74' },
    new: { chars: 1000, title: 'The New Bill, 2005', document_key: 'bill:2005:96' },
    title_choice: { title: 'The New Bill, 2005', source: 'manifest', agreesWithPrinted: true },
    checks: { title_guard: { ok: true, checked: true, words: ['new'], matched: ['new'], missing: [], reasons: [] } },
    ...over,
  };
}

test('riskOf: a failed check outranks an attention note, which outranks a clean document; OCR outranks a re-key', () => {
  const failed = entry('a', { ok: false, failed: ['title_guard'] });
  const look = entry('b', { notes: { attention: ['numbering does not start at 1'] }, action: 'ocr' });
  const ocrClean = entry('c', { action: 'ocr' });
  const rekeyClean = entry('d');
  const disagree = entry('e', { title_choice: { title: 'x', source: 'manifest', agreesWithPrinted: false } });
  assert.ok(riskOf(failed) > riskOf(look));
  assert.ok(riskOf(look) > riskOf(ocrClean));
  assert.ok(riskOf(ocrClean) > riskOf(rekeyClean));
  assert.ok(riskOf(disagree) > riskOf(rekeyClean));
  assert.ok(riskOf(entry('f', { notes: { desk: { read: true, names: [] } } })) > riskOf(rekeyClean), 'no desk record for the new key');
  assert.ok(riskOf(entry('g', { notes: { desk: { read: true, names: ['The New Bill, 2005'] } } })) <= riskOf(rekeyClean) + 1);
});

test('renderReview lists every document, riskiest first, with titles, keys, counts and the checks', () => {
  const entries = [
    entry('a0000001'),
    entry('f0000001', { ok: false, failed: ['title_guard'], checks: { title_guard: { ok: false, checked: true, words: ['x', 'y'], matched: [], missing: ['x', 'y'], reasons: ['missing_words'] } } }),
    entry('c0000001', {
      action: 'ocr', old: { chars: 9913, title: 'CCI__x', document_key: null }, new: { chars: 90000, title: 'CCI__x', document_key: null },
      title_choice: null,
      checks: { title_guard: { ok: true, skipped: 'regulatory document: the title is a file name' }, ocr: { ok: true, kind: 'cci-order', chars: 90000, pages: 30, charsPerPage: 3000, lowDensity: false, paragraphs: { count: 120, first: '1', last: '8.15', startsAtOne: true, contiguous: true, largeGaps: [] } } },
      notes: { attention: ['numbering has a large gap'] },
    }),
  ];
  const md = renderReview({ manifestSha: HEX('1'), entries, excluded: [{ ids: ['7e43d403'], reason: 'crossed pair, Bills adapter' }] });
  const order = ['f0000001', 'c0000001', 'a0000001'].map((id) => md.indexOf(`\`${id}\``));
  assert.ok(order.every((i) => i > 0), 'all three present');
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'riskiest first');
  assert.match(md, /FAILED/);
  assert.match(md, /The Old Bill, 2012\.[^\n]*The New Bill, 2005/);
  assert.match(md, /bill:2012:74[^\n]*bill:2005:96/);
  assert.match(md, /1,000 chars/);
  assert.match(md, /9,913[^\n]*90,000/);
  assert.match(md, /missing: x, y/);
  assert.match(md, /3,000 characters a page/);
  assert.match(md, /first 1, last 8\.15/);
  assert.match(md, /numbering has a large gap/);
  assert.match(md, /title source: manifest/);
  assert.match(md, /7e43d403/);
  assert.match(md, new RegExp(HEX('1').slice(0, 12)));
});

test('renderReview does not fail on a document that did not build', () => {
  const md = renderReview({ manifestSha: HEX('1'), entries: [{ prefix: 'e0000001', action: 'ocr', ok: false, failed: ['build'], error: 'boom', checks: {}, notes: {}, old: {}, new: {} }], excluded: [] });
  assert.match(md, /e0000001/);
  assert.match(md, /boom/);
});

test('usesPdf and unpinned: the PDF actions read the official file; a null hash is the one not pinned yet', () => {
  const docs = [
    { prefix: 'aaaaaaa1', action: 'ocr', source_sha256: null },
    { prefix: 'bbbbbbb2', action: 'ocr', source_sha256: HEX('a') },
    { prefix: 'ccccccc3', action: 'rekey' },
    { prefix: 'ddddddd4', action: 'rekey', source_sha256: HEX('b') },
    { prefix: 'cccccc33', action: 'strip_cover', source_sha256: HEX('c') },
    { prefix: 'eeeeeee5', action: 'decode', source_sha256: null },
    { prefix: 'fffffff6', action: 'reextract', source_sha256: null },
  ];
  assert.deepEqual(docs.map(usesPdf), [true, true, false, false, false, true, true], 'a hash on a re-key is provenance: no download');
  assert.deepEqual(unpinned(docs).map((d) => d.prefix), ['aaaaaaa1', 'eeeeeee5', 'fffffff6']);
});

test('withPins writes a hash only where the manifest has null, and never replaces a pinned one', () => {
  const raw = { documents: [{ prefix: 'aaaaaaa1', source_sha256: null }, { prefix: 'bbbbbbb2', source_sha256: HEX('a') }] };
  const out = withPins(raw, [{ prefix: 'aaaaaaa1', sha: HEX('c') }]);
  assert.equal(out.documents[0].source_sha256, HEX('c'));
  assert.equal(out.documents[1].source_sha256, HEX('a'));
  assert.equal(raw.documents[0].source_sha256, null, 'the input is not changed');
  assert.throws(() => withPins(raw, [{ prefix: 'bbbbbbb2', sha: HEX('c') }]), /already pinned/);
  assert.throws(() => withPins(raw, [{ prefix: 'cccccccc', sha: HEX('c') }]), /not in the manifest/);
  assert.throws(() => withPins(raw, [{ prefix: 'aaaaaaa1', sha: 'abc' }]), /64 hex/);
});

// ---------------------------------------------------------------------------------------------
// Review findings 2, 3, 5, 7 and the minor items: drift, writer exclusivity, batches, embedding cap, OCR cache,
// snapshot sums, rollback review, readback retries
// ---------------------------------------------------------------------------------------------
const SNAP = { id: 'abcdef01-0000-0000-0000-000000000000', title: 'T', content_sha256: HEX('a'), chunker_version: 2, indexed_at: '2026-09-21T06:32:22.447+00:00', metadata: { b: 2, a: { y: [1, { z: 1, w: 2 }], x: 1 } } };

test('stableJson and metadataHash do not depend on key order', () => {
  assert.equal(stableJson({ b: 1, a: { d: 1, c: [2, 1] } }), stableJson({ a: { c: [2, 1], d: 1 }, b: 1 }));
  assert.notEqual(stableJson({ a: [1, 2] }), stableJson({ a: [2, 1] }), 'array order matters');
  assert.equal(metadataHash({ a: 1, b: 2 }), metadataHash({ b: 2, a: 1 }));
  assert.notEqual(metadataHash({ a: 1 }), metadataHash({ a: 2 }));
});

test('driftProblems: a document that changed since prepare is refused, each way it can change', () => {
  const live = { ...SNAP, metadata: { a: { x: 1, y: [1, { w: 2, z: 1 }] }, b: 2 } };
  assert.deepEqual(driftProblems(SNAP, live), [], 'key order is not a change');
  const diff = (patch) => driftProblems(SNAP, { ...live, ...patch }).join('|');
  assert.match(diff({ content_sha256: HEX('b') }), /content_sha256/);
  assert.match(diff({ title: 'T2' }), /title/);
  assert.match(diff({ metadata: { ...live.metadata, extra: 1 } }), /metadata/);
  assert.match(diff({ chunker_version: 1 }), /chunker_version/);
  assert.match(diff({ indexed_at: '2026-10-01T00:00:00+00:00' }), /indexed_at/);
  assert.match(driftProblems(SNAP, null).join('|'), /not found/);
  assert.match(driftProblems(SNAP, { ...live, id: 'zzzzzzzz-0000-0000-0000-000000000000' }).join('|'), /id/);
});

test('liveClaimProblems: a running job with a live lease is a writer; queued jobs are named, an expired lease is not a claim', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  const job = (status, lease) => ({ id: 'j', document_id: 'd', status, stage: 'ocr', lease_until: lease });
  assert.deepEqual(liveClaimProblems([], now), []);
  assert.match(liveClaimProblems([job('running', '2026-11-02T10:05:00Z')], now).join('|'), /live claim.*running/);
  assert.deepEqual(liveClaimProblems([job('running', '2026-11-02T09:00:00Z')], now), [], 'lease expired');
  assert.match(liveClaimProblems([job('queued', null)], now).join('|'), /1 queued/);
  assert.equal(ingestJobsQuery(), 'ingest_jobs?select=id%2Cdocument_id%2Cstatus%2Cstage%2Clease_until&status=in.%28queued%2Crunning%29');
});

test('lockDecision never removes an active, unknown or foreign-host lock; a dead same-host lock may be reclaimed', () => {
  const me = { host: 'mac', pid: 10 };
  assert.equal(lockDecision(null, me, () => true), 'free');
  assert.equal(lockDecision({ host: 'mac', pid: 99, token: 't' }, me, () => true), 'blocked');
  assert.equal(lockDecision({ host: 'other', pid: 99, token: 't' }, me, () => false), 'blocked');
  assert.equal(lockDecision({ host: 'mac', pid: 99, token: 't' }, me, () => false), 'reclaim');
  assert.equal(lockDecision({ host: 'mac' }, me, () => false), 'blocked', 'unknown pid');
  assert.equal(lockDecision('garbage', me, () => false), 'blocked');
});

test('nextBatch takes the next 20 not yet written, in write order, and says how many remain', () => {
  const docs = Array.from({ length: 45 }, (_, i) => ({ prefix: String(i).padStart(8, '0') }));
  const r = nextBatch(docs, new Set(['00000000', '00000001']), 20);
  assert.equal(r.batch.length, 20);
  assert.equal(r.batch[0].prefix, '00000002');
  assert.equal(r.remaining, 43 - 20);
  assert.deepEqual(nextBatch(docs.slice(0, 3), new Set(['00000000', '00000001', '00000002']), 20), { batch: [], remaining: 0 });
  // dependencies first, as orderForWrite does, then batched
  const dep = [{ prefix: 'aaaaaaaa', after: ['bbbbbbbb'] }, { prefix: 'bbbbbbbb' }];
  assert.deepEqual(nextBatch(dep, new Set(), 1).batch.map((d) => d.prefix), ['bbbbbbbb']);
});

test('embedEstimate prices the chunks the dry run says are new, at the embedding model\'s price', () => {
  const rows = (n, t) => Array.from({ length: n }, () => ({ tokenEstimate: t }));
  const est = embedEstimate([
    { prefix: 'a', rows: rows(10, 300), chunks: 10, inserted: 10 }, // all new: 3000 tokens
    { prefix: 'b', rows: rows(10, 300), chunks: 10, inserted: 4 }, // 40%: 1200
    { prefix: 'c', rows: rows(10, 300), chunks: 10, inserted: 0 }, // metadata only
  ], 0.00000002);
  assert.deepEqual(est.documents.map((d) => d.tokens), [3000, 1200, 0]);
  assert.equal(est.tokens, 4200);
  assert.ok(Math.abs(est.usd - 4200 * 0.00000002) < 1e-12);
});

test('embedCapProblems refuses above --max-embed-usd and says what it would cost', () => {
  assert.deepEqual(embedCapProblems({ usd: 0.04 }, 1), []);
  assert.match(embedCapProblems({ usd: 1.5 }, 1).join('|'), /1\.5000.*above --max-embed-usd 1/);
  assert.deepEqual(embedCapProblems({ usd: 1 }, 1), [], 'exactly the cap');
});

test('the OCR cache is checked at build: source hash, model, request flags, pages, and that it validated', () => {
  const part = (over = {}) => ({ valid: true, source_sha256: HEX('a'), model_requested: OCR_MODEL, flags: OCR_REQUEST_FLAGS, requested: [0, 1], pages: [{ index: 0 }, { index: 1 }], ...over });
  const expected = { sha: HEX('a'), pages: 2 };
  assert.deepEqual(ocrCacheProblems([part()], expected), []);
  const bad = (over, exp = expected) => ocrCacheProblems([part(over)], exp).join('|');
  assert.match(bad({ source_sha256: HEX('b') }), /source_sha256/);
  assert.match(bad({ source_sha256: undefined }), /source_sha256/);
  assert.match(bad({ model_requested: 'mistral-ocr-3' }), /model/);
  assert.match(bad({ flags: { ...OCR_REQUEST_FLAGS, table_format: 'html' } }), /flags/);
  assert.match(bad({ flags: undefined }), /flags/);
  assert.match(bad({ valid: false }), /did not validate/);
  assert.match(ocrCacheProblems([part({ pages: [{ index: 0 }] })], expected).join('|'), /pages/);
  assert.match(ocrCacheProblems([], expected).join('|'), /no cached OCR/);
  assert.match(ocrCacheProblems([part()], { sha: null, pages: 2 }).join('|'), /not pinned/);
});

test('the OCR request flags are the worker\'s, less the two the composition does not read', () => {
  assert.deepEqual(OCR_REQUEST_FLAGS, { table_format: 'markdown', extract_header: true, extract_footer: true, include_blocks: false, include_image_base64: false });
  assert.equal(OCR_MODEL, 'mistral-ocr-4-1');
});

test('spentOnParts counts every response that was paid for, valid or not', () => {
  assert.equal(spentOnParts([{ valid: true, cost_usd: 0.1 }, { valid: false, cost_usd: 0.05 }, { cost_usd: 0.01 }]), 0.16);
  assert.equal(spentOnParts([]), 0);
});

test('snapshot sums: formatted, parsed, and any file that changed or went missing is reported', () => {
  const text = formatSums({ 'bbbbbbbb.json': HEX('2'), 'aaaaaaaa.json': HEX('1') });
  assert.equal(text, `${HEX('1')}  aaaaaaaa.json\n${HEX('2')}  bbbbbbbb.json\n`);
  assert.deepEqual(parseSums(text), { 'aaaaaaaa.json': HEX('1'), 'bbbbbbbb.json': HEX('2') });
  assert.deepEqual(snapshotProblems(parseSums(text), { 'aaaaaaaa.json': HEX('1'), 'bbbbbbbb.json': HEX('2') }, ['aaaaaaaa', 'bbbbbbbb']), []);
  const p = snapshotProblems(parseSums(text), { 'aaaaaaaa.json': HEX('9') }, ['aaaaaaaa', 'bbbbbbbb', 'cccccccc']).join('|');
  assert.match(p, /aaaaaaaa.*changed/);
  assert.match(p, /bbbbbbbb.*missing/);
  assert.match(p, /cccccccc.*no recorded hash/);
  assert.throws(() => parseSums('not a sums line\n'), /sums/);
});

test('retryRead waits for indexed_at a few times and then returns what it has', async () => {
  const waits = [];
  const rows = [{ indexed_at: null }, { indexed_at: null }, { indexed_at: '2026-11-02T10:00:00Z' }];
  let i = 0;
  const got = await retryRead(async () => rows[Math.min(i++, rows.length - 1)], { attempts: 5, delayMs: 7, sleep: async (ms) => waits.push(ms) });
  assert.equal(got.indexed_at, '2026-11-02T10:00:00Z');
  assert.deepEqual(waits, [7, 7]);
  i = 0;
  const never = await retryRead(async () => ({ indexed_at: null }), { attempts: 3, delayMs: 1, sleep: async () => {} });
  assert.equal(never.indexed_at, null);
  assert.equal(await retryRead(async () => null, { attempts: 2, delayMs: 1, sleep: async () => {} }), null);
});

test('readback does not expect indexed_at to move for an unchanged (metadata-only) write', () => {
  const expected = { title: 'T', document_key: null, content_sha256: HEX('a'), n_chars: 5, chunk_count: 1, chunker_version: 2 };
  const actual = { title: 'T', document_key: null, content_sha256: HEX('a'), n_chars: '5', chunk_count: 1, chunker_version: 2, indexed_at: '2026-09-21T06:00:00Z' };
  assert.match(readbackProblems(expected, actual, { writtenAfter: '2026-11-02T10:00:00Z' }).join('|'), /before the write/);
  assert.deepEqual(readbackWrittenAfter({ status: 'unchanged', started_at: '2026-11-02T10:00:00Z' }), null);
  assert.equal(readbackWrittenAfter({ status: 'indexed', started_at: '2026-11-02T10:00:00Z' }), '2026-11-02T10:00:00Z');
  assert.equal(readbackWrittenAfter(null), null);
});

test('an authorization is recorded as a block of review.md, and a second one replaces the first', () => {
  const base = '# review\n\nbody\n';
  const one = withAuthorization(base, { authorizedBy: 'owner A', at: '2026-11-02T10:00:00Z', reviewSha: HEX('5'), batch: 1 });
  assert.match(one, /## Authorization/);
  assert.match(one, /owner A/);
  assert.match(one, new RegExp(HEX('5').slice(0, 12)));
  const two = withAuthorization(one, { authorizedBy: 'owner B', at: '2026-11-02T11:00:00Z', reviewSha: HEX('5'), batch: 2 });
  assert.equal(two.match(/## Authorization/g).length, 1);
  assert.match(two, /owner A[^]*owner B/, 'the earlier lines stay, the block is one');
  assert.ok(two.startsWith(base));
});

test('batch readback records: each batch is logged with its documents and the result', () => {
  const log = addBatch({ batches: [] }, { batch: 1, prefixes: ['a', 'b'], at: 'T', authorizedBy: 'x', ok: true });
  assert.deepEqual(addBatch(log, { batch: 2, prefixes: ['c'], at: 'T2', authorizedBy: 'x', ok: false }).batches.map((b) => [b.batch, b.ok]), [[1, true], [2, false]]);
  assert.equal(nextBatchNumber(log), 2);
  assert.equal(nextBatchNumber({ batches: [] }), 1);
  assert.equal(nextBatchNumber(null), 1);
});

test('renderReview shows what the reviewer asked for: replaced titles, empty OCR pages, font verdicts, the identity check, the authorization', () => {
  const e = entry('b0000001', {
    action: 'ocr',
    title_choice: { title: 'The Desk Title, 2000', source: 'desk_rows', agreesWithPrinted: true, replacesManifest: true, candidates: { manifest: 'The Manifest Title, 2000' } },
    checks: {
      title_guard: { ok: true, skipped: 'regulatory document: the title is a file name' },
      identity: { ok: true, level: 'look', reason: 'the stored text is garbage, so its overlap cannot be measured', firstPageTitle: 'COMPETITION COMMISSION OF INDIA / Case No. 11 of 2009' },
      ocr: { ok: true, kind: 'any', chars: 3000, pages: 3, charsPerPage: 1000, lowDensity: false },
    },
    notes: { attention: ['x'], empty_pages: [2, 5], fonts: [{ font: 'g_d0_f1', verdict: 'plain', chars: 10 }, { font: 'g_d0_f4', verdict: 'shifted', reason: 'control_codes', chars: 99 }, { font: 'g_d0_f6', verdict: 'shifted', reason: 'composite_sibling', chars: 2 }] },
  });
  const md = renderReview({ manifestSha: HEX('1'), entries: [e], excluded: [], authorization: { authorizedBy: 'owner, 2026-11-02', at: '2026-11-02T10:00:00Z', reviewSha: HEX('5') } });
  assert.match(md, /desk title replaces the manifest title `The Manifest Title, 2000`/);
  assert.match(md, /Empty OCR pages: 2, 5/);
  assert.match(md, /Fonts: 1 plain, 2 shifted \(g_d0_f4 control_codes, g_d0_f6 composite_sibling\)/);
  assert.match(md, /Identity against the stored text: LOOK — the stored text is garbage[^\n]*first page reads: COMPETITION COMMISSION OF INDIA/);
  assert.match(md, /## Authorization[^]*owner, 2026-11-02/);
});

test('riskOf: an identity failure, a missing desk record and a replaced manifest title raise the risk', () => {
  const clean = entry('c0000002');
  assert.ok(riskOf(entry('c0000003', { checks: { identity: { ok: false, level: 'fail' } }, ok: false, failed: ['identity'] })) > 1000);
  assert.ok(riskOf(entry('c0000004', { checks: { identity: { ok: true, level: 'look' } } })) > riskOf(clean));
  assert.ok(riskOf(entry('c0000005', { title_choice: { title: 'x', source: 'desk_rows', agreesWithPrinted: true, replacesManifest: true } })) > riskOf(clean));
});

test('manifestProblems: the new fields are checked', () => {
  const base = { prefix: 'abcdef01', id: null, action: 'rekey', new_document_key: 'bill:2005:96', new_title: 'T' };
  const probs = (extra) => manifestProblems({ documents: [{ ...base, ...extra }] }).join('|');
  assert.equal(probs({ reason: 'a reason that says why', allow_missing_desk: true, old_text_garbage: false }), '');
  assert.match(probs({ reason: '' }), /reason/);
  assert.match(probs({ allow_missing_desk: 'yes' }), /allow_missing_desk/);
  assert.match(probs({ old_text_garbage: 1 }), /old_text_garbage/);
  const unlink = (extra) => manifestProblems({ documents: [{ prefix: 'abcdef01', id: null, action: 'retitle_unlink', new_title: 'T', ...extra }] }).join('|');
  assert.equal(unlink({ new_bill_number: 'XXIV', new_bill_year: 2000 }), '');
  assert.match(unlink({ new_bill_number: 'XXIV' }), /new_bill_year/);
  assert.match(unlink({ new_bill_number: 'XXIV', new_bill_year: 'x' }), /new_bill_year/);
});

test('manifestProblems: retitle asks for a title and nothing that would add a key', () => {
  const retitle = (extra = {}) => manifestProblems({ documents: [{ prefix: 'abcdef01', id: null, action: 'retitle', new_title: 'The Right to Information Bill, 2005', ...extra }] }).join('|');
  assert.equal(retitle(), '');
  assert.equal(retitle({ source_url: 'https://example.org/a.pdf', reason: 'the heading is printed in the text' }), '');
  assert.match(retitle({ new_title: ' ' }), /new_title/);
  assert.match(retitle({ new_title: undefined }), /new_title/);
  // re-keying a key-less document is the Bills adapter's job
  assert.match(retitle({ new_document_key: 'bill:2005:96' }), /new_document_key/);
  assert.match(retitle({ new_bill_number: '96', new_bill_year: 2005 }), /new_bill_number/);
  assert.match(retitle({ new_house: 'Lok Sabha' }), /new_house/);
  assert.match(retitle({ new_status: 'Lapsed' }), /new_status/);
  assert.match(retitle({ source_url: 'http://x' }), /https/);
  // unknown action names are still refused
  assert.match(manifestProblems({ documents: [{ prefix: 'abcdef01', id: null, action: 'retitel', new_title: 'T' }] }).join('|'), /action must be one of/);
});

test('riskOf ranks a plain retitle among the lowest and a LOOK above it', () => {
  assert.ok(riskOf({ action: 'retitle', ok: true }) > 0);
  assert.ok(riskOf({ action: 'retitle', ok: true }) < riskOf({ action: 'ocr', ok: true }));
  assert.ok(riskOf({ action: 'retitle', ok: true, notes: { attention: ['x'] } }) > riskOf({ action: 'retitle', ok: true }));
});

const MANIFEST_2 = fileURLToPath(new URL('../../scripts/f281-repair/manifest-2.json', import.meta.url));

describe('the second manifest (suspected stray covers and file-name titles)', () => {
  it('is valid, adds no key, and keeps clear of the first batch', async () => {
    const { manifest } = await loadManifest(MANIFEST_2);
    const first = (await loadManifest(MANIFEST)).manifest;
    const byAction = Object.groupBy(manifest.documents, (d) => d.action);
    assert.deepEqual(Object.keys(byAction).sort(), ['retitle', 'strip_cover']);
    for (const d of manifest.documents) assert.ok(!first.documents.some((x) => x.prefix === d.prefix), `${d.prefix} is in the first manifest`);
    for (const d of manifest.documents) assert.ok(/^[0-9a-f-]{36}$/.test(d.id) && d.id.startsWith(d.prefix), `${d.prefix}: id`);
    for (const d of byAction.retitle) {
      for (const f of ['new_document_key', 'new_bill_number', 'new_bill_year', 'new_house', 'new_status']) assert.equal(d[f], undefined, `${d.prefix} ${f}`);
      assert.match(d.new_title, /^The .+ (Bill|Act), \d{4}$/, d.prefix);
    }
  });

  it('strips exactly the eleven suspected covers that were read, each with a marker of its own', async () => {
    const { manifest } = await loadManifest(MANIFEST_2);
    const strips = manifest.documents.filter((d) => d.action === 'strip_cover');
    assert.deepEqual(strips.map((d) => d.prefix).sort(), ['04cd2c4b', '19e8dd76', '3cbeef80', '548fd359', '6fffba70', '70b72057', '9c83ba9d', 'af83bcf2', 'c2a56a17', 'ea463d40', 'ecf06955']);
    for (const d of strips) assert.ok(d.cover_marker.length >= 8 && d.reason && d.reason.length >= 10, d.prefix);
  });

  it('accounts for the 108 key-less documents: each retitled or excluded with a reason, none twice', async () => {
    const { manifest } = await loadManifest(MANIFEST_2);
    const first = (await loadManifest(MANIFEST)).manifest;
    const keyless = first.excluded.find((e) => e.reason.startsWith('False alarms: no key')).ids;
    assert.equal(keyless.length, 108);
    const retitled = manifest.documents.filter((d) => d.action === 'retitle').map((d) => d.prefix);
    const excluded = manifest.excluded.flatMap((e) => e.ids);
    assert.equal(new Set([...retitled, ...excluded]).size, retitled.length + excluded.length, 'a document is listed twice');
    const stripped = manifest.documents.filter((d) => d.action === 'strip_cover').map((d) => d.prefix);
    const covers = first.excluded.find((e) => e.reason.startsWith('Suspected stray cover')).ids;
    assert.deepEqual([...retitled, ...excluded.filter((id) => keyless.includes(id))].sort(), [...keyless].sort());
    assert.deepEqual([...stripped, ...excluded.filter((id) => covers.includes(id))].sort(), [...covers].sort());
  });
});

test('a filled manifest (ids set, PDFs pinned) is still valid', () => {
  const doc = { prefix: 'abcdef01', id: 'abcdef01-0000-4000-8000-000000000000', action: 'ocr', pages: 3, ocr_kind: 'any', source_url: 'https://example.org/a.pdf', source_sha256: HEX('a') };
  assert.deepEqual(manifestProblems({ documents: [doc] }), []);
});
