import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import features from '../../data/html-feature-map.json';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { DESK_VISUALS } from './deskImages.js';
import { ECONOMICS_PRESENTATION } from './economicsPresentation.js';
import { ModuleDetail } from './DeskLandingFrame.jsx';

describe('Economics v6 presentation', () => {
  it('maps all eleven reference modules in four groups to exact finance workspaces', () => {
    const modules = ECONOMICS_PRESENTATION.groups.flatMap(group => group.modules);
    expect(ECONOMICS_PRESENTATION.groups.map(group => group.modules.length)).toEqual([2, 3, 4, 2]);
    expect(modules).toHaveLength(11);
    for (const module of modules) {
      expect(module.tier).toBe('finance');
      expect(features.filter(row => row.htmlTier === module.tier && row.htmlFeature === module.feature)).toHaveLength(1);
      const target = '/' + deskHash('economics', module.feature);
      expect(renderToStaticMarkup(<ModuleDetail module={module} tab="economics" onOpen={() => {}}/>)).toContain(`href="${target}"`);
      expect(parseDeskHash(target.slice(1))).toEqual({ tab: 'economics', feature: module.feature });
      expect(module).not.toHaveProperty('count');
    }
  });
  it('preserves the reference images and crop identities', () => {
    const visual = DESK_VISUALS.economics;
    expect(ECONOMICS_PRESENTATION.image).toBe(visual.image);
    expect(ECONOMICS_PRESENTATION.groups.map(group => group.image)).toEqual(visual.images);
    expect(ECONOMICS_PRESENTATION.groups.map(group => group.title.join('<br>'))).toEqual(visual.titles);
    expect(ECONOMICS_PRESENTATION.groups[0].cardDescription).toBe(visual.summaries[0]);
    expect(ECONOMICS_PRESENTATION.groups[2].cardDescription).toBe(visual.summaries[2]);
    expect(ECONOMICS_PRESENTATION.groups[1].cardDescription).not.toMatch(/scenario tools/);
    expect(ECONOMICS_PRESENTATION.groups[3].cardDescription).not.toMatch(/forecast coverage/);
  });
  it('qualifies narrower capabilities without changing their canonical names', () => {
    const modules = ECONOMICS_PRESENTATION.groups.flatMap(group => group.modules);
    expect(modules.find(module => module.feature === 'Economic Simulator').title).toContain('GDP');
    expect(modules.find(module => module.feature === 'Trade Agreements & Economic Sanctions').title).toContain('DGFT');
    expect(modules.find(module => module.feature === 'Election Forecast Aggregator').title).toBe('Election Forecast Aggregator');
  });
});
