import { describe, expect, it } from 'vitest';
import { GLOBE_DESTINATIONS, landAfterSignUp, openGlobeDestination } from './globeDestinations.js';

// F140 (owner 2026-10-13): each globe label opens its desk landing or terminal page; a signed-out
// visitor signs in first, through the same hand-off the coverage carousel uses.
describe('globe label destinations', () => {
  it('maps the seven labels to our desks and modules', () => {
    expect(GLOBE_DESTINATIONS).toEqual({
      bills: { tab: 'national', feature: 'Bill Passage Probability Index' },
      law: { tab: 'law', feature: '' },
      regulatory: { tab: 'national', feature: 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)' },
      news: { tab: 'home', feature: '' },
      questions: { tab: 'national', feature: 'Parliamentary Question Database' },
      economics: { tab: 'economics', feature: '' },
      global: { tab: 'global', feature: '' },
    });
  });

  it('remembers the destination and asks a signed-out visitor to sign in', () => {
    const store = new Map();
    const storage = { setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    let signIn = 0;
    openGlobeDestination('questions', { storage, signedIn: false, onLogin: () => { signIn += 1; } });
    expect(Object.fromEntries(store)).toEqual({ niyantranLand: 'national', niyantranFeature: 'Parliamentary Question Database' });
    expect(signIn).toBe(1);
    openGlobeDestination('law', { storage, signedIn: false, onLogin: () => {} });
    expect(Object.fromEntries(store)).toEqual({ niyantranLand: 'law' });
  });

  it('opens the page directly when signed in, and ignores an unknown key', () => {
    const go = [];
    openGlobeDestination('bills', { signedIn: true, navigate: (tab, feature) => go.push([tab, feature]) });
    openGlobeDestination('nonsense', { signedIn: true, navigate: (tab, feature) => go.push([tab, feature]) });
    expect(go).toEqual([['national', 'Bill Passage Probability Index']]);
  });

  it('names modules that exist in the desk catalogue', async () => {
    const { DESK_CATALOGUE } = await import('../desks/landing/deskCatalogue.js');
    for (const { tab, feature } of Object.values(GLOBE_DESTINATIONS)) {
      if (feature) expect(DESK_CATALOGUE.some((e) => e.tab === tab && e.feature === feature), feature).toBe(true);
    }
  });
});

// Review (2026-10-14): a new account keeps a destination chosen before sign-up (a globe label or the
// coverage carousel) instead of replacing it with its persona's start desk.
describe('the landing after sign-up', () => {
  const storageWith = (entries) => {
    const store = new Map(Object.entries(entries));
    return { store, getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  };
  it('keeps a requested desk and module', () => {
    const s = storageWith({ niyantranLand: 'national', niyantranFeature: 'Parliamentary Question Database' });
    landAfterSignUp(s, 'law');
    expect(Object.fromEntries(s.store)).toEqual({ niyantranLand: 'national', niyantranFeature: 'Parliamentary Question Database' });
  });
  it('uses the persona start desk when nothing was requested, dropping a stray module', () => {
    const s = storageWith({ niyantranFeature: 'Stale' });
    landAfterSignUp(s, 'law');
    expect(Object.fromEntries(s.store)).toEqual({ niyantranLand: 'law' });
  });
});

it('is how SignupPage lands a new account', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./SignupPage.jsx', import.meta.url), 'utf8');
  expect(source).toContain('landAfterSignUp(sessionStorage, userTypeOf(type).startTab)');
  expect(source).not.toMatch(/sessionStorage\.setItem\('niyantranLand'/);
});
