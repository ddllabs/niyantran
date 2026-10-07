import { ENTERTAINMENT_FEATURES } from '../lib/entertainmentLandingSummary.js';
import { useEntertainmentLanding } from './useEntertainmentLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { summarizeModules } from './landing/deskPresentation.js';
import { ENTERTAINMENT_PRESENTATION } from './landing/entertainmentPresentation.js';
import './entertainmentLanding.css';

export function EntertainmentLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = ENTERTAINMENT_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const sourceCount = mode => {
    const count = modules.filter(module => summaries[module.feature]?.sourceMode === mode && !['error', 'unavailable'].includes(summaries[module.feature]?.availability)).length;
    return totals.pending && !count ? null : count;
  };
  const tv = summaries['TV & Streaming Tonight'];
  const dataHighlight = {
    title: 'TV listings by country', unit: 'listings', count: tv?.count,
    items: tv?.countryDistribution || [], asOf: tv?.asOf,
    description: `Counts of schedule listings; film gross and follower values are not summed. ${tv?.countryUnreported ? `${tv.countryUnreported} records have missing or undisplayed country labels.` : 'Country labels are supplied by the source.'} ${tv?.limitations || 'Schedule coverage is not available yet.'}`,
  };
  const metrics = [
    { label: 'Combined source entries', value: totals.count, note: `${totals.knownModules}/${modules.length} measured counts · units vary by module` },
    { label: 'Stored modules', value: sourceCount('stored'), note: 'Source snapshots; dates and coverage vary' },
    { label: 'Feed-backed modules', value: sourceCount('feed-backed'), note: 'Returned source entries; coverage varies' },
    { label: 'Modules', value: modules.length, note: 'Canonical workspaces; availability varies' },
    { label: 'Sectors', value: ENTERTAINMENT_PRESENTATION.groups.length, note: 'Four entertainment research areas' },
  ];
  const presentation = lang === 'hi' ? { ...ENTERTAINMENT_PRESENTATION, name: 'मनोरंजन' } : ENTERTAINMENT_PRESENTATION;
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics} dataHighlight={dataHighlight}/>;
}

export default function EntertainmentLandingView({ onFeature, lang }) {
  const { summaries, retry } = useEntertainmentLanding(ENTERTAINMENT_FEATURES);
  return <EntertainmentLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
