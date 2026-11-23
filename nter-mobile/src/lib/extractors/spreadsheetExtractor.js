/**
 * Spreadsheet and Tabular Data Extractor for NTER Mobile.
 * Robust extractor for XLSX, XLSM, XLS, and CSV/TSV formats.
 * Extracts worksheets, headers, rows, cell coordinates, and provides markdown tables.
 */

import * as XLSX from 'xlsx';
import {
  createExtractedDocument,
  createExtractedSection,
  createExtractionWarning,
  formatMarkdownTable,
  toUint8Array,
  normalizeText,
  estimateTokens,
} from './common.js';

/**
 * Detects the most probable delimiter for a CSV/TSV string.
 * @param {string} text
 * @returns {string}
 */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const sample = lines.slice(0, 8);
  const candidates = [',', '\t', ';', '|'];
  const scores = { ',': 0, '\t': 0, ';': 0, '|': 0 };

  for (const line of sample) {
    let inQuotes = false;
    const lineCounts = { ',': 0, '\t': 0, ';': 0, '|': 0 };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (c in lineCounts)) {
        lineCounts[c]++;
      }
    }
    for (const c of candidates) {
      if (lineCounts[c] > 0) scores[c] += lineCounts[c];
    }
  }

  let best = ',';
  let maxScore = -1;
  for (const c of candidates) {
    if (scores[c] > maxScore) {
      maxScore = scores[c];
      best = c;
    }
  }
  return best;
}

/**
 * Parses a CSV string respecting quotes, escaped quotes, and embedded newlines.
 * @param {string} rawText
 * @param {string} [explicitDelimiter]
 * @returns {{ delimiter: string, rows: string[][] }}
 */
export function parseCsvString(rawText, explicitDelimiter) {
  const text = normalizeText(rawText);
  const delimiter = explicitDelimiter || detectDelimiter(text);
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Drop trailing empty row if present
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return { delimiter, rows };
}

/**
 * Fills merged cells in a SheetJS sheet so merged ranges propagate their anchor value.
 * @param {any} sheet
 */
function fillMergedCells(sheet) {
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
 * Formats raw cell value for plain text display.
 * @param {unknown} val
 * @returns {string}
 */
function formatCellValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0];
  }
  return String(val).trim();
}

/**
 * Converts a 0-based column index to Excel column letters (e.g. 0 -> A, 27 -> AB).
 * @param {number} colIndex
 * @returns {string}
 */
export function getColumnLetter(colIndex) {
  let letter = '';
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Extracts structured data from CSV text or bytes.
 * @param {File | Blob | ArrayBuffer | Uint8Array | string} input
 * @param {Object} [options]
 * @returns {Promise<import('./common.js').ExtractedDocument>}
 */
export async function extractCsv(input, options = {}) {
  let text = '';
  if (typeof input === 'string') {
    text = input;
  } else {
    const bytes = await toUint8Array(input);
    text = new TextDecoder('utf-8').decode(bytes);
  }

  const { delimiter, rows } = parseCsvString(text, options.delimiter);
  const warnings = [];

  if (rows.length === 0) {
    warnings.push(createExtractionWarning('EMPTY_CSV', 'CSV file contains no rows', 'info'));
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: {
        format: 'csv',
        delimiter,
        sheetCount: 1,
        totalRows: 0,
        totalColumns: 0,
        worksheets: [],
      },
      warnings,
    });
  }

  const headers = rows[0] || [];
  const dataRows = rows.slice(1);
  const markdownTable = formatMarkdownTable(rows);

  const worksheetSummary = {
    sheetName: options.fileName || 'Sheet1',
    sheetIndex: 0,
    rowCount: dataRows.length,
    columnCount: headers.length,
    headers,
    rows: dataRows,
  };

  const section = createExtractedSection({
    id: 'sheet_0',
    title: worksheetSummary.sheetName,
    level: 0,
    type: 'sheet',
    text: markdownTable,
    formatted: markdownTable,
    hierarchy: [worksheetSummary.sheetName],
    metadata: {
      headers,
      rowCount: dataRows.length,
      columnCount: headers.length,
      delimiter,
      rows: dataRows,
    },
  });

  return createExtractedDocument({
    text: markdownTable,
    sections: [section],
    metadata: {
      format: 'csv',
      title: options.fileName || 'CSV Table',
      delimiter,
      sheetCount: 1,
      totalRows: dataRows.length,
      totalColumns: headers.length,
      worksheets: [worksheetSummary],
      tokenEstimate: estimateTokens(markdownTable),
    },
    warnings,
  });
}

/**
 * Extracts structured spreadsheet data from XLSX/XLS/XLSM or CSV.
 * @param {File | Blob | ArrayBuffer | Uint8Array | string} input
 * @param {Object} [options]
 * @returns {Promise<import('./common.js').ExtractedDocument>}
 */
export async function extractSpreadsheet(input, options = {}) {
  const fileName = options.fileName || (typeof input === 'object' && input?.name) || 'spreadsheet.xlsx';
  const isCsv = options.isCsv !== undefined
    ? options.isCsv
    : fileName.toLowerCase().endsWith('.csv') || fileName.toLowerCase().endsWith('.tsv');

  if (isCsv) {
    return extractCsv(input, options);
  }

  const bytes = await toUint8Array(input);
  if (bytes.length === 0) {
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: { format: 'xlsx', sheetCount: 0, totalRows: 0 },
      warnings: [createExtractionWarning('EMPTY_INPUT', 'Spreadsheet input was empty', 'warning')],
    });
  }

  const warnings = [];
  let wb;
  try {
    wb = XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      cellNF: true,
      cellText: true,
    });
  } catch (err) {
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: { format: 'xlsx', error: err.message },
      warnings: [createExtractionWarning('XLSX_PARSE_ERROR', `Failed to parse Excel workbook: ${err.message}`, 'error')],
    });
  }

  const worksheets = [];
  const sections = [];
  let consolidatedText = '';
  let totalRowsAcrossSheets = 0;
  let maxColsAcrossSheets = 0;

  for (let sIdx = 0; sIdx < wb.SheetNames.length; sIdx++) {
    const sheetName = wb.SheetNames[sIdx];
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    fillMergedCells(ws);

    const rawRows = /** @type {unknown[][]} */ (
      XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        dateNF: 'yyyy-mm-dd',
        defval: '',
      })
    );

    const nonBlankRows = [];
    for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
      const row = rawRows[rIdx];
      if (Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')) {
        nonBlankRows.push({ rowIndex: rIdx + 1, data: row });
      }
    }

    if (nonBlankRows.length === 0) continue;

    // Detect header row
    let headerRowIdx = 0;
    const headers = [];
    const maxCol = Math.max(...nonBlankRows[0].data.map((_, colIdx) => colIdx), 0);
    for (let c = 0; c <= maxCol; c++) {
      const val = formatCellValue(nonBlankRows[0].data[c]);
      headers.push(val || `Column_${getColumnLetter(c)}`);
    }

    const dataRows = nonBlankRows.slice(headerRowIdx + 1).map((r) => {
      const rowArr = [];
      for (let c = 0; c < headers.length; c++) {
        rowArr.push(formatCellValue(r.data[c]));
      }
      return rowArr;
    });

    totalRowsAcrossSheets += dataRows.length;
    maxColsAcrossSheets = Math.max(maxColsAcrossSheets, headers.length);

    const summary = {
      sheetName,
      sheetIndex: sIdx,
      rowCount: dataRows.length,
      columnCount: headers.length,
      headers,
      rows: dataRows,
    };
    worksheets.push(summary);

    const tableRows = [headers, ...dataRows];
    const sheetMarkdown = `## Worksheet: ${sheetName}\n\n` + formatMarkdownTable(tableRows.slice(0, 100));
    consolidatedText += (consolidatedText ? '\n\n' : '') + sheetMarkdown;

    sections.push(
      createExtractedSection({
        id: `sheet_${sIdx}`,
        title: sheetName,
        level: sIdx + 1,
        type: 'sheet',
        text: sheetMarkdown,
        formatted: sheetMarkdown,
        hierarchy: [sheetName],
        metadata: {
          sheetIndex: sIdx,
          sheetName,
          rowCount: dataRows.length,
          columnCount: headers.length,
          headers,
          rows: dataRows,
        },
      })
    );
  }

  if (worksheets.length === 0) {
    warnings.push(createExtractionWarning('EMPTY_WORKBOOK', 'Spreadsheet workbook has no visible or non-empty sheets', 'info'));
  }

  return createExtractedDocument({
    text: consolidatedText,
    sections,
    metadata: {
      format: 'xlsx',
      title: fileName,
      sheetCount: worksheets.length,
      totalRows: totalRowsAcrossSheets,
      totalColumns: maxColsAcrossSheets,
      worksheets,
      tokenEstimate: estimateTokens(consolidatedText),
    },
    warnings,
  });
}
