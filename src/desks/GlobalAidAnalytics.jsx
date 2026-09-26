import { useMemo } from 'react';
import GeoHeatMap from './GeoHeatMap.jsx';
import {
  AID_COUNTRIES,
  AID_MAP_LEGEND,
  aidHeatRecords,
  compact,
  coveragePct,
  hydrateAppeal,
  money,
} from '../lib/globalAid.js';
import { briefPlainLines, mergeBriefText, useEntryBrief } from '../shell/EntryBriefInline.jsx';

export default function GlobalAidAnalytics({ row, rows, onSelect, onResearch, feed, loading }) {
  const p = hydrateAppeal(row);
  const { brief: intel } = useEntryBrief({ feed, selected: row, loading });
  const intelLines = briefPlainLines(intel);
  const list = useMemo(
    () => (rows || []).map((r) => hydrateAppeal(r)).filter((x) => x?.id),
    [rows],
  );
  if (!p) return null;
  const c = coveragePct(p);
  return (
    <div className="alw">
      <header className="alw-head">
        <i className="alw-mark" />
        <div className="alw-headcopy">
          <h2>{p.name}</h2>
          <p>
            {p.agency} · {p.region} · data through {p.dataThrough}
          </p>
        </div>
        <span className="alw-status">{p.status}</span>
      </header>
      <GeoHeatMap
        records={aidHeatRecords(p, list)}
        title={`Programme geography · ${p.name}`}
        subtitle="Country-level appeals in this register · colour reflects published requirement, not disbursement"
        legend={AID_MAP_LEGEND}
        fit={Boolean(AID_COUNTRIES[p.id])}
        ariaLabel={`Programme geography ${p.name}`}
        onPick={(rec) => {
          const next = list.find((x) => x.id === rec.id);
          if (next) onSelect?.(next.row || next);
        }}
      />
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Programme snapshot</b>
          <span>{p.period}</span>
        </div>
        <div className="alw-kpis">
          <div className="alw-kpi">
            <label>Published requirement</label>
            <strong>{money(p.requirement)}</strong>
            <span>{p.requirement == null ? 'Not stated in the cited summary' : 'Requested financing; not cash received'}</span>
          </div>
          <div className="alw-kpi">
            <label>People targeted</label>
            <strong>{compact(p.target)}</strong>
            <span>{p.target == null ? 'Service-specific targets below' : 'Published planning target'}</span>
          </div>
          <div className="alw-kpi">
            <label>People in need / scope</label>
            <strong>{compact(p.need)}</strong>
            <span title={p.geography}>{p.geography}</span>
          </div>
          <div className="alw-kpi">
            <label>Operating period</label>
            <strong>{p.period}</strong>
            <span>{p.status}</span>
          </div>
        </div>
        <div className="alw-official">
          <div className="alw-official-top">
            <label>Latest verified record · {p.latestDate}</label>
            {p.source ? (
              <a className="alw-source" href={p.source} target="_blank" rel="noreferrer">
                {p.sourceLabel || 'Source'} ↗
              </a>
            ) : null}
          </div>
          <p>{p.latest}</p>
        </div>
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Funding position</b>
          <span>{c == null ? 'No coverage % without a dated receipt' : `${c}% of cited requirement`}</span>
        </div>
        <div className="gaa-covertrack">
          <i className="gaa-coverfill" style={{ width: `${c || 0}%` }} />
        </div>
        <p className="gaa-note">{p.fundingNote}</p>
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Priority sectors</b>
          <span>Named in programme record</span>
        </div>
        <div className="gaa-chips">
          {p.sectors.map((s) => (
            <span key={s} className="gaa-chip">
              {s}
            </span>
          ))}
        </div>
      </section>
      <div className="alw-brief">
        <label>AI analyst brief</label>
        <p>{mergeBriefText(p.brief, intelLines)}</p>
      </div>
      <div className="alw-actions">
        <button type="button" className="alw-ai" onClick={() => onResearch?.(p)}>
          Research this programme
        </button>
        <span className="alw-method">Humanitarian requirements, receipts and development-finance packages stay separate.</span>
      </div>
    </div>
  );
}
