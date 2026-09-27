import { useEffect, useState, useRef, useMemo } from 'react';
import './carousel.css';

const FALLBACK_SEGMENTS = [
  {
    id: 'legislative',
    title: 'Legislative & Policy Intelligence',
    category: 'National Governance',
    deskId: 'national',
    feature: 'Bill Passage Probability Index',
    liveCount: 9819,
    liveCountLabel: 'BILLS ON RECORD',
    status: 'LIVE REGISTRY',
    lastUpdated: 'Monitored Today',
    summary: 'Official parliamentary floor register tracking bills across Lok Sabha & Rajya Sabha.',
    keyMetrics: [
      { label: 'Bills on Record', value: '9,819' },
      { label: 'Houses Covered', value: '2' },
      { label: 'Ministries', value: '48' },
    ],
  },
  {
    id: 'electoral',
    title: 'Electoral Data & Candidate Affidavits',
    category: 'Democratic Representation',
    deskId: 'national',
    feature: 'Candidate Affidavit Database (Structured + API)',
    liveCount: 543,
    liveCountLabel: 'LS CONSTITUENCIES',
    status: 'CERTIFIED RETURNS',
    lastUpdated: 'Verified Returns',
    summary: 'Official constituency returns, candidate affidavit disclosures, and demographic matrices.',
    keyMetrics: [
      { label: 'Constituencies', value: '543' },
      { label: 'States & UTs', value: '28' },
      { label: 'By-Elections', value: '8' },
    ],
  },
  {
    id: 'media',
    title: 'Representative & Media Intelligence',
    category: 'Public Communications',
    deskId: 'national',
    feature: 'Cabinet Decisions',
    liveCount: 128,
    liveCountLabel: 'STATEMENTS THIS WEEK',
    status: 'OFFICIAL WIRES',
    lastUpdated: 'Hourly Sync',
    summary: 'Track PIB statements, ministerial briefings, and parliamentary debates with provenance.',
    keyMetrics: [
      { label: 'Official Sources', value: '14' },
      { label: 'Weekly Releases', value: '128' },
      { label: 'Houses Covered', value: '3' },
    ],
  },
  {
    id: 'operations',
    title: 'Government Operations & Tenders',
    category: 'Public Procurement',
    deskId: 'national',
    feature: 'Central Tender Aggregator + Constituency Filter',
    liveCount: 1280,
    liveCountLabel: 'ACTIVE NOTICES',
    status: 'LIVE NOTICES',
    lastUpdated: 'Continuous',
    summary: 'GeM tenders, central procurement notices, and ministry infrastructure works.',
    keyMetrics: [
      { label: 'Open Tenders', value: '1,280+' },
      { label: 'Ministries', value: '12' },
      { label: 'Closing in 7D', value: '19' },
    ],
  },
  {
    id: 'economy',
    title: 'Economy, Finance & Industry',
    category: 'Macroeconomics',
    deskId: 'economics',
    feature: 'NSE/BSE Delayed Market Feed',
    liveCount: 42,
    liveCountLabel: 'LIVE MACRO SERIES',
    status: 'MARKET DISPATCH',
    lastUpdated: 'Real-time',
    summary: 'CPI combined, IIP manufacturing, merchandise trade, and NSE/BSE indices.',
    keyMetrics: [
      { label: 'Macro Indicators', value: '42' },
      { label: 'Core Publishers', value: '8' },
      { label: 'Market Indices', value: '10' },
    ],
  },
  {
    id: 'global',
    title: 'Global Affairs & Open Fronts',
    category: 'Security & Diplomacy',
    deskId: 'global',
    feature: 'Open Fronts',
    liveCount: 18,
    liveCountLabel: 'MONITORED FRONTS',
    status: 'CRISIS SENSOR',
    lastUpdated: 'Continuous',
    summary: 'Strategic event tracking across international hostilities, bilateral treaties, and multilateral sanctions.',
    keyMetrics: [
      { label: 'Open Fronts', value: '18' },
      { label: 'Theatres', value: '6' },
      { label: 'Source Feeds', value: '9' },
    ],
  },
  {
    id: 'climate',
    title: 'Carbon, Energy & Climate',
    category: 'Environmental Policy',
    deskId: 'carbon',
    feature: 'Carbon Border (CBAM) Watch',
    liveCount: 340,
    liveCountLabel: 'CBAM & REGISTRY ROWS',
    status: 'REGISTRY FEED',
    lastUpdated: 'Daily Audit',
    summary: 'European and domestic carbon tariff tracking, voluntary offset registries, and emissions targets.',
    keyMetrics: [
      { label: 'Monitored Entities', value: '340+' },
      { label: 'Sectors', value: '6' },
      { label: 'Jurisdictions', value: '27' },
    ],
  },
  {
    id: 'judiciary',
    title: 'Judicial Orders & Legal Register',
    category: 'Courts & Tribunals',
    deskId: 'law',
    feature: 'Supreme Court Order & Judgment Feed',
    liveCount: 8420,
    liveCountLabel: 'INDEXED JUDGMENTS',
    status: 'BENCH MONITOR',
    lastUpdated: 'Daily Digest',
    summary: 'Supreme Court order digests, High Court precedents, and tribunal dispute settlements.',
    keyMetrics: [
      { label: 'Orders Indexed', value: '8,420+' },
      { label: 'Tribunals', value: '12' },
      { label: 'Benches Covered', value: '25' },
    ],
  },
];

export default function SegmentCarousel({ onLogin }) {
  const [segments, setSegments] = useState(FALLBACK_SEGMENTS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const autoPlayRef = useRef(null);

  // Fetch authoritative segments & live counts from backend
  useEffect(() => {
    let cancelled = false;
    fetch('/api/home/segments')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.ok && Array.isArray(data.segments) && data.segments.length) {
          setSegments(data.segments);
        }
      })
      .catch(() => {
        // Fallback remains active
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Autoplay progression (every 6 seconds unless hovered)
  useEffect(() => {
    if (isPaused) return;
    autoPlayRef.current = setInterval(() => {
      setActiveIndex((curr) => (curr + 1) % segments.length);
    }, 6000);
    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    };
  }, [isPaused, segments.length]);

  const activeSegment = useMemo(() => {
    return segments[activeIndex] || segments[0];
  }, [segments, activeIndex]);

  function handleOpenDesk(seg) {
    // Preserve intended destination across authentication gate
    if (seg.deskId) {
      sessionStorage.setItem('niyantranLand', seg.deskId);
    }
    if (seg.feature) {
      sessionStorage.setItem('niyantranFeature', seg.feature);
    }
    if (typeof onLogin === 'function') {
      onLogin();
    }
  }

  function prevSlide() {
    setActiveIndex((curr) => (curr - 1 + segments.length) % segments.length);
  }

  function nextSlide() {
    setActiveIndex((curr) => (curr + 1) % segments.length);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      prevSlide();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextSlide();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(segments.length - 1);
    }
  }

  return (
    <section
      className="mkt-carousel-section"
      aria-label="Analytical Desks Carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="mkt-wrap">
        <header className="mkt-carousel-header">
          <p className="mkt-carousel-kicker">— Intelligence Workbenches</p>
          <h2>Authoritative Desk Segments</h2>
          <p>
            One slide per analytical segment with live server-side record counts. Inspect public
            metadata now and access full datasets after signing in.
          </p>
        </header>

        {/* Quick Nav Chips */}
        <nav className="mkt-carousel-nav-tabs" aria-label="Segment Selector">
          {segments.map((seg, idx) => (
            <button
              type="button"
              key={seg.id}
              className={`mkt-carousel-nav-btn${idx === activeIndex ? ' active' : ''}`}
              onClick={() => setActiveIndex(idx)}
            >
              {seg.title.split('&')[0].trim()}
            </button>
          ))}
        </nav>

        {/* Active Segment Slide */}
        <div className="mkt-carousel-stage">
          <article className="mkt-carousel-slide" key={activeSegment.id}>
            <div className="mkt-slide-info">
              <div className="mkt-slide-meta">
                <span className="mkt-slide-index">
                  {String(activeIndex + 1).padStart(2, '0')} / {String(segments.length).padStart(2, '0')}
                </span>
                <span className="mkt-slide-category">{activeSegment.category}</span>
                <span className="mkt-slide-status">
                  <span className="mkt-slide-dot" /> {activeSegment.status}
                </span>
              </div>

              <h3>{activeSegment.title}</h3>
              <p>{activeSegment.summary}</p>

              <div className="mkt-slide-actions">
                <button
                  type="button"
                  className="mkt-slide-cta"
                  onClick={() => handleOpenDesk(activeSegment)}
                  title={`Open ${activeSegment.title} desk`}
                >
                  Open {activeSegment.deskId} Desk &rarr;
                </button>
                <span className="mkt-slide-hint">Sign-in opens this exact desk</span>
              </div>
            </div>

            {/* Authoritative Live Count Rail Card */}
            <aside className="mkt-slide-metrics" aria-label="Segment Counts">
              <div className="mkt-metric-hero">
                <div className="mkt-metric-hero-val">
                  {typeof activeSegment.liveCount === 'number'
                    ? activeSegment.liveCount.toLocaleString()
                    : activeSegment.liveCount}
                </div>
                <div className="mkt-metric-hero-label">{activeSegment.liveCountLabel}</div>
              </div>

              <div className="mkt-metric-chips">
                {(activeSegment.keyMetrics || []).map((m, i) => (
                  <div className="mkt-metric-chip-row" key={i}>
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                  </div>
                ))}
              </div>
            </aside>
          </article>

          {/* Navigation Controls & Dot Indicators */}
          <div className="mkt-carousel-controls">
            <button
              type="button"
              className="mkt-carousel-arrow"
              onClick={prevSlide}
              aria-label="Previous Segment Slide"
              title="Previous Segment"
            >
              &#8592;
            </button>

            <div className="mkt-carousel-dots" role="tablist">
              {segments.map((s, idx) => (
                <button
                  type="button"
                  key={s.id}
                  className={`mkt-carousel-dot${idx === activeIndex ? ' active' : ''}`}
                  onClick={() => setActiveIndex(idx)}
                  aria-label={`Go to slide ${idx + 1}: ${s.title}`}
                  role="tab"
                  aria-selected={idx === activeIndex}
                />
              ))}
            </div>

            <button
              type="button"
              className="mkt-carousel-arrow"
              onClick={nextSlide}
              aria-label="Next Segment Slide"
              title="Next Segment"
            >
              &#8594;
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
