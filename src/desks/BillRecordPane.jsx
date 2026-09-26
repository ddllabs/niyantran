import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analysisFor,
  buildRecordModel,
  DESKS,
  deskForFeature,
  footNote,
  howItTravels,
  loadAnalysisMap,
  loadOntology,
  recordFacts,
  whatItDoes,
  whereItLands,
} from '../lib/impactRecord.js';
import { resolveOrganisedBrief } from '../lib/sourceDoc.js';
import { briefPlainLines, useEntryBrief } from '../shell/EntryBriefInline.jsx';

const GCOL = { Strong: '#34D399', Moderate: '#E0A81F', Weak: '#F87171', Speculative: '#8A94A6' };

function LinkageGraph({ model, kind, rebuild, onFit, showAll, onShowAll }) {
  const svgRef = useRef(null);
  const noun = model.cfg?.noun || 'bill';
  const cap = 12;
  const graph = useMemo(() => {
    const sectors = kind === 'all' || kind === 'sector' ? model.sectors : [];
    const allCo = kind === 'all' || kind === 'company' ? model.companies : [];
    const companies = showAll ? allCo : allCo.slice(0, cap);
    const segments = kind === 'all' || kind === 'segment' ? model.segments : [];
    const nodes = [
      { id: '__bill', kind: 'bill', name: model.name, sub: model.stage || noun, band: 'Strong', r: 15, bias: 0 },
    ];
    sectors.forEach((x) => nodes.push({ id: x.id, kind: 'sector', name: x.name, band: x.band, r: 9, bias: -1, item: x }));
    segments.forEach((x) => nodes.push({ id: x.id, kind: 'segment', name: x.name, band: x.band, r: 7.5, bias: -1, item: x }));
    companies.forEach((x) => nodes.push({ id: x.id, kind: 'company', name: x.name, band: x.band, r: 6.5, bias: 1, item: x }));
    const links = nodes.slice(1).map((n, i) => ({ s: 0, t: i + 1, band: n.band }));
    return { nodes, links, hiddenCo: Math.max(0, allCo.length - companies.length), totalCo: allCo.length };
  }, [model, kind, showAll, noun]);
  const { nodes, links, hiddenCo, totalCo } = graph;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || nodes.length < 2) return undefined;
    const W = 620;
    const H = Math.max(290, Math.min(520, 150 + nodes.length * 18));
    const N = nodes.map((n) => ({ ...n }));
    const leftN = N.filter((n) => n.bias < 0).length || 1;
    const rightN = N.filter((n) => n.bias > 0).length || 1;
    let li = 0;
    let ri = 0;
    N.forEach((n, i) => {
      if (i === 0) {
        n.x = W / 2;
        n.y = Math.min(H / 2, H - 78);
        n.vx = n.vy = 0;
        n.fx = n.x;
        n.fy = n.y;
        return;
      }
      const R = Math.min(W, H) * 0.34;
      const t = n.bias < 0 ? Math.PI * (0.55 + (0.9 * li++) / leftN) : Math.PI * (-0.45 + (0.9 * ri++) / rightN);
      n.x = W / 2 + R * Math.cos(t);
      n.y = H / 2 + R * Math.sin(t);
      n.vx = n.vy = 0;
    });
    let alpha = 1;
    let raf = 0;
    const rest = { Strong: 0.26, Moderate: 0.34, Weak: 0.42, Speculative: 0.46 };
    function tick() {
      alpha *= 0.96;
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          const A = N[i];
          const B = N[j];
          let dx = B.x - A.x;
          let dy = B.y - A.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            d2 = 1;
            dx = 1;
          }
          const d = Math.sqrt(d2);
          const sameSide = A.bias === B.bias && A.bias !== 0;
          const minD = (A.r + B.r) * (sameSide ? 3.4 : 2.4);
          const f = ((1250 + (d < minD ? 5200 : 0)) / d2) * alpha;
          const ux = dx / d;
          const uy = dy / d;
          A.vx -= ux * f;
          A.vy -= uy * f;
          B.vx += ux * f;
          B.vy += uy * f;
          if (sameSide && Math.abs(dy) < 19) {
            const push = (19 - Math.abs(dy)) * 0.16 * alpha * (dy >= 0 ? 1 : -1);
            A.vy -= push;
            B.vy += push;
          }
        }
      }
      links.forEach((e) => {
        const A = N[e.s];
        const B = N[e.t];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const want = Math.min(W, H) * (rest[e.band] || 0.36);
        const k = (d - want) * 0.045 * alpha;
        B.vx -= (dx / d) * k;
        B.vy -= (dy / d) * k;
      });
      N.forEach((n, i) => {
        if (i === 0) {
          n.x = n.fx;
          n.y = n.fy;
          return;
        }
        n.vx += (W / 2 + n.bias * W * 0.28 - n.x) * 0.02 * alpha;
        n.vy += (H / 2 - n.y) * 0.012 * alpha;
        n.vx *= 0.72;
        n.vy *= 0.72;
        n.x = Math.max(28, Math.min(W - 28, n.x + n.vx));
        n.y = Math.max(42, Math.min(H - 48, n.y + n.vy));
      });
      const nodeEls = svg.querySelectorAll('.brec-n');
      const linkEls = svg.querySelectorAll('.brec-l');
      N.forEach((n, i) => {
        nodeEls[i]?.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
      });
      links.forEach((e, k) => {
        const S = N[e.s];
        const T = N[e.t];
        linkEls[k]?.setAttribute('x1', S.x.toFixed(1));
        linkEls[k]?.setAttribute('y1', S.y.toFixed(1));
        linkEls[k]?.setAttribute('x2', T.x.toFixed(1));
        linkEls[k]?.setAttribute('y2', T.y.toFixed(1));
      });
      if (alpha > 0.02) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nodes, links, rebuild]);

  if (nodes.length < 2) {
    return (
      <div className="brec-noviz">
        <b>Nothing to plot.</b> Nothing in this {noun}’s text resolves to a sector, company or segment the ontology tracks, so there is no
        linkage to draw.
        {model.ministry ? ` The only subject on its record is ${model.ministry}.` : ''}
      </div>
    );
  }

  const W = 620;
  const H = Math.max(290, Math.min(520, 150 + nodes.length * 18));
  const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

  return (
    <>
    <div className="brec-canvas">
      <div className="brec-gbar">
        <span className="brec-gtitle">
          What this {noun} connects to
          <em>
            {nodes.length} nodes · {links.length} links
          </em>
        </span>
        <button type="button" onClick={onFit} title="Re-centre the layout">
          Fit
        </button>
        <button type="button" onClick={onFit} title="Re-run the layout">
          ↻ Rebuild
        </button>
      </div>
      <svg ref={svgRef} className="brec-gsvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Linkage graph for ${model.name}`}>
        <defs>
          {['Strong', 'Moderate', 'Weak'].map((b) => (
            <radialGradient key={b} id={`brecGlow${b}`}>
              <stop offset="0%" stopColor={GCOL[b]} stopOpacity="0.55" />
              <stop offset="100%" stopColor={GCOL[b]} stopOpacity="0" />
            </radialGradient>
          ))}
          <radialGradient id="brecGlowBill">
            <stop offset="0%" stopColor="#EE5A2C" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#EE5A2C" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g>
          {links.map((e, i) => (
            <line
              key={i}
              className="brec-l"
              stroke={GCOL[e.band] || GCOL.Weak}
              strokeWidth={e.band === 'Strong' ? 1.7 : 1.2}
              strokeOpacity={0.5}
            />
          ))}
        </g>
        <g>
          {nodes.map((n, i) => {
            if (i === 0) {
              return (
                <g key={n.id} className="brec-n">
                  <circle r="46" fill="url(#brecGlowBill)" />
                  <circle r={n.r} fill="#141B2C" stroke="#EE5A2C" strokeWidth="1.8" />
                  <text className="brec-glabel-bill" y={n.r + 15} textAnchor="middle">
                    {clip(n.name.replace(/^THE\s+/i, ''), 34)}
                  </text>
                  <text className="brec-gsub" y={n.r + 27} textAnchor="middle">
                    {n.sub}
                  </text>
                </g>
              );
            }
            const c = GCOL[n.band] || GCOL.Weak;
            const right = n.bias > 0;
            return (
              <g key={n.id} className="brec-n">
                <circle r={n.r * 3.1} fill={`url(#brecGlow${n.band || 'Weak'})`} />
                {n.band === 'Strong' ? (
                  <polygon points={`0,${-n.r} ${n.r},0 0,${n.r} ${-n.r},0`} fill={c} />
                ) : n.band === 'Moderate' ? (
                  <circle r={n.r * 0.85} fill={c} />
                ) : (
                  <circle r={n.r * 0.8} fill="#0C1322" stroke={c} strokeWidth="2" />
                )}
                <text className="brec-glabel" x={right ? n.r + 9 : -(n.r + 9)} y="3.5" textAnchor={right ? 'start' : 'end'}>
                  {clip(n.name, 20)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="brec-legend">
        <span className="brec-lg-t">Link strength</span>
        <span>
          <i className="brec-gl Strong" /> Strong
        </span>
        <span>
          <i className="brec-gl Moderate" /> Moderate
        </span>
        <span>
          <i className="brec-gl Weak" /> Weak
        </span>
        <span className="brec-lg-sep" />
        <span className="brec-lg-q">← sectors & segments</span>
        <span className="brec-lg-q">companies →</span>
      </div>
    </div>
      {hiddenCo > 0 ? (
        <button type="button" className="brec-showall" onClick={onShowAll}>
          Show all {Math.min(totalCo, 24)} companies in the graph
        </button>
      ) : null}
    </>
  );
}

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
  const [kind, setKind] = useState('all');
  const [factK, setFactK] = useState(null);
  const [impact, setImpact] = useState(null);
  const [detail, setDetail] = useState(false);
  const [rebuild, setRebuild] = useState(0);
  const [showAll, setShowAll] = useState(false);
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
    setKind('all');
    setFactK(null);
    setImpact(null);
    setDetail(false);
    setShowAll(false);
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
  const nS = model.sectors.length;
  const nC = model.companies.length;
  const nG = model.segments.length;
  const total = nS + nC + nG;
  const chips = [
    { k: 'all', label: 'Everything', n: total },
    { k: 'sector', label: nS === 1 ? 'Sector impacted' : 'Sectors impacted', n: nS },
    { k: 'company', label: nC === 1 ? 'Company impacted' : 'Companies impacted', n: nC },
    { k: 'segment', label: nG === 1 ? 'Segment impacted' : 'Segments impacted', n: nG },
  ].filter((x) => x.k === 'all' || x.n);
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
          {total ? (
            <div className="brec-frow">
              <span>Links</span>
              <div className="brec-kinds">
                {chips.map((x) => (
                  <button
                    key={x.k}
                    type="button"
                    className={kind === x.k ? 'on' : ''}
                    aria-pressed={kind === x.k}
                    onClick={() => setKind(x.k)}
                  >
                    <b>{x.n}</b> {x.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

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

          <LinkageGraph
            model={model}
            kind={kind}
            rebuild={rebuild}
            showAll={showAll}
            onFit={() => setRebuild((n) => n + 1)}
            onShowAll={() => setShowAll(true)}
          />
          {total ? (
            <>
              <div className="brec-impactbtns">
                <button type="button" className={impact === 'lands' ? 'on' : ''} onClick={() => setImpact(impact === 'lands' ? null : 'lands')}>
                  Where the impact lands
                </button>
                <button
                  type="button"
                  className={impact === 'travels' ? 'on' : ''}
                  onClick={() => setImpact(impact === 'travels' ? null : 'travels')}
                >
                  How the impact travels
                </button>
              </div>
              <p className="brec-hint">Hover, drag or select any node in the graph to read how this {noun} reaches it.</p>
            </>
          ) : null}
          {impact === 'lands' ? <p className="brec-impact">{whereItLands(model)}</p> : null}
          {impact === 'travels' ? <p className="brec-impact">{howItTravels(model)}</p> : null}

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
          <p className="brec-foot">{footNote(model)}</p>
        </>
      )}
    </div>
  );
}
