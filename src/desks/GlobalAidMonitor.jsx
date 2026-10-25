import { useWorkspaceState } from '../shell/workspaceState.js';
import { useEffect, useMemo, useState } from 'react';
import { compact, hydrateAppeal, money, statsFor } from '../lib/globalAid.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop, { choiceGroup, matchesChoice } from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import { liveApiEnabled } from '../lib/apiMode.js';

export default function GlobalAidMonitor({ workspaceScope = '', feed, selected, onSelect, vizFilter, onClearViz }) {
  const list = useMemo(
    () => (feed?.rows || []).map((r) => hydrateAppeal(r)).filter((p) => p?.id),
    [feed],
  );
  const [q, setQ] = useWorkspaceState('GlobalAidMonitor.q', '', workspaceScope);
  const [region, setRegion] = useWorkspaceState('GlobalAidMonitor.region', '', workspaceScope);
  const [agency, setAgency] = useWorkspaceState('GlobalAidMonitor.agency', '', workspaceScope);
  const [type, setType] = useWorkspaceState('GlobalAidMonitor.type', '', workspaceScope);
  const [liveOpen, setLiveOpen] = useState(false);
  const [live, setLive] = useState(null);
  const [liveErr, setLiveErr] = useState('');

  const regions = useMemo(() => [...new Set(list.map((p) => p.region).filter(Boolean))].sort(), [list]);
  const agencies = useMemo(() => [...new Set(list.map((p) => p.agency).filter(Boolean))].sort(), [list]);
  const types = useMemo(() => [...new Set(list.map((p) => p.type).filter(Boolean))].sort(), [list]);
  const stats = useMemo(() => statsFor(list), [list]);
  const selectedId = selected?.id || selected?.__gaId || '';
  const current = list.find((p) => p.id === selectedId) || list[0];
  const wire = feed?.meta?.wire || [];

  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    return list.filter((p) => {
      if (!matchesChoice(region, p.region)) return false;
      if (!matchesChoice(agency, p.agency)) return false;
      if (!matchesChoice(type, p.type)) return false;
      if (!applyVizFilter(p.row || p, vizFilter)) return false;
      if (!n) return true;
      const hay = [p.name, p.agency, p.region, p.geography, p.type, p.sectors.join(' '), p.latest].join(' ').toLowerCase();
      return hay.includes(n);
    });
  }, [list, q, region, agency, type, vizFilter]);

  useEffect(() => {
    if (!list.length) return;
    if (selected && list.some((p) => p.id === (selected.id || selected.__gaId))) return;
    onSelect?.(list[0].row);
  }, [list, selected, onSelect]);

  useEffect(() => {
    if (!liveOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setLiveOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [liveOpen]);

  useEffect(() => {
    if (!liveOpen) return undefined;
    if (!liveApiEnabled()) {
      setLiveErr('Live FTS API is not deployed on this host.');
      return undefined;
    }
    const ac = new AbortController();
    setLiveErr('');
    fetch(`/api/fts?year=${new Date().getFullYear()}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((body) => {
        if (ac.signal.aborted) return;
        if (!body?.ok && !body?.plans?.length) throw new Error(body?.error || 'empty');
        setLive(body);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setLiveErr(e.message || String(e));
      });
    return () => ac.abort();
  }, [liveOpen]);

  function pick(p) {
    onSelect?.(p.row || p);
  }

  if (!list.length) {
    return <div className="alw-empty-page">Aid register is unavailable.</div>;
  }

  return (
    <div className="alw-desk gaw-desk">
      <div className="feed-head">
        <h1>GLOBAL AID</h1>
        <button
          type="button"
          className={`live-feed on${liveOpen ? ' is-open' : ''}`}
          onClick={() => setLiveOpen((v) => !v)}
          aria-pressed={liveOpen}
          title="Open live UN OCHA FTS funding"
        >
          ✓ LATEST
        </button>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          extraGroups={[
            choiceGroup('Region', regions, region, setRegion, { allLabel: 'All regions' }),
            choiceGroup('Institution', agencies, agency, setAgency, { allLabel: 'All institutions' }),
            choiceGroup('Programme type', types, type, setType, { allLabel: 'All programme types' }),
          ]}
          q={q}
          onQ={setQ}
          searchPlaceholder="Search programme, institution, country or sector"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      {liveOpen && (
        <aside className="alw-live" aria-label="Live UN OCHA FTS">
          <div className="alw-live-head">
            <span className="alw-live-dot" />
            <strong>UN OCHA FTS</strong>
            <button type="button" className="alw-live-x" onClick={() => setLiveOpen(false)} aria-label="Close live feed">
              ✕
            </button>
          </div>
          <p className="alw-live-meta">
            {live?.total
              ? `${money(live.total)} tracked in ${live.year} · ${live.planCount || live.plans?.length || 0} response plans`
              : liveErr
                ? 'Live FTS unreachable'
                : 'Loading Financial Tracking Service…'}
          </p>
          <div className="alw-live-sec">FUNDING BY RESPONSE PLAN</div>
          <div className="alw-live-list">
            {(live?.plans || []).map((x) => (
              <a key={x.title} className="alw-live-link" href={x.source_url} target="_blank" rel="noreferrer">
                <label>{money(x.funded)} · {(x.share * 100).toFixed(1)}%</label>
                <span>{x.title}</span>
              </a>
            ))}
          </div>
          {wire.length > 0 && (
            <>
              <div className="alw-live-sec">DATED PROGRAMME UPDATES</div>
              <div className="alw-live-list">
                {wire.slice(0, 6).map((x) => (
                  <a key={x.title} className="alw-live-link" href={x.url} target="_blank" rel="noreferrer">
                    <label>
                      {x.date} · {x.source}
                    </label>
                    <span>{x.title}</span>
                  </a>
                ))}
              </div>
            </>
          )}
          <p className="alw-live-foot">
            {liveErr
              ? 'FTS did not return plans from this network. The appeal register below remains available.'
              : 'Live receipts from the UN OCHA Financial Tracking Service. Requirements and receipts are separate instruments and are not summed.'}
          </p>
        </aside>
      )}
      <section className="alw-feed" aria-label="Global aid operations register">
        <div className="alw-feedbar">
          <div className="alw-feedtitle">
            <b>Global aid operations register</b>
            <span>Official appeals + financing facilities · source-linked · dated snapshots</span>
          </div>
          <div className="alw-feedstats">
            <div className="alw-feedstat">
              <strong>{money(stats.requirement)}</strong>
              <span>Requirement</span>
            </div>
            <div className="alw-feedstat">
              <strong>{money(stats.funded)}</strong>
              <span>Funded</span>
            </div>
            <div className="alw-feedstat">
              <strong>{money(stats.gap)}</strong>
              <span>Funding gap</span>
            </div>
            <div className="alw-feedstat">
              <strong>{compact(stats.people)}</strong>
              <span>People targeted</span>
            </div>
          </div>
        </div>
        <div className="alw-resultbar">
          <span>
            <b>{view.length}</b> records
          </span>
          <span>Click a row for event analytics</span>
        </div>
        <div className="alw-tablewrap">
          <table className="alw-table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>Institution / region</th>
                <th style={{ textAlign: 'right' }}>Requirement</th>
                <th style={{ textAlign: 'right' }}>People target</th>
                <th>Record status</th>
                <th>Data through</th>
              </tr>
            </thead>
            <tbody>
              {view.map((p) => (
                <tr key={p.id} className={p.id === current?.id ? 'alw-row-selected' : ''} onClick={() => pick(p)} {...rowDragProps(p.row || p, { title: p.name, feature: feed?.feature })}>
                  <td title={p.name}>{p.name}</td>
                  <td className="alw-kind">
                    {p.agency}
                    <div className="gaw-sub">{p.region}</div>
                  </td>
                  <td className="alw-members">{money(p.requirement)}</td>
                  <td className="alw-members">{compact(p.target)}</td>
                  <td className="alw-obligation">{p.status}</td>
                  <td className="alw-date">{p.dataThrough}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
