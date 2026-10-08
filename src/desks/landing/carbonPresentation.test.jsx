import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import features from '../../data/html-feature-map.json';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { DESK_VISUALS } from './deskImages.js';
import { CARBON_PRESENTATION } from './carbonPresentation.js';
import { ModuleDetail } from './DeskLandingFrame.jsx';

describe('Carbon v6 presentation', () => {
  it('maps all seven reference modules in four groups to exact climate workspaces', () => {
    const modules = CARBON_PRESENTATION.groups.flatMap(group => group.modules);
    expect(CARBON_PRESENTATION.groups.map(group => group.modules.length)).toEqual([3, 1, 1, 2]);
    expect(modules).toHaveLength(7);
    for (const module of modules) {
      expect(module.tier).toBe('climate');
      expect(features.filter(row => row.htmlTier === module.tier && row.htmlFeature === module.feature)).toHaveLength(1);
      const target = '/' + deskHash('carbon', module.feature);
      expect(renderToStaticMarkup(<ModuleDetail module={module} tab="carbon" onOpen={() => {}}/>)).toContain(`href="${target}"`);
      expect(parseDeskHash(target.slice(1))).toEqual({ tab: 'carbon', feature: module.feature });
      expect(module).not.toHaveProperty('count');
    }
  });
  it('preserves the reference images and crop identities', () => {
    const visual = DESK_VISUALS.carbon;
    expect(CARBON_PRESENTATION.image).toBe(visual.image);
    expect(CARBON_PRESENTATION.groups.map(group => group.image)).toEqual(visual.images);
    expect(CARBON_PRESENTATION.groups.map(group => group.title.join('<br>'))).toEqual(visual.titles);
    expect(CARBON_PRESENTATION.groups[0].cardDescription).toBe(visual.summaries[0]);
    expect(CARBON_PRESENTATION.groups[2].cardDescription).toBe(visual.summaries[2]);
    expect(CARBON_PRESENTATION.groups.map(group => group.cardDescription)).toEqual(visual.summaries);
  });
});
