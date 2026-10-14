import { GLOBAL_FEATURES, projectGlobalSummary } from '../src/lib/globalLandingSummary.js';

export async function serveGlobalLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!GLOBAL_FEATURES.includes(feature)) throw new Error('Unknown Global module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'geopolitics', feature }));
  const summary = projectGlobalSummary({ ...raw, feature, tier: 'geopolitics' });
  // F154: whether the count came from the live source or, past its time limit, the archive.
  return raw?.served ? { ...summary, served: raw.served } : summary;
}
