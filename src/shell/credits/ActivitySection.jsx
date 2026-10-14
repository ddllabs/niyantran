/**
 * The credits page's Activity section (F184 spec §3.4; F153's "All AI activity", now in the page
 * instead of a dialog). Holds the filters, the page, the opened rows, the per-chat totals and the
 * export; ActivityTable.jsx draws them. The export reads every matching row (up to 2,000) and saves a
 * CSV in credits. "Group by chat" totals the same rows on the client (no per-chat report exists).
 */
import { useEffect, useState } from 'react';
import { ACTIVITY_PAGE, loadAllActivity, loadUsageActivity } from '../../lib/creditUsage.js';
import { groupByChat } from '../../lib/creditsVisual.js';
import { activityCsv, downloadCsv } from '../../lib/usageCsv.js';
import ActivityTable from '../usage/ActivityTable.jsx';

export const FIRST_FILTERS = { model: null, status: 'all', kind: 'all', grouped: true, byChat: false };
const CAP = 2000;

/** A filter change starts again from the first page with nothing opened. */
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

/** What the report is asked for: the server knows nothing of the client-only "by chat" view. */
function reportFilters({ byChat, ...rest }) {
  return byChat ? { ...rest, grouped: true } : rest;
}

export default function ActivitySection({
  models = [], onOpenChat,
  load = loadUsageActivity, loadAll = loadAllActivity, download = downloadCsv,
}) {
  const [filters, setFilters] = useState(FIRST_FILTERS);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState({ status: 'loading', total: 0, rows: [] });
  const [chats, setChats] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.resolve(load({ ...reportFilters(filters), offset, limit: ACTIVITY_PAGE })).then((page) => {
      if (!live) return;
      setState(page ? { status: 'ready', total: page.total, rows: page.rows } : { status: 'error', total: 0, rows: [] });
    });
    return () => { live = false; };
  }, [filters, offset, load]);

  useEffect(() => {
    if (!filters.byChat) return undefined;
    let live = true;
    setChats({ status: 'loading', groups: [] });
    Promise.resolve(loadAll(reportFilters(filters), CAP)).then((rows) => {
      if (!live) return;
      setChats(rows ? { status: 'ready', groups: groupByChat(rows), capped: rows.length >= CAP } : { status: 'error', groups: [] });
    });
    return () => { live = false; };
  }, [filters, loadAll]);

  function onFilter(patch) {
    setFilters((f) => nextFilters(f, patch));
    setOffset(0);
    setExpanded(new Set());
  }

  async function onExport() {
    setExporting(true);
    setExportError('');
    const rows = await loadAll(reportFilters(filters), CAP);
    setExporting(false);
    if (!rows) { setExportError('The export could not be prepared just now.'); return; }
    download(csvName(), activityCsv(rows, { withCalls: filters.grouped || filters.byChat }));
  }

  return (
    <ActivityTable
      state={state}
      chats={chats}
      filters={filters}
      offset={offset}
      pageSize={ACTIVITY_PAGE}
      expanded={expanded}
      models={models}
      exporting={exporting}
      exportError={exportError}
      onFilter={onFilter}
      onPage={(next) => { setOffset(next); setExpanded(new Set()); }}
      onToggleRow={(key) => setExpanded((set) => toggled(set, key))}
      onOpenChat={onOpenChat}
      onExport={onExport}
    />
  );
}
