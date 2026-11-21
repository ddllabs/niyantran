import { withStoreCap } from './landingStoreCap.mjs';
import { ENTERTAINMENT_FEATURES, projectEntertainmentSummary } from '../src/lib/entertainmentLandingSummary.js';
export async function serveEntertainmentLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!ENTERTAINMENT_FEATURES.includes(feature)) throw new Error('Unknown Entertainment module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'entertainment', feature }));
  const summary = projectEntertainmentSummary({ ...raw, feature, tier: 'entertainment' });
  // F154: whether the count came from the live source or, past its time limit, the archive.
  return withStoreCap(raw?.served ? { ...summary, served: raw.served } : summary, raw);
}
