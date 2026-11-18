// F359: TerminalShell with REAL effects and state (hookHarness.js) over a fake browser: Live TV is open
// exactly while the address names it, and nothing but the address closes it. LiveTvPage is replaced by a
// recorder of its `open` prop.
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
vi.mock('../lib/userPrefsSync.js', () => ({ startUserPrefsSync: vi.fn(), hydrateUserPrefs: vi.fn(async () => {}) }));
vi.mock('../lib/entitlementStore.js', async (importOriginal) => ({ ...(await importOriginal()), refreshEntitlement: vi.fn(), watchEntitlementTransitions: vi.fn(() => () => {}) }));
vi.mock('../lib/homeCache.js', () => ({ kickHomeRefreshIfDue: vi.fn() }));
vi.mock('../lib/siteHead.js', () => ({ setPageTitle: vi.fn() }));

const { default: TerminalShell } = await import('./TerminalShell.jsx');
const { DeskLandingTabs } = await import('./DeskDirectory.jsx');
const { default: ProfileCredits } = await import('./credits/BalancePill.jsx');

let b;
function install(hash) {
  b = fakeBrowser(hash);
  const doc = fakeBrowser(); // the document: its own listeners
  doc.documentElement = { lang: 'en', setAttribute() {}, removeAttribute() {}, getAttribute: () => null };
  doc.querySelector = () => null;
  vi.stubGlobal('window', b);
  vi.stubGlobal('location', b.location);
  vi.stubGlobal('history', b.history);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  return doc;
}
const shell = () => harness.render(TerminalShell, { onLogout() {} });
const pageOpen = (tree) => [...elements(tree)].find((e) => e.props && 'onNavigateDesk' in e.props)?.props.open;
const tabs = (tree) => [...elements(tree)].find((e) => e.type === DeskLandingTabs)?.props;

beforeEach(() => { harness.reset(); });
afterEach(() => { harness.unmount(); vi.unstubAllGlobals(); });

describe('Live TV is open exactly while the address names it', () => {
  it('starts open at #/livetv', () => {
    install('#/livetv');
    expect(pageOpen(shell())).toBe(true);
  });

  it('closes when a desk tab is used: that path writes the address with pushState and fires no hashchange', () => {
    install('#/livetv');
    let tree = shell();
    tabs(tree).onDesk('law');
    tree = shell();
    expect(b.pushed).toHaveLength(1);
    expect(b.location.hash).toMatch(/law/i);
    expect(pageOpen(tree)).toBe(false);
  });

  it('opens from the nter:open-livetv event and closes on a hashchange to a desk', () => {
    install('#/national');
    let tree = shell();
    expect(pageOpen(tree)).toBeUndefined(); // not visited yet: nothing mounted
    b.dispatchEvent({ type: 'nter:open-livetv' });
    tree = shell();
    expect(pageOpen(tree)).toBe(true);
    b.location.hash = '#/economics';
    expect(pageOpen(shell())).toBe(false);
  });

  it('stays open on Escape and on a mousedown anywhere', () => {
    const doc = install('#/livetv');
    shell();
    for (const target of [b, doc]) {
      target.dispatchEvent({ type: 'keydown', key: 'Escape' });
      target.dispatchEvent({ type: 'mousedown', target: { closest: () => null } });
    }
    expect(pageOpen(shell())).toBe(true);
  });

  it('stays open when the profile menu is opened', () => {
    install('#/livetv');
    let tree = shell();
    const profile = [...elements(tree)].find((e) => e.type === ProfileCredits).props;
    profile.onToggle?.();
    profile.setOpen(true);
    tree = shell();
    expect([...elements(tree)].find((e) => e.type === ProfileCredits).props.open).toBe(true);
    expect(pageOpen(tree)).toBe(true);
  });
});
