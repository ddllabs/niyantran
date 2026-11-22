import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePreviewFigures, stageBar, shareBars } from './previewFigures.js';
import stored from '../data/preview-figures.json';

const read = (name) => JSON.parse(readFileSync(new URL(`../../public/data/embedded_csv/${name}`, import.meta.url), 'utf8'));

// F144 (owner 2026-10-14): the homepage preview shows only figures our data backs under their labels.
describe('homepage preview figures', () => {
  it('equal a fresh count from the snapshot files the desks read', () => {
    expect(computePreviewFigures({
      bills: read('national_bill_tracker.json'),
      fronts: read('geopolitics_war_tracker.json'),
      mps: read('national_mp_report_card.json'),
      macro: read('finance_macro_indicators.json'),
      regulatory: read('national_regulatory_watch.json'),
      registry: JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8')),
    })).toEqual(stored);
  });

  it('count each bill once (its last row, as the database keeps it), and states once whatever the spelling', () => {
    const f = computePreviewFigures({
      bills: [
        { id: 'a', current_stage: 'Pending', house: 'Lok Sabha', date_introduced: '1960-01-01' },
        { id: 'a', current_stage: 'Passed', house: 'Lok Sabha', date_introduced: '1960-01-01' },
        { id: 'b', current_stage: 'assented ', house: 'Rajya Sabha', date_introduced: '1952-05-15' },
      ],
      fronts: [{ conflict_name: 'X', region: 'R' }, { conflict_name: 'x ', region: 'r' }],
      mps: [{ state: 'Jammu & Kashmir' }, { state: 'Jammu and Kashmir' }, { state: 'Nominated' }, { state: 'NCT of Delhi' }, { state: 'National Capital Territory of Delhi' }],
      macro: [{ source: 'World Bank' }, { source: 'world bank' }, { source: 'IMF WEO' }],
      regulatory: [{ id: '1', regulator: 'RBI' }, { id: '1', regulator: 'rbi' }, { id: '2', regulator: 'SEBI' }],
      registry: [{ sourceUrls: 'https://a.example/x | https://a.example/x' }, { sourceUrls: 'https://b.example/y' }],
    });
    expect(f).toEqual({
      bills: { total: 2, houses: 2, seriesStart: 1952, seriesEnd: 1960, stages: { Pending: 0, Passed: 1, Assented: 1, Withdrawn: 0 } },
      fronts: { fronts: 1, regions: 1, stages: [] },
      mps: { states: 2 },
      macro: { series: 3, publishers: 2 },
      regulatory: { notices: 2, regulators: 2 },
      endpoints: 2,
    });
  });

  it('draws stage bars as a share of all bills', () => {
    expect(stageBar('Assented', stored)).toEqual(['Assented', 3392, '35%', (3392 / 9817) * 100, '']);
    expect(stageBar('Passed', stored, 'sand')[2]).toBe('1.7%');
    expect(stageBar('Passed', stored, 'sand')[3]).toBe(2);
  });

  it('is what the homepage preview shows, with the invented figures gone', () => {
    const page = readFileSync(new URL('../marketing/HomePage.jsx', import.meta.url), 'utf8');
    expect(page).toContain("import PREVIEW from '../data/preview-figures.json'");
    for (const invented of ["['Pending', 4120", "['Passed', 2890", "['Assented', 2100", "['Withdrawn', 709", "['28', 'ok', 'STATES COVERED']", "['42', 'blue', 'LIVE SERIES']", "['8', 'ok', 'PUBLISHERS']", "['18', 'blue', 'OPEN FRONTS']", "['6', 'ok', 'THEATRES']", 'Probability scores are stored columns']) {
      expect(page, invented).not.toContain(invented);
    }
  });

  it('draws shares of a list of counts, and counts fronts by stage once each', () => {
    expect(shareBars([['A', 3], ['B', 1]])).toEqual([['A', 3, '75%', 75, ''], ['B', 1, '25%', 25, 'sand']]);
    expect(computePreviewFigures({ fronts: [{ conflict_name: 'x', current_stage: 'active' }, { conflict_name: 'X', current_stage: 'frozen' }, { conflict_name: 'y', current_stage: 'Active' }] }).fronts.stages)
      .toEqual([['Active', 1], ['Frozen', 1]]);
  });

  // Audit of 2026-11-21: every number the preview shows comes from the figures above or is a named constant.
  it('has no hand-typed figure left in the desk previews', () => {
    const page = readFileSync(new URL('../marketing/HomePage.jsx', import.meta.url), 'utf8');
    const desks = page.slice(page.indexOf('const DESKS = ['), page.indexOf('export default function HomePage'));
    // A KPI is [value, tone, label]; its value must be a PREVIEW figure, LOK_SABHA_SEATS or a live-figure function.
    const kpis = [...desks.matchAll(/^\s+\[(?!\()([^\n]*?), '(?:blue|ok|warn|gold)', '[A-Z0-9 ]+'\],$/gm)].map((m) => m[1]);
    expect(kpis.length).toBeGreaterThan(5);
    for (const value of kpis) expect(value, value).toMatch(/^String\((PREVIEW\.|LOK_SABHA_SEATS)/);
    // A hand-typed bar is ['Label', 480, '88%', 88, '']; bars are built from counts only.
    expect(desks).not.toMatch(/\['[A-Za-z ]+', \d+, '\d+%', \d+/);
    for (const stale of ["'1951'", "'1991'", "['84'", "['128'", "'BY-ELECTIONS'", "'UPDATED TODAY'", "'UPDATED 48H'", "'CLOSING 7D'", "'OPEN NOTICES'"]) expect(desks, stale).not.toContain(stale);
    expect(page).not.toMatch(/1952[–-]2026|from 1952 onward|<b>8<\/b>|02:18/);
  });
});
