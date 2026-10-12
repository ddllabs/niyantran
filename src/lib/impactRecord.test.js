import { describe, it, expect } from 'vitest';
import { analysisFor, bindBillAnalysisIdentities } from './impactRecord.js';

const row = { id: 'tracker-id', bill_number: '12', bill_name: 'The Example Bill, 2025', house: 'Lok Sabha', bill_category: 'Ordinary Bill' };
const entry = (year = 2025, extra = {}) => ({ enrichment: { bill_number: '12', bill_year: year, bill_name: `The Example Bill, ${year}`, house: 'Lok Sabha', bill_category: 'Ordinary Bill', ...extra } });

describe('bill analysis identity', () => {
  it('binds a reviewed identity only to the exact analysis PDF links and number', () => {
    const map={1:{enrichment:{bill_number:'12',pdf_links:{introduced:'https://example.test/a.pdf'}}}};
    const records=[{analysis_key:'1',identity:{...entry().enrichment,document_key:'bill:2025:12'},pdf_links:map[1].enrichment.pdf_links}];
    expect(analysisFor(row,bindBillAnalysisIdentities(map,records))).not.toBeNull();
    expect(map[1].enrichment.bill_year).toBeUndefined();
    records[0].pdf_links={introduced:'https://example.test/wrong.pdf'};
    expect(analysisFor(row,bindBillAnalysisIdentities(map,records))).toBeNull();
  });
  it('selects the matching year rather than the first number/category match', () => {
    const correct = entry();
    expect(analysisFor(row, { 1: entry(2024), 2: correct })).toBe(correct);
  });
  it('rejects an unproven number-only match', () => {
    expect(analysisFor(row, { 1: { enrichment: { bill_number: '12', bill_category: 'Ordinary Bill' } } })).toBeNull();
  });
  it('does not let an ordinal/id collision bypass bill identity', () => {
    expect(analysisFor({ ...row, id: '1', __idx: 1 }, { 1: entry(2024) })).toBeNull();
  });
  it('rejects a different title or house sharing the same number and year', () => {
    expect(analysisFor(row, { 1: entry(2025, { bill_name: 'Other Bill, 2025' }) })).toBeNull();
    expect(analysisFor(row, { 1: entry(2025, { house: 'Rajya Sabha' }) })).toBeNull();
  });
  it('collapses identical duplicate records without accepting conflicting analyses', () => {
    const first = entry();
    expect(analysisFor(row, { 1: first, 2: structuredClone(first) })).toBe(first);
    expect(analysisFor(row, { 1: first, 2: { ...entry(), brief: 'Different analysis' } })).toBeNull();
    expect(analysisFor(row, { 1: first, 2: entry(2025, { pdf_links: { introduced: 'wrong.pdf' } }) })).toBeNull();
  });
  it('matches a single title year followed by a descriptive parenthesis', () => {
    const title = 'Example Bill, 2025 (Amendment of the Schedule).';
    const value = entry(2025, { bill_name: title });
    expect(analysisFor({ ...row, bill_name: title }, { 1: value })).toBe(value);
    expect(analysisFor({ ...row, bill_name: 'Example 2024 and 2025 (Schedule)' }, { 1: value })).toBeNull();
  });
  it('retains direct lookup for nonbill analysis', () => {
    const value = { brief: 'Policy briefing' };
    expect(analysisFor({ id: 'policy-1' }, { 'policy-1': value })).toBe(value);
  });
});

describe('Citation Pack bill links independent of analysis coverage', () => {
  const identity = { ...entry().enrichment, document_key: 'bill:2025:12' };
  const pdf = 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/example.pdf?source=legislation';
  const source = { identity, pdf_links: { introduced: pdf } };
  it('resolves verified bill links when no analysis exists, without inventing analysis content', () => {
    const result = analysisFor(row, bindBillAnalysisIdentities({}, [], [source]));
    expect(result?.enrichment.pdf_links.introduced).toBe(pdf);
    expect(result?.passage_probability).toBeUndefined();
  });
  it('preserves a unique analysis and uses identity-bound document links', () => {
    const value = { ...entry(), brief: 'Existing analysis' };
    const result = analysisFor(row, bindBillAnalysisIdentities({ 1: value }, [], [source]));
    expect(result?.brief).toBe('Existing analysis');
    expect(result?.enrichment.pdf_links.introduced).toBe(pdf);
  });
  it('does not choose among conflicting source links or bind a wrong-key identity', () => {
    const conflict = { ...source, pdf_links: { introduced: pdf.replace('example', 'other') } };
    expect(analysisFor(row, bindBillAnalysisIdentities({}, [], [source, conflict]))).toBeNull();
    expect(analysisFor(row, bindBillAnalysisIdentities({}, [], [{ ...source, identity: { ...identity, document_key: 'bill:2024:12' } }]))).toBeNull();
    expect(analysisFor(row, bindBillAnalysisIdentities({}, [], [{ ...source, pdf_links: { introduced: 'https://evil.test/a.pdf' } }]))).toBeNull();
  });
  it('collapses identical source mappings while withholding conflicting analysis content', () => {
    const result = analysisFor(row, bindBillAnalysisIdentities({ 1: entry(), 2: { ...entry(), brief: 'Conflict' } }, [], [source, structuredClone(source)]));
    expect(result?.enrichment.pdf_links.introduced).toBe(pdf);
    expect(result?.brief).toBeUndefined();
  });
});
