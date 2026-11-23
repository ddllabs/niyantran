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
import nationalBills from './adapters/nationalBills.js';
import nationalPipeline from './adapters/nationalPipeline.js';
import nationalQuestions from './adapters/nationalQuestions.js';
import nationalRegulatory from './adapters/nationalRegulatory.js';
import nationalMps from './adapters/nationalMps.js';
import nationalCabinet from './adapters/nationalCabinet.js';
import nationalAffidavits from './adapters/nationalAffidavits.js';
import nationalMorningBrief from './adapters/nationalMorningBrief.js';
import lawInsolvency from './adapters/lawInsolvency.js';
import lawSupremeCourt, { lawOrdersByTopic } from './adapters/lawSupremeCourt.js';
import lawWire, { LAW_WIRE_FEATURES } from './adapters/lawWire.js';
import lawWtoRegister, { isRegisterRow } from './adapters/lawWtoRegister.js';
import { DESKS } from '../../lib/impactRecord.js';
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
  // National (F124): matched as NationalRecord matched them, so exactly the same names switch.
  [DESKS.bill.match, nationalBills],
  [DESKS.pipeline.match, nationalPipeline],
  [DESKS.question.match, nationalQuestions],
  [DESKS.regulatory.match, nationalRegulatory],
  [/mp profiles|mp report/i, nationalMps],
  // The State desk has its own "Cabinet Decisions" module, so this one is matched on the National desk only.
  [/^cabinet decisions$/i, nationalCabinet, { tier: 'national' }],
  [/candidate affidavit/i, nationalAffidavits, { tier: 'national' }],
  [/morning brief/i, nationalMorningBrief, { tier: 'national' }],
  // Law (F128): matched on the judiciary tier, by the names lawPack.js and the catalogue use.
  [/^nclt/i, lawInsolvency, { tier: 'judiciary' }],
  [/^supreme court order/i, lawSupremeCourt, { tier: 'judiciary' }],
  [/^order archive by topic/i, lawOrdersByTopic, { tier: 'judiciary' }],
  // WTO (F129): a register row gets the register panel; a news row (the fallback feed) the news panel.
  [/^wto dispute settlement$/i, (row, ctx) => (isRegisterRow(row) ? lawWtoRegister(row, ctx) : lawWire(row, ctx)), { tier: 'judiciary' }],
  // The nine news-wire modules by exact name (an object with a test(), like the dossier checks above).
  [{ test: (name) => LAW_WIRE_FEATURES.includes(name) }, lawWire, { tier: 'judiciary' }],
];

export function adapterFor(feature, tier) {
  const name = String(feature ?? '').trim();
  if (!name) return null;
  return ADAPTERS.find(([pattern, , only]) => pattern.test(name) && (!only?.tier || only.tier === tier))?.[1] || null;
}
