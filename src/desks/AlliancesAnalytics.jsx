import { useEffect, useMemo, useState } from 'react';
import {
  bindingType,
  heatRecords,
  hydrateAlliance,
  memberRecords,
  memberSummary,
  obligationClass,
  overlaps,
} from '../lib/alliances.js';
import GeoHeatMap from './GeoHeatMap.jsx';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { briefPlainLines, mergeBriefText, useEntryBrief } from '../shell/EntryBriefInline.jsx';

const LEGEND = [
  ['Recorded member', '#397ca5'],
  ['Differentiated', '#c18a2f'],
  ['Transition', '#6f9c78'],
  ['Exception / review', '#d4513c'],
];


export default function AlliancesAnalytics({ row, rows, flags, onSelect, onResearch, feed, loading }) {
  const all = useMemo(() => (rows || []).map((r) => hydrateAlliance(r, flags)).filter((p) => p?.id), [rows, flags]);
  const p = useMemo(() => hydrateAlliance(row, flags), [row, flags]);
  const [memberQ, setMemberQ] = useState('');
  const [expanded, setExpanded] = useState(false);
  const { brief: intel } = useEntryBrief({ feed, selected: row, loading });
  const intelLines = briefPlainLines(intel);

  useEffect(() => {
    setMemberQ('');
    setExpanded(false);
  }, [p?.id]);

  if (!p) return null;
  const s = memberSummary(p, flags);
  const members = memberRecords(p, flags);
  const shown = members.filter((m) => {
    if (!memberQ.trim()) return true;
    const n = memberQ.trim().toLowerCase();
    return m.country.toLowerCase().includes(n) || m.standing.toLowerCase().includes(n) || m.alignment.toLowerCase().includes(n);
  });
  const visible = memberQ ? shown : expanded ? shown : shown.slice(0, 10);
  const ov = overlaps(p, all);
  const milestones = [];
  for (let i = 0; i < p.milestones.length; i += 2) {
    milestones.push({ date: p.milestones[i] || 'Recorded', text: p.milestones[i + 1] || p.milestones[i] });
  }
  const labels = ['Current agenda', 'Institutional instrument', 'Operational mechanism'];
  const latest = p.latest || 'No later verified development is attached.';
  const next = p.next || 'No named next monitor item is attached.';
  const brief = `${p.name} contains ${p.memberCount} roster entries; ${s.active} are recorded as active or full participants in this dossier${
    s.exception + s.review ? `, while ${s.exception + s.review} require an exception or status review` : ' with no formal exception recorded'
  }. Decisions operate through ${(p.decision || 'the recorded decision rule').toLowerCase()}, under ${p.legalBasis || 'the recorded legal basis'}. The latest verified structural development is ${latest.charAt(0).toLowerCase()}${latest.slice(1)} Monitor next: ${next.charAt(0).toLowerCase()}${next.slice(1)}`;

  return (
    <div className="alw">
      <header className="alw-head">
        <i className="alw-mark" />
        <div className="alw-headcopy">
          <h2>{p.name}</h2>
          <p>
            {p.short} · {p.region} · {p.category}
          </p>
        </div>
        <span className="alw-status">{p.status}</span>
      </header>
      <GeoHeatMap
        records={heatRecords(p, flags)}
        title={`Member geography · ${p.short}`}
        subtitle={`${p.memberCount} roster entries · ${s.active} active/full · categorical standing, not a score`}
        legend={LEGEND}
        ariaLabel={`Member geography ${p.short}`}
      />
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Alliance at a glance</b>
          <span>Source verified {p.verified}</span>
        </div>
        <div className="alw-kpis">
          <div className="alw-kpi">
            <label>Roster entries</label>
            <strong>{p.memberCount}</strong>
            <span>Countries / institutions</span>
          </div>
          <div className="alw-kpi">
            <label>Active / full</label>
            <strong>{s.active}</strong>
            <span>Excludes formal exception</span>
          </div>
          <div className="alw-kpi">
            <label>Founded</label>
            <strong>{p.formed}</strong>
            <span title={p.seat}>{p.seat}</span>
          </div>
          <div className="alw-kpi">
            <label>Binding form</label>
            <strong>{bindingType(p)}</strong>
            <span>{obligationClass(p)}</span>
          </div>
        </div>
        <div className="alw-official">
          <div className="alw-official-top">
            <label>Latest verified development · {p.latestDate}</label>
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
          <b>Institutional core</b>
          <span>No inferred scores</span>
        </div>
        <div className="alw-facts">
          <div className="alw-fact">
            <label>Core purpose</label>
            <strong title={p.scope}>{p.scope}</strong>
          </div>
          <div className="alw-fact">
            <label>Binding form</label>
            <strong>{bindingType(p)}</strong>
          </div>
          <div className="alw-fact">
            <label>Decision authority</label>
            <strong title={p.decision}>{p.decision}</strong>
          </div>
          <div className="alw-fact">
            <label>Member obligation</label>
            <strong title={p.obligation}>{p.obligation}</strong>
          </div>
        </div>
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Member adherence & participation</b>
          <span>Every roster entry · evidence status</span>
        </div>
        <div className="alw-member-method">
          <div>
            <strong>{s.aligned}</strong>
            <span>Recorded alignment</span>
          </div>
          <div>
            <strong>{s.differentiated}</strong>
            <span>Differentiated</span>
          </div>
          <div>
            <strong>{s.transition}</strong>
            <span>Transition</span>
          </div>
          <div>
            <strong>{s.exception + s.review}</strong>
            <span>Exception / review</span>
          </div>
        </div>
        <div className="alw-member-tools">
          <TableFilterPop q={memberQ} onQ={setMemberQ} searchPlaceholder="Find a member country" />
          <span className="alw-member-guide">Open a row for evidence</span>
        </div>
        <div className={`alw-member-ledger${expanded ? ' alw-expanded' : ''}`}>
          <div className="alw-member-head">
            <span>Member / participant</span>
            <span>Standing</span>
            <span>Commitment status</span>
          </div>
          {visible.length === 0 ? (
            <div className="alw-member-empty">No member matches this search</div>
          ) : (
            visible.map((m) => (
              <details key={m.country} className="alw-member-entry">
                <summary className="alw-member-summary">
                  <span className="alw-member-country" title={m.country}>
                    {m.country}
                  </span>
                  <span className="alw-member-standing" title={m.standing}>
                    {m.standing}
                  </span>
                  <span className="alw-member-alignment" data-tone={m.tone} title={m.alignment}>
                    {m.alignment}
                  </span>
                </summary>
                <div className="alw-member-detail">
                  <div>
                    <label>Binding / participation basis</label>
                    <p>{m.basis}</p>
                  </div>
                  <div>
                    <label>Guideline or vision focus</label>
                    <p>{m.focus}</p>
                  </div>
                  <div className="alw-member-evidence">
                    <label>Recorded adherence evidence</label>
                    <p>
                      {m.evidence}{' '}
                      {m.source ? (
                        <a href={m.source} target="_blank" rel="noreferrer">
                          Inspect source ↗
                        </a>
                      ) : null}
                    </p>
                  </div>
                </div>
              </details>
            ))
          )}
        </div>
        {!memberQ && p.memberCount > 10 && (
          <button type="button" className="alw-member-expand" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show first 10 roster entries' : `Show all ${p.memberCount} roster entries`}
          </button>
        )}
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Membership overlap</b>
          <span>Ranked shared roster</span>
        </div>
        <div className="alw-overlap-table">
          <div className="alw-overlap-head">
            <span>Related structure</span>
            <span>Shared</span>
            <span>Share</span>
            <span>Common members</span>
          </div>
          {ov.map((x) => {
            const share = Math.round((x.n / Math.max(1, p.memberCount)) * 100);
            return (
              <button
                key={x.p.id}
                type="button"
                className="alw-overlap-row"
                onClick={() => onSelect?.(x.p.row)}
                title={`Open ${x.p.name}`}
              >
                <span className="alw-overlap-name">{x.p.name}</span>
                <span className="alw-overlap-count">{x.n}</span>
                <span className="alw-overlap-share">{share}%</span>
                <span className="alw-overlap-roster" title={x.common.join(', ')}>
                  {x.common.slice(0, 4).join(', ')}
                  {x.common.length > 4 ? ` +${x.common.length - 4}` : ''}
                </span>
              </button>
            );
          })}
          <div className="alw-overlap-note">
            Share is the percentage of the selected structure's roster also present in the related structure. It is a roster calculation, not an influence score.
          </div>
        </div>
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Agenda & operating instruments</b>
          <span>Named mechanisms</span>
        </div>
        <div className="alw-instruments">
          {p.agenda.slice(0, 3).map((x, i) => (
            <div key={`a${i}`} className="alw-instrument">
              <label>{labels[i] || 'Agenda'}</label>
              <span>{x}</span>
            </div>
          ))}
          {p.instruments.slice(0, 3).map((x, i) => (
            <div key={`i${i}`} className="alw-instrument">
              <label>{i === 0 ? 'Primary body' : i === 1 ? 'Mechanism' : 'Delivery arm'}</label>
              <span>{x}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="alw-section">
        <div className="alw-sechead">
          <b>Structural timeline</b>
          <span>Verified milestones</span>
        </div>
        <div className="alw-timeline">
          {milestones.map((x) => (
            <div key={x.date + x.text} className="alw-time">
              <label>{x.date}</label>
              <p>{x.text}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="alw-brief">
        <label>AI analyst brief</label>
        <p>{mergeBriefText(brief, intelLines)}</p>
      </div>
      <div className="alw-actions">
        <button type="button" className="alw-ai" onClick={() => onResearch?.(p)}>
          Research this alliance
        </button>
        <span className="alw-method">Member ledger, exceptions and official record attach automatically.</span>
      </div>
    </div>
  );
}
