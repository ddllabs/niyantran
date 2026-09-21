/**
 * A resolved [n] marker (streaming spec §G). Clicking it opens the evidence:
 * the document reader for a text citation, the record for a row. While an
 * answer is still streaming an unresolved marker keeps a fixed-footprint
 * placeholder so the paragraph does not reflow when its source arrives; once
 * the turn has finished, a marker with nothing behind it is dropped rather
 * than left as a bracket the reader cannot open.
 */
export function CitationPlaceholder() {
  return (
    <span className="cite-bubble placeholder" aria-hidden="true">
      •
    </span>
  );
}

export default function CitationBubble({ n, source, onOpen }) {
  if (!source) return null;
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
