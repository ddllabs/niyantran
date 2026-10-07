import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import features from '../../data/html-feature-map.json';
import { LAW_FEATURES } from '../../lib/lawLandingSummary.js';
import { deskHash, parseDeskHash } from '../../lib/deskRoute.js';
import { DESK_VISUALS } from './deskImages.js';
import { LAW_PRESENTATION } from './lawPresentation.js';
import { ModuleDetail } from './DeskLandingFrame.jsx';
const modules = LAW_PRESENTATION.groups.flatMap(group => group.modules);

describe('Law v6 presentation contract', () => {
  it('maps all12 judiciary identities into four reference sectors with Law terminal links', () => {
    expect(LAW_PRESENTATION.id).toBe('law');
    expect(LAW_PRESENTATION.groups.map(group => group.modules.length)).toEqual([6, 1, 3, 2]);
    expect(modules.map(module => module.feature).sort()).toEqual([...LAW_FEATURES].sort());
    for (const module of modules) {
      expect(module.tier).toBe('judiciary');
      expect(features.filter(row => row.htmlTier === module.tier && row.htmlFeature === module.feature)).toHaveLength(1);
      const html = renderToStaticMarkup(<ModuleDetail module={module} tab="law" onOpen={() => {}}/>);
      const target = '/' + deskHash('law', module.feature);
      expect(html).toContain(`href="${target}"`);
      expect(parseDeskHash(target.slice(1))).toEqual({ tab: 'law', feature: module.feature });
    }
  });
  it('preserves exact reference imagery and copy without invented counts', () => {
    const visual = DESK_VISUALS.law;
    expect(LAW_PRESENTATION.image).toBe(visual.image);
    expect(LAW_PRESENTATION.groups.map(group => group.image)).toEqual(visual.images);
    expect(LAW_PRESENTATION.groups.map(group => group.cardDescription)).toEqual(visual.summaries);
    expect(LAW_PRESENTATION.groups.map(group => group.title.join('<br>'))).toEqual(visual.titles);
    expect(modules.every(module => !Object.hasOwn(module, 'count'))).toBe(true);
  });
  it('keeps truthful reporting labels separate from canonical terminal identities and popup coverage', () => {
    expect(modules.find(module => module.title === 'Supreme Court orders by topic').feature).toBe('Order Archive by Topic (Cross-Court)');
    expect(modules.find(module => module.title === 'Allahabad High Court reporting').feature).toBe('UP High Court (Allahabad) Order Feed');
    expect(modules.find(module => module.title === 'Judge & bench reporting').feature).toBe('HC Judge Profiles & Bench Analytics');
    const module = modules.find(module => module.feature === 'HC Judge Profiles & Bench Analytics');
    const html = renderToStaticMarkup(<ModuleDetail module={module} tab="law" onOpen={() => {}} summary={{ count: 4, sourceMode: 'feed-backed', availability: 'ready', unit: 'reports', columns: [{ key: 'title', label: 'Headline' }], limitations: 'Reporting search / RSS coverage, not an official docket, cause list, judge directory or bench analytics.' }}/>);
    expect(html).toContain('<b>4</b><span>reports</span>');
    expect(html).toContain('Headline');
    expect(html).toContain('not an official docket');
    expect(html).not.toContain('4 cases');
  });
});
