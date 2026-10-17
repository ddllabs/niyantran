import { deskHash } from './deskHash.js';
import features from '../data/html-feature-map.json';
import { TABS, bucketsFor, modulesForTier } from '../desks/catalog.js';

export function firstFeature(tabId) {
  const tab = TABS.find((t) => t.id === tabId);
  if (!tab || tab.id === 'home') return '';
  const bucket = bucketsFor(modulesForTier(tab.tier), tab.tier)[0];
  return bucket?.items?.[0]?.htmlFeature || '';
}

function matchFeatureName(list, want) {
  if (!want || !list?.length) return null;
  return (
    list.find((m) => m.htmlFeature === want) ||
    list.find((m) => m.htmlFeature.toLowerCase() === want.toLowerCase()) ||
    null
  );
}

/**
 * Resolve a desk hash to a tab + feature.
 * Empty feature = desk walkthrough (do not auto-open the first dropdown module).
 * Never substitute the first sibling module when the user asked for a specific
 * name (that was D1: HTML-ONLY State/Local routes rendering Constituency Register).
 */
export function resolveDeskRoute(tabId, feature) {
  const tab = TABS.find((t) => t.id === tabId);
  if (!tab || tab.id === 'home') return { tab: 'home', feature: '' };
  const want = String(feature || '').trim();
  if (!want) return { tab: tab.id, feature: '' };

  const navMods = modulesForTier(tab.tier);
  let hit = matchFeatureName(navMods, want);
  if (!hit) {
    const tierMods = features.filter((f) => f.htmlTier === tab.tier);
    hit = matchFeatureName(tierMods, want);
  }
  if (!hit) {
    hit = matchFeatureName(features, want);
  }
  // Keep the requested title even when unknown — DeskView shows Planned/empty.
  // Do not fall through to firstFeature (borrows sibling rows under the wrong name).
  // Booth / municipal modules may live on State nav while their map tier is local.
  if (!hit && tab.id === 'state') {
    hit = matchFeatureName(
      features.filter((f) => f.htmlTier === 'local'),
      want,
    );
  }
  return { tab: tab.id, feature: hit?.htmlFeature || want };
}

export { deskHash } from './deskHash.js';

export function parseDeskHash(hash = typeof location !== 'undefined' ? location.hash : '') {
  const raw = String(hash || '')
    .replace(/^#/, '')
    .replace(/^\/+/, '');
  if (!raw || /^home(?:\/|$)/i.test(raw) || /^nzine\//i.test(raw)) {
    return { tab: 'home', feature: '' };
  }
  const slash = raw.indexOf('/');
  let tabId = slash === -1 ? raw : raw.slice(0, slash);
  let feature = slash === -1 ? '' : raw.slice(slash + 1);
  try {
    tabId = decodeURIComponent(tabId);
    feature = decodeURIComponent(feature);
  } catch {
    /* keep raw segments */
  }
  // Local desk folded into State — keep old bookmarks working.
  if (/^local$/i.test(tabId)) tabId = 'state';
  return resolveDeskRoute(tabId, feature);
}

export function writeDeskHash(tab, feature, { replace = false } = {}) {
  if (typeof history === 'undefined') return;
  const next = deskHash(tab, feature);
  if (location.hash === next) return;
  const url = `${location.pathname}${location.search}${next}`;
  if (replace) history.replaceState({ tab, feature }, '', url);
  else history.pushState({ tab, feature }, '', url);
}
