import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// F200: after a page load (on D3, a reload the reader did not ask for) the desk tour showed again
// though it was done. The shell mounts before the account is verified and bound, and the tour read
// its done flag then. React's hooks are stood in for, so the tour's effect runs as it would.
const hooks = vi.hoisted(() => ({ effects: [], setOpen: null }));
vi.mock('react', async (original) => ({
  ...await original(),
  useState: (initial) => (initial === false ? [false, hooks.setOpen] : [initial, () => {}]),
  useEffect: (fn) => hooks.effects.push(fn),
  useRef: (value) => ({ current: value }),
}));
vi.mock('../lib/productAnalytics.js', () => ({ trackProductEvent: () => {} }));

function memoryStorage(values = new Map()) {
  return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) };
}
const account = { id: 'reader', expiresAt: Date.now() + 3600_000 };
let storage;
beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** A fresh page: modules (and the account binding) start again; browser storage is kept. */
async function loadPage() {
  vi.resetModules();
  hooks.effects = [];
  hooks.setOpen = vi.fn();
  const onboarding = await import('../lib/onboarding.js');
  const { default: OnboardingTour } = await import('./OnboardingTour.jsx');
  return { onboarding, OnboardingTour };
}
const mount = (Tour, props) => { Tour(props); return hooks.effects.map((fn) => fn()).filter(Boolean); };

it('a desk tour already done does not show again after a page load, before or after the account is bound', async () => {
  const first = await loadPage();
  first.onboarding.setToursOwner(account);
  first.onboarding.markDeskTourDone('bills');

  const { onboarding, OnboardingTour } = await loadPage();
  mount(OnboardingTour, { kind: 'desk', deskId: 'bills' });
  expect(hooks.setOpen).not.toHaveBeenCalledWith(true);
  onboarding.setToursOwner(account);
  expect(hooks.setOpen).not.toHaveBeenCalledWith(true);
  expect(hooks.setOpen).toHaveBeenLastCalledWith(false);
});

it('a desk tour not yet done shows once the account is bound, and stops listening when unmounted', async () => {
  const { onboarding, OnboardingTour } = await loadPage();
  const cleanups = mount(OnboardingTour, { kind: 'desk', deskId: 'bills' });
  expect(hooks.setOpen).not.toHaveBeenCalledWith(true);
  onboarding.setToursOwner(account);
  expect(hooks.setOpen).toHaveBeenLastCalledWith(true);
  cleanups.forEach((fn) => fn());
  hooks.setOpen.mockClear();
  onboarding.setToursOwner({ ...account });
  expect(hooks.setOpen).not.toHaveBeenCalled();
});
