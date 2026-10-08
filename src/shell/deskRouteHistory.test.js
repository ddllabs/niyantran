import { expect, it, vi } from 'vitest';
import { backFromRestrictedDesk, rememberDeskNavigation } from './deskRouteHistory.js';
const browser = (state = null) => ({ location: { href: 'http://localhost/#/national' }, history: { length: 9, state, back: vi.fn(), replaceState: vi.fn() } });
it('uses Home for a fresh deep link even when external history exists', () => {
  const b = browser(), home = vi.fn(); backFromRestrictedDesk(home, b);
  expect(home).toHaveBeenCalledOnce(); expect(b.history.back).not.toHaveBeenCalled();
});
it('uses browser Back only for an app-owned transition, including after reload', () => {
  const b = browser({ nterDeskBack: true }), home = vi.fn(); backFromRestrictedDesk(home, b);
  expect(b.history.back).toHaveBeenCalledOnce(); expect(home).not.toHaveBeenCalled();
});
it('marks changed in-app destinations and does not invent Back for same-route clicks', () => {
  const b = browser({ tab: 'national' });
  rememberDeskNavigation(() => {}, b); expect(b.history.replaceState).not.toHaveBeenCalled();
  rememberDeskNavigation(() => { b.location.href = 'http://localhost/#/economics'; b.history.state = { tab: 'economics' }; }, b);
  expect(b.history.replaceState).toHaveBeenCalledWith({ tab: 'economics', nterDeskBack: true }, '', 'http://localhost/#/economics');
});
