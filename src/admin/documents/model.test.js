// The records-first Documents page's decisions (Amendment A of
// docs/specs/2026-10-01-rag-v2-admin-upload.md; plan C4), as pure functions:
// which desks have records, the coverage line, the records request and paging,
// which actions a record, a document and an unlinked document offer, the D6
// source-URL rule, the D3 and key-holder decisions, the upload meta per mode,
// the compare-and-set values, and how a refusal (stale above all) is shown.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, functionsUrl: () => 'http://fn.test/admin-ingest', accessToken: async () => 't' }));

import { UploadError } from '../../lib/corpusUpload.js';
import {
  BILL_DESK,
  DELETE_EXPLANATION,
  LEGACY_WARNING,
  RECORDS_PAGE,
  STALE_TEXT,
  STATUS_CHIPS,
  actionFailure,
  actionOutcome,
  actionPlan,
  anyProcessing,
  confirmText,
  coverageLine,
  deskChoices,
  documentActions,
  documentState,
  draftFor,
  findRecord,
  keyHolderDecision,
  linkExistingRequest,
  linkRequest,
  pageInfo,
  pickerChoices,
  recordActions,
  recordTitle,
  recordsDesk,
  recordsRequest,
  relinkRequest,
  runAction,
  sharedRowsNote,
  sourceUrlError,
  swapRequest,
  unlinkRequest,
  unlinkedActions,
  uploadMeta,
} from './model.js';

const PAIRS = [
  { tier: 'global', feature: 'Treaties' },
  { tier: 'national', feature: 'Bill Passage Probability Index' },
  { tier: 'national', feature: 'Policy Intelligence Graph' },
  { tier: 'national', feature: 'Union Budget' },
];

const HUB = 'https://sansad.in/ls/legislation/bills';
const v2 = (over = {}) => ({ document_id: 'doc-v2', title: 'The Bill, 2025 (PDF)', source_key: 'upload:abc', legacy: false, indexed: true, job: { status: 'succeeded', stage: 'done', error_code: null }, ...over });
const legacy = (over = {}) => ({ document_id: 'doc-legacy', title: 'Legacy text', source_key: 'bill:2025:XLV', legacy: true, indexed: true, job: null, ...over });
const record = (over = {}) => ({
  document_key: 'bill:2025:XLV',
  status: 'record_only',
  rows: [{ row_key: 'r1', title: 'The Bill, 2025', house: 'Lok Sabha', date: '2025-07-01' }],
  source_hint: HUB,
  documents: [],
  ...over,
});

// ─── Desks ───────────────────────────────────────────────────────────────────

describe('the desk picker', () => {
  it('lists the canonical bill desk first, Policy Intelligence Graph as the same records, and every other desk as keyless', () => {
    const choices = deskChoices(PAIRS);
    expect(choices.keyed).toEqual([{ value: 'national|Bill Passage Probability Index', label: 'national · Bill Passage Probability Index' }]);
    expect(choices.aliases).toEqual([{ value: 'national|Policy Intelligence Graph', label: 'national · Policy Intelligence Graph', note: 'same records as Bill Passage' }]);
    expect(choices.keyless.map((c) => c.value)).toEqual(['global|Treaties', 'national|Union Budget']);
  });

  it('routes Policy Intelligence Graph to the bill desk, and marks other desks keyless', () => {
    expect(recordsDesk('national|Policy Intelligence Graph')).toEqual({ ...BILL_DESK, keyed: true, alias: true });
    expect(recordsDesk('national|Bill Passage Probability Index')).toEqual({ ...BILL_DESK, keyed: true, alias: false });
    expect(recordsDesk('national|Union Budget')).toEqual({ tier: 'national', feature: 'Union Budget', keyed: false, alias: false });
    expect(recordsDesk('')).toBeNull();
  });
});

// ─── Coverage, request, paging ──────────────────────────────────────────────

describe('coverageLine', () => {
  it('counts keys, with thousands separators and the orphaned links', () => {
    expect(coverageLine({ keys: 9415, full_text: 1236, orphaned: 2 })).toBe('1,236 of 9,415 bills have full text · 2 orphaned links');
    expect(coverageLine({ keys: 1, full_text: 0, orphaned: 1 })).toBe('0 of 1 bill has full text · 1 orphaned link');
    expect(coverageLine(null)).toBe('');
  });
});

describe('recordsRequest', () => {
  it('sends the canonical desk, the trimmed query, the status chip and the page as an offset of 50', () => {
    expect(RECORDS_PAGE).toBe(50);
    expect(recordsRequest({ desk: BILL_DESK, query: '  finance ', status: 'record_only', page: 2 })).toEqual({
      desk_tier: 'national', desk_feature: 'Bill Passage Probability Index', query: 'finance', status: 'record_only', limit: 50, offset: 100,
    });
  });

  it('sends no status for the "all" chip and no query when blank', () => {
    expect(recordsRequest({ desk: BILL_DESK, query: ' ', status: 'all', page: 0 })).toEqual({
      desk_tier: 'national', desk_feature: 'Bill Passage Probability Index', query: null, status: null, limit: 50, offset: 0,
    });
  });

  it('offers a chip for every record status, after "all"', () => {
    expect(STATUS_CHIPS.map((c) => c.id)).toEqual(['all', 'record_only', 'processing', 'failed', 'full_text', 'full_text_legacy']);
  });
});

describe('pageInfo', () => {
  it('says which records are shown out of the total, and whether there is a previous or next page', () => {
    expect(pageInfo(9415, 0)).toEqual({ text: '1–50 of 9,415', hasPrev: false, hasNext: true });
    expect(pageInfo(9415, 188)).toEqual({ text: '9,401–9,415 of 9,415', hasPrev: true, hasNext: false });
    expect(pageInfo(50, 0)).toEqual({ text: '1–50 of 50', hasPrev: false, hasNext: false });
    expect(pageInfo(0, 0)).toEqual({ text: 'No records', hasPrev: false, hasNext: false });
  });
});

// ─── Records ─────────────────────────────────────────────────────────────────

describe('a record', () => {
  it('takes its title from the first row, falling back to its key', () => {
    expect(recordTitle(record())).toBe('The Bill, 2025');
    expect(recordTitle(record({ rows: [] }))).toBe('bill:2025:XLV');
  });

  it('notes the rows it is shared by, naming each house and title', () => {
    expect(sharedRowsNote(record())).toBeNull();
    const shared = record({ rows: [
      { row_key: 'r1', title: 'The Bill, 2025', house: 'Lok Sabha', date: null },
      { row_key: 'r2', title: 'The Bill, 2025', house: 'Rajya Sabha', date: null },
      { row_key: 'r3', title: 'Other', house: null, date: null },
    ] });
    expect(sharedRowsNote(shared)).toEqual({ text: 'shared by 3 rows', title: 'Lok Sabha: The Bill, 2025\nRajya Sabha: The Bill, 2025\nOther' });
  });

  it('names a document state: live, processing, failed or pending', () => {
    expect(documentState(v2())).toBe('live');
    expect(documentState(v2({ indexed: false, job: { status: 'running', stage: 'ocr', error_code: null } }))).toBe('processing');
    expect(documentState(v2({ indexed: false, job: { status: 'queued', stage: 'ocr', error_code: null } }))).toBe('processing');
    expect(documentState(v2({ indexed: false, job: { status: 'failed', stage: 'ocr', error_code: 'x' } }))).toBe('failed');
    expect(documentState(v2({ indexed: false, job: null }))).toBe('pending');
    expect(documentState(legacy())).toBe('live');
  });
});

describe('recordActions', () => {
  it('offers Attach for record_only, failed and full_text_legacy, with the D3 warning on the last', () => {
    expect(recordActions(record())).toMatchObject({ attach: true, legacyWarning: false, holder: null });
    expect(recordActions(record({ status: 'failed', documents: [v2({ indexed: false, job: { status: 'failed', stage: 'ocr', error_code: 'x' } })] })).attach).toBe(true);
    expect(recordActions(record({ status: 'full_text_legacy', documents: [legacy()] }))).toMatchObject({ attach: true, legacyWarning: true });
    expect(LEGACY_WARNING).toBe('This record already has legacy text; your upload adds a second document, both will be searched.');
  });

  it('does not offer Attach while processing or once ingestion-v2 full text is live', () => {
    expect(recordActions(record({ status: 'processing', documents: [v2({ indexed: false, job: { status: 'running', stage: 'ocr', error_code: null } })] })).attach).toBe(false);
    expect(recordActions(record({ status: 'full_text', documents: [v2()] })).attach).toBe(false);
  });

  it('names the ingestion-v2 holder, never a legacy document', () => {
    expect(recordActions(record({ status: 'full_text', documents: [legacy(), v2()] })).holder.document_id).toBe('doc-v2');
    expect(recordActions(record({ status: 'full_text_legacy', documents: [legacy()] })).holder).toBeNull();
  });
});

describe('documentActions', () => {
  it('leaves a legacy document read-only', () => {
    expect(documentActions(legacy())).toEqual({ replace: false, unlink: false, relink: false, delete: false });
  });

  it('offers Replace, Unlink and Re-link for an ingestion-v2 document, and Delete only for an upload: one', () => {
    expect(documentActions(v2())).toEqual({ replace: true, unlink: true, relink: true, delete: true });
    expect(documentActions(v2({ source_key: 'corpus:r7-bill' }))).toEqual({ replace: true, unlink: true, relink: true, delete: false });
  });
});

describe('unlinkedActions', () => {
  it('offers Link always, Delete only for upload:, and Swap only for a live replacement', () => {
    const doc = (over) => ({ ...v2(), orphaned_key: null, link_target: null, replaces: null, created_at: '2026-10-01T00:00:00Z', ...over });
    expect(unlinkedActions(doc())).toEqual({ link: true, delete: true, swap: false });
    expect(unlinkedActions(doc({ source_key: 'corpus:r7' }))).toEqual({ link: true, delete: false, swap: false });
    expect(unlinkedActions(doc({ link_target: 'bill:2025:XLV', replaces: 'doc-old' })).swap).toBe(true);
    expect(unlinkedActions(doc({ link_target: 'bill:2025:XLV', indexed: false, job: { status: 'running', stage: 'ocr', error_code: null } })).swap).toBe(false);
  });
});

describe('anyProcessing', () => {
  it('is true while a record or a document is processing', () => {
    expect(anyProcessing([record({ status: 'processing' })])).toBe(true);
    expect(anyProcessing([record()])).toBe(false);
    expect(anyProcessing([], [{ ...v2({ indexed: false, job: { status: 'queued', stage: 'ocr', error_code: null } }) }])).toBe(true);
  });
});

describe('pickerChoices', () => {
  it('leaves out the record the document already holds', () => {
    const recs = [record(), record({ document_key: 'bill:2025:XLVI' })];
    expect(pickerChoices(recs, 'bill:2025:XLV').map((r) => r.document_key)).toEqual(['bill:2025:XLVI']);
    expect(pickerChoices(recs, null)).toHaveLength(2);
  });
});

// ─── Compare-and-set requests ───────────────────────────────────────────────

describe('the link requests (D11)', () => {
  it('unlinks expecting the record key', () => {
    expect(unlinkRequest(record(), v2())).toEqual({ document_id: 'doc-v2', expected_key: 'bill:2025:XLV' });
  });

  it('re-links to another record expecting the current key', () => {
    expect(relinkRequest(record(), v2(), record({ document_key: 'bill:2025:XLVI' })))
      .toEqual({ document_id: 'doc-v2', document_key: 'bill:2025:XLVI', expected_key: 'bill:2025:XLV' });
  });

  it('links an unlinked document expecting no key, or its orphaned key', () => {
    const target = record({ document_key: 'bill:2025:XLVI' });
    expect(linkRequest({ document_id: 'd1', orphaned_key: null }, target)).toEqual({ document_id: 'd1', document_key: 'bill:2025:XLVI', expected_key: null });
    expect(linkRequest({ document_id: 'd1', orphaned_key: 'bill:2024:X' }, target)).toEqual({ document_id: 'd1', document_key: 'bill:2025:XLVI', expected_key: 'bill:2024:X' });
  });

  it('swaps expecting the replaced document, or none when the target record has no ingestion-v2 holder any more', () => {
    const doc = { document_id: 'new', link_target: 'bill:2025:XLV', replaces: 'old' };
    expect(swapRequest(doc)).toEqual({ document_id: 'new', expected_old: 'old' });
    expect(swapRequest(doc, record({ documents: [v2({ document_id: 'old' })] }))).toEqual({ document_id: 'new', expected_old: 'old' });
    expect(swapRequest(doc, record({ status: 'full_text_legacy', documents: [legacy()] }))).toEqual({ document_id: 'new', expected_old: null });
    expect(swapRequest({ ...doc, replaces: null })).toEqual({ document_id: 'new', expected_old: null });
  });
});

describe('actionFailure and runAction', () => {
  it('turns a stale refusal into the refreshed notice and asks for a reload', () => {
    expect(STALE_TEXT).toBe('This record changed since you loaded it — refreshed.');
    expect(actionFailure(new UploadError('stale', 'ingest_unlink: stale: expected bill:2025:XLV'))).toEqual({ text: STALE_TEXT, stale: true });
  });

  it('shows any other refusal as written', () => {
    expect(actionFailure(new UploadError('not_deletable', 'Only uploads can be deleted.'))).toEqual({ text: 'Only uploads can be deleted.', stale: false });
    expect(actionFailure(new Error('boom'))).toEqual({ text: 'boom', stale: false });
  });

  it('calls the api method with the request, and never throws', async () => {
    const api = { unlink: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => { throw new UploadError('stale', 'x'); }) };
    await expect(runAction(api, 'unlink', { document_id: 'd', expected_key: 'k' })).resolves.toEqual({ ok: true });
    expect(api.unlink).toHaveBeenCalledWith({ document_id: 'd', expected_key: 'k' });
    await expect(runAction(api, 'remove', { document_id: 'd' })).resolves.toEqual({ ok: false, text: STALE_TEXT, stale: true });
  });

  it('reloads after a change and after a stale refusal (with the notice), and keeps the page on any other refusal', () => {
    expect(actionOutcome({ ok: true })).toEqual({ banner: '', reload: true });
    expect(actionOutcome({ ok: false, text: STALE_TEXT, stale: true })).toEqual({ banner: STALE_TEXT, reload: true });
    expect(actionOutcome({ ok: false, text: 'Only uploads can be deleted.', stale: false })).toEqual({ banner: 'Only uploads can be deleted.', reload: false });
  });
});

// ─── The upload panel ────────────────────────────────────────────────────────

describe('sourceUrlError (D6)', () => {
  const draft = (over) => ({ file_url: '', no_public_source: false, ...over });

  it('requires a URL unless "No public source" is ticked', () => {
    expect(sourceUrlError(draft())).toMatch(/required/);
    expect(sourceUrlError(draft({ no_public_source: true }))).toBeNull();
    expect(sourceUrlError(draft({ file_url: 'https://sansad.in/getFile/bill45.pdf' }))).toBeNull();
  });

  it('refuses an address that is not http(s)', () => {
    expect(sourceUrlError(draft({ file_url: 'ftp://x.example/a.pdf' }))).toMatch(/http/);
  });

  it('refuses the desk’s hub page, however it is spelled', () => {
    expect(sourceUrlError(draft({ file_url: `${HUB}/` }), [HUB])).toMatch(/source page/);
    expect(sourceUrlError(draft({ file_url: 'HTTPS://SANSAD.IN/ls/legislation/bills?x=1' }), [HUB])).toMatch(/source page/);
    expect(sourceUrlError(draft({ file_url: `${HUB}/45.pdf` }), [HUB])).toBeNull();
  });
});

describe('keyHolderDecision', () => {
  it('proceeds when nothing holds the key, or outside attach mode', () => {
    expect(keyHolderDecision(null, 'attach')).toBe('proceed');
    expect(keyHolderDecision({ document_id: 'd', title: 't', legacy: false }, 'standalone')).toBe('proceed');
  });

  it('asks to confirm over a legacy holder (D3), and offers Replace over an ingestion-v2 one', () => {
    expect(keyHolderDecision({ document_id: 'd', title: 't', legacy: true }, 'attach')).toBe('confirm_legacy');
    expect(keyHolderDecision({ document_id: 'd', title: 't', legacy: false }, 'attach')).toBe('offer_replace');
  });
});

describe('draftFor and uploadMeta', () => {
  const PLAN = { file_name: 'bill.pdf' };
  const attach = { mode: 'attach', record: record() };
  const replace = { mode: 'replace', record: record({ status: 'full_text', documents: [v2()] }), holder: v2() };

  it('pre-fills an attach or replace from the record, with the desk fixed', () => {
    expect(draftFor(attach, { name: 'bill.pdf' })).toEqual({ title: 'The Bill, 2025', desk: 'national|Bill Passage Probability Index', file_url: '', no_public_source: false, note: '', splitEvery: '' });
    expect(draftFor(replace, { name: 'bill.pdf' }).desk).toBe('national|Bill Passage Probability Index');
  });

  it('takes a standalone title from the file and the desk from the page', () => {
    expect(draftFor({ mode: 'standalone', desk: 'national|Union Budget' }, { name: 'Budget.pdf' }))
      .toMatchObject({ title: 'Budget', desk: 'national|Union Budget' });
    expect(draftFor({ mode: 'standalone' }, { name: 'Budget.pdf' }).desk).toBe('');
  });

  it('attaches with the record key', () => {
    const draft = { ...draftFor(attach, { name: 'bill.pdf' }), file_url: ' https://x.test/b.pdf ' };
    expect(uploadMeta(draft, PLAN, attach)).toEqual({
      title: 'The Bill, 2025', desk_tier: 'national', desk_feature: 'Bill Passage Probability Index', file_url: 'https://x.test/b.pdf', note: null, file_name: 'bill.pdf', document_key: 'bill:2025:XLV',
    });
  });

  it('replaces with `replaces` and no document_key (D5)', () => {
    const meta = uploadMeta({ ...draftFor(replace, { name: 'bill.pdf' }), no_public_source: true, file_url: 'https://ignored.test/' }, PLAN, replace);
    expect(meta).toMatchObject({ replaces: 'doc-v2', no_public_source: true, file_url: null });
    expect(meta).not.toHaveProperty('document_key');
  });

  it('registers a standalone upload without a key or a replacement', () => {
    const meta = uploadMeta({ title: 'B', desk: 'national|Union Budget', file_url: 'https://x.test/b.pdf', no_public_source: false, note: '', splitEvery: '' }, PLAN, { mode: 'standalone' });
    expect(meta).toEqual({ title: 'B', desk_tier: 'national', desk_feature: 'Union Budget', file_url: 'https://x.test/b.pdf', note: null, file_name: 'bill.pdf' });
  });
});

// ─── Confirmations ───────────────────────────────────────────────────────────

describe('confirmText and actionPlan', () => {
  const rec = record({ status: 'full_text', documents: [v2()] });
  const target = record({ document_key: 'bill:2025:XLVI' });
  const unlinked = { ...v2({ document_id: 'new' }), orphaned_key: null, link_target: 'bill:2025:XLV', replaces: 'doc-v2', created_at: 'x' };

  it('says what each action will do before it is confirmed', () => {
    expect(confirmText({ kind: 'unlink', record: rec, doc: v2() })).toBe('Unlink “The Bill, 2025 (PDF)” from bill:2025:XLV? It stays in the corpus, listed under Documents without a record.');
    expect(confirmText({ kind: 'relink', record: rec, doc: v2(), target })).toBe('Move “The Bill, 2025 (PDF)” from bill:2025:XLV to bill:2025:XLVI (The Bill, 2025)?');
    expect(confirmText({ kind: 'link', doc: unlinked, target })).toBe('Link “The Bill, 2025 (PDF)” to bill:2025:XLVI (The Bill, 2025)?');
    expect(confirmText({ kind: 'swap', doc: unlinked })).toBe('Swap “The Bill, 2025 (PDF)” in for bill:2025:XLV? The document it replaces is unlinked, not deleted.');
    expect(confirmText({ kind: 'delete', doc: v2() })).toBe(`Delete “The Bill, 2025 (PDF)”? ${DELETE_EXPLANATION}`);
  });

  it('maps each confirmed action to its api call and compare-and-set request', () => {
    expect(actionPlan({ kind: 'unlink', record: rec, doc: v2() })).toEqual({ method: 'unlink', request: { document_id: 'doc-v2', expected_key: 'bill:2025:XLV' } });
    expect(actionPlan({ kind: 'relink', record: rec, doc: v2(), target })).toEqual({ method: 'link', request: { document_id: 'doc-v2', document_key: 'bill:2025:XLVI', expected_key: 'bill:2025:XLV' } });
    expect(actionPlan({ kind: 'link', doc: unlinked, target })).toEqual({ method: 'link', request: { document_id: 'new', document_key: 'bill:2025:XLVI', expected_key: null } });
    expect(actionPlan({ kind: 'swap', doc: unlinked })).toEqual({ method: 'swap', request: { document_id: 'new', expected_old: 'doc-v2' } });
    expect(actionPlan({ kind: 'swap', doc: unlinked, targetRecord: record() })).toEqual({ method: 'swap', request: { document_id: 'new', expected_old: null } });
    expect(actionPlan({ kind: 'delete', doc: v2() })).toEqual({ method: 'remove', request: { document_id: 'doc-v2' } });
  });

  it('finds a key’s record by searching the desk, and answers null when it is not found or the search fails', async () => {
    const api = { records: vi.fn(async () => ({ ok: true, records: [record({ document_key: 'bill:2025:XLVI' }), record()], total: 2 })) };
    await expect(findRecord(api, BILL_DESK, 'bill:2025:XLV')).resolves.toMatchObject({ document_key: 'bill:2025:XLV' });
    expect(api.records).toHaveBeenCalledWith({ desk_tier: 'national', desk_feature: 'Bill Passage Probability Index', query: 'bill:2025:XLV', limit: 50 });
    await expect(findRecord(api, BILL_DESK, 'bill:1999:I')).resolves.toBeNull();
    await expect(findRecord({ records: async () => { throw new Error('down'); } }, BILL_DESK, 'k')).resolves.toBeNull();
  });

  it('links an already uploaded file to the attach’s record, expecting no key', () => {
    expect(linkExistingRequest({ kind: 'link', record: record(), document_id: 'doc-old' }))
      .toEqual({ document_id: 'doc-old', document_key: 'bill:2025:XLV', expected_key: null });
  });

  it('explains what Delete removes and that it cannot be undone (D4)', () => {
    expect(DELETE_EXPLANATION).toMatch(/pages, chunks, embeddings and jobs/);
    expect(DELETE_EXPLANATION).toMatch(/cancelled first/);
    expect(DELETE_EXPLANATION).toMatch(/cannot be undone/);
  });
});
