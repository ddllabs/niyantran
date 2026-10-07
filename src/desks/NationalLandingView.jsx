import { BILL_FEATURE, NATIONAL_FEATURES } from '../lib/nationalLandingSummary.js';
import { useNationalLanding } from './useNationalLanding.js';
import DeskLandingFrame from './landing/DeskLandingFrame.jsx';
import { NATIONAL_PRESENTATION, summarizeModules } from './landing/deskPresentation.js';

export function NationalLandingContent({ summaries = {}, onFeature, retry, lang = 'en' }) {
  const modules = NATIONAL_PRESENTATION.groups.flatMap(group => group.modules);
  const totals = summarizeModules(modules, summaries);
  const metric = (feature, label, note) => ({ label, value: summaries[feature]?.count, note });
  const metrics = [
    { label: 'Records on file', value: totals.count, note: `Known counts; shared bills counted once${totals.pending ? ' · loading' : ''}` },
    metric(BILL_FEATURE, 'Bills', 'Prepared bill register; classification varies'),
    metric(NATIONAL_FEATURES[2], 'Questions', 'Stored question sample; partial coverage'),
    metric(NATIONAL_FEATURES[5], 'MP profiles', 'Members in the supplied register'),
    { label: 'Modules', value: modules.length, note: 'Five sectors; coverage shown within each module' },
  ];
  const presentation = lang === 'hi' ? { ...NATIONAL_PRESENTATION, name: 'राष्ट्रीय' } : NATIONAL_PRESENTATION;
  return <DeskLandingFrame presentation={presentation} summaries={summaries} onFeature={onFeature} retry={retry} lang={lang} metrics={metrics}/>;
}

export default function NationalLandingView({ onFeature, lang }) {
  const { summaries, retry } = useNationalLanding(NATIONAL_FEATURES);
  return <NationalLandingContent summaries={summaries} onFeature={onFeature} retry={retry} lang={lang}/>;
}
