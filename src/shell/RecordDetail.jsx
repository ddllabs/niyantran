import { isArticleHref, displayUrl } from '../lib/normalise.js';
import { dossierFor, impactCards, isOpenFronts } from '../lib/openFronts.js';
import { isGithubCsvRow } from '../lib/githubCsv.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import CsvTablePane from './CsvTablePane.jsx';
import { sensitiveNoteFor } from '../lib/sensitiveData.js';
import { briefPlainLines, useEntryBrief } from './EntryBriefInline.jsx';

const SKIP = new Set([
  'source_url',
  'pdf_url',
  'status',
  'adapter',
  'fail_reason',
  'host',
  'detail',
  'reporting_search',
  'sources_json',
  'lat',
  'lon',
  'id',
  'brief',
  'why_it_matters',
  'watch_for',
  'tags',
  'sizeBand',
  '_blocRaw',
  '_otherRaw',
  'related_links',
  'seat_list',
  'pdf_note',
]);
const ENTITY_KEYS = /party|ministry|sector|region|state|constituency|vendor|origin|category|department|court|status|stage|company|sponsor|financier|country|cadre|scheme|type|trend|intensity/i;

function prettyKey(k) {
  return String(k)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function yearOf(v) {
  const m = String(v).match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function isUrl(v) {
  return /^https?:\/\//i.test(String(v).trim());
}

function isDateish(v) {
  const y = yearOf(v);
  if (y == null) return false;
  if (/^\s*(19|20)\d{2}\s*$/.test(String(v).replace(/[.,;]/g, ''))) return true;
  return /(\b\d{1,2}[/\-\s][A-Za-z]{3,}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,}\s+\d{4}|\b\d{4}\b)/.test(String(v));
}

function entriesOf(row) {
  return Object.entries(row || {}).filter(
    ([k, v]) => !SKIP.has(k) && !/^source_\d/.test(k) && v != null && String(v).trim() !== '',
  );
}

function packAnalysis(row) {
  if (!row?.brief && !row?.why_it_matters) return null;
  const tags = Array.isArray(row.tags) ? row.tags.filter(Boolean) : [];
  return {
    brief: String(row.brief || '').trim(),
    why: String(row.why_it_matters || '').trim(),
    latest: String(row.watch_for || '').trim(),
    tags,
  };
}

function frontsAnalysis(row) {
  const name = row.conflict_name || row.title || 'This event';
  const type = String(row.conflict_type || 'conflict');
  const region = row.region || 'the theatre';
  const stage = row.current_stage || 'tracked';
  const latest = String(row.latest_development || '').replace(/\s+/g, ' ').trim();
  return {
    brief: `${name} is tracked in Open Fronts as ${type.toLowerCase()} in ${region} and is currently ${stage}.`,
    why: `The event is tracked because it remains an unresolved ${type.toLowerCase()} affecting ${region}.`,
    latest,
    tags: [region, type, stage].filter(Boolean),
  };
}

const STRIP_KEYS = [
  ['conflict_name', 'title', 'name'],
  ['region'],
  ['conflict_type', 'type'],
  ['current_stage', 'stage'],
  ['intensity'],
  ['trend'],
  ['started', 'date'],
];

function stripCells(row) {
  return STRIP_KEYS.map((keys) => {
    const key = keys.find((k) => row[k] != null && String(row[k]).trim() !== '');
    return key ? { key, value: String(row[key]) } : null;
  }).filter(Boolean);
}

function pickField(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') return { key: k, value: String(v).trim() };
  }
  return null;
}

function provenanceOf(row, feed) {
  const source =
    pickField(row, ['source_label', 'source', 'outlet', 'domain']) ||
    (row?.source_url ? { key: 'source_url', value: row.source_url } : null) ||
    (feed?.source?.note ? { key: 'adapter', value: feed.source.note } : null);
  const sourceDate = pickField(row, [
    'source_date',
    'published',
    'pub_date',
    'date',
    'as_of',
    'updated',
    'tabled',
    'introduced',
  ]);
  const verified = pickField(row, ['last_verified', 'verified', 'latestDate', 'dataThrough', 'verified_at']);
  return {
    source,
    sourceDate: sourceDate
      ? { ...sourceDate, display: formatDateTime(sourceDate.value) || formatDate(sourceDate.value) || sourceDate.value }
      : null,
    verified: verified
      ? { ...verified, display: formatDateTime(verified.value) || formatDate(verified.value) || verified.value }
      : null,
  };
}

function sourcePairs(row) {
  const out = [];
  const seen = new Set();
  if (row?.sources_json) {
    try {
      for (const s of JSON.parse(row.sources_json)) {
        if (Array.isArray(s) && s[1] && isUrl(s[1]) && !seen.has(s[1])) {
          seen.add(s[1]);
          out.push({ label: s[0] || 'Source', url: s[1] });
        }
      }
    } catch {
      /* ignore */
    }
  }
  for (let i = 1; i <= 6; i++) {
    const url = row?.[`source_${i}_url`];
    const label = row?.[`source_${i}`];
    if (url && isUrl(url) && !seen.has(url)) {
      seen.add(url);
      out.push({ label: label || `Source ${i}`, url });
    }
  }
  if (row?.source_url && isUrl(row.source_url) && !seen.has(row.source_url)) {
    out.push({ label: 'Source', url: row.source_url });
  }
  if (row?.pdf_url && isUrl(row.pdf_url) && !seen.has(row.pdf_url)) {
    const sci = /sci\.gov\.in/i.test(row.pdf_url);
    out.push({
      label: sci ? 'Order PDF (SCI — session may be required)' : 'PDF',
      url: row.pdf_url,
    });
  }
  return out;
}

export default function RecordDetail({ row, feed, onClear }) {
  if (!row) return null;
  const entries = entriesOf(row);
  const title = String(row.conflict_name || row.title || row.bill_name || row.name || 'Record').trim();
  const fronts = isOpenFronts(feed);
  const analysis = fronts ? frontsAnalysis(row) : packAnalysis(row);
  const pairs = sourcePairs(row);
  const docs = pairs.length
    ? pairs.map((p) => [p.label, p.url])
    : entries.filter(([, v]) => isUrl(v));
  const dates = entries
    .filter(([, v]) => !isUrl(v) && isDateish(v) && yearOf(v))
    .map(([k, v]) => ({ k, v: String(v).trim(), y: yearOf(v) }))
    .sort((a, b) => a.y - b.y);
  const entities = entries.filter(([k, v]) => ENTITY_KEYS.test(k) && !isUrl(v) && String(v).trim().length <= 60);
  const fieldSummary = entries
    .filter(([, v]) => !isUrl(v))
    .slice(0, 6)
    .map(([k, v]) => `${prettyKey(k)}: ${String(v).trim()}`)
    .join('  ·  ');
  const csvFile = isGithubCsvRow(row);
  const csv = fronts ? 'geopolitics_war_tracker.csv' : csvFile ? String(row.name || row.title || '') : '';
  const d = fronts ? dossierFor(row) : null;
  const extra = d && (d.hasDossier || d.verified) ? d : null;
  const impact = extra ? impactCards(d) : [];
  const named = extra ? (d.actors.length ? d.actors : d.entities) : [];
  const provenance = provenanceOf(row, feed);
  const sensitive = sensitiveNoteFor(feed?.feature);
  const relatedLinks = Array.isArray(row.related_links) ? row.related_links.filter(Boolean) : [];

  return (
    <RecordDetailBody
      row={row}
      feed={feed}
      onClear={onClear}
      title={title}
      fronts={fronts}
      analysis={analysis}
      pairs={pairs}
      docs={docs}
      dates={dates}
      entities={entities}
      fieldSummary={fieldSummary}
      csvFile={csvFile}
      csv={csv}
      d={d}
      extra={extra}
      impact={impact}
      named={named}
      provenance={provenance}
      sensitive={sensitive}
      relatedLinks={relatedLinks}
      entries={entries}
    />
  );
}

function RecordDetailBody({
  row,
  feed,
  onClear,
  title,
  fronts,
  analysis,
  pairs,
  docs,
  dates,
  entities,
  fieldSummary,
  csvFile,
  csv,
  d,
  extra,
  impact,
  named,
  provenance,
  sensitive,
  relatedLinks,
  entries,
}) {
  const { brief, busy } = useEntryBrief({ feed, selected: csvFile ? null : row });
  const intelLines = briefPlainLines(brief);
  const analysisBrief =
    analysis?.brief ||
    (intelLines[0] && intelLines[0].length > 20 ? intelLines[0] : '') ||
    '';
  const analysisExtras = intelLines.filter((line) => line && line !== analysisBrief).slice(0, 4);
  const summary = [fieldSummary, ...analysisExtras.filter((l) => !fieldSummary.includes(l))]
    .filter(Boolean)
    .join('  ·  ');
  const showAnalysis = Boolean(analysis) || Boolean(analysisBrief) || busy;

  return (
    <div className="rd">
      {!csvFile ? (
        <div className="rd-strip">
          {stripCells(row).map((c, i) => (
            <div key={c.key} className={`rd-cell${i === 0 ? ' primary' : ''}`}>
              {i === 0 && <i className="status-dot" />}
              <span>{c.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rd-head">
        <h2 className="rd-title">{title}</h2>
        <button type="button" className="rd-close" onClick={onClear} aria-label="Close record">
          ×
        </button>
      </div>
      <div className="row-detail-meta">
        <span className="tag">{fronts ? 'Conflict Intelligence' : feed?.feature || 'Record'}</span>
        <span className="tag">{fronts ? 'GLOBAL' : String(feed?.tier || '').toUpperCase() || 'DESK'}</span>
        <span className="tag">TRACKER</span>
        {csv ? <span className="tag">{csv}</span> : null}
      </div>

      {sensitive && !csvFile ? (
        <div className="banner warn desk-sensitive rd-sensitive" role="note">
          <strong>{sensitive.title}</strong>
          <span>{sensitive.body}</span>
        </div>
      ) : null}

      {row.methodology && !csvFile ? (
        <div className="rd-section">
          <div className="rd-sec-label">SOURCES & METHODOLOGY</div>
          <p className="rd-method">{row.methodology}</p>
          {row.confidence ? <p className="rd-method-sub">Confidence: {row.confidence}</p> : null}
        </div>
      ) : null}

      {(row.related_count > 0 || relatedLinks.length > 0) && !csvFile ? (
        <div className="rd-section">
          <div className="rd-sec-label">RELATED COVERAGE</div>
          <p className="rd-method">
            {row.related_count > 0
              ? `${row.related_count} other headline${row.related_count === 1 ? '' : 's'} looked like the same story`
              : 'Related links'}
            {row.related_outlets ? ` (${row.related_outlets})` : ''}.
          </p>
          {relatedLinks.length > 0 ? (
            <div className="rd-docs">
              {relatedLinks.map((url) => (
                <a key={url} className="rd-doc" href={url} target="_blank" rel="noreferrer">
                  <span className="rd-doc-ic">↗</span>
                  <span>{displayUrl(url)}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {!csvFile && (
        <div className="rd-section rd-provenance">
          <div className="rd-sec-label">SOURCE · DATE · VERIFIED</div>
          <div className="rd-prov-grid">
            <div>
              <span className="rd-prov-k">Source</span>
              <span className="rd-prov-v">
                {provenance.source?.key === 'source_url' && isUrl(provenance.source.value) ? (
                  <a href={provenance.source.value} target="_blank" rel="noreferrer">
                    {displayUrl(provenance.source.value)}
                  </a>
                ) : (
                  provenance.source?.value || '—'
                )}
              </span>
            </div>
            <div>
              <span className="rd-prov-k">Source date</span>
              <span className="rd-prov-v">{provenance.sourceDate?.display || '—'}</span>
            </div>
            <div>
              <span className="rd-prov-k">Last verified</span>
              <span className="rd-prov-v">{provenance.verified?.display || '—'}</span>
            </div>
          </div>
        </div>
      )}

      {csvFile ? <CsvTablePane row={row} /> : null}

      {!csvFile && showAnalysis ? (
        <div className="rd-section rd-ai">
          <div className="rd-sec-label">✦ NIYANTRAN ANALYSIS</div>
          <div className="rd-ai-brief">
            {busy && !analysisBrief ? 'Reading this entry…' : analysisBrief || analysis?.brief || ''}
          </div>
          {analysis?.why ? (
            <div className="rd-ai-sub">
              <span>Why it matters</span>
              {analysis.why}
            </div>
          ) : null}
          {analysis?.latest ? (
            <div className="rd-ai-sub">
              <span>{fronts ? 'Latest feed note' : 'Watch for'}</span>
              {analysis.latest}
            </div>
          ) : null}
          {(brief?.findings || []).slice(0, 3).map((f) => (
            <div key={f.title} className="rd-ai-sub">
              <span>
                {f.title}
                {f.band ? ` · ${f.band}` : ''}
              </span>
              {String(f.detail || '')
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .trim()}
            </div>
          ))}
          {analysis?.tags?.length ? (
            <div className="rd-ai-tags">
              {analysis.tags.map((t) => (
                <span key={t} className="rd-ai-tag">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {!csvFile && brief?.kpis?.length ? (
        <div className="kpi-grid" style={{ marginBottom: 14 }}>
          {brief.kpis.map((k) => (
            <article
              key={k.label}
              className={`kpi-card${k.tone === 'ok' ? ' ok' : k.tone === 'warn' ? ' warn' : k.tone === 'bad' ? ' bad' : ''}`}
            >
              <h3>{k.label}</h3>
              <strong>{k.value}</strong>
              <span>{k.sub}</span>
            </article>
          ))}
        </div>
      ) : null}

      {!csvFile && summary ? <div className="rd-summary">{summary}</div> : null}

      {!csvFile && brief?.caveats?.length ? (
        <p className="desk-note">{brief.caveats.join(' · ')}</p>
      ) : null}

      {!csvFile && dates.length > 0 && (
        <div className="rd-section">
          <div className="rd-sec-label">TIMELINE</div>
          <div className="rd-timeline">
            {dates.map((e) => (
              <div key={e.k} className="rd-tl-item">
                <span className="rd-tl-dot" />
                <div className="rd-tl-body">
                  <div className="rd-tl-when">{e.v}</div>
                  <div className="rd-tl-what">{prettyKey(e.k)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!csvFile && docs.length > 0 && (
        <div className="rd-section">
          <div className="rd-sec-label">DOCUMENTS & SOURCES</div>
          <div className="rd-docs">
            {docs.map(([k, v]) => (
              <a key={String(v)} className="rd-doc" href={String(v).trim()} target="_blank" rel="noreferrer">
                <span className="rd-doc-ic">{/\.pdf(\?|$)/i.test(String(v)) ? '⤓' : '↗'}</span>
                <span>{pairs.length ? k : prettyKey(k)}</span>
              </a>
            ))}
          </div>
          {row.pdf_note ? <p className="rd-method muted" style={{ marginTop: 8 }}>{row.pdf_note}</p> : null}
        </div>
      )}

      {!csvFile && entities.length > 0 && (
        <div className="rd-section">
          <div className="rd-sec-label">RELATED ENTITIES</div>
          <div className="rd-entities">
            {entities.map(([k, v]) => (
              <span key={k} className="rd-entity" title={prettyKey(k)}>
                {String(v).trim()}
              </span>
            ))}
          </div>
        </div>
      )}

      {!csvFile && (
      <div className="rd-section">
        <div className="rd-sec-label">ALL FIELDS</div>
        <div className="row-detail-fields">
          {entries
            .filter(([, v]) => !isUrl(v))
            .map(([k, v]) => {
              const s = String(v).trim();
              const href = isArticleHref(s);
              return (
                <div key={k} className="row-detail-field">
                  <div className="rdf-key">{prettyKey(k)}</div>
                  <div className="rdf-val">
                    {href ? (
                      <a href={s} target="_blank" rel="noreferrer">
                        {displayUrl(s)}
                      </a>
                    ) : (
                      s
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      )}

      {!csvFile && extra && (
        <>
          <div className="rd-section">
            <div className="rd-sec-label">01 · Verified impact</div>
            <div className="ofx-impact-grid">
              {impact.map((x) => (
                <div key={x.label} className={`ofx-impact${x.missing ? ' missing' : ''}`}>
                  <span>{x.label}</span>
                  <b>{x.value}</b>
                  <small>{x.note}</small>
                </div>
              ))}
            </div>
          </div>
          {(named.length > 0 || d.equipment.length > 0 || d.supporters.length > 0) && (
            <div className="rd-section">
              <div className="rd-sec-label">02 · Operational picture</div>
              <div className="ofx-context-lines" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="ofx-context-line">
                  <span>Actors / headline entities</span>
                  {named.slice(0, 4).join(' · ') || 'Not identified in feed'}
                </div>
                <div className="ofx-context-line">
                  <span>Systems observed</span>
                  {d.equipment.slice(0, 3).join(' · ') || 'Not reported in feed'}
                </div>
              </div>
              <div className="ofx-chiprow">
                {(d.supporters.length ? d.supporters.slice(0, 4) : []).map((x) => (
                  <span key={x} className="ofx-chip">
                    {x}
                  </span>
                ))}
              </div>
              {d.sources?.length ? (
                <div className="rd-docs" style={{ marginTop: 10 }}>
                  {d.sources.map((s) =>
                    s[1] ? (
                      <a key={s[1]} className="rd-doc" href={s[1]} target="_blank" rel="noreferrer">
                        <span className="rd-doc-ic">↗</span>
                        <span>{s[0]}</span>
                      </a>
                    ) : null,
                  )}
                </div>
              ) : null}
            </div>
          )}
          {d.beneficiaries?.beneficiaries?.length ? (
            <div className="rd-section">
              <div className="rd-sec-label">03 · War beneficiaries</div>
              <div className="ofx-contracts">
                {d.beneficiaries.beneficiaries.slice(0, 3).map((x) => (
                  <div key={x.company} className="ofx-contract">
                    <strong>{x.company}</strong>
                    <span>{x.systems}</span>
                    <b>{x.value}</b>
                  </div>
                ))}
              </div>
              <div className="ofx-note">{d.beneficiaries.scope}</div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
