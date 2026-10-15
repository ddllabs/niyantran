import { useRef, useState } from 'react';
import geo from '../data/india-states-geo.json';
import { partyColor, partyShort } from '../lib/partyColors.js';
import { deskHash } from '../lib/deskRoute.js';
import { rememberMlaState } from './mlaStateHandoff.js';
import './partyMap.css';

/**
 * F196 Party Organisation Map (State desk): party seat strength in each state assembly, from the MLA
 * register (server/partyStrength.mjs). Above, every party's MLAs across the assemblies; below, an India
 * map coloured by each assembly's largest party beside a table of the same figures (the map above the
 * table on a phone). Hovering, focusing or tapping a state shows its seat breakdown; following a
 * state's link opens MLA Directory on that state. On a touch screen the first tap shows the breakdown
 * and the second follows the link. The shapes are DataMeet's (src/data/india-states-geo.json).
 */
export const MAP_CREDIT = geo.attribution;
const MAP_SOURCE = 'https://github.com/datameet/maps';
const MLA_HREF = deskHash('state', 'MLA Directory');
const NATIONAL_PARTIES = 8;
const TIP_PARTIES = 6;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-19" as "19 Aug 2026"; anything else as "an unrecorded date". */
export function formatAsOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : 'an unrecorded date';
}

const pct = (fraction) => `${Math.round(fraction * 1000) / 10}%`;
const width = (fraction) => `${Math.round(fraction * 10_000) / 100}%`;
const realRows = (feed) => (Array.isArray(feed?.rows) ? feed.rows : []).filter((r) => r && r.state && r.status !== 'source_status' && Array.isArray(r.parties));

function verdict(row) {
  if (row.tie) return 'no majority';
  return row.majority === 'Majority' ? 'majority' : row.majority.toLowerCase();
}

function stateLabel(row) {
  const lead = row.tie
    ? `tied between ${row.leaders.join(' and ')}, ${row.largest_seats} seats each of ${row.seats}`
    : `${row.largest_party}, ${row.largest_seats} of ${row.seats} seats`;
  return `${row.state}: ${lead}, ${verdict(row)}. Open the MLA list.`;
}

/**
 * Puts the breakdown beside the pointer, or beside the state's shape when there is no pointer (keyboard
 * focus, a table row), through CSS variables on the map; it opens away from the map's nearer edges.
 * Without a map (tests) or a shape it stays in the map's corner.
 */
function placeTip(event, state) {
  const map = event?.currentTarget?.closest?.('.pm')?.querySelector?.('.pm-map');
  if (!map) return;
  const shape = map.querySelector(`a.pm-link[data-state="${String(state).replace(/["\\]/g, '\\$&')}"]`);
  const box = map.getBoundingClientRect();
  const at = shape?.getBoundingClientRect();
  const pointer = event.currentTarget.classList?.contains('pm-link') && event.type?.startsWith('mouse') && Number.isFinite(event.clientX);
  if (!pointer && !at) {
    map.removeAttribute('data-tip');
    return;
  }
  const x = (pointer ? event.clientX : at.left + at.width / 2) - box.left;
  const y = (pointer ? event.clientY : at.top + at.height / 2) - box.top;
  map.style.setProperty('--tip-x', `${Math.round(x)}px`);
  map.style.setProperty('--tip-y', `${Math.round(y)}px`);
  map.setAttribute('data-tip', `${x > box.width - 300 ? 'left' : 'right'} ${y > box.height * 0.55 ? 'up' : 'down'}`);
}

function Swatch({ color }) {
  return <span className="pm-swatch" style={{ background: color }} aria-hidden="true" />;
}

function NationalBar({ national, totalSeats, assemblies, asOf }) {
  const top = national.slice(0, NATIONAL_PARTIES);
  const rest = national.slice(NATIONAL_PARTIES);
  const restSeats = rest.reduce((sum, p) => sum + p.seats, 0);
  const restShare = rest.reduce((sum, p) => sum + p.share, 0);
  const label = `MLAs by party across ${assemblies} state assemblies: ${top.map((p) => `${p.party} ${p.seats} (${pct(p.share)})`).join(', ')}${restSeats ? `, other parties ${restSeats} (${pct(restShare)})` : ''}`;
  return (
    <section className="pm-national" aria-labelledby="pm-national-head">
      <p className="pm-national-head" id="pm-national-head">
        <strong>{`${totalSeats.toLocaleString('en-IN')} MLAs in ${assemblies} assemblies`}</strong>
        <span className="muted">{`Party data as of ${formatAsOf(asOf)} (MLA register)`}</span>
      </p>
      <div className="pm-national-bar" role="img" aria-label={label}>
        {top.map((p) => <span key={p.party} title={`${p.party}: ${p.seats} (${pct(p.share)})`} style={{ width: width(p.share), background: partyColor(p.party) }} />)}
        {restSeats ? <span className="pm-others" title={`Other parties: ${restSeats} (${pct(restShare)})`} style={{ width: width(restShare) }} /> : null}
      </div>
      <ul className="pm-national-legend" aria-hidden="true">
        {top.map((p) => (
          <li key={p.party} title={p.party}>
            <Swatch color={partyColor(p.party)} />
            <span>{partyShort(p.party)}</span>
            <span className="num">{`${p.seats.toLocaleString('en-IN')} · ${pct(p.share)}`}</span>
          </li>
        ))}
        {restSeats ? (
          <li>
            <span className="pm-swatch pm-others" />
            <span>Others</span>
            <span className="num">{`${restSeats.toLocaleString('en-IN')} · ${pct(restShare)}`}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Tooltip({ row, onOpen }) {
  const shown = row.parties.slice(0, TIP_PARTIES);
  const rest = row.parties.slice(TIP_PARTIES);
  return (
    <div className="pm-tip" role="status" aria-live="polite">
      <p className="pm-tip-title">
        <strong>{row.state}</strong>
        <span className="muted">{`${row.seats} seats · majority ${row.majority_mark}`}</span>
      </p>
      <p className="pm-tip-verdict">{row.majority}</p>
      <div className="pm-tip-bar" aria-hidden="true">
        {row.parties.map((p) => <span key={p.party} style={{ width: width(p.share), background: partyColor(p.party) }} />)}
      </div>
      <ul className="pm-tip-list">
        {shown.map((p) => (
          <li key={p.party}>
            <Swatch color={partyColor(p.party)} />
            <span>{p.party}</span>
            <span className="num">{p.seats}</span>
          </li>
        ))}
        {rest.length ? <li className="muted">{`${rest.length} more ${rest.length === 1 ? 'party' : 'parties'}: ${rest.reduce((s, p) => s + p.seats, 0)} seats`}</li> : null}
      </ul>
      <a className="pm-tip-open" href={MLA_HREF} onClick={() => onOpen(row.state)}>{`Open ${row.state}’s MLA list`}</a>
    </div>
  );
}

export default function IndiaPartyMap({ feed, initialActive = '', onOpenState }) {
  const rows = realRows(feed);
  const [active, setActive] = useState(initialActive);
  // The last pointer's type. After a touch, leaving or blurring a state keeps its breakdown open, so a tap on
  // the breakdown's link is not lost when the state loses focus first.
  const pointer = useRef('');
  const clear = () => { if (pointer.current !== 'touch') setActive(''); };
  const show = (state, event) => {
    setActive(state);
    placeTip(event, state);
  };
  const byState = new Map(rows.map((r) => [r.state, r]));
  const meta = feed?.meta || {};
  const asOf = meta.as_of || rows[0]?.as_of || '';

  if (!rows.length) {
    return (
      <div className="pm">
        <p className="pm-empty">The MLA register is not available right now. No seat counts were invented.</p>
      </div>
    );
  }

  const open = (state) => {
    rememberMlaState(state);
    onOpenState?.(state);
  };
  const leaders = new Map();
  for (const r of rows) if (!r.tie) leaders.set(r.largest_party, (leaders.get(r.largest_party) || 0) + 1);
  const legend = [...leaders].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const ties = rows.some((r) => r.tie);
  const noData = geo.states.filter((s) => !byState.has(s.name)).map((s) => s.name);
  const national = Array.isArray(meta.national) ? meta.national : [];
  const totalSeats = Number(meta.totalSeats) || rows.reduce((sum, r) => sum + r.seats, 0);
  const activeRow = byState.get(active) || null;
  const activeShape = activeRow ? geo.states.find((s) => s.name === active) : null;

  return (
    <div className="pm">
      <header className="pm-head">
        <h1>Party Organisation Map</h1>
        <p className="muted">Party seat strength in each state assembly, coloured by the largest party. Select a state to open its MLA list.</p>
      </header>
      {national.length ? <NationalBar national={national} totalSeats={totalSeats} assemblies={rows.length} asOf={asOf} /> : null}
      <div className="pm-body">
        <figure className="pm-figure">
          <div className="pm-map">
            <svg className="pm-svg" viewBox={geo.viewBox.join(' ')} role="group" aria-label="Map of India: each state coloured by the largest party in its assembly">
              {geo.states.map((s) => {
                const row = byState.get(s.name);
                if (!row) return <path key={s.name} data-state={s.name} className="pm-state is-empty" d={s.d} aria-hidden="true" />;
                const fill = row.tie ? undefined : partyColor(row.largest_party);
                return (
                  <a
                    key={s.name}
                    className="pm-link"
                    data-state={s.name}
                    href={MLA_HREF}
                    tabIndex={0}
                    aria-label={stateLabel(row)}
                    onMouseEnter={(e) => show(s.name, e)}
                    onMouseMove={(e) => placeTip(e, s.name)}
                    onMouseLeave={clear}
                    onFocus={(e) => show(s.name, e)}
                    onBlur={clear}
                    onPointerDown={(e) => { pointer.current = e?.pointerType || ''; }}
                    onClick={(e) => {
                      if (pointer.current === 'touch' && active !== s.name) {
                        e?.preventDefault?.();
                        show(s.name, e);
                        return;
                      }
                      open(s.name);
                    }}
                  >
                    <path data-state={s.name} className={row.tie ? 'pm-state is-tie' : 'pm-state'} fill={fill} d={s.d} />
                  </a>
                );
              })}
              {activeShape ? <path className="pm-outline" d={activeShape.d} aria-hidden="true" /> : null}
            </svg>
            {activeRow ? <Tooltip row={activeRow} onOpen={open} /> : null}
          </div>
          <figcaption className="pm-legend">
            <ul>
              {legend.map(([party, count]) => (
                <li key={party}>
                  <Swatch color={partyColor(party)} />
                  <span>{party}</span>
                  <span className="num muted">{`${count} ${count === 1 ? 'state' : 'states'}`}</span>
                </li>
              ))}
              {ties ? <li><span className="pm-swatch pm-tie" aria-hidden="true" /><span>Tied for the most seats</span></li> : null}
              <li title={noData.join(', ')}>
                <span className="pm-swatch pm-nodata" aria-hidden="true" />
                <span>No assembly or no data</span>
                <span className="num muted">{noData.length}</span>
              </li>
            </ul>
          </figcaption>
        </figure>
        <div className="pm-table-wrap">
          <table className="pm-table">
            <caption>Party strength by state assembly</caption>
            <thead>
              <tr>
                <th scope="col">State</th>
                <th scope="col" className="num">Seats</th>
                <th scope="col">Largest party</th>
                <th scope="col" className="num">Its seats</th>
                <th scope="col" className="num">Share</th>
                <th scope="col">Majority</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.state} className={r.state === active ? 'pm-row is-active' : 'pm-row'} onMouseEnter={(e) => show(r.state, e)} onMouseLeave={clear}>
                  <th scope="row">
                    <a className="pm-table-link" href={MLA_HREF} onFocus={(e) => show(r.state, e)} onBlur={clear} onClick={() => open(r.state)}>{r.state}</a>
                  </th>
                  <td className="num">{r.seats}</td>
                  <td>{r.largest_party}</td>
                  <td className="num">{r.largest_seats}</td>
                  <td className="num">{`${r.largest_share}%`}</td>
                  <td>{r.majority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="pm-credit muted">
        <a href={MAP_SOURCE} target="_blank" rel="noopener noreferrer">{MAP_CREDIT}</a>
        {' · '}
        <span>{`Party data as of ${formatAsOf(asOf)} (MLA register)`}</span>
        {' · Seats are the MLAs the register lists; vacant seats are left out.'}
      </p>
    </div>
  );
}
