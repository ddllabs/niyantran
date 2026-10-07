import { GLOBAL_FEATURES } from '../lib/globalLandingSummary.js';
import { useGlobalLanding } from './useGlobalLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { summarizeModules } from './landing/deskPresentation.js';
import { GLOBAL_PRESENTATION } from './landing/globalPresentation.js';

export function GlobalLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = GLOBAL_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const sourceCount = mode => {
    const count = modules.filter(module => summaries[module.feature]?.sourceMode === mode && !['error', 'unavailable'].includes(summaries[module.feature]?.availability)).length;
    return totals.pending && !count ? null : count;
  };
  const metrics = [
    { label: 'Counted records', value: totals.count, note: `${totals.knownModules}/${modules.length} measured counts · Mixed entry types; illustrative commodities excluded` },
    { label: 'Stored modules', value: sourceCount('stored'), note: 'Source-linked snapshots; dates and coverage vary' },
    { label: 'Feed-backed modules', value: sourceCount('feed-backed'), note: 'Retrieved entries; partial coverage and periods vary' },
    { label: 'Modules', value: modules.length, note: 'Existing canonical workspaces' },
    { label: 'Sectors', value: GLOBAL_PRESENTATION.groups.length, note: 'Five connected research areas' },
  ];
  const presentation = lang === 'hi' ? { ...GLOBAL_PRESENTATION, name: 'वैश्विक' } : GLOBAL_PRESENTATION;
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics}/>;
}

export default function GlobalLandingView({ onFeature, lang }) {
  const { summaries, retry } = useGlobalLanding(GLOBAL_FEATURES);
  return <GlobalLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
