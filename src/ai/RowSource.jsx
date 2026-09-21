/**
 * The viewer for a `row` citation (desk-row-grounding spec §G): the record
 * detail the desk itself opens, rendered from the cited snapshot with no
 * fetch, plus "Open in desk" and the captured-on date. Mounted by the
 * agent module's Work-mode surface next to SourceReader.
 */
import RecordDetail from '../shell/RecordDetail.jsx';
import { openInDesk } from './openRowSource.js';

function capturedOn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export default function RowSource({ citation, onClose }) {
  if (!citation || citation.kind !== 'row' || !citation.row_snapshot) return null;
  const captured = capturedOn(citation.snapshot_at);
  const feed = { feature: citation.feature, tier: citation.tier, rows: [] };
  return (
    <div className="row-source">
      <div className="row-source-bar">
        <span className="tag">{citation.feature}</span>
        {captured ? <span className="row-source-captured">as captured on {captured}</span> : null}
        {captured ? (
          <button type="button" className="row-source-open" onClick={() => openInDesk(citation)}>
            Open in desk
          </button>
        ) : null}
      </div>
      <RecordDetail row={citation.row_snapshot} feed={feed} onClear={onClose} />
    </div>
  );
}
