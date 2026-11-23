/**
 * DOCX Document Extractor for NTER Mobile.
 * Extracts headings, paragraphs, and tables while preserving hierarchy and section numbering.
 */

import { XMLParser } from 'fast-xml-parser';
import {
  createExtractedDocument,
  createExtractedSection,
  createExtractionWarning,
  formatMarkdownTable,
  readZipArchive,
  toUint8Array,
  normalizeText,
  estimateTokens,
} from './common.js';

/**
 * Recursively extracts plain text from an XML AST node.
 * @param {unknown} node
 * @returns {string}
 */
function extractTextFromXmlNode(node) {
  let text = '';
  if (!node) return text;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const child of node) text += extractTextFromXmlNode(child);
    return text;
  }
  if (typeof node === 'object') {
    const record = /** @type {Record<string, any>} */ (node);
    for (const key of Object.keys(record)) {
      if (key === ':@' || key === '#text') continue;
      if (key === 'w:t') {
        const val = record[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === 'object' && '#text' in item) {
              text += String(item['#text']);
            } else if (typeof item === 'string') {
              text += item;
            }
          }
        } else if (typeof val === 'string') {
          text += val;
        }
      } else if (key === 'w:tab') {
        text += '\t';
      } else if (key === 'w:br' || key === 'w:cr') {
        text += '\n';
      } else {
        text += extractTextFromXmlNode(record[key]);
      }
    }
  }
  return text;
}

/**
 * Determines heading level (1-6) from a paragraph node's properties.
 * @param {unknown} pNode
 * @returns {number | null}
 */
function getDocxHeadingLevel(pNode) {
  if (!pNode || !Array.isArray(pNode)) return null;
  for (const child of pNode) {
    if (child && typeof child === 'object' && 'w:pPr' in child) {
      const pPr = child['w:pPr'];
      if (Array.isArray(pPr)) {
        for (const prChild of pPr) {
          if (prChild && typeof prChild === 'object') {
            // Check style name (w:pStyle)
            if ('w:pStyle' in prChild) {
              const attrs = prChild[':@'] || {};
              const val = String(attrs['@_w:val'] || attrs['w:val'] || '');
              if (val) {
                const match = /heading\s*([1-6])/i.exec(val);
                if (match) return parseInt(match[1], 10);
                if (/^title$/i.test(val)) return 1;
                if (/^subtitle$/i.test(val)) return 2;
              }
            }
            // Check outline level (w:outlineLvl)
            if ('w:outlineLvl' in prChild) {
              const attrs = prChild[':@'] || {};
              const val = String(attrs['@_w:val'] || attrs['w:val'] || '');
              if (val && !isNaN(parseInt(val, 10))) {
                const lvl = parseInt(val, 10) + 1;
                if (lvl >= 1 && lvl <= 6) return lvl;
              }
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Extracts section numbering if present at the start of text (e.g. "1.", "1.2", "Section 3:").
 * @param {string} text
 * @returns {{ number: string | null, cleanTitle: string }}
 */
function parseSectionNumbering(text) {
  const match = /^((?:(?:Section|Article|Clause|Chapter)\s+)?(?:[0-9]+(?:\.[0-9]+)*|[A-Z](?:\.[0-9]+)*|[IVXLCDM]+)[.:)]?)\s+(.*)$/i.exec(text);
  if (match) {
    return { number: match[1], cleanTitle: match[2] };
  }
  return { number: null, cleanTitle: text };
}

/**
 * Extracts structured document from DOCX input.
 * @param {File | Blob | ArrayBuffer | Uint8Array | string} input
 * @param {Object} [options]
 * @returns {Promise<import('./common.js').ExtractedDocument>}
 */
export async function extractDocx(input, options = {}) {
  const warnings = [];
  let xmlString = '';

  if (typeof input === 'string' && input.includes('<w:document')) {
    xmlString = input;
  } else {
    try {
      const bytes = await toUint8Array(input);
      if (bytes.length === 0) {
        return createExtractedDocument({
          text: '',
          sections: [],
          metadata: { format: 'docx', headingCount: 0, paragraphCount: 0, tableCount: 0 },
          warnings: [createExtractionWarning('EMPTY_INPUT', 'DOCX input was empty or zero bytes', 'warning')],
        });
      }
      const archive = await readZipArchive(bytes);
      xmlString = await archive.readEntryText('word/document.xml');
      if (!xmlString) {
        throw new Error('word/document.xml not found in archive');
      }
    } catch (err) {
      return createExtractedDocument({
        text: '',
        sections: [],
        metadata: { format: 'docx', error: err.message },
        warnings: [createExtractionWarning('CORRUPT_ARCHIVE', `Invalid DOCX archive: ${err.message}`, 'error')],
      });
    }
  }

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: false,
  });

  let parsed = [];
  try {
    parsed = parser.parse(xmlString) || [];
  } catch (err) {
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: { format: 'docx' },
      warnings: [createExtractionWarning('XML_PARSE_ERROR', `Failed to parse document.xml: ${err.message}`, 'error')],
    });
  }

  let body = null;
  for (const root of parsed) {
    if (root['w:document'] && Array.isArray(root['w:document'])) {
      for (const docChild of root['w:document']) {
        if (docChild && typeof docChild === 'object' && 'w:body' in docChild) {
          body = docChild['w:body'];
          break;
        }
      }
    }
  }

  const sections = [];
  const headingHierarchy = [];
  let fullText = '';
  let headingCount = 0;
  let paragraphCount = 0;
  let tableCount = 0;
  let docTitle = null;

  for (const item of (body || [])) {
    if (item['w:p']) {
      const pNode = item['w:p'];
      const rawText = normalizeText(extractTextFromXmlNode(pNode)).trim();
      if (!rawText) continue;

      const headingLevel = getDocxHeadingLevel(pNode);
      if (headingLevel !== null) {
        headingCount++;
        const { number, cleanTitle } = parseSectionNumbering(rawText);

        while (headingHierarchy.length >= headingLevel) {
          headingHierarchy.pop();
        }
        headingHierarchy.push(rawText);

        if (!docTitle && (headingLevel === 1 || headingCount === 1)) {
          docTitle = cleanTitle || rawText;
        }

        const formatted = '#'.repeat(headingLevel) + ' ' + rawText;
        fullText += (fullText ? '\n\n' : '') + formatted;

        sections.push(
          createExtractedSection({
            id: `h_${sections.length + 1}`,
            title: rawText,
            level: headingLevel,
            type: 'heading',
            text: rawText,
            formatted,
            hierarchy: [...headingHierarchy],
            metadata: {
              headingLevel,
              sectionNumber: number,
              cleanTitle,
            },
          })
        );
      } else {
        paragraphCount++;
        fullText += (fullText ? '\n\n' : '') + rawText;

        sections.push(
          createExtractedSection({
            id: `p_${sections.length + 1}`,
            title: headingHierarchy.length ? headingHierarchy[headingHierarchy.length - 1] : null,
            level: null,
            type: 'paragraph',
            text: rawText,
            formatted: rawText,
            hierarchy: [...headingHierarchy],
            metadata: {
              activeHeading: headingHierarchy.length ? headingHierarchy[headingHierarchy.length - 1] : null,
            },
          })
        );
      }
    } else if (item['w:tbl'] && Array.isArray(item['w:tbl'])) {
      tableCount++;
      const tblNode = item['w:tbl'];
      const rows = [];

      for (const rowItem of tblNode) {
        if (rowItem && typeof rowItem === 'object' && 'w:tr' in rowItem && Array.isArray(rowItem['w:tr'])) {
          const cells = [];
          for (const cellItem of rowItem['w:tr']) {
            if (cellItem && typeof cellItem === 'object' && 'w:tc' in cellItem) {
              const cellText = normalizeText(extractTextFromXmlNode(cellItem['w:tc'])).trim().replace(/\n+/g, ' ');
              cells.push(cellText);
            }
          }
          if (cells.length > 0) rows.push(cells);
        }
      }

      if (rows.length > 0) {
        const formattedTable = formatMarkdownTable(rows);
        fullText += (fullText ? '\n\n' : '') + formattedTable;

        sections.push(
          createExtractedSection({
            id: `tbl_${sections.length + 1}`,
            title: headingHierarchy.length ? `Table under ${headingHierarchy[headingHierarchy.length - 1]}` : `Table ${tableCount}`,
            level: null,
            type: 'table',
            text: formattedTable,
            formatted: formattedTable,
            hierarchy: [...headingHierarchy],
            metadata: {
              rows,
              rowCount: rows.length,
              columnCount: rows[0]?.length || 0,
            },
          })
        );
      }
    }
  }

  if (sections.length === 0) {
    warnings.push(createExtractionWarning('EMPTY_CONTENT', 'DOCX document contains no readable text or tables', 'info'));
  }

  return createExtractedDocument({
    text: fullText,
    sections,
    metadata: {
      format: 'docx',
      title: docTitle || options.fileName || 'DOCX Document',
      headingCount,
      paragraphCount,
      tableCount,
      sectionCount: sections.length,
      tokenEstimate: estimateTokens(fullText),
    },
    warnings,
  });
}
