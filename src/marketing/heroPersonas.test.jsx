import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PERSONAS, PERSONA_PERSPECTIVES } from '../lib/personas.js';
import HeroPersonas, { PersonaPopover, focusAfterClick, popoverState, returnFocusOnEscape } from './HeroPersonas.jsx';

// F212 (client reference NTER-Final-Developer-Kit top section v5, owner 2026-10-16): the hero's persona
// column. The names, subtitles and popover text are the reference's, word for word.
const REFERENCE = [
  ['policy', 'Policy Analysts', 'Policy into perspective', 'Put legislation and implementation in the same frame.', ['Bill passage & committee stages', 'Cabinet and PIB decisions']],
  ['journalist', 'Journalists', 'Follow the public record', 'Follow a claim back to the public record, with its source in view.', ['Statement and wire registers', 'Connected records across desks']],
  ['student', 'UPSC Aspirants', 'Connect your current affairs', 'Connect polity and current affairs through the underlying records.', ['National and Law desk coverage', 'Questions and parliamentary bills']],
  ['analyst', 'Corporate Affairs', 'See the regulatory picture', 'Bring regulatory and legislative context into your next briefing.', ['Regulatory body watch', 'Economic and sector signals']],
  ['lawyer', 'Legal Researchers', 'Find the source behind a case', 'See judgments, statutes and parliamentary records side by side.', ['Supreme Court and High Court orders', 'Source-linked legal registers']],
  ['academic', 'Academics', 'Research across time', 'Trace institutions and public decisions across time.', ['Longitudinal public records', 'Archive depth and labelled sources']],
];

const unescape = (s) => s.replace(/&amp;/g, '&');

describe('hero persona column (F212)', () => {
  it('keeps the reference text beside each of our six personas', () => {
    expect(Object.keys(PERSONA_PERSPECTIVES)).toEqual(PERSONAS.map((p) => p.id));
    for (const [id, name, tagline, description, points] of REFERENCE) {
      expect(PERSONA_PERSPECTIVES[id], id).toEqual({ name, tagline, description, points });
    }
  });

  it('shows the heading, six cards in order with name and subtitle, and the hint', () => {
    const html = renderToStaticMarkup(<HeroPersonas onExplore={() => {}} />);
    expect(html).toContain('CURATED FOR');
    expect(html).toMatch(/Find your <br\/>perspective<span>\.<\/span>/);
    expect(html).toContain('One platform. Built around you.');
    expect(html).toContain('Choose a role. Discover your view.');
    const cards = [...html.matchAll(/<button[^>]*data-persona="(\w+)"[^>]*>.*?<strong>(.*?)<\/strong><small>(.*?)<\/small>/g)]
      .map((m) => [m[1], m[2], m[3]]);
    expect(cards).toEqual(REFERENCE.map(([id, name, tagline]) => [id, name, tagline]));
  });

  it('starts closed: every card collapsed and the popover hidden', () => {
    const html = renderToStaticMarkup(<HeroPersonas onExplore={() => {}} />);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(6);
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).toMatch(/<section class="nd-persona-popover"[^>]*hidden=""/);
    // No Replay button and no auto-preview (owner 2026-10-16).
    expect(html).not.toMatch(/Replay/i);
    const source = readFileSync(new URL('./HeroPersonas.jsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/autoPreview|setTimeout\([^)]*1600/);
  });

  it('fills the popover with the persona’s reference text and the explore link', () => {
    for (const [id, name, , description, points] of REFERENCE) {
      const html = unescape(renderToStaticMarkup(<PersonaPopover id={id} open onClose={() => {}} onExplore={() => {}} />));
      expect(html).toContain('YOUR NTER PERSPECTIVE');
      expect(html).toMatch(new RegExp(`<h3[^>]*>${name}</h3>`));
      expect(html).toContain(`<p>${description}</p>`);
      expect([...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1])).toEqual(points);
      expect(html).toMatch(/<a href="#personas"[^>]*>Explore this perspective/);
      expect(html).toMatch(/<button[^>]*aria-label="Close persona preview"/);
    }
  });
});

describe('persona popover state (F212)', () => {
  const closed = { openId: null, pinned: false };
  const run = (...events) => events.reduce(popoverState, closed);

  it('previews on mouse hover and on focus, without pinning', () => {
    expect(run({ type: 'hover', id: 'policy' })).toEqual({ openId: 'policy', pinned: false });
    expect(run({ type: 'focus', id: 'lawyer' })).toEqual({ openId: 'lawyer', pinned: false });
  });

  it('a click pins the card; a second click on the pinned card closes it', () => {
    const pinned = run({ type: 'focus', id: 'policy' }, { type: 'click', id: 'policy' });
    expect(pinned).toEqual({ openId: 'policy', pinned: true });
    expect(popoverState(pinned, { type: 'click', id: 'policy' })).toEqual(closed);
    expect(popoverState(pinned, { type: 'click', id: 'academic' })).toEqual({ openId: 'academic', pinned: true });
  });

  it('hovering another card does not replace a pinned one', () => {
    const pinned = run({ type: 'click', id: 'policy' });
    expect(popoverState(pinned, { type: 'hover', id: 'journalist' })).toBe(pinned);
  });

  it('leaving the column closes a preview but not a pinned popover', () => {
    expect(run({ type: 'hover', id: 'policy' }, { type: 'leave' })).toEqual(closed);
    const pinned = run({ type: 'click', id: 'policy' });
    expect(popoverState(pinned, { type: 'leave' })).toBe(pinned);
  });

  it('Escape, the close button and a press outside close even a pinned popover', () => {
    for (const type of ['escape', 'close', 'outside']) {
      expect(run({ type: 'click', id: 'policy' }, { type }), type).toEqual(closed);
    }
  });
});

// F212 review: the popover follows all six cards, so a keyboard user tabbing towards it opened each later
// card in turn and only ever reached Academics' link; Escape anywhere on the page pulled focus back to the
// hero; and the explore link left focus on the page body.
describe('persona popover focus (F212)', () => {
  it('moves focus into the popover when Enter or Space pins a card, not on a mouse click', () => {
    expect(focusAfterClick(0, { openId: 'policy', pinned: true })).toBe(true);
    expect(focusAfterClick(1, { openId: 'policy', pinned: true })).toBe(false);
    expect(focusAfterClick(0, { openId: null, pinned: false })).toBe(false);
  });

  it('returns focus to the card on Escape only when focus was in the column', () => {
    expect(returnFocusOnEscape(true)).toBe(true);
    expect(returnFocusOnEscape(false)).toBe(false);
  });

  it('focuses the personas heading after explore, without a second scroll', () => {
    const home = readFileSync(new URL('./HomePage.jsx', import.meta.url), 'utf8');
    expect(home).toMatch(/<h2 id="mkt-personas-title" tabIndex=\{-1\}>/);
    expect(home).toMatch(/getElementById\('mkt-personas-title'\)\?\.focus\(\{ preventScroll: true \}\)/);
  });
});
