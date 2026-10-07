import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import features from '../../data/html-feature-map.json';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { DESK_VISUALS } from './deskImages.js';
import { SPORTS_PRESENTATION } from './sportsPresentation.js';
import { ModuleDetail } from './DeskLandingFrame.jsx';

describe('Sports v6 presentation', () => {
  it('maps all eight reference modules in four groups to exact sports workspaces', () => {
    const modules = SPORTS_PRESENTATION.groups.flatMap(group => group.modules);
    expect(SPORTS_PRESENTATION.groups.map(group => group.modules.length)).toEqual([2, 2, 2, 2]);
    expect(modules).toHaveLength(8);
    for (const module of modules) {
      expect(module.tier).toBe('sports');
      expect(features.filter(row => row.htmlTier === module.tier && row.htmlFeature === module.feature)).toHaveLength(1);
      const target = '/' + deskHash('sports', module.feature);
      expect(renderToStaticMarkup(<ModuleDetail module={module} tab="sports" onOpen={() => {}}/>)).toContain(`href="${target}"`);
      expect(parseDeskHash(target.slice(1))).toEqual({ tab: 'sports', feature: module.feature });
      expect(module).not.toHaveProperty('count');
    }
  });
  it('preserves the reference images and crop identities', () => {
    const visual = DESK_VISUALS.sports;
    expect(SPORTS_PRESENTATION.image).toBe(visual.image);
    expect(SPORTS_PRESENTATION.groups.map(group => group.image)).toEqual(visual.images);
    expect(SPORTS_PRESENTATION.groups.map(group => group.title.join('<br>'))).toEqual(visual.titles);
    expect(SPORTS_PRESENTATION.groups[0].cardDescription).toBe(visual.summaries[0]);
    expect(SPORTS_PRESENTATION.groups[2].cardDescription).toContain('policy coverage unavailable');
    expect(SPORTS_PRESENTATION.groups[3].cardDescription).toBe('Indian league/owner observations and athlete identities.');
  });
});
