import { useWorkspaceState } from '../shell/workspaceState.js';
import { useEffect, useMemo, useState } from 'react';
import {
  OBLIGATIONS,
  hydrateAlliance,
  obligationClass,
  statsFor,
} from '../lib/alliances.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop, { choiceGroup, matchesChoice } from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import CorpusCapability from '../shell/CorpusCapability.jsx';

export default function AlliancesMonitor({ workspaceScope = '', feed, selected, onSelect, flags, vizFilter, onClearViz }) {
  const list = useMemo(
    () => (feed?.rows || []).map((r) => hydrateAlliance(r, flags)).filter((p) => p?.id),
    [feed, flags],
  );
  const [q, setQ] = useWorkspaceState('AlliancesMonitor.q', '', workspaceScope);
  const [region, setRegion] = useWorkspaceState('AlliancesMonitor.region', '', workspaceScope);
  const [category, setCategory] = useWorkspaceState('AlliancesMonitor.category', '', workspaceScope);
  const [obligation, setObligation] = useWorkspaceState('AlliancesMonitor.obligation', '', workspaceScope);
  const [liveOpen, setLiveOpen] = useState(false);

  const regions = useMemo(() => [...new Set(list.map((p) => p.region).filter(Boolean))].sort(), [list]);
  const categories = useMemo(() => [...new Set(list.map((p) => p.category).filter(Boolean))].sort(), [list]);
  const stats = useMemo(() => statsFor(list), [list]);
  const verified = feed?.meta?.verified || list[0]?.verified || '';

  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    return list.filter((p) => {
      if (!matchesChoice(region, p.region)) return false;
      if (!matchesChoice(category, p.category)) return false;
      if (!matchesChoice(obligation, obligationClass(p))) return false;
      if (!applyVizFilter(p.row || p, vizFilter)) return false;
      if (!n) return true;
      const hay = [p.name, p.short, p.category, p.region, p.legalBasis, p.scope, p.latest, p.agenda.join(' '), p.members.join(' ')]
        .join(' ')
        .toLowerCase();
      return hay.includes(n);
    });
  }, [list, q, region, category, obligation, vizFilter]);

  const newest = useMemo(
    () => [...list].sort((a, b) => String(b.latestDate).localeCompare(String(a.latestDate))).slice(0, 8),
    [list],
  );
  const ledger = newest.slice(0, 4);
  const selectedId = selected?.id || selected?.__alId || '';
  const current = list.find((p) => p.id === selectedId) || list[0];

  useEffect(() => {
    if (!list.length) return;
    if (selected && list.some((p) => p.id === (selected.id || selected.__alId))) return;
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

  function pick(p) {
    onSelect?.(p.row || p);
  }

  function openLive() {
    if (!selectedId && list[0]) pick(list[0]);
    setLiveOpen((v) => !v);
  }

  if (!list.length) {
    return <div className="alw-empty-page">Alliance register is unavailable.</div>;
  }

  return (
    <div className="alw-desk">
      <div className="feed-head">
        <h1>ALLIANCES</h1>
        <button
          type="button"
          className={`live-feed on${liveOpen ? ' is-open' : ''}`}
          onClick={openLive}
          aria-pressed={liveOpen}
          title="Open latest verified alliance developments"
        >
          ✓ LATEST
        </button>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          extraGroups={[
            choiceGroup('Region', regions, region, setRegion, { allLabel: 'All regions' }),
            choiceGroup('Structure', categories, category, setCategory, { allLabel: 'All structures' }),
            choiceGroup('Obligation', OBLIGATIONS, obligation, setObligation, { allLabel: 'All obligations' }),
          ]}
          q={q}
          onQ={setQ}
          searchPlaceholder="Search alliance, member, treaty or agenda"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      {liveOpen && current && (
        <aside className="alw-live" aria-label="Live alliance feed">
          <div className="alw-live-head">
            <span className="alw-live-dot" />
            <strong>Live register</strong>
            <button type="button" className="alw-live-x" onClick={() => setLiveOpen(false)} aria-label="Close live feed">
              ✕
            </button>
          </div>
          <p className="alw-live-meta">
            {stats.tracked} dossiers · verified {verified || '—'}
          </p>
          <div className="alw-live-sec">SELECTED</div>
          <div className="alw-live-pick">
            <b>{current.name}</b>
            <span>
              {current.short} · {current.region} · {current.memberCount} roster
            </span>
            <p>{current.latest}</p>
            {current.source ? (
              <a href={current.source} target="_blank" rel="noreferrer">
                {current.sourceLabel || 'Source'} ↗
              </a>
            ) : null}
          </div>
          <div className="alw-live-sec">LATEST DEVELOPMENTS</div>
          <div className="alw-live-list">
            {newest.map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.id === current.id ? 'on' : ''}
                onClick={() => pick(p)}
                {...rowDragProps(p.row || p, { title: p.name, feature: feed?.feature })}
              >
                <label>
                  {p.latestDate} · {p.short}
                </label>
                <span title={p.latest}>{p.latest}</span><CorpusCapability row={p.row || p} feed={feed} />
              </button>
            ))}
          </div>
          <p className="alw-live-foot">Click a row in the register or here. Source-linked dossiers, not a recommendation.</p>
        </aside>
      )}
      <section className="alw-feed" aria-label="Alliance and bloc monitor">
        <div className="alw-feedbar">
          <div className="alw-feedtitle">
            <b>Alliance and bloc monitor</b>
            <span>Source-linked register · member evidence included · verified {verified}</span>
          </div>
          <div className="alw-feedstats">
            <div className="alw-feedstat">
              <strong>{stats.tracked}</strong>
              <span>Tracked</span>
            </div>
            <div className="alw-feedstat">
              <strong>{stats.treaty}</strong>
              <span>Treaty defence</span>
            </div>
            <div className="alw-feedstat">
              <strong>{stats.security}</strong>
              <span>Security-led</span>
            </div>
            <div className="alw-feedstat">
              <strong>
                {stats.dossiers}/{stats.tracked}
              </strong>
              <span>Complete dossiers</span>
            </div>
          </div>
        </div>
        <div className="alw-resultbar">
          <span>
            <b>{view.length}</b> structures shown
          </span>
          <span>Click a row for event analytics</span>
        </div>
        <div className="alw-tablewrap">
          <table className="alw-table">
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '3%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Alliance / bloc</th>
                <th>Structure</th>
                <th>Region</th>
                <th style={{ textAlign: 'right' }}>Roster</th>
                <th>Obligation</th>
                <th>Latest record</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.length === 0 ? (
                <tr>
                  <td className="alw-empty" colSpan={7}>
                    No alliance matches these filters
                  </td>
                </tr>
              ) : (
                view.map((p) => (
                  <tr
                    key={p.id}
                    className={p.id === selectedId ? 'alw-row-selected' : ''}
                    onClick={() => pick(p)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(p);
                      }
                    }}
                    {...rowDragProps(p.row || p, { title: p.name, feature: feed?.feature })}
                  >
                    <td title={p.name}>{p.name}<CorpusCapability row={p.row || p} feed={feed} /></td>
                    <td className="alw-kind" title={p.category}>
                      {p.category}
                    </td>
                    <td title={p.region}>{p.region}</td>
                    <td className="alw-members">{p.memberCount}</td>
                    <td className="alw-obligation" title={p.obligation}>
                      {obligationClass(p)}
                    </td>
                    <td className="alw-date" title={p.latest}>
                      {p.latestDate}
                    </td>
                    <td className="alw-go">
                      <span className="alw-go-btn" aria-label="Open dossier">
                        ›
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="alw-ledger">
        <div className="alw-ledger-head">
          <b>Latest structural changes</b>
          <span>Source-linked dossier updates</span>
        </div>
        <div className="alw-ledger-grid">
          {ledger.map((p) => (
            <button key={p.id} type="button" className="alw-ledger-item" onClick={() => pick(p)}>
              <label>
                {p.latestDate} · {p.short}
              </label>
              <strong title={p.latest}>{p.latest}</strong>
              <span>
                {p.sourceLabel} · verified {p.verified}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
