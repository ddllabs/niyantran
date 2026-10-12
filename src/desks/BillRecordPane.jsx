import { useEffect, useMemo, useState } from 'react';
import {
  analysisFor,
  buildRecordModel,
  DESKS,
  deskForFeature,
  loadAnalysisMap,
  loadOntology,
  recordFacts,
  whatItDoes,
} from '../lib/impactRecord.js';
import { resolveOrganisedBrief } from '../lib/sourceDoc.js';
import { briefPlainLines, useEntryBrief } from '../shell/EntryBriefInline.jsx';

const GCOL = { Strong: '#34D399', Moderate: '#E0A81F', Weak: '#F87171', Speculative: '#8A94A6' };

function FactMore({ fact, onClose }) {
  if (!fact) return null;
  return (
    <div className="brec-factpanel">
      <div className="brec-factpanel-h">
        {fact.label}
        {onClose ? (
          <button type="button" className="brec-factclose" aria-label="Close" onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>
      {fact.more.body
        ? String(fact.more.body)
            .split('\n')
            .filter(Boolean)
            .map((p) => <p key={p.slice(0, 24)}>{p}</p>)
        : null}
      {fact.more.pills?.length ? (
        <div className="brec-chips">
          {fact.more.pills.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      ) : null}
      {(fact.more.kv || []).map(([k, v]) => (
        <div key={k} className="brec-kv">
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function BillRecordPane({ row, onClear, onAskAi, liveCount, desk, feature, feed, loading }) {
  const cfg = DESKS[desk] || deskForFeature(desk) || deskForFeature(feature) || DESKS.bill;
  const noun = cfg.noun;
  const featureName =
    feature ||
    (cfg.key === 'bill'
      ? 'Bill Passage Probability Index'
      : cfg.key === 'pipeline'
        ? 'Policy Pipeline Tracker'
        : cfg.key === 'question'
          ? 'Parliamentary Question Database'
          : cfg.key === 'regulatory'
            ? 'Regulatory Body Watch'
            : '');
  const briefFeed = feed || { feature: featureName, tier: 'national' };
  const { brief: intel } = useEntryBrief({ feed: briefFeed, selected: row, loading });
  const intelLines = briefPlainLines(intel);
  const [pack, setPack] = useState({ map: null, ont: null, ready: false });
  const [factK, setFactK] = useState(null);
  const [detail, setDetail] = useState(false);
  const [liveBrief, setLiveBrief] = useState('');
  const [briefBullets, setBriefBullets] = useState([]);
  const [briefBusy, setBriefBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([loadAnalysisMap(cfg.analysis), loadOntology()]).then(([map, ont]) => {
      if (live) setPack({ map, ont, ready: true });
    });
    return () => {
      live = false;
    };
  }, [cfg.analysis]);

  useEffect(() => {
    setFactK(null);
    setDetail(false);
    setLiveBrief('');
    setBriefBullets([]);
  }, [row]);

  const a = analysisFor(row, pack.map);
  const model = useMemo(() => buildRecordModel(row, a, pack.ont, cfg), [row, a, pack.ont, cfg]);

  useEffect(() => {
    if (!pack.ready || !row) return undefined;
    if (model.brief && model.brief.length > 30) {
      setLiveBrief('');
      setBriefBullets([]);
      setBriefBusy(false);
      return undefined;
    }
    const ac = new AbortController();
    let alive = true;
    setBriefBusy(true);
    resolveOrganisedBrief(row, {
      pdf: model.pdf,
      source: model.source,
      title: model.name,
      noun,
      feature: featureName,
      signal: ac.signal,
    })
      .then((got) => {
        if (!alive) return;
        setLiveBrief(got.text || '');
        setBriefBullets(Array.isArray(got.bullets) ? got.bullets : []);
      })
      .catch((err) => {
        if (!alive || err?.name === 'AbortError') return;
        setLiveBrief('');
        setBriefBullets([]);
      })
      .finally(() => {
        if (alive) setBriefBusy(false);
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [pack.ready, row, model.brief, model.pdf, model.source, model.name, noun, featureName]);

  const briefText = whatItDoes(model, liveBrief);
  const showBriefLoading = briefBusy && !liveBrief && !(model.brief && model.brief.length > 30) && !briefBullets.length;

  function BriefBody() {
    if (showBriefLoading) {
      return <p className="brec-p muted">Reading a short summary from the source…</p>;
    }
    const extra = intelLines.filter((line) => {
      const t = String(briefText || '');
      return line && !t.includes(line.slice(0, 40));
    });
    if (!(model.brief && model.brief.length > 30) && briefBullets.length) {
      const merged = [...briefBullets];
      for (const line of extra) {
        if (!merged.some((b) => b.includes(line.slice(0, 32)) || line.includes(String(b).slice(0, 32)))) {
          merged.push(line);
        }
      }
      return (
        <ul className="brec-brief-list">
          {merged.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      );
    }
    return (
      <>
        <p className="brec-p">{briefText}</p>
        {extra.length ? (
          <ul className="brec-brief-list">
            {extra.slice(0, 4).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }
  const facts = useMemo(() => {
    const all = recordFacts(row, a, cfg);
    return all.filter((f) => f.value != null && String(f.value).trim() !== '' && f.value !== '—' && f.value !== '-');
  }, [row, a, cfg]);
  const openFact = facts.find((f) => f.k === factK);
  const liveLabel = liveCount ? liveCount.toLocaleString('en-IN') : '';

  return (
    <div className="brec">
      <div className="brec-head">
        <div className="brec-titleblock">
          <h2>{model.name}</h2>
          {liveLabel ? <span className="brec-live">Live · {liveLabel} rows</span> : null}
        </div>
        <div className="brec-headbtns">
          <button type="button" className={`brec-full${detail ? ' on' : ''}`} onClick={() => setDetail((v) => !v)}>
            {detail ? '‹ Back to summary' : 'Full reasoning'}
          </button>
          {model.pdf ? (
            <a className="brec-ghost" href={model.pdf} target="_blank" rel="noreferrer">
              ↓ Download PDF
            </a>
          ) : (
            <span className="brec-ghost off" title="No PDF on record">
              ↓ Download PDF
            </span>
          )}
          <button type="button" className="brec-ghost" onClick={onClear}>
            {cfg.backLabel}
          </button>
        </div>
      </div>

      {!pack.ready ? <p className="brec-p muted">Loading this {noun}’s analysis…</p> : null}

      {detail ? (
        <div className="brec-report">
          <section>
            <h5>Record</h5>
            <div className="brec-kv">
              <span>Stage</span>
              <span>{model.stage || '—'}</span>
            </div>
            <div className="brec-kv">
              <span>House</span>
              <span>{model.house || '—'}</span>
            </div>
            <div className="brec-kv">
              <span>Introduced</span>
              <span>{model.introduced || '—'}</span>
            </div>
            <div className="brec-kv">
              <span>Subject on record</span>
              <span>{model.ministry || '—'}</span>
            </div>
          </section>
          {facts.map((f) => (
            <section key={f.k}>
              <h5>{f.label}</h5>
              <p>
                <strong>{f.value}</strong>
                {f.sub ? ` ${f.sub}` : ''}
              </p>
              <FactMore fact={f} />
            </section>
          ))}
          <section>
            <h5>What this {noun} does</h5>
            <BriefBody />
          </section>
          {model.changes.length ? (
            <section>
              <h5>{cfg.changesTitle}</h5>
              <ul>
                {model.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {model.watchFor ? (
            <section>
              <h5>What to watch for</h5>
              <p>{model.watchFor}</p>
            </section>
          ) : null}
        </div>
      ) : (
        <>
          <div className="brec-facts">
            {facts.map((f) => (
              <button
                key={f.k}
                type="button"
                className={`brec-fact${factK === f.k ? ' on' : ''}${f.tone ? ` tone-${f.tone}` : ''}`}
                onClick={() => setFactK(factK === f.k ? null : f.k)}
              >
                <span className="brec-fact-l">{f.label}</span>
                <span className="brec-fact-v">
                  {f.value}
                  {f.sub ? <em>{f.sub}</em> : null}
                </span>
                {f.bar != null ? (
                  <span className="brec-bar">
                    <i style={{ width: `${Math.max(0, Math.min(100, f.bar))}%`, background: GCOL[f.tone] || GCOL.Weak }} />
                  </span>
                ) : null}
                <span className="brec-fact-more">{factK === f.k ? 'Close' : 'Read more'}</span>
              </button>
            ))}
          </div>
          <FactMore fact={openFact} onClose={() => setFactK(null)} />

          {model.timesRaised ? <p className="brec-p">Times raised: {model.timesRaised}</p> : null}
          <h4>What this {noun} does</h4>
          <BriefBody />
          {model.changes.length ? (
            <>
              <h4>{cfg.changesTitle}</h4>
              <ul className="brec-changes">
                {model.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          ) : null}
          {model.watchFor ? (
            <>
              <h4>What to watch for</h4>
              <p className="brec-p">{model.watchFor}</p>
            </>
          ) : null}

          <h4>Related coverage</h4>
          {model.coverage.length ? (
            <div className="brec-cov">
              {model.coverage.slice(0, 5).map((x) => (
                <a key={x.link} href={x.link} target="_blank" rel="noreferrer">
                  <strong>{x.title}</strong>
                  <span>
                    {x.source || ''}
                    {x.published ? ` · ${String(x.published).slice(0, 16)}` : ''}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="brec-p muted">No linked coverage on record for this {noun}.</p>
          )}
          {model.blockedNews ? (
            <p className="brec-p muted">
              This row’s source_url is news.google.com. Google News ToS restricts commercial use — the Gazette of India is the correct
              source and is not wired. The link is not opened from here.
            </p>
          ) : null}
          <div className="brec-actions">
            {model.pdf ? (
              <a href={model.pdf} target="_blank" rel="noreferrer">
                ↓ View PDF
              </a>
            ) : (
              <span className="off">↓ View PDF</span>
            )}
            {model.source ? (
              <a href={model.source} target="_blank" rel="noreferrer">
                ↗ Source
              </a>
            ) : null}
            <button type="button" className="ai" onClick={() => onAskAi?.()}>
              ✦ Ask AI
            </button>
          </div>
        </>
      )}
    </div>
  );
}
