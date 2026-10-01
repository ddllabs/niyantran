/**
 * The page bar shared by the PDF and Text views (docs/specs/2026-10-01-rag-v2-citations-pdf.md,
 * "The flow" step 7): where the reader is, where the citation is, and the way back to it.
 * Keys are handled by the viewer through `onKeyDown`, so they are bound to these controls only.
 */
import { sectionLabel } from './viewerModel.js';

/**
 * @param {{page: number, total: number, cited: number, section?: {heading?: string, note?: string},
 *   onPage: (page: number) => void, onKeyDown?: (event: KeyboardEvent) => void}} props
 */
export default function PageBar({ page, total, cited, section, onPage, onKeyDown }) {
  const label = sectionLabel(section);
  return (
    <div className="pv-bar" onKeyDown={onKeyDown}>
      {label ? <p className="pv-section">{label}</p> : null}
      <div className="pv-bar-row" role="toolbar" aria-label="Pages">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-keyshortcuts="ArrowLeft [">
          ‹ Previous
        </button>
        <span className="pv-bar-label">{`Page ${page} of ${total} · cited on page ${cited}`}</span>
        <button type="button" disabled={page >= total} onClick={() => onPage(page + 1)} aria-keyshortcuts="ArrowRight ]">
          Next ›
        </button>
        <button type="button" className="pv-bar-back" disabled={page === cited} onClick={() => onPage(cited)} aria-keyshortcuts="Home">
          Back to citation
        </button>
      </div>
      <span className="pv-sr" aria-live="polite">{`Page ${page} of ${total}`}</span>
    </div>
  );
}
