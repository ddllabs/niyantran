// supabase/functions/_shared/spreadsheetExtractor.ts
// Robust spreadsheet extraction and spreadsheet-aware chunking module.
// Supports XLSX, XLSM, XLS, and CSV bytes using SheetJS (xlsx).

// SheetJS 0.20.3, the version the website pins (package.json), vendored under supabase/functions so that both deploy
// bundlers accept it and nothing is fetched at bundle time (vendor/sheetjs-0.20.3/README.md).
import * as XLSX from './vendor/sheetjs-0.20.3/xlsx.mjs';

export interface SpreadsheetChunkMetadata {
  source_type: 'private_file';
  file_name: string;
  file_type: 'xlsx' | 'csv';
  sheet_name: string;
  sheet_index: number;
  row_start: number;
  row_end: number;
  column_headers: string[];
  chunk_index: number;
}

export interface SpreadsheetChunk {
  content: string;
  metadata: SpreadsheetChunkMetadata;
}

export interface WorksheetSummary {
  sheetName: string;
  sheetIndex: number;
  rowCount: number;
  headers: string[];
}

export interface SpreadsheetExtractionResult {
  worksheets: WorksheetSummary[];
  chunks: SpreadsheetChunk[];
}

export interface SpreadsheetExtractOptions {
  fileName?: string;
  targetChars?: number;
  isCsv?: boolean;
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0];
  }
  return String(val).trim();
}

/**
 * Propagates values from merged cell heads to all covered cells within the merge range.
 */
function fillMergedCells(sheet: any): void {
  if (!sheet || !sheet['!merges']) return;
  for (const range of sheet['!merges']) {
    const startRef = XLSX.utils.encode_cell(range.s);
    const startVal = sheet[startRef];
    if (!startVal) continue;
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        if (R === range.s.r && C === range.s.c) continue;
        const ref = XLSX.utils.encode_cell({ r: R, c: C });
        if (!sheet[ref]) {
          sheet[ref] = { ...startVal };
        }
      }
    }
  }
}

/**
 * Extracts and chunks spreadsheet bytes (XLSX, XLSM, XLS, or CSV).
 */
export function extractSpreadsheet(
  data: Uint8Array | ArrayBuffer | string,
  options: SpreadsheetExtractOptions = {}
): SpreadsheetExtractionResult {
  const fileName = options.fileName || 'unknown';
  const targetChars = options.targetChars || 1200;
  const isCsv = options.isCsv !== undefined ? options.isCsv : fileName.toLowerCase().endsWith('.csv');

  const readOpts: Record<string, any> = {
    cellDates: true,
    cellNF: true,
    cellText: true,
  };

  let wb: any;
  if (typeof data === 'string') {
    wb = XLSX.read(data, { ...readOpts, type: 'string' });
  } else if (data instanceof Uint8Array) {
    wb = XLSX.read(data, { ...readOpts, type: 'array' });
  } else {
    wb = XLSX.read(new Uint8Array(data), { ...readOpts, type: 'array' });
  }

  const worksheets: WorksheetSummary[] = [];
  const chunks: SpreadsheetChunk[] = [];
  let chunkIndex = 0;

  for (let sIdx = 0; sIdx < wb.SheetNames.length; sIdx++) {
    const sheetName = wb.SheetNames[sIdx];
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    fillMergedCells(ws);

    const rawRows = (XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      dateNF: 'yyyy-mm-dd',
      defval: '',
    }) as unknown[][]);

    const nonBlankRows: { rowIndex: number; data: unknown[] }[] = [];
    for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
      const row = rawRows[rIdx];
      if (Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')) {
        nonBlankRows.push({ rowIndex: rIdx + 1, data: row });
      }
    }

    if (nonBlankRows.length === 0) continue;

    // Detect header row (first non-empty row with multiple non-blank values, or fallback)
    let headerRowIdx = -1;
    let headers: string[] = [];

    for (let i = 0; i < nonBlankRows.length; i++) {
      const r = nonBlankRows[i].data;
      const filled = r.map((c, colIdx) => ({ val: formatCellValue(c), colIdx })).filter((x) => x.val !== '');
      if (filled.length > 1 || nonBlankRows.length === 1) {
        headerRowIdx = i;
        const maxCol = Math.max(...r.map((_, colIdx) => colIdx), 0);
        for (let c = 0; c <= maxCol; c++) {
          const val = formatCellValue(r[c]);
          headers.push(val || `Column_${c + 1}`);
        }
        break;
      }
    }

    if (headerRowIdx === -1) {
      headerRowIdx = 0;
      const maxCol = Math.max(...nonBlankRows[0].data.map((_, colIdx) => colIdx), 0);
      for (let c = 0; c <= maxCol; c++) {
        headers.push(`Column_${c + 1}`);
      }
    }

    worksheets.push({
      sheetName,
      sheetIndex: sIdx,
      rowCount: nonBlankRows.length,
      headers,
    });

    const dataRows = nonBlankRows.slice(headerRowIdx + 1);
    const headerPrefix = `Workbook: ${fileName} | Worksheet: ${sheetName} | Columns: ${headers.join(', ')}`;

    let currentRows: string[] = [];
    let currentLength = headerPrefix.length + 1;
    let startRow: number | null = null;
    let endRow: number | null = null;

    const flush = () => {
      if (currentRows.length === 0 || startRow === null || endRow === null) return;
      const content = `${headerPrefix}\n${currentRows.join('\n')}`;
      chunks.push({
        content,
        metadata: {
          source_type: 'private_file',
          file_name: fileName,
          file_type: isCsv ? 'csv' : 'xlsx',
          sheet_name: sheetName,
          sheet_index: sIdx,
          row_start: startRow,
          row_end: endRow,
          column_headers: headers,
          chunk_index: chunkIndex++,
        },
      });
      currentRows = [];
      currentLength = headerPrefix.length + 1;
      startRow = null;
      endRow = null;
    };

    for (const r of dataRows) {
      const parts: string[] = [];
      for (let c = 0; c < headers.length; c++) {
        const val = formatCellValue(r.data[c]);
        if (val !== '') {
          parts.push(`${headers[c]}=${val}`);
        }
      }
      if (parts.length === 0) continue;
      const line = `Row ${r.rowIndex}: ${parts.join('; ')}`;

      if (currentRows.length > 0 && currentLength + line.length + 1 > targetChars) {
        flush();
      }

      if (startRow === null) startRow = r.rowIndex;
      endRow = r.rowIndex;
      currentRows.push(line);
      currentLength += line.length + 1;
    }

    flush();
  }

  return { worksheets, chunks };
}
