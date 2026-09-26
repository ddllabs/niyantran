import GeoHeatMap from './GeoHeatMap.jsx';
import {
  hydrateSanction,
  issuerTokens,
  SANCTIONS_MAP_LEGEND,
  sanctionHeatRecords,
  sanctionIssuerCountries,
  sanctionTargetCountries,
} from '../lib/sanctions.js';
import { briefPlainLines, mergeBriefText, useEntryBrief } from '../shell/EntryBriefInline.jsx';

export default function SanctionsAnalytics({ row, onResearch, feed, loading }) {
  const p = hydrateSanction(row);
  const { brief: intel } = useEntryBrief({ feed, selected: row, loading });
  const intelLines = briefPlainLines(intel);
  if (!p) return null;
  const src = p.sources[0] || ['Official source', p.source];
  const targets = sanctionTargetCountries(p);
  const issuers = sanctionIssuerCountries(p);
  const mapSub = targets.length
    ? `${targets.length} mapped target ${targets.length === 1 ? 'jurisdiction' : 'jurisdictions'} · ${issuers.length} issuing jurisdictions · not an effectiveness score`
    : `thematic / non-state target · ${issuers.length} issuing jurisdictions · not an effectiveness score`;
  const localBrief = `${p.name} combines ${(p.instruments.slice(0, 2).join(' and ') || 'recorded measures').toLowerCase()} across ${
    p.sectors.slice(0, 3).join(', ') || 'named sectors'
  }. Check the issuing authority, ownership rules and current licence text before treating any listing as current.`;
  return (
    <div className="alw">
      <header className="alw-head">
        <i className="alw-mark" />
        <div className="alw-headcopy">
          <h2>{p.name}</h2>
          <p>
            {p.region} · {p.type} · {p.target}
          </p>
        </div>
        <span className="alw-status">{p.status}</span>
      </header>
      <GeoHeatMap
        records={sanctionHeatRecords(p)}
        title={`Issuer and target geography · ${p.name}`}
        subtitle={mapSub}
        legend={SANCTIONS_MAP_LEGEND}
        fit={false}
        ariaLabel={`Issuer and target geography ${p.name}`}
      />
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Programme at a glance</b>
          <span>Source-linked record</span>
        </div>
        <div className="alw-kpis">
          <div className="alw-kpi">
            <label>Target</label>
            <strong title={p.target}>{p.target}</strong>
            <span>Recorded perimeter</span>
          </div>
          <div className="alw-kpi">
            <label>Listed scope</label>
            <strong>{p.entities}</strong>
            <span>Register descriptor</span>
          </div>
          <div className="alw-kpi">
            <label>Issuers</label>
            <strong>{p.issuers.length}</strong>
            <span title={p.issuer}>{issuerTokens(p).join(' · ')}</span>
          </div>
          <div className="alw-kpi">
            <label>Sector coverage</label>
            <strong>{p.sectors.length}</strong>
            <span>{p.sectors.slice(0, 2).join(' · ')}</span>
          </div>
        </div>
        <div className="alw-official">
          <div className="alw-official-top">
            <label>Policy objective</label>
            {src[1] ? (
              <a className="alw-source" href={src[1]} target="_blank" rel="noreferrer">
                {src[0]} ↗
              </a>
            ) : null}
          </div>
          <p>{p.reason}</p>
        </div>
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Legal & economic perimeter</b>
          <span>What is recorded as restricted</span>
        </div>
        <div className="alw-facts">
          <div className="alw-fact">
            <label>Regime form</label>
            <strong>{p.type}</strong>
          </div>
          <div className="alw-fact">
            <label>Legal basis</label>
            <strong title={p.basis}>{p.basis}</strong>
          </div>
          <div className="alw-fact">
            <label>Primary measure</label>
            <strong>{p.instruments[0] || '—'}</strong>
          </div>
          <div className="alw-fact">
            <label>Licences / exceptions</label>
            <strong title={p.exemptions.join('; ')}>{p.exemptions[0] || '—'}</strong>
          </div>
        </div>
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Monitor now</b>
          <span>Evidence categories · not a score</span>
        </div>
        <div className="snw-now">
          {p.watch.map((x) => (
            <div key={x[0]} className="snw-now-row">
              <div>
                <b>{x[0]}</b>
                <p>{x[2]}</p>
              </div>
              <span>{x[1]}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="alw-brief">
        <label>AI analyst brief</label>
        <p>{mergeBriefText(localBrief, intelLines)}</p>
      </div>
      <div className="alw-actions">
        <button type="button" className="alw-ai" onClick={() => onResearch?.(p)}>
          Research this regime
        </button>
        <span className="alw-method">Verify official lists and licence text. No effectiveness score is implied.</span>
      </div>
    </div>
  );
}
