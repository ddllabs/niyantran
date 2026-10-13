import { describe, expect, it } from 'vitest';
import { companiesNamedIn, todayInIndia } from './common.js';

const ontology = { companies: [
  { id: 'oil', name: 'Oil India Ltd', aliases: ['OIL', 'Oil India'] },
  { id: 'ril', name: 'Reliance Industries Ltd', aliases: ['Reliance', 'RIL'] },
  { id: 'ongc', name: 'Oil and Natural Gas Corporation', aliases: ['ONGC'] },
] };
const impact = { companies: [
  { id: 'company:oil', name: 'Oil India Ltd', path: 'P1' },
  { id: 'company:ril', name: 'Reliance Industries Ltd', path: 'P1' },
  { id: 'company:ongc', name: 'Oil and Natural Gas Corporation', path: 'P1' },
] };

// F124: a company is drawn only where the record's own text names it. The shared matcher accepts
// any alias as a word, so "oil companies" named Oil India and "self reliance" named Reliance.
describe('companiesNamedIn', () => {
  it('drops a company whose only hit is an ordinary word', () => {
    expect(companiesNamedIn(impact, ontology, 'CSR Projects by Oil Companies')).toEqual([]);
    expect(companiesNamedIn(impact, ontology, 'Self Reliance of Domestic Fertilizer Industry')).toEqual([]);
  });

  it('keeps a company named by a multi-word name or an upper-case abbreviation', () => {
    expect(companiesNamedIn(impact, ontology, 'Exploration blocks of ONGC')).toEqual(['Oil and Natural Gas Corporation']);
    expect(companiesNamedIn(impact, ontology, 'Disinvestment in Oil India')).toEqual(['Oil India Ltd']);
  });

  it('matches a multi-word name in a title written in capitals, but takes no abbreviation from all-capitals text', () => {
    expect(companiesNamedIn(impact, ontology, 'THE OIL INDIA (TRANSFER OF UNDERTAKINGS) BILL')).toEqual(['Oil India Ltd']);
    expect(companiesNamedIn(impact, ontology, 'THE OIL FIELDS (REGULATION) BILL')).toEqual([]);
    expect(companiesNamedIn(impact, ontology, 'THE ONGC (REPEAL) BILL')).toEqual([]);
  });

  it('never draws a sector-level (P2) company', () => {
    const p2 = { companies: [{ id: 'company:ongc', name: 'Oil and Natural Gas Corporation', path: 'P2' }] };
    expect(companiesNamedIn(p2, ontology, 'Exploration blocks of ONGC')).toEqual([]);
  });
});

// F128: a stated deadline is marked passed against India's date, which runs 05:30 ahead of UTC.
describe('todayInIndia', () => {
  it('reads the India date across the UTC midnight boundary', () => {
    expect(todayInIndia(new Date('2026-09-03T19:00:00Z'))).toBe('2026-09-04');
    expect(todayInIndia(new Date('2026-09-03T18:29:00Z'))).toBe('2026-09-03');
    expect(todayInIndia(new Date('2026-09-04T12:00:00Z'))).toBe('2026-09-04');
  });
});
