import { CARBON_FEATURES, projectCarbonSummary } from '../src/lib/carbonLandingSummary.js';
export async function serveCarbonLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!CARBON_FEATURES.includes(feature)) throw new Error('Unknown Carbon module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'climate', feature }));
  const summary = projectCarbonSummary({ ...raw, feature, tier: 'climate' });
  // F154: whether the count came from the live source or, past its time limit, the archive.
  return raw?.served ? { ...summary, served: raw.served } : summary;
}
