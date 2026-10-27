import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_DND, attachmentIdentity, filesFromDrop, handOffAiDrop, isAiDrag, isModuleAttachment, materializeAiDrop, partitionAttachments } from './aiDrop.js';

const BILL = {
  bill_name: 'The Competition (Amendment) Bill, 2007',
  bill_number: '70',
  date_introduced: '2007-08-28',
  source_url: 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/2007-70.pdf',
};

afterEach(() => vi.unstubAllGlobals());

// Pinning the selected row as a question is sent must not wait on a PDF
// extraction whose text the research path never sends.
it('a row pinned without hydration fetches nothing and keeps its document key', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const [chip] = await materializeAiDrop({ kind: 'row', row: BILL, feature: 'Bill Passage Probability Index' }, { hydrate: false });
  expect(fetch).not.toHaveBeenCalled();
  expect(chip.kind).toBe('row');
  expect(chip.document_key).toBe('bill:2007:70');
  expect(chip.preview.record_text).toContain('Competition');
  // One record file, not the record twice.
  expect(chip.files.map((f) => f.kind)).toEqual(['record']);
});

it('a dropped row still hydrates its documents', async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, text: 'x'.repeat(80) }) }));
  vi.stubGlobal('fetch', fetch);
  await materializeAiDrop({ kind: 'row', row: BILL, feature: 'Bill Passage Probability Index' });
  expect(fetch).toHaveBeenCalled();
});

it('a module, a desk and a feature are modules; a row, a record and a file are not', () => {
  expect(['feed', 'feature', 'tab'].map((kind) => isModuleAttachment({ kind }))).toEqual([true, true, true]);
  expect(['row', 'record', 'file', undefined].map((kind) => isModuleAttachment({ kind }))).toEqual([false, false, false, false]);
  expect(isModuleAttachment(null)).toBe(false);
});

// "Ask about this document" adds a chip with no text, so kind, title and
// feature are all the identity had: two documents sharing a title (the same
// bill's two versions, say) were one chip, and the second was never attached.
it('a document chip is identified by its document id', () => {
  const a = { kind: 'document', title: 'The Delimitation Bill, 2026', feature: 'Bills', document_id: 'd1' };
  expect(attachmentIdentity({ ...a, id: 'x1' })).toBe(attachmentIdentity({ ...a, id: 'x2' }));
  expect(attachmentIdentity({ ...a, document_id: 'd2' })).not.toBe(attachmentIdentity(a));
});

// chat-attach-fixes (2026-10-03, measured): a bill dragged from the table carried desk '' and the
// same bill sent by "Ask AI" carried 'national', so it attached twice; and a file's text sits
// inside `files`, so two different files that share a name were one chip.
describe('attachment identity', () => {
  it('a row with a stable tuple and document key is that key, by any route', () => {
    const drag = { kind: 'row', title: 'THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026', tab: 'national', feature: 'Bill Passage Probability Index', row_key: '156', document_key: 'bill:2026:156' };
    const seed = { ...drag, tab: 'national', title: 'The National Co-operative Development Corporation (Amendment) Bill, 2026' };
    expect(attachmentIdentity(seed)).toBe(attachmentIdentity(drag));
    expect(attachmentIdentity({ ...drag, document_key: 'bill:2026:157' })).toBe(attachmentIdentity(drag));
    expect(attachmentIdentity({ ...drag, row_key: '157' })).not.toBe(attachmentIdentity(drag));
  });

  it('a row without a key is its title and module, not its desk', () => {
    const a = { kind: 'row', title: 'Same Name', feature: 'Alliances', tab: '' };
    expect(attachmentIdentity({ ...a, tab: 'global' })).toBe(attachmentIdentity(a));
    expect(attachmentIdentity({ ...a, feature: 'Nuclear Watch' })).not.toBe(attachmentIdentity(a));
  });

  it('a dropped file is its name, size and content', async () => {
    const [one] = await filesFromDrop({ dataTransfer: { files: [new File(['hello world'], 'notes.txt', { type: 'text/plain' })] } });
    const [same] = await filesFromDrop({ dataTransfer: { files: [new File(['hello world'], 'notes.txt', { type: 'text/plain' })] } });
    const [other] = await filesFromDrop({ dataTransfer: { files: [new File(['different content'], 'notes.txt', { type: 'text/plain' })] } });
    expect(one.fingerprint).toMatch(/^11:[0-9a-f]{16}$/);
    expect(attachmentIdentity(same)).toBe(attachmentIdentity(one));
    expect(attachmentIdentity(other)).not.toBe(attachmentIdentity(one));
  });

  it('partitions incoming attachments into new ones and those already attached, within a drop too', () => {
    const bill = { kind: 'row', title: 'A bill', document_key: 'bill:1:1' };
    const { fresh, duplicates } = partitionAttachments([bill], [{ ...bill, tab: 'national' }, { kind: 'row', title: 'B', document_key: 'bill:1:2' }, { kind: 'row', title: 'B', document_key: 'bill:1:2' }]);
    expect(fresh.map((a) => a.title)).toEqual(['B']);
    expect(duplicates.map((a) => a.title)).toEqual(['A bill', 'B']);
  });
});


it('reads dropped text bytes once for both its fingerprint and UTF-8 content', async () => {
 const file=new File(['नमस्ते, world'], 'notes.txt', {type:'text/plain'});
 const read=vi.spyOn(file,'arrayBuffer');const text=vi.spyOn(file,'text');
 const [chip]=await filesFromDrop({dataTransfer:{files:[file]}});
 expect(chip.text).toBe('नमस्ते, world');
 expect(read).toHaveBeenCalledOnce();expect(text).not.toHaveBeenCalled();
 expect(chip.fingerprint).toMatch(/^[0-9]+:[0-9a-f]{16}$/);
});
it('reads a dropped binary file once and keeps no copy of it on the chip (F62)', async () => {
 const bytes=Uint8Array.from({length:70000},(_,i)=>i%256);
 const file=new File([bytes], 'scan.pdf', {type:'application/pdf'});
 const read=vi.spyOn(file,'arrayBuffer');
 const [chip]=await filesFromDrop({dataTransfer:{files:[file]}});
 expect(read).toHaveBeenCalledOnce();
 expect(JSON.stringify(chip)).not.toMatch(/base64/);
 expect(chip.error).toMatch(/could not be read|no readable text/i);
});

// panel-drag-ai (F113): the side panel switches to AI for a dragged record or file, and a drop the
// chat cannot take yet is handed to it through niy-ai-open, which waits until the chat is ready.
describe('dragging to AI', () => {
  it('a Niyantran record or a file is an AI drag; plain text and nothing are not', () => {
    expect(isAiDrag({ types: [AI_DND, 'text/plain'] })).toBe(true);
    expect(isAiDrag({ types: ['Files'] })).toBe(true);
    expect(isAiDrag({ types: ['text/plain'] })).toBe(false);
    expect(isAiDrag({ types: [] })).toBe(false);
    expect(isAiDrag(null)).toBe(false);
  });

  function catchOpen() {
    const opened = [];
    vi.stubGlobal('window', { dispatchEvent: (e) => opened.push(e.detail) });
    return opened;
  }

  it('hands a dropped record to the chat as its seed', async () => {
    const opened = catchOpen();
    const payload = { kind: 'row', title: 'A bill', row: BILL };
    await handOffAiDrop({ dataTransfer: { getData: (t) => (t === AI_DND ? JSON.stringify(payload) : ''), files: [] } });
    expect(opened).toEqual([{ drop: payload }]);
  });

  it('hands dropped files over already read', async () => {
    const opened = catchOpen();
    await handOffAiDrop({ dataTransfer: { getData: () => '', files: [new File(['hello world'], 'notes.txt', { type: 'text/plain' })] } });
    expect(opened).toHaveLength(1);
    expect(opened[0].drop).toBeUndefined();
    expect(opened[0].droppedFiles.map((f) => f.title)).toEqual(['notes.txt']);
  });

  it('opens nothing for a drop that carries neither', async () => {
    const opened = catchOpen();
    await handOffAiDrop({ dataTransfer: { getData: () => 'just text', files: [] } });
    expect(opened).toEqual([]);
  });
});

it('a Law record pin preserves the verified lookup key without fetching source text', async () => {
  const key = 'law-record:12345678-1234-1234-1234-123456789abc';
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const [chip] = await materializeAiDrop({ kind: 'row', row: { id: 'legacy-order', title: 'Future Consumer', document_key: key, source_url: 'https://ibbi.gov.in/uploads/order/test.pdf' }, feature: 'NCLT / NCLAT (Insolvency)' }, { hydrate: false });
  expect(chip.document_key).toBe(key);
  expect(chip.preview.id).toBe('legacy-order');
  expect(fetch).not.toHaveBeenCalled();
});

it('F257 persists identity from the whole row even when preview loses the identity field', async () => {
 const row={...Object.fromEntries(Array.from({length:33},(_,i)=>['field'+i,'value'+i])),source_url:'https://example.gov/document.pdf'};
 const [chip]=await materializeAiDrop({kind:'row',row,feature:'Parliamentary Question Database'},{tier:'national',hydrate:false});
 expect(chip.row_key).toBe('https://example.gov/document.pdf');
 expect(chip.tab).toBe('national');
 expect(chip.preview.source_url).toBeUndefined();
});
