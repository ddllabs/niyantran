/**
 * A resolved [n] marker (streaming spec §G). Clicking it opens the evidence:
 * the document reader for a text citation, the record for a row. While an
 * answer is still streaming an unresolved marker keeps a fixed-footprint
 * placeholder so the paragraph does not reflow when its source arrives; once
 * the turn has finished, a marker with nothing behind it is dropped rather
 * than left as a bracket the reader cannot open.
 */
import { isTextCitation, isRowCitation } from '../types/citation.js';
import './research.css';

const nonblank = value => typeof value === 'string' && Boolean(value.trim());
/** The shared type guards identify the union; reader fields need validation too. */
export function isReadableCitation(source) {
  if (!source || !Number.isSafeInteger(source.id) || source.id < 1 || !nonblank(source.title)) return false;
  if (isTextCitation(source)) return ['file_name', 'file_url', 'desk_feature', 'desk_tier'].every(k => source[k] == null || typeof source[k] === 'string')
    && nonblank(source.chunk_id) && nonblank(source.document_id)
    && Number.isSafeInteger(source.char_from) && source.char_from >= 0
    && Number.isSafeInteger(source.char_to) && source.char_to > source.char_from && nonblank(source.text_hash)
    && ['document', 'pdf_page'].includes(source.source_kind)
    && (source.source_kind !== 'pdf_page' || (Number.isSafeInteger(source.page_number) && source.page_number > 0));
  if (isRowCitation(source)) return nonblank(source.row_key) && nonblank(source.tier) && nonblank(source.feature)
    && source.row_snapshot && typeof source.row_snapshot === 'object' && !Array.isArray(source.row_snapshot)
    && Object.keys(source.row_snapshot).length > 0 && Object.values(source.row_snapshot).every(v => typeof v === 'string')
    && (source.snapshot_at === null || (nonblank(source.snapshot_at) && Number.isFinite(Date.parse(source.snapshot_at))));
  return false;
}

export function CitationPlaceholder() {
  return (
    <span className="cite-bubble placeholder" aria-hidden="true">
      •
    </span>
  );
}

export default function CitationBubble({ n, source, onOpen }) {
  if (!isReadableCitation(source) || n !== source.id) return null;
  const label = source.kind === 'row'
    ? `${source.title || source.row_key} — ${source.feature}`
    : `${source.title}${source.desk_feature ? ` — ${source.desk_feature}` : ''}`;
  return (
    <button
      type="button"
      className={`cite-bubble${source.kind === 'row' ? ' row' : ''}`}
      title={label}
      aria-label={`Source ${n}: ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen?.(source);
      }}
    >
      {n}
    </button>
  );
}
