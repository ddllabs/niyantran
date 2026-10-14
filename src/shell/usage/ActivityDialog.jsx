/**
 * Section C (F153): "All AI activity", opened over the Credits usage page like TenderBase's dialog.
 * Holds the filters, the page, the expanded rows and the export; ActivityTable.jsx draws them. The
 * page closes it on Escape. The export reads every matching row (up to 2,000) and saves a CSV in
 * credits with their rupee value.
 */
import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_PAGE, loadAllActivity, loadUsageActivity } from '../../lib/creditUsage.js';
import { activityCsv, downloadCsv } from '../../lib/usageCsv.js';
import ActivityTable from './ActivityTable.jsx';

export const FIRST_FILTERS = { model: null, status: 'all', kind: 'all', grouped: true };

/** A filter change starts again from the first page with nothing expanded. */
export function nextFilters(filters, patch) {
  return { ...filters, ...patch };
}

export function toggled(set, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

export function csvName(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return `niyantran-ai-activity-${day}.csv`;
}

export default function ActivityDialog({
  models = [], rate = null, onClose, onOpenChat,
  load = loadUsageActivity, loadAll = loadAllActivity, download = downloadCsv,
}) {
  const [filters, setFilters] = useState(FIRST_FILTERS);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ status: 'loading', total: 0, rows: [] });
  const [expanded, setExpanded] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const card = useRef(null);

  useEffect(() => { card.current?.focus(); }, []);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.resolve(load({ ...filters, offset, limit: ACTIVITY_PAGE })).then((page) => {
      if (!live) return;
      setState(page ? { status: 'ready', total: page.total, rows: page.rows } : { status: 'error', total: 0, rows: [] });
    });
    return () => { live = false; };
  }, [filters, offset, load]);

  function onFilter(patch) {
    setFilters((f) => nextFilters(f, patch));
    setOffset(0);
    setExpanded(new Set());
  }

  async function onExport() {
    setExporting(true);
    setExportError('');
    const rows = await loadAll(filters);
    setExporting(false);
    if (!rows) { setExportError('The export could not be prepared just now.'); return; }
    download(csvName(), activityCsv(rows, rate, { withCalls: filters.grouped }));
  }

  return (
    <div className="cu-dialog-root">
      <button type="button" className="cu-scrim" aria-label="Close all AI activity" tabIndex={-1} onClick={() => onClose?.()} />
      <div className="cu-dialog" role="dialog" aria-modal="true" aria-labelledby="cu-all-title" ref={card} tabIndex={-1}>
        <div className="cu-head">
          <div>
            <p className="cu-kicker">CREDITS USAGE</p>
            <h2 id="cu-all-title">All AI activity</h2>
          </div>
          <button type="button" className="cu-x" aria-label="Close" onClick={() => onClose?.()}>×</button>
        </div>
        <ActivityTable
          state={state}
          filters={filters}
          offset={offset}
          pageSize={ACTIVITY_PAGE}
          expanded={expanded}
          models={models}
          rate={rate}
          exporting={exporting}
          exportError={exportError}
          onFilter={onFilter}
          onPage={(next) => { setOffset(next); setExpanded(new Set()); }}
          onToggleRow={(key) => setExpanded((set) => toggled(set, key))}
          onOpenChat={onOpenChat}
          onExport={onExport}
        />
      </div>
    </div>
  );
}
