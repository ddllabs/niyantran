// The decisions of scripts/f281-repair (lib.mjs): manifest, spend cap, write gate and order, read-back, review.
// Vitest-collected so CI runs it; it was a node:test file before F281 widened the tool.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it, it as test } from 'vitest';
import {
  checkSpend, clip, credentials, dependencyProblems, deskNames, deskQuery, documentQuery, idRange, loadManifest, makeReader, manifestProblems,
  ocrPlan, orderForWrite, pageRuns, parseArgs, readbackProblems, renderReview, riskOf, selectDocuments, sha256, unpinned, usesPdf, withPins, writeGateProblems,
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
const UNLINKED = ['f5ddf657', '0cfda1b0', 'a17e769c', '7268af49', '6f94685d', 'cbd4dbc1', '8bffca18', 'ee462209', '7020ee78', 'afd4f0e8', '8777b653', '1b7862fb', '300194ff', 'b2d4bfff'];
const GARBAGE_OCR_BILLS = ['06dc6288', '0c258b6d', 'e777c56d', '366b1414', '9611101e', '26b571c5'];

describe('the committed manifest', () => {
  it('is valid, and its counts per action are the batch', async () => {
    const { manifest, sha256: sha } = await loadManifest(MANIFEST);
    assert.equal(sha.length, 64);
    const byAction = Object.groupBy(manifest.documents, (d) => d.action);
    assert.deepEqual(Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, v.length])), { decode: 2, reextract: 1, strip_cover: 2, ocr: 51, rekey: 27, retitle_unlink: 14 });
    assert.equal(manifest.documents.length, 97);
    assert.ok(manifest.documents.every((d) => d.id === null), 'ids are filled by the supervisor');
  });

  it('names the documents of each action', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const by = Object.groupBy(manifest.documents, (d) => d.action);
    const ids = (action) => by[action].map((d) => d.prefix).sort();
    assert.deepEqual(ids('decode'), ['1f1ce52a', 'fb64d5ac']);
    assert.deepEqual(ids('reextract'), ['c8289e6b']);
    assert.deepEqual(ids('strip_cover'), ['40b1cec9', '7fd68cf2']);
    assert.deepEqual(ids('retitle_unlink'), [...UNLINKED].sort());
    assert.deepEqual(Object.fromEntries(by.rekey.map((d) => [d.prefix, d.new_document_key])), { ...CLEAN_REKEYS, ...SYNOPSIS_REKEYS, '4530253a': 'bill:2000:76' });
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

  it('pins every OCR, decode and re-extract source except the six Bills whose PDFs were not fetched yet', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const unpinned = manifest.documents.filter((d) => ['ocr', 'decode', 'reextract'].includes(d.action) && !d.source_sha256).map((d) => d.prefix).sort();
    assert.deepEqual(unpinned, [...GARBAGE_OCR_BILLS].sort());
  });

  it('puts 4530253a after 3d51552f, and only that', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    assert.deepEqual(manifest.documents.filter((d) => d.after?.length).map((d) => [d.prefix, d.after]), [['4530253a', ['3d51552f']]]);
  });

  it('gives each re-key a distinct key, a title, and house and status where the listing gave them', async () => {
    const { manifest } = await loadManifest(MANIFEST);
    const rekeys = manifest.documents.filter((d) => d.action === 'rekey');
    assert.equal(new Set(rekeys.map((d) => d.new_document_key)).size, rekeys.length);
    for (const d of rekeys) assert.ok(d.new_title && d.new_house && d.new_status, d.prefix);
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
  assert.equal(a.via, 'data');
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
  assert.throws(() => parseArgs(['ocr', '--via', 'ftp']), /--via/);
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

function gateFixture() {
  const manifestSha = HEX('1');
  const doc = { prefix: 'abcdef01', id: 'abcdef01-0000-0000-0000-000000000000' };
  return {
    confirm: manifestSha,
    manifestSha,
    docs: [doc],
    review: { manifest_sha256: manifestSha, documents: { abcdef01: { ok: true, payload_sha256: HEX('2') } } },
    currentIds: { abcdef01: doc.id },
    payloadShas: { abcdef01: HEX('2') },
    dryRuns: { abcdef01: { payload_sha256: HEX('2'), status: 'dry_run' } },
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
  assert.match(problems({ confirm: HEX('9') }), /does not match the manifest/);
  assert.match(problems({ review: null }), /run build first/);
  assert.match(problems({ review: { ...gateFixture().review, manifest_sha256: HEX('7') } }), /different manifest/);
  assert.match(problems({ docs: [{ prefix: 'abcdef01', id: null }] }), /no full document id/);
  assert.match(problems({ currentIds: { abcdef01: 'abcdef01-1111-0000-0000-000000000000' } }), /not the row prepare read/);
  assert.match(problems({ review: { ...gateFixture().review, documents: { abcdef01: { ok: false, payload_sha256: HEX('2') } } } }), /did not pass/);
  assert.match(problems({ payloadShas: { abcdef01: HEX('3') } }), /not the reviewed one/);
  assert.match(problems({ dryRuns: {} }), /no dry run/);
  assert.match(problems({ dryRuns: { abcdef01: { payload_sha256: HEX('3'), status: 'dry_run' } } }), /different payload/);
  assert.match(problems({ dryRuns: { abcdef01: { payload_sha256: HEX('2'), status: 'refused', reason: 'page-aware document' } } }), /refused.*page-aware/);
  assert.match(problems({ dryRuns: { abcdef01: { payload_sha256: HEX('2'), status: 'error', error: 'boom' } } }), /error.*boom/);
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
  f.review.documents.cccccccc = { ok: true, payload_sha256: HEX('2') };
  f.payloadShas.cccccccc = HEX('2');
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
    { prefix: 'eeeeeee5', action: 'decode', source_sha256: null },
    { prefix: 'fffffff6', action: 'reextract', source_sha256: null },
  ];
  assert.deepEqual(docs.map(usesPdf), [true, true, false, true, true, true]);
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
