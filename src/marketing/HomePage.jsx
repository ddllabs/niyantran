import { useEffect, useMemo, useRef, useState } from 'react';
import { emptyIntroVideo, fetchIntroVideo, videoPlayback } from '../lib/marketingIntroVideo.js';
import { PERSONAS } from '../lib/personas.js';
import BillAiDropDemo from './BillAiDropDemo.jsx';
import SegmentCarousel from './SegmentCarousel.jsx';
import NterLatestRail from './NterLatestRail.jsx';
import DataGlobe from './DataGlobe.jsx';
import HeroPersonas from './HeroPersonas.jsx';
import './homeHero.css';
import { figure } from '../lib/siteFigures.js';
import { stageBar } from '../lib/previewFigures.js';
import PREVIEW from '../data/preview-figures.json';
import { useSiteFigures } from './useSiteFigures.js';

function Ico({ d, size = 18, stroke = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const DESKS = [
  {
    id: 'legislative',
    label: 'Legislative & Policy Intelligence',
    d: 'M4 21h16M4 10h16M12 3l8 7H4z',
    title: 'BILL PASSAGE INDEX',
    more: 'View All Bills →',
    cols: ['BILL', 'HOUSE'],
    rows: [
      ['The Tribunals Reforms Bill, 2026', 'Lok Sabha'],
      ['The Finance Bill, 2026', 'Lok Sabha'],
      ['The Boilers Bill, 2024', 'Rajya Sabha'],
      ['The Banking Laws (Amendment) Bill, 2024', 'Lok Sabha'],
      ['The National Co-Operative Development Corporation (Amendment) Bill, 2026', 'Lok Sabha'],
      ['The Kerala (Alteration Of Name) Bill, 2026', 'Lok Sabha'],
    ],
    kpis: [
      // F142: live counts, resolved at render (see desk.kpis below).
      [(f) => figure(f.bills), 'blue', 'BILLS ON RECORD'],
      [String(PREVIEW.bills.houses), 'ok', 'HOUSES'],
      [(f) => figure(f.ministries), 'warn', 'MINISTRIES'],
      [String(PREVIEW.bills.seriesStart ?? '—'), 'gold', 'SERIES START'],
    ],
    bars: [
      // F144: real counts from the bill register, as a share of all bills.
      stageBar('Pending', PREVIEW),
      stageBar('Passed', PREVIEW, 'sand'),
      stageBar('Assented', PREVIEW),
      stageBar('Withdrawn', PREVIEW, 'red'),
    ],
    note: 'Passage labels are as published on the register.',
  },
  {
    id: 'electoral',
    label: 'Electoral Data & Analytics',
    d: 'M4 20V10M10 20V4M16 20v-8M22 20V8',
    title: 'ELECTORAL RETURNS',
    more: 'View All Returns →',
    cols: ['CONTEST', 'STATE'],
    rows: [
      ['Lok Sabha general election, 2024 - Uttar Pradesh', 'Uttar Pradesh'],
      ['Assembly by-election, 2025 - Wayanad', 'Kerala'],
      ['Lok Sabha general election, 2024 - Maharashtra', 'Maharashtra'],
      ['Assembly election, 2024 - Haryana', 'Haryana'],
      ['Assembly election, 2024 - Jammu & Kashmir', 'J&K'],
      ['Lok Sabha general election, 2024 - West Bengal', 'West Bengal'],
    ],
    kpis: [
      ['543', 'blue', 'LS CONSTITUENCIES'],
      [String(PREVIEW.mps.states), 'ok', 'STATES COVERED'],
      ['8', 'warn', 'BY-ELECTIONS'],
      ['1951', 'gold', 'SERIES START'],
    ],
    bars: [
      ['Declared', 480, '88%', 88, ''],
      ['Counting', 32, '6%', 6, 'sand'],
      ['Notified', 22, '4%', 4, ''],
      ['Disputed', 9, '2%', 2, 'red'],
    ],
    note: 'Returns are official counts as published. Seat totals here are a desk preview, not a forecast.',
  },
  {
    id: 'media',
    label: 'Representative & Media Intelligence',
    d: 'M21 15a4 4 0 01-4 4H7l-4 3V7a4 4 0 014-4h10a4 4 0 014 4z',
    title: 'STATEMENT TRACKER',
    more: 'View All Statements →',
    cols: ['ITEM', 'SOURCE'],
    rows: [
      ['PIB briefing on monsoon session business', 'PIB'],
      ['Lok Sabha speaker on privilege notices', 'Lok Sabha'],
      ['RBI governor remarks after MPC', 'RBI'],
      ['MEA readout on bilateral consultations', 'MEA'],
      ['Election Commission press note on rolls', 'ECI'],
      ['NDTV wire on standing committee report', 'NDTV'],
    ],
    kpis: [
      ['128', 'blue', 'ITEMS THIS WEEK'],
      ['14', 'ok', 'OFFICIAL SOURCES'],
      ['6', 'warn', 'WIRE SEARCHES'],
      ['3', 'gold', 'HOUSES COVERED'],
    ],
    bars: [
      ['Official', 72, '56%', 56, ''],
      ['Parliament', 31, '24%', 24, 'sand'],
      ['Wire', 18, '14%', 14, ''],
      ['Other', 7, '6%', 6, 'red'],
    ],
    note: 'Wires are labelled as reporting searches. They are not treated as official tables.',
  },
  {
    id: 'ops',
    label: 'Government Operations',
    d: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6',
    title: 'TENDERS & NOTICES',
    more: 'View All Notices →',
    cols: ['NOTICE', 'ISSUER'],
    rows: [
      ['GeM bid for network equipment, MeitY', 'MeitY'],
      ['CPWD civil works, New Delhi circle', 'CPWD'],
      ['NHAI package, Delhi–Mumbai corridor', 'NHAI'],
      ['Railways signalling upgrade, WR', 'IR'],
      ['MoD request for information, UAVs', 'MoD'],
      ['CBIC circular on drawback rates', 'CBIC'],
    ],
    kpis: [
      ['84', 'blue', 'OPEN NOTICES'],
      ['12', 'ok', 'MINISTRIES'],
      ['9', 'warn', 'CLOSING 7D'],
      ['6', 'gold', 'SECTORS'],
    ],
    bars: [
      ['Open', 48, '57%', 57, ''],
      ['Closing', 19, '23%', 23, 'sand'],
      ['Awarded', 12, '14%', 14, ''],
      ['Cancelled', 5, '6%', 6, 'red'],
    ],
    note: 'Tender rows are administrative notices. Award status is as published, not a recommendation.',
  },
  {
    id: 'economy',
    label: 'Economy, Finance & Industry',
    d: 'M4 20h16M7 16V10M12 16V6M17 16v-8',
    title: 'MACRO SERIES',
    more: 'View All Series →',
    cols: ['SERIES', 'SOURCE'],
    rows: [
      ['CPI combined, latest print', 'MoSPI'],
      ['IIP manufacturing', 'MoSPI'],
      ['Merchandise exports, monthly', 'DGCI&S'],
      ['GST collections, monthly', 'GSTN'],
      ['RBI policy repo rate', 'RBI'],
      ['World Bank India GDP series', 'World Bank'],
    ],
    kpis: [
      [String(PREVIEW.macro.series), 'blue', 'LIVE SERIES'],
      [String(PREVIEW.macro.publishers), 'ok', 'PUBLISHERS'],
      ['4', 'warn', 'UPDATED TODAY'],
      ['1991', 'gold', 'SERIES START'],
    ],
    bars: [
      ['Prices', 12, '29%', 29, ''],
      ['Activity', 11, '26%', 26, 'sand'],
      ['Trade', 10, '24%', 24, ''],
      ['Fiscal', 9, '21%', 21, 'red'],
    ],
    note: 'Market cap is never an input here. Size bands, if shown on a desk, are revenue-based only.',
  },
  {
    id: 'global',
    label: 'Global Affairs & Security',
    d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18',
    title: 'OPEN FRONTS',
    more: 'View All Fronts →',
    cols: ['FRONT', 'THEATRE'],
    rows: [
      ['Ukraine–Russia, latest development', 'Europe'],
      ['Israel–Gaza, latest development', 'West Asia'],
      ['Red Sea shipping disruption', 'Maritime'],
      ['India–China LAC, latest notice', 'Himalaya'],
      ['Myanmar, border developments', 'East'],
      ['Sahel, security notices', 'Africa'],
    ],
    kpis: [
      [String(PREVIEW.fronts.fronts), 'blue', 'OPEN FRONTS'],
      [String(PREVIEW.fronts.regions), 'ok', 'THEATRES'],
      ['4', 'warn', 'UPDATED 48H'],
      ['9', 'gold', 'SOURCES'],
    ],
    bars: [
      ['Active', 11, '61%', 61, ''],
      ['Watch', 4, '22%', 22, 'sand'],
      ['Frozen', 2, '11%', 11, ''],
      ['Closed', 1, '6%', 6, 'red'],
    ],
    note: 'Fronts are sourced events. Intensity labels are descriptive of the record, not a call to action.',
  },
];

export default function HomePage({ onLogin, onCoverage, onPricing }) {
  const figures = useSiteFigures();
  const videoRef = useRef(null);
  const [deskId, setDeskId] = useState('legislative');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(0);
  const [activePersona, setActivePersona] = useState(0);
  const [introVideo, setIntroVideo] = useState(() => emptyIntroVideo());
  const [videoPlaying, setVideoPlaying] = useState(false);
  const desk = DESKS.find((d) => d.id === deskId) || DESKS[0];
  const rows = useMemo(() => {
    if (!desk.rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return desk.rows;
    return desk.rows.filter(([name, house]) => `${name} ${house}`.toLowerCase().includes(needle));
  }, [desk, q]);
  const playback = useMemo(() => videoPlayback(introVideo), [introVideo]);
  const videoEnabled = introVideo.enabled !== false;

  useEffect(() => {
    const ac = new AbortController();
    fetchIntroVideo(ac.signal).then(setIntroVideo);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!videoPlaying || playback.kind !== 'file') return;
    const el = videoRef.current;
    if (!el) return;
    const play = el.play();
    if (play && typeof play.catch === 'function') play.catch(() => {});
  }, [videoPlaying, playback]);

  function pickDesk(id) {
    setDeskId(id);
    setQ('');
    setPicked(0);
  }

  function openPersona(id) {
    const i = PERSONAS.findIndex((p) => p.id === id);
    if (i >= 0) setActivePersona(i);
    document.getElementById('personas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // F212: the hero popover's link closes as it is followed; focus moves on with the reader.
    document.getElementById('mkt-personas-title')?.focus({ preventScroll: true });
  }

  function openWalkthrough() {
    document.getElementById('walkthrough')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!videoEnabled) return;
    setVideoPlaying(true);
  }

  return (
    <>
      {/* F140 (client design, owner 2026-10-13): the design's hero on white, our figures and links.
          F212 (reference v5, owner 2026-10-16): the persona column and the coverage box. */}
      <section className="nd-hero-shell">
        <div className="nd-hero nd-container" aria-labelledby="nd-hero-title">
          <div className="nd-hero-copy">
            <p className="nd-eyebrow"><span className="nd-spark" aria-hidden="true">✳</span> THE RESEARCH TERMINAL</p>
            <h1 id="nd-hero-title">
              The intelligence<br /> layer for <span className="nd-blue">Government,</span><br />
              <span className="nd-purple">Policy</span> &amp;<br />Global Affairs<span className="nd-red">.</span>
            </h1>
            <p className="nd-promise">See what a record touches —<br />before you argue about it.</p>
            <p className="nd-description">
              Official sources across legislation, fronts, markets, carbon and the courts — with every
              connection labelled. Investigate the record without leaving the desk.
            </p>
            <div className="nd-actions">
              <button type="button" className="nd-btn nd-btn-primary" onClick={onLogin}>
                Open the terminal
              </button>
              <button type="button" className="nd-btn nd-btn-secondary" onClick={onPricing}>
                See plans
              </button>
            </div>
            <button type="button" className="nd-coverage-link" onClick={onCoverage}>
              View data coverage <span aria-hidden="true">↓</span>
            </button>
          </div>
          <div className="nd-globe-column">
            <DataGlobe onLogin={onLogin} />
          </div>
          <HeroPersonas onExplore={openPersona} />
          {/* F212: the reference's coverage box, every figure from our own sources and no date line. */}
          <div className="nd-coverage-box" role="group" aria-labelledby="nd-coverage-title">
            <p className="nd-coverage-heading" id="nd-coverage-title">THE RECORD, AT A GLANCE</p>
            <div className="nd-coverage-grid">
              <div><strong>{figure(figures.bills)}</strong><span>Bills on record</span></div>
              <div><strong>{figures.modules}</strong><span>Research modules</span></div>
              <div><strong>{figures.endpoints}</strong><span>Source endpoints</span></div>
              <div><strong>{figures.desks}</strong><span>Intelligence desks</span></div>
              <div><strong>{figure(figures.ministries)}</strong><span>Ministries</span></div>
              <div><strong>{PREVIEW.bills.houses}</strong><span>Houses covered</span></div>
              <div><strong>{PREVIEW.bills.seriesStart}</strong><span>Coverage since</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mkt-ai-demo" id="ask-ai-demo" aria-labelledby="mkt-ai-demo-title">
        <div className="mkt-wrap mkt-ai-demo-inner">
          <div className="mkt-ai-demo-copy">
            <p className="mkt-showcase-kicker">— Ask with the record attached</p>
            <h2 id="mkt-ai-demo-title">
              Drag a bill into Ask AI — <em>provenance stays on the record.</em>
            </h2>
            <p>
              Drop any desk row into research. The assistant answers from the attached columns and source links —
              not from invented citations.
            </p>
            <button type="button" className="mkt-cta" onClick={onLogin}>
              Try it in the terminal
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <BillAiDropDemo />
        </div>
      </section>
 
      <SegmentCarousel onLogin={onLogin} />
      <NterLatestRail onLogin={onLogin} />

      <section className="mkt-preview" aria-labelledby="mkt-preview-title">
        <div className="mkt-wrap">
          <div className="mkt-preview-lead">
            <p>Inside the terminal</p>
            <h2 id="mkt-preview-title">Desks you can open after sign-in</h2>
          </div>
          <div className="mkt-preview-frame">
            <span className="mkt-preview-scan" aria-hidden="true" />
            <aside className="mkt-prev-nav">
              <div className="mark">
                <img src="/brand/logo-128.webp" alt="" />
                TERMINAL
              </div>
              {DESKS.map((item) => (
                <button
                  type="button"
                  className={item.id === desk.id ? 'on' : ''}
                  key={item.id}
                  onClick={() => pickDesk(item.id)}
                >
                  <Ico d={item.d} size={15} />
                  {item.label}
                </button>
              ))}
              <button type="button" className="mkt-prev-all" onClick={onLogin}>
                <Ico d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" size={15} />
                All Desks
              </button>
            </aside>
            <div className="mkt-prev-table">
              <div className="mkt-prev-top">
                <h3>
                  {desk.title}
                  <span className="mkt-prev-live">
                    <i />
                    LIVE FEED
                  </span>
                </h3>
                <div className="mkt-prev-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3-3" />
                  </svg>
                  <input
                    id="homepage-preview-filter"
                    name="previewFilter"
                    aria-label="Filter this table"
                    value={q}
                    placeholder="Filter this table"
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPicked(0);
                    }}
                  />
                </div>
              </div>
              <div className="mkt-prev-cols">
                <span>{desk.cols[0]}</span>
                <span>{desk.cols[1]}</span>
              </div>
              {rows.length === 0 && <div className="mkt-prev-empty">No rows match this filter.</div>}
              {rows.map(([name, house], i) => (
                <button type="button" className={`mkt-prev-row${i === picked ? ' on' : ''}`} key={name} onClick={() => setPicked(i)}>
                  <b>{name}</b>
                  <span>{house}</span>
                </button>
              ))}
              <button type="button" className="mkt-prev-more" onClick={onLogin}>
                {desk.more}
              </button>
            </div>
            <aside className="mkt-prev-rail">
              <div className="mkt-prev-tabs">
                <span className="mkt-prev-tab-static">Key indicators</span>
              </div>
              <div className="mkt-kpi-grid">
                {desk.kpis.map(([value, tone, lab]) => { const n = typeof value === 'function' ? value(figures) : value; return (
                  <div className="mkt-kpi" key={lab}>
                    <strong className={tone}>{n}</strong>
                    <small>{lab}</small>
                  </div>
                ); })}
              </div>
              <div className="mkt-bar-lab">STATUS BY STAGE</div>
              {desk.bars.map(([lab, count, pct, width, tone]) => (
                <div className="mkt-bar" key={`${desk.id}-${lab}`}>
                  <span>{lab}</span>
                  <i>
                    <b className={tone} style={{ width: `${width}%` }} />
                  </i>
                  <em>
                    {count.toLocaleString()} ({pct})
                  </em>
                </div>
              ))}
              <p className="mkt-prev-note">{desk.note}</p>
            </aside>
          </div>
        </div>
      </section>

      <section className="mkt-showcase" id="walkthrough" aria-labelledby="mkt-showcase-title">
        <div className="mkt-wrap mkt-showcase-top">
          <div className="mkt-showcase-copy">
            <p className="mkt-showcase-kicker">— What nter.pro is</p>
            <h2 id="mkt-showcase-title">
              A research terminal for public records, events and institutional data — with{' '}
              <em>provenance visible.</em>
            </h2>
            <p>
              Search, compare and ask across {figures.endpoints} source endpoints while keeping context, timeline and source
              provenance visible — all in one terminal.
            </p>
            <div className="mkt-showcase-actions">
              <button type="button" className="mkt-cta" onClick={onLogin}>
                Open the terminal
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
              <button type="button" className="mkt-cta ghost" onClick={openWalkthrough}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Watch overview
              </button>
            </div>
          </div>

          <div className={`mkt-walk-video${videoPlaying ? ' is-playing' : ''}`}>
            {videoPlaying && playback.kind === 'file' ? (
              <video
                ref={videoRef}
                key={playback.src}
                className="mkt-walk-video-player"
                src={playback.src}
                poster={playback.poster || undefined}
                controls
                playsInline
                preload="metadata"
              >
                Your browser does not support this video.
              </video>
            ) : null}
            {videoPlaying && playback.kind === 'iframe' ? (
              <iframe
                className="mkt-walk-video-player"
                src={`${playback.src}${playback.src.includes('?') ? '&' : '?'}autoplay=1`}
                title={introVideo.title || 'nter.pro walkthrough'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : null}
            {!videoPlaying ? (
              <button type="button" className="mkt-walk-video-face" onClick={openWalkthrough} aria-label="Play product walkthrough">
                <span className="mkt-walk-video-bg" aria-hidden="true">
                  <img src="/brand/walkthrough-globe.webp" alt="" width="720" height="405" loading="lazy" decoding="async" />
                </span>
                <span className="mkt-walk-video-brand">— NTER.PRO</span>
                <span className="mkt-walk-video-title">
                  See the bigger picture.
                  <br />
                  In context.
                </span>
                <span className="mkt-walk-video-play" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 7.5v9l7.5-4.5L9 7.5z" />
                  </svg>
                </span>
                <span className="mkt-walk-video-meta">
                  <strong>PRODUCT WALKTHROUGH</strong>
                  <em>02:18</em>
                </span>
                <span className="mkt-walk-video-tags">LEGISLATION · MARKETS · GLOBAL AFFAIRS · AND MORE</span>
                <span className="mkt-walk-video-tip">
                  <i />
                  One platform. Multiple perspectives.
                </span>
              </button>
            ) : null}
            {videoPlaying && playback.kind !== 'file' && playback.kind !== 'iframe' ? (
              <div className="mkt-walk-video-empty">
                <strong>Video slot ready</strong>
                <p>Upload a walkthrough in Admin → Website → Homepage video, or paste a YouTube / Vimeo link.</p>
                <button type="button" className="mkt-cta ghost" onClick={() => setVideoPlaying(false)}>
                  Close
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mkt-wrap">
          <div className="mkt-proof">
            <div className="mkt-proof-cards">
              <svg className="mkt-proof-path" viewBox="0 0 720 56" preserveAspectRatio="none" aria-hidden="true">
                <path d="M24 40 C 140 8, 220 52, 360 22 S 580 48, 696 18" fill="none" stroke="#d9d2c6" strokeWidth="1.5" />
                <circle cx="24" cy="40" r="4.5" fill="#012ea1" />
                <circle cx="360" cy="22" r="4.5" fill="#4f1d90" />
                <circle cx="696" cy="18" r="4.5" fill="#c45c26" />
              </svg>
              <article className="mkt-proof-card t-blue">
                <i>
                  <Ico d="M4 6h16v3H4zm2 5h12v3H6zm2 5h8v3H8z" />
                </i>
                <div>
                  <strong>
                    <b>8</b> Desks
                  </strong>
                  <span>Curated intelligence modules</span>
                </div>
              </article>
              <article className="mkt-proof-card t-purple">
                <i>
                  <Ico d="M7 3h8l5 5v13H7zM15 3v5h5" />
                </i>
                <div>
                  <strong>
                    <b>{figure(figures.bills)}</b> Bills on the tracker
                  </strong>
                  <span>Live and historical legislation</span>
                </div>
              </article>
              <article className="mkt-proof-card t-sand">
                <i>
                  <Ico d="M4 5h16v14H4zM8 3v4M16 3v4M4 9h16" />
                </i>
                <div>
                  <strong>Coverage from 1952 onward</strong>
                  <span>Historical &amp; live data across jurisdictions</span>
                </div>
              </article>
            </div>
            <aside className="mkt-proof-aside">
              <p>Built for researchers, analysts and policy teams</p>
              <ul>
                <li>
                  <i className="tone-blue">
                    <Ico d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" size={14} />
                  </i>
                  Unified access to trusted sources
                </li>
                <li>
                  <i className="tone-purple">
                    <Ico d="M11 4a7 7 0 015.5 11.2L21 20l-1.5 1.5-4.4-4.4A7 7 0 1111 4z" size={14} />
                  </i>
                  Compare, analyse and track in real time
                </li>
                <li>
                  <i className="tone-teal">
                    <Ico d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9.5 12l1.8 1.8L15 10" size={14} />
                  </i>
                  Transparent provenance and source context
                </li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      <section className="mkt-personas" id="personas" aria-labelledby="mkt-personas-title">
        <div className="mkt-wrap">
          <div className="mkt-personas-head">
            <div className="mkt-personas-lead">
              <p className="mkt-personas-kicker">Built for the way you work</p>
              <h2 id="mkt-personas-title" tabIndex={-1}>
                Six ways into the <em>same record.</em>
              </h2>
              <p className="mkt-personas-lede">
                Different roles. A single source of truth. Explore how Niyantran Terminal helps you get the full picture
                — from legislation to global context.
              </p>
            </div>
            <div className="mkt-personas-aside">
              <p className="mkt-personas-aside-kicker">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
                </svg>
                One platform. Multiple perspectives.
              </p>
              <p className="mkt-personas-aside-copy">
                Whether you’re analysing policy, tracking markets, or preparing for a briefing, Niyantran Terminal gives
                you the context you need, in less time.
              </p>
            </div>
          </div>

          <div className="mkt-persona-grid">
            {PERSONAS.map((p, i) => (
              <article
                className={`mkt-persona-card tone-${p.tone}${i === activePersona ? ' on' : ''}`}
                key={p.id}
                onMouseEnter={() => setActivePersona(i)}
              >
                <span className="mkt-persona-num">{String(i + 1).padStart(2, '0')}</span>
                <div className="mkt-persona-visual" aria-hidden="true">
                  <img src={p.img} alt="" loading="lazy" />
                </div>
                <i className="mkt-persona-ico">
                  <Ico d={p.d} size={16} />
                </i>
                <strong>{p.label}</strong>
                <p className="mkt-persona-blurb">{p.blurb}</p>
                <ul>
                  {p.gets.slice(0, 2).map((g) => (
                    <li key={g}>
                      <span className="mkt-persona-check" aria-hidden="true">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                      {g}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={onLogin}>
                  Start as {p.label} →
                </button>
              </article>
            ))}
          </div>

          <div className="mkt-persona-foot">
            <button type="button" className="mkt-persona-all" onClick={onLogin}>
              View all use cases →
            </button>
          </div>
        </div>
      </section>

      {/* CR-10: Removed the "One Terminal. Endless Intelligence." section.
          The carousel (SegmentCarousel) above is the primary segment discovery mechanism.
          The mkt-preview section below serves desk exploration for signed-in context. */}

      <section className="mkt-trivia">
        <div className="mkt-wrap mkt-trivia-inner">
          <span>FIELD NOTE 01</span>
          <p>
            India&apos;s parliamentary record spans two houses, but a bill&apos;s path is not a prediction.
            nter.pro shows the recorded stage and leaves the judgment to you.
          </p>
        </div>
      </section>

      <section className="mkt-ribbon">
        <div className="mkt-wrap">
          <div className="mkt-ribbon-inner">
            <div className="mkt-ribbon-item">
              <i>
                <Ico d="M4 20h16M7 16V10M12 16V6M17 16v-8" size={16} />
              </i>
              <div>
                <div className="n">{figures.endpoints}</div>
                <div className="l">Source Endpoints</div>
              </div>
            </div>
            <div className="mkt-ribbon-item">
              <i>
                <Ico d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18" size={16} />
              </i>
              <div>
                <div className="n">{figures.modules}</div>
                <div className="l">Desk Modules</div>
              </div>
            </div>
            <div className="mkt-ribbon-item">
              <i>
                <Ico d="M4 21h16M4 10h16M12 3l8 7H4z" size={16} />
              </i>
              <div>
                <div className="n">{figure(figures.bills)}</div>
                <div className="l">Bills Tracked</div>
              </div>
            </div>
            <div className="mkt-ribbon-item">
              <i>
                <Ico d="M4 5h16v14H4zM8 3v4M16 3v4M4 9h16" size={16} />
              </i>
              <div>
                <div className="n">1952–2026</div>
                <div className="l">Present Coverage</div>
              </div>
            </div>
            <div className="mkt-ribbon-item">
              <i>
                <Ico d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" size={16} />
              </i>
              <div>
                <div className="n">{figure(figures.documents)}</div>
                <div className="l">Full-text Documents</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
