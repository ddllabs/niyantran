// F164: the State, Sports and Entertainment landing detail cards repeated each feed's source note,
// including the backup pack's "Exhaustive shipped backup … Live and archive returned no rows." The
// card now shows the note in plain words; the original stays in `sourceNote` and the note's title.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModuleDetail } from './DeskLandingFrame.jsx';
import { STATE_MODULES, stateLandingAnswer } from '../../lib/stateLandingSummary.js';
import { SPORTS_FEATURES, projectSportsSummary } from '../../lib/sportsLandingSummary.js';
import { ENTERTAINMENT_FEATURES, projectEntertainmentSummary } from '../../lib/entertainmentLandingSummary.js';
import { projectNationalSummary } from '../../lib/nationalLandingSummary.js';
import { projectGlobalSummary } from '../../lib/globalLandingSummary.js';
import { projectLawSummary } from '../../lib/lawLandingSummary.js';
import { projectEconomicsSummary } from '../../lib/economicsLandingSummary.js';
import { projectCarbonSummary } from '../../lib/carbonLandingSummary.js';
import { NATIONAL_PRESENTATION } from './deskPresentation.js';
import { GLOBAL_PRESENTATION } from './globalPresentation.js';
import { LAW_PRESENTATION } from './lawPresentation.js';
import { ECONOMICS_PRESENTATION } from './economicsPresentation.js';
import { CARBON_PRESENTATION } from './carbonPresentation.js';
import { SPORTS_PRESENTATION } from './sportsPresentation.js';
import { ENTERTAINMENT_PRESENTATION } from './entertainmentPresentation.js';
import { STATE_PRESENTATION } from './statePresentation.js';
import { NationalLandingContent } from '../NationalLandingView.jsx';
import { GlobalLandingContent } from '../GlobalLandingView.jsx';
import { LawLandingContent } from '../LawLandingView.jsx';
import { EconomicsLandingContent } from '../EconomicsLandingView.jsx';
import { CarbonLandingContent } from '../CarbonLandingView.jsx';
import { SportsLandingContent } from '../SportsLandingView.jsx';
import { EntertainmentLandingContent } from '../EntertainmentLandingView.jsx';
import { StateLandingContent } from '../StateLandingView.jsx';

const DEVELOPER =
  /GDELT|DOC 2\.0|rate.?limit|≥|paced|\barchives?\b|\bhost\b|backend|adapter|\/api\/|\bRSS\b|unavailable:|HTTP \d|SPARQL|proxy|last-known-good|shipped backup|feature map|fallback|workbook|\bpack\b/i;
const BACKUP_NOTE = 'Exhaustive shipped backup · 500 rows (pack has 4,104; capped for display) · Published source scope loaded. Live and archive returned no rows.';
// What a reader sees: the card's text, without its markup or attributes.
const shown = (module, summary) => renderToStaticMarkup(<ModuleDetail module={module} summary={summary} tab={module.tier} onOpen={() => {}} />)
  .replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const backup = (tier, feature) => ({ ok: true, tier, feature, rows: Array.from({ length: 5 }, (_, i) => ({ title: `Row ${i}` })), fallback: true, served: 'archive',
  source: { adapter: 'embedded', kind: 'backup-pack', links: ['/backup/state/x.xlsx'], note: BACKUP_NOTE } });

describe('landing detail cards (F164)', () => {
  it.each(STATE_MODULES.filter((m) => m.configured).map((m) => [m.feature, m]))('State · %s: backup pack and no-register notes', (_, module) => {
    const fromBackup = stateLandingAnswer(module, backup(module.tier, module.feature));
    expect(shown(module, fromBackup)).not.toMatch(DEVELOPER);
    expect(fromBackup.sourceNote).toBe(BACKUP_NOTE);
    expect(renderToStaticMarkup(<ModuleDetail module={module} summary={fromBackup} tab={module.tier} onOpen={() => {}} />)).toContain('title="Exhaustive shipped backup');
    const noRegister = stateLandingAnswer(module, { ok: true, tier: module.tier, feature: module.feature, rows: [], source: { adapter: 'api', links: [] } });
    expect(shown(module, noRegister)).not.toMatch(DEVELOPER);
  });

  it('State: a plain source note is still shown', () => {
    const module = STATE_MODULES.find((m) => m.feature === 'State Governance Brief');
    const summary = stateLandingAnswer(module, { ok: true, tier: module.tier, feature: module.feature, rows: [{ title: 'Story', source_url: 'https://news.google.com/x' }],
      source: { adapter: 'news-search', links: [], note: 'Not a personalised governance digest.' } });
    expect(shown(module, summary)).toContain('Not a personalised governance digest.');
  });

  it.each(SPORTS_FEATURES)('Sports · %s: technical notes stay off the card', (feature) => {
    const module = { tier: 'sports', feature, title: feature };
    expect(shown(module, projectSportsSummary(backup('sports', feature)))).not.toMatch(DEVELOPER);
    const live = projectSportsSummary({ ok: true, tier: 'sports', feature, rows: [{ title: 'A', home: 'H', away: 'W', league: 'L', person: 'P' }],
      source: { adapter: 'api', links: ['https://www.espncricinfo.com/rss/content/story/feeds/0.xml'], note: 'ESPNcricinfo story RSS — matches, results and reports. Not a GDELT search.' } });
    expect(shown(module, live)).not.toMatch(DEVELOPER);
  });

  it.each(ENTERTAINMENT_FEATURES)('Entertainment · %s: technical notes stay off the card', (feature) => {
    const module = { tier: 'entertainment', feature, title: feature };
    expect(shown(module, projectEntertainmentSummary(backup('entertainment', feature)))).not.toMatch(DEVELOPER);
    const live = projectEntertainmentSummary({ ok: true, tier: 'entertainment', feature, rows: [{ title: 'A' }],
      source: { adapter: 'api', links: ['https://variety.com/feed/'], note: 'Variety RSS — screen-trade headlines. Not a GDELT search.' } });
    expect(shown(module, live)).not.toMatch(DEVELOPER);
  });

  it('a plain sports note is still shown', () => {
    const module = { tier: 'sports', feature: 'ISL Tracker', title: 'ISL Tracker' };
    const summary = projectSportsSummary({ ok: true, tier: 'sports', feature: 'ISL Tracker', rows: [{ title: 'A', home: 'H', away: 'W', league: 'ISL' }],
      source: { adapter: 'api', links: [], note: 'ESPN empty; TheSportsDB ISL.' } });
    expect(shown(module, summary)).toContain('ESPN empty; TheSportsDB ISL.');
  });
});

// F165: the other desks' cards still spoke of "Reporting search / RSS", "PIB RSS reporting", "the
// existing adapter", "not a live ECI API", "The API response blends…", "workspace overlays" and
// "fallback". Every desk's landing (hero, sector cards, explorer, stat tiles) and every module's detail
// card, for each kind of source a module can answer from, is checked against this list.
const FORBIDDEN =
  /GDELT|DOC 2\.0|\bRSS\b|adapter|archive|\bhosts?\b|backend|\bAPI\b|endpoint|\bpacks?\b|fallback|\/api\/|\bsync\b|embedded|proxy|overlay|ingest|shipped/i;
const DESKS = {
  national: [NATIONAL_PRESENTATION, projectNationalSummary, NationalLandingContent],
  global: [GLOBAL_PRESENTATION, projectGlobalSummary, GlobalLandingContent],
  law: [LAW_PRESENTATION, projectLawSummary, LawLandingContent],
  economics: [ECONOMICS_PRESENTATION, projectEconomicsSummary, EconomicsLandingContent],
  carbon: [CARBON_PRESENTATION, projectCarbonSummary, CarbonLandingContent],
  sports: [SPORTS_PRESENTATION, projectSportsSummary, SportsLandingContent],
  entertainment: [ENTERTAINMENT_PRESENTATION, projectEntertainmentSummary, EntertainmentLandingContent],
  state: [STATE_PRESENTATION, (raw, module) => stateLandingAnswer(module, raw), StateLandingContent],
};
const LIVE_ROWS = [{ title: 'Item', date: '2026-01-01', year: 2024, value: 1, weighted_price_usd: 3, jurisdiction: 'X', home: 'H', away: 'W', league: 'L', source_url: 'https://example.org/a' }];
// The kinds of answer the landing summaries tell apart (src/lib/*LandingSummary.js).
const ANSWERS = ['embedded', 'api', 'news-search', 'live'].map((adapter) => ({ adapter }));
const lines = (html) => html.replace(/<[^>]+>/g, '\n').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').split('\n').map((t) => t.trim()).filter(Boolean);

describe.each(Object.entries(DESKS))('%s landing (F165)', (desk, [presentation, project, Content]) => {
  const modules = presentation.groups.flatMap((group) => group.modules);
  const summariesFor = ({ adapter }) => Object.fromEntries(modules.map((module) => {
    const raw = { ok: true, tier: module.tier, feature: module.feature, rows: LIVE_ROWS, source: { adapter, links: ['https://example.org/'], note: 'Source note.' } };
    try { return [module.feature, project(raw, module)]; } catch { return [module.feature, undefined]; }
  }));

  it('hero, sector cards and explorer text', () => {
    const texts = [presentation.description, ...presentation.groups.flatMap((group) => [group.name, group.description, group.cardDescription])].filter(Boolean);
    expect(texts.filter((t) => FORBIDDEN.test(t))).toEqual([]);
    for (const answer of ANSWERS) {
      const page = lines(renderToStaticMarkup(<Content summaries={summariesFor(answer)} onFeature={() => {}} />));
      expect(page.filter((t) => FORBIDDEN.test(t)), answer.adapter).toEqual([]);
    }
  });

  it.each(ANSWERS.map((answer) => [answer.adapter, answer]))('every module detail card, answered by %s', (_, answer) => {
    const summaries = summariesFor(answer);
    const found = modules.flatMap((module) => lines(renderToStaticMarkup(<ModuleDetail module={module} summary={summaries[module.feature]} tab={module.tier} onOpen={() => {}} />))
      .filter((t) => FORBIDDEN.test(t)).map((t) => `${module.feature}: ${t}`));
    expect(found).toEqual([]);
  });
});
