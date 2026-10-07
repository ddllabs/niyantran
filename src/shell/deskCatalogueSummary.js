import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import { loadNationalSummaries } from '../desks/useNationalLanding.js';
import { loadGlobalSummaries } from '../desks/useGlobalLanding.js';
import { loadLawSummaries } from '../desks/useLawLanding.js';
import { loadEconomicsSummaries } from '../desks/useEconomicsLanding.js';
import { loadCarbonSummaries } from '../desks/useCarbonLanding.js';
import { loadSportsSummaries } from '../desks/useSportsLanding.js';
import { loadEntertainmentSummaries } from '../desks/useEntertainmentLanding.js';

const loaders = { national: loadNationalSummaries, global: loadGlobalSummaries, law: loadLawSummaries, economics: loadEconomicsSummaries, carbon: loadCarbonSummaries, sports: loadSportsSummaries, entertainment: loadEntertainmentSummaries };

/** Identity/access gate before delegating to the existing validated adapter. */
export async function loadDeskCatalogueSummary(entry, { lockedIds = [], signal, fetcher = fetch } = {}) {
  const canonical = DESK_CATALOGUE.find(module => module.id === entry?.id);
  if (!canonical || ['tab', 'tier', 'feature'].some(key => canonical[key] !== entry[key])) throw new Error('Unknown catalogue destination');
  if (lockedIds.includes(canonical.tab) || signal?.aborted) return null;
  let selected = null;
  await loaders[canonical.tab]({ features: [canonical.feature], signal, fetcher, onSummary: summary => {
    if (!signal?.aborted && summary.feature === canonical.feature) selected = summary;
  } });
  return signal?.aborted ? null : selected;
}
