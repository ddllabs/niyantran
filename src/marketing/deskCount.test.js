// F30 (F171 B10): the homepage proof card said "12 Desks" while pricing says "Eight desks"; the
// terminal has eight. Both are checked against the desk list so they cannot drift again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

const desks = new Set(DESK_CATALOGUE.map((m) => m.tab)).size;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

describe('desk count on the marketing pages (F30)', () => {
  it('the homepage proof card names the real number of desks', () => {
    const home = readFileSync(new URL('./HomePage.jsx', import.meta.url), 'utf8');
    const shown = /<b>(\d+)<\/b>\s*Desks/.exec(home)?.[1];
    expect(Number(shown)).toBe(desks);
  });

  it('the pricing page names the real number of desks', () => {
    const pricing = readFileSync(new URL('./PricingPage.jsx', import.meta.url), 'utf8');
    const word = /title: '(\w+) desks'/i.exec(pricing)?.[1]?.toLowerCase();
    expect(WORDS.indexOf(word)).toBe(desks);
  });
});
