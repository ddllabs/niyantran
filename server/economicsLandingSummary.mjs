import { ECONOMICS_FEATURES, projectEconomicsSummary } from '../src/lib/economicsLandingSummary.js';
export async function serveEconomicsLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!ECONOMICS_FEATURES.includes(feature)) throw new Error('Unknown Economics module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'finance', feature }));
  return projectEconomicsSummary({ ...raw, feature, tier: 'finance' });
}
