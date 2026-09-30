// B3 of docs/plans/2026-10-01-rag-v2-admin-upload.md: the browser library behind the admin
// Documents tab. Every PDF here is generated in the test (pdf-lib, or hand-written bytes for the
// encrypted ones); nothing touches the network.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import catalog from '../../supabase/functions/_shared/deskCatalog.json';

vi.mock('./supabaseClient.js', () => ({
  supabase: { storage: { from: vi.fn(() => ({ uploadToSignedUrl: vi.fn() })) } },
  accessToken: vi.fn(async () => null),
  functionsUrl: (name) => `https://project.example.test/functions/v1/${name}`,
}));

import {
  MAX_FILE_BYTES,
  MAX_REGISTER_PAGES,
  PART_MAX_BYTES,
  PART_MAX_PAGES,
  USD_PER_1000_PAGES,
  UploadError,
  createAdminIngestApi,
  deskPairs,
  estimateCostUsd,
  inspectPdf,
  planUpload,
  planUploadWith,
  sha256Bytes,
  uploadPlan,
} from './corpusUpload.js';

const SLOW = 60_000;
const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Calls fn and returns the UploadError code it rejects with (or a description of what happened). */
async function codeOf(fn) {
  try {
    await fn();
  } catch (e) {
    return e instanceof UploadError ? e.code : `not an UploadError: ${e?.message}`;
  }
  return 'resolved';
}

/** A PDF whose page i carries an uncompressed content stream of sizes[i] bytes (0 = blank). */
async function buildPdf(sizes) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  let seed = 7;
  for (const size of sizes) {
    const page = doc.addPage([100, 100]);
    if (!size) continue;
    const bytes = new Uint8Array(size);
    bytes[0] = 0x25; // '%': the whole stream is one comment line
    for (let i = 1; i < size - 1; i += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      bytes[i] = 0x21 + ((seed >>> 16) % 94);
    }
    bytes[size - 1] = 0x0a;
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(bytes)));
  }
  return doc;
}
const pdfWith = async (sizes) => (await buildPdf(sizes)).save();
const blankPdf = (pages) => pdfWith(new Array(pages).fill(0));

// ─── Hand-written encrypted PDFs (Standard security handler, RC4 40-bit, revision 2) ──────────
// pdf-lib cannot encrypt and no qpdf/pikepdf is installed, so the test writes the file itself:
// O and U are computed per PDF 1.7 §7.6.3.3-4 (algorithms 3, 2 and 4). The pages carry no strings
// or streams, so nothing else needs encrypting. `userPassword: true` writes a U that the empty
// password cannot match, i.e. a file that needs a password to open.
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
function encryptedPdf({ pages = 3, userPassword = false } = {}) {
  const pad = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
  const O = rc4(md5(pad('owner-secret')).subarray(0, 5), pad(''));
  const P = -4;
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);
  const id = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const key = md5(pad(''), O, pBytes, id).subarray(0, 5);
  const U = userPassword ? Buffer.alloc(32, 7) : rc4(key, PAD);
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'),
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 3 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\n`;
  out += `startxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** Parts are contiguous, in order, hashed and sized correctly, and pdfjs counts each one. */
async function expectWellFormed(plan) {
  let offset = 0;
  for (const [i, part] of plan.parts.entries()) {
    expect(part.part_index).toBe(i);
    expect(part.page_offset).toBe(offset);
    expect(part.byte_size).toBe(part.bytes.byteLength);
    expect(part.sha256).toBe(hex(part.bytes));
    expect((await inspectPdf(part.bytes)).pages).toBe(part.page_count);
    offset += part.page_count;
  }
  expect(offset).toBe(plan.page_count);
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('constants', () => {
  it('match the plan’s fixed interface', () => {
    expect(MAX_FILE_BYTES).toBe(300_000_000);
    expect(PART_MAX_BYTES).toBe(50_000_000);
    expect(PART_MAX_PAGES).toBe(1000);
    expect(USD_PER_1000_PAGES).toBe(4);
    expect(MAX_REGISTER_PAGES).toBe(5000);
  });
});

describe('sha256Bytes', () => {
  it('hashes a Uint8Array and an ArrayBuffer to lowercase hex', async () => {
    const abc = new TextEncoder().encode('abc');
    const want = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Bytes(abc)).toBe(want);
    expect(await sha256Bytes(abc.buffer)).toBe(want);
    expect(await sha256Bytes(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes only the bytes a view covers, not its whole buffer', async () => {
    const view = new TextEncoder().encode('xxabcxx').subarray(2, 5);
    expect(await sha256Bytes(view)).toBe(hex(Buffer.from('abc')));
  });
});

describe('estimateCostUsd', () => {
  it('is $4 per 1,000 pages', () => {
    expect(estimateCostUsd(1000)).toBe(4);
    expect(estimateCostUsd(25)).toBeCloseTo(0.1, 10);
    expect(estimateCostUsd(0)).toBe(0);
  });
});

describe('deskPairs', () => {
  it('lists every catalog (tier, feature) pair once, sorted by tier then feature', () => {
    const pairs = deskPairs();
    const keys = pairs.map((p) => `${p.tier}\u0000${p.feature}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort());
    const want = new Set(catalog.entries.map((e) => `${e.tier}\u0000${e.feature}`));
    expect(new Set(keys)).toEqual(want);
    for (const pair of pairs) expect(Object.keys(pair).sort()).toEqual(['feature', 'tier']);
  });

  it('keeps a feature that exists on two tiers as two pairs', () => {
    const cabinet = deskPairs().filter((p) => p.feature === 'Cabinet Decisions');
    expect(cabinet.length).toBeGreaterThanOrEqual(2);
  });
});

describe('inspectPdf', () => {
  it('counts the pages of a plain PDF', async () => {
    expect(await inspectPdf(await blankPdf(3))).toEqual({ pages: 3, encrypted: false });
  });

  it('flags an owner-password (openable) encrypted PDF and still counts its pages', async () => {
    expect(await inspectPdf(encryptedPdf({ pages: 3 }))).toEqual({ pages: 3, encrypted: true });
  });

  it('leaves the caller’s bytes intact (pdfjs detaches the buffer it is given)', async () => {
    const bytes = await blankPdf(2);
    const before = hex(bytes);
    await inspectPdf(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(hex(bytes)).toBe(before);
  });

  it('refuses a PDF that needs a password to open as unreadable', async () => {
    expect(await codeOf(() => inspectPdf(encryptedPdf({ userPassword: true })))).toBe('unreadable');
  });

  it('refuses a broken PDF as unreadable', async () => {
    expect(await codeOf(() => inspectPdf(new TextEncoder().encode('%PDF-1.4 nothing else')))).toBe('unreadable');
  });
});

describe('planUpload', () => {
  it('refuses a file without %PDF- in its first 1,024 bytes', async () => {
    expect(await codeOf(() => planUpload({ name: 'a.pdf', bytes: new TextEncoder().encode('hello') }))).toBe('not_pdf');

    const pdf = await blankPdf(2);
    const at = (offset) => {
      const bytes = new Uint8Array(offset + pdf.length);
      bytes.fill(0x20, 0, offset);
      bytes.set(pdf, offset);
      return bytes;
    };
    expect(await codeOf(() => planUpload({ name: 'late.pdf', bytes: at(1020) }))).toBe('not_pdf');
    const ok = await planUpload({ name: 'prefixed.pdf', bytes: at(1019) });
    expect(ok.page_count).toBe(2);
  });

  it('refuses a file over the size cap before parsing it', async () => {
    const bytes = await blankPdf(2);
    const plan = planUploadWith({ maxFileBytes: bytes.length });
    expect((await plan({ name: 'x.pdf', bytes })).parts).toHaveLength(1);
    const tight = planUploadWith({ maxFileBytes: bytes.length - 1 });
    expect(await codeOf(() => tight({ name: 'x.pdf', bytes }))).toBe('too_large');
    const junk = new Uint8Array(64);
    expect(await codeOf(() => planUploadWith({ maxFileBytes: 10 })({ name: 'x.pdf', bytes: junk }))).toBe('too_large');
  });

  it('refuses more than 5,000 pages', async () => {
    const bytes = await blankPdf(5001);
    expect(await codeOf(() => planUpload({ name: 'huge.pdf', bytes }))).toBe('too_many_pages');
  }, SLOW);

  it('allows exactly the page cap and refuses one more (test limits)', async () => {
    const plan = planUploadWith({ maxRegisterPages: 3 });
    expect((await plan({ name: 'a.pdf', bytes: await blankPdf(3) })).page_count).toBe(3);
    expect(await codeOf(async () => plan({ name: 'b.pdf', bytes: await blankPdf(4) }))).toBe('too_many_pages');
  });

  it('uploads exactly 1,000 pages unchanged as one part', async () => {
    const bytes = await blankPdf(1000);
    const plan = await planUpload({ name: 'thousand.pdf', bytes });
    expect(plan).toMatchObject({ file_name: 'thousand.pdf', file_sha256: hex(bytes), page_count: 1000, encrypted: false, estimated_usd: 4 });
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({ part_index: 0, page_offset: 0, page_count: 1000, sha256: hex(bytes), byte_size: bytes.length });
    expect(Buffer.from(plan.parts[0].bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(Object.keys(plan.parts[0]).sort()).toEqual(['byte_size', 'bytes', 'page_count', 'page_offset', 'part_index', 'sha256']);
  }, SLOW);

  it('splits 1,001 pages into 1,000 + 1', async () => {
    const bytes = await blankPdf(1001);
    const plan = await planUpload({ name: 'over.pdf', bytes });
    expect(plan.parts.map((p) => [p.page_offset, p.page_count])).toEqual([[0, 1000], [1000, 1]]);
    expect(plan.file_sha256).toBe(hex(bytes));
    await expectWellFormed(plan);
  }, SLOW);

  it('uploads a file of exactly the part byte limit unchanged, and splits one byte over', async () => {
    const bytes = await pdfWith([5000, 5000]);
    const exact = await planUploadWith({ partMaxBytes: bytes.length })({ name: 'x.pdf', bytes });
    expect(exact.parts.map((p) => p.sha256)).toEqual([hex(bytes)]);

    const over = await planUploadWith({ partMaxBytes: bytes.length - 1 })({ name: 'x.pdf', bytes });
    expect(over.parts[0].sha256).not.toBe(hex(bytes));
    for (const part of over.parts) expect(part.byte_size).toBeLessThanOrEqual(bytes.length - 1);
    await expectWellFormed(over);
  });

  it('splits every N pages when asked, even within the limits', async () => {
    const bytes = await blankPdf(25);
    const plan = await planUpload({ name: 'budget.pdf', bytes }, { splitEvery: 10 });
    expect(plan.parts.map((p) => [p.page_offset, p.page_count])).toEqual([[0, 10], [10, 10], [20, 5]]);
    expect(plan.estimated_usd).toBeCloseTo(0.1, 10);
    await expectWellFormed(plan);
  });

  it('halves an oversized part until every part fits, keeping order', async () => {
    const bytes = await pdfWith(new Array(8).fill(10_000));
    const plan = await planUploadWith({ partMaxBytes: 25_000, firstRangeBytes: 1e12 })({ name: 'heavy.pdf', bytes });
    expect(plan.parts.map((p) => [p.page_offset, p.page_count])).toEqual([[0, 2], [2, 2], [4, 2], [6, 2]]);
    for (const part of plan.parts) expect(part.byte_size).toBeLessThanOrEqual(25_000);
    await expectWellFormed(plan);
  });

  it('estimates the first range from the average page size', async () => {
    const bytes = await pdfWith(new Array(6).fill(10_000));
    const perPage = bytes.length / 6;
    const plan = await planUploadWith({ partMaxBytes: 1e9, firstRangeBytes: Math.floor(perPage * 2.5) })({ name: 'x.pdf', bytes }, { splitEvery: 5 });
    expect(plan.parts.map((p) => p.page_count)).toEqual([2, 2, 2]);
  });

  it('refuses a file with a single page over the part limit', async () => {
    const bytes = await pdfWith([1000, 1000, 60_000, 1000]);
    const plan = planUploadWith({ partMaxBytes: 25_000 });
    expect(await codeOf(() => plan({ name: 'poster.pdf', bytes }))).toBe('page_too_large');
  });

  it('drops link annotations so a link to another page cannot drag that page into a part', async () => {
    const doc = await buildPdf([0, 0, 200_000]);
    const [first, , last] = doc.getPages();
    const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], Dest: [last.ref, 'Fit'] });
    first.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));
    const bytes = await doc.save();

    const plan = await planUpload({ name: 'linked.pdf', bytes }, { splitEvery: 1 });
    expect(plan.parts.map((p) => p.page_count)).toEqual([1, 1, 1]);
    expect(plan.parts[0].byte_size).toBeLessThan(20_000);
    expect(plan.parts[2].byte_size).toBeGreaterThan(200_000);
    await expectWellFormed(plan);
  });

  it('splits the same input to the same part hashes, whatever the clock says', async () => {
    const bytes = await pdfWith([3000, 0, 3000, 0, 3000]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = await planUpload({ name: 'x.pdf', bytes }, { splitEvery: 2 });
    vi.setSystemTime(new Date('2027-06-15T13:45:07Z'));
    const second = await planUpload({ name: 'x.pdf', bytes: bytes.slice() }, { splitEvery: 2 });
    expect(first.parts).toHaveLength(3);
    expect(second.parts.map((p) => p.sha256)).toEqual(first.parts.map((p) => p.sha256));
  });

  it('refuses a split whose parts pdfjs does not count as planned, even when the total adds up', async () => {
    // Call 1 inspects the whole file; calls 2 and 3 the two parts. One page "moves" between parts.
    let calls = 0;
    const shift = { 2: 1, 3: -1 };
    const lying = async (b) => {
      const real = await inspectPdf(b);
      calls += 1;
      return { ...real, pages: real.pages + (shift[calls] ?? 0) };
    };
    const plan = planUploadWith({}, { inspectPdf: lying });
    expect(await codeOf(async () => plan({ name: 'x.pdf', bytes: await blankPdf(4) }, { splitEvery: 2 }))).toBe('split_failed');
  });

  it('uploads an encrypted PDF within the limits unchanged', async () => {
    const bytes = encryptedPdf({ pages: 3 });
    const plan = await planUpload({ name: 'locked.pdf', bytes });
    expect(plan).toMatchObject({ encrypted: true, page_count: 3, file_sha256: hex(bytes) });
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].sha256).toBe(hex(bytes));
  });

  it('refuses an encrypted PDF that needs splitting', async () => {
    const bytes = encryptedPdf({ pages: 3 });
    expect(await codeOf(() => planUpload({ name: 'locked.pdf', bytes }, { splitEvery: 1 }))).toBe('encrypted_split');
    expect(await codeOf(() => planUploadWith({ partMaxPages: 2 })({ name: 'locked.pdf', bytes }))).toBe('encrypted_split');
  });

  it('accepts an ArrayBuffer and leaves the input bytes untouched', async () => {
    const bytes = await blankPdf(4);
    const before = hex(bytes);
    const plan = await planUpload({ name: 'x.pdf', bytes: bytes.buffer }, { splitEvery: 3 });
    expect(plan.file_sha256).toBe(before);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(hex(bytes)).toBe(before);
  });
});

// ─── admin-ingest client ─────────────────────────────────────────────────────

function reply(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('createAdminIngestApi', () => {
  it('POSTs {action, ...} with a fresh bearer token on every call', async () => {
    const fetch = vi.fn(async () => reply({ ok: true, documents: [], parts: [] }));
    let n = 0;
    const accessToken = vi.fn(async () => `token-${(n += 1)}`);
    const api = createAdminIngestApi({ fetch, url: 'https://fn.example.test/admin-ingest', accessToken });

    await api.prepare({ file_sha256: 'a'.repeat(64), page_count: 1, parts: [] });
    await api.jobs({ limit: 10, before: '2026-10-01T00:00:00Z' });

    expect(accessToken).toHaveBeenCalledTimes(2);
    const [[url1, init1], [, init2]] = fetch.mock.calls;
    expect(url1).toBe('https://fn.example.test/admin-ingest');
    expect(init1.method).toBe('POST');
    expect(init1.headers.authorization).toBe('Bearer token-1');
    expect(init1.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init1.body)).toEqual({ action: 'prepare', file_sha256: 'a'.repeat(64), page_count: 1, parts: [] });
    expect(init2.headers.authorization).toBe('Bearer token-2');
    expect(JSON.parse(init2.body)).toEqual({ action: 'jobs', limit: 10, before: '2026-10-01T00:00:00Z' });
  });

  it('names every action, and takes an id or an object for retry, cancel and discard', async () => {
    const fetch = vi.fn(async () => reply({ ok: true }));
    const api = createAdminIngestApi({ fetch, url: 'u', accessToken: async () => 't' });
    await api.verify({ staging_path: 'staging/x.pdf', sha256: 's', byte_size: 1 });
    await api.register({ title: 'T' });
    await api.jobs();
    await api.retry('job-1');
    await api.cancel({ job_id: 'job-2' });
    await api.discard('doc-1');
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { action: 'verify', staging_path: 'staging/x.pdf', sha256: 's', byte_size: 1 },
      { action: 'register', title: 'T' },
      { action: 'jobs' },
      { action: 'retry', job_id: 'job-1' },
      { action: 'cancel', job_id: 'job-2' },
      { action: 'discard', document_id: 'doc-1' },
    ]);
  });

  it('defaults to the admin-ingest function URL', async () => {
    const fetch = vi.fn(async () => reply({ ok: true }));
    await createAdminIngestApi({ fetch, accessToken: async () => 't' }).jobs();
    expect(fetch.mock.calls[0][0]).toBe('https://project.example.test/functions/v1/admin-ingest');
  });

  it('throws UploadError(code, error) on ok:false, keeping document_id and the status', async () => {
    const fetch = vi.fn(async () => reply({ ok: false, code: 'already_uploaded', error: 'Already uploaded', document_id: 'doc-9' }, 409));
    const api = createAdminIngestApi({ fetch, url: 'u', accessToken: async () => 't' });
    const err = await api.register({}).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ code: 'already_uploaded', message: 'Already uploaded', document_id: 'doc-9', status: 409 });
  });

  it('maps a response that is not JSON to bad_response', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    const api = createAdminIngestApi({ fetch, url: 'u', accessToken: async () => 't' });
    const err = await api.jobs().catch((e) => e);
    expect(err).toMatchObject({ code: 'bad_response', status: 502 });
  });

  it('maps a network failure to unavailable', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const api = createAdminIngestApi({ fetch, url: 'u', accessToken: async () => 't' });
    expect(await codeOf(() => api.jobs())).toBe('unavailable');
  });

  it('refuses without a session and sends nothing', async () => {
    const fetch = vi.fn();
    const api = createAdminIngestApi({ fetch, url: 'u', accessToken: async () => null });
    expect(await codeOf(() => api.jobs())).toBe('unauthorized');
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── uploadPlan orchestration ────────────────────────────────────────────────

const SHA_FILE = 'f'.repeat(64);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
function samplePlan() {
  return {
    file_name: 'bill.pdf',
    file_sha256: SHA_FILE,
    page_count: 12,
    encrypted: false,
    estimated_usd: 0.048,
    parts: [
      { part_index: 0, page_offset: 0, page_count: 10, sha256: SHA_A, byte_size: 3, bytes: new Uint8Array([1, 2, 3]) },
      { part_index: 1, page_offset: 10, page_count: 2, sha256: SHA_B, byte_size: 2, bytes: new Uint8Array([4, 5]) },
    ],
  };
}
const META = { title: 'The Bill', desk_tier: 'law', desk_feature: 'Bills', file_url: 'https://example.test/bill.pdf', note: 'n' };

function fakes({ documents = [], stored = [true, false], storageError = null } = {}) {
  const api = {
    prepare: vi.fn(async (req) => ({
      ok: true,
      documents,
      parts: req.parts.map((p, i) => (stored[i]
        ? { sha256: p.sha256, stored: true }
        : { sha256: p.sha256, stored: false, staging_path: `staging/0000000${i}-0000-4000-8000-000000000000.pdf`, token: `tok-${i}` })),
    })),
    verify: vi.fn(async (req) => ({ ok: true, stored: true, path: `files/${req.sha256}.pdf` })),
    register: vi.fn(async () => ({ ok: true, document_id: 'doc-1', job_id: 'job-1' })),
  };
  const uploads = [];
  const storage = {
    uploadToSignedUrl: vi.fn(async (path, token, body, options) => {
      uploads.push({ path, token, body, options });
      return storageError ? { data: null, error: storageError } : { data: { path }, error: null };
    }),
  };
  return { api, storage, uploads };
}

describe('uploadPlan', () => {
  it('prepares, uploads only unstored parts as application/pdf, verifies, then registers', async () => {
    const { api, storage, uploads } = fakes();
    const progress = [];
    const result = await uploadPlan(samplePlan(), META, { api, storage, onProgress: (e) => progress.push(e) });

    expect(result).toMatchObject({ document_id: 'doc-1', job_id: 'job-1' });
    expect(api.prepare).toHaveBeenCalledWith({
      file_sha256: SHA_FILE,
      page_count: 12,
      parts: [{ sha256: SHA_A, byte_size: 3, page_count: 10 }, { sha256: SHA_B, byte_size: 2, page_count: 2 }],
    });
    expect(uploads).toHaveLength(1);
    const [upload] = uploads;
    expect(upload.path).toBe('staging/00000001-0000-4000-8000-000000000000.pdf');
    expect(upload.token).toBe('tok-1');
    expect(upload.options).toEqual({ contentType: 'application/pdf' });
    expect(upload.body).toBeInstanceOf(Blob);
    expect(upload.body.type).toBe('application/pdf');
    expect([...new Uint8Array(await upload.body.arrayBuffer())]).toEqual([4, 5]);
    expect(api.verify).toHaveBeenCalledTimes(1);
    expect(api.verify).toHaveBeenCalledWith({ staging_path: upload.path, sha256: SHA_B, byte_size: 2 });
    expect(api.register).toHaveBeenCalledWith({
      file_sha256: SHA_FILE,
      page_count: 12,
      parts: [
        { part_index: 0, page_offset: 0, page_count: 10, sha256: SHA_A, byte_size: 3 },
        { part_index: 1, page_offset: 10, page_count: 2, sha256: SHA_B, byte_size: 2 },
      ],
      title: 'The Bill',
      desk_tier: 'law',
      desk_feature: 'Bills',
      file_url: 'https://example.test/bill.pdf',
      note: 'n',
      file_name: 'bill.pdf',
    });
    expect(progress).toEqual([
      { part_index: 0, state: 'stored' },
      { part_index: 1, state: 'queued' },
      { part_index: 1, state: 'uploading' },
      { part_index: 1, state: 'verifying' },
      { part_index: 1, state: 'stored' },
    ]);
  });

  it('sends null for an empty source URL and note, and defaults the title to the file name', async () => {
    const { api, storage } = fakes({ stored: [true, true] });
    await uploadPlan(samplePlan(), { desk_tier: 'law', desk_feature: 'Bills', file_url: ' ', note: '' }, { api, storage });
    expect(api.register.mock.calls[0][0]).toMatchObject({ title: 'bill.pdf', file_url: null, note: null, file_name: 'bill.pdf' });
    expect(storage.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('stops at an existing upload: document without uploading anything', async () => {
    const existing = { document_id: 'doc-7', source_key: `upload:${SHA_FILE}`, title: 'Old', indexed: true, job_status: 'succeeded' };
    const other = { document_id: 'doc-3', source_key: 'corpus:bill', title: 'Legacy', indexed: true, job_status: null };
    const { api, storage } = fakes({ documents: [other, existing], stored: [false, false] });
    const result = await uploadPlan(samplePlan(), META, { api, storage });
    expect(result).toEqual({ existing });
    expect(storage.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('surfaces documents under another key and still uploads', async () => {
    const other = { document_id: 'doc-3', source_key: 'corpus:bill', title: 'Legacy', indexed: true, job_status: null };
    const { api, storage } = fakes({ documents: [other] });
    const onDuplicates = vi.fn();
    const result = await uploadPlan(samplePlan(), META, { api, storage, onDuplicates });
    expect(onDuplicates).toHaveBeenCalledWith([other]);
    expect(result).toEqual({ document_id: 'doc-1', job_id: 'job-1', duplicates: [other] });
  });

  it('turns a 409 already_uploaded from register into { existing }', async () => {
    const { api, storage } = fakes();
    api.register.mockRejectedValueOnce(new UploadError('already_uploaded', 'Already uploaded', { document_id: 'doc-5', status: 409 }));
    expect(await uploadPlan(samplePlan(), META, { api, storage })).toEqual({ existing: { document_id: 'doc-5' } });
  });

  it('surfaces a Storage failure and does not verify or register', async () => {
    const { api, storage } = fakes({ storageError: { message: 'mime type text/plain is not supported' } });
    const err = await uploadPlan(samplePlan(), META, { api, storage }).catch((e) => e);
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({ code: 'upload_failed', message: expect.stringMatching(/mime type/) });
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('surfaces a verify refusal and does not register', async () => {
    const { api, storage } = fakes();
    api.verify.mockRejectedValueOnce(new UploadError('hash_mismatch', 'The stored bytes do not match'));
    expect(await codeOf(() => uploadPlan(samplePlan(), META, { api, storage }))).toBe('hash_mismatch');
    expect(api.register).not.toHaveBeenCalled();
  });

  it('refuses a prepare answer whose parts do not match the plan', async () => {
    const { api, storage } = fakes();
    api.prepare.mockResolvedValueOnce({ ok: true, documents: [], parts: [{ sha256: SHA_B, stored: true }] });
    expect(await codeOf(() => uploadPlan(samplePlan(), META, { api, storage }))).toBe('bad_response');
    expect(api.register).not.toHaveBeenCalled();
  });
});
