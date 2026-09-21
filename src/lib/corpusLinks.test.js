import { describe, expect, it } from 'vitest';
import { foldRecord } from '../../scripts/build-corpus-links.mjs';

function billRecord(text, title = 'Dataset title') {
  return { doc_type: 'bill_record', title, text };
}

describe('corpus link bill identity', () => {
  it('retains complete bill metadata for a numeric identity', () => {
    const links = {};
    foldRecord(
      links,
      billRecord(`billNumber: 156
billName: The Complete Bill, 2026
billYear: 2026
billIntroducedInHouse: Lok Sabha
status: Introduced
billIntroducedFile: https://sansad.test/getFile/complete.pdf`),
    );

    expect(links['complete.pdf']).toEqual({
      url: 'https://sansad.test/getFile/complete.pdf',
      doc_type: 'bill_record',
      title: 'The Complete Bill, 2026',
      bill_number: '156',
      bill_year: '2026',
      house: 'Lok Sabha',
      status: 'Introduced',
    });
  });

  it('does not consume billYear when billNumber is blank', () => {
    const links = {};
    foldRecord(
      links,
      billRecord(`billNumber:
billYear: 2005
billName: A Bill With No Number
billIntroducedInHouse: Rajya Sabha
status: Pending
billIntroducedFile: https://sansad.test/getFile/blank-number.pdf`),
    );

    expect(links['blank-number.pdf']).toMatchObject({
      title: 'A Bill With No Number',
      house: 'Rajya Sabha',
      status: 'Pending',
    });
    expect(links['blank-number.pdf']).not.toHaveProperty('bill_number');
    expect(links['blank-number.pdf']).not.toHaveProperty('bill_year');
  });

  it.each([
    ['missing year', 'billNumber: 12'],
    ['missing number', 'billYear: 2005'],
    ['malformed number from the shipped bill data', 'billNumber: XLI[[\nbillYear: 2005'],
    ['non-numeric year', 'billNumber: 12\nbillYear: 20O5'],
  ])('omits an incomplete or invalid identity: %s', (_label, identity) => {
    const links = {};
    foldRecord(links, billRecord(`${identity}\nbillIntroducedFile: https://sansad.test/getFile/invalid.pdf`));

    expect(links['invalid.pdf']).not.toHaveProperty('bill_number');
    expect(links['invalid.pdf']).not.toHaveProperty('bill_year');
  });

  it('retains observed Roman and spaced-Roman bill numbers', () => {
    for (const billNumber of ['LXXII', 'XXXX', 'XXX II']) {
      const links = {};
      foldRecord(
        links,
        billRecord(`billNumber: ${billNumber}\nbillYear: 1972\nbillIntroducedFile: https://sansad.test/getFile/${billNumber.replace(' ', '-')}.pdf`),
      );

      expect(Object.values(links)[0]).toMatchObject({ bill_number: billNumber, bill_year: '1972' });
    }
  });

  it('keeps conflicting source URLs ambiguous without retaining a guessed identity', () => {
    const links = {};
    foldRecord(
      links,
      billRecord('billNumber: 10\nbillYear: 2020\nbillIntroducedFile: https://one.test/files/shared.pdf'),
    );
    foldRecord(
      links,
      billRecord('billNumber: 11\nbillYear: 2021\nbillIntroducedFile: https://two.test/files/shared.pdf'),
    );

    expect(links['shared.pdf']).toEqual({
      ambiguous: true,
      urls: ['https://one.test/files/shared.pdf', 'https://two.test/files/shared.pdf'],
    });
  });
});
