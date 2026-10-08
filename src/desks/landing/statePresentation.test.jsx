import { describe, expect, it } from 'vitest';
import { STATE_PRESENTATION } from './statePresentation.js';
import { DESK_CATALOGUE } from './deskCatalogue.js';
import { modulesForTier, groundingCatalogModules } from '../catalog.js';
import { parseDeskHash, deskHash } from '../../lib/deskRoute.js';

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
