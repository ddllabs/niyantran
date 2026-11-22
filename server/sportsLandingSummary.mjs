import { withStoreCap } from './landingStoreCap.mjs';
import { SPORTS_FEATURES, projectSportsSummary } from '../src/lib/sportsLandingSummary.js';
export async function serveSportsLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!SPORTS_FEATURES.includes(feature)) throw new Error('Unknown Sports module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'sports', feature }));
  const summary = projectSportsSummary({ ...raw, feature, tier: 'sports' });
  // F154: whether the count came from the live source or, past its time limit, the archive.
  return withStoreCap(raw?.served ? { ...summary, served: raw.served } : summary, raw);
}
