import { ECONOMICS_FEATURES } from '../lib/economicsLandingSummary.js';
import { useEconomicsLanding } from './useEconomicsLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { summarizeModules } from './landing/deskPresentation.js';
import { ECONOMICS_PRESENTATION } from './landing/economicsPresentation.js';
import './economicsLanding.css';

export function EconomicsLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = ECONOMICS_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const sourceCount = mode => {
    const count = modules.filter(module => summaries[module.feature]?.sourceMode === mode && !['error', 'unavailable'].includes(summaries[module.feature]?.availability)).length;
    return totals.pending && !count ? null : count;
  };
  const quotes = summaries['NSE/BSE Delayed Market Feed'];
  const dataHighlight = {
    title: 'Quotes by exchange', unit: 'quotes', count: quotes?.count,
    items: quotes?.exchangeDistribution || [], asOf: quotes?.asOf,
    description: `Counts from the Indian quote source; prices are not summed. ${quotes?.exchangeUnreported ? `${quotes.exchangeUnreported} quotes have missing or undisplayed exchange labels.` : 'Exchange labels are supplied by the source.'} ${quotes?.limitations || 'Quote coverage is not available yet.'}`,
  };
  const metrics = [
    { label: 'Combined source entries', value: totals.count, note: `${totals.knownModules}/${modules.length} measured counts · units vary by module` },
    { label: 'Stored modules', value: sourceCount('stored'), note: 'Source snapshots; dates and coverage vary' },
    { label: 'Feed-backed modules', value: sourceCount('feed-backed'), note: 'Returned source entries; coverage varies' },
    { label: 'Modules', value: modules.length, note: 'Canonical workspaces; availability varies' },
    { label: 'Sectors', value: ECONOMICS_PRESENTATION.groups.length, note: 'Four economic research areas' },
  ];
  const presentation = lang === 'hi' ? { ...ECONOMICS_PRESENTATION, name: 'अर्थव्यवस्था' } : ECONOMICS_PRESENTATION;
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics} dataHighlight={dataHighlight}/>;
}

export default function EconomicsLandingView({ onFeature, lang }) {
  const { summaries, retry } = useEconomicsLanding(ECONOMICS_FEATURES);
  return <EconomicsLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
