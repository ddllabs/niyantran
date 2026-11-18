// F359: the REAL useFactCheck hook with real effects (hookHarness.js) and a recording controller. Live TV
// leaving (open true -> false) must end the session through controller.close exactly once, and an
// unrelated re-render must not.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const made = vi.hoisted(() => ({ controllers: [] }));
vi.mock('./factCheckController.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createFactCheckController: vi.fn(() => {
    const c = { load: vi.fn(async () => {}), close: vi.fn(async () => {}), setTarget: vi.fn(), setVideo: vi.fn(), choose: vi.fn(), cancel: vi.fn(), start: vi.fn(), stop: vi.fn(), retry: vi.fn(), endOrphan: vi.fn(), dismiss: vi.fn() };
    made.controllers.push(c);
    return c;
  }),
}));
const { useFactCheck } = await import('./useFactCheck.js');

const props = (open, extra = {}) => ({ open, target: 'ch1|live|v1', start: { videoId: 'v1', videoKind: 'live' }, getPosition: null, ...extra });
const render = (p) => harness.render(useFactCheck, p);

beforeEach(() => { harness.reset(); made.controllers.length = 0; });

describe('useFactCheck and the page being open', () => {
  it('loads when it opens and closes once when it closes', () => {
    render(props(true));
    const [c] = made.controllers;
    expect(c.load).toHaveBeenCalledTimes(1);
    expect(c.close).not.toHaveBeenCalled();
    render(props(false));
    expect(c.close).toHaveBeenCalledTimes(1);
    render(props(false));
    expect(c.close).toHaveBeenCalledTimes(1);
  });

  it('does not close on a re-render with open still true, even with a new target or start', () => {
    render(props(true));
    const [c] = made.controllers;
    render(props(true));
    render(props(true, { target: 'ch2|live|v2', start: { videoId: 'v2', videoKind: 'live' } }));
    expect(c.close).not.toHaveBeenCalled();
    expect(c.load).toHaveBeenCalledTimes(1);
    expect(c.setTarget).toHaveBeenLastCalledWith('ch2|live|v2');
  });

  it('loads again on reopening, with the same controller', () => {
    render(props(true));
    render(props(false));
    render(props(true));
    expect(made.controllers).toHaveLength(1);
    expect(made.controllers[0].load).toHaveBeenCalledTimes(2);
  });
});
