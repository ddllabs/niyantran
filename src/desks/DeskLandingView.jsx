import { useEffect, useState, useMemo } from 'react';
import { fetchFeature } from '../lib/featureFeed.js';
import { featureMenuLabel } from '../lib/national.js';
import { bucketBlurb, deskIntro, moduleBlurb } from '../lib/deskGuide.js';
import { Icon, TAB_ICON } from '../shell/Icons.jsx';
import { BarList } from '../shell/AnalyticsViz.jsx';
import { TABS } from './catalog.js';
import './deskLanding.css';

/**
 * Flagship module mappings per desk for loading live structured counters and chart.
 */
const DESK_FLAGSHIPS = {
  national: { tier: 'national', feature: 'Bill Passage Probability Index', chartCol: 'status', chartTitle: 'Bill Distribution by Legislative Stage' },
  global: { tier: 'geopolitics', feature: 'Open Fronts', chartCol: 'theatre', chartTitle: 'Fronts by Geopolitical Theatre' },
  economics: { tier: 'finance', feature: 'NSE/BSE Delayed Market Feed', chartCol: 'sector', chartTitle: 'Market Watch Distribution by Sector' },
  state: { tier: 'state', feature: 'Booth-level Results Database', chartCol: 'party', chartTitle: 'Electoral Returns by Alliance' },
  law: { tier: 'judiciary', feature: 'Supreme Court Order & Judgment Feed', chartCol: 'bench', chartTitle: 'Orders on Record by Judicial Bench' },
  carbon: { tier: 'climate', feature: 'Global Carbon Pricing Tracker', chartCol: 'system', chartTitle: 'Pricing Distribution by Mechanism' },
  sports: { tier: 'sports', feature: 'Sports Governance & Policy', chartCol: 'discipline', chartTitle: 'Policy Updates by Discipline' },
  entertainment: { tier: 'entertainment', feature: 'Box Office Tracker', chartCol: 'language', chartTitle: 'Releases Tracked by Territory' },
};

function getCategoryValue(row, preferredCol) {
  if (preferredCol && row[preferredCol] != null && String(row[preferredCol]).trim()) {
    return String(row[preferredCol]).trim();
  }
  const fallbackCandidates = ['status', 'stage', 'category', 'theatre', 'region', 'sector', 'type', 'ministry', 'court'];
  for (const col of fallbackCandidates) {
    if (row[col] != null && String(row[col]).trim()) {
      return String(row[col]).trim();
    }
  }
  return 'General';
}

export default function DeskLandingView({ tab, label, buckets = [], onFeature, lang = 'en' }) {
  const [data, setData] = useState({ rows: [], loading: true, error: null, sourceNote: '' });

  const tabMeta = useMemo(() => TABS.find((t) => t.id === tab) || { tier: tab }, [tab]);
  const config = DESK_FLAGSHIPS[tab] || {
    tier: tabMeta.tier || tab,
    feature: buckets[0]?.items[0]?.htmlFeature || '',
    chartCol: 'category',
    chartTitle: 'Distribution by Category',
  };

  useEffect(() => {
    let cancelled = false;
    setData({ rows: [], loading: true, error: null, sourceNote: '' });

    const ac = new AbortController();
    fetchFeature({ tier: config.tier, feature: config.feature, signal: ac.signal })
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res?.rows) ? res.rows : [];
        setData({
          rows,
          loading: false,
          error: null,
          sourceNote: res?.source?.note || `${config.feature} register`,
        });
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return;
        setData({
          rows: [],
          loading: false,
          error: err.message || 'Could not load desk records',
          sourceNote: '',
        });
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tab, config.tier, config.feature]);

  // Derived real metrics
  const totalRecords = data.rows.length;
  const categories = useMemo(() => {
    const set = new Set();
    for (const r of data.rows) {
      set.add(getCategoryValue(r, config.chartCol));
    }
    return set.size;
  }, [data.rows, config.chartCol]);

  const sourceCount = useMemo(() => {
    const set = new Set();
    for (const r of data.rows) {
      const src = r.source || r.source_url || r.src || r.outlet;
      if (src) set.add(String(src));
    }
    return Math.max(set.size, data.rows.length ? 1 : 0);
  }, [data.rows]);

  const totalModules = useMemo(() => {
    return (buckets || []).flatMap((b) => b.items || []).length;
  }, [buckets]);

  // Chart data from real rows
  const chartItems = useMemo(() => {
    if (!data.rows.length) return [];
    const counts = new Map();
    for (const r of data.rows) {
      const cat = getCategoryValue(r, config.chartCol);
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    // No tone: BarList's default gradient is the app's bar colour. The six
    // named tones used here had no CSS, so every fill was invisible.
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([cat, count]) => ({
        label: cat,
        value: count,
        display: count.toLocaleString(),
      }));
  }, [data.rows, config.chartCol]);

  const intro = deskIntro(tab);

  return (
    <div className="desk desk-wide desk-landing-view" key={tab}>
      {/* Hero Header */}
      <section className="desk-landing-hero">
        <div className="desk-landing-kicker">
          <Icon name={TAB_ICON[tab] || 'globe'} size={16} />
          <span>Desk Intelligence &amp; Registers</span>
        </div>
        <div className="desk-landing-header-row">
          <h1>{label || 'Desk'}</h1>
          <button
            type="button"
            className="desk-landing-tv-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('nter:open-livetv'))}
            title="Open Live TV Broadcasts"
          >
            <span className="live-dot" /> Live TV
          </button>
        </div>
        <p>{intro}</p>
      </section>

      {/* Live Counters Strip */}
      <section className="desk-counters-grid" aria-label="Desk live indicators">
        <div className="desk-counter-card">
          <span className="desk-counter-label">Verified Records</span>
          <span className="desk-counter-value">
            {data.loading ? '…' : totalRecords.toLocaleString()}
          </span>
          <span className="desk-counter-sub">Across primary registry</span>
        </div>

        <div className="desk-counter-card">
          <span className="desk-counter-label">Distinct Sectors/Stages</span>
          <span className="desk-counter-value">
            {data.loading ? '…' : categories.toLocaleString()}
          </span>
          <span className="desk-counter-sub">Tracked classifications</span>
        </div>

        <div className="desk-counter-card">
          <span className="desk-counter-label">Primary Sources</span>
          <span className="desk-counter-value">
            {data.loading ? '…' : sourceCount.toLocaleString()}
          </span>
          <span className="desk-counter-sub">Institutional publishers</span>
        </div>

        <div className="desk-counter-card">
          <span className="desk-counter-label">Active Modules</span>
          <span className="desk-counter-value">{totalModules}</span>
          <span className="desk-counter-sub">Available capabilities</span>
        </div>
      </section>

      {/* One Real Chart */}
      <section className="desk-chart-section" aria-label="Desk visual analysis">
        <header className="desk-chart-header">
          <h2 className="desk-chart-title">
            <Icon name="chart" size={16} />
            {config.chartTitle}
          </h2>
          <span className="desk-chart-source">{data.sourceNote}</span>
        </header>

        {data.loading ? (
          <div className="desk-chart-loading">Loading chart dataset from primary register…</div>
        ) : data.error ? (
          <div className="desk-chart-error">{data.error}</div>
        ) : !chartItems.length ? (
          <div className="desk-chart-empty">No categorical records on file for this desk.</div>
        ) : (
          <BarList items={chartItems} />
        )}
      </section>

      {/* Module Capabilities Cards */}
      <section className="desk-modules-section" aria-label="Available desk modules">
        {(buckets || []).map((b) => (
          <div key={b.label} className="desk-bucket-group">
            <h3 className="desk-bucket-title">{b.label}</h3>
            <p className="desk-bucket-blurb">{bucketBlurb(b.label)}</p>
            <div className="desk-module-cards">
              {b.items.map((m) => {
                const name = m.htmlFeature;
                const title = featureMenuLabel(m) || name;
                const blurb = moduleBlurb(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className="desk-module-card"
                    onClick={() => onFeature?.(name)}
                  >
                    <div className="desk-mod-top">
                      <div className="desk-mod-badge-row">
                        <span className="desk-mod-badge">Module</span>
                      </div>
                      <h4 className="desk-mod-heading">{title}</h4>
                      <p className="desk-mod-desc">{blurb}</p>
                    </div>
                    <span className="desk-mod-action" aria-hidden="true">
                      Launch Module →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
