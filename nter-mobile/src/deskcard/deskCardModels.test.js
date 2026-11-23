// Every record in the bundled snapshot (8 desks, ~110 modules, real rows read from nter.pro) gets a
// desk card that honours the website's own card contract (src/shell/record/modelContract.js): a
// title, 2–4 glance tiles with values, https-only links, a named source with an as-of date or the
// "as-of not on record" flag, an Ask AI label and no placeholder text. Modules the website has an
// adapter for use it; the rest use the generic card.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractProblems } from '../shell/record/modelContract.js';
import { adapterFor } from '../shell/record/registry.js';
import { ALL_MODULES } from '../data/desks.js';
import { deskCardModel, moduleFor } from '../screens/Record.jsx';
import genericModel, { provenanceOf, sourcePairs, stageTone, titleOf } from './genericModel.js';

const dir = join(process.cwd(), 'src/sample');
const store = JSON.parse(readFileSync(join(dir, 'feed-store.json'), 'utf8'));
const modules = {};
for (const f of readdirSync(dir).filter((n) => /^modules-.*\.json$/.test(n))) Object.assign(modules, JSON.parse(readFileSync(join(dir, f), 'utf8')));
for (const [k, v] of Object.entries(store)) if (!modules[k]?.rows?.length) modules[k] = v;

const cases = ALL_MODULES
  .map((m) => ({ module: m, entry: modules[`${m.tier}::${m.feature}`] }))
  .filter(({ entry }) => (entry?.rows || []).some((r) => r && r.status !== 'source_status'));

describe('desk cards for every sample record', () => {
  it('covers most modules and the website adapters', () => {
    expect(cases.length).toBeGreaterThan(90);
    expect(cases.filter(({ module }) => adapterFor(module.feature, module.tier)).length).toBeGreaterThanOrEqual(34);
  });

  it.each(cases.map((c) => [c.module.feature, c]))('%s', (_name, { module, entry }) => {
    const rows = entry.rows.filter((r) => r && r.status !== 'source_status');
    const feed = { ...entry, rows };
    for (const row of rows.slice(0, 25)) {
      const { model, source } = deskCardModel(module, row, { rows, feed, packs: null });
      expect({ row: titleOf(row), problems: contractProblems(model) }).toEqual({ row: titleOf(row), problems: [] });
      expect(source).toBe(adapterFor(module.feature, module.tier) ? 'website' : 'generic');
    }
  });
});

describe('generic card', () => {
  const module = { title: 'Test Module', feature: 'Test Module', tier: 'national', desk: 'national', deskName: 'National' };

  it('builds title, stage badge, tiles, timeline, sources and related records from the fields', () => {
    const row = { title: 'Order on spectrum', status: 'Pending', ministry: 'Telecom', date: '2026-01-05', decision_date: '2026-03-10', amount: '1,200 cr', source_url: 'https://example.gov.in/a', pdf_url: 'https://example.gov.in/a.pdf', summary: 'x'.repeat(200) };
    const other = { title: 'Order on towers', status: 'Final', ministry: 'Telecom' };
    const m = genericModel(row, { rows: [row, other], feed: null, module });
    expect(m.title).toBe('Order on spectrum');
    expect(m.badge).toEqual({ text: 'Pending', tone: 'amber' });
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Stage', 'Date', 'Amount', 'Ministry']);
    expect(m.glance.visual.steps.map((s) => s.label)).toEqual(['Date', 'Decision Date']);
    expect(m.links.map((l) => l.label)).toEqual(['Source record', 'PDF']);
    expect(m.about.cards[0].heading).toBe('Summary');
    expect(m.touches.links[0]).toMatchObject({ title: 'Order on towers', row: other });
    expect(m.footer.provenance).toMatchObject({ source: 'example.gov.in', asOf: '05 Jan 2026' });
    expect(contractProblems(m)).toEqual([]);
  });

  it('never shows http links, placeholders or empty tiles', () => {
    const m = genericModel({ name: 'X', link: 'http://insecure.example', note: '[date]', n: 'undefined' }, { module });
    expect(m.links).toEqual([]);
    expect(JSON.stringify(m)).not.toMatch(/\[date\]|undefined/);
    expect(m.footer.provenance.flags).toEqual(['as-of not on record']);
    expect(contractProblems(m)).toEqual([]);
  });

  it('reads tone, sources and provenance as the website does', () => {
    expect(stageTone('Assented')).toBe('green');
    expect(stageTone('Negatived')).toBe('red');
    expect(stageTone('Lapsed')).toBe('grey');
    expect(sourcePairs({ sources_json: JSON.stringify([['Gazette', 'https://egazette.gov.in/x']]), source_1: 'PIB', source_1_url: 'https://pib.gov.in/y' }).map((s) => s.label)).toEqual(['Gazette', 'PIB']);
    expect(provenanceOf({ source: 'RBI', last_verified: '2026-10-01T10:00:00+05:30' }, null)).toMatchObject({ source: 'RBI', verified: expect.stringContaining('2026') });
  });
});

describe('related modules', () => {
  it('finds the app module for a website link', () => {
    expect(moduleFor({ tab: 'national', feature: 'Bill Passage Probability Index' })?.title).toBe('Bill Passage Probability Index');
    expect(moduleFor({ tab: 'x', feature: 'No such module' })).toBeNull();
  });
});
