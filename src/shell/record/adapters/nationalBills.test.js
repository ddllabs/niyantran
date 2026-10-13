import { describe, expect, it } from 'vitest';
import bills from '../../../../public/data/embedded_csv/national_bill_tracker.json';
import analysisRaw from '../../../../public/data/embedded_json/national_bill_analysis.json';
import identities from '../../../../public/data/embedded_json/national_bill_analysis_identity.json';
import ontology from '../../../../public/data/ontology.json';
import { analysisFor, bindBillAnalysisIdentities, DESKS } from '../../../lib/impactRecord.js';
import { contractProblems } from '../modelContract.js';
import nationalBills from './nationalBills.js';

// The packs exactly as loadRecordPacks would hand them over (loadAnalysisMap binds the identities).
const analysis = bindBillAnalysisIdentities(analysisRaw, identities.records, identities.sources || []);
const packs = { desk: DESKS.bill, analysis, ontology, ready: true };
const ctx = (over = {}) => ({ rows: bills, feed: { feature: 'Bill Passage Probability Index' }, packs, ...over });
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'row') strings(x, out);
  return out;
};
const withAnalysis = bills.filter((r) => analysisFor(r, analysis));
const pending = withAnalysis.find((r) => /pending/i.test(r.current_stage) && analysisFor(r, analysis)?.passage_probability?.score != null);
const assented = withAnalysis.find((r) => /assented/i.test(r.current_stage));
const bare = bills.find((r) => !analysisFor(r, analysis));

// F124 N2: a bill panel shows only what the register and its analysis hold, and labels the passage
// figure for what it is: an outcome for a resolved bill, a historical base rate for a pending one.
describe('National bills adapter', () => {
  it('honours the panel contract for every bill, with and without the packs loaded', () => {
    for (const row of bills) expect(contractProblems(nationalBills(row, ctx({ packs: null }))), row.id).toEqual([]);
    for (const row of withAnalysis.slice(0, 600)) expect(contractProblems(nationalBills(row, ctx())), row.id).toEqual([]);
  });

  it('leads with stage and introduction, and badges the stage', () => {
    const m = nationalBills(assented, ctx());
    expect(m.glance.tiles.slice(0, 2).map((t) => t.label)).toEqual(['Stage', 'Introduced']);
    expect(m.badge).toMatchObject({ tone: 'green' });
    expect(m.title).not.toBe(assented.bill_name); // title case, not the register's capitals
  });

  it('labels a pending bill\'s figure as a historical base rate, never a forecast', () => {
    const m = nationalBills(pending, ctx());
    const tile = m.glance.tiles.find((t) => /passage/i.test(t.label));
    expect(tile.value).toMatch(/^\d+%$/);
    expect(tile.sub).toMatch(/base rate/i);
    expect(strings(m).join(' ')).not.toMatch(/\bwill pass\b|\blikely to pass\b/i);
    expect(m.footer.note).toMatch(/not a forecast/i);
  });

  it('never shows a passage figure where the pack calls it a completed outcome, whatever the stage column says', () => {
    let checked = 0;
    for (const row of withAnalysis) {
      const note = analysisFor(row, analysis)?.passage_probability?.methodology_note || '';
      if (!/completed outcome|already/i.test(note)) continue;
      checked += 1;
      expect(nationalBills(row, ctx()).glance.tiles.some((t) => /passage/i.test(t.label)), row.id).toBe(false);
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('shows no passage figure for a resolved bill, whose stored score is just its outcome', () => {
    const m = nationalBills(assented, ctx());
    expect(m.glance.tiles.some((t) => /passage/i.test(t.label))).toBe(false);
  });

  it('shows days in stage only from the analysis pack, never days since introduction', () => {
    const noPack = nationalBills(bare, ctx());
    expect(noPack.glance.tiles.some((t) => /days in stage/i.test(t.label))).toBe(false);
    const a = analysisFor(pending, analysis);
    const tile = nationalBills(pending, ctx()).glance.tiles.find((t) => /days in stage/i.test(t.label));
    expect(a.stage_duration?.days_in_current_stage).not.toBeUndefined(); // the fixture must reach the branch
    expect(tile.value).toContain(String(a.stage_duration.days_in_current_stage));
  });

  it('draws the stage history with only the introduction dated, and says so', () => {
    const v = nationalBills(assented, ctx()).glance.visual;
    expect(v.type).toBe('timeline');
    expect(v.steps[0].label).toMatch(/introduced/i);
    expect(v.steps.filter((s) => s.now)).toHaveLength(1);
    expect(v.steps.slice(1).some((s) => /\d{4}/.test(s.detail || ''))).toBe(false);
    expect(v.caption).toMatch(/only the introduction is dated/i);
  });

  it('ends a lapsed, withdrawn or negatived bill on that stage instead of implying assent', () => {
    const lapsed = bills.find((r) => /lapsed/i.test(r.current_stage));
    const steps = nationalBills(lapsed, ctx()).glance.visual.steps;
    expect(steps.at(-1)).toMatchObject({ now: true });
    expect(steps.at(-1).label).toMatch(/lapsed/i);
    expect(steps.some((s) => /assent/i.test(s.label))).toBe(false);
  });

  it('draws ministry, bill, sectors and named companies from the impact model', () => {
    const t = nationalBills(assented, ctx()).touches;
    expect(t.lanes).toEqual(['MINISTRY', 'BILL', 'SECTORS & SEGMENTS', 'COMPANIES']);
    expect(t.nodes.center).toMatchObject({ code: 'B' });
    expect(assented.sector).toBeTruthy(); // the fixture must reach the branch
    expect(t.nodes.left.l1.toLowerCase()).toBe(assented.sector.toLowerCase());
  });

  it('names a company only where the bill text names it, not on an ordinary word such as "oil"', () => {
    const edibleOil = bills.find((r) => /edible oil/i.test(r.bill_name));
    expect(nationalBills(edibleOil, ctx()).touches.nodes.far).toBeUndefined();
    const coal = bills.find((r) => /^the coal india \(/i.test(r.bill_name));
    expect(nationalBills(coal, ctx()).touches.nodes.far?.l1).toMatch(/coal india/i);
  });

  it('links up to three other bills from the same ministry, never this one or a copy of it', () => {
    const row = bills.find((r) => r.sector && bills.filter((x) => x.sector === r.sector).length > 5);
    const links = nationalBills({ ...row }, ctx()).touches.links.filter((l) => l.row);
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(3);
    for (const l of links) {
      expect(bills).toContain(l.row);
      expect(l.row.id).not.toBe(row.id);
      expect(l.row.sector).toBe(row.sector);
    }
  });

  it('names the register and its as-of date, and explains the passage figure', () => {
    const f = nationalBills(pending, ctx()).footer;
    expect(f.ask).toBe('Ask AI about this bill');
    expect(f.provenance.source).toMatch(/sansad/i);
    expect(f.provenance.asOf).toBe('07 Sep 2026'); // as_of 2026-09-07T18:01Z is 23:31 in India
    expect(f.note).toMatch(/not a forecast/i);
  });

  it('shows the register analysis brief when one is held, labelled as such', () => {
    const briefed = withAnalysis.find((r) => analysisFor(r, analysis)?.brief);
    const cards = nationalBills(briefed, ctx()).about.cards || [];
    expect(cards.some((c) => /register analysis/i.test(c.heading))).toBe(true);
  });
});

// F127: a bill's name prints as Parliament writes it ("NEET", "ASHA", "Chapter VIIB"); only a name
// written entirely in capitals is title-cased, keeping small words lower case.
describe('National bill names', () => {
  it('prints a mixed-case name exactly as the register writes it', () => {
    const neet = bills.find((b) => /\(NEET\) Exemption/.test(b.bill_name));
    const asha = bills.find((b) => /^The ASHA Workers/.test(b.bill_name));
    for (const b of [neet, asha]) expect(nationalBills(b, ctx()).title).toBe(b.bill_name.trim());
  });

  it('title-cases a name written entirely in capitals', () => {
    const kerala = bills.find((b) => b.bill_name === 'THE KERALA (ALTERATION OF NAME) BILL, 2026');
    expect(nationalBills(kerala, ctx()).title).toBe('The Kerala (Alteration of Name) Bill, 2026');
  });
});
