import { stateLandingAnswer, stateModule } from '../src/lib/stateLandingSummary.js';

// F157: the State desk landing's count for one module, without its rows. The module's own tier
// (State or Local) is taken from the catalogue, never from the request.
export async function serveStateLanding(searchParams, loadFeed) {
  const module = stateModule(searchParams.get('feature'));
  if (!module) throw new Error('Unknown State module');
  const raw = await loadFeed(new URLSearchParams({ tier: module.tier, feature: module.feature }));
  return stateLandingAnswer(module, raw);
}
