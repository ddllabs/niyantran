import { describe, expect, it, vi } from 'vitest';
import {
  NARROW_QUERY, attachFullView, createWheelHandler, fullViewKeyHandler, isNarrow, scrollTargetFor, themeClassOf,
} from './viewerDom.js';

const el = name => ({ name, focus: vi.fn() });
const keyEvent = (key, extra = {}) => ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });

/** A fake dialog node holding `items` as its focusable controls. */
function fakeContainer(items) {
  const listeners = new Map();
  return {
    focus: vi.fn(),
    contains: node => node === undefined ? false : items.includes(node),
    querySelectorAll: () => items,
    addEventListener: vi.fn((type, fn) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); }),
    dispatch: (type, event) => listeners.get(type)?.(event),
    listeners,
  };
}

describe('fullViewKeyHandler', () => {
  it('Esc closes the full view and stops there, so the overlay does not also close', () => {
    const onClose = vi.fn();
    const handle = fullViewKeyHandler({ container: fakeContainer([el('a')]), onClose });
    const event = keyEvent('Escape');
    handle(event);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('leaves other keys alone', () => {
    const onClose = vi.fn();
    const handle = fullViewKeyHandler({ container: fakeContainer([el('a')]), onClose });
    const event = keyEvent('ArrowRight');
    handle(event);
    expect(onClose).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog: last wraps to first, Shift+Tab on first wraps to last', () => {
    const [a, b, c] = [el('a'), el('b'), el('c')];
    let active = c;
    const handle = fullViewKeyHandler({ container: fakeContainer([a, b, c]), onClose: vi.fn(), getActive: () => active });
    const forward = keyEvent('Tab');
    handle(forward);
    expect(forward.preventDefault).toHaveBeenCalled();
    expect(a.focus).toHaveBeenCalled();

    active = a;
    const back = keyEvent('Tab', { shiftKey: true });
    handle(back);
    expect(back.preventDefault).toHaveBeenCalled();
    expect(c.focus).toHaveBeenCalled();

    active = b;
    const middle = keyEvent('Tab');
    handle(middle);
    expect(middle.preventDefault).not.toHaveBeenCalled();
  });

  it('pulls focus back in from outside', () => {
    const [a, b] = [el('a'), el('b')];
    const handle = fullViewKeyHandler({ container: fakeContainer([a, b]), onClose: vi.fn(), getActive: () => el('outside') });
    const event = keyEvent('Tab');
    handle(event);
    expect(a.focus).toHaveBeenCalled();
  });
});

describe('attachFullView', () => {
  it('moves focus in, handles Esc on the dialog itself, and returns focus to Expand on close', () => {
    const close = el('close');
    const expand = el('expand');
    const container = fakeContainer([close]);
    const onClose = vi.fn();
    const detach = attachFullView({ container, initialFocus: close, returnFocus: () => expand, onClose });
    expect(close.focus).toHaveBeenCalled();
    expect(container.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    const event = keyEvent('Escape');
    container.dispatch('keydown', event);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalled();

    detach();
    expect(container.listeners.has('keydown')).toBe(false);
    expect(expand.focus).toHaveBeenCalled();
  });

  it('focuses the dialog when there is no initial control, and tolerates a missing return target', () => {
    const container = fakeContainer([]);
    const detach = attachFullView({ container, returnFocus: () => null, onClose: vi.fn() });
    expect(container.focus).toHaveBeenCalled();
    expect(() => detach()).not.toThrow();
  });
});

describe('createWheelHandler', () => {
  const page = { name: 'page' };
  const setup = () => {
    const onZoom = vi.fn();
    const handle = createWheelHandler({ isOverPage: target => target === page, onZoom });
    return { handle, onZoom };
  };
  const wheel = extra => ({ deltaY: -50, preventDefault: vi.fn(), target: page, ...extra });

  it('zooms on ctrl or meta + wheel over the page, and only then prevents the browser zoom', () => {
    const { handle, onZoom } = setup();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = wheel(mod);
      handle(event);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(onZoom).toHaveBeenCalledTimes(2);
    expect(onZoom.mock.calls[0][0]).toBeGreaterThan(1);
  });

  it('lets a plain wheel scroll', () => {
    const { handle, onZoom } = setup();
    const event = wheel({});
    handle(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onZoom).not.toHaveBeenCalled();
  });

  it('ignores ctrl + wheel outside the page', () => {
    const { handle, onZoom } = setup();
    const event = wheel({ ctrlKey: true, target: { name: 'margin' } });
    handle(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onZoom).not.toHaveBeenCalled();
  });
});

describe('isNarrow', () => {
  it('asks for the phone breakpoint', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    expect(isNarrow({ matchMedia })).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(NARROW_QUERY);
    expect(NARROW_QUERY).toBe('(max-width: 900px)');
    expect(isNarrow({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it('defaults to desktop (Full view shown) without matchMedia, or when it throws', () => {
    expect(isNarrow(undefined)).toBe(false);
    expect(isNarrow({})).toBe(false);
    expect(isNarrow({ matchMedia: () => { throw new Error('blocked'); } })).toBe(false);
  });
});

describe('themeClassOf', () => {
  it('carries the app theme class to the portalled dialog', () => {
    const host = { classList: ['terminal', 'theme-dark'] };
    expect(themeClassOf({ closest: () => host })).toBe('theme-dark');
    expect(themeClassOf({ closest: () => null })).toBe('');
    expect(themeClassOf(null)).toBe('');
  });
});

// Local run V7b (2026-10-01): scrollIntoView({inline: 'center'}) scrolled the overflow-hidden crop
// itself sideways and cut the text's left edge off. The page area alone is scrolled, by numbers.
describe('scrollTargetFor', () => {
  const area = { top: 100, left: 1000, width: 447, height: 600 };
  it('centres the box vertically in the page area and keeps the horizontal position when the box is visible', () => {
    const box = { top: 700, left: 1100, width: 120, height: 20 }; // 600 below the area top
    expect(scrollTargetFor(box, area, { top: 0, left: 0 })).toEqual({ top: 600 + 10 - 300, left: 0 });
  });
  it('never scrolls above the top', () => {
    expect(scrollTargetFor({ top: 120, left: 1100, width: 50, height: 10 }, area, { top: 0, left: 0 }).top).toBe(0);
  });
  it('moves horizontally only when the box is outside the visible width (zoomed in)', () => {
    const right = { top: 300, left: 1600, width: 100, height: 20 }; // starts 600 px right of the area
    expect(scrollTargetFor(right, area, { top: 0, left: 0 }).left).toBe(600 + 50 - 223);
    const inside = { top: 300, left: 1300, width: 100, height: 20 };
    expect(scrollTargetFor(inside, area, { top: 0, left: 0 }).left).toBe(0);
  });
});
