import { afterEach, expect, it, vi } from 'vitest';
import { isModuleAttachment, materializeAiDrop } from './aiDrop.js';

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
