import { MANIFESTO_LIBRARY } from '../data/nationalCurated.js';
import { allocateSeats } from '../lib/nationalKpi.js';

function field(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function Tile({ k, v }) {
  return (
    <article className="nat-tile">
      <h4>{k}</h4>
      <strong>{v || 'Not published'}</strong>
    </article>
  );
}

export function AffidavitRecord({ row, onClear, onAskAi }) {
  const name = field(row, ['name', 'title']);
  const casesRaw = field(row, ['criminal_cases']) || '0';
  const n = Number(String(casesRaw).replace(/[^0-9.-]/g, '')) || 0;
  const src = row.source_url;
  const pdf = row.pdf_url || (/\.pdf(\?|$)/i.test(String(src || '')) ? src : '');
  return (
    <div className="brec erec">
      <div className="brec-head">
        <div className="brec-titleblock">
          <h2>{name}</h2>
          <p className="brec-p muted" style={{ marginTop: 6, marginBottom: 0 }}>
            {[field(row, ['constituency']), field(row, ['party'])].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="brec-headbtns">
          {src ? (
            <a className="brec-ghost" href={src} target="_blank" rel="noreferrer">
              ↓ Source document
            </a>
          ) : (
            <span className="brec-ghost off">↓ Source document</span>
          )}
          <button type="button" className="brec-ghost" onClick={onClear}>
            All candidates
          </button>
        </div>
      </div>
      <div className="aff-cols">
        <section>
          <h3>WEALTH CHANGE (2019 → 2024)</h3>
          <div className="aff-empty">Pending analysis</div>
          <p>
            This candidate didn’t contest in 2019, or wasn’t matched to a 2019 record. That sentence cannot separate a genuine
            first-timer from a failed match, so this desk does not flag first-time candidates.
          </p>
        </section>
        <section>
          <h3>CRIMINAL CASES</h3>
          <strong className="aff-n">{n}</strong>
          <p>
            {n} case(s) declared in the nomination affidavit. Individual case detail (sections, court, status) isn’t published in this
            source — see the affidavit for full particulars. Pending cases and convictions are not separate columns here — Form 26
            separates them; this register does not.
          </p>
          <p className="muted" style={{ marginTop: 10, fontSize: '0.85rem' }}>
            <strong>⊕ Embed</strong> — not in this build. In-page affidavit embed needs host wiring (iframe / document viewer) that is
            not shipped here. Use <em>Source document</em> or <em>View PDF</em> below to open the affidavit in a new tab.
          </p>
        </section>
      </div>
      <div className="nat-tiles">
        <Tile k="Education" v={field(row, ['education'])} />
        <Tile k="Declared assets" v={field(row, ['total_assets'])} />
        <Tile k="Liabilities" v={field(row, ['liabilities'])} />
      </div>
      <p className="brec-p muted">Profession, photo and last two elections are not in this schema. No gauge, score, grade or ranking on a named person.</p>
      <div className="brec-actions">
        {pdf ? (
          <a href={pdf} target="_blank" rel="noreferrer">
            ↓ View PDF
          </a>
        ) : src ? (
          <a href={src} target="_blank" rel="noreferrer" title="This source is an affidavit page, not a PDF file">
            ↓ View PDF
          </a>
        ) : (
          <span className="off">↓ View PDF</span>
        )}
        <button type="button" className="ai" onClick={() => onAskAi?.()}>
          ✦ Ask AI
        </button>
      </div>
    </div>
  );
}

export function DelimitationRecord({ row, rows, meta, onClear, onAskAi }) {
  const scenario = (rows || []).filter((r) => r.name && r.proj != null);
  const data = scenario.length ? scenario : allocateSeats(meta?.house || 753);
  const house = meta?.house || data.reduce((s, r) => s + r.proj, 0);
  const gain = [...data].filter((r) => r.d > 0).sort((a, b) => b.d - a.d)[0];
  const lose = [...data].filter((r) => r.d < 0).sort((a, b) => a.d - b.d)[0];
  const d = Number(row.d) || 0;
  const popM = row.pop != null ? (Number(row.pop) / 1000).toFixed(1) : '—';
  return (
    <div className="brec erec">
      <div className="brec-head">
        <div className="brec-titleblock">
          <h2>{field(row, ['name', 'title'])}</h2>
          <p className="brec-p muted" style={{ marginTop: 6, marginBottom: 0 }}>
            House of {house} · largest remainder · NCP 2011–36 · illustrative
          </p>
        </div>
        <div className="brec-headbtns">
          <button type="button" className="brec-ghost" onClick={onClear}>
            All states
          </button>
        </div>
      </div>
      <div className="nat-kpi-row">
        <article>
          <h3>Seats before</h3>
          <strong>{row.now ?? '—'}</strong>
        </article>
        <article>
          <h3>Seats after</h3>
          <strong>{row.proj ?? '—'}</strong>
        </article>
        <article className={d > 0 ? 'ok' : d < 0 ? 'bad' : ''}>
          <h3>Net change</h3>
          <strong>
            {d > 0 ? '+' : ''}
            {d}
          </strong>
        </article>
        <article>
          <h3>Largest gainer</h3>
          <strong>{gain?.name || '—'}</strong>
          <span>{gain ? `+${gain.d}` : ''}</span>
        </article>
        <article>
          <h3>Largest loser</h3>
          <strong>{lose?.name || '—'}</strong>
          <span>{lose ? String(lose.d) : ''}</span>
        </article>
      </div>
      <p className="brec-p">
        2026 population (proj.): {popM} million. Method: {field(row, ['allocation_method']) || 'largest remainder'}. Source:{' '}
        {field(row, ['source_year']) || 'NCP 2011–36'}. Uncertainty: {field(row, ['uncertainty']) || 'illustrative only'}.
      </p>
      <p className="brec-p muted">
        Inputs (house size) sit on the desk chips. Assumptions are locked in the desk note. This panel is the selected-state
        output — not a second scenario engine.
      </p>
      <div className="brec-actions">
        <span className="off" title="Not built — use the house-size chips on the desk">
          Run scenario
        </span>
        <span className="off" title="Not built — choose 543 · current house on the desk">
          Reset to baseline
        </span>
        <span className="off" title="Not built">
          Compare with baseline
        </span>
        <span className="off" title="Not built">
          Export scenario
        </span>
        <button type="button" className="ai" onClick={() => onAskAi?.()}>
          ✦ Ask AI
        </button>
      </div>
    </div>
  );
}

export function ManifestoRecord({ row, onClear, onAskAi }) {
  const promise = field(row, ['promise', 'title']);
  const domain = field(row, ['domain']);
  const status = field(row, ['verifiable_status', 'status']);
  const src = row.source_url;
  return (
    <div className="brec erec">
      <div className="brec-head">
        <div className="brec-titleblock">
          <h2>{promise}</h2>
          {domain ? <p className="brec-p muted" style={{ marginTop: 6, marginBottom: 0 }}>{domain}</p> : null}
        </div>
        <div className="brec-headbtns">
          <button type="button" className="brec-ghost" onClick={onClear}>
            All promises
          </button>
        </div>
      </div>
      <div className="aff-cols">
        <section>
          <h3>COMMITMENT</h3>
          <p>{promise}</p>
          <p className="muted">{[field(row, ['party']), field(row, ['year', 'cycle'])].filter(Boolean).join(' · ')}</p>
        </section>
        <section>
          <h3>EVIDENCE TRAIL</h3>
          <span className="erec-chip">{status || 'No verifiable status in this row'}</span>
          <p>{field(row, ['latest_evidence']) || 'No primary evidence link attached to this curated row yet.'}</p>
          <p>
            Status answers “can this be checked?”, not “was it kept?”. Fulfilled / Broken is deliberately absent.
          </p>
        </section>
      </div>
      <section className="erec-method">
        <h3>SOURCES & METHODOLOGY</h3>
        <p>
          {field(row, ['methodology']) ||
            'Curated Union 2024 tracker. Verify against Gazette / PIB and the manifesto library below.'}
        </p>
        <p className="muted">{field(row, ['verified']) || 'Curated status only'}</p>
      </section>
      <p className="brec-p muted">
        Per-promise primary evidence URLs and state manifesto cycles are not ingested in this build.
      </p>
      <div className="brec-actions">
        <button type="button" onClick={onClear}>
          All promises
        </button>
        {src ? (
          <a href={src} target="_blank" rel="noreferrer">
            Open source document
          </a>
        ) : (
          <span className="off" title="No per-promise source URL in this tracker">
            Open source document
          </span>
        )}
        <button type="button" className="ai" onClick={() => onAskAi?.()}>
          ✦ Ask AI
        </button>
      </div>
      <h4 className="nat-subh">Party documents — not this promise</h4>
      <ul className="nat-lib">
        {MANIFESTO_LIBRARY.map(([lab, href]) => (
          <li key={href}>
            <a href={href} target="_blank" rel="noreferrer">
              {lab}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
