// The terminal opens only for a signed-in user: the session flag alone is not
// enough, because sessionUser() no longer falls back to a built-in account.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./marketing/MarketingSite.jsx', () => ({ default: () => 'MARKETING' }));
vi.mock('./shell/TerminalShell.jsx', () => ({ default: () => 'TERMINAL' }));
vi.mock('./admin/AdminApp.jsx', () => ({ default: () => 'ADMIN' }));
vi.mock('./shell/PersonaChooser.jsx', () => ({ default: () => 'CHOOSER' }));
vi.mock('./lib/siteHead.js', () => ({ startSiteHead: vi.fn() }));
vi.mock('./lib/appFlagsStore.js', () => ({ hydrateAppFlags: vi.fn(async () => ({})), isTestingPhase: () => false }));
vi.mock('./lib/personas.js', () => ({ applyPersonaForUser: vi.fn(), readPersonaId: vi.fn(() => 'analyst') }));
vi.mock('./lib/supabaseClient.js', () => ({ supabase: { auth: { onAuthStateChange: vi.fn() } } }));

import App from './App.jsx';
import { setSessionUser } from './lib/userStore.js';
import { entitlementOf, canExport, rowCapForUser, FREE_ROW_CAP } from './lib/planEntitlements.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('location', { pathname: '/', hash: '' });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('terminal sign-in gate', () => {
  it('shows the marketing site when the session flag is set but no user is stored', () => {
    sessionStorage.setItem('niyantranAuthed', '1');
    expect(renderToStaticMarkup(createElement(App))).toBe('MARKETING');
  });

  it('shows the marketing site for a legacy email-only session', () => {
    sessionStorage.setItem('niyantranAuthed', '1');
    sessionStorage.setItem('niyantranUser', 'analyst@niyantran');
    expect(renderToStaticMarkup(createElement(App))).toBe('MARKETING');
  });

  it('shows the marketing site when a user is stored without the flag', () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org' });
    sessionStorage.removeItem('niyantranAuthed');
    expect(renderToStaticMarkup(createElement(App))).toBe('MARKETING');
  });

  it('opens the terminal when the flag is set and a user is stored', () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org', type: 'student' });
    expect(sessionStorage.getItem('niyantranAuthed')).toBe('1');
    expect(renderToStaticMarkup(createElement(App))).toBe('TERMINAL');
  });
  // Accounts whose profile has no saved persona answered as Corporate Affairs
  // without ever being asked (plan C5). They choose once, at sign-in.
  it('asks an account with no saved persona to choose one', () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org', personaSaved: false });
    expect(renderToStaticMarkup(createElement(App))).toBe('CHOOSER');
  });

  it('opens the terminal directly for an account whose persona is saved, or unknown', () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org', type: 'journalist', personaSaved: true });
    expect(renderToStaticMarkup(createElement(App))).toBe('TERMINAL');
    setSessionUser({ id: 'uid-1', email: 'person@example.org', type: 'journalist' });
    expect(renderToStaticMarkup(createElement(App))).toBe('TERMINAL');
  });
});

describe('entitlements for a missing user', () => {
  it('treats null as the explorer entitlement', () => {
    expect(entitlementOf(null)).toMatchObject({ plan: 'explorer', status: 'free', trialExpired: false });
    expect(canExport(null)).toBe(false);
    expect(rowCapForUser(null)).toBe(FREE_ROW_CAP);
  });
});
