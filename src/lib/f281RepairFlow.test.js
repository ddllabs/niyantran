// The staged flow of scripts/f281-repair/repair.mjs end to end against an in-memory stand-in for NTER: PostgREST
// reads, the ingest_jobs table, and ingest-documents (the real ingestOne, with a stub database). Nothing here touches
// a network: global fetch is replaced for the duration, and the work directory is a temp directory.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestOne, validateDocument } from '../../supabase/functions/ingest-documents/handler.ts';
import { main } from '../../scripts/f281-repair/repair.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const ID = (p) => `${p}-0000-4000-8000-000000000000`;
const AUTH = 'owner, 2026-11-02: write the F281 test batch';

const BILLS = [
  { p: '11111111', old: 'The Old Alpha Bill, 2010', name: 'The Alpha Widget Bill, 2005', key: 'bill:2005:96', words: 'ALPHA WIDGET' },
  { p: '22222222', old: 'The Old Beta Bill, 2011', name: 'The Beta Gadget Bill, 2004', key: 'bill:2004:88', words: 'BETA GADGET' },
  { p: '33333333', old: 'The Old Gamma Bill, 2012', name: 'The Gamma Sprocket Bill, 2003', key: 'bill:2003:12', words: 'GAMMA SPROCKET' },
];
const textOf = (b) => `# THE ${b.words} BILL, ${b.key.split(':')[1]}\n\nA bill to provide for the regulation of ${b.words.toLowerCase()} matters in India.\n\nBe it enacted by Parliament.\n`;

/** NTER in memory: documents, chunk hashes, desk rows, ingest jobs, and a log of what was POSTed. */
function makeNter() {
  const docs = new Map();
  const hashes = new Map();
  for (const b of BILLS) {
    const text = textOf(b);
    docs.set(ID(b.p), {
      id: ID(b.p), title: b.old, file_name: `${b.p}.pdf`, file_url: null, desk_tier: 'national', desk_feature: 'Bill Passage Probability Index', content_sha256: sha(text),
      indexed_at: '2026-09-21T06:00:00.000+00:00', chunker_version: 2, source_key: `${b.p}`.padEnd(40, 'a'), storage_path: null, extract_hash: null, ocr_text: text,
      metadata: { document_key: `bill:2012:${b.p.slice(0, 2)}`, bill_number: b.p.slice(0, 2), bill_year: '2012', house: 'Lok Sabha', status: 'Lapsed', n_chars: text.length, text_sha256: sha(text), as_of: '2026-09-09' },
    });
    hashes.set(ID(b.p), new Set(['stale-hash']));
  }
  const nter = { docs, hashes, jobs: [], desk: Object.fromEntries(BILLS.map((b) => [b.key, [{ tier: 'national', feature: 'Bill Passage Probability Index', row_key: `row-${b.p}`, row: { bill_name: b.name } }]])), posts: [], gets: [] };
  const deps = {
    secretKey: 'x',
    embed: async (inputs) => ({ vectors: inputs.map(() => [0]), promptTokens: inputs.length * 10, costUsd: 0, model: 'stub', requests: 1 }),
    db: {
      findDocument: async (key) => {
        const d = [...docs.values()].find((x) => x.source_key === key);
        return d ? { id: d.id, content_sha256: d.content_sha256, chunker_version: d.chunker_version, metadata: d.metadata, extract_hash: d.extract_hash, storage_path: d.storage_path } : null;
      },
      upsertDocument: async (row) => {
        const d = [...docs.values()].find((x) => x.source_key === row.source_key);
        Object.assign(d, row, { chunker_version: null, indexed_at: null });
        return { id: d.id };
      },
      updateDocumentMeta: async (id, f) => void Object.assign(docs.get(id), f),
      existingHashes: async (id) => new Set(hashes.get(id)),
      chunkCommit: async (id, rows, keep) => {
        const have = hashes.get(id);
        const inserted = rows.filter((r) => !have.has(r.chunk_hash)).length;
        for (const r of rows) have.add(r.chunk_hash);
        for (const h of [...have]) if (!keep.includes(h)) have.delete(h);
        return { inserted, kept: rows.length - inserted, deleted: 0 };
      },
      markIndexed: async (id, v) => void Object.assign(docs.get(id), { chunker_version: v, indexed_at: new Date().toISOString() }),
      logCall: async () => {},
    },
  };
  const json = (rows, extra = {}) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows), headers: { get: (h) => (h === 'content-range' ? extra.range ?? null : null) } });
  nter.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      nter.posts.push({ dry_run: body.dry_run, source_key: body.documents[0].source_key, title: body.documents[0].title });
      const result = await ingestOne(deps, validateDocument(body.documents[0]), body.dry_run === true);
      return json({ results: [result], totals: {} });
    }
    nter.gets.push(u.pathname.split('/').pop());
    const table = u.pathname.split('/rest/v1/')[1];
    const q = u.searchParams;
    if (table === 'ingest_jobs') return json(nter.jobs);
    if (table === 'desk_rows') return json(nter.desk[q.get('document_key').replace('eq.', '')] ?? []);
    if (table === 'document_chunks') {
      const id = q.get('document_id').replace('eq.', '');
      return json([], { range: `0-0/${hashes.get(id)?.size ?? 0}` });
    }
    if (table === 'documents') {
      const ids = q.getAll('id');
      const eq = ids.find((x) => x.startsWith('eq.'))?.slice(3);
      const gte = ids.find((x) => x.startsWith('gte.'))?.slice(4);
      const lte = ids.find((x) => x.startsWith('lte.'))?.slice(4);
      const rows = [...docs.values()].filter((d) => (eq ? d.id === eq : d.id >= gte && d.id <= lte));
      const cols = q.get('select').split(',');
      return json(rows.map((d) => Object.fromEntries(cols.map((c) => {
        const m = /^(\w+):metadata->>(\w+)$/.exec(c);
        return m ? [m[1], d.metadata[m[2]] !== undefined ? String(d.metadata[m[2]]) : null] : [c, d[c]];
      }))));
    }
    throw new Error(`unexpected GET ${url}`);
  };
  return nter;
}

function writeManifest(dir, bills = BILLS, extra = {}) {
  const documents = bills.map((b, i) => ({
    id: ID(b.p), prefix: b.p, label: `test ${b.p}`, action: 'rekey', ...(b.after ? { after: b.after } : {}), new_document_key: b.key, new_title: b.name, new_house: 'Lok Sabha', new_status: 'Lapsed',
    ...(extra[b.p] ?? {}),
  }));
  const file = join(dir, 'manifest.json');
  writeFileSync(file, `${JSON.stringify({ ticket: 'F281', documents }, null, 2)}\n`);
  return file;
}

describe('the staged flow, end to end against a stand-in for NTER', () => {
  let dir;
  let work;
  let manifest;
  let nter;
  let out;
  let log;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'f281-flow-'));
    work = join(dir, 'work');
    process.env.SUPABASE_URL = 'https://stand-in.example.test';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_stand_in';
    nter = makeNter();
    vi.stubGlobal('fetch', nter.fetch);
    out = [];
    log = vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
    manifest = writeManifest(dir);
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  const run = async (argv) => {
    out.length = 0;
    process.exitCode = undefined;
    let error = null;
    try {
      await main([...argv, '--manifest', manifest, '--work-dir', work, '--env', join(dir, 'no.env')], { sleep: async () => {} });
    } catch (e) {
      error = e;
    }
    const code = process.exitCode ?? 0;
    process.exitCode = undefined;
    return { out: out.join('\n'), code, error };
  };
  const reviewSha = () => sha(readFileSync(join(work, 'build', 'review.json')));
  const stage = async () => {
    expect((await run(['prepare', '--rows-only'])).error).toBeNull();
    expect((await run(['build'])).error).toBeNull();
    expect((await run(['dry-run'])).error).toBeNull();
  };
  const write = (extra = []) => run(['write', '--confirm', reviewSha(), '--authorized-by', AUTH, '--max-embed-usd', '1', ...extra]);
  const writes = () => nter.posts.filter((p) => !p.dry_run);

  it('prepare snapshots every row, hashes the snapshots, and reads the desk record of each new key', async () => {
    const r = await run(['prepare', '--rows-only']);
    expect(r.error).toBeNull();
    const sums = readFileSync(join(work, 'current', 'SHA256SUMS'), 'utf8');
    for (const b of BILLS) {
      expect(sums).toContain(`${sha(readFileSync(join(work, 'current', `${b.p}.json`)))}  ${b.p}.json`);
      expect(JSON.parse(readFileSync(join(work, 'current', `${b.p}.json`), 'utf8')).desk.names).toEqual([b.name]);
    }
    expect(nter.posts).toEqual([]);
  });

  it('build refuses a snapshot that changed after prepare', async () => {
    await run(['prepare', '--rows-only']);
    const f = join(work, 'current', '11111111.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('The Old Alpha Bill', 'Tampered'));
    const r = await run(['build']);
    expect(r.error?.message).toMatch(/1 document\(s\) failed/);
    expect(r.out).toMatch(/11111111.*snapshot changed/);
  });

  it('build fails a re-key whose text prints another Bill No. than the new key', async () => {
    const d = nter.docs.get(ID('22222222'));
    d.ocr_text = `Bill No. 5 of 2004\n${d.ocr_text}`;
    d.content_sha256 = sha(d.ocr_text);
    d.metadata.text_sha256 = d.content_sha256;
    d.metadata.n_chars = d.ocr_text.length;
    await run(['prepare', '--rows-only']);
    const r = await run(['build']);
    expect(r.error?.message).toMatch(/1 document\(s\) failed/);
    expect(r.out).toMatch(/22222222[^]*bill_identity: the text prints Bill No\. 5 of 2004, but the bill is No\. 88/);
    expect(JSON.parse(readFileSync(join(work, 'build', '22222222.review.json'), 'utf8')).failed).toEqual(['bill_identity']);
  });

  it('build fails a re-key whose title names an article the opening text does not hold', async () => {
    nter.desk['bill:2003:12'] = []; // no desk name to outrank the manifest title
    manifest = writeManifest(dir, BILLS, { 33333333: { new_title: 'The Gamma Sprocket Bill, 2003 (Insertion of new article 21A)', allow_missing_desk: true, reason: 'a test: the desk holds no record of this key' } });
    await run(['prepare', '--rows-only']);
    const r = await run(['build']);
    expect(r.error?.message).toMatch(/1 document\(s\) failed/);
    expect(JSON.parse(readFileSync(join(work, 'build', '33333333.review.json'), 'utf8')).checks.bill_identity.problems[0]).toMatch(/names article 21A/);
  });

  it('write needs the authorization, and --confirm must name build/review.json, not the manifest', async () => {
    await stage();
    const noAuth = await run(['write', '--confirm', reviewSha()]);
    expect(noAuth.code).toBe(2);
    expect(noAuth.out).toMatch(/--authorized-by/);
    const manifestSha = sha(readFileSync(manifest));
    const wrong = await run(['write', '--confirm', manifestSha, '--authorized-by', AUTH]);
    expect(wrong.code).toBe(2);
    expect(wrong.out).toMatch(/does not match the reviewed build/);
    expect(writes()).toEqual([]);
  });

  it('write refuses a payload that was edited after the review, and a text that differs', async () => {
    await stage();
    const f = join(work, 'build', '22222222.payload.json');
    const p = JSON.parse(readFileSync(f, 'utf8'));
    p.title = 'Something else';
    writeFileSync(f, `${JSON.stringify(p, null, 2)}\n`);
    const r = await write();
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/22222222.*not the reviewed one/);
    expect(writes()).toEqual([]);
  });

  it('writes one batch, reads it back, records authorization and batch, and stops; the next invocation does the next batch', async () => {
    await stage();
    const first = await write(['--batch', '2']);
    expect(first.error).toBeNull();
    expect(writes().map((p) => p.title)).toEqual(['The Alpha Widget Bill, 2005', 'The Beta Gadget Bill, 2004']);
    expect(first.out).toMatch(/Batch 1 written \(2\)/);
    expect(first.out).toMatch(/Batch 1 is clean\. 1 document\(s\) remain/);
    expect(nter.docs.get(ID('11111111')).metadata.document_key).toBe('bill:2005:96');
    expect(nter.docs.get(ID('33333333')).title).toBe('The Old Gamma Bill, 2012'); // not yet
    const batches = JSON.parse(readFileSync(join(work, 'write', 'batches.json'), 'utf8')).batches;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ batch: 1, authorized_by: AUTH, readback_ok: true, written: ['11111111', '22222222'] });
    expect(existsSync(join(work, 'readback', 'batch-1.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(work, 'write', 'authorization.json'), 'utf8')).entries[0].authorized_by).toBe(AUTH);
    expect(readFileSync(join(work, 'build', 'review.md'), 'utf8')).toMatch(/## Authorization[^]*owner, 2026-11-02/);

    const second = await write(['--batch', '2']);
    expect(second.error).toBeNull();
    expect(second.out).toMatch(/Batch 2 written \(1\)/);
    expect(nter.docs.get(ID('33333333')).title).toBe('The Gamma Sprocket Bill, 2003');
    expect(JSON.parse(readFileSync(join(work, 'write', 'batches.json'), 'utf8')).batches).toHaveLength(2);
    const third = await write(['--batch', '2']);
    expect(third.out).toMatch(/Nothing left to write/);
    expect(writes()).toHaveLength(3);
  });

  it('writes a document after the one it names, even when the manifest lists it first', async () => {
    const bills = [{ ...BILLS[0], after: ['22222222'] }, BILLS[1], BILLS[2]];
    manifest = writeManifest(dir, bills);
    await stage();
    const r = await write(['--batch', '1']);
    expect(r.error).toBeNull();
    expect(writes().map((p) => p.title)).toEqual(['The Beta Gadget Bill, 2004']);
    const only = await run(['write', '--only', '11111111', '--confirm', reviewSha(), '--authorized-by', AUTH]);
    expect(only.error).toBeNull(); // 22222222 was written in the earlier run: the dependency holds
  });

  it('refuses to write 11111111 on its own while the document it must follow is not written', async () => {
    const bills = [{ ...BILLS[0], after: ['22222222'] }, BILLS[1], BILLS[2]];
    manifest = writeManifest(dir, bills);
    await stage();
    const r = await run(['write', '--only', '11111111', '--confirm', reviewSha(), '--authorized-by', AUTH]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/22222222 must be written first/);
    expect(writes()).toEqual([]);
  });

  it('refuses a document whose row changed since prepare, and writes the others of the batch', async () => {
    await stage();
    nter.docs.get(ID('22222222')).title = 'Edited by someone else';
    const r = await write(['--batch', '3']);
    expect(r.error?.message).toMatch(/1 document\(s\) refused for drift/);
    expect(r.out).toMatch(/REFUSED\s+22222222.*title changed since prepare/);
    expect(writes().map((p) => p.title)).toEqual(['The Alpha Widget Bill, 2005', 'The Gamma Sprocket Bill, 2003']);
    expect(nter.docs.get(ID('22222222')).title).toBe('Edited by someone else');
  });

  it('dry-run refuses a drifted row too, and records it', async () => {
    await run(['prepare', '--rows-only']);
    await run(['build']);
    nter.docs.get(ID('11111111')).metadata.status = 'Pending';
    const r = await run(['dry-run']);
    expect(r.error?.message).toMatch(/did not dry-run cleanly/);
    expect(r.out).toMatch(/DRIFT\s+11111111.*metadata changed/);
    expect(JSON.parse(readFileSync(join(work, 'dryrun', '11111111.json'), 'utf8')).status).toBe('drift');
  });

  it('write refuses to start while an ingestion job holds a live claim, or one is queued', async () => {
    await stage();
    nter.jobs = [{ id: 'j1', document_id: 'd', status: 'running', stage: 'ocr', lease_until: new Date(Date.now() + 60_000).toISOString() }];
    const r = await write();
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/live claim/);
    nter.jobs = [{ id: 'j2', document_id: 'd', status: 'queued', stage: 'ocr', lease_until: null }];
    expect((await write()).out).toMatch(/1 queued/);
    expect(writes()).toEqual([]);
    nter.jobs = [];
    expect((await write()).error).toBeNull();
  });

  it('prints the expected embedding cost and refuses above --max-embed-usd', async () => {
    // At the current chunker version a re-key is metadata only; at an older one every chunk is embedded again.
    for (const d of nter.docs.values()) d.chunker_version = 1;
    await stage();
    const r = await run(['write', '--confirm', reviewSha(), '--authorized-by', AUTH, '--max-embed-usd', '0.0000000001']);
    expect(r.out).toMatch(/Expected embedding cost of this batch: \d+ tokens, USD \d\.\d{4}/);
    expect(r.out).toMatch(/above --max-embed-usd/);
    expect(r.code).toBe(2);
    expect(writes()).toEqual([]);
  });

  it('refuses a second write lock on the same work directory, and never removes a foreign one', async () => {
    await stage();
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, 'write.lock'), JSON.stringify({ host: 'some-other-host', pid: 1, token: 't', at: 'x' }));
    const r = await write();
    expect(r.error?.message).toMatch(/another write holds/);
    expect(existsSync(join(work, 'write.lock'))).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('does not overwrite a document written with another payload unless --rewrite names it', async () => {
    await stage();
    expect((await write(['--batch', '3'])).error).toBeNull();
    // the manifest changes a status (a changed title would not do: the desk name outranks it): build and dry-run again; the review changes, so --confirm does too
    manifest = writeManifest(dir, BILLS, { 22222222: { new_status: 'Pending' } });
    expect((await run(['build'])).error).toBeNull(); // from the snapshot prepare took before any write
    expect((await run(['dry-run'])).error).toBeNull();
    const refused = await write();
    expect(refused.code).toBe(2);
    expect(refused.out).toMatch(/22222222: already written with a different payload; name it with --rewrite 22222222/);
    const done = await write(['--rewrite', '22222222']);
    expect(done.error).toBeNull();
    expect(nter.docs.get(ID('22222222')).metadata.status).toBe('Pending');
  });

  it('rollback-build restores every document from the snapshots, and write --rollback posts it', async () => {
    await stage();
    expect((await write(['--batch', '3'])).error).toBeNull();
    expect(nter.docs.get(ID('11111111')).title).toBe('The Alpha Widget Bill, 2005');
    const b = await run(['rollback-build']);
    expect(b.error).toBeNull();
    expect(b.out).toMatch(/restores The Old Alpha Bill, 2010 {2}key=bill:2012:11/);
    expect((await run(['dry-run', '--rollback'])).error).toBeNull();
    const rollbackSha = sha(readFileSync(join(work, 'rollback', 'review.json')));
    const r = await run(['write', '--rollback', '--confirm', rollbackSha, '--authorized-by', AUTH, '--batch', '3']);
    expect(r.error).toBeNull();
    for (const bill of BILLS) {
      const d = nter.docs.get(ID(bill.p));
      expect(d.title).toBe(bill.old);
      expect(d.metadata.document_key).toBe(`bill:2012:${bill.p.slice(0, 2)}`);
      expect(d.metadata.bill_year).toBe('2012');
      expect(d.ocr_text).toBe(textOf(bill));
    }
  });
});
