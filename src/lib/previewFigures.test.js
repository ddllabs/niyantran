import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePreviewFigures, stageBar } from './previewFigures.js';
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
    });
    expect(f).toEqual({
      bills: { total: 2, houses: 2, seriesStart: 1952, stages: { Pending: 0, Passed: 1, Assented: 1, Withdrawn: 0 } },
      fronts: { fronts: 1, regions: 1 },
      mps: { states: 2 },
      macro: { series: 3, publishers: 2 },
    });
  });

  it('draws stage bars as a share of all bills', () => {
    expect(stageBar('Assented', stored)).toEqual(['Assented', 3391, '35%', (3391 / 9817) * 100, '']);
    expect(stageBar('Passed', stored, 'sand')[2]).toBe('1.7%');
  });

  it('is what the homepage preview shows, with the invented figures gone', () => {
    const page = readFileSync(new URL('../marketing/HomePage.jsx', import.meta.url), 'utf8');
    expect(page).toContain("import PREVIEW from '../data/preview-figures.json'");
    for (const invented of ["['Pending', 4120", "['Passed', 2890", "['Assented', 2100", "['Withdrawn', 709", "['28', 'ok', 'STATES COVERED']", "['42', 'blue', 'LIVE SERIES']", "['8', 'ok', 'PUBLISHERS']", "['18', 'blue', 'OPEN FRONTS']", "['6', 'ok', 'THEATRES']", 'Probability scores are stored columns']) {
      expect(page, invented).not.toContain(invented);
    }
  });
});
