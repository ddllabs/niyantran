// A module's records, from the same /api/feature-feed nter.pro reads. Large modules page on the
// server; the rest filter on the phone.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { api } from '../services/index.js';
import { useAsync } from '../lib/useAsync.js';
import { recordAttachment, rowTitle } from '../services/shape.js';
import { PAGED_FEATURES } from '../data/desks.js';
import Icon from '../ui/Icon.jsx';
import { Header, Spinner, TabBar, ErrorLine, fmtNum } from '../ui/kit.jsx';
import { moduleIcon } from './Sector.jsx';

const STAGE_KEYS = ['current_stage', 'stage', 'status', 'outcome', 'result'];
export const rowStage = (row) => {
  for (const k of STAGE_KEYS) { const v = row?.[k]; if (typeof v === 'string' && v.trim() && v.length < 40) return v.trim(); }
  return '';
};
export const rowKeyOf = (module, row) => `${module.tier}::${module.feature}::${rowTitle(row)}::${row.date || row.date_introduced || row.id || ''}`;

export function RecordRow({ module, row, columns, onOpen }) {
  const chat = useChat();
  const { toast } = useApp();
  const title = rowTitle(row, module.title);
  const stage = rowStage(row);
  const meta = (columns || []).map((c) => row[c.key]).filter((v) => v != null && v !== '' && typeof v !== 'object' && String(v) !== title && String(v) !== stage).slice(0, 3).map(String);
  const attach = () => {
    const key = rowKeyOf(module, row);
    chat.attach({ ...recordAttachment({ row, module }), key, label: title, icon: 'doc', record: { module, row, title, key } });
    toast('Attached to Ask AI');
  };
  return (
    <div className="rrow" style={{ alignItems: 'center' }}>
      <button type="button" style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0, textAlign: 'left', alignItems: 'flex-start' }} onClick={onOpen}>
        <span className="ico"><Icon name={moduleIcon(module)} /></span>
        <span className="tx"><b>{title}</b>{meta.length ? <span className="cols">{meta.join(' · ')}</span> : null}</span>
      </button>
      {stage ? <span className={`stg ${/pend|lapse|await/i.test(stage) ? 'warn' : /pass|assent|enact|disposed|final|won/i.test(stage) ? 'ok' : ''}`}>{stage}</span> : null}
      <button type="button" className="ib" style={{ width: 34, height: 34, color: 'var(--accent)' }} onClick={attach} aria-label="Attach to Ask AI"><Icon name="clip" /></button>
    </div>
  );
}

export default function ModuleScreen({ module }) {
  const { push, watchlist, toggleWatch } = useApp();
  const chat = useChat();
  const { openChat } = useStudio();
  const paged = PAGED_FEATURES.has(module.feature);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQuery(q); setPage(1); }, paged ? 400 : 0); return () => clearTimeout(t); }, [q, paged]);

  const feed = useAsync((signal) => api.moduleFeed({ module, page, q: paged ? query : '', signal }), [module.tier, module.feature, page, paged ? query : '']);
  const rows = useMemo(() => {
    const all = feed.data?.rows || [];
    if (paged || !query.trim()) return all;
    const s = query.trim().toLowerCase();
    return all.filter((r) => JSON.stringify(r).toLowerCase().includes(s));
  }, [feed.data, paged, query]);
  const watched = watchlist.some((w) => w.tab === module.desk && w.feature === module.feature);
  const total = feed.data?.total || 0;
  const pages = paged && feed.data?.pageSize ? Math.max(1, Math.ceil(total / feed.data.pageSize)) : 1;
  const src = feed.data?.source;

  const ask = () => {
    chat.setDeskContext({ tier: module.desk, feature: module.feature });
    chat.setDraft(`What stands out in ${module.title} right now?`);
    openChat();
  };

  return (
    <div className="view push">
      <Header back line title={module.title} sub={`${(module.groupName || module.deskName || '').toUpperCase()} · ${feed.data?.fallback ? 'SAVED COPY' : feed.data?.sample ? 'SAMPLE' : 'LIVE FEED'}`}
        right={<button type="button" className={`ib ${watched ? 'on' : ''}`} onClick={() => toggleWatch({ tab: module.desk, feature: module.feature, label: module.title })} aria-label={watched ? 'Stop watching' : 'Watch this module'} aria-pressed={watched}><Icon name="bell" /></button>} />
      <div className="body">
        <div className="search" style={{ margin: '10px 16px' }}>
          <Icon name="search" />
          <input type="search" placeholder={paged ? `Search ${fmtNum(total)} records` : 'Filter this table'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {feed.data?.fallback ? <div className="note-strip">The live feed did not answer, so this is the copy saved with the app.</div> : null}
        <div className="table-hd"><span>{feed.loading ? 'LOADING' : `${fmtNum(paged ? total : rows.length)} RECORD${(paged ? total : rows.length) === 1 ? '' : 'S'}${!paged && total > rows.length && !query ? ` OF ${fmtNum(total)}` : ''}`}</span><span>STAGE</span></div>
        {feed.loading && !feed.data ? <Spinner label="Loading records" /> : null}
        <ErrorLine error={feed.error} onRetry={feed.reload} />
        <div className="list">
          {rows.map((row, i) => <RecordRow key={i} module={module} row={row} columns={feed.data?.columns} onOpen={() => push({ v: 'record', module, row, rows: feed.data?.rows || rows, feed: feed.data || null })} />)}
          {!feed.loading && !rows.length && !feed.error ? <div className="empty"><b>{query ? 'No records match' : 'No records to show yet'}</b>{query ? 'Try fewer words.' : 'This module has nothing published for now.'}</div> : null}
        </div>
        {paged && pages > 1 ? (
          <div className="pager">
            <button type="button" disabled={page <= 1 || feed.loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>PAGE {page} OF {fmtNum(pages)}</span>
            <button type="button" disabled={page >= pages || feed.loading} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        ) : null}
        {src?.note || feed.data?.coverage ? (
          <div className="srcline">SOURCE · {String(src?.note || src?.adapter || '').toUpperCase()}{feed.data?.coverage?.from ? ` · ${feed.data.coverage.from} → ${String(feed.data.coverage.through || '').toUpperCase()}` : ''}</div>
        ) : null}
        <div style={{ padding: '14px 16px 24px' }}>
          <button type="button" className="pbtn sm soft" onClick={ask}><Icon name="sparkle" />Ask AI about this module</button>
        </div>
      </div>
      <TabBar />
    </div>
  );
}
