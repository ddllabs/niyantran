import { ENTERTAINMENT_FEATURES, projectEntertainmentSummary } from '../src/lib/entertainmentLandingSummary.js';
export async function serveEntertainmentLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!ENTERTAINMENT_FEATURES.includes(feature)) throw new Error('Unknown Entertainment module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'entertainment', feature }));
  return projectEntertainmentSummary({ ...raw, feature, tier: 'entertainment' });
}
