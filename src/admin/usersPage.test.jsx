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
  return { USER_TYPES: types.USER_TYPES, userTypeOf: types.userTypeOf, setUserActive: vi.fn(), setUserType: vi.fn(), setUserPlan: vi.fn() };
});
vi.mock('../lib/supabaseClient.js', () => ({ supabase: {} }));
vi.mock('../lib/refreshFeeds.js', () => ({
  cancelSweep: vi.fn(), decorateApis: vi.fn((rows) => rows), healStaleInactiveProbes: vi.fn(async () => {}),
  healStaticHostProbes: vi.fn(), refreshOne: vi.fn(), sweepApis: vi.fn(),
}));

vi.mock('./userCredits.js', async (original) => ({
  ...(await original()),
  adjustUserCredits: vi.fn(),
  newRequestId: vi.fn(() => 'new-request-id'),
}));

import { UsersPage } from './AdminPages.jsx';
import { setUserActive, setUserPlan, setUserType } from '../lib/userStore.js';
import { adjustUserCredits } from './userCredits.js';

const USERS = [
  { id: 'u-owner', name: 'Olu Owner', email: 'owner@example.test', type: 'analyst', plan: 'max', planStatus: 'active', planEnd: null, active: true, role: 'owner', creditBalance: 0, creditDebt: 0 },
  { id: 'u-alice', name: 'alice', email: 'alice@example.test', type: 'student', plan: 'pro', planStatus: 'active', planEnd: '2026-10-13T10:00:00Z', active: true, role: 'user', creditBalance: 1250.5, creditDebt: 0 },
  { id: 'u-bob', name: 'bob', email: 'bob@example.test', type: 'lawyer', plan: 'free', planStatus: 'free', planEnd: '2026-09-01T00:00:00Z', planLapsed: true, active: false, role: 'user', creditBalance: 0, creditDebt: 30.25 },
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
const stateButton = (row) => find(row, (n) => n.type === 'button' && String(n.props.className).includes('adm-state'));
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
    // Credits can be removed (F111); an account never can.
    expect(markup.replaceAll('Remove credits', '')).not.toContain('Remove');
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
    const button = stateButton(rowFor(t, 'alice@example.test'));
    await button.props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(setUserActive).toHaveBeenCalledWith('u-alice', false);
    expect(hooks.setters[setBusyId].mock.calls).toEqual([['u-alice'], [null]]);
    expect(hooks.setters[setErr].mock.calls).toEqual([['']]);
  });

  it('reactivates a suspended account', async () => {
    setUserActive.mockResolvedValue({ ok: true });
    const { tree: t, onChange } = tree();
    stateButton(rowFor(t, 'bob@example.test')).props.onClick();
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
    stateButton(rowFor(t, 'alice@example.test')).props.onClick();
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
    // Three buttons a row: set plan, apply credits, and suspend or restore.
    expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(USERS.length * 3);
    expect(markup).toContain('Saving…');
  });

  // F2: the admin grants or revokes a plan; the server records it as manual.
  it('grants the chosen plan until the end of the chosen day, India time', async () => {
    setUserPlan.mockResolvedValue({ ok: true });
    hooks.capture = true;
    hooks.presets = ['', null, { 'u-bob': { plan: 'max', end: '2026-12-31' } }];
    const onChange = vi.fn();
    const t = UsersPage({ users: USERS, onChange });
    find(rowFor(t, 'bob@example.test'), (n) => n.type === 'button' && String(n.props.className).includes('adm-plan-set')).props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(setUserPlan).toHaveBeenCalledWith('u-bob', 'max', '2026-12-31T23:59:59+05:30');
  });

  it('grants open-ended when no end date is chosen, and revokes with Free', async () => {
    setUserPlan.mockResolvedValue({ ok: true });
    hooks.capture = true;
    hooks.presets = ['', null, { 'u-bob': { plan: 'pro', end: '' }, 'u-alice': { plan: 'free', end: '2026-12-31' } }];
    const onChange = vi.fn();
    const t = UsersPage({ users: USERS, onChange });
    const set = (email) => find(rowFor(t, email), (n) => n.type === 'button' && String(n.props.className).includes('adm-plan-set'));
    set('bob@example.test').props.onClick();
    set('alice@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(setUserPlan).toHaveBeenCalledWith('u-bob', 'pro', null);
    expect(setUserPlan).toHaveBeenCalledWith('u-alice', 'free', null);
  });

  it('shows each plan as the server reports it', () => {
    const markup = renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }));
    expect(markup).toContain('Pro · to 13 Oct 2026');
    expect(markup).toContain('Free · lapsed 1 Sept 2026');
    expect(markup).toContain('Max · open-ended');
    expect(markup).not.toMatch(/trial|Explorer|Enterprise|Professional/);
  });
});

// F111 task 6: each user's credit balance, and the admin's credit adjustment.
describe('UsersPage credits', () => {
  const [setErr, setBusyId, , setCreditDrafts, setCreditNote] = [0, 1, 2, 3, 4];
  const applyButton = (tree, email) => find(rowFor(tree, email), (n) => n.type === 'button' && String(n.props.className).includes('admin-credits-apply'));
  const fieldByLabel = (tree, email, label) => find(rowFor(tree, email), (n) => String(n.props?.['aria-label'] || '').startsWith(`${label} for ${email}`));
  const renderWith = (drafts, onChange = vi.fn()) => {
    hooks.capture = true;
    hooks.presets = ['', null, {}, drafts, ''];
    return { tree: UsersPage({ users: USERS, onChange }), onChange };
  };

  it('shows each balance, and the debt only when there is one', () => {
    const markup = renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }));
    expect(markup).toContain('<th>Credits</th>');
    const row = (email, next) => markup.slice(markup.indexOf(email), next ? markup.indexOf(next) : undefined);
    expect(row('alice@example.test', 'bob@example.test')).toContain('1,250.5');
    expect(row('alice@example.test', 'bob@example.test')).not.toMatch(/Owes|debt/i);
    expect(row('bob@example.test')).toMatch(/Owes 30\.25/);
    expect(markup).not.toMatch(/\$|USD|dollar|₹|rupee/i);
  });

  it('says the balances are as of each user\'s last activity, because they update when the user next uses AI (review R, M5)', () => {
    const markup = renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }));
    expect(markup).toContain('as of their last activity');
    expect(markup).toContain('when they next use AI');
    expect(markup).toContain('class="admin-credits-balance" title="As of the last activity of this user, until they next use AI"');
  });

  it('shows a dash, never zero, when the balance could not be read', () => {
    const unknown = [{ ...USERS[1], creditBalance: null, creditDebt: null }];
    const markup = renderToStaticMarkup(createElement(UsersPage, { users: unknown, onChange: () => {} }));
    expect(markup).toContain('—');
    expect(markup).not.toMatch(/Owes/);
  });

  it('labels every credit control and offers the three actions', () => {
    const markup = renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }));
    for (const label of ['Credit action for alice@example.test', 'Credit amount for alice@example.test', 'Credit reason for alice@example.test']) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    expect(markup).toContain('Add credits');
    expect(markup).toContain('Remove credits');
    expect(markup).toContain('Grant top-up');
    expect(markup).toMatch(/<input[^>]*type="number"[^>]*aria-label="Credit amount for alice@example.test"|<input[^>]*aria-label="Credit amount for alice@example.test"[^>]*type="number"/);
    expect(markup).toMatch(/<input[^>]*maxLength="500"|<input[^>]*maxlength="500"/i);
  });

  it('disables the credit controls on owner rows', () => {
    const markup = renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }));
    const ownerRow = markup.slice(markup.indexOf('owner@example.test'), markup.indexOf('alice@example.test'));
    for (const label of ['Credit action', 'Credit amount', 'Credit reason']) {
      expect(ownerRow).toMatch(new RegExp(`<(?:select|input)[^>]*aria-label="${label} for owner@example.test"[^>]*disabled=""|<(?:select|input)[^>]*disabled=""[^>]*aria-label="${label} for owner@example.test"`));
    }
    expect(ownerRow).toMatch(/<button[^>]*admin-credits-apply[^>]*disabled=""|<button[^>]*disabled=""[^>]*admin-credits-apply/);
  });

  it('removes credits as a negative adjustment with the reason, then refreshes and says the new balance', async () => {
    adjustUserCredits.mockResolvedValue({ ok: true, repeated: false, balance: 1225.5 });
    const { tree, onChange } = renderWith({ 'u-alice': { kind: 'remove', amount: '25', reason: ' Duplicate charge ', requestId: null } });
    applyButton(tree, 'alice@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(adjustUserCredits).toHaveBeenCalledWith('u-alice', { credits: -25, kind: 'adjustment', reason: 'Duplicate charge' }, 'new-request-id');
    expect(hooks.setters[setBusyId].mock.calls).toEqual([['u-alice'], [null]]);
    expect(hooks.setters[setErr].mock.calls).toEqual([['']]);
    expect(hooks.setters[setCreditNote].mock.calls.at(-1)[0]).toMatch(/alice@example\.test.*1,225\.5/);
    // The form is cleared once the credits are applied.
    const cleared = hooks.setters[setCreditDrafts].mock.calls.at(-1)[0]({ 'u-alice': { kind: 'remove', amount: '25', reason: 'x', requestId: 'new-request-id' }, 'u-bob': { kind: 'add', amount: '1', reason: 'y', requestId: null } });
    expect(cleared['u-alice']).toBeUndefined();
    expect(cleared['u-bob']).toBeDefined();
  });

  it('adds credits and grants top-ups', async () => {
    adjustUserCredits.mockResolvedValue({ ok: true, repeated: false, balance: 5 });
    const { tree, onChange } = renderWith({
      'u-alice': { kind: 'add', amount: '100.5', reason: 'Goodwill', requestId: null },
      'u-bob': { kind: 'topup', amount: '2000', reason: 'Paid by invoice', requestId: null },
    });
    applyButton(tree, 'alice@example.test').props.onClick();
    applyButton(tree, 'bob@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(adjustUserCredits).toHaveBeenCalledWith('u-alice', { credits: 100.5, kind: 'adjustment', reason: 'Goodwill' }, 'new-request-id');
    expect(adjustUserCredits).toHaveBeenCalledWith('u-bob', { credits: 2000, kind: 'topup', reason: 'Paid by invoice' }, 'new-request-id');
  });

  it('keeps the request id of an adjustment across a retry, so it cannot apply twice', async () => {
    adjustUserCredits.mockResolvedValue({ ok: false, reason: 'The adjustment could not be sent.' });
    const { tree, onChange } = renderWith({ 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: 'earlier-attempt' } });
    applyButton(tree, 'alice@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(adjustUserCredits).toHaveBeenCalledWith('u-alice', expect.any(Object), 'earlier-attempt');
    // The failed attempt leaves the form, with its id, for the next try.
    const calls = hooks.setters[setCreditDrafts].mock.calls.map(([update]) => update({ 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: 'earlier-attempt' } }));
    for (const next of calls) expect(next['u-alice']).toMatchObject({ amount: '10', requestId: 'earlier-attempt' });
  });

  it('remembers a new request id before sending, so a failed send can be retried as the same request', async () => {
    adjustUserCredits.mockResolvedValue({ ok: false, reason: 'The adjustment could not be sent.' });
    const { tree, onChange } = renderWith({ 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: null } });
    applyButton(tree, 'alice@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const first = hooks.setters[setCreditDrafts].mock.calls[0][0]({ 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: null } });
    expect(first['u-alice'].requestId).toBe('new-request-id');
  });

  it('starts a new request when the amount, action or reason is edited', () => {
    const drafts = { 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: 'earlier-attempt' } };
    const { tree } = renderWith(drafts);
    for (const [label, value] of [['Credit amount', '11'], ['Credit reason', 'Other'], ['Credit action', 'topup']]) {
      hooks.setters[setCreditDrafts].mockClear();
      fieldByLabel(tree, 'alice@example.test', label).props.onChange({ target: { value } });
      const next = hooks.setters[setCreditDrafts].mock.calls[0][0](drafts);
      expect(next['u-alice'].requestId).toBeNull();
    }
  });

  it.each([
    ['no amount', { kind: 'add', amount: '', reason: 'Goodwill' }, /amount/i],
    ['zero', { kind: 'add', amount: '0', reason: 'Goodwill' }, /above zero/i],
    ['a minus sign', { kind: 'add', amount: '-5', reason: 'Goodwill' }, /minus/i],
    ['no reason', { kind: 'add', amount: '5', reason: '  ' }, /reason/i],
  ])('refuses %s plainly, without asking the server', (_label, draft, message) => {
    const { tree, onChange } = renderWith({ 'u-alice': { ...draft, requestId: null } });
    applyButton(tree, 'alice@example.test').props.onClick();
    expect(adjustUserCredits).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(hooks.setters[setErr].mock.calls.at(-1)[0]).toMatch(message);
    expect(hooks.setters[setBusyId]).not.toHaveBeenCalled();
  });

  it('shows the reason when the server refuses, and does not claim success', async () => {
    adjustUserCredits.mockResolvedValue({ ok: false, reason: 'Owner accounts cannot be changed here' });
    const { tree, onChange } = renderWith({ 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: null } });
    applyButton(tree, 'alice@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(hooks.setters[setErr].mock.calls.at(-1)).toEqual(['Owner accounts cannot be changed here']);
    expect(hooks.setters[setCreditNote].mock.calls.every(([note]) => note === '')).toBe(true);
  });

  it('says so when the adjustment had already been applied', async () => {
    adjustUserCredits.mockResolvedValue({ ok: true, repeated: true, balance: 77 });
    const { tree, onChange } = renderWith({ 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: 'earlier-attempt' } });
    applyButton(tree, 'alice@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(hooks.setters[setCreditNote].mock.calls.at(-1)[0]).toMatch(/already applied.*77/i);
  });

  it('renders the result as a status message, and no status otherwise', () => {
    hooks.capture = true;
    hooks.presets = ['', null, {}, {}, 'Removed 25 credits from alice@example.test. Balance 1,225.5.'];
    const done = renderToStaticMarkup(UsersPage({ users: USERS, onChange: () => {} }));
    expect(done).toMatch(/<p class="adm-msg" role="status">Removed 25 credits from alice@example\.test\. Balance 1,225\.5\.<\/p>/);
    hooks.presets = ['', null, {}, {}, ''];
    expect(renderToStaticMarkup(UsersPage({ users: USERS, onChange: () => {} }))).not.toContain('role="status"');
  });

  it('clears an old result when another change starts', async () => {
    setUserActive.mockResolvedValue({ ok: true });
    hooks.capture = true;
    const onChange = vi.fn();
    const t = UsersPage({ users: USERS, onChange });
    stateButton(rowFor(t, 'alice@example.test')).props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(hooks.setters[setCreditNote].mock.calls).toEqual([['']]);
  });

  it('shows no dollar or rupee figure anywhere on the page', () => {
    const markup = renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }));
    expect(markup).not.toMatch(/\$|USD|dollar|₹|rupee|INR/i);
  });
});
