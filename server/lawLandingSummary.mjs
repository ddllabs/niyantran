import { LAW_FEATURES, projectLawSummary } from '../src/lib/lawLandingSummary.js';
export async function serveLawLanding(searchParams, loadFeed) {
  const feature = searchParams.get('feature');
  if (!LAW_FEATURES.includes(feature)) throw new Error('Unknown Law module');
  const raw = await loadFeed(new URLSearchParams({ tier: 'judiciary', feature }));
  return projectLawSummary({ ...raw, feature, tier: 'judiciary' });
}
