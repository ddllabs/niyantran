// The records-first Documents page's pieces (Amendment A; plan C4), with the
// documentsPage.test.jsx technique: renderToStaticMarkup for markup, and a walk
// of the element tree to press buttons. The admin-ingest client is a stub, so
// nothing here touches the network.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, functionsUrl: () => 'http://fn.test/admin-ingest', accessToken: async () => 't' }));

import { UploadError } from '../../lib/corpusUpload.js';
import { DELETE_EXPLANATION, LEGACY_WARNING } from './model.js';
import { CoverageLine, DeskPicker, Pager, RecordPicker, RecordsSection, RecordsTable, StatusChips } from './records.jsx';
import { UnlinkedSection, UnlinkedTable } from './unlinked.jsx';
import { KeyHolderWarning, ResultLine, UploadForm, UploadTarget, askKeyHolder, describeResult, uploadFile, validateDraft } from './upload.jsx';

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = find(child, predicate); if (hit) return hit; }
    return null;
  }
  if (predicate(node)) return node;
  if (typeof node.type === 'function') return find(node.type(node.props), predicate);
  return find(node.props?.children, predicate);
}
const textOf = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node.type === 'function') return textOf(node.type(node.props));
  return textOf(node.props?.children);
};
const button = (tree, label) => find(tree, (n) => n.type === 'button' && textOf(n) === label);
const buttonTag = (markup, label) => markup.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? null;
const section = (markup, attr, id) => {
  const start = markup.indexOf(`${attr}="${id}"`);
  return start < 0 ? '' : markup.slice(start, markup.indexOf('</tr>', start));
};

const PAIRS = [
  { tier: 'global', feature: 'Treaties' },
  { tier: 'national', feature: 'Bill Passage Probability Index' },
  { tier: 'national', feature: 'Policy Intelligence Graph' },
  { tier: 'national', feature: 'Union Budget' },
];
const HUB = 'https://sansad.in/ls/legislation/bills';
const v2 = (over = {}) => ({ document_id: 'doc-v2', title: 'Bill PDF', source_key: 'upload:abc', legacy: false, indexed: true, job: { status: 'succeeded', stage: 'done', error_code: null }, ...over });
const legacy = (over = {}) => ({ document_id: 'doc-legacy', title: 'Legacy text', source_key: 'bill:2024:XX', legacy: true, indexed: true, job: null, ...over });
const record = (over = {}) => ({
  document_key: 'bill:2025:XLV',
  status: 'record_only',
  rows: [{ row_key: 'r1', title: 'The Bill, 2025', house: 'Lok Sabha', date: '2025-07-01' }],
  source_hint: HUB,
  documents: [],
  ...over,
});
const RECORDS = [
  record(),
  record({ document_key: 'bill:2024:XX', status: 'full_text_legacy', documents: [legacy()], rows: [
    { row_key: 'r2', title: 'Old Bill', house: 'Lok Sabha', date: '2024-01-01' },
    { row_key: 'r3', title: 'Old Bill', house: 'Rajya Sabha', date: '2024-01-01' },
  ] }),
  record({ document_key: 'bill:2025:L', status: 'full_text', documents: [v2()] }),
  record({ document_key: 'bill:2025:LI', status: 'full_text', documents: [v2({ document_id: 'doc-r7', source_key: 'corpus:r7' })] }),
  record({ document_key: 'bill:2025:LII', status: 'processing', documents: [v2({ document_id: 'doc-run', indexed: false, job: { status: 'running', stage: 'ocr', error_code: null } })] }),
];

beforeEach(() => vi.clearAllMocks());

// ─── The records view ────────────────────────────────────────────────────────

describe('DeskPicker', () => {
  it('lists the bill desk first, Policy Intelligence Graph as the same records, and keyless desks as standalone only', () => {
    const markup = renderToStaticMarkup(createElement(DeskPicker, { value: 'national|Bill Passage Probability Index', pairs: PAIRS, onChange: () => {} }));
    expect(markup.indexOf('Bill Passage Probability Index')).toBeLessThan(markup.indexOf('Policy Intelligence Graph'));
    expect(markup).toContain('national · Policy Intelligence Graph — same records as Bill Passage');
    expect(markup).toContain('<optgroup label="No record keys yet — standalone uploads only"><option value="global|Treaties">global · Treaties</option><option value="national|Union Budget">national · Union Budget</option></optgroup>');
  });
});

describe('CoverageLine, StatusChips and Pager', () => {
  it('shows the coverage in keys', () => {
    expect(renderToStaticMarkup(createElement(CoverageLine, { coverage: { keys: 9415, full_text: 1236, orphaned: 0 } })))
      .toContain('1,236 of 9,415 bills have full text · 0 orphaned links');
  });

  it('marks the chosen status chip and reports a choice', () => {
    const onChange = vi.fn();
    const markup = renderToStaticMarkup(createElement(StatusChips, { status: 'failed', onChange }));
    expect(markup).toMatch(/class="adm-chip on"[^>]*aria-pressed="true"[^>]*>Failed</);
    button(StatusChips({ status: 'all', onChange }), 'Record only').props.onClick();
    expect(onChange).toHaveBeenCalledWith('record_only');
  });

  it('pages by 50 with the total, disabling Prev on the first page and Next on the last', () => {
    const first = renderToStaticMarkup(createElement(Pager, { total: 120, page: 0, onPage: () => {} }));
    expect(first).toContain('1–50 of 120');
    expect(buttonTag(first, 'Prev')).toContain('disabled=""');
    expect(buttonTag(first, 'Next')).not.toContain('disabled');
    const last = renderToStaticMarkup(createElement(Pager, { total: 120, page: 2, onPage: () => {} }));
    expect(last).toContain('101–120 of 120');
    expect(buttonTag(last, 'Next')).toContain('disabled=""');
    const onPage = vi.fn();
    button(Pager({ total: 120, page: 1, onPage }), 'Next').props.onClick();
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('RecordsTable', () => {
  const props = (over = {}) => ({
    records: RECORDS, busyId: null, uploading: false, confirm: null, picking: null, renderPicker: () => null,
    onAttach: vi.fn(), onReplace: vi.fn(), onAsk: vi.fn(), onRelink: vi.fn(), onConfirm: vi.fn(), onKeep: vi.fn(), ...over,
  });
  const html = (over) => renderToStaticMarkup(createElement(RecordsTable, props(over)));
  const has = (markup, key, label) => Boolean(buttonTag(section(markup, 'data-record', key), label));

  it('shows each record’s title, key, date and status', () => {
    const row = section(html(), 'data-record', 'bill:2025:XLV');
    expect(row).toContain('The Bill, 2025');
    expect(row).toContain('bill:2025:XLV · 2025-07-01');
    expect(row).toContain('Record only');
    expect(row).toContain('No documents');
  });

  it('notes a record shared by several rows, naming them in a title', () => {
    const row = section(html(), 'data-record', 'bill:2024:XX');
    expect(row).toContain('shared by 2 rows');
    expect(row).toContain('title="Lok Sabha: Old Bill\nRajya Sabha: Old Bill"');
  });

  it('offers Attach PDF only where it applies, with the D3 warning on legacy text', () => {
    const markup = html();
    expect(has(markup, 'bill:2025:XLV', 'Attach PDF')).toBe(true);
    expect(has(markup, 'bill:2024:XX', 'Attach PDF')).toBe(true);
    expect(section(markup, 'data-record', 'bill:2024:XX')).toContain(LEGACY_WARNING);
    expect(section(markup, 'data-record', 'bill:2025:XLV')).not.toContain(LEGACY_WARNING);
    expect(has(markup, 'bill:2025:L', 'Attach PDF')).toBe(false);
    expect(has(markup, 'bill:2025:LII', 'Attach PDF')).toBe(false);
  });

  it('tags legacy text read-only, with no actions', () => {
    const row = section(html(), 'data-record', 'bill:2024:XX');
    expect(row).toContain('legacy');
    for (const label of ['Replace', 'Unlink', 'Re-link', 'Delete']) expect(buttonTag(row, label)).toBeNull();
  });

  it('offers Replace, Unlink and Re-link on an ingestion-v2 document, and Delete only on an upload', () => {
    const markup = html();
    expect(['Replace', 'Unlink', 'Re-link', 'Delete'].map((l) => has(markup, 'bill:2025:L', l))).toEqual([true, true, true, true]);
    expect(['Replace', 'Unlink', 'Re-link', 'Delete'].map((l) => has(markup, 'bill:2025:LI', l))).toEqual([true, true, true, false]);
    expect(section(markup, 'data-record', 'bill:2025:LII')).toContain('processing');
  });

  it('hands each action to its callback; destructive ones only ask', () => {
    const p = props();
    const tree = RecordsTable(p);
    const row = (key) => find(tree, (n) => n.type === 'tr' && n.key === key);
    button(row('bill:2025:XLV'), 'Attach PDF').props.onClick();
    expect(p.onAttach).toHaveBeenCalledWith(RECORDS[0]);
    button(row('bill:2025:L'), 'Replace').props.onClick();
    expect(p.onReplace).toHaveBeenCalledWith(RECORDS[2], RECORDS[2].documents[0]);
    button(row('bill:2025:L'), 'Unlink').props.onClick();
    expect(p.onAsk).toHaveBeenCalledWith({ kind: 'unlink', record: RECORDS[2], doc: RECORDS[2].documents[0] });
    button(row('bill:2025:L'), 'Delete').props.onClick();
    expect(p.onAsk).toHaveBeenCalledWith({ kind: 'delete', record: RECORDS[2], doc: RECORDS[2].documents[0] });
    button(row('bill:2025:L'), 'Re-link').props.onClick();
    expect(p.onRelink).toHaveBeenCalledWith(RECORDS[2], RECORDS[2].documents[0]);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('confirms in the page, with what the action will do', () => {
    const confirm = { kind: 'delete', record: RECORDS[2], doc: RECORDS[2].documents[0] };
    const p = props({ confirm });
    const row = section(renderToStaticMarkup(createElement(RecordsTable, p)), 'data-record', 'bill:2025:L');
    expect(row).toContain(DELETE_EXPLANATION);
    expect(buttonTag(row, 'Replace')).toBeNull();
    const tree = RecordsTable(p);
    button(tree, 'Confirm delete').props.onClick();
    button(tree, 'Keep').props.onClick();
    expect(p.onConfirm).toHaveBeenCalledWith(confirm);
    expect(p.onKeep).toHaveBeenCalledOnce();
  });

  it('shows the record picker in place while re-linking', () => {
    const markup = html({ picking: { record: RECORDS[2], doc: RECORDS[2].documents[0] }, renderPicker: () => createElement('div', { className: 'picker-here' }) });
    expect(section(markup, 'data-record', 'bill:2025:L')).toContain('picker-here');
  });

  it('disables a busy document’s buttons, and Attach while a file uploads', () => {
    const markup = html({ busyId: 'doc-v2', uploading: true });
    expect(buttonTag(section(markup, 'data-record', 'bill:2025:L'), 'Unlink')).toContain('disabled=""');
    expect(buttonTag(section(markup, 'data-record', 'bill:2025:XLV'), 'Attach PDF')).toContain('disabled=""');
  });

  it('says so when no record matches', () => {
    expect(html({ records: [] })).toContain('No records match.');
  });
});

describe('RecordsSection and RecordPicker', () => {
  it('starts loading the desk’s records, with the search box and chips', () => {
    const api = { records: vi.fn(() => new Promise(() => {})) };
    const markup = renderToStaticMarkup(createElement(RecordsSection, { api, desk: { tier: 'national', feature: 'Bill Passage Probability Index', keyed: true, alias: false } }));
    expect(markup).toContain('Loading records…');
    expect(markup).toMatch(/<input[^>]*class="adm-search"[^>]*placeholder="Search bills by title or number"/);
    expect(markup).toContain('>Full text (legacy)<');
    expect(markup).not.toContain('role="alert"');
  });

  it('says when Policy Intelligence Graph was routed to the bill desk', () => {
    const markup = renderToStaticMarkup(createElement(RecordsSection, { api: { records: vi.fn() }, desk: { tier: 'national', feature: 'Bill Passage Probability Index', keyed: true, alias: true } }));
    expect(markup).toContain('Policy Intelligence Graph holds the same records as Bill Passage Probability Index; they are shown here.');
  });

  it('opens a record search for picking a link target', () => {
    const markup = renderToStaticMarkup(createElement(RecordPicker, { api: { records: vi.fn() }, desk: { tier: 'national', feature: 'Bill Passage Probability Index' }, excludeKey: 'k', onPick: () => {}, onCancel: () => {} }));
    expect(markup).toMatch(/<input[^>]*aria-label="Search for the record to link to"/);
    expect(buttonTag(markup, 'Cancel')).toBeTruthy();
  });
});

// ─── Documents without a record ──────────────────────────────────────────────

const unlinked = (over = {}) => ({ ...v2(), orphaned_key: null, link_target: null, replaces: null, created_at: '2026-10-01T10:00:00Z', ...over });
const UNLINKED = [
  unlinked({ document_id: 'u-plain', title: 'Budget at a Glance' }),
  unlinked({ document_id: 'u-orphan', orphaned_key: 'bill:2023:IX' }),
  unlinked({ document_id: 'u-repl', link_target: 'bill:2025:L', replaces: 'doc-v2' }),
  unlinked({ document_id: 'u-repl-run', link_target: 'bill:2025:L', replaces: 'doc-v2', indexed: false, job: { status: 'running', stage: 'ocr', error_code: null } }),
  unlinked({ document_id: 'u-r7', source_key: 'corpus:r7' }),
];

describe('UnlinkedTable', () => {
  const props = (over = {}) => ({ documents: UNLINKED, busyId: null, confirm: null, picking: null, renderPicker: () => null, onAsk: vi.fn(), onLink: vi.fn(), onConfirm: vi.fn(), onKeep: vi.fn(), ...over });
  const html = (over) => renderToStaticMarkup(createElement(UnlinkedTable, props(over)));
  const has = (markup, id, label) => Boolean(buttonTag(section(markup, 'data-doc', id), label));

  it('shows the title, state, orphaned key, link target and the document replaced', () => {
    const markup = html();
    expect(section(markup, 'data-doc', 'u-plain')).toContain('Budget at a Glance');
    expect(section(markup, 'data-doc', 'u-plain')).toContain('live');
    expect(section(markup, 'data-doc', 'u-orphan')).toContain('orphaned link: bill:2023:IX');
    expect(section(markup, 'data-doc', 'u-repl')).toContain('replacement for bill:2025:L');
    expect(section(markup, 'data-doc', 'u-repl')).toContain('replaces doc-v2');
    expect(section(markup, 'data-doc', 'u-repl-run')).toContain('processing');
  });

  it('offers Link, Delete for uploads, and Swap for a live replacement', () => {
    const markup = html();
    expect(['Link', 'Delete', 'Swap'].map((l) => has(markup, 'u-plain', l))).toEqual([true, true, false]);
    expect(has(markup, 'u-r7', 'Delete')).toBe(false);
    expect(has(markup, 'u-repl', 'Swap')).toBe(true);
    expect(has(markup, 'u-repl-run', 'Swap')).toBe(false);
  });

  it('asks before Swap and Delete, and opens the picker for Link', () => {
    const p = props();
    const tree = UnlinkedTable(p);
    const row = (id) => find(tree, (n) => n.type === 'tr' && n.key === id);
    button(row('u-repl'), 'Swap').props.onClick();
    expect(p.onAsk).toHaveBeenCalledWith({ kind: 'swap', doc: UNLINKED[2] });
    button(row('u-plain'), 'Delete').props.onClick();
    expect(p.onAsk).toHaveBeenCalledWith({ kind: 'delete', doc: UNLINKED[0] });
    button(row('u-plain'), 'Link').props.onClick();
    expect(p.onLink).toHaveBeenCalledWith(UNLINKED[0]);
  });

  it('confirms a swap in the page', () => {
    const confirm = { kind: 'swap', doc: UNLINKED[2] };
    const p = props({ confirm });
    expect(section(renderToStaticMarkup(createElement(UnlinkedTable, p)), 'data-doc', 'u-repl')).toContain('The document it replaces is unlinked, not deleted.');
    button(UnlinkedTable(p), 'Confirm swap').props.onClick();
    expect(p.onConfirm).toHaveBeenCalledWith(confirm);
  });

  it('says so when there are none', () => {
    expect(html({ documents: [] })).toContain('Every ingestion-v2 document of this desk is linked to a record.');
  });

  it('UnlinkedSection starts loading', () => {
    const markup = renderToStaticMarkup(createElement(UnlinkedSection, { api: { unlinked: vi.fn(() => new Promise(() => {})) }, desk: { tier: 'national', feature: 'Union Budget' } }));
    expect(markup).toContain('Loading documents…');
  });
});

// ─── The upload panel ────────────────────────────────────────────────────────

const ATTACH = { mode: 'attach', record: record() };
const REPLACE = { mode: 'replace', record: RECORDS[2], holder: RECORDS[2].documents[0] };
const STANDALONE = { mode: 'standalone', desk: 'national|Union Budget' };
const draft = (over = {}) => ({ title: 'The Bill, 2025', desk: 'national|Bill Passage Probability Index', file_url: 'https://sansad.in/getFile/45.pdf', no_public_source: false, note: '', splitEvery: '', ...over });

describe('UploadTarget', () => {
  it('names the record an attach goes to, with the legacy warning when it has legacy text', () => {
    expect(renderToStaticMarkup(createElement(UploadTarget, { target: ATTACH, onStandalone: () => {} }))).toContain('Attach a PDF to bill:2025:XLV (The Bill, 2025)');
    const legacyAttach = renderToStaticMarkup(createElement(UploadTarget, { target: { mode: 'attach', record: RECORDS[1] }, onStandalone: () => {} }));
    expect(legacyAttach).toContain(LEGACY_WARNING);
  });

  it('names the document a replacement will swap out', () => {
    const markup = renderToStaticMarkup(createElement(UploadTarget, { target: REPLACE, onStandalone: () => {} }));
    expect(markup).toContain('Replace “Bill PDF” on bill:2025:L');
    expect(markup).toContain('swap it in from Documents without a record');
  });

  it('offers a way back to a standalone upload', () => {
    const onStandalone = vi.fn();
    button(UploadTarget({ target: ATTACH, onStandalone }), 'Upload without a record instead').props.onClick();
    expect(onStandalone).toHaveBeenCalledOnce();
    expect(renderToStaticMarkup(createElement(UploadTarget, { target: STANDALONE, onStandalone }))).toContain('Standalone upload');
  });
});

describe('UploadForm modes', () => {
  const html = (over) => renderToStaticMarkup(createElement(UploadForm, { draft: draft(), pairs: PAIRS, planCurrent: true, target: ATTACH, onChange: () => {}, ...over }));

  it('fixes the desk and shows the key for an attach, with the record’s source page as a hint only', () => {
    const markup = html();
    expect(markup).not.toContain('<select');
    expect(markup).toContain('national · Bill Passage Probability Index · bill:2025:XLV');
    expect(markup).toContain(`The desk’s source page is ${HUB} — paste the document’s own link.`);
    expect(markup).not.toContain(`value="${HUB}"`);
  });

  it('lets a standalone upload choose any catalog desk', () => {
    const markup = html({ target: STANDALONE, draft: draft({ desk: 'national|Union Budget' }) });
    expect(markup.match(/<select/g)).toHaveLength(1);
    expect(markup).toContain('<option value="global|Treaties">Treaties</option>');
  });

  it('requires the source URL unless "No public source" is ticked (D6)', () => {
    const blank = html({ draft: draft({ file_url: '' }) });
    expect(blank).toMatch(/<input type="url"[^>]*required=""/);
    expect(buttonTag(blank, 'Upload and ingest')).toContain('disabled=""');
    const ticked = html({ draft: draft({ file_url: '', no_public_source: true }) });
    expect(ticked).toMatch(/<input type="checkbox" checked=""/);
    expect(ticked).toMatch(/<input type="url"[^>]*disabled=""/);
    expect(buttonTag(ticked, 'Upload and ingest')).not.toContain('disabled');
  });

  it('blocks the desk’s hub page as the source, with a clear message', () => {
    const markup = html({ draft: draft({ file_url: `${HUB}/` }) });
    expect(markup).toContain('That is the desk’s source page, not this document. Paste the document’s own link.');
    expect(buttonTag(markup, 'Upload and ingest')).toContain('disabled=""');
    expect(validateDraft(draft({ file_url: HUB }), PAIRS, [HUB]).errors.file_url).toBeTruthy();
    expect(validateDraft(draft(), PAIRS, [HUB]).valid).toBe(true);
  });

  it('reports the tick as a boolean', () => {
    const onChange = vi.fn();
    const tree = UploadForm({ draft: draft(), pairs: PAIRS, planCurrent: true, target: ATTACH, onChange });
    find(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    expect(onChange).toHaveBeenCalledWith('no_public_source', true);
  });
});

describe('the key-holder gate', () => {
  it('goes on when nothing holds the key', async () => {
    const setPrompt = vi.fn();
    await expect(askKeyHolder(null, 'attach', setPrompt)).resolves.toBeUndefined();
    expect(setPrompt).not.toHaveBeenCalled();
  });

  it('waits for a confirmation over legacy text, and stops when declined', async () => {
    let prompt = null;
    const holder = { document_id: 'doc-legacy', title: 'Legacy text', legacy: true };
    const accepted = askKeyHolder(holder, 'attach', (p) => { if (p) prompt = p; });
    expect(prompt).toMatchObject({ kind: 'legacy', holder });
    prompt.accept();
    await expect(accepted).resolves.toBeUndefined();
    const declined = askKeyHolder(holder, 'attach', (p) => { if (p) prompt = p; });
    prompt.cancel();
    await expect(declined).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('stops over an ingestion-v2 holder and names it, so Replace can be offered', async () => {
    const holder = { document_id: 'doc-v2', title: 'Bill PDF', legacy: false };
    await expect(askKeyHolder(holder, 'attach', vi.fn())).rejects.toMatchObject({ code: 'key_held', holder });
  });

  it('renders the legacy warning with a choice', () => {
    const markup = renderToStaticMarkup(createElement(KeyHolderWarning, { holder: { document_id: 'd', title: 'Legacy text', legacy: true }, onAccept: () => {}, onCancel: () => {} }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(LEGACY_WARNING);
    expect(markup).toContain('“Legacy text”');
    expect(buttonTag(markup, 'Attach as a second document')).toBeTruthy();
    expect(buttonTag(markup, 'Cancel this file')).toBeTruthy();
  });
});

describe('upload outcomes and offers', () => {
  const PLAN = { file_name: 'bill.pdf', file_sha256: 'a'.repeat(64), page_count: 3, parts: [] };

  it('offers Replace when an ingestion-v2 document holds the key', () => {
    const holder = { document_id: 'doc-v2', title: 'Bill PDF', legacy: false };
    const result = describeResult(new UploadError('key_held', 'Another document already holds this record.', { holder }), 'bill.pdf', ATTACH);
    expect(result).toMatchObject({ tone: 'err', offer: { kind: 'replace', record: ATTACH.record, holder } });
  });

  it('offers Replace for the record’s holder when the server refuses key_held without one', () => {
    const target = { mode: 'attach', record: RECORDS[2] };
    expect(describeResult(new UploadError('key_held', 'held'), 'bill.pdf', target).offer).toEqual({ kind: 'replace', record: RECORDS[2], holder: RECORDS[2].documents[0] });
  });

  it('offers to link an already uploaded file to the record', () => {
    const result = describeResult({ existing: { document_id: 'doc-old', title: 'Old', job_status: 'succeeded' } }, 'bill.pdf', ATTACH);
    expect(result.offer).toEqual({ kind: 'link', record: ATTACH.record, document_id: 'doc-old' });
    expect(describeResult({ existing: { document_id: 'doc-old' } }, 'bill.pdf', STANDALONE).offer).toBeUndefined();
  });

  it('renders an offer as a button', () => {
    const onOffer = vi.fn();
    const result = { id: 1, tone: 'warn', text: 'bill.pdf: already uploaded.', offer: { kind: 'link', record: ATTACH.record, document_id: 'doc-old' } };
    expect(buttonTag(renderToStaticMarkup(createElement(ResultLine, { result, onOffer })), 'Link the existing document')).toBeTruthy();
    button(ResultLine({ result, onOffer }), 'Link the existing document').props.onClick();
    expect(onOffer).toHaveBeenCalledWith(result.offer);
    const replace = { id: 2, tone: 'err', text: 'held', offer: { kind: 'replace', record: RECORDS[2], holder: RECORDS[2].documents[0] } };
    expect(buttonTag(renderToStaticMarkup(createElement(ResultLine, { result: replace, onOffer })), 'Replace instead')).toBeTruthy();
  });

  it('attaches with the record key and wires the key-holder gate', async () => {
    const upload = vi.fn(async (plan, meta, deps) => {
      await deps.onKeyHolder(null);
      return { document_id: 'd', job_id: 'j', duplicates: [] };
    });
    const result = await uploadFile({ plan: PLAN, draft: draft(), target: ATTACH, upload, api: {}, onProgress: () => {}, setPrompt: () => {} });
    expect(result.tone).toBe('ok');
    expect(upload.mock.calls[0][1]).toMatchObject({ document_key: 'bill:2025:XLV', file_url: 'https://sansad.in/getFile/45.pdf' });
  });

  it('replaces with `replaces` and no key', async () => {
    const upload = vi.fn(async () => ({ document_id: 'd', job_id: 'j', duplicates: [] }));
    await uploadFile({ plan: PLAN, draft: draft(), target: REPLACE, upload, api: {}, onProgress: () => {}, setPrompt: () => {} });
    expect(upload.mock.calls[0][1]).toMatchObject({ replaces: 'doc-v2' });
    expect(upload.mock.calls[0][1]).not.toHaveProperty('document_key');
  });
});
