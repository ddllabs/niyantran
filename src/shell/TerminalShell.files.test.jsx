// F418: TerminalShell with REAL effects and state (hookHarness.js) over a fake browser: "Ask AI" from the file manager
// (the niy-ai-open event) closes the file manager, so the AI panel it opened underneath is seen, and puts the desk's
// address back without a hashchange (a hashchange would clear the selection the panel was opened with).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from './fakeBrowser.js';
import { elements, harness } from './hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/userStore.js', () => ({ sessionUser: () => ({ id: 'u1', type: 'policy', active: true }), userTypeOf: () => ({ id: 'policy', startTab: 'national' }), clearSessionUser: vi.fn() }));
const panelAct = vi.hoisted(() => vi.fn());
vi.mock('./SidePanel.jsx', () => ({ default: () => null, useSidePanel: () => ({ collapsed: false, aiOpen: false, act: panelAct }) }));
vi.mock('../desks/DeskView.jsx', () => ({ default: () => null }));
vi.mock('../desks/DeskLandingView.jsx', () => ({ default: () => null }));
vi.mock('../desks/HomeDesk.jsx', () => ({ default: () => null }));
vi.mock('./OnboardingTour.jsx', () => ({ default: () => null }));
vi.mock('./CommandSearch.jsx', () => ({ default: () => null }));
vi.mock('./LiveTvPage.jsx', () => ({ default: () => null }));
vi.mock('../fileManager/FileManagerShell.jsx', () => ({ default: () => null }));
vi.mock('../lib/userPrefsSync.js', () => ({ startUserPrefsSync: vi.fn(), hydrateUserPrefs: vi.fn(async () => {}) }));
vi.mock('../lib/entitlementStore.js', async (importOriginal) => ({ ...(await importOriginal()), refreshEntitlement: vi.fn(), watchEntitlementTransitions: vi.fn(() => () => {}) }));
vi.mock('../lib/homeCache.js', () => ({ kickHomeRefreshIfDue: vi.fn() }));
vi.mock('../lib/siteHead.js', () => ({ setPageTitle: vi.fn() }));

const { default: TerminalShell } = await import('./TerminalShell.jsx');

let b;
function install(hash) {
  b = fakeBrowser(hash);
  const doc = fakeBrowser();
  doc.documentElement = { lang: 'en', setAttribute() {}, removeAttribute() {}, getAttribute: () => null };
  doc.querySelector = () => null;
  vi.stubGlobal('window', b);
  vi.stubGlobal('location', b.location);
  vi.stubGlobal('history', b.history);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
}
const shell = () => harness.render(TerminalShell, { onLogout() {} });
const filesOpen = (tree) => [...elements(tree)].some((e) => e.props?.className === 'files-workbench-overlay');

beforeEach(() => { harness.reset(); });
afterEach(() => { harness.unmount(); vi.unstubAllGlobals(); });

describe('Ask AI from the file manager', () => {
  it('starts with the file manager open at #/files', () => {
    install('#/files');
    expect(filesOpen(shell())).toBe(true);
  });

  it('closes the file manager on niy-ai-open and writes the desk address with replaceState, not a hashchange', () => {
    install('#/files');
    shell();
    let hashchanges = 0;
    b.addEventListener('hashchange', () => { hashchanges += 1; });
    b.dispatchEvent({ type: 'niy-ai-open', detail: { focus: 'attached', file: { id: 'f1', name: 'a.pdf' } } });
    const tree = shell();
    expect(filesOpen(tree)).toBe(false);
    expect(b.location.hash).not.toBe('#/files');
    expect(b.replaced.length).toBeGreaterThan(0);
    expect(hashchanges).toBe(0);
  });

  it('leaves the address alone when the file manager was not open', () => {
    install('#/national');
    shell();
    const before = b.location.hash;
    b.dispatchEvent({ type: 'niy-ai-open', detail: { prompt: 'x' } });
    expect(filesOpen(shell())).toBe(false);
    expect(b.location.hash).toBe(before);
  });
});
