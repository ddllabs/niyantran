// F359: the REAL useFactCheck hook with real effects (hookHarness.js) and a recording controller. Live TV
// leaving (open true -> false) must end the session through controller.close exactly once, and an
// unrelated re-render must not.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const made = vi.hoisted(() => ({ controllers: [], options: [] }));
vi.mock('./factCheckController.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createFactCheckController: vi.fn((opts) => {
    made.options.push(opts);
    const c = { prepareStart: vi.fn(() => null), load: vi.fn(async () => {}), close: vi.fn(async () => {}), setTarget: vi.fn(), setVideo: vi.fn(), choose: vi.fn(), cancel: vi.fn(), start: vi.fn(), stop: vi.fn(), retry: vi.fn(), endOrphan: vi.fn(), dismiss: vi.fn() };
    made.controllers.push(c);
    return c;
  }),
}));
const { useFactCheck } = await import('./useFactCheck.js');

const props = (open, extra = {}) => ({ open, target: 'ch1|live|v1', start: { videoId: 'v1', videoKind: 'live' }, getPosition: null, ...extra });
const render = (p) => harness.render(useFactCheck, p);

beforeEach(() => { harness.reset(); made.controllers.length = 0; made.options.length = 0; });

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

describe('the seek handed to the controller (F363)', () => {
  it('calls the newest seek the page gave, and is false when there is none', () => {
    const first = vi.fn(() => true);
    render(props(true, { seek: first }));
    const [opts] = made.options;
    expect(opts.seek(130)).toBe(true);
    expect(first).toHaveBeenCalledWith(130);
    const second = vi.fn(() => false);
    render(props(true, { seek: second }));
    expect(opts.seek(5)).toBe(false);
    expect(second).toHaveBeenCalledWith(5);
    render(props(true, { seek: undefined }));
    expect(opts.seek(5)).toBe(false);
    expect(made.options).toHaveLength(1);
  });
});

describe('confirming a start (F363)', () => {
  const recorded = (getStartPositionS) => props(true, { start: { videoId: 'v1', videoKind: 'recorded', startPositionS: null, getStartPositionS } });
  it('an ordinary start reads the position and starts at once', () => {
    let pos = 40;
    const { actions } = render(recorded(() => pos));
    const [c] = made.controllers;
    actions.confirm(5, 500);
    expect(c.start).toHaveBeenCalledTimes(1);
    expect(c.start.mock.calls[0][0].startPositionS).toBe(40);
    pos = 99;
  });

  it('after "Re-analyze this block" the position is read after the seek that Start sends, not before', async () => {
    const order = [];
    let pos = 150; // the video played on after the first seek
    let release;
    const { actions } = render(recorded(() => { order.push('read'); return pos; }));
    const [c] = made.controllers;
    c.prepareStart.mockImplementation(() => new Promise((r) => { order.push('seek'); release = () => { pos = 130; r(); }; }));
    actions.confirm(10, 500);
    expect(order).toEqual(['seek']);
    expect(c.start).not.toHaveBeenCalled();
    release();
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['seek', 'read']);
    expect(c.start).toHaveBeenCalledTimes(1);
    expect(c.start.mock.calls[0][0].startPositionS).toBe(130);
    expect(c.start.mock.calls[0].slice(1)).toEqual([10, 500]);
  });
});
