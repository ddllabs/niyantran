import { useStateLanding } from './useStateLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { STATE_PRESENTATION } from './landing/statePresentation.js';
import { summarizeModules } from './landing/deskPresentation.js';

export function StateLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = STATE_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const constituency = summaries['Constituency Register'];
  const presentation = lang === 'hi' ? { ...STATE_PRESENTATION, name: 'राज्य' } : STATE_PRESENTATION;
  const metrics = [
    { label: 'Measured modules', value: totals.pending && !totals.knownModules ? null : totals.knownModules, note: `${modules.length} modules checked · units and geography vary` },
    { label: 'Modules', value: modules.length, note: '35 reference modules + 6 retained destinations' },
    { label: 'Sectors', value: presentation.groups.length, note: 'Five reference research areas' },
  ];
  const dataHighlight = { title: 'Goa constituencies by district', unit: 'constituencies', count: constituency?.count, items: constituency?.districts || [], asOf: constituency?.asOf, description: 'Counts from the stored Goa Constituency Register only. Other states and district performance scores are not represented by this chart.' };
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics} dataHighlight={dataHighlight}/>;
}

export default function StateLandingView({ onFeature, lang }) {
  const { summaries, retry } = useStateLanding();
  return <StateLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
