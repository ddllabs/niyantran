// Admin users screen: no account creation or password entry, suspend and
// reactivate instead of remove, and every refused action shown to the admin.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ setters: [], presets: [] }));
vi.mock('react', async (original) => {
  const actual = await original();
  return {
    ...actual,
    useState: (value) => {
      if (!hooks.capture) return actual.useState(value);
      const setter = vi.fn();
      hooks.setters.push(setter);
      if (hooks.presets.length) return [hooks.presets.shift(), setter];
      return [typeof value === 'function' ? value() : value, setter];
    },
  };
});
vi.mock('../lib/userStore.js', async () => {
  const types = await vi.importActual('../lib/userTypes.js');
  return { USER_TYPES: types.USER_TYPES, userTypeOf: types.userTypeOf, setUserActive: vi.fn(), setUserType: vi.fn() };
});
vi.mock('../lib/supabaseClient.js', () => ({ supabase: {} }));
vi.mock('../lib/refreshFeeds.js', () => ({
  cancelSweep: vi.fn(), decorateApis: vi.fn((rows) => rows), healStaleInactiveProbes: vi.fn(async () => {}),
  healStaticHostProbes: vi.fn(), refreshOne: vi.fn(), sweepApis: vi.fn(),
}));
vi.mock('../lib/appFlagsStore.js', () => ({
  hydrateAppFlags: vi.fn(async () => ({})), isTestingPhase: () => false, loadAppFlags: () => ({}),
  saveAppFlags: vi.fn(), subscribeAppFlags: () => () => {},
}));

import { UsersPage } from './AdminPages.jsx';
import { setUserActive, setUserType } from '../lib/userStore.js';

const USERS = [
  { id: 'u-owner', name: 'Olu Owner', email: 'owner@example.test', type: 'analyst', plan: 'enterprise', active: true, role: 'owner' },
  { id: 'u-alice', name: 'alice', email: 'alice@example.test', type: 'student', plan: 'pro', active: true, role: 'user' },
  { id: 'u-bob', name: 'bob', email: 'bob@example.test', type: 'lawyer', plan: 'explorer', active: false, role: 'user' },
];

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = find(child, predicate); if (hit) return hit; }
    return null;
  }
  if (predicate(node)) return node;
  const { children } = node.props || {};
  if (typeof node.type === 'function') return find(node.type(node.props), predicate);
  return find(children, predicate);
}
const rowFor = (tree, email) => find(tree, (n) => n.type === 'tr' && n.key === USERS.find((u) => u.email === email).id);

beforeEach(() => {
  vi.clearAllMocks();
  hooks.capture = false;
  hooks.setters = [];
  hooks.presets = [];
});

describe('UsersPage markup', () => {
  const html = () => renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }));

  it('has no account creation form and no password field', () => {
    const markup = html();
    expect(markup).not.toMatch(/password"|name="password"|type="password"/i);
    expect(markup).not.toContain('Create user');
    expect(markup).not.toContain('<form');
    expect(markup).toContain('Accounts are created only through sign-up');
    expect(markup).toContain('cannot create accounts or set passwords');
  });

  it('offers suspend or restore, never remove', () => {
    const markup = html();
    expect(markup).not.toContain('Remove');
    expect(markup).toContain('Suspend');
    expect(markup).toContain('Restore');
  });

  it('disables every control on owner rows', () => {
    const markup = html();
    const ownerRow = markup.slice(markup.indexOf('owner@example.test'), markup.indexOf('alice@example.test'));
    expect(ownerRow).toMatch(/<select[^>]*disabled=""/);
    expect(ownerRow).toMatch(/<button[^>]*disabled=""/);
  });
});

describe('UsersPage actions', () => {
  function tree(onChange = vi.fn()) {
    hooks.capture = true;
    return { tree: UsersPage({ users: USERS, onChange }), onChange };
  }
  const [setErr, setBusyId] = [0, 1];

  it('suspends through setUserActive, then refreshes', async () => {
    setUserActive.mockResolvedValue({ ok: true });
    const { tree: t, onChange } = tree();
    const button = find(rowFor(t, 'alice@example.test'), (n) => n.type === 'button');
    await button.props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(setUserActive).toHaveBeenCalledWith('u-alice', false);
    expect(hooks.setters[setBusyId].mock.calls).toEqual([['u-alice'], [null]]);
    expect(hooks.setters[setErr].mock.calls).toEqual([['']]);
  });

  it('reactivates a suspended account', async () => {
    setUserActive.mockResolvedValue({ ok: true });
    const { tree: t, onChange } = tree();
    find(rowFor(t, 'bob@example.test'), (n) => n.type === 'button').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(setUserActive).toHaveBeenCalledWith('u-bob', true);
  });

  it('changes type through setUserType', async () => {
    setUserType.mockResolvedValue({ ok: true });
    const { tree: t, onChange } = tree();
    find(rowFor(t, 'alice@example.test'), (n) => n.type === 'select').props.onChange({ target: { value: 'journalist' } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(setUserType).toHaveBeenCalledWith('u-alice', 'journalist');
  });

  it('shows the reason when an action is refused', async () => {
    setUserActive.mockResolvedValue({ ok: false, reason: 'You cannot suspend or reactivate your own account' });
    const { tree: t, onChange } = tree();
    find(rowFor(t, 'alice@example.test'), (n) => n.type === 'button').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(hooks.setters[setErr].mock.calls.at(-1)).toEqual(['You cannot suspend or reactivate your own account']);
  });

  it('renders a stored error as an alert, and none otherwise', () => {
    hooks.capture = true;
    hooks.presets = ['Owner accounts cannot be changed here', null];
    const refused = renderToStaticMarkup(UsersPage({ users: USERS, onChange: () => {} }));
    expect(refused).toMatch(/<p class="adm-msg err" role="alert">Owner accounts cannot be changed here<\/p>/);
    hooks.presets = ['', null];
    expect(renderToStaticMarkup(UsersPage({ users: USERS, onChange: () => {} }))).not.toContain('role="alert"');
  });

  it('disables every action while one is saving', () => {
    hooks.capture = true;
    hooks.presets = ['', 'u-alice'];
    const markup = renderToStaticMarkup(UsersPage({ users: USERS, onChange: () => {} }));
    expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(USERS.length);
    expect(markup).toContain('Saving…');
  });
});
