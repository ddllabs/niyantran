import { stateLandingAnswer, stateModule } from '../src/lib/stateLandingSummary.js';

export const stateSummaryUsesStore = feature => feature === 'MLA Directory' || feature === 'MLA Report Card + Statement Tracker';

// F157: the State desk landing's count for one module, without its rows. The module's own tier
// (State or Local) is taken from the catalogue, never from the request.
export async function serveStateLanding(searchParams, loadFeed) {
  const module = stateModule(searchParams.get('feature'));
  if (!module) throw new Error('Unknown State module');
  try {
    const raw = await loadFeed(new URLSearchParams({ tier: module.tier, feature: module.feature }));
    const answer = stateLandingAnswer(module, raw);
    if (!answer.ok) {
      const diagnostic = typeof raw?.source?.diagnostic === 'string' ? raw.source.diagnostic.split(' · ') : [];
      console.warn('[state-landing]', { feature: module.feature,
        code: diagnostic.includes('timeout') ? 'live-timeout' : 'summary-unavailable',
        served: ['live', 'store', 'archive'].includes(raw?.served) ? raw.served : 'unknown' });
    }
    return answer;
  } catch (error) {
    console.warn('[state-landing]', { feature: module.feature, code: 'summary-error' });
    throw error;
  }
}
