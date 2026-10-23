import { LAW_FEATURES, projectLawSummary } from '../src/lib/lawLandingSummary.js';
import { serveLawListingPage } from './lawListingPage.mjs';
export async function serveLawLanding(searchParams, loadFeed, options) {
  const feature = searchParams.get('feature');
  if (!LAW_FEATURES.includes(feature)) throw new Error('Unknown Law module');
  const canonical = await serveLawListingPage(new URLSearchParams({ tier: 'judiciary', feature, page: '1', pageSize: '50' }), options);
  if (canonical && canonical.status !== 200) throw new Error('Law summary unavailable');
  const raw = canonical?.body || await loadFeed(new URLSearchParams({ tier: 'judiciary', feature }));
  const summary = projectLawSummary({ ...raw, feature, tier: 'judiciary' });
  // F154: whether the count came from the live source or, past its time limit, the archive.
  return raw?.served ? { ...summary, served: raw.served } : summary;
}
