import openFronts from './adapters/openFronts.js';
import globalIntelligence from './adapters/globalIntelligence.js';
import infra from './adapters/infra.js';
import satellite from './adapters/satellite.js';
import commodities from './adapters/commodities.js';
import growthIndicators from './adapters/growthIndicators.js';
import globalTrade from './adapters/globalTrade.js';
import constitutions from './adapters/constitutions.js';
import headsOfState from './adapters/headsOfState.js';
import newsWire from './adapters/newsWire.js';
import alliances from './adapters/alliances.js';
import sanctions from './adapters/sanctions.js';
import globalAid from './adapters/globalAid.js';
import nuclearWatch from './adapters/nuclearWatch.js';
import { isAlliancesFeature } from '../../lib/alliances.js';
import { isSanctionsFeature } from '../../lib/sanctions.js';
import { isGlobalAidFeature } from '../../lib/globalAid.js';
import { isNuclearWatchFeature } from '../../lib/strategicAssets.js';

/**
 * Which Global modules render the record panel (F121), by feature name. A module not listed here
 * keeps the existing record view. The four dossiers match by the same checks their retired record
 * views used, so the switch covers exactly the names it did before.
 */
const ADAPTERS = [
  [/^open fronts$/i, openFronts],
  [/^(global intelligence|defence procurement intelligence)$/i, globalIntelligence],
  [/^infra$/i, infra],
  [/^satellite infrastructure$/i, satellite],
  [/^global commodities$/i, commodities],
  [/^growth indicators$/i, growthIndicators],
  [/^global trade$/i, globalTrade],
  [/^world constitutions$/i, constitutions],
  [/^heads of state$/i, headsOfState],
  [/^geopolitics news wire$/i, newsWire],
  [{ test: isAlliancesFeature }, alliances],
  [{ test: isSanctionsFeature }, sanctions],
  [{ test: isGlobalAidFeature }, globalAid],
  [{ test: isNuclearWatchFeature }, nuclearWatch],
];

export function adapterFor(feature) {
  const name = String(feature ?? '').trim();
  if (!name) return null;
  return ADAPTERS.find(([pattern]) => pattern.test(name))?.[1] || null;
}
