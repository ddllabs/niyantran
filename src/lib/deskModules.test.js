/**
 * The committed desk module list (supabase/functions/_shared/deskModules.json), which the record
 * brief (desk-brief scope 'record', F123) accepts module names from, must equal what
 * deskModulesBuild.js builds from DESK_CATALOGUE today. Regenerate with:
 *   npx vite-node --config vitest.config.js scripts/build-desk-modules.mjs
 */
import { describe, expect, it } from 'vitest';
import committed from '../../supabase/functions/_shared/deskModules.json';
import catalog from '../../supabase/functions/_shared/deskCatalog.json';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import { buildDeskModules } from './deskModulesBuild.js';
import { isPlannedModule } from './plannedModules.js';

describe('desk module list', () => {
  it('is not stale relative to DESK_CATALOGUE', () => {
    expect(committed).toEqual(buildDeskModules());
  });

  it('holds every real desk module and no planned one', () => {
    const listed = new Set(committed.modules.map((m) => `${m.tier}|${m.feature}`));
    for (const e of DESK_CATALOGUE) {
      expect(listed.has(`${e.tab}|${e.feature}`), `${e.tab}|${e.feature}`).toBe(!isPlannedModule(e.tier, e.feature));
    }
    expect(listed.has('state|State Governance Brief')).toBe(true);
    expect(listed.has('national|National Morning Brief (Auto-digest)')).toBe(true);
  });

  it('spells every module with stored rows as the grounding catalogue does', () => {
    const listed = new Set(committed.modules.map((m) => `${m.tier}|${m.feature}`));
    const planned = new Set(DESK_CATALOGUE.filter((e) => isPlannedModule(e.tier, e.feature)).map((e) => `${e.tab}|${e.feature}`));
    for (const e of catalog.entries) {
      const k = `${e.tier}|${e.feature}`;
      if (!planned.has(k)) expect(listed.has(k), k).toBe(true);
    }
  });
});
