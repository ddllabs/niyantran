import { useEffect, useState, useRef, useMemo } from 'react';
import './carousel.css';

// Shown until /api/home/segments answers, or if it fails. Only true constants:
// the computed counts (bills, ministries, fronts, instruments) come from the server.
export const FALLBACK_SEGMENTS = [
  {
    id: 'legislative',
    title: 'Legislative & Policy Intelligence',
    category: 'National Governance',
    deskId: 'national',
    feature: 'Bill Passage Probability Index',
    status: 'LIVE REGISTRY',
    lastUpdated: 'Monitored Today',
    summary: 'Official parliamentary floor register tracking bills across Lok Sabha & Rajya Sabha.',
    keyMetrics: [{ label: 'Houses Covered', value: '2' }],
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
      { label: 'States & UTs', value: '36' },
    ],
  },
  {
    id: 'media',
    title: 'Representative & Media Intelligence',
    category: 'Public Communications',
    deskId: 'national',
    feature: 'Cabinet Decisions',
    status: 'OFFICIAL WIRES',
    lastUpdated: 'Hourly Sync',
    summary: 'Track PIB statements, ministerial briefings, and parliamentary debates with provenance.',
    keyMetrics: [],
  },
  {
    id: 'operations',
    title: 'Government Operations & Tenders',
    category: 'Public Procurement',
    deskId: 'national',
    feature: 'Central Tender Aggregator + Constituency Filter',
    status: 'LIVE NOTICES',
    lastUpdated: 'Continuous',
    summary: 'GeM tenders, central procurement notices, and ministry infrastructure works.',
    keyMetrics: [],
  },
  {
    id: 'economy',
    title: 'Economy, Finance & Industry',
    category: 'Macroeconomics',
    deskId: 'economics',
    feature: 'NSE/BSE Delayed Market Feed',
    status: 'MARKET DISPATCH',
    lastUpdated: 'Real-time',
    summary: 'CPI combined, IIP manufacturing, merchandise trade, and NSE/BSE indices.',
    keyMetrics: [],
  },
  {
    id: 'global',
    title: 'Global Affairs & Open Fronts',
    category: 'Security & Diplomacy',
    deskId: 'global',
    feature: 'Open Fronts',
    status: 'CRISIS SENSOR',
    lastUpdated: 'Continuous',
    summary: 'Strategic event tracking across international hostilities, bilateral treaties, and multilateral sanctions.',
    keyMetrics: [],
  },
  {
    id: 'climate',
    title: 'Carbon, Energy & Climate',
    category: 'Environmental Policy',
    deskId: 'carbon',
    feature: 'Carbon Border (CBAM) Watch',
    status: 'REGISTRY FEED',
    lastUpdated: 'Daily Audit',
    summary: 'European and domestic carbon tariff tracking, voluntary offset registries, and emissions targets.',
    keyMetrics: [
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
    status: 'BENCH MONITOR',
    lastUpdated: 'Daily Digest',
    summary: 'Supreme Court order digests, High Court precedents, and tribunal dispute settlements.',
    keyMetrics: [{ label: 'Benches Covered', value: '25' }],
  },
];

export default function SegmentCarousel({ onLogin }) {
  const [segments, setSegments] = useState(FALLBACK_SEGMENTS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
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

  // Autoplay progression (every 6 seconds unless hovered or focused)
  useEffect(() => {
    if (isPaused || focusWithin) return;
    autoPlayRef.current = setInterval(() => {
      setActiveIndex((curr) => (curr + 1) % segments.length);
    }, 6000);
    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    };
  }, [isPaused, focusWithin, segments.length]);

  const activeSegment = useMemo(() => {
    return segments[activeIndex] || segments[0];
  }, [segments, activeIndex]);
  const hasCount = typeof activeSegment.liveCount === 'number';
  const metrics = activeSegment.keyMetrics || [];

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
      id="coverage"
      className="mkt-carousel-section"
      aria-label="Analytical Desks Carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false); }}
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
          <article
            className={`mkt-carousel-slide${hasCount || metrics.length ? '' : ' no-metrics'}`}
            key={activeSegment.id}
          >
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

            {/* Live count rail: only figures that exist; a slide without any has no rail. */}
            {(hasCount || metrics.length > 0) && (
              <aside className="mkt-slide-metrics" aria-label="Segment Counts">
                {hasCount && (
                  <div className="mkt-metric-hero">
                    <div className="mkt-metric-hero-val">{activeSegment.liveCount.toLocaleString('en-US')}</div>
                    <div className="mkt-metric-hero-label">{activeSegment.liveCountLabel}</div>
                  </div>
                )}

                {metrics.length > 0 && (
                  <div className="mkt-metric-chips">
                    {metrics.map((m, i) => (
                      <div className="mkt-metric-chip-row" key={i}>
                        <span>{m.label}</span>
                        <strong>{m.value}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            )}
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
