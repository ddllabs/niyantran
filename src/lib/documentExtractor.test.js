import { describe, it, expect } from 'vitest';
import {
  extractDocx,
  chunkDocx,
  extractCsv,
  chunkCsv,
  extractTxt,
  chunkTxt,
  formatMarkdownTable,
} from './documentExtractor.js';

describe('Document Extractor — DOCX, CSV, TXT', () => {
  it('formats markdown tables correctly', () => {
    const table = formatMarkdownTable([
      ['Header 1', 'Header 2'],
      ['Value 1', 'Value 2'],
    ]);
    expect(table).toContain('| Header 1 | Header 2 |');
    expect(table).toContain('| --- | --- |');
    expect(table).toContain('| Value 1 | Value 2 |');
  });

  it('extracts and chunks CSV with delimiters and row ranges', async () => {
    const csvContent = `id,name,role\n1,Alice,Engineer\n2,Bob,Architect\n3,Charlie,Auditor`;
    const extracted = extractCsv(csvContent);
    expect(extracted.headers).toEqual(['id', 'name', 'role']);
    expect(extracted.totalRows).toBe(3);

    const chunks = await chunkCsv(extracted, { targetChars: 50 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.format).toBe('csv');
    expect(chunks[0].metadata.rowRange).toBeDefined();
    expect(chunks[0].metadata.rowRange.from).toBe(1);
    expect(chunks[0].content).toContain('| id | name | role |');
  });

  it('extracts and chunks TXT preserving paragraph boundaries and markdown headers', async () => {
    const textContent = `# Section 1\n\nFirst paragraph of text.\n\nSecond paragraph of text.\n\n# Section 2\n\nThird paragraph.`;
    const extracted = extractTxt(textContent);
    expect(extracted.paragraphs.length).toBe(5);

    const chunks = await chunkTxt(extracted, { targetChars: 60 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.format).toBe('txt');
  });
});
