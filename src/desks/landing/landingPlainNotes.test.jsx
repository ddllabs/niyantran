// F164: the State, Sports and Entertainment landing detail cards repeated each feed's source note,
// including the backup pack's "Exhaustive shipped backup … Live and archive returned no rows." The
// card now shows the note in plain words; the original stays in `sourceNote` and the note's title.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModuleDetail } from './DeskLandingFrame.jsx';
import { STATE_MODULES, stateLandingAnswer } from '../../lib/stateLandingSummary.js';
import { SPORTS_FEATURES, projectSportsSummary } from '../../lib/sportsLandingSummary.js';
import { ENTERTAINMENT_FEATURES, projectEntertainmentSummary } from '../../lib/entertainmentLandingSummary.js';

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
