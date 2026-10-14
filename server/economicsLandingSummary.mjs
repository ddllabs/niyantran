import { ECONOMICS_FEATURES, projectEconomicsSummary } from '../src/lib/economicsLandingSummary.js';
export async function serveEconomicsLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!ECONOMICS_FEATURES.includes(feature)) throw new Error('Unknown Economics module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'finance', feature }));
  const summary = projectEconomicsSummary({ ...raw, feature, tier: 'finance' });
  // F154: whether the count came from the live source or, past its time limit, the archive.
  return raw?.served ? { ...summary, served: raw.served } : summary;
}
