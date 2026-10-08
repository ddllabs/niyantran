import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import features from '../../data/html-feature-map.json';
import { GLOBAL_FEATURES } from '../../lib/globalLandingSummary.js';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { DESK_VISUALS } from './deskImages.js';
import { GLOBAL_PRESENTATION } from './globalPresentation.js';
import { ModuleDetail } from './DeskLandingFrame.jsx';
const modules = GLOBAL_PRESENTATION.groups.flatMap(group => group.modules);

describe('Global v6 presentation contract', () => {
  it('maps all16 identities into the five reference groups while keeping global navigation', () => {
    expect(GLOBAL_PRESENTATION.id).toBe('global');
    expect(GLOBAL_PRESENTATION.groups.map(group => group.modules.length)).toEqual([3, 3, 4, 2, 4]);
    expect(modules.map(module => module.feature).sort()).toEqual([...GLOBAL_FEATURES].sort());
    for (const module of modules) {
      expect(module.tier).toBe('geopolitics');
      expect(features.filter(row => row.htmlTier === module.tier && row.htmlFeature === module.feature)).toHaveLength(1);
      const html = renderToStaticMarkup(<ModuleDetail module={module} tab="global" onOpen={() => {}}/>);
      const target = '/' + deskHash('global', module.feature);
      expect(html).toContain(`href="${target}"`);
      expect(parseDeskHash(target.slice(1))).toEqual({ tab: 'global', feature: module.feature });
    }
    expect(GLOBAL_PRESENTATION.groups[0].modules.map(module => module.feature)).toEqual(['Open Fronts', 'Global Intelligence', 'Geopolitics News Wire']);
    expect(GLOBAL_PRESENTATION.groups[1].modules.map(module => module.feature)).toEqual(['Alliances', 'Sanctions', 'Heads of State']);
    expect(GLOBAL_PRESENTATION.groups[3].modules.map(module => module.feature)).toEqual(['Global Aid', 'Energy']);
  });
  it('keeps exact image identities and reference copy while labels disclose upcoming-launch coverage', () => {
    const visual = DESK_VISUALS.global;
    expect(GLOBAL_PRESENTATION.image).toBe(visual.image);
    expect(GLOBAL_PRESENTATION.groups.map(group => group.image)).toEqual(visual.images);
    expect(GLOBAL_PRESENTATION.groups.map(group => group.cardDescription)).toEqual(visual.summaries);
    expect(GLOBAL_PRESENTATION.groups.map(group => group.title.join('<br>'))).toEqual(visual.titles);
    expect(modules.find(module => module.feature === 'Satellite Infrastructure').title).toBe('Upcoming launches');
    expect(modules.find(module => module.title === 'Energy & Critical Minerals').feature).toBe('Energy');
    expect(modules.every(module => !Object.hasOwn(module, 'count'))).toBe(true);
  });
  it('retains partial-country periods, launch fields and illustrative limitations in coverage dialogs', () => {
    const growth = modules.find(module => module.feature === 'Growth Indicators');
    const html = renderToStaticMarkup(<ModuleDetail module={growth} tab="global" onOpen={() => {}} summary={{ count: 2, sourceMode: 'feed-backed', availability: 'ready', period: '2022–2024', columns: [{ key: 'year', label: 'Observation year' }], limitations: 'Existing country set; observation years differ, missing values are not reported.' }}/>);
    expect(html).toContain('2022–2024');
    expect(html).toContain('Observation year');
    expect(html).toContain('observation years differ');
    const launches = modules.find(module => module.feature === 'Satellite Infrastructure');
    const launchHtml = renderToStaticMarkup(<ModuleDetail module={launches} tab="global" onOpen={() => {}} summary={{ count: 1, columns: [{ key: 'net', label: 'Scheduled launch' }], limitations: 'Upcoming launches; not a complete satellite inventory.' }}/>);
    expect(launchHtml).toContain('Scheduled launch');
    expect(launchHtml).toContain('not a complete satellite inventory');
    const board = modules.find(module => module.feature === 'Global Commodities');
    const boardHtml = renderToStaticMarkup(<ModuleDetail module={board} tab="global" onOpen={() => {}} summary={{ count: null, availability: 'unavailable', limitations: 'Illustrative price levels; measured market data unavailable.' }}/>);
    expect(boardHtml).toContain('Measured data unavailable');
    expect(boardHtml).toContain('Illustrative price levels');
  });
});
