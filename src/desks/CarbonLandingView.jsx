import { CARBON_FEATURES } from '../lib/carbonLandingSummary.js';
import { useCarbonLanding } from './useCarbonLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { summarizeModules } from './landing/deskPresentation.js';
import { CARBON_PRESENTATION } from './landing/carbonPresentation.js';
import './carbonLanding.css';

export function CarbonLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = CARBON_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const sourceCount = mode => {
    const count = modules.filter(module => summaries[module.feature]?.sourceMode === mode && !['error', 'unavailable'].includes(summaries[module.feature]?.availability)).length;
    return totals.pending && !count ? null : count;
  };
  const pricing = summaries['Global Carbon Pricing Tracker'];
  const dataHighlight = {
    title: 'Jurisdiction records', unit: 'jurisdictions', count: pricing?.count,
    items: pricing?.jurisdictionDistribution || [], asOf: pricing?.asOf,
    description: `Counts from the pricing source; prices are not summed. ${pricing?.jurisdictionUnreported ? `${pricing.jurisdictionUnreported} records have missing or undisplayed jurisdiction labels.` : 'Jurisdiction labels are supplied by the source.'} ${pricing?.limitations || 'Pricing coverage is not available yet.'}`,
  };
  const metrics = [
    { label: 'Combined source entries', value: totals.count, note: `${totals.knownModules}/${modules.length} measured counts · units vary by module` },
    { label: 'Stored modules', value: sourceCount('stored'), note: 'Source snapshots; dates and coverage vary' },
    { label: 'Feed-backed modules', value: sourceCount('feed-backed'), note: 'Returned source entries; coverage varies' },
    { label: 'Modules', value: modules.length, note: 'Canonical workspaces; availability varies' },
    { label: 'Sectors', value: CARBON_PRESENTATION.groups.length, note: 'Four climate research areas' },
  ];
  const presentation = lang === 'hi' ? { ...CARBON_PRESENTATION, name: 'कार्बन' } : CARBON_PRESENTATION;
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics} dataHighlight={dataHighlight}/>;
}

export default function CarbonLandingView({ onFeature, lang }) {
  const { summaries, retry } = useCarbonLanding(CARBON_FEATURES);
  return <CarbonLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
