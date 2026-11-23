// Search every desk: module names on the phone, records through nter.pro's desk search.
import { useEffect, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { api } from '../services/index.js';
import { ALL_MODULES, searchModules } from '../data/desks.js';
import Icon from '../ui/Icon.jsx';
import { Spinner } from '../ui/kit.jsx';
import { moduleIcon } from './Sector.jsx';

export default function Search() {
  const { pop, push } = useApp();
  const [q, setQ] = useState('');
  const [records, setRecords] = useState({ q: '', rows: [], loading: false, error: '' });
  const modules = searchModules(q);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 3) { setRecords({ q: s, rows: [], loading: false, error: '' }); return undefined; }
    const ctrl = new AbortController();
    setRecords((r) => ({ ...r, loading: true, error: '' }));
    const t = setTimeout(() => {
      api.searchRecords(s, { signal: ctrl.signal })
        .then((rows) => { if (!ctrl.signal.aborted) setRecords({ q: s, rows, loading: false, error: '' }); })
        .catch((e) => { if (!ctrl.signal.aborted) setRecords({ q: s, rows: [], loading: false, error: e.message || 'Record search is unavailable.' }); });
    }, 450);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const openRecord = (r) => {
    const module = ALL_MODULES.find((m) => m.desk === r.desk && m.feature === r.feature) || ALL_MODULES.find((m) => m.feature === r.feature);
    if (module) push({ v: 'record', module, row: r.row });
  };

  return (
    <div className="view push">
      <div className="hdr line">
        <div className="search" style={{ margin: 0, flex: 1 }}>
          <Icon name="search" />
          <input type="search" autoFocus placeholder="Search desks, modules and records" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        <button type="button" className="ib" onClick={pop} style={{ width: 'auto', padding: '0 8px', fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Cancel</button>
      </div>
      <div className="body">
        {!q.trim() ? <div className="empty"><b>Search every register</b>Bills, questions, orders, releases, markets and more. Try “tribunal”, “Kerala” or “carbon”.</div> : null}
        {modules.length ? (
          <>
            <div className="numhd">MODULES</div>
            <div className="list">
              {modules.slice(0, 8).map((m) => (
                <button key={`${m.desk}:${m.feature}`} type="button" className="rrow" onClick={() => push({ v: 'module', module: m })}>
                  <span className="ico"><Icon name={moduleIcon(m)} /></span>
                  <span className="tx"><b>{m.title}</b><span>{m.deskName} · {m.groupName}</span></span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {q.trim().length >= 3 ? <div className="numhd">RECORDS</div> : null}
        {records.loading ? <Spinner label="Searching records" /> : null}
        {records.error ? <div className="note-strip">{records.error}</div> : null}
        <div className="list">
          {records.rows.map((r, i) => (
            <button key={`${r.feature}:${r.rowKey || i}`} type="button" className="rrow" onClick={() => openRecord(r)}>
              <span className="ico"><Icon name="doc" /></span>
              <span className="tx"><b>{r.title}</b><span>{r.feature}</span></span>
            </button>
          ))}
          {q.trim().length >= 3 && !records.loading && !records.rows.length && !records.error ? <div className="empty"><b>No records match</b>Try a different word.</div> : null}
        </div>
      </div>
    </div>
  );
}
