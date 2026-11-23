/**
 * PPTX Presentation Extractor for NTER Mobile.
 * Extracts slide text, slide numbers, titles, bullet hierarchies, tables, and presenter notes.
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
 * Extracts text from drawingML run/paragraph nodes.
 * @param {unknown} node
 * @returns {string}
 */
function extractDrawingMLText(node) {
  let text = '';
  if (!node) return text;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const child of node) text += extractDrawingMLText(child);
    return text;
  }
  if (typeof node === 'object') {
    const record = /** @type {Record<string, any>} */ (node);
    for (const key of Object.keys(record)) {
      if (key === ':@' || key === '#text') continue;
      if (key === 'a:t') {
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
      } else if (key === 'a:br') {
        text += '\n';
      } else {
        text += extractDrawingMLText(record[key]);
      }
    }
  }
  return text;
}

/**
 * Determines bullet level (0-based) from an <a:pPr> node.
 * @param {unknown} pNode
 * @returns {number}
 */
function getBulletLevel(pNode) {
  if (!pNode || !Array.isArray(pNode)) return 0;
  for (const child of pNode) {
    if (child && typeof child === 'object' && 'a:pPr' in child) {
      // Fast-xml-parser places element attributes on the same object under ':@'
      const directAttrs = child[':@'] || {};
      const directLvl = directAttrs['@_lvl'] ?? directAttrs['lvl'];
      if (directLvl !== undefined && !isNaN(parseInt(directLvl, 10))) {
        return parseInt(directLvl, 10);
      }

      // Check inside child['a:pPr'] if parsed as nested children
      const pPr = child['a:pPr'];
      if (Array.isArray(pPr)) {
        for (const item of pPr) {
          if (item && typeof item === 'object') {
            const attrs = item[':@'] || {};
            const lvl = attrs['@_lvl'] ?? attrs['lvl'];
            if (lvl !== undefined && !isNaN(parseInt(lvl, 10))) {
              return parseInt(lvl, 10);
            }
          }
        }
      } else if (pPr && typeof pPr === 'object') {
        const attrs = pPr[':@'] || {};
        const lvl = attrs['@_lvl'] ?? attrs['lvl'];
        if (lvl !== undefined && !isNaN(parseInt(lvl, 10))) {
          return parseInt(lvl, 10);
        }
      }
    }
  }
  return 0;
}

/**
 * Checks if a shape node is a slide title placeholder.
 * @param {unknown} spNode
 * @returns {boolean}
 */
function isTitleShape(spNode) {
  if (!spNode || !Array.isArray(spNode)) return false;
  for (const child of spNode) {
    if (child && typeof child === 'object' && 'p:nvSpPr' in child) {
      const nvSpPr = child['p:nvSpPr'];
      if (Array.isArray(nvSpPr)) {
        for (const nvChild of nvSpPr) {
          if (nvChild && typeof nvChild === 'object' && 'p:nvPr' in nvChild) {
            const nvPr = nvChild['p:nvPr'];
            if (Array.isArray(nvPr)) {
              for (const prItem of nvPr) {
                if (prItem && typeof prItem === 'object' && 'p:ph' in prItem) {
                  const attrs = prItem[':@'] || {};
                  const type = String(attrs['@_type'] || attrs['type'] || '').toLowerCase();
                  if (type === 'title' || type === 'ctrtitle') {
                    return true;
                  }
                  // Default placeholder with no type on first shape often acts as title
                  if (!type && (attrs['@_idx'] === '0' || attrs['idx'] === '0')) {
                    return true;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Extracts slides, titles, bullet hierarchies, and tables from PPTX presentation.
 * @param {File | Blob | ArrayBuffer | Uint8Array} input
 * @param {Object} [options]
 * @returns {Promise<import('./common.js').ExtractedDocument>}
 */
export async function extractPptx(input, options = {}) {
  const bytes = await toUint8Array(input);
  if (bytes.length === 0) {
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: { format: 'pptx', slideCount: 0 },
      warnings: [createExtractionWarning('EMPTY_INPUT', 'PPTX presentation was empty', 'warning')],
    });
  }

  const warnings = [];
  let archive;
  try {
    archive = await readZipArchive(bytes);
  } catch (err) {
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: { format: 'pptx', error: err.message },
      warnings: [createExtractionWarning('CORRUPT_ARCHIVE', `Invalid PPTX archive: ${err.message}`, 'error')],
    });
  }

  // Find all slide entries (e.g. ppt/slides/slide1.xml)
  const slideEntries = archive.findEntries(/^ppt\/slides\/slide\d+\.xml$/i);
  slideEntries.sort((a, b) => {
    const numA = parseInt(a.name.match(/\d+/)?.[0] || '0', 10);
    const numB = parseInt(b.name.match(/\d+/)?.[0] || '0', 10);
    return numA - numB;
  });

  if (slideEntries.length === 0) {
    warnings.push(createExtractionWarning('NO_SLIDES', 'No slides found in PPTX presentation', 'warning'));
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: { format: 'pptx', slideCount: 0 },
      warnings,
    });
  }

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: false,
  });

  const sections = [];
  const slideSummaries = [];
  let consolidatedMarkdown = '';
  let presentationTitle = null;

  for (let sIdx = 0; sIdx < slideEntries.length; sIdx++) {
    const slideNumber = sIdx + 1;
    const entry = slideEntries[sIdx];
    const xmlContent = await archive.readEntryText(entry.name);
    if (!xmlContent) continue;

    let parsed = [];
    try {
      parsed = parser.parse(xmlContent) || [];
    } catch {
      continue;
    }

    // Traverse to shape tree (p:spTree)
    let spTree = null;
    for (const root of parsed) {
      if (root['p:sld'] && Array.isArray(root['p:sld'])) {
        for (const sldChild of root['p:sld']) {
          if (sldChild && typeof sldChild === 'object' && 'p:cSld' in sldChild) {
            const cSld = sldChild['p:cSld'];
            if (Array.isArray(cSld)) {
              for (const cChild of cSld) {
                if (cChild && typeof cChild === 'object' && 'p:spTree' in cChild) {
                  spTree = cChild['p:spTree'];
                  break;
                }
              }
            }
          }
        }
      }
    }

    let slideTitle = null;
    const bullets = [];
    const tables = [];
    const paragraphLines = [];

    for (const shapeItem of (spTree || [])) {
      if (shapeItem['p:sp']) {
        const spNode = shapeItem['p:sp'];
        const isTitle = isTitleShape(spNode);

        // Find text body
        if (Array.isArray(spNode)) {
          for (const spChild of spNode) {
            if (spChild && typeof spChild === 'object' && 'p:txBody' in spChild) {
              const txBody = spChild['p:txBody'];
              if (Array.isArray(txBody)) {
                for (const bodyChild of txBody) {
                  if (bodyChild && typeof bodyChild === 'object' && 'a:p' in bodyChild) {
                    const pNode = bodyChild['a:p'];
                    const text = normalizeText(extractDrawingMLText(pNode)).trim();
                    if (!text) continue;

                    const level = getBulletLevel(pNode);

                    if (isTitle && !slideTitle) {
                      slideTitle = text;
                      if (!presentationTitle) {
                        presentationTitle = text;
                      }
                    } else {
                      bullets.push({ text, level });
                      const indent = '  '.repeat(level);
                      paragraphLines.push(`${indent}- ${text}`);
                    }
                  }
                }
              }
            }
          }
        }
      } else if (shapeItem['p:graphicFrame']) {
        // Check for table in graphic frame
        const gfNode = shapeItem['p:graphicFrame'];
        const gfText = JSON.stringify(gfNode);
        if (gfText.includes('a:tbl')) {
          // Extract table rows
          const rows = [];
          const findTable = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
              for (const item of node) findTable(item);
              return;
            }
            if ('a:tr' in node && Array.isArray(node['a:tr'])) {
              const cells = [];
              for (const cell of node['a:tr']) {
                if (cell && typeof cell === 'object' && 'a:tc' in cell) {
                  cells.push(normalizeText(extractDrawingMLText(cell['a:tc'])).trim());
                }
              }
              if (cells.length > 0) rows.push(cells);
            }
            for (const k of Object.keys(node)) {
              if (k !== ':@') findTable(node[k]);
            }
          };
          findTable(gfNode);
          if (rows.length > 0) {
            const tableMd = formatMarkdownTable(rows);
            tables.push(rows);
            paragraphLines.push('\n' + tableMd + '\n');
          }
        }
      }
    }

    // Check for speaker notes (e.g. ppt/notesSlides/notesSlide1.xml)
    let notes = null;
    const notesEntry = archive.findEntries(new RegExp(`ppt/notesSlides/notesSlide${slideNumber}\\.xml$`, 'i'))[0];
    if (notesEntry) {
      const notesXml = await archive.readEntryText(notesEntry.name);
      if (notesXml) {
        try {
          const notesParsed = parser.parse(notesXml);
          notes = normalizeText(extractDrawingMLText(notesParsed)).trim();
        } catch {
          // Ignore notes parse failure
        }
      }
    }

    const titleText = slideTitle || `Slide ${slideNumber}`;
    const slideMarkdown = `## Slide ${slideNumber}: ${titleText}\n\n` +
      (paragraphLines.length > 0 ? paragraphLines.join('\n') : '_No slide body text_') +
      (notes ? `\n\n> **Speaker Notes:** ${notes}` : '');

    consolidatedMarkdown += (consolidatedMarkdown ? '\n\n' : '') + slideMarkdown;

    const summary = {
      slideNumber,
      title: titleText,
      bullets,
      notes,
      tables,
    };
    slideSummaries.push(summary);

    sections.push(
      createExtractedSection({
        id: `slide_${slideNumber}`,
        title: titleText,
        level: slideNumber,
        type: 'slide',
        text: slideMarkdown,
        formatted: slideMarkdown,
        hierarchy: [titleText],
        metadata: {
          slideNumber,
          title: titleText,
          bullets,
          notes,
          tables,
          bulletCount: bullets.length,
          tableCount: tables.length,
        },
      })
    );
  }

  return createExtractedDocument({
    text: consolidatedMarkdown,
    sections,
    metadata: {
      format: 'pptx',
      title: presentationTitle || options.fileName || 'Presentation',
      slideCount: slideSummaries.length,
      slides: slideSummaries,
      tokenEstimate: estimateTokens(consolidatedMarkdown),
    },
    warnings,
  });
}
