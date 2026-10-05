import { NATIONAL_FEATURES, nationalResourceKey, projectNationalSummary } from '../src/lib/nationalLandingSummary.js';

// Only simultaneous requests share work. No new persisted cache or freshness policy.
const pendingByLoader = new WeakMap();
export async function serveNationalLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!NATIONAL_FEATURES.includes(feature)) throw new Error('Unknown National module');
  const resourceKey = nationalResourceKey(feature);
  let pending = pendingByLoader.get(loadFeed);
  if (!pending) { pending = new Map(); pendingByLoader.set(loadFeed, pending); }
  if (!pending.has(resourceKey)) {
    const request = Promise.resolve(loadFeed(new URLSearchParams({ tier: 'national', feature: resourceKey })));
    pending.set(resourceKey, request);
  }
  const request = pending.get(resourceKey);
  try {
    const raw = await request;
    return projectNationalSummary({ ...raw, feature, tier: 'national' });
  } finally {
    if (pending.get(resourceKey) === request) pending.delete(resourceKey);
  }
}
