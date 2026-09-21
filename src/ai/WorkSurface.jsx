/**
 * Work mode is the viewer (streaming spec §G, owner's decision 2026-09-21).
 * The button no longer changes the prompt — the evidence-first discipline is
 * always on — it opens this layer over the thread, which holds whatever
 * source the reader asked to see: the document reader for a text citation,
 * the record for a row. The panel stays the single right-side surface.
 */
import RowSource from './RowSource.jsx';
import SourceList from './SourceList.jsx';
import SourceReader from './SourceReader.jsx';

export default function WorkSurface({ viewer, sources = [], onOpen, onClose }) {
  if (!viewer) return null;
  const source = viewer.source || null;

  return (
    <div className="ai-work-surface" role="region" aria-label="Evidence">
      <div className="ai-work-bar">
        <button type="button" className="ai-work-back" onClick={onClose} aria-label="Back to the answer">
          ← Back
        </button>
        <span className="ai-work-title">
          {source ? (source.kind === 'row' ? source.title || source.row_key : source.title) : 'Sources'}
        </span>
      </div>

      <div className="ai-work-body">
        {source?.kind === 'text' ? <SourceReader citation={source} onClose={onClose} /> : null}
        {source?.kind === 'row' ? <RowSource citation={source} onClose={onClose} /> : null}
        {!source ? (
          sources.length ? <SourceList sources={sources} onOpen={onOpen} /> : <p className="rail-empty">This answer cites no sources yet.</p>
        ) : null}
      </div>
    </div>
  );
}
