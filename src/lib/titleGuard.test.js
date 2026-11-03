import { describe, expect, it } from 'vitest';
import { significantWords, titleMatches } from './titleGuard.js';

// Heads are short synthetic openings shaped like the five wrong-text Bill documents in
// docs/research/2026-11-01-f281-broken-documents.md (title taken from the listing record,
// text taken from the file behind its link) and like their correct counterparts.
const HEADS = {
  childWelfare: '# THE NATIONAL CHILD WELFARE BOARD BILL, 2005\n\nA\n\n## BILL\n\nto provide for the establishment of a National Child Welfare Board',
  buyIndian: '# THE BUY INDIAN BILL, 2004\n\nA\n\n## BILL\n\nto provide for compulsory buying of indigenous goods',
  semiconductor: '# THE SEMICONDUCTOR INTEGRATED CIRCUITS LAYOUT-DESIGN BILL, 1999 ARRANGEMENT OF CLAUSES\n\n## CHAPTER I PRELIMINARY',
  population: 'AS INTRODUCED IN THE RAJYA SABHA\nBill No. L of 2000\nTHE POPULATION CONTROL BILL, 2000\nA\nBILL\nto provide for measures and',
  // A foreign cover page ahead of the right body: 164 characters of another bill, then the real opening.
  passportWithCover: 'RAJYA SABHA\nA\nBILL\nto amend the Multimodal Transportation of Goods Act, 1993.\n(Minister of Surface Transport)\nMGIP(PLU)MRND-2305RS-02.08.2000.\n\nAS INIRODUCED IN THE RAJYA SABHA\n|\nBill No. LI of 2000\n\nTHE PASSPORT (ENTRY INTO INDIA) AMENDMENT BILL, 2000',
  passport: 'AS INIRODUCED IN THE RAJYA SABHA\n|\nBill No. LI of 2000\n\nTHE PASSPORT (ENTRY INTO INDIA) AMENDMENT\nBILL, 2000',
  taxation: 'Bill No. 105-F of 2025\n\n\nTHE TAXATION LAWS (AMENDMENT) BILL, 2025\n\n\n       (AS PASSED BY THE HOUSES OF PARLIAMENT',
};

describe('significantWords', () => {
  it('drops stop words, bill, amendment, years, numbers, punctuation and short fragments', () => {
    expect(significantWords('The Climate Change Bill, 2012.')).toEqual(['climate', 'change']);
    expect(significantWords('The Taxation Laws (Amendment) Bill, 2025')).toEqual(['taxation', 'laws']);
    expect(significantWords('The Constitution ( Amendment) Bill,1999 (insertion of new article 16 A)')).toEqual(['constitution']);
    expect(significantWords('The Central Universities (Amendment) Bill, 2011 (Insertion of new section 3B, etc.).')).toEqual(['central', 'universities']);
  });

  it('treats a hyphen as a word break and ignores case and extra spaces', () => {
    expect(significantWords('LAYOUT-DESIGN   Bill')).toEqual(['layout', 'design']);
  });

  it('returns no words for a file-name style title', () => {
    expect(significantWords('LI_2000')).toEqual([]);
    expect(significantWords('2833LS')).toEqual([]);
  });
});

describe('titleMatches: the five wrong-text Bills fail', () => {
  const cases = [
    ['Climate Change Bill 2012 holding the Child Welfare Board Bill', 'The Climate Change Bill, 2012.', HEADS.childWelfare, ['climate', 'change']],
    ['Central Universities Bill 2011 holding the Buy Indian Bill', 'The Central Universities (Amendment) Bill, 2011 (Insertion of new section 3B, etc.).', HEADS.buyIndian, ['central', 'universities']],
    ['Constitution (Amendment) Bill 1999 holding the Semiconductor Bill', 'The Constitution ( Amendment) Bill,1999 (insertion of new article 16 A)', HEADS.semiconductor, ['constitution']],
    ['Semiconductor Bill 2000 holding the Population Control Bill', 'The Semiconductor Integrated Circuits Layout Design Bill, 2000', HEADS.population, ['semiconductor', 'integrated', 'circuits', 'layout', 'design']],
  ];
  for (const [name, title, head, missing] of cases) {
    it(name, () => {
      const r = titleMatches(title, head);
      expect(r.ok).toBe(false);
      expect(r.reasons).toContain('missing_words');
      expect(r.missing).toEqual(missing);
    });
  }

  it('Passport Bill behind a foreign cover page fails because its title appears too late', () => {
    const r = titleMatches('The Passport (Entry into India) Amendment Bill, 2000', HEADS.passportWithCover);
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(['late_start']);
    expect(r.missing).toEqual([]);
    expect(r.firstMatchAt).toBeGreaterThan(150);
  });
});

describe('titleMatches: correct Bills pass', () => {
  const good = [
    ['National Child Welfare Board Bill 2005', 'The National Child Welfare Board Bill, 2005', HEADS.childWelfare],
    ['Buy Indian Bill 2004', 'The Buy Indian Bill, 2004', HEADS.buyIndian],
    ['Semiconductor Bill (hyphenated in the text)', 'The Semiconductor Integrated Circuits Layout Design Bill, 2000', HEADS.semiconductor],
    ['Population Control Bill 2000', 'The Population Control Bill, 2000', HEADS.population],
    ['Passport Bill once the cover is stripped', 'The Passport (Entry into India) Amendment Bill, 2000', HEADS.passport],
    ['Taxation Laws Bill 2025', 'THE TAXATION LAWS (AMENDMENT) BILL, 2025', HEADS.taxation],
  ];
  for (const [name, title, head] of good) {
    it(name, () => {
      const r = titleMatches(title, head);
      expect(r.reasons).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.missing).toEqual([]);
    });
  }
});

describe('titleMatches: OCR noise', () => {
  it('ignores case and runs of spaces', () => {
    expect(titleMatches('The Manipur Goods and Services Tax (Amendment) Bill, 2025', 'bill no. 101-f of 2025   the   MANIPUR   goods  and   SERVICES tax (amendment) bill').ok).toBe(true);
  });

  it('joins words hyphenated across a line break', () => {
    expect(titleMatches('The Constitution (Amendment) Bill', 'THE CON-\nSTITUTION (AMEND-\nMENT) BILL').ok).toBe(true);
  });

  it('tolerates one wrong letter in a long word', () => {
    const r = titleMatches('The Taxation Laws (Amendment) Bill', 'THE TAXATI0N LAWS (AMENDMENT) BILL');
    expect(r.ok).toBe(true);
  });

  it('does not let a one-letter tolerance rescue a short word', () => {
    expect(titleMatches('The Coal Bill', 'THE GOAL BILL').ok).toBe(false);
  });

  it('matches a plural against a singular', () => {
    expect(titleMatches('The Central Universities Bill', 'THE CENTRAL UNIVERSITY BILL, 2011').ok).toBe(true);
  });

  it('allows one missing word in four but not two', () => {
    const title = 'The Alpha Beta Gamma Delta Bill';
    expect(titleMatches(title, 'ALPHA BETA GAMMA BILL').ok).toBe(true);
    expect(titleMatches(title, 'ALPHA BETA BILL').ok).toBe(false);
  });
});

describe('titleMatches: scope of the check', () => {
  it('looks only at the first part of the text', () => {
    const body = 'x'.repeat(4000);
    expect(titleMatches('The Buy Indian Bill', `${body}\nTHE BUY INDIAN BILL`).ok).toBe(false);
    expect(titleMatches('The Buy Indian Bill', `${body}\nTHE BUY INDIAN BILL`, { headChars: 5000, maxLead: 5000 }).ok).toBe(true);
    // Widening the window alone is not enough: the title is still far behind the opening.
    expect(titleMatches('The Buy Indian Bill', `${body}\nTHE BUY INDIAN BILL`, { headChars: 5000 }).reasons).toEqual(['late_start']);
  });

  it('with chunks, looks at the first two chunks only', () => {
    const chunks = ['# THE CHILD WELFARE BILL', 'to provide for care', 'THE BUY INDIAN BILL'];
    expect(titleMatches('The Buy Indian Bill', '', { chunks }).ok).toBe(false);
    expect(titleMatches('The Buy Indian Bill', '', { chunks, headChunks: 3 }).ok).toBe(true);
  });

  it('does not count layout padding as foreign text before the title', () => {
    const padded = `AS PASSED BY THE RAJYA SABHA\n${' '.repeat(300)}ON THE 1ST APRIL, 2025\n\n${' '.repeat(300)}Bill No. IX-C of 2025\n\n${' '.repeat(200)}THE PROTECTION OF INTERESTS IN AIRCRAFT\n OBJECTS BILL, 2025`;
    const r = titleMatches('The Protection of Interests in Aircraft Objects Bill, 2025', padded);
    expect(r.ok).toBe(true);
    expect(r.firstMatchAt).toBeLessThan(80);
  });

  it('does not count the HTML an OCR leaves in front of the title (an image box in a div) as foreign text', () => {
    const head = 'As introduced in Lok Sabha\n\n#### 2. 0 APR.2000\n\n<div style="text-align: center;"><img src="imgs/img_in_image_box_600_484_1144_660.jpg" alt="Image" width="44%" /></div>\n# THE REPRESENTATION OF THE PEOPLE (AMENDMENT) BILL, 2000\n\nBy';
    const r = titleMatches('The Representation of the People (Amendment) Bill, 2000', head);
    expect(r.ok).toBe(true);
    expect(r.firstMatchAt).toBeLessThan(60);
  });

  it('does not take a Gazette of India heading for a foreign cover', () => {
    const gazette = `REGISTERED NO. DL-(N)04/0007/2003-10\nEXTRAORDINARY\nPART II - Section 1\nPUBLISHED BY AUTHORITY\nNo. 37] NEW DELHI, WEDNESDAY, AUGUST 25, 2010\n${'Separate paging is given to this Part in order that it may be filed as a separate compilation. '.repeat(3)}\nTHE ENERGY CONSERVATION (AMENDMENT) BILL, 2010`;
    const r = titleMatches('The Energy Conservation (Amendment) Bill, 2010.', gazette, { headChars: 3000 });
    expect(r.firstMatchAt).toBeGreaterThan(150);
    expect(r.reasons).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('cannot judge a title with no significant word and says so without failing it', () => {
    const r = titleMatches('LI_2000', 'anything at all');
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(false);
    expect(r.words).toEqual([]);
  });

  it('reports matched and missing words', () => {
    const r = titleMatches('The National Child Care Bill', 'THE NATIONAL CHILD WELFARE BILL');
    expect(r.matched).toEqual(['national', 'child']);
    expect(r.missing).toEqual(['care']);
  });
});
