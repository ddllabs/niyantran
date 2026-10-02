import { describe, expect, it } from 'vitest';
import { citedPieces, layerWords, locatePassage, passageWords } from './passageMatch.js';

const words = text => passageWords(text).map(w => w.word);

describe('passageWords: the stored OCR Markdown reduced to words', () => {
  it('drops Markdown syntax: headings, emphasis, table pipes and rules', () => {
    expect(words('# THE BILL\n\n**Bill No. 77**\n\n*to amend* the Act')).toEqual(['the', 'bill', 'bill', 'no', '77', 'to', 'amend', 'the', 'act']);
    expect(words('|  Amendment of section 11. | 8. In section 11 |\n| --- | --- |')).toEqual(['amendment', 'of', 'section', '11', '8', 'in', 'section', '11']);
  });

  it('drops images, keeps link text, and strips tags', () => {
    expect(words('See ![img-0.jpeg](img-0.jpeg) the [Gazette](https://x.y/z) <sup>1</sup> now')).toEqual(['see', 'the', 'gazette', '1', 'now']);
  });

  it('folds case, quotes and dashes, and joins words hyphenated across a line end', () => {
    expect(words('the words “who are”—and ‘or have been’ are inde-\npendent')).toEqual(['the', 'words', 'who', 'are', 'and', 'or', 'have', 'been', 'are', 'independent']);
  });

  it('keeps Hindi words whole, combining marks included', () => {
    expect(words('पूंजीगत व्यय की प्रवृत्ति')).toEqual(['पूंजीगत', 'व्यय', 'की', 'प्रवृत्ति']);
  });

  it('is empty for nothing', () => {
    expect(words('')).toEqual([]);
    expect(words(undefined)).toEqual([]);
  });
});

describe('layerWords: the PDF text layer reduced to words, each mapped to its text item', () => {
  it('records each word\'s item and offsets, so a mark can become a DOM range', () => {
    const items = [{ str: 'In section 11 of the', hasEOL: true }, { str: 'principal Act,', hasEOL: false }];
    const out = layerWords(items);
    expect(out.map(w => w.word)).toEqual(['in', 'section', '11', 'of', 'the', 'principal', 'act']);
    expect(out[5]).toMatchObject({ item: 1, from: 0, to: 9 });
    expect(out[2]).toMatchObject({ item: 0, from: 11, to: 13 });
  });

  it('joins a word hyphenated across two items at a line end', () => {
    const out = layerWords([{ str: 'inde-', hasEOL: true }, { str: 'pendent body', hasEOL: false }]);
    expect(out.map(w => w.word)).toEqual(['independent', 'body']);
    expect(out[0]).toMatchObject({ item: 0, from: 0, endItem: 1, to: 7 });
  });
});

describe('locatePassage', () => {
  const layer = ws => ws.split(' ').map(word => ({ word }));
  const passage = ws => ws.split(' ').map(word => ({ word }));

  it('finds a passage by its first and last anchors and returns the layer word range', () => {
    const l = layer('preamble text here in section 11 of the principal act the words who are the words or have been shall be inserted line 15 after');
    const p = passage('in section 11 of the principal act the words who are the words or have been shall be inserted');
    expect(locatePassage(p, l)).toEqual({ start: 3, end: 21, coverage: 1 });
  });

  it('tolerates words the PDF adds inside the passage, such as margin line numbers', () => {
    const l = layer('in section 11 of the principal act 5 the words who are 10 the words or have been shall be inserted');
    const p = passage('in section 11 of the principal act the words who are the words or have been shall be inserted');
    const found = locatePassage(p, l);
    expect(found).toMatchObject({ start: 0, end: l.length - 1 });
    expect(found.coverage).toBe(1);
  });

  it('tolerates a margin note OCR placed elsewhere, while 80% of the passage is there in order', () => {
    const p = passage('amendment of section 11 in section 11 of the principal act in sub section 2 in clause d after the words who are the words or have been shall be inserted');
    const l = layer('in section 11 of the principal act in sub section 2 in clause d after the words who are the words or have been shall be inserted amendment of section 11');
    const found = locatePassage(p, l);
    expect(found).not.toBeNull();
    expect(found.coverage).toBeGreaterThanOrEqual(0.8);
  });

  it('looks past an end anchor that is really a margin note set elsewhere in the PDF\'s text', () => {
    // OCR folded the margin note "note one two three four" into the body at the passage's end; the
    // PDF keeps it in the side column, which pdf.js reads first. Found on the anti-doping bill.
    const body = 'a b c d e f g h i j k l m n o p q r s t';
    const p = passage(`${body} note one two three four`);
    const l = layer(`note one two three four x ${body} y z`);
    expect(locatePassage(p, l)).toMatchObject({ start: 6, end: 25 });
  });

  it('looks past a start anchor that is really a margin note', () => {
    const body = 'a b c d e f g h i j k l m n o p q r s t';
    const p = passage(`note one two three four ${body}`);
    const l = layer(`${body} y z note one two three four`);
    expect(locatePassage(p, l)).toMatchObject({ start: 0, end: 19 });
  });

  it('refuses a match below 80% coverage', () => {
    const p = passage('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen');
    const l = layer('one two three four five x x x x x x x x x x x x eleven twelve thirteen fourteen fifteen');
    expect(locatePassage(p, l)).toBeNull();
  });

  it('refuses a window far longer than the passage', () => {
    const p = passage('alpha beta gamma delta epsilon zeta eta theta iota kappa');
    const filler = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    const l = layer(`alpha beta gamma delta epsilon ${filler} zeta eta theta iota kappa`);
    expect(locatePassage(p, l)).toBeNull();
  });

  it('chooses the occurrence that covers the passage when an anchor repeats', () => {
    const p = passage('the words who are the words or have been shall be inserted here');
    const l = layer('the words who are found elsewhere entirely and then the words who are the words or have been shall be inserted here');
    expect(locatePassage(p, l)).toMatchObject({ start: 9, end: l.length - 1, coverage: 1 });
  });

  it('matches a short passage exactly, and finds nothing in an empty layer', () => {
    expect(locatePassage(passage('short title'), layer('chapter one short title and commencement'))).toEqual({ start: 2, end: 3, coverage: 1 });
    expect(locatePassage(passage('short title'), [])).toBeNull();
    expect(locatePassage([], layer('anything'))).toBeNull();
  });
});

describe('citedPieces: the citation cut at page boundaries, in each page\'s own offsets', () => {
  const rows = [
    { page_number: 4, char_from: 100, char_to: 200, text: 'x'.repeat(100) },
    { page_number: 5, char_from: 202, char_to: 300, text: 'y'.repeat(98) },
  ];

  it('is one piece for a citation inside one page', () => {
    expect(citedPieces({ char_from: 120, char_to: 150 }, rows)).toEqual([{ page: 4, from: 20, to: 50 }]);
  });

  it('is a piece on each page a citation runs across', () => {
    expect(citedPieces({ char_from: 180, char_to: 230 }, rows)).toEqual([{ page: 4, from: 80, to: 100 }, { page: 5, from: 0, to: 28 }]);
  });

  it('skips a page the citation does not reach, and is empty without usable offsets', () => {
    expect(citedPieces({ char_from: 210, char_to: 220 }, rows)).toEqual([{ page: 5, from: 8, to: 18 }]);
    expect(citedPieces({ char_from: null, char_to: 220 }, rows)).toEqual([]);
    expect(citedPieces({ char_from: 220, char_to: 210 }, rows)).toEqual([]);
    expect(citedPieces({ char_from: 120, char_to: 150 }, undefined)).toEqual([]);
  });
});
