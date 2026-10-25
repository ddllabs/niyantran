import { useWorkspaceState } from '../shell/workspaceState.js';
import { useEffect, useMemo } from 'react';
import { hydrateAsset } from '../lib/strategicAssets.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop, { choiceGroup, matchesChoice } from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { rowDragProps } from '../lib/aiDrop.js';

function tone(status, kind) {
  const s = `${status} ${kind}`.toLowerCase();
  if (/strategic|warhead|publicly reported/.test(s)) return 'strategic';
  if (/construction|commissioning|licensing|development/.test(s)) return 'building';
  return 'operating';
}

function options(list, key) {
  return [...new Set(list.map((p) => p[key]).filter(Boolean))].sort();
}

export default function NuclearWatch({ workspaceScope = '', feed, selected, onSelect, vizFilter, onClearViz }) {
  const list = useMemo(
    () => (feed?.rows || []).map((r) => hydrateAsset(r, 'nuclear')).filter((p) => p?.id),
    [feed],
  );
  const [q, setQ] = useWorkspaceState('NuclearWatch.q', '', workspaceScope);
  const [kind, setKind] = useWorkspaceState('NuclearWatch.kind', '', workspaceScope);
  const [region, setRegion] = useWorkspaceState('NuclearWatch.region', '', workspaceScope);
  const [status, setStatus] = useWorkspaceState('NuclearWatch.status', '', workspaceScope);
  const strip = feed?.meta?.strip || {};
  const selectedId = selected?.id || selected?.__saId || '';

  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    return list.filter((p) => {
      if (!matchesChoice(kind, p.facilityKind)) return false;
      if (!matchesChoice(region, p.region)) return false;
      if (!matchesChoice(status, p.status)) return false;
      if (!applyVizFilter(p.row || p, vizFilter)) return false;
      if (!n) return true;
      return [p.name, p.country, p.region, p.facilityKind, p.status, p.operators, p.material, p.scope, p.capacity]
        .join(' ')
        .toLowerCase()
        .includes(n);
    });
  }, [list, q, kind, region, status, vizFilter]);

  useEffect(() => {
    if (!list.length) return;
    if (selected && list.some((p) => p.id === (selected.id || selected.__saId))) return;
    onSelect?.(list[0].row);
  }, [list, selected, onSelect]);

  if (!list.length) return <div className="alw-empty-page">Nuclear register is unavailable.</div>;

  const countries = new Set(list.map((p) => p.country)).size;

  return (
    <div id="nwwNuclearFeed">
      <section className="nww-feedbar">
        <div>
          <h2>Nuclear Watch</h2>
          <p>Public-source civilian and strategic nuclear facility register</p>
        </div>
        <span className="nww-feed-meta">
          <b>{view.length}</b> records · {countries} countries
          <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
          <TableFilterPop
            extraGroups={[
              choiceGroup('Facility class', options(list, 'facilityKind'), kind, setKind, { allLabel: 'All facility classes' }),
              choiceGroup('Region', options(list, 'region'), region, setRegion, { allLabel: 'All regions' }),
              choiceGroup('Status', options(list, 'status'), status, setStatus, { allLabel: 'All recorded statuses' }),
            ]}
            q={q}
            onQ={setQ}
            searchPlaceholder="Search facility, country, operator or material"
            vizFilter={vizFilter}
            onClearViz={onClearViz}
          />
        </span>
      </section>
      <div className="nww-global-strip">
        <div>
          <label>Power reactors</label>
          <strong>{strip.operatingReactors || '417 operating'}</strong>
          <span>IAEA PRIS · 26 Jul 2026</span>
        </div>
        <div>
          <label>Reactor pipeline</label>
          <strong>{strip.reactorPipeline || '77 building'}</strong>
          <span>21 suspended · IAEA PRIS</span>
        </div>
        <div>
          <label>Identified uranium</label>
          <strong>{strip.identifiedUranium || '7.9345M tU'}</strong>
          <span>&lt; USD 260/kgU · Red Book 2024</span>
        </div>
        <div>
          <label>Global inventory</label>
          <strong>{strip.inventory || '12,187 warheads'}</strong>
          <span>SIPRI estimate · Jan 2026</span>
        </div>
      </div>
      <div className="nww-feednote">
        <span>Public facility and country-resource records</span>
        <span>Click for Event Analytics</span>
      </div>
      <div className="nww-tablewrap">
        <table className="nww-table">
          <colgroup>
            <col style={{ width: '31%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '28%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Facility / country</th>
              <th>Class / region</th>
              <th>Recorded status</th>
              <th>Latest source record</th>
            </tr>
          </thead>
          <tbody>
            {view.map((p) => (
              <tr
                key={p.id}
                className={p.id === selectedId ? 'nww-row-selected' : ''}
                onClick={() => onSelect?.(p.row)}
                {...rowDragProps(p.row || p, { title: p.name, feature: feed?.feature })}
              >
                <td>
                  <div className="nww-facility">
                    <i className="nww-dot" />
                    <div>
                      <strong title={p.name}>{p.name}</strong>
                      <small>{p.country}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="nww-cell">
                    <strong title={p.facilityKind}>{p.facilityKind}</strong>
                    <small>{p.region}</small>
                  </div>
                </td>
                <td>
                  <span className="nww-status" data-tone={tone(p.status, p.facilityKind)}>
                    {p.status}
                  </span>
                </td>
                <td>
                  <div className="nww-record">
                    <strong>{p.sourceLabel}</strong>
                    <span title={p.note}>{p.note}</span>
                    <small>Checked {p.row?.checked}</small>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
