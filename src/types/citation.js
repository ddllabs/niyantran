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
 * @property {string} [document_role]  F116: the bill version, one of DOCUMENT_ROLE_LABELS' keys
 * @property {string} [publisher]  F332: who published the document, a name the server chose from a fixed table;
 *   absent when unknown and on every citation saved before the field existed
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

/** F116: the server twin is DOCUMENT_ROLE_LABELS in supabase/functions/_shared/retrieval.ts. */
export const DOCUMENT_ROLE_LABELS = {
  as_introduced: 'As introduced',
  as_passed_lok_sabha: 'As passed by Lok Sabha',
  as_passed_rajya_sabha: 'As passed by Rajya Sabha',
  as_passed_both_houses: 'As passed by both Houses',
  gazette_notification: 'Gazette notification',
  errata: 'Errata',
  synopsis: 'Synopsis',
};

/** The label for a known role; '' for none or anything else. */
export function documentRoleLabel(role) {
  return typeof role === 'string' && Object.hasOwn(DOCUMENT_ROLE_LABELS, role) ? DOCUMENT_ROLE_LABELS[role] : '';
}

/** F332: the longest publisher name; the server twin is PUBLISHER_MAX_CHARS in supabase/functions/_shared/publisher.ts. */
export const PUBLISHER_MAX_CHARS = 80;

/** F332: the words before a publisher's name. Localised only where a language is already passed. */
export const PUBLISHER_LABEL = { en: 'Published by', hi: 'प्रकाशक:' };

/**
 * A publisher worth showing: a string of 1 to 80 characters that is not blank, holds no control, format or line-separator
 * character and no `ref:` handle. The server only ever sends names from its own table; this is the browser's own check.
 */
export function validPublisher(value) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= PUBLISHER_MAX_CHARS
    && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value) && !/ref:/i.test(value);
}

/** The publisher of a text citation, or '' when it has none, an invalid one, or is not a text citation. */
export function publisherName(source) {
  return isTextCitation(source) && validPublisher(source.publisher) ? source.publisher : '';
}

/** "Published by <name>" (Hindi: "प्रकाशक: <name>") for a name; '' for none. */
export function publisherPhrase(name, lang) {
  return name ? `${lang === 'hi' ? PUBLISHER_LABEL.hi : PUBLISHER_LABEL.en} ${name}` : '';
}

/** The publisher line of a text citation; '' when it has none. */
export function publisherLine(source, lang) {
  return publisherPhrase(publisherName(source), lang);
}

/** @param {unknown} s @returns {s is TextCitation} */
export function isTextCitation(s) {
  return Boolean(s) && typeof s === 'object' && s.kind === 'text' && typeof s.chunk_id === 'string';
}

/** @param {unknown} s @returns {s is RowCitation} */
export function isRowCitation(s) {
  return Boolean(s) && typeof s === 'object' && s.kind === 'row' && typeof s.row_key === 'string';
}
