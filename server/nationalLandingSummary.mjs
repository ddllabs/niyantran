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
    const summary = projectNationalSummary({ ...raw, feature, tier: 'national' });
    if (raw?.served === 'store') {
      return { ...summary, served: raw.served, fetchedAt: raw.fetchedAt,
        ...(raw.stale ? { stale: true, ageMinutes: raw.ageMinutes } : {}) };
    }
    // F154: whether the count came from the live source or, past its time limit, the archive.
    return raw?.served ? { ...summary, served: raw.served } : summary;
  } finally {
    if (pending.get(resourceKey) === request) pending.delete(resourceKey);
  }
}
