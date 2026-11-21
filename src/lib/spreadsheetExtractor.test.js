import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractSpreadsheet } from './spreadsheetExtractor.js';

describe('Spreadsheet Extractor', () => {
  const prdPath = path.resolve('supabase/functions/ingest-worker/__fixtures__/GTPL_KCBPL_Unified_Intelligence_Platform_PRD_v2.xlsx');
  const csvPath = path.resolve('supabase/functions/ingest-worker/__fixtures__/GTPL_Phase_1_Layer_I_Feature_List_Updated.csv');

  it('enumerates all 11 non-empty worksheets in PRD fixture', () => {
    const bytes = fs.readFileSync(prdPath);
    const result = extractSpreadsheet(bytes, { fileName: 'PRD.xlsx' });
    expect(result.worksheets.length).toBe(11);
    expect(result.worksheets[0].sheetName).toBe('Overview');
    expect(result.worksheets[0].headers).toEqual(['Document Details', 'Value']);
  });

  it('normalizes rows and preserves row range bounds in chunks', () => {
    const bytes = fs.readFileSync(prdPath);
    const result = extractSpreadsheet(bytes, { fileName: 'PRD.xlsx', targetChars: 1200 });
    expect(result.chunks.length).toBeGreaterThan(0);
    const firstChunk = result.chunks[0];
    expect(firstChunk.metadata.file_name).toBe('PRD.xlsx');
    expect(firstChunk.metadata.source_type).toBe('private_file');
    expect(firstChunk.metadata.file_type).toBe('xlsx');
    expect(firstChunk.metadata.row_start).toBe(2);
    expect(firstChunk.metadata.row_end).toBe(12);
    expect(firstChunk.content).toContain('Workbook: PRD.xlsx | Worksheet: Overview');
  });

  it('extracts CSV correctly with csv metadata', () => {
    const bytes = fs.readFileSync(csvPath);
    const result = extractSpreadsheet(bytes, { fileName: 'Feature_List.csv' });
    expect(result.worksheets.length).toBe(1);
    expect(result.chunks[0].metadata.file_type).toBe('csv');
    expect(result.chunks[0].metadata.source_type).toBe('private_file');
    expect(result.chunks.length).toBeGreaterThan(0);
  });
});
