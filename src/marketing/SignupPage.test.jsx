import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ states: [], cursor: 0, signUp: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async original => ({ ...(await original()), useState: initial => {
  const index = fake.cursor++;
  if (!(index in fake.states)) fake.states[index] = typeof initial === 'function' ? initial() : initial;
  return [fake.states[index], value => { fake.states[index] = typeof value === 'function' ? value(fake.states[index]) : value; }];
}, useMemo: fn => fn(), useRef: () => ({ current: null }), useEffect: () => {} }));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: { signUp: (...args) => fake.signUp(...args) } } }));
vi.mock('../lib/entitlementStore.js', () => ({ refreshEntitlement: (...args) => fake.refresh(...args), serverEntitlement: () => null }));
vi.mock('../lib/userStore.js', () => ({ setSessionUser: vi.fn(), PENDING_PERSONA_KEY: 'persona', userTypeOf: () => ({ id: 'policy', startTab: 'national' }) }));
vi.mock('../lib/personas.js', () => ({ PERSONAS: [{ id: 'policy', label: 'Policy', blurb: 'Policy', tone: 'blue', img: '' }], applyPersonaForUser: vi.fn() }));
vi.mock('../lib/userPrefsSync.js', () => ({ hydrateUserPrefs: vi.fn(async () => ({ ok: true })) }));
vi.mock('../lib/productAnalytics.js', () => ({ trackProductEvent: vi.fn() }));
vi.mock('./GoogleSignInButton.jsx', () => ({ default: () => null }));
import SignupPage from './SignupPage.jsx';
import { setSessionUser } from '../lib/userStore.js';

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, predicate); if (match) return match; }
  return null;
}
function render(success) { fake.cursor = 0; return SignupPage({ onSuccess: success, onLogin: vi.fn() }); }
async function signup(success) {
  let tree = render(success);
  find(tree, node => node.props?.role === 'radio').props.onClick();
  tree = render(success);
  await find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {}, target: { name: 'Test User', user: 'test@example.invalid', pass: 'test-password', pass2: 'test-password' } });
  return render(success);
}
beforeEach(() => {
  vi.clearAllMocks(); fake.states = []; fake.cursor = 0;
  fake.refresh.mockResolvedValue(null);
  fake.signUp.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
  vi.stubGlobal('location', { hash: '#/signup?plan=enterprise' });
  vi.stubGlobal('sessionStorage', { setItem: vi.fn(), getItem: () => null, removeItem: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('FormData', class { constructor(target) { this.target = target; } get(key) { return this.target[key]; } });
});
afterEach(() => vi.unstubAllGlobals());

describe('free signup', () => {
  it.each(['#/signup', '#/signup?plan=enterprise', '#/signup/pro'])('enters directly with free metadata from %s', async hash => {
    location.hash = hash;
    const success = vi.fn(); const tree = await signup(success);
    expect(fake.signUp.mock.calls[0][0].options.data.plan).toBe('free');
    expect(success).toHaveBeenCalledOnce();
    expect(setSessionUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', personaId: 'policy' }));
    expect(find(tree, node => node.props?.className === 'mkt-signup-plan-step')).toBeNull();
  });
  it('does not wait for subscription metadata before entering', async () => {
    fake.refresh.mockImplementation(() => new Promise(() => {}));
    const success = vi.fn(); await signup(success);
    expect(success).toHaveBeenCalledOnce();
  });
  it('keeps email verification when Auth returns no session', async () => {
    fake.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const success = vi.fn(); const tree = await signup(success);
    expect(find(tree, node => node.type === 'h1').props.children).toBe('VERIFY GMAIL');
    expect(success).not.toHaveBeenCalled();
    expect(setSessionUser).not.toHaveBeenCalled();
  });
  it('does not publish a session when signup fails', async () => {
    fake.signUp.mockResolvedValue({ data: {}, error: { message: 'Registration refused' } });
    const success = vi.fn(); await signup(success);
    expect(success).not.toHaveBeenCalled(); expect(setSessionUser).not.toHaveBeenCalled();
  });
});

it('lets the globe persona labels drive the same persona choice', () => {
  fake.states = []; let tree = render(vi.fn());
  const globe = find(tree, node => node.props?.onPersona);
  expect(globe.props.persona).toBe('');
  globe.props.onPersona('policy');
  tree = render(vi.fn());
  expect(find(tree, node => node.props?.onPersona).props.persona).toBe('policy');
  expect(find(tree, node => node.props?.role === 'radio').props['aria-checked']).toBe(true);
});

it('tells new users which Terms and Privacy Policy they accept, without a pre-ticked box', () => {
  fake.states = []; const tree = render(vi.fn());
  const notice = find(tree, node => node.props?.className === 'mkt-signup-legal');
  const links = [notice.props.children].flat(Infinity).filter(n => n?.type === 'a').map(a => a.props.href);
  expect(links).toEqual(['#/terms', '#/privacy']);
  expect(find(tree, node => node.props?.type === 'checkbox' && node.props?.defaultChecked)).toBeNull();
});
