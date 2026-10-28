import { useWorkspaceState } from '../shell/workspaceState.js';
import { useEffect, useMemo, useState } from 'react';
import { hydrateSanction, issuerTokens, statsFor } from '../lib/sanctions.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop, { choiceGroup, matchesChoice } from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import CorpusCapability from '../shell/CorpusCapability.jsx';
import { liveApiEnabled } from '../lib/apiMode.js';

export default function SanctionsMonitor({ workspaceScope = '', feed, selected, onSelect, vizFilter, onClearViz }) {
  const list = useMemo(
    () => (feed?.rows || []).map((r) => hydrateSanction(r)).filter((p) => p?.id),
    [feed],
  );
  const [q, setQ] = useWorkspaceState('SanctionsMonitor.q', '', workspaceScope);
  const [region, setRegion] = useWorkspaceState('SanctionsMonitor.region', '', workspaceScope);
  const [type, setType] = useWorkspaceState('SanctionsMonitor.type', '', workspaceScope);
  const [status, setStatus] = useWorkspaceState('SanctionsMonitor.status', '', workspaceScope);
  const [liveOpen, setLiveOpen] = useState(false);
  const [live, setLive] = useState(null);
  const [liveErr, setLiveErr] = useState('');

  const regions = useMemo(() => [...new Set(list.map((p) => p.region).filter(Boolean))].sort(), [list]);
  const types = useMemo(() => [...new Set(list.map((p) => p.type).filter(Boolean))].sort(), [list]);
  const stats = useMemo(() => statsFor(list), [list]);
  const asOf = feed?.meta?.asOf || '';
  const selectedId = selected?.id || selected?.__snId || '';
  const current = list.find((p) => p.id === selectedId) || list[0];

  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    return list.filter((p) => {
      if (!matchesChoice(region, p.region)) return false;
      if (!matchesChoice(type, p.type)) return false;
      if (!matchesChoice(status, p.status)) return false;
      if (!applyVizFilter(p.row || p, vizFilter)) return false;
      if (!n) return true;
      const hay = [p.name, p.issuer, p.target, p.reason, p.sectors.join(' '), p.type].join(' ').toLowerCase();
      return hay.includes(n);
    });
  }, [list, q, region, type, status, vizFilter]);

  useEffect(() => {
    if (!list.length) return;
    if (selected && list.some((p) => p.id === (selected.id || selected.__snId))) return;
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
      setLiveErr('Live OpenSanctions API is not deployed on this host.');
      return undefined;
    }
    const ac = new AbortController();
    setLiveErr('');
    fetch('/api/opensanctions', { signal: ac.signal })
      .then((r) => r.json())
      .then((body) => {
        if (ac.signal.aborted) return;
        if (!body?.ok && !body?.lists?.length) throw new Error(body?.error || 'empty');
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
    return <div className="alw-empty-page">Sanctions register is unavailable.</div>;
  }

  return (
    <div className="alw-desk snw-desk">
      <div className="feed-head">
        <h1>SANCTIONS</h1>
        <button
          type="button"
          className={`live-feed on${liveOpen ? ' is-open' : ''}`}
          onClick={() => setLiveOpen((v) => !v)}
          aria-pressed={liveOpen}
          title="Open live OpenSanctions lists"
        >
          ✓ LATEST
        </button>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          extraGroups={[
            choiceGroup('Region', regions, region, setRegion, { allLabel: 'All regions' }),
            choiceGroup('Regime type', types, type, setType, { allLabel: 'All regime types' }),
            choiceGroup(
              'Status',
              [
                { value: 'active', label: 'active' },
                { value: 'escalating', label: 'escalating' },
                { value: 'under-review', label: 'under-review' },
              ],
              status,
              setStatus,
              { allLabel: 'All statuses' },
            ),
          ]}
          q={q}
          onQ={setQ}
          searchPlaceholder="Search programme, issuer or sector"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      {liveOpen && (
        <aside className="alw-live" aria-label="Live OpenSanctions lists">
          <div className="alw-live-head">
            <span className="alw-live-dot" />
            <strong>OpenSanctions</strong>
            <button type="button" className="alw-live-x" onClick={() => setLiveOpen(false)} aria-label="Close live feed">
              ✕
            </button>
          </div>
          <p className="alw-live-meta">
            {live?.targetCount
              ? `${live.targetCount.toLocaleString()} sanctioned targets · updated ${live.updated || '—'}`
              : liveErr
                ? 'Live catalogue unreachable'
                : 'Loading daily list catalogue…'}
          </p>
          <div className="alw-live-sec">LISTS BY TARGET COUNT</div>
          <div className="alw-live-list">
            {(live?.lists || []).map((x) => (
              <a key={x.title} className="alw-live-link" href={x.url || 'https://www.opensanctions.org/'} target="_blank" rel="noreferrer">
                <label>
                  {x.updated} · {x.publisher || x.country || 'Publisher'}
                </label>
                <span>
                  {x.title} · {(x.targets || 0).toLocaleString()} targets
                </span>
              </a>
            ))}
          </div>
          <p className="alw-live-foot">
            {liveErr
              ? 'OpenSanctions did not return lists from this network. Programme register below is source-linked and remains available.'
              : 'Live catalogue from data.opensanctions.org. List counts are publisher figures, not a score.'}
          </p>
        </aside>
      )}
      <section className="alw-feed" aria-label="Sanctions monitor">
        <div className="alw-feedbar">
          <div className="alw-feedtitle">
            <b>Sanctions monitor</b>
            <span>Programme register · official-source links · as of {asOf || '—'}</span>
          </div>
          <div className="alw-feedstats">
            <div className="alw-feedstat">
              <strong>{stats.regimes}</strong>
              <span>Regimes</span>
            </div>
            <div className="alw-feedstat">
              <strong>{stats.issuers}</strong>
              <span>Issuer groups</span>
            </div>
            <div className="alw-feedstat">
              <strong>{stats.regions}</strong>
              <span>Regions</span>
            </div>
          </div>
        </div>
        <div className="alw-resultbar">
          <span>
            <b>{view.length}</b> programmes shown
          </span>
          <span>Click a row for event analytics</span>
        </div>
        <div className="alw-tablewrap">
          <table className="alw-table">
            <thead>
              <tr>
                <th>Programme / target</th>
                <th>Issuing authorities</th>
                <th>Economic perimeter</th>
                <th style={{ textAlign: 'right' }}>Listed scope</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.map((p) => (
                <tr key={p.id} className={p.id === current?.id ? 'alw-row-selected' : ''} onClick={() => pick(p)} {...rowDragProps(p.row || p, { title: p.name, feature: feed?.feature })}>
                  <td title={p.name}>{p.name}<CorpusCapability row={p.row || p} feed={feed} /></td>
                  <td className="alw-kind" title={p.issuer}>
                    {issuerTokens(p).join(' · ')}
                  </td>
                  <td title={p.sectors.join(', ')}>{p.sectors.slice(0, 2).join(' · ')}</td>
                  <td className="alw-members">{p.entities}</td>
                  <td className="alw-obligation">{p.status}</td>
                  <td className="alw-go">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
