import { CARBON_FEATURES, projectCarbonSummary } from '../src/lib/carbonLandingSummary.js';
export async function serveCarbonLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!CARBON_FEATURES.includes(feature)) throw new Error('Unknown Carbon module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'climate', feature }));
  return projectCarbonSummary({ ...raw, feature, tier: 'climate' });
}
