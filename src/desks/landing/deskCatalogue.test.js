import { describe, expect, it, vi, afterEach } from 'vitest';
import features from '../../data/html-feature-map.json';
import { DESK_CATALOGUE, searchDeskCatalogue } from './deskCatalogue.js';
import { modulesForTier, bucketsFor } from '../catalog.js';
import { NATIONAL_PRESENTATION } from './deskPresentation.js';
import { GLOBAL_PRESENTATION } from './globalPresentation.js';
import { LAW_PRESENTATION } from './lawPresentation.js';
import { ECONOMICS_PRESENTATION } from './economicsPresentation.js';
import { CARBON_PRESENTATION } from './carbonPresentation.js';
import { SPORTS_PRESENTATION } from './sportsPresentation.js';
import { ENTERTAINMENT_PRESENTATION } from './entertainmentPresentation.js';
import { STATE_PRESENTATION } from './statePresentation.js';

const presentations = [NATIONAL_PRESENTATION, GLOBAL_PRESENTATION, LAW_PRESENTATION, ECONOMICS_PRESENTATION, CARBON_PRESENTATION, SPORTS_PRESENTATION, ENTERTAINMENT_PRESENTATION];
const stateFeatures = ['Constituency Register', 'MLA Directory', 'MLA Report Card + Statement Tracker', 'Roll Demography', 'Community Bloc Matrix', 'Cabinet Decisions', 'Bureaucrat Transfer & Posting Tracker (State Cadre)', 'State Tender Aggregator (State e-Procurement)', 'Booth-level Results Database', 'Booth Political History', 'Municipal Watch', 'Panchayat Watch', 'Municipal & Panchayat Tender Aggregator', 'Local Governance Brief'];

describe('approved seven-desk navigation', () => {
  it.each(presentations)('includes every $name reference entry in its own tier and presentation group/order', presentation => {
    const expected = presentation.groups.flatMap(group => group.modules);
    const tier = expected[0].tier;
    const modules = modulesForTier(tier);
    expect(modules.map(module => module.htmlFeature)).toEqual(expected.map(module => module.feature));
    const buckets = bucketsFor(modules, tier);
    expect(buckets.map(bucket => bucket.label)).toEqual(presentation.groups.map(group => group.name));
    for (const [index, bucket] of buckets.entries()) expect(bucket.items.map(module => module.htmlFeature)).toEqual(presentation.groups[index].modules.map(module => module.feature));
  });
  it('retains existing State/local destinations inside the expanded State navigation', () => {
    expect(modulesForTier('state').map(module => module.htmlFeature)).toEqual(STATE_PRESENTATION.groups.flatMap(group => group.modules.map(module => module.feature)));
    for (const feature of stateFeatures) expect(modulesForTier('state').some(module => module.htmlFeature === feature)).toBe(true);
  });
});


describe('desk discovery catalogue identity', () => {
  it('contains exactly the 120 approved canonical identities without a separate Local page', () => {
    expect(DESK_CATALOGUE).toHaveLength(120);
    expect(new Set(DESK_CATALOGUE.map(entry => entry.id)).size).toBe(120);
    const counts = Object.fromEntries(presentations.map(desk => [desk.id, DESK_CATALOGUE.filter(entry => entry.tab === desk.id).length]));
    expect(counts).toEqual({ national: 17, global: 16, law: 12, economics: 11, carbon: 7, sports: 8, entertainment: 8 });
    for (const entry of DESK_CATALOGUE) {
      expect(features.some(module => module.htmlTier === entry.tier && module.htmlFeature === entry.feature)).toBe(true);
      expect(entry.id).toBe(`${entry.tier}:${entry.feature}`);
      expect(entry.configured).toBe(features.find(module => module.htmlTier === entry.tier && module.htmlFeature === entry.feature)?.mapping !== 'HTML-ONLY');
      expect(entry).not.toHaveProperty('count');
      expect(entry).not.toHaveProperty('availability');
    }
  });
  it('keeps display aliases independent from canonical destinations', () => {
    const us = searchDeskCatalogue('United States Top 25').find(entry => entry.feature === 'Music Charts — Global Top 25');
    expect(us).toMatchObject({ tab: 'entertainment', tier: 'entertainment', feature: 'Music Charts — Global Top 25', title: 'Music Charts — United States Top 25' });
    expect(searchDeskCatalogue('Global Top 25')).toContain(us);
    expect(searchDeskCatalogue('Upcoming launches').find(entry => entry.feature === 'Satellite Infrastructure')).toMatchObject({ tab: 'global', feature: 'Satellite Infrastructure' });
  });
  it('matches all terms across desk/group/aliases/description/configured fields and keeps deterministic order', () => {
    expect(searchDeskCatalogue('  NATIONAL   draft-to-gazette ')).toEqual([DESK_CATALOGUE.find(entry => entry.feature === 'Policy Pipeline Tracker (Draft-to-Gazette)')]);
    expect(searchDeskCatalogue('global security vendor')).toEqual([DESK_CATALOGUE.find(entry => entry.feature === 'Global Intelligence')]);
    expect(searchDeskCatalogue('carbon timeline annual')).toEqual([DESK_CATALOGUE.find(entry => entry.feature === 'ETS & Tax Adoption Timeline')]);
    expect(searchDeskCatalogue('music india nonexistent')).toEqual([]);
    expect(searchDeskCatalogue('  ')).toEqual(DESK_CATALOGUE);
    expect(searchDeskCatalogue(null)).toEqual(DESK_CATALOGUE);
  });
  it('ranks a named module above contextual mentions in a shared group description', () => {
    expect(searchDeskCatalogue('icj')[0].feature).toBe('ICJ Proceedings');
    expect(searchDeskCatalogue('Cabinet Decisions')[0].feature).toBe('Cabinet Decisions');
  });
  it('retains only explicitly configured column presets without presenting fake populated fields', () => {
    expect(DESK_CATALOGUE.find(entry => entry.feature === 'Global Intelligence').fields).toContain('VENDOR / ORIGIN');
    expect(DESK_CATALOGUE.find(entry => entry.feature === 'Election Forecast Aggregator').fields).toEqual([]);
  });
  it('never accepts a same-name feature from a different tier into a navigation bucket', () => {
    expect(bucketsFor([{ htmlTier: 'state', htmlFeature: 'Cabinet Decisions' }], 'national')).toEqual([]);
  });
});

describe('catalogue mapping guard', () => {
  afterEach(() => { vi.doUnmock('../../data/html-feature-map.json'); vi.resetModules(); });
  it('refuses missing canonical mappings instead of substituting another tier or sibling', async () => {
    vi.doMock('../../data/html-feature-map.json', () => ({ default: features.filter(module => !(module.htmlTier === 'national' && module.htmlFeature === 'Cabinet Decisions')) }));
    vi.resetModules();
    await expect(import('./deskCatalogue.js')).rejects.toThrow('Unknown desk catalogue identity: national:Cabinet Decisions');
  });
});
