import { featureFeedApiEnabled, liveApiEnabled } from './apiMode.js';
import { isHtmlOnlyModule } from '../desks/catalog.js';
import features from '../data/html-feature-map.json';
import { fetchArchiveFeature, hasRealRows } from './archiveFeed.js';
import { isTransitFeature, rowFromAir } from './transit.js';
import { isPagedFeature, pageQuery } from './pagedFeatures.js';

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

async function requestFeatureFeed(url, signal) {
  try {
    const res = await fetch(url, { signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, status: 0, body: null };
  }
}

function archiveAsFallback(archive, note) {
  return {
    ...archive,
    fallback: true,
    source: { ...(archive.source || {}), note: archive.source?.note || note },
  };
}

// F159: notes a reader sees over stored rows; the server's own are in server/featureFeed.mjs.
const STORED_NOTE = 'Showing the latest stored records.';
const STORED_LOADING_NOTE = 'Showing the latest stored records. Live data is still loading.';

// What the page shows when the API has no rows for it. When the server answered from its stored
// records because live data is still loading (`served: 'archive'`), the answer keeps saying so,
// so that the page asks again (src/desks/moduleLiveRetry.js).
function withoutLive(archive, api) {
  const pending = api.body?.served === 'archive' ? { served: 'archive' } : {};
  if (hasRealRows(archive)) {
    return { ...archiveAsFallback(archive, STORED_NOTE), ...pending };
  }
  if (archive && Array.isArray(archive.rows)) {
    return { ...archive, ok: true, fallback: false, ...pending };
  }
  if (api.body) return api.body;
  // The message is matched by src/lib/refreshFeeds.js; DeskView shows its own words instead.
  throw new Error(api.body?.error || `feature-feed HTTP ${api.status || 404}`);
}

// An API answer this quick is shown directly, so a cached (edge) answer does not flash the archive.
const ARCHIVE_GRACE_MS = 500;

function abortError() {
  return Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

/**
 * F154: with onUpdate, the shipped archive and /api/feature-feed start together. When the archive
 * has rows and the API has not answered within ARCHIVE_GRACE_MS, the archive is returned
 * (`fallback`, `refreshing: true`); onUpdate later receives the live rows (`updatedLive: true`)
 * or, if the API has none, the archive with `refreshing: false`.
 * A quicker API answer is returned as before. Without onUpdate the API is awaited first, as before.
 */
async function archiveFirst({ tier, feature, signal, url, onUpdate }) {
  const archiveAc = new AbortController();
  const stopArchive = () => archiveAc.abort();
  signal?.addEventListener('abort', stopArchive, { once: true });
  const apiRequest = requestFeatureFeed(url, signal);
  const archiveRequest = fetchArchiveFeature({ tier, feature, signal: archiveAc.signal })
    .catch(() => null)
    .finally(() => signal?.removeEventListener('abort', stopArchive));

  let graceTimer;
  const grace = new Promise((resolve) => {
    graceTimer = setTimeout(resolve, ARCHIVE_GRACE_MS);
  });
  const first = await Promise.race([
    apiRequest.then((api) => ({ api })),
    Promise.all([archiveRequest, grace]).then(([archive]) => ({ archive })),
  ]).finally(() => clearTimeout(graceTimer));
  if (first.api) {
    if (first.api.ok && hasRealRows(first.api.body)) {
      archiveAc.abort();
      return first.api.body;
    }
    const archive = await archiveRequest;
    if (signal?.aborted) throw abortError();
    return withoutLive(archive, first.api);
  }
  if (!hasRealRows(first.archive)) {
    const api = await apiRequest;
    if (api.ok && hasRealRows(api.body)) return api.body;
    return withoutLive(first.archive, api);
  }
  const shown = {
    ...archiveAsFallback(first.archive, STORED_LOADING_NOTE),
    refreshing: true,
  };
  apiRequest.then(
    (api) => {
      if (signal?.aborted) return;
      // F159: stored records from the server (`served: 'archive'`) are not a live update.
      const servedArchive = api.body?.served === 'archive';
      if (api.ok && hasRealRows(api.body)) onUpdate({ ...api.body, refreshing: false, ...(servedArchive ? {} : { updatedLive: true }) });
      else onUpdate({ ...shown, refreshing: false, ...(servedArchive ? { served: 'archive' } : {}) });
    },
    () => {},
  );
  return shown;
}

export async function fetchFeature({ tier, feature, signal, onUpdate, params } = {}) {
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
  // F169 T3: extra inputs a module's server loader reads (the Statement Tracker's `person`).
  for (const [k, v] of Object.entries(params || {})) {
    if (k !== 'tier' && k !== 'feature' && v != null && v !== '') q.set(k, String(v));
  }
  const url = `/api/feature-feed?${q.toString()}`;

  if (onUpdate) return archiveFirst({ tier, feature, signal, url, onUpdate });

  const api = await requestFeatureFeed(url, signal);
  if (api.ok && hasRealRows(api.body)) return api.body;
  const archive = await fetchArchiveFeature({ tier, feature, signal });
  return withoutLive(archive, api);
}

/**
 * F156: one page of a large module (src/lib/pagedFeatures.js) from /api/feature-feed: its rows,
 * `total`, `totalAll`, `columns`, `filterGroups` and `overview`, already prepared. Resolves null when
 * the API is not on this host, fails, or answers the whole module instead; the caller then loads the
 * whole module as before. Throws only an AbortError.
 */
export async function fetchFeaturePage({ signal, ...view } = {}) {
  if (!featureFeedApiEnabled() || !isPagedFeature(view.feature)) return null;
  const api = await requestFeatureFeed(`/api/feature-feed?${pageQuery(view)}`, signal);
  return api.ok && api.body?.paged ? api.body : null;
}
