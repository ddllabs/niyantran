import { SPORTS_FEATURES } from '../lib/sportsLandingSummary.js';
import { useSportsLanding } from './useSportsLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { summarizeModules } from './landing/deskPresentation.js';
import { SPORTS_PRESENTATION } from './landing/sportsPresentation.js';
import './sportsLanding.css';

export function SportsLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = SPORTS_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const sourceCount = mode => {
    const count = modules.filter(module => summaries[module.feature]?.sourceMode === mode && !['error', 'unavailable'].includes(summaries[module.feature]?.availability)).length;
    return totals.pending && !count ? null : count;
  };
  const fixtures = summaries['Fixtures & Results — World Leagues'];
  const dataHighlight = {
    title: 'Fixture records by league', unit: 'events', count: fixtures?.count,
    items: fixtures?.leagueDistribution || [], asOf: fixtures?.asOf,
    description: `Counts of fixture/result events for configured leagues. ${fixtures?.leagueUnreported ? `${fixtures.leagueUnreported} records have missing or undisplayed league labels.` : 'League labels are supplied by the source.'} ${fixtures?.limitations || 'Fixture coverage is not available yet.'}`,
  };
  const metrics = [
    { label: 'Combined source entries', value: totals.count, note: `${totals.knownModules}/${modules.length} measured counts · units vary by module` },
    { label: 'Stored modules', value: sourceCount('stored'), note: 'Source snapshots; dates and coverage vary' },
    { label: 'Feed-backed modules', value: sourceCount('feed-backed'), note: 'Returned source entries; coverage varies' },
    { label: 'Modules', value: modules.length, note: 'Canonical workspaces; availability varies' },
    { label: 'Sectors', value: SPORTS_PRESENTATION.groups.length, note: 'Four sports research areas' },
  ];
  const presentation = lang === 'hi' ? { ...SPORTS_PRESENTATION, name: 'खेल' } : SPORTS_PRESENTATION;
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics} dataHighlight={dataHighlight}/>;
}

export default function SportsLandingView({ onFeature, lang }) {
  const { summaries, retry } = useSportsLanding(SPORTS_FEATURES);
  return <SportsLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
