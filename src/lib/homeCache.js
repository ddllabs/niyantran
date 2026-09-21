import { homeLiveApiEnabled, liveApiEnabled } from './apiMode.js';
import { loadRefreshCfg } from './refreshStore.js';

const KEY = 'niyantranHomeDesk';

let kickAt = 0;
let kickInflight = null;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    return d;
  } catch {
    return null;
  }
}

export function loadHomeCache() {
  return read();
}

export function homeCacheHasRows(cache = read()) {
  return Boolean(cache?.markets?.rows?.length || cache?.latest?.rows?.length || cache?.pulse?.rows?.length);
}

export function homeCacheAgeHours(cache = read()) {
  const t = Number(cache?.savedAt);
  if (!Number.isFinite(t) || t <= 0) return Infinity;
  return (Date.now() - t) / 3600000;
}

export function isHomeCacheFresh(hours, cache = read()) {
  const n = Number(hours);
  const maxH = Number.isFinite(n) && n > 0 ? n : loadRefreshCfg().intervalHours;
  return homeCacheHasRows(cache) && homeCacheAgeHours(cache) < maxH;
}

export function saveHomeCache({ markets, latest, pulse }) {
  const prev = read() || {};
  const next = {
    savedAt: Date.now(),
    markets: markets || prev.markets || null,
    latest: latest || prev.latest || null,
    pulse: pulse || prev.pulse || null,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

/** Live Yahoo / nter.news / GDELT — when the admin interval has elapsed. */
export function kickHomeRefreshIfDue() {
  const cfg = loadRefreshCfg();
  if (!cfg.auto) return Promise.resolve(null);
  // Home refresh route is deployed on Vercel — allow outside Vite DEV.
  if (!homeLiveApiEnabled() && !liveApiEnabled()) return Promise.resolve(null);
  const hours = cfg.intervalHours;
  const cache = read();
  if (!homeCacheHasRows(cache)) return Promise.resolve(null);
  if (homeCacheAgeHours(cache) < hours) return Promise.resolve(null);
  const sinceKick = kickAt ? (Date.now() - kickAt) / 3600000 : Infinity;
  if (sinceKick < hours) return kickInflight || Promise.resolve(null);
  kickAt = Date.now();
  if (kickInflight) return kickInflight;
  kickInflight = fetch('/api/home/refresh')
    .then((r) => r.json().catch(() => null))
    .catch(() => null)
    .finally(() => {
      kickInflight = null;
    });
  return kickInflight;
}
