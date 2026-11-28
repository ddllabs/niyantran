import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ states: [], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...(await original()),
  useState: (initial) => {
    const index = fake.cursor++;
    if (!(index in fake.states)) fake.states[index] = typeof initial === 'function' ? initial() : initial;
    return [
      fake.states[index],
      (value) => {
        fake.states[index] = typeof value === 'function' ? value(fake.states[index]) : value;
      },
    ];
  },
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init }),
  useEffect: (fn, deps) => {
    if (!deps || deps.some((d) => Boolean(d))) fn();
  },
}));

vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: {} } }));
vi.mock('../lib/siteSettings.js', () => ({
  SITE_SETTINGS: { faviconUrl: '/favicon.ico', siteName: 'NTER', shortName: 'TERMINAL', metaTitle: '' },
  loadSiteSettings: () => ({ faviconUrl: '/favicon.ico', siteName: 'NTER', shortName: 'TERMINAL', metaTitle: '' }),
}));
vi.mock('../lib/siteHead.js', () => ({ setPageTitle: vi.fn() }));
vi.mock('../lib/userStore.js', () => ({ sessionUser: () => null }));
vi.mock('./HomePage.jsx', () => ({ default: () => null }));

import MarketingSite from './MarketingSite.jsx';

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

function render() {
  fake.cursor = 0;
  return MarketingSite({ onAuthed: vi.fn() });
}

describe('mobile hamburger menu interactions', () => {
  beforeEach(() => {
    fake.states = [];
    fake.cursor = 0;
    vi.stubGlobal('location', { pathname: '/', hash: '#/', replace: vi.fn() });
    vi.stubGlobal('window', {
      scrollTo: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
      documentElement: { classList: { add: vi.fn(), remove: vi.fn() } },
      body: { classList: { add: vi.fn(), remove: vi.fn() } },
      getElementById: vi.fn(),
    });
  });

  it('toggles menu, shows backdrop scrim, and dismisses on scrim click', () => {
    let tree = render();

    const menuBtn = find(tree, (n) => n.props?.className === 'mkt-menu-btn');
    expect(menuBtn).not.toBeNull();
    expect(menuBtn.props['aria-expanded']).toBe(false);
    expect(menuBtn.props['aria-label']).toBe('Menu');

    // Scrim is not present initially
    const initialScrim = find(tree, (n) => n.props?.className === 'mkt-nav-scrim');
    expect(initialScrim).toBeNull();

    // 1. Click menu button to open
    menuBtn.props.onClick();
    tree = render();

    const openBtn = find(tree, (n) => n.props?.className === 'mkt-menu-btn');
    expect(openBtn.props['aria-expanded']).toBe(true);

    const navLinks = find(tree, (n) => typeof n.props?.className === 'string' && n.props.className.includes('mkt-nav-links'));
    expect(navLinks.props.className).toContain('open');

    // Backdrop scrim is present
    const scrim = find(tree, (n) => n.props?.className === 'mkt-nav-scrim');
    expect(scrim).not.toBeNull();

    // 2. Click backdrop scrim to dismiss
    scrim.props.onClick();
    tree = render();

    const closedBtn = find(tree, (n) => n.props?.className === 'mkt-menu-btn');
    expect(closedBtn.props['aria-expanded']).toBe(false);
    const closedNav = find(tree, (n) => typeof n.props?.className === 'string' && n.props.className.includes('mkt-nav-links'));
    expect(closedNav.props.className).not.toContain('open');
    expect(find(tree, (n) => n.props?.className === 'mkt-nav-scrim')).toBeNull();
  });

  it('closes menu when a navigation item is clicked', () => {
    let tree = render();
    // Open menu
    find(tree, (n) => n.props?.className === 'mkt-menu-btn').props.onClick();
    tree = render();

    expect(find(tree, (n) => n.props?.className === 'mkt-menu-btn').props['aria-expanded']).toBe(true);

    // Click Pricing link
    const pricingLink = find(tree, (n) => n.props?.children === 'Pricing');
    expect(pricingLink).not.toBeNull();
    pricingLink.props.onClick();

    tree = render();
    // Menu should be closed
    expect(find(tree, (n) => n.props?.className === 'mkt-menu-btn').props['aria-expanded']).toBe(false);
    expect(find(tree, (n) => n.props?.className === 'mkt-nav-scrim')).toBeNull();
  });

  it('dismisses menu on Escape key press', () => {
    let tree = render();
    // Open menu
    find(tree, (n) => n.props?.className === 'mkt-menu-btn').props.onClick();
    tree = render();
    expect(find(tree, (n) => n.props?.className === 'mkt-menu-btn').props['aria-expanded']).toBe(true);

    // Find registered keydown handler
    const keydownHandler = window.addEventListener.mock.calls.find((call) => call[0] === 'keydown')?.[1];
    expect(keydownHandler).toBeDefined();

    // Trigger Escape
    keydownHandler({ key: 'Escape' });
    tree = render();

    expect(find(tree, (n) => n.props?.className === 'mkt-menu-btn').props['aria-expanded']).toBe(false);
    expect(find(tree, (n) => n.props?.className === 'mkt-nav-scrim')).toBeNull();
  });
});
