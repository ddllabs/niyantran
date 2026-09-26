import { useMemo, useState } from 'react';
import { hydrateAsset } from '../lib/strategicAssets.js';
import NuclearSiteMap, { coordText } from './NuclearSiteMap.jsx';
import { briefPlainLines, mergeBriefText, useEntryBrief } from '../shell/EntryBriefInline.jsx';

function tone(status, kind) {
  const s = `${status} ${kind}`.toLowerCase();
  if (/strategic|warhead|publicly reported/.test(s)) return 'strategic';
  if (/construction|commissioning|licensing|development/.test(s)) return 'building';
  return 'operating';
}

function countBy(list, key) {
  const m = {};
  list.forEach((p) => {
    const v = p[key] || 'Other';
    m[v] = (m[v] || 0) + 1;
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function Bars({ list, keyName, n }) {
  const a = countBy(list, keyName).slice(0, n || 6);
  const max = a[0]?.[1] || 1;
  return (
    <div className="nww-bars">
      {a.map(([label, v]) => (
        <div key={label} className="nww-bar">
          <label title={label}>{label}</label>
          <span className="nww-track">
            <i style={{ width: `${Math.round((v / max) * 100)}%` }} />
          </span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

function brief(p) {
  const prefix = /country centroid/i.test(p.precision) ? 'This is a country-level uranium resource record, not a facility. ' : '';
  return `${prefix}${p.name} is recorded as ${p.status.toLowerCase()}. The analyst-relevant facts are its ${String(p.facilityKind || '').toLowerCase()} role, ${p.capacity}, and ${String(p.material || '').toLowerCase()}. Coordinate precision is explicitly ${String(p.precision || '').toLowerCase()}. Verify any operational change against ${p.sourceLabel} and the responsible national authority; do not infer readiness, inventory, output, or safeguards conclusions that the cited public record does not state.`;
}

export default function NuclearAnalytics({ row, rows, onResearch, onSelect, feed, loading }) {
  const list = useMemo(
    () => (rows || []).map((r) => hydrateAsset(r, 'nuclear')).filter((p) => p?.id),
    [rows],
  );
  const p = hydrateAsset(row, 'nuclear');
  const [tab, setTab] = useState('overview');
  const { brief: intel } = useEntryBrief({ feed, selected: row, loading });
  const intelLines = briefPlainLines(intel);
  if (!p) return null;

  return (
    <div className="nww-a">
      <header className="nww-head">
        <i className="nww-mark" />
        <div>
          <h2>{p.name}</h2>
          <p>
            {p.facilityKind} · {p.country} · {p.region}
          </p>
        </div>
        <span className="nww-status" data-tone={tone(p.status, p.facilityKind)}>
          {p.status}
        </span>
      </header>
      <nav className="nww-nav" role="tablist">
        {[
          ['overview', 'Overview'],
          ['material', 'Reactor & material'],
          ['safeguards', 'Safeguards'],
          ['network', 'Network & sources'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div>
          <NuclearSiteMap
            selected={p}
            facilities={list}
            onPick={(x) => onSelect?.(x.row)}
          />
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Facility at a glance</b>
              <span>Source fields · not inferred scores</span>
            </div>
            <div className="nww-kpis">
              <div className="nww-kpi">
                <label>Recorded status</label>
                <strong title={p.status}>{p.status}</strong>
                <span>Latest public classification</span>
              </div>
              <div className="nww-kpi">
                <label>Published capacity</label>
                <strong title={p.capacity}>{p.capacity}</strong>
                <span>Retains source qualifier</span>
              </div>
              <div className="nww-kpi">
                <label>Facility class</label>
                <strong title={p.facilityKind}>{p.facilityKind}</strong>
                <span>{p.region}</span>
              </div>
              <div className="nww-kpi">
                <label>Coordinate precision</label>
                <strong title={p.precision}>{p.precision}</strong>
                <span>{coordText(p)}</span>
              </div>
            </div>
          </section>
          <section className="nww-section">
            <div className="nww-source-card">
              <div className="nww-source-top">
                <label>Latest verified public record · checked {p.row?.checked}</label>
                {p.source ? (
                  <a href={p.source} target="_blank" rel="noreferrer">
                    {p.sourceLabel} ↗
                  </a>
                ) : null}
              </div>
              <p>{p.note}</p>
            </div>
          </section>
          <section className="nww-section">
            <div className="nww-brief">
              <label>AI analyst brief</label>
              <p>{mergeBriefText(brief(p), intelLines)}</p>
            </div>
          </section>
        </div>
      )}

      {tab === 'material' && (
        <div>
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Reactor and material position</b>
              <span>Published scope only</span>
            </div>
            <div className="nww-facts">
              {[
                ['Operator / authority', p.operators],
                ['Public facility scope', p.scope],
                ['Material / activity', p.material],
                ['Safeguards / oversight', p.safeguards],
              ].map(([label, value]) => (
                <div key={label} className="nww-fact">
                  <label>{label}</label>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Global uranium resource context</b>
              <span>NEA / IAEA Red Book 2024 · position at 1 Jan 2023</span>
            </div>
            <div className="nww-reserve">
              <div>
                <label>Identified recoverable</label>
                <strong>7.9345M tU</strong>
                <span>Below USD 260/kgU</span>
              </div>
              <div>
                <label>Lower-cost identified</label>
                <strong>5.9257M tU</strong>
                <span>Below USD 130/kgU</span>
              </div>
              <div>
                <label>Country reports</label>
                <strong>62</strong>
                <span>48 government-submitted</span>
              </div>
            </div>
          </section>
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Facility classes in register</b>
              <span>Public records</span>
            </div>
            <Bars list={list} keyName="facilityKind" n={7} />
          </section>
        </div>
      )}

      {tab === 'safeguards' && (
        <div>
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Safeguards and oversight</b>
              <span>No inferred compliance finding</span>
            </div>
            <div className="nww-list">
              <div className="nww-list-row">
                <label>Selected record</label>
                <span>{p.safeguards}</span>
              </div>
              <div className="nww-list-row">
                <label>Verification rule</label>
                <span>
                  Use the current IAEA Safeguards Implementation Report, facility-specific agreements and the national
                  regulator. Absence of a public entry is not evidence of absence or non-compliance.
                </span>
              </div>
              <div className="nww-list-row">
                <label>Coordinate rule</label>
                <span>
                  {p.precision}. Exact zoom is reserved for publicly documented civilian sites; strategic locations are
                  generalized.
                </span>
              </div>
              <div className="nww-list-row">
                <label>Analytical boundary</label>
                <span>
                  No readiness score, proliferation probability, secret inventory, throughput estimate or vulnerability
                  assessment is generated.
                </span>
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === 'network' && (
        <div>
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Portfolio distribution</b>
              <span>{list.length} public-source records</span>
            </div>
            <Bars list={list} keyName="region" n={7} />
          </section>
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Strategic force context</b>
              <span>SIPRI estimates · January 2026</span>
            </div>
            <div className="nww-reserve">
              <div>
                <label>Global inventory</label>
                <strong>12,187</strong>
                <span>Estimated warheads</span>
              </div>
              <div>
                <label>Military stockpiles</label>
                <strong>9,745</strong>
                <span>Potentially available</span>
              </div>
              <div>
                <label>Deployed</label>
                <strong>4,012</strong>
                <span>Missiles and aircraft</span>
              </div>
            </div>
          </section>
          <section className="nww-section">
            <div className="nww-sechead">
              <b>Analytical role</b>
              <span>Selected public record</span>
            </div>
            <div className="nww-source-card">
              <p>{p.row?.role}</p>
            </div>
          </section>
        </div>
      )}

      <details className="nww-method">
        <summary>Coverage, sources and coordinate policy</summary>
        <p>
          This interface is a public-source analytical register, not a claim to enumerate undisclosed facilities.
          Power-reactor data is grounded in IAEA PRIS; research reactors in RRDB; civilian fuel-cycle facilities in NFCIS;
          uranium resource context in the NEA/IAEA Red Book; and aggregate strategic-force figures in SIPRI. Exact public
          coordinates are shown for declared civilian sites. Sensitive or strategic facilities use public approximate or
          generalized coordinates, clearly labelled.
        </p>
      </details>
      <div className="nww-actions">
        <button type="button" className="nww-ai" onClick={() => onResearch?.(p)}>
          Research this facility
        </button>
        <span className="nww-method-note">The selected record attaches internally; AI Research opens visually clean.</span>
      </div>
    </div>
  );
}
