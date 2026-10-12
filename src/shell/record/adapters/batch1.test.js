import { describe, expect, it } from 'vitest';
import warTracker from '../../../../public/data/embedded_csv/geopolitics_war_tracker.json';
import procurement from '../../../../public/data/embedded_csv/geopolitics_defense_procurement.json';
import infraPack from '../../../data/infra-projects.json';
import { flattenInfra } from '../../../lib/strategicAssets.js';
import { contractProblems } from '../modelContract.js';
import openFronts from './openFronts.js';
import globalIntelligence from './globalIntelligence.js';
import infra from './infra.js';

const infraRows = infraPack.projects.map(flattenInfra);
const ctx = (rows, feed = {}) => ({ rows, feed });

// F121 batch 1: every real row of each register yields a model that honours the contract.
describe.each([
  ['Open Fronts', openFronts, warTracker],
  ['Global Intelligence', globalIntelligence, procurement],
  ['Infra', infra, infraRows],
])('%s adapter', (name, adapter, rows) => {
  it('honours the panel contract for every row', () => {
    for (const row of rows) expect(contractProblems(adapter(row, ctx(rows, { meta: { asOf: infraPack.asOf } }))), row.conflict_name || row.program_name || row.name).toEqual([]);
  });
});

describe('Open Fronts panel', () => {
  const row = warTracker.find((r) => r.conflict_name === 'Russia–Ukraine War');
  const model = openFronts(row, ctx(warTracker));

  it('leads with intensity, trend, type and as-of, and badges the stage', () => {
    expect(model.glance.tiles.map((t) => t.label)).toEqual(['Intensity', 'Trend', 'Type', 'Register as of']);
    expect(model.glance.tiles[0]).toMatchObject({ value: 'Critical', tone: 'red' });
    expect(model.glance.tiles[3].value).toBe('07 Sep 2026');
    expect(model.badge).toEqual({ text: 'Active', tone: 'red' });
  });

  it('says intensity is editorial, flags unconfirmed provenance and never names ACLED as its source', () => {
    expect(model.glance.callout.text).toMatch(/editorial/i);
    expect(model.footer.provenance.flags).toContain('provenance unconfirmed');
    expect(model.footer.provenance.source).not.toMatch(/acled/i);
  });

  it('uses the dossier position where the name matches, exactly, and the region otherwise, approximately', () => {
    const main = model.glance.visual.points.find((p) => p.main);
    expect(main).toMatchObject({ lat: 48.4, lon: 37.8 });
    expect(main.approximate).toBeFalsy();
    const other = warTracker.find((r) => r.region === 'West Africa');
    expect(openFronts(other, ctx(warTracker)).glance.visual.points.find((p) => p.main)).toMatchObject({ approximate: true });
  });

  it('never draws a front twice: its own dossier is the main marker, not a context marker', () => {
    for (const r of warTracker) {
      const points = openFronts(r, ctx(warTracker)).glance.visual?.points || [];
      const main = points.find((p) => p.main);
      const dupes = points.filter((p) => !p.main && main && p.lat === main.lat && p.lon === main.lon);
      expect(dupes, r.conflict_name).toEqual([]);
    }
    for (const name of ['Somalia — Al-Shabaab', 'Israel–Hamas War (Gaza)', 'Sudan — Civil War (SAF vs RSF)', 'Myanmar — Civil War', 'Yemen — Houthi Conflict / Red Sea', 'Haiti — Gang crisis', 'Iran–Israel shadow & direct strikes', 'India–Pakistan LoC Tensions']) {
      const main = openFronts(warTracker.find((r) => r.conflict_name === name), ctx(warTracker)).glance.visual.points.find((p) => p.main);
      expect(main.approximate, name).toBeFalsy();
    }
    const mali = openFronts(warTracker.find((r) => r.conflict_name.startsWith('Mali — Jihadist')), ctx(warTracker)).glance.visual.points;
    expect(mali.some((p) => /Sahel/.test(p.label))).toBe(false);
  });

  it('touches the chokepoints of its region and counts the other fronts there', () => {
    expect(model.touches.nodes.right).toMatchObject({ l1: 'Kerch Strait', l2: '+1 more' });
    expect(model.touches.nodes.far.l1).toBe('1 other front');
    const asia = openFronts(warTracker.find((r) => r.region === 'Central Asia'), ctx(warTracker));
    expect(asia.touches.nodes.right).toBeUndefined();
  });
});

describe('Global Intelligence panel', () => {
  const row = procurement.find((r) => r.program_name.startsWith('Rafale'));
  const model = globalIntelligence(row, ctx(procurement));

  it('states the stage, never a value it does not hold, and marks the stage on the timeline', () => {
    expect(model.glance.tiles.map((t) => t.label)).toEqual(['Stage', 'As of', 'Category', 'Value']);
    expect(model.glance.tiles[3].value).toBe('Not on record');
    expect(model.badge).toEqual({ text: 'Contract signed', tone: 'green' });
    const now = model.glance.visual.steps.find((s) => s.now);
    expect(now.label).toBe('Contract or sanction');
  });

  it('places the origin country approximately and counts same-origin programmes', () => {
    expect(model.glance.visual2.points[0]).toMatchObject({ label: 'France', approximate: true });
    expect(model.touches.nodes.left.l1).toBe('France');
    const usa = globalIntelligence(procurement.find((r) => r.vendor_or_origin.endsWith('USA')), ctx(procurement));
    expect(usa.touches.nodes.right.l1).toBe('1 other from USA');
  });

  it('has no map when the origin is not stated', () => {
    const kalvari = globalIntelligence(procurement.find((r) => r.vendor_or_origin === 'Naval Group + Mazagon Dock'), ctx(procurement));
    expect(kalvari.glance.visual2).toBeUndefined();
    expect(kalvari.touches.nodes.left).toBeUndefined();
  });
});

describe('Infra panel', () => {
  const row = infraRows.find((r) => r.name === 'Vadhavan Port');
  const model = infra(row, ctx(infraRows, { meta: { asOf: infraPack.asOf } }));

  it('leads with status, expected, sector and country', () => {
    expect(model.glance.tiles.map((t) => t.label)).toEqual(['Status', 'Expected', 'Sector', 'Country']);
    expect(model.badge).toEqual({ text: 'Under construction', tone: 'amber' });
    expect(model.glance.visual.points[0]).toMatchObject({ label: 'India', approximate: true });
  });

  it('keeps a month-only as-of date at month precision, even without feed metadata', () => {
    expect(model.footer.provenance.asOf).toBe('Jul 2026');
    expect(infra(row, ctx(infraRows)).footer.provenance.asOf).toBe('Jul 2026');
  });

  it('counts other assets in the same country and sector', () => {
    expect(model.touches.nodes.right.l1).toMatch(/^\d+ other assets? in India$/);
    expect(model.touches.nodes.far.l1).toMatch(/Major port/);
  });
});
