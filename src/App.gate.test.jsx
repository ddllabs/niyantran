// The terminal opens only for a signed-in user: the session flag alone is not
// enough, because sessionUser() no longer falls back to a built-in account.
import { createElement } from 'react';
import { prerenderToNodeStream } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./marketing/MarketingSite.jsx', () => ({ default: () => 'MARKETING' }));
vi.mock('./shell/TerminalShell.jsx', () => ({ default: () => 'TERMINAL' }));
vi.mock('./admin/AdminApp.jsx', () => ({ default: () => 'ADMIN' }));
vi.mock('./shell/PersonaChooser.jsx', () => ({ default: () => 'CHOOSER' }));
vi.mock('./lib/siteHead.js', () => ({ startSiteHead: vi.fn() }));
vi.mock('./lib/personas.js', () => ({ applyPersonaForUser: vi.fn(), readPersonaId: vi.fn(() => 'analyst') }));
vi.mock('./lib/supabaseClient.js', () => ({ supabase: { auth: { onAuthStateChange: vi.fn() } } }));
// The server's answer to my_entitlement() for the stored user (F2).
const plan = vi.hoisted(() => ({ loaded: true }));
vi.mock('./lib/entitlementStore.js', () => ({
  serverEntitlement: (id) => (plan.loaded && id ? { userId: id, plan: 'free', status: 'free' } : null),
  refreshEntitlement: vi.fn(async () => null),
}));

import App from './App.jsx';
import { setSessionUser } from './lib/userStore.js';
import { entitlementOf, canExport, rowCapForUser } from './lib/planEntitlements.js';

// F145: the terminal, admin and chooser are lazy, so render the way a server would: wait for them,
// then drop React's Suspense boundary markers.
async function renderApp() {
  const { prelude } = await prerenderToNodeStream(createElement(App));
  let html = '';
  for await (const chunk of prelude) html += chunk;
  return html.replace(/<!--.*?-->/g, '');
}

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}

beforeEach(() => {
  plan.loaded = true;
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('location', { pathname: '/', hash: '' });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('terminal sign-in gate', () => {
  it('shows the marketing site when the session flag is set but no user is stored', async () => {
    sessionStorage.setItem('niyantranAuthed', '1');
    expect(await renderApp()).toBe('MARKETING');
  });

  it('shows the marketing site for a legacy email-only session', async () => {
    sessionStorage.setItem('niyantranAuthed', '1');
    sessionStorage.setItem('niyantranUser', 'analyst@niyantran');
    expect(await renderApp()).toBe('MARKETING');
  });

  it('shows the marketing site when a user is stored without the flag', async () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org' });
    sessionStorage.removeItem('niyantranAuthed');
    expect(await renderApp()).toBe('MARKETING');
  });

  it('opens the terminal when the flag is set and a user is stored', async () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org', type: 'student' });
    expect(sessionStorage.getItem('niyantranAuthed')).toBe('1');
    expect(await renderApp()).toBe('TERMINAL');
  });
  // Accounts whose profile has no saved persona answered as Corporate Affairs
  // without ever being asked (plan C5). They choose once, at sign-in.
  it('asks an account with no saved persona to choose one', async () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org', personaSaved: false });
    expect(await renderApp()).toBe('CHOOSER');
  });

  it('opens the terminal directly for an account whose persona is saved, or unknown', async () => {
    setSessionUser({ id: 'uid-1', email: 'person@example.org', type: 'journalist', personaSaved: true });
    expect(await renderApp()).toBe('TERMINAL');
    setSessionUser({ id: 'uid-1', email: 'person@example.org', type: 'journalist' });
    expect(await renderApp()).toBe('TERMINAL');
  });
});

describe('free access while subscription metadata loads', () => {
  it('opens the terminal without waiting for the server plan', async () => {
    plan.loaded = false;
    setSessionUser({ id: 'uid-1', email: 'person@example.org', type: 'student', plan: 'max', planStatus: 'active' });
    const html = await renderApp();
    expect(html).toBe('TERMINAL');
  });
});

describe('entitlements for a missing user', () => {
  it('treats null as the free entitlement', () => {
    expect(entitlementOf(null)).toMatchObject({ plan: 'free', status: 'free' });
    expect(canExport(null)).toBe(false);
    expect(rowCapForUser(null)).toBe(null);
  });
});
