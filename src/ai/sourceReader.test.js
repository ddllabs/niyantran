import { describe, expect, it } from 'vitest';
import { normalise, sha256Hex } from '../lib/textNormalise.js';
import { findPassage, resolveSpan } from './sourceReader.js';

const DOC = 'PART II — Section 1\n\nThe following Act of Parliament received the assent of the President on the 20th December, 2005.\n\nPRINTED BY THE MANAGER.';
const PASSAGE = 'The following Act of Parliament received the assent of the President on the 20th December, 2005.';

async function citationFor(text, from, to) {
  return { char_from: from, char_to: to, text_hash: await sha256Hex(normalise(text.slice(from, to))) };
}

describe('resolveSpan', () => {
  it('is exact when the stored span still hashes to the cited hash', async () => {
    const from = DOC.indexOf(PASSAGE);
    const c = await citationFor(DOC, from, from + PASSAGE.length);
    expect(await resolveSpan(DOC, c)).toEqual({ from, to: from + PASSAGE.length, status: 'exact' });
  });

  it('is moved when the passage still exists at another offset, even with different spacing', async () => {
    const from = DOC.indexOf(PASSAGE);
    const c = await citationFor(DOC, from, from + PASSAGE.length);
    const shifted = `A new preamble was inserted.\n\n${DOC}`;
    const r = await resolveSpan(shifted, c, PASSAGE);
    expect(r.status).toBe('moved');
    expect(shifted.slice(r.from, r.to)).toBe(PASSAGE);

    const respaced = shifted.replace('received the assent', 'received  the\nassent');
    const r2 = await resolveSpan(respaced, c, PASSAGE);
    expect(r2.status).toBe('moved');
    expect(normalise(respaced.slice(r2.from, r2.to))).toBe(normalise(PASSAGE));
  });

  it('is changed when the passage is gone, or when the cited text is unknown', async () => {
    const from = DOC.indexOf(PASSAGE);
    const c = await citationFor(DOC, from, from + PASSAGE.length);
    const edited = DOC.replace('20th December, 2005', '21st December, 2005');
    expect(await resolveSpan(edited, c, PASSAGE)).toEqual({ from: 0, to: 0, status: 'changed' });
    expect((await resolveSpan(`X ${DOC}`, c)).status).toBe('changed');
  });

  it('findPassage returns null for blank needles', () => {
    expect(findPassage(DOC, '   ')).toBeNull();
    expect(findPassage(DOC, 'PRINTED BY THE MANAGER.')).toEqual({ from: DOC.indexOf('PRINTED'), to: DOC.length });
  });
});
