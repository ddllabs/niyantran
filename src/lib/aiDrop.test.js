import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentIdentity, filesFromDrop, isModuleAttachment, materializeAiDrop, partitionAttachments } from './aiDrop.js';

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
  it('a row with a document key is that key, by any route', () => {
    const drag = { kind: 'row', title: 'THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026', tab: '', feature: 'Bill Passage Probability Index', document_key: 'bill:2026:156' };
    const seed = { ...drag, tab: 'national', title: 'The National Co-operative Development Corporation (Amendment) Bill, 2026' };
    expect(attachmentIdentity(seed)).toBe(attachmentIdentity(drag));
    expect(attachmentIdentity({ ...drag, document_key: 'bill:2026:157' })).not.toBe(attachmentIdentity(drag));
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
 expect(chip.files[0].text).toBe('नमस्ते, world');
 expect(read).toHaveBeenCalledOnce();expect(text).not.toHaveBeenCalled();
 expect(chip.fingerprint).toMatch(/^[0-9]+:[0-9a-f]{16}$/);
});
it('reads dropped binary bytes once and preserves its exact base64 payload', async () => {
 vi.stubGlobal('FileReader', class {
  readAsDataURL(file){file.arrayBuffer().then(bytes=>{this.result=`data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();});}
 });
 const bytes=Uint8Array.from({length:70000},(_,i)=>i%256);
 const file=new File([bytes], 'scan.pdf', {type:'application/pdf'});
 const read=vi.spyOn(file,'arrayBuffer');
 const [chip]=await filesFromDrop({dataTransfer:{files:[file]}});
 expect(chip.files[0].base64).toBe(Buffer.from(bytes).toString('base64'));
 expect(read).toHaveBeenCalledOnce();
});
