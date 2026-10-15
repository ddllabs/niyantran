/**
 * The committed catalogue (supabase/functions/_shared/deskCatalog.json) must
 * equal what deskCatalogBuild.js builds from src/desks/catalog.js and the
 * desk feed today. Regenerate with:
 *   npx vite-node --config vitest.config.js scripts/build-desk-catalog.mjs
 */
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import committed from '../../supabase/functions/_shared/deskCatalog.json';
import { buildDeskCatalog } from './deskCatalogBuild.js';
import { deskRowsFor, installDiskFetch, loadableModules } from './deskRowsFeed.js';
import { HANDBOOK_DESK_FIELDS, handbookDeskRows } from './handbookDeskRows.js';
import { HANDBOOK, HANDBOOK_MODULES, HANDBOOK_TABLES, handbookTableLabel } from './rbiHandbookTables.js';

const PUBLIC_DIR = resolve(__dirname, '../../public');

let restore;
beforeAll(() => {
  restore = installDiskFetch(PUBLIC_DIR);
});
afterAll(() => restore?.());

describe('desk catalogue', () => {
  it('is not stale relative to catalog.js and the desk feed', async () => {
    const fresh = await buildDeskCatalog({
      rowsFor: async (mod) => (await deskRowsFor(mod, { publicDir: PUBLIC_DIR, fallbackSnapshot: '2026-09-21T00:00:00.000Z' })).rows.length,
    });
    expect(committed.entries.length, 'entry count').toBe(fresh.length);
    for (let i = 0; i < fresh.length; i++) {
      expect(committed.entries[i], `entry ${i}: ${fresh[i].feature}`).toEqual(fresh[i]);
    }
  }, 60_000);

  it('names every module once per desk', () => {
    const seen = new Set();
    for (const e of committed.entries) {
      const k = `${e.tier}|${e.feature}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });
});

// Task A (2026-10-16 leftover phases): the AI's catalogue names the eight RBI Handbook modules, so it
// can pick a module, a table by its title, and the filters the loaded rows answer to.
describe('desk catalogue: the RBI Handbook modules', () => {
  const featureOf = (id) => id.split(/:(.*)/s)[1];
  const entryFor = (feature) => committed.entries.find((e) => e.tier === 'state' && e.feature === feature);

  // One figure for each module's first table, in the shape scripts/fetch-rbi-handbook.mjs writes.
  const register = () => ({
    published: HANDBOOK.published,
    records: Object.values(HANDBOOK_MODULES).map((spec) => ({
      state: 'Kerala',
      indicator: 'Total',
      year: '2019-20',
      value: 1,
      unit: 'Number',
      table_no: spec.tables[0],
      table_title: HANDBOOK_TABLES.get(spec.tables[0]).title,
      source_url: 'https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=1',
    })),
  });

  it('names all eight modules on the State desk, spelled as the loader writes them', () => {
    const written = handbookDeskRows(register()).map((m) => m.feature);
    expect(written).toHaveLength(8);
    for (const feature of written) expect(entryFor(feature), feature).toBeTruthy();
    expect(written).toEqual(Object.keys(HANDBOOK_MODULES).map(featureOf));
  });

  it('lists every table of every module as "Table N: title", numbers and titles as the handbook has them', () => {
    for (const [id, spec] of Object.entries(HANDBOOK_MODULES)) {
      expect(entryFor(featureOf(id))?.tables, id).toEqual(spec.tables.map((no) => handbookTableLabel(no)));
    }
    expect(entryFor('State Fiscal Deep-Dive').tables).toContain('Table 176: State-wise Composition of Outstanding Liabilities');
  });

  it('lists the fields the rows can be searched on, each one a field the loader writes', () => {
    const written = new Set([...HANDBOOK_DESK_FIELDS, 'date', 'period']);
    for (const id of Object.keys(HANDBOOK_MODULES)) {
      const entry = entryFor(featureOf(id));
      for (const f of ['state', 'indicator', 'year', 'value', 'unit', 'table_no', 'table_title', 'as_of', 'source_url', 'date', 'period']) {
        expect(entry?.fields, id).toContain(f);
      }
      for (const f of entry.fields) expect(written.has(f), `${entry.feature}: ${f}`).toBe(true);
    }
  });

  it('says how years are written: a financial year is dated 1 April, a calendar year is the year', () => {
    for (const id of Object.keys(HANDBOOK_MODULES)) {
      const years = entryFor(featureOf(id))?.years;
      expect(years, id).toMatch(/"2019-20"/);
      expect(years, id).toMatch(/financial year/);
      expect(years, id).toMatch(/1 April 2019/);
      expect(years, id).toMatch(/calendar year/);
      expect(years, id).toMatch(/"2005"/);
    }
  });

  it('adds nothing to the other modules: only the handbook entries carry tables, fields and years', () => {
    const handbook = new Set(Object.keys(HANDBOOK_MODULES).map(featureOf));
    for (const e of committed.entries) {
      if (e.tier === 'state' && handbook.has(e.feature)) continue;
      expect(Object.keys(e).sort(), `${e.tier}|${e.feature}`).toEqual(['bucket', 'feature', 'note', 'pack', 'rows', 'tier']);
    }
  });

  it('keeps the handbook out of the generic desk-row loader, which would otherwise replace the handbook rows', () => {
    const loadable = new Set(loadableModules().map((x) => x.mod.htmlFeature));
    for (const id of Object.keys(HANDBOOK_MODULES)) expect(loadable.has(featureOf(id)), id).toBe(false);
  });
});
