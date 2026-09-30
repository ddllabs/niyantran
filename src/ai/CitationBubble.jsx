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

/*
 * The optional RAG v2 fields (chunk-contract spec, "Citation payload") never
 * decide readability: isReadableCitation ignores them, and sanitizeCitation
 * strips any that are malformed so the reader never draws a bad box or image.
 */
export const MAX_CITATION_BOXES = 20;
const SECTION_TEXT_MAX = 200;
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isPage = value => Number.isSafeInteger(value) && value >= 1;
const isUnit = value => typeof value === 'number' && value >= 0 && value <= 1;
const cleanBox = b => isPlainObject(b) && isPage(b.page) && [b.x0, b.y0, b.x1, b.y1].every(isUnit)
  && b.x0 <= b.x1 && b.y0 <= b.y1 ? { page: b.page, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null;
const cleanImage = i => isPlainObject(i) && isPage(i.page) && typeof i.sha256 === 'string' && /^[0-9a-f]{64}$/.test(i.sha256)
  && typeof i.mime === 'string' && /^image\/[\w.+-]+$/.test(i.mime) ? { page: i.page, sha256: i.sha256, mime: i.mime } : null;

/** A copy of a readable citation with malformed optional fields removed. */
export function sanitizeCitation(source) {
  if (!isTextCitation(source)) return source;
  const out = { ...source };
  if ('extract_hash' in out && !nonblank(out.extract_hash)) delete out.extract_hash;
  for (const [key, clean, max] of [['boxes', cleanBox, MAX_CITATION_BOXES], ['images', cleanImage, Infinity]]) {
    if (!(key in out)) continue;
    const kept = Array.isArray(out[key]) ? out[key].map(clean).filter(Boolean).slice(0, max) : [];
    if (kept.length) out[key] = kept;
    else delete out[key];
  }
  if ('section' in out) {
    const section = {};
    for (const key of ['heading', 'note']) {
      if (isPlainObject(out.section) && typeof out.section[key] === 'string') section[key] = out.section[key].slice(0, SECTION_TEXT_MAX);
    }
    if (Object.keys(section).length) out.section = section;
    else delete out.section;
  }
  return out;
}

export function CitationPlaceholder() {
  return (
    <span className="cite-bubble placeholder" aria-hidden="true">
      •
    </span>
  );
}

export default function CitationBubble({ n, source: raw, onOpen }) {
  if (!isReadableCitation(raw) || n !== raw.id) return null;
  const source = sanitizeCitation(raw);
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
