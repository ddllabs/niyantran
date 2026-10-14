import { LAW_FEATURES, projectLawSummary } from '../src/lib/lawLandingSummary.js';
export async function serveLawLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!LAW_FEATURES.includes(feature)) throw new Error('Unknown Law module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'judiciary', feature }));
  const summary = projectLawSummary({ ...raw, feature, tier: 'judiciary' });
  // F154: whether the count came from the live source or, past its time limit, the archive.
  return raw?.served ? { ...summary, served: raw.served } : summary;
}
