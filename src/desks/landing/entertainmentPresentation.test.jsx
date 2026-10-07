import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import features from '../../data/html-feature-map.json';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { DESK_VISUALS } from './deskImages.js';
import { ENTERTAINMENT_PRESENTATION } from './entertainmentPresentation.js';
import { ModuleDetail } from './DeskLandingFrame.jsx';

describe('Entertainment v6 presentation', () => {
  it('maps all eight reference modules in four groups to exact entertainment workspaces', () => {
    const modules = ENTERTAINMENT_PRESENTATION.groups.flatMap(group => group.modules);
    expect(ENTERTAINMENT_PRESENTATION.groups.map(group => group.modules.length)).toEqual([2, 2, 2, 2]);
    expect(modules).toHaveLength(8);
    for (const module of modules) {
      expect(module.tier).toBe('entertainment');
      expect(features.filter(row => row.htmlTier === module.tier && row.htmlFeature === module.feature)).toHaveLength(1);
      const target = '/' + deskHash('entertainment', module.feature);
      expect(renderToStaticMarkup(<ModuleDetail module={module} tab="entertainment" onOpen={() => {}}/>)).toContain(`href="${target}"`);
      expect(parseDeskHash(target.slice(1))).toEqual({ tab: 'entertainment', feature: module.feature });
      expect(module).not.toHaveProperty('count');
    }
  });
  it('preserves the reference images and crop identities', () => {
    const visual = DESK_VISUALS.entertainment;
    expect(ENTERTAINMENT_PRESENTATION.image).toBe(visual.image);
    expect(ENTERTAINMENT_PRESENTATION.groups.map(group => group.image)).toEqual(visual.images);
    expect(ENTERTAINMENT_PRESENTATION.groups.map(group => group.title.join('<br>'))).toEqual(visual.titles);
    expect(ENTERTAINMENT_PRESENTATION.groups[2].cardDescription).toContain('India and US');
    expect(ENTERTAINMENT_PRESENTATION.groups[2].modules[1].title).toContain('United States');
  });
});
