// Admin users screen: no account creation or password entry, suspend and
// reactivate instead of remove, and every refused action shown to the admin.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ setters: [], presets: [], initials: [] }));
vi.mock('react', async (original) => {
  const actual = await original();
  return {
    ...actual,
    useState: (value) => {
      if (!hooks.capture) return actual.useState(value);
      const setter = vi.fn();
      hooks.setters.push(setter);
      hooks.initials.push(typeof value === 'function' ? value() : value);
      if (hooks.presets.length) return [hooks.presets.shift(), setter];
      return [typeof value === 'function' ? value() : value, setter];
    },
    // The page is called as a plain function here, outside a render: a ref is a bare box and an effect never runs.
    useRef: (value) => (hooks.capture ? { current: value } : actual.useRef(value)),
    useEffect: (...args) => (hooks.capture ? undefined : actual.useEffect(...args)),
  };
});
vi.mock('../lib/userStore.js', async () => {
  const types = await vi.importActual('../lib/userTypes.js');
  return {
    USER_TYPES: types.USER_TYPES,
    userTypeOf: types.userTypeOf,
    setUserActive: vi.fn(),
    setUserType: vi.fn(),
    setUserPlan: vi.fn(),
    loadUsersPage: vi.fn(async () => ({ ok: true })),
    usersPaging: vi.fn(() => ({ page: 1, pageSize: 100, total: 3, query: '' })),
  };
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

import { OverviewPage, UsersPage } from './AdminPages.jsx';
import { loadUsersPage, setUserActive, setUserPlan, setUserType, usersPaging } from '../lib/userStore.js';
import { adjustUserCredits } from './userCredits.js';

const USERS = [
  { id: 'u-owner', name: 'Olu Owner', email: 'owner@example.test', type: 'analyst', plan: 'max', planStatus: 'active', planEnd: null, active: true, role: 'owner', creditBalance: 0, creditDebt: 0, creditUnitVersion: 'credit-paise-v2' },
  { id: 'u-alice', name: 'alice', email: 'alice@example.test', type: 'student', plan: 'pro', planStatus: 'active', planEnd: '2026-10-13T10:00:00Z', active: true, role: 'user', creditBalance: 1250.5, creditDebt: 0, creditUnitVersion: 'credit-paise-v2' },
  { id: 'u-bob', name: 'bob', email: 'bob@example.test', type: 'lawyer', plan: 'free', planStatus: 'free', planEnd: '2026-09-01T00:00:00Z', planLapsed: true, active: false, role: 'user', creditBalance: 0, creditDebt: 30.25, creditUnitVersion: 'credit-paise-v2' },
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
  hooks.initials = [];
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
    // The page on screen is refreshed by the store; the page is not asked for again from the first.
    expect(loadUsersPage).not.toHaveBeenCalled();
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
    // Three buttons a row: set plan, apply credits, and suspend or restore. The two page buttons
    // are disabled as well (one page here, and an action is saving).
    expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(USERS.length * 3 + 2);
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
    expect(adjustUserCredits).toHaveBeenCalledWith('u-alice', { credits: -25, kind: 'adjustment', reason: 'Duplicate charge', unitVersion: 'credit-paise-v2' }, 'new-request-id');
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
    expect(adjustUserCredits).toHaveBeenCalledWith('u-alice', { credits: 100.5, kind: 'adjustment', reason: 'Goodwill', unitVersion: 'credit-paise-v2' }, 'new-request-id');
    expect(adjustUserCredits).toHaveBeenCalledWith('u-bob', { credits: 2000, kind: 'topup', reason: 'Paid by invoice', unitVersion: 'credit-paise-v2' }, 'new-request-id');
  });

  it('keeps a legacy draft unit when a refreshed directory reports the new unit', async () => {
    adjustUserCredits.mockResolvedValue({ ok: false, reason: 'Reload balances.' });
    const { tree, onChange } = renderWith({ 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: 'old', unitVersion: 'credit-ten-paise-v1' } });
    applyButton(tree, 'alice@example.test').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(adjustUserCredits).toHaveBeenCalledWith('u-alice', expect.objectContaining({ credits: 10, unitVersion: 'credit-ten-paise-v1' }), 'old');
  });

  it('disables amount-bearing controls when the balance denomination is unknown', () => {
    const users = USERS.map(u => ({ ...u, creditUnitVersion: null }));
    hooks.capture = true;
    const tree = UsersPage({ users, onChange: () => {} });
    expect(find(tree, n => n.props?.['aria-label'] === 'Credit amount for alice@example.test').props.disabled).toBe(true);
    expect(applyButton(tree, 'alice@example.test').props.disabled).toBe(true);
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


// F147: the directory is shown 100 users at a time, with a search.
describe('UsersPage paging and search', () => {
  const [setErr, , , , , setSearchText, setLoading] = [0, 1, 2, 3, 4, 5, 6];
  const MANY = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `m-${from + i}`, name: `m${from + i}`, email: `m${from + i}@example.test`, type: 'analyst', plan: 'free', planStatus: 'free', planEnd: null, active: true, role: 'user', creditBalance: 0, creditDebt: 0, creditUnitVersion: 'credit-paise-v2' }));
  const paging = (page, total, query = '') => ({ page, pageSize: 100, total, query });
  const button = (tree, name) => find(tree, (n) => n.type === 'button' && String(n.props.className).includes(name));
  const searchBox = (tree) => find(tree, (n) => n.type === 'input' && n.props.type === 'search');
  const render = (props, presets = []) => {
    hooks.capture = true;
    hooks.presets = presets;
    return UsersPage({ onChange: vi.fn(), ...props });
  };
  const markupOf = (users, pagingProp) => renderToStaticMarkup(createElement(UsersPage, { users, onChange: () => {}, paging: pagingProp }));

  afterEach(() => { vi.useRealTimers(); });

  it('shows which users are listed and how many there are', () => {
    expect(markupOf(MANY(100), paging(1, 250))).toContain('1–100 of 250');
    expect(markupOf(MANY(100, 100), paging(2, 250))).toContain('101–200 of 250');
    expect(markupOf(MANY(50, 200), paging(3, 250))).toContain('201–250 of 250');
    expect(markupOf(MANY(1), paging(1, 1))).toContain('1–1 of 1');
  });

  it('formats a large count the Indian way', () => {
    expect(markupOf(MANY(100, 1100), paging(12, 123456))).toContain('1,101–1,200 of 1,23,456');
  });

  it('reads the page from the store when none is passed', () => {
    expect(renderToStaticMarkup(createElement(UsersPage, { users: USERS, onChange: () => {} }))).toContain('1–3 of 3');
  });

  it('enables Previous and Next only where there is a page to go to', () => {
    const state = (users, p) => {
      const markup = markupOf(users, p);
      return [/<button[^>]*adm-pager-prev[^>]*disabled=""|<button[^>]*disabled=""[^>]*adm-pager-prev/.test(markup), /<button[^>]*adm-pager-next[^>]*disabled=""|<button[^>]*disabled=""[^>]*adm-pager-next/.test(markup)];
    };
    expect(state(MANY(100), paging(1, 250))).toEqual([true, false]);
    expect(state(MANY(100, 100), paging(2, 250))).toEqual([false, false]);
    expect(state(MANY(50, 200), paging(3, 250))).toEqual([false, true]);
    expect(state(MANY(100), paging(1, 100))).toEqual([true, true]);
    expect(state([], paging(1, 0))).toEqual([true, true]);
  });

  it('has a labelled search box limited to the 100 characters the server takes, and no form', () => {
    const markup = markupOf(USERS, paging(1, 3));
    expect(markup).toMatch(/<input[^>]*type="search"/);
    expect(markup).toContain('aria-label="Search users by name or email"');
    expect(markup).toMatch(/<input[^>]*maxLength="100"[^>]*type="search"|<input[^>]*type="search"[^>]*maxLength="100"/);
    expect(markup).not.toContain('<form');
    // The range is announced as it changes, without taking the status role the credit result uses.
    expect(markup).toMatch(/<span class="adm-pager-range" aria-live="polite">/);
  });

  it('says so when nothing is listed', () => {
    expect(markupOf([], paging(1, 0))).toContain('No users yet');
    expect(markupOf([], paging(1, 0, 'zzz'))).toContain('No users match');
    expect(markupOf([], paging(1, 0, 'zzz'))).toContain('0 of 0');
  });

  it('goes to the next page, keeping the search, then refreshes the list', async () => {
    const onChange = vi.fn();
    const tree = render({ users: MANY(100), paging: paging(2, 250, 'ali'), onChange });
    button(tree, 'adm-pager-next').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(loadUsersPage).toHaveBeenCalledWith({ page: 3, q: 'ali' });
    expect(hooks.setters[setLoading].mock.calls).toEqual([[true], [false]]);
    expect(hooks.setters[setErr].mock.calls.at(-1)).toEqual(['']);
  });

  it('goes to the previous page, keeping the search', async () => {
    const onChange = vi.fn();
    const tree = render({ users: MANY(100), paging: paging(3, 250, 'ali'), onChange });
    button(tree, 'adm-pager-prev').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(loadUsersPage).toHaveBeenCalledWith({ page: 2, q: 'ali' });
  });

  it('shows the reason when a page could not be loaded', async () => {
    loadUsersPage.mockResolvedValueOnce({ ok: false });
    const onChange = vi.fn();
    const tree = render({ users: MANY(100), paging: paging(1, 250), onChange });
    button(tree, 'adm-pager-next').props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(hooks.setters[setErr].mock.calls.at(-1)[0]).toMatch(/could not be loaded/i);
    expect(hooks.setters[setLoading].mock.calls.at(-1)).toEqual([false]);
  });

  it('searches from the first page, after a pause in typing, with the text typed', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const tree = render({ users: MANY(100, 100), paging: paging(2, 250), onChange });
    const input = searchBox(tree);
    input.props.onChange({ target: { value: 'a' } });
    input.props.onChange({ target: { value: 'al' } });
    input.props.onChange({ target: { value: ' ali ' } });
    expect(hooks.setters[setSearchText].mock.calls.map(([v]) => v)).toEqual(['a', 'al', ' ali ']);
    vi.advanceTimersByTime(299);
    expect(loadUsersPage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(loadUsersPage).toHaveBeenCalledOnce();
    expect(loadUsersPage).toHaveBeenCalledWith({ page: 1, q: ' ali ' });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  });

  it('searches at once on Enter, and not twice', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const tree = render({ users: MANY(100), paging: paging(1, 250), onChange });
    const input = searchBox(tree);
    input.props.onChange({ target: { value: 'ali' } });
    input.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    expect(loadUsersPage).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(loadUsersPage).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    input.props.onKeyDown({ key: 'a', preventDefault: vi.fn() });
    expect(loadUsersPage).toHaveBeenCalledOnce();
  });

  it('does not search again for the text it already shows', () => {
    vi.useFakeTimers();
    const tree = render({ users: MANY(100), paging: paging(2, 250, 'ali') });
    searchBox(tree).props.onChange({ target: { value: ' ali' } });
    vi.advanceTimersByTime(1000);
    expect(loadUsersPage).not.toHaveBeenCalled();
  });

  it('shows the search text it was given back in the box', () => {
    hooks.capture = true;
    hooks.presets = ['', null, {}, {}, '', 'ali'];
    const markup = renderToStaticMarkup(UsersPage({ users: MANY(1), onChange: () => {}, paging: paging(1, 1, 'ali') }));
    expect(markup).toMatch(/<input[^>]*value="ali"/);
  });

  it('starts the search box with the search already on screen', () => {
    hooks.capture = true;
    UsersPage({ users: MANY(1), onChange: () => {}, paging: paging(1, 1, 'ali') });
    // After the five states of the page (error, saving, plan and credit forms, note) come the search text and the loading flag.
    expect(hooks.initials.slice(5)).toEqual(['ali', false]);
  });

  it('disables the page buttons and the search box while a page loads or an action saves', () => {
    for (const presets of [['', null, {}, {}, '', '', true], ['', 'u-alice', {}, {}, '', '', false]]) {
      hooks.capture = true;
      hooks.presets = presets;
      const markup = renderToStaticMarkup(UsersPage({ users: MANY(100, 100), onChange: () => {}, paging: paging(2, 250) }));
      expect(markup).toMatch(/<button[^>]*adm-pager-prev[^>]*disabled=""|<button[^>]*disabled=""[^>]*adm-pager-prev/);
      expect(markup).toMatch(/<button[^>]*adm-pager-next[^>]*disabled=""|<button[^>]*disabled=""[^>]*adm-pager-next/);
    }
  });

  it('keeps the search box enabled while a page loads, so typing is not lost', () => {
    hooks.capture = true;
    hooks.presets = ['', null, {}, {}, '', '', true];
    const markup = renderToStaticMarkup(UsersPage({ users: MANY(100), onChange: () => {}, paging: paging(1, 250) }));
    expect(markup).not.toMatch(/<input[^>]*type="search"[^>]*disabled/);
    expect(markup).not.toMatch(/<input[^>]*disabled[^>]*type="search"/);
  });

  it('leaves the page where it is after a plan grant, a credits adjustment and a suspension', async () => {
    setUserPlan.mockResolvedValue({ ok: true });
    adjustUserCredits.mockResolvedValue({ ok: true, repeated: false, balance: 5 });
    setUserActive.mockResolvedValue({ ok: true });
    const onChange = vi.fn();
    hooks.capture = true;
    hooks.presets = ['', null, { 'u-bob': { plan: 'pro', end: '' } }, { 'u-alice': { kind: 'add', amount: '10', reason: 'Goodwill', requestId: null } }];
    const tree = UsersPage({ users: USERS, onChange, paging: paging(2, 250, 'ali') });
    find(rowFor(tree, 'bob@example.test'), (n) => n.type === 'button' && String(n.props.className).includes('adm-plan-set')).props.onClick();
    find(rowFor(tree, 'alice@example.test'), (n) => n.type === 'button' && String(n.props.className).includes('admin-credits-apply')).props.onClick();
    stateButton(rowFor(tree, 'alice@example.test')).props.onClick();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(3));
    expect(setUserPlan).toHaveBeenCalled();
    expect(adjustUserCredits).toHaveBeenCalled();
    expect(setUserActive).toHaveBeenCalled();
    expect(loadUsersPage).not.toHaveBeenCalled();
  });
});

// F147: the overview counts the directory, of which it holds only the page on screen.
describe('OverviewPage user count', () => {
  const overview = (users, total) => {
    usersPaging.mockReturnValueOnce({ page: 1, pageSize: 100, total, query: '' });
    return renderToStaticMarkup(createElement(OverviewPage, { users }));
  };

  it('counts every user in the directory, not only the page listed', () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `m-${i}`, active: i % 10 !== 0 }));
    const markup = overview(page, 250);
    expect(markup).toContain('Issued dashboard users · 250');
    expect(markup).toContain('among the 100 listed on the Users tab');
  });

  it('gives the plain counts when the whole directory is listed', () => {
    const markup = overview(USERS, 3);
    expect(markup).toContain('Issued dashboard users · 3');
    expect(markup).toContain('2 active · 1 suspended.');
    expect(markup).not.toContain('among the');
  });
});
