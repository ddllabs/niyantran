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
 * @property {number} [page_number]
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
