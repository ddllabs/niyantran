import { describe, expect, it } from 'vitest';
import { STATE_PRESENTATION } from './statePresentation.js';
import { DESK_CATALOGUE } from './deskCatalogue.js';
import { modulesForTier, groundingCatalogModules } from '../catalog.js';
import { parseDeskHash, deskHash } from '../../lib/deskRoute.js';
import { featureMenuLabel } from '../../lib/national.js';

const modules = STATE_PRESENTATION.groups.flatMap(group => group.modules);
describe('State reference mapping and preserved destinations', () => {
  it('has 35 reference entries plus six retained existing entries in five photo sectors', () => {
    expect(modules.filter(module => !module.existingOnly)).toHaveLength(35);
    expect(modules.filter(module => module.existingOnly)).toHaveLength(6);
    expect(STATE_PRESENTATION.groups).toHaveLength(5);
    expect(STATE_PRESENTATION.groups.every(group => group.image)).toBe(true);
  });
  it('includes local-tier identities in State navigation and catalogue without a Local page', () => {
    expect(modulesForTier('state').map(module => module.htmlFeature)).toEqual(modules.map(module => module.feature));
    expect(DESK_CATALOGUE.filter(entry => entry.tab === 'state')).toHaveLength(41);
    expect(DESK_CATALOGUE.some(entry => entry.tab === 'local')).toBe(false);
    expect(modules.find(module => module.feature === 'Booth-level Results Database').tier).toBe('local');
    expect(groundingCatalogModules()).toHaveLength(75);
  });
  it.each(modules)('resolves $feature without returning Home or National', module => {
    expect(parseDeskHash(deskHash('state', module.feature))).toEqual({ tab: 'state', feature: module.feature });
  });
});

// F202 (module-quality audit 2026-10-15): ten modules hold only the Goa geography pack, and two
// promised vernacular or translated coverage while they show English news. The names say so; the
// keys (feature) stay, so routes, presets and stored rows are unchanged.
const GOA_ONLY = ['Constituency Register', 'Roll Demography', 'Community Bloc Matrix', 'Election Results 2017–2024', 'Split-Ticket & Competitiveness', 'SIR Roll Churn', 'Registration Gap', 'Booth-level Results Database', 'Booth Political History', 'Local Governance Brief'];
const ENGLISH_NEWS = ['Assembly Proceedings Digest (Vernacular, Translated)', 'District Media Monitor (Vernacular District Editions)'];
describe('State module names say what the module holds (F202)', () => {
  it.each(GOA_ONLY)('%s is named as Goa-only on the landing and in menus', feature => {
    const module = modules.find(item => item.feature === feature);
    expect(module.title).toMatch(/\bGoa\b/);
    expect(featureMenuLabel({ htmlFeature: feature })).toBe(module.title);
    expect(DESK_CATALOGUE.find(entry => entry.feature === feature).aliases).toContain(feature);
  });
  it.each(ENGLISH_NEWS)('%s no longer promises vernacular or translated coverage', feature => {
    const module = modules.find(item => item.feature === feature);
    expect(module.title).not.toMatch(/vernacular|translat/i);
    expect(featureMenuLabel({ htmlFeature: feature })).toBe(module.title);
  });
});

// Owner decision 2026-10-16: the module holds 400 Wikidata MLA identity profiles plus Google News
// coverage; there is no attendance, questions or funds data, so it is not named a report card. The
// key is unchanged (routes, presets and stored rows).
describe('MLA Report Card is named for what it holds', () => {
  const key = 'MLA Report Card + Statement Tracker';
  it('is titled MLA Profiles & Coverage on the landing and in menus, under the same key', () => {
    const module = modules.find(item => item.feature === key);
    expect(module.title).toBe('MLA Profiles & Coverage');
    expect(featureMenuLabel({ htmlFeature: key })).toBe('MLA Profiles & Coverage');
    expect(DESK_CATALOGUE.find(entry => entry.feature === key).aliases).toContain(key);
  });
});

describe('District Performance Tracker is planned on the landing (owner decision 2026-10-16)', () => {
  it('is marked not configured, with its key unchanged', () => {
    const module = modules.find(item => item.feature === 'District Performance Tracker (Composite)');
    expect(module.configured).toBe(false);
  });
});
