import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ states: [], index: 0, effects: [] }));
vi.mock('react', async (original) => ({
  ...await original(),
  useState(initial) {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.states[index], (value) => { hooks.states[index] = typeof value === 'function' ? value(hooks.states[index]) : value; }];
  },
  useRef: (value) => ({ current: value }),
  useMemo: (fn) => fn(),
  useEffect: (fn) => { hooks.effects.push(fn); },
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: {} } }));
vi.mock('../admin/adminSession.js', () => ({ createAdminSession: (_client, notify) => ({ refresh: () => notify({ status: 'verified', user: { id: 'fixture' } }), dispose() {} }) }));
vi.mock('../lib/userStore.js', () => ({ hydrateUsersFromServer: async () => [], loadUsers: () => [], userTypeOf: () => ({ id: 'student' }), setSessionUser() {} }));
import GoogleSignInButton from './GoogleSignInButton.jsx';
import SignupPage from './SignupPage.jsx';
import SegmentCarousel from './SegmentCarousel.jsx';
import { AiPersonasPage } from '../admin/AiPersonasPage.jsx';
import AdminApp from '../admin/AdminApp.jsx';

function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function render(Component) { hooks.index = 0; hooks.effects = []; return Component({}); }
const role = (tree, name) => nodes(tree, (node) => node.props?.role === name);
function key(node, name, siblings) {
  const focused = [];
  const targets = siblings.map((sibling, index) => ({ focus: () => focused.push(index), disabled: sibling.props.disabled }));
  const preventDefault = vi.fn();
  node.props.onKeyDown?.({ key: name, preventDefault, currentTarget: { parentElement: { querySelectorAll: () => targets } } });
  return { focused, preventDefault };
}
beforeEach(() => {
  hooks.states = []; hooks.index = 0; hooks.effects = [];
  vi.stubGlobal('location', { hash: '' });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('F60 marketing and admin controls', () => {
  it('verification email text contrasts with its actual input background', () => {
    render(SignupPage); hooks.states[6] = 'offline@example.test';
    const input = nodes(render(SignupPage), node => node.type === 'input')[0];
    const luminance = hex => {
      const [r,g,b] = hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255)
        .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return .2126*r+.7152*g+.0722*b;
    };
    const foreground = luminance(input.props.style.color);
    const background = luminance(input.props.style.background);
    expect((Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)).toBeGreaterThanOrEqual(4.5);
  });
  it('recovery and verification copy uses readable light-card colors', () => {
    for (const name of ['ForgotPasswordPage', 'ResetPasswordPage', 'SignupPage']) {
      const source = readFileSync(new URL(`./${name}.jsx`, import.meta.url), 'utf8');
      const colors = [...source.matchAll(/color: '(#[0-9a-f]{6})'/g)].map((match) => match[1]).filter((color) => color !== '#ffffff');
      for (const color of colors) {
        const channels = color.slice(1).match(/../g).map((hex) => parseInt(hex, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        expect(1.05 / (luminance + 0.05), `${name} ${color} on the light card`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('names the Google button even though its visual facade is hidden', () => {
    const button = nodes(render(GoogleSignInButton), (node) => node.type === 'button')[0];
    expect(button.props['aria-label']).toBe('Sign in with Google');
  });
  it('coverage navigation has a real destination on the home page', () => {
    expect(render(SegmentCarousel).props.id).toBe('coverage');
  });
  it('persona radios have one tab stop and arrows select and focus with wrapping', () => {
    let radios = role(render(SignupPage), 'radio');
    expect(radios.map((r) => r.props.tabIndex)).toEqual([0, ...radios.slice(1).map(() => -1)]);
    expect(key(radios[0], 'ArrowLeft', radios).focused).toEqual([radios.length - 1]);
    radios = role(render(SignupPage), 'radio');
    expect(radios.at(-1).props['aria-checked']).toBe(true);
    expect(key(radios.at(-1), 'Home', radios).focused).toEqual([0]);
  });
  it('plan radios support arrow selection without submitting or entering the terminal', () => {
    render(SignupPage); hooks.states[0] = 'plan';
    let radios = role(render(SignupPage), 'radio');
    expect(radios.filter((r) => r.props.tabIndex === 0)).toHaveLength(1);
    expect(key(radios[0], 'ArrowRight', radios).focused).toEqual([1]);
    radios = role(render(SignupPage), 'radio');
    expect(radios[1].props['aria-checked']).toBe(true);
  });
  it('persona tabs have roving focus and select their labelled panel with End', () => {
    let tree = render(AiPersonasPage);
    const tabs = role(tree, 'tab');
    expect(tabs.filter((tab) => tab.props.tabIndex === 0)).toHaveLength(1);
    expect(key(tabs[0], 'End', tabs).focused).toEqual([tabs.length - 1]);
    tree = render(AiPersonasPage);
    const selected = role(tree, 'tab').at(-1);
    expect(selected.props['aria-selected']).toBe(true);
    expect(role(tree, 'tabpanel')[0].props['aria-labelledby']).toBe(selected.props.id);
  });
  it('keyboard focus pauses autoplay even when the pointer leaves, until focus exits', () => {
    vi.useFakeTimers();
    let tree = render(SegmentCarousel);
    tree.props.onFocus?.();
    tree.props.onMouseLeave();
    tree = render(SegmentCarousel);
    const cleanup = hooks.effects.at(-1)();
    vi.advanceTimersByTime(12000);
    expect(hooks.states[1]).toBe(0);
    cleanup?.();
    tree.props.onBlur?.({ currentTarget: { contains: () => false }, relatedTarget: null });
    render(SegmentCarousel); const stop = hooks.effects.at(-1)();
    vi.advanceTimersByTime(6000);
    expect(hooks.states[1]).toBe(1); stop?.();
  });
  it('closed mobile admin navigation is inert and hidden from accessibility', () => {
    render(AdminApp); hooks.effects[1]();
    const aside = nodes(render(AdminApp), (node) => node.type === 'aside')[0];
    expect(aside.props.inert).toBe(true);
    expect(aside.props['aria-hidden']).toBe(true);
    const menu = nodes(render(AdminApp), (node) => node.props?.className === 'adm-menu-btn')[0];
    menu.props.onClick();
    const open = nodes(render(AdminApp), (node) => node.type === 'aside')[0];
    expect(open.props.inert).toBe(false);
    expect(open.props['aria-hidden']).toBeUndefined();
  });
});
