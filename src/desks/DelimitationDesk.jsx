import { rowSelectionProps } from '../shell/rowSelection.js';
import { useEffect, useMemo, useState } from 'react';
import { DELIM_SIZES } from '../data/nationalCurated.js';
import { allocateSeats, applyVizFilter } from '../lib/nationalKpi.js';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';

const ASSUMPTIONS = [
  'Population figures are projections (NCP 2011–36 path), not a live census count.',
  'Allocation method: largest remainder (Hamilton), with a minimum of 1 seat.',
  'Source year for population path: 2011 baseline → 2036 projection window; seat freeze history cited from 1971/1976 context.',
  'This is illustrative, not an official delimitation order.',
];

export default function DelimitationDesk({ selected, onSelect, onFeed, vizFilter, onClearViz }) {
  const [house, setHouse] = useState(753);
  const rows = useMemo(
    () =>
      allocateSeats(house).map((r) => ({
        ...r,
        population_label: 'Projected',
        allocation_method: 'Largest remainder (Hamilton)',
        source_year: 'NCP 2011–36 projections',
        uncertainty: 'Illustrative only · projection uncertainty not quantified in this build',
      })),
    [house],
  );
  const shown = useMemo(() => rows.filter((r) => applyVizFilter(r, vizFilter)), [rows, vizFilter]);
  const sum = rows.reduce((s, r) => s + r.proj, 0);
  const gain = rows.filter((r) => r.d > 0).length;
  const lose = rows.filter((r) => r.d < 0).length;
  const gainer = rows.filter((r) => r.d > 0)[0];
  const loser = [...rows].filter((r) => r.d < 0).sort((a, b) => a.d - b.d)[0];

  useEffect(() => {
    publish(house);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function publish(nextHouse) {
    const next = allocateSeats(nextHouse).map((r) => ({
      ...r,
      population_label: 'Projected',
      allocation_method: 'Largest remainder (Hamilton)',
      source_year: 'NCP 2011–36 projections',
      uncertainty: 'Illustrative only · projection uncertainty not quantified in this build',
    }));
    setHouse(nextHouse);
    onFeed?.({
      ok: true,
      tier: 'national',
      feature: 'Delimitation Impact Simulator',
      rows: next,
      kind: 'simulator',
      source: {
        adapter: 'internal',
        note: 'SIMULATION · LARGEST REMAINDER · NCP 2011–36 PROJECTIONS · ILLUSTRATIVE',
        kind: 'simulator',
      },
      coverage: { from: '2011', through: '2036', exhaustive: false },
      fallback: false,
      meta: {
        section: 'SEAT REALLOCATION SIMULATOR',
        status: 'SIMULATION · LARGEST REMAINDER · NCP 2011–36 · ILLUSTRATIVE',
        heading: 'DELIMITATION SIMULATOR',
        kind: 'simulator',
        house: nextHouse,
        assumptions: ASSUMPTIONS,
      },
    });
  }

  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>DELIMITATION SIMULATOR</h1>
        <span className="live-feed">SIMULATION</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          feed={{ feature: 'Delimitation Simulator (NCP 2036)', rows }}
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      <div className="desk-strip">
        <span>OUTPUTS · SCENARIO HOUSE SIZE {house}</span>
        <span>METHOD · LARGEST REMAINDER · SOURCE · NCP 2011–36 · ILLUSTRATIVE</span>
      </div>

      <section className="nat-sim-block">
        <h3 className="nat-subh">Inputs</h3>
        <p className="desk-note">Choose a target house size. Everything below recalculates from locked assumptions.</p>
        <div className="nls-chips">
          {DELIM_SIZES.map(([h, lab]) => (
            <button key={h} type="button" className={`nls-chip${house === h ? ' on' : ''}`} onClick={() => publish(h)}>
              {lab}
            </button>
          ))}
        </div>
      </section>

      <section className="nat-sim-block">
        <h3 className="nat-subh">Locked assumptions</h3>
        <ul className="nat-assume">
          {ASSUMPTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      <section className="nat-sim-block">
        <h3 className="nat-subh">Scenario summary</h3>
        <p className="desk-note">
          House of {house} · allocation check Σ = {sum} · {gain} states gain, {lose} lose · seats frozen on the 1971 census since
          1976 (historical context). Select a row for the state record.
        </p>
        <div className="nat-kpi-row">
          <article>
            <h3>Baseline seats</h3>
            <strong>543</strong>
          </article>
          <article>
            <h3>Scenario seats</h3>
            <strong>{house}</strong>
          </article>
          <article className={house >= 543 ? 'ok' : 'bad'}>
            <h3>Net change</h3>
            <strong>
              {house >= 543 ? '+' : ''}
              {house - 543}
            </strong>
          </article>
          <article>
            <h3>Largest gainer</h3>
            <strong>{gainer?.name || '—'}</strong>
            <span>{gainer ? `+${gainer.d}` : ''}</span>
          </article>
          <article>
            <h3>Largest loser</h3>
            <strong>{loser?.name || '—'}</strong>
            <span>{loser ? String(loser.d) : ''}</span>
          </article>
        </div>
      </section>

      <h3 className="nat-subh">Outputs by State / UT</h3>
      <div className="table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th className="delim-state">State / UT</th>
              <th>Projected population (M)</th>
              <th>Seats now</th>
              <th>Scenario seats</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.name}
                className={selected?.name === r.name ? 'on' : ''}
                {...rowSelectionProps(() => onSelect?.(selected?.name === r.name ? null : r))}
                {...rowDragProps(r, { title: r.name, feature: 'Delimitation' })}
              >
                <td className="delim-state">{r.name}</td>
                <td className="num">{(r.pop / 1000).toFixed(1)}</td>
                <td className="num">{r.now}</td>
                <td className="num">{r.proj}</td>
                <td className={`num${r.d > 0 ? ' pos' : r.d < 0 ? ' neg' : ''}`}>
                  {r.d > 0 ? '+' : ''}
                  {r.d}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
