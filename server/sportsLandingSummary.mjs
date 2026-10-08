import { SPORTS_FEATURES, projectSportsSummary } from '../src/lib/sportsLandingSummary.js';
export async function serveSportsLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!SPORTS_FEATURES.includes(feature)) throw new Error('Unknown Sports module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'sports', feature }));
  return projectSportsSummary({ ...raw, feature, tier: 'sports' });
}
