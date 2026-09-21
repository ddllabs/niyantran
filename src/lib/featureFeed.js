import { featureFeedApiEnabled, liveApiEnabled } from './apiMode.js';
import { isHtmlOnlyModule } from '../desks/catalog.js';
import features from '../data/html-feature-map.json';
import { fetchArchiveFeature, hasRealRows } from './archiveFeed.js';
import { isTransitFeature, rowFromAir } from './transit.js';

function featureMapRow(tier, feature) {
  const want = String(feature || '').trim().toLowerCase();
  if (!want) return null;
  const tierMods = features.filter((f) => !tier || f.htmlTier === tier);
  return (
    tierMods.find((f) => String(f.htmlFeature || '').toLowerCase() === want) ||
    features.find((f) => String(f.htmlFeature || '').toLowerCase() === want) ||
    null
  );
}

/** Transit Source Library probe — same bbox path as the desk (/api/air), not full-world OpenSky. */
async function fetchTransitLive(signal) {
  const boxes = [
    'lamin=2&lamax=37&lomin=55&lomax=97',
    'lamin=35&lamax=60&lomin=-10&lomax=30',
  ];
  let lastErr = '';
  for (const q of boxes) {
    try {
      const res = await fetch(`/api/air?${q}`, { signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = body?.error || `HTTP ${res.status}`;
        continue;
      }
      const aircraft = body?.aircraft || [];
      if (!aircraft.length) {
        lastErr = body?.error || 'no aircraft in bbox';
        continue;
      }
      const rows = aircraft.slice(0, 500).map((a) => ({
        ...rowFromAir(a),
        date: new Date().toISOString(),
        source_url: 'https://opensky-network.org/api/states/all',
      }));
      return {
        ok: true,
        feature: 'Transit',
        rows,
        source: {
          adapter: 'api',
          links: ['https://opensky-network.org/api/states/all', '/api/air'],
          note: `OpenSky live aircraft via /api/air (${body.source || 'opensky'}).`,
          gdelt: false,
          kind: 'transit',
        },
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
      };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastErr = err.message || String(err);
    }
  }
  return {
    ok: true,
    feature: 'Transit',
    rows: [],
    source: {
      adapter: 'api',
      links: ['https://opensky-network.org/api/states/all', '/api/air'],
      note: lastErr || 'Transit air feed unavailable on this host.',
      gdelt: false,
      kind: 'transit',
    },
    coverage: { from: '', through: '', exhaustive: false },
    fallback: false,
  };
}

export async function fetchFeature({ tier, feature, signal } = {}) {
  const mapRow = featureMapRow(tier, feature);
  // HTML-ONLY: own title, zero rows, no live GDELT stand-in and no sibling archive.
  if (isHtmlOnlyModule(mapRow)) {
    return fetchArchiveFeature({ tier, feature, signal });
  }

  // Transit desk uses /api/air (bbox). Do not probe full-world OpenSky via feature-feed.
  if (isTransitFeature(feature)) {
    if (liveApiEnabled()) {
      const live = await fetchTransitLive(signal);
      if (hasRealRows(live)) return live;
    }
    const archive = await fetchArchiveFeature({ tier, feature, signal });
    if (hasRealRows(archive)) {
      return {
        ...archive,
        fallback: true,
        source: {
          ...(archive.source || {}),
          note: archive.source?.note || 'Transit archive fallback (live /api/air not available).',
        },
      };
    }
    if (liveApiEnabled()) {
      return {
        ok: true,
        feature: 'Transit',
        rows: [],
        source: {
          adapter: 'api',
          note: 'OpenSky /api/air returned no aircraft and no archive is shipped for live positions.',
        },
        fallback: false,
      };
    }
    return {
      ok: true,
      feature: 'Transit',
      rows: [],
      source: {
        adapter: 'api',
        note: 'Live ship/air API is not deployed on this host. No last-known-good Transit archive.',
      },
      fallback: false,
    };
  }

  // Prefer /api/feature-feed when deployed (local Vite + Vercel). Still fall
  // through to the shipped archive when the API misses or returns empty.
  if (!featureFeedApiEnabled()) {
    const archive = await fetchArchiveFeature({ tier, feature, signal });
    if (archive && Array.isArray(archive.rows)) {
      return {
        ...archive,
        ok: true,
        // Honour the pack flag only; never invent a fallback just because the host is static.
        fallback: Boolean(archive.fallback),
        source: {
          ...(archive.source || {}),
          note: archive.source?.note || 'Embedded register on this host.',
        },
      };
    }
  }

  const q = new URLSearchParams();
  if (tier) q.set('tier', tier);
  if (feature) q.set('feature', feature);
  const url = `/api/feature-feed?${q.toString()}`;

  let apiBody = null;
  let apiStatus = 0;
  try {
    const res = await fetch(url, { signal });
    apiStatus = res.status;
    apiBody = await res.json().catch(() => null);
    if (res.ok && hasRealRows(apiBody)) return apiBody;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }

  const archive = await fetchArchiveFeature({ tier, feature, signal });
  if (hasRealRows(archive)) {
    return {
      ...archive,
      fallback: true,
      source: {
        ...(archive.source || {}),
        note:
          archive.source?.note ||
          'Live API is not on this host. Showing the last-known-good archive.',
      },
    };
  }

  if (archive && Array.isArray(archive.rows)) {
    return { ...archive, ok: true, fallback: false };
  }

  if (apiBody) return apiBody;
  throw new Error(apiBody?.error || `feature-feed HTTP ${apiStatus || 404}`);
}
