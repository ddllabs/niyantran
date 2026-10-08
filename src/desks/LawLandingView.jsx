import { LAW_FEATURES } from '../lib/lawLandingSummary.js';
import { useLawLanding } from './useLawLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { summarizeModules } from './landing/deskPresentation.js';
import { LAW_PRESENTATION } from './landing/lawPresentation.js';

export function LawLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = LAW_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const sourceCount = mode => {
    const count = modules.filter(module => summaries[module.feature]?.sourceMode === mode && !['error', 'unavailable'].includes(summaries[module.feature]?.availability)).length;
    return totals.pending && !count ? null : count;
  };
  const metrics = [
    { label: 'Counted entries', value: totals.count, note: `${totals.knownModules}/${modules.length} measured counts · shared orders counted once` },
    { label: 'Stored modules', value: sourceCount('stored'), note: 'Stored source tables; dates and coverage vary' },
    { label: 'Feed-backed modules', value: sourceCount('feed-backed'), note: 'Entries and reports; overlapping coverage' },
    { label: 'Modules', value: modules.length, note: 'Existing canonical workspaces' },
    { label: 'Sectors', value: LAW_PRESENTATION.groups.length, note: 'Four connected legal research areas' },
  ];
  const presentation = lang === 'hi' ? { ...LAW_PRESENTATION, name: 'विधि' } : LAW_PRESENTATION;
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics}/>;
}

export default function LawLandingView({ onFeature, lang }) {
  const { summaries, retry } = useLawLanding(LAW_FEATURES);
  return <LawLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
