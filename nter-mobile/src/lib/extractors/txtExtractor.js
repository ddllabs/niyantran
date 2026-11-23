/**
 * Plain Text and Markdown Document Extractor for NTER Mobile.
 * Normalizes UTF-8, handles BOM, paragraph-aware segmentation, and markdown structure.
 */

import {
  createExtractedDocument,
  createExtractedSection,
  createExtractionWarning,
  toUint8Array,
  normalizeText,
  estimateTokens,
} from './common.js';

/**
 * Extracts structured sections and paragraphs from plain text or markdown.
 * @param {File | Blob | ArrayBuffer | Uint8Array | string} input
 * @param {Object} [options]
 * @returns {Promise<import('./common.js').ExtractedDocument>}
 */
export async function extractTxt(input, options = {}) {
  let rawText = '';
  if (typeof input === 'string') {
    rawText = input;
  } else {
    const bytes = await toUint8Array(input);
    try {
      rawText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (err) {
      return createExtractedDocument({
        text: '',
        sections: [],
        metadata: { format: 'txt', error: err.message },
        warnings: [createExtractionWarning('DECODING_ERROR', `Failed to decode text: ${err.message}`, 'error')],
      });
    }
  }

  const normalized = normalizeText(rawText);
  const warnings = [];

  if (!normalized.trim()) {
    warnings.push(createExtractionWarning('EMPTY_TEXT', 'Text input is empty', 'info'));
    return createExtractedDocument({
      text: '',
      sections: [],
      metadata: {
        format: 'txt',
        paragraphCount: 0,
        headingCount: 0,
        tokenEstimate: 0,
        charCount: 0,
        wordCount: 0,
      },
      warnings,
    });
  }

  const paragraphs = [];
  const sections = [];
  const headingHierarchy = [];
  let headingCount = 0;
  let paragraphCount = 0;
  let docTitle = null;

  // Split text by multiple newlines into semantic blocks
  const blocks = normalized.split(/\n\s*\n+/);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    // Check for markdown headings (# Heading)
    const headingMatch = /^(#{1,6})\s+(.+)$/m.exec(block);
    if (headingMatch && block.startsWith('#')) {
      headingCount++;
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      while (headingHierarchy.length >= level) {
        headingHierarchy.pop();
      }
      headingHierarchy.push(title);

      if (!docTitle && (level === 1 || headingCount === 1)) {
        docTitle = title;
      }

      sections.push(
        createExtractedSection({
          id: `sec_${sections.length + 1}`,
          title,
          level,
          type: 'heading',
          text: block,
          formatted: block,
          hierarchy: [...headingHierarchy],
          metadata: {
            headingLevel: level,
          },
        })
      );
    } else {
      paragraphCount++;
      paragraphs.push(block);

      sections.push(
        createExtractedSection({
          id: `p_${sections.length + 1}`,
          title: headingHierarchy.length ? headingHierarchy[headingHierarchy.length - 1] : null,
          level: null,
          type: 'paragraph',
          text: block,
          formatted: block,
          hierarchy: [...headingHierarchy],
          metadata: {
            activeHeading: headingHierarchy.length ? headingHierarchy[headingHierarchy.length - 1] : null,
          },
        })
      );
    }
  }

  const wordCount = normalized.trim().split(/\s+/).filter(Boolean).length;

  return createExtractedDocument({
    text: normalized,
    sections,
    metadata: {
      format: 'txt',
      title: docTitle || options.fileName || 'Text Document',
      paragraphCount,
      headingCount,
      sectionCount: sections.length,
      charCount: normalized.length,
      wordCount,
      tokenEstimate: estimateTokens(normalized),
    },
    warnings,
  });
}
