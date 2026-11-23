/**
 * Multi-Format Document Extractor Entry Point for NTER Mobile.
 * Unifies client-side document extraction for DOCX, XLSX, CSV, TXT, and PPTX.
 */

import { extractDocx } from './docxExtractor.js';
import { extractSpreadsheet, extractCsv, detectDelimiter, parseCsvString } from './spreadsheetExtractor.js';
import { extractTxt } from './txtExtractor.js';
import { extractPptx } from './pptxExtractor.js';
import {
  createExtractedDocument,
  createExtractedSection,
  createExtractionWarning,
  estimateTokens,
  formatMarkdownTable,
  normalizeText,
  readZipArchive,
  toUint8Array,
} from './common.js';

export {
  extractDocx,
  extractSpreadsheet,
  extractCsv,
  extractTxt,
  extractPptx,
  detectDelimiter,
  parseCsvString,
  createExtractedDocument,
  createExtractedSection,
  createExtractionWarning,
  estimateTokens,
  formatMarkdownTable,
  normalizeText,
  readZipArchive,
  toUint8Array,
};

/**
 * Resolves document format from file name, MIME type, or explicit options.
 * @param {any} input
 * @param {Object} [options]
 * @returns {'docx' | 'xlsx' | 'csv' | 'txt' | 'pptx' | 'unknown'}
 */
export function resolveDocumentFormat(input, options = {}) {
  if (options.format) {
    const f = String(options.format).toLowerCase();
    if (['docx', 'xlsx', 'csv', 'txt', 'pptx'].includes(f)) return f;
  }

  const fileName = options.fileName || (typeof input === 'object' && input?.name) || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (ext === 'docx') return 'docx';
  if (['xlsx', 'xlsm', 'xls'].includes(ext)) return 'xlsx';
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  if (ext === 'pptx') return 'pptx';
  if (['txt', 'md', 'markdown', 'json', 'xml', 'log'].includes(ext)) return 'txt';

  const mime = options.mimeType || (typeof input === 'object' && input?.type) || '';
  const m = String(mime).toLowerCase();

  if (m.includes('wordprocessingml') || m.includes('msword')) return 'docx';
  if (m.includes('spreadsheetml') || m.includes('excel')) return 'xlsx';
  if (m === 'text/csv' || m === 'text/tab-separated-values') return 'csv';
  if (m.includes('presentationml') || m.includes('powerpoint')) return 'pptx';
  if (m.startsWith('text/') || m.includes('json') || m.includes('markdown')) return 'txt';

  return 'unknown';
}

/**
 * Common entry point for extracting text and structured sections from any supported document format.
 * Automatically selects the appropriate extractor based on format, extension, or MIME type.
 *
 * @param {File | Blob | ArrayBuffer | Uint8Array | string} input
 * @param {Object} [options]
 * @param {string} [options.format] - Explicit format override ('docx' | 'xlsx' | 'csv' | 'txt' | 'pptx')
 * @param {string} [options.fileName] - Name of file for extension inference
 * @param {string} [options.mimeType] - MIME type for format inference
 * @param {string} [options.delimiter] - Explicit delimiter for CSV
 * @returns {Promise<import('./common.js').ExtractedDocument>}
 */
export async function extractDocument(input, options = {}) {
  const fileName = options.fileName || (typeof input === 'object' && input?.name) || 'document';
  const format = resolveDocumentFormat(input, { ...options, fileName });

  switch (format) {
    case 'docx':
      return extractDocx(input, { ...options, fileName });

    case 'xlsx':
      return extractSpreadsheet(input, { ...options, fileName });

    case 'csv':
      return extractCsv(input, { ...options, fileName });

    case 'pptx':
      return extractPptx(input, { ...options, fileName });

    case 'txt':
      return extractTxt(input, { ...options, fileName });

    default: {
      // Heuristic fallback: inspect bytes for ZIP header (0x50 0x4B 0x03 0x04)
      try {
        const bytes = await toUint8Array(input);
        if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
          const archive = await readZipArchive(bytes);
          if (archive.hasEntry('word/document.xml')) {
            return extractDocx(bytes, { ...options, fileName });
          }
          if (archive.hasEntry('xl/workbook.xml')) {
            return extractSpreadsheet(bytes, { ...options, fileName });
          }
          if (archive.findEntries(/^ppt\/slides\/slide\d+\.xml$/i).length > 0) {
            return extractPptx(bytes, { ...options, fileName });
          }
        }
      } catch {
        // Fallback to text
      }
      return extractTxt(input, { ...options, fileName });
    }
  }
}
