import { describe, expect, it } from 'vitest';
import { featureMenuLabel } from './national.js';

// Module headings and menus: a word the catalogue writes in capitals (an abbreviation such as NCLT,
// ICC or WTO, or a mixed form such as ECtHR) is printed as written; other words are title-cased.
describe('featureMenuLabel', () => {
  it('keeps abbreviations as the catalogue writes them', () => {
    expect(featureMenuLabel({ htmlFeature: 'NCLT / NCLAT (Insolvency)' })).toBe('NCLT / NCLAT (Insolvency)');
    expect(featureMenuLabel({ htmlFeature: 'ICC Proceedings' })).toBe('ICC Proceedings');
    expect(featureMenuLabel({ htmlFeature: 'Sector Tribunals (ITAT / TDSAT / SAT / DRT)' })).toBe('Sector Tribunals (ITAT / TDSAT / SAT / DRT)');
    expect(featureMenuLabel({ htmlFeature: 'NGT Environmental Litigation Tracker' })).toBe('NGT Environmental Litigation Tracker');
    expect(featureMenuLabel({ htmlFeature: "Regional Int'l Courts (ECtHR / CJEU / ITLOS)" })).toBe("Regional Int'l Courts (ECtHR / CJEU / ITLOS)");
  });

  it('still title-cases ordinary words and keeps the existing renames', () => {
    expect(featureMenuLabel({ htmlFeature: 'district court case tracker' })).toBe('District Court Case Tracker');
    expect(featureMenuLabel({ htmlFeature: 'Supreme Court Order & Judgment Feed' })).toBe('Supreme Court Order & Judgements Feed');
    expect(featureMenuLabel({ htmlFeature: 'Order Archive by Topic (Cross-Court)' })).toBe('Orders By Topic (Cross-Court)');
    expect(featureMenuLabel({ htmlFeature: 'MP Profiles & Performance (MPLAD, attendance, debates)' })).toBe('MP Profiles & Performance (MPLAD, Attendance, Debates)');
  });

  it('does not keep capitals when the whole label is in capitals (a workbook short code)', () => {
    expect(featureMenuLabel({ workbookFunctions: 'BILL TRACKER' })).toBe('Bill Tracker');
    expect(featureMenuLabel({ workbookFunctions: 'RBI CIRCULARS' })).toBe('RBI Circulars');
  });
});
