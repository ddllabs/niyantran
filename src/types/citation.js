// CitationSource — one namespace, two kinds. The server twin is
// supabase/functions/_shared/citation.types.ts. This file is owned by
// document-rag-and-citations (spec §H); desk-row-grounding consumes the `row`
// variant and never edits it.

/**
 * @typedef {Object} TextCitation
 * @property {number} id
 * @property {'text'} kind
 * @property {string} chunk_id
 * @property {string} document_id
 * @property {string} title
 * @property {string} [file_name]
 * @property {string} [file_url]
 * @property {string} [desk_tier]
 * @property {string} [desk_feature]
 * @property {number} char_from
 * @property {number} char_to
 * @property {string} text_hash   sha256(normalise(content)) as stored when cited
 * @property {'document' | 'pdf_page'} source_kind
 * @property {number} [page_number]   physical page, 1-based (not the printed label)
 * @property {string} [extract_hash]  the extraction the boxes belong to; a mismatch
 *   with the document's current one means the boxes are stale and are not drawn
 * @property {CitationBox[]} [boxes]  at most 20, resolved from the chunk's block ids
 * @property {CitationImage[]} [images]  content-addressed page images
 * @property {{heading?: string, note?: string}} [section]
 *
 * The optional RAG v2 fields above (chunk-contract spec, "Citation payload")
 * never make a citation unreadable: `sanitizeCitation` in
 * src/ai/CitationBubble.jsx strips any that are malformed.
 */

/**
 * @typedef {Object} CitationBox   normalised to the page, 0..1, x0 <= x1, y0 <= y1
 * @property {number} page   physical page, integer >= 1
 * @property {number} x0
 * @property {number} y0
 * @property {number} x1
 * @property {number} y1
 */

/**
 * @typedef {Object} CitationImage
 * @property {number} page     physical page, integer >= 1
 * @property {string} sha256   64 lowercase hex characters
 * @property {string} mime     an image/* media type
 */

/**
 * @typedef {Object} RowCitation
 * @property {number} id
 * @property {'row'} kind
 * @property {string} tier
 * @property {string} feature
 * @property {string} row_key
 * @property {string} title
 * @property {Record<string, string>} row_snapshot   the slim row as cited
 * @property {string | null} snapshot_at             null for the injected selection
 */

/** @typedef {TextCitation | RowCitation} CitationSource */

/** @param {unknown} s @returns {s is TextCitation} */
export function isTextCitation(s) {
  return Boolean(s) && typeof s === 'object' && s.kind === 'text' && typeof s.chunk_id === 'string';
}

/** @param {unknown} s @returns {s is RowCitation} */
export function isRowCitation(s) {
  return Boolean(s) && typeof s === 'object' && s.kind === 'row' && typeof s.row_key === 'string';
}
