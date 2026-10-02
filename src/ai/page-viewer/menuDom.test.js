import { describe, expect, it, vi } from 'vitest';
import { createMenuDom, createTipWarmth, TIP_COOL_MS, TIP_WARM_MS } from './menuDom.js';

/** A node that records its listeners and can dispatch to them; `contains` walks `inside`. */
function node(name, inside = []) {
  const listeners = new Map();
  const self = {
    name,
    focused: false,
    addEventListener: vi.fn((type, fn, options) => listeners.set(type, { fn, options })),
    removeEventListener: vi.fn((type, fn) => { if (listeners.get(type)?.fn === fn) listeners.delete(type); }),
    contains: other => other === self || inside.some(child => child === other || child.contains?.(other)),
    focus: vi.fn(() => { self.focused = true; }),
    dispatch(type, event) { listeners.get(type)?.fn(event); },
    listening: type => listeners.has(type),
    optionsOf: type => listeners.get(type)?.options,
  };
  return self;
}

function keyEvent(key, target = null) {
  return { key, target, stopPropagation: vi.fn(), preventDefault: vi.fn() };
}

function setup() {
  const items = [node('a'), node('b'), node('c')];
  const menu = node('menu', items);
  menu.querySelectorAll = () => items;
  const trigger = node('trigger');
  const doc = node('document');
  const onClose = vi.fn();
  doc.activeElement = null;
  const handle = createMenuDom({ menu, trigger, doc, onClose });
  return { items, menu, trigger, doc, onClose, handle, setActive: (n) => { doc.activeElement = n; } };
}

describe('createMenuDom', () => {
  it('Escape closes the menu, returns focus, and goes no further', () => {
    const { menu, onClose } = setup();
    const event = keyEvent('Escape');
    menu.dispatch('keydown', event);
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: true });
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('Tab closes with focus back on the trigger and lets the Tab go on, so it moves past the trigger', () => {
    const { menu, onClose } = setup();
    const event = keyEvent('Tab');
    menu.dispatch('keydown', event);
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: true });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('arrow keys move focus between the items and wrap', () => {
    const { items, menu, setActive } = setup();
    setActive(items[2]);
    const event = keyEvent('ArrowDown');
    menu.dispatch('keydown', event);
    expect(items[0].focus).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('a press outside closes; a press inside the menu or on its trigger does not', () => {
    const { items, trigger, doc, onClose } = setup();
    doc.dispatch('pointerdown', { target: items[1] });
    doc.dispatch('pointerdown', { target: trigger });
    expect(onClose).not.toHaveBeenCalled();
    doc.dispatch('pointerdown', { target: node('page') });
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: false });
  });

  it('listens on the document in the capture phase, so a stopped press still closes it', () => {
    const { doc } = setup();
    expect(doc.optionsOf('pointerdown')).toEqual({ capture: true });
  });

  it('removes every listener it added', () => {
    const { menu, doc, handle } = setup();
    handle.dispose();
    expect(menu.listening('keydown')).toBe(false);
    expect(doc.listening('pointerdown')).toBe(false);
  });
});

describe('createTipWarmth', () => {
  function warmth() {
    vi.useFakeTimers();
    const tip = { closest: sel => (sel === '[data-tip]' ? tip : null) };
    const plain = { closest: () => null };
    const root = node('root');
    root.dataset = {};
    const handle = createTipWarmth(root);
    return { root, tip, plain, handle };
  }

  it('warms once a tooltip has had time to show, and stays warm across controls', () => {
    const { root, tip } = warmth();
    root.dispatch('pointerover', { target: tip });
    vi.advanceTimersByTime(TIP_WARM_MS - 1);
    expect(root.dataset.tipsWarm).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(root.dataset.tipsWarm).toBe('');
    vi.useRealTimers();
  });

  it('does not warm when the pointer leaves the control before its tooltip shows', () => {
    const { root, tip } = warmth();
    root.dispatch('pointerover', { target: tip });
    vi.advanceTimersByTime(TIP_WARM_MS / 2);
    root.dispatch('pointerout', { target: tip });
    vi.advanceTimersByTime(TIP_WARM_MS);
    expect(root.dataset.tipsWarm).toBeUndefined();
    vi.useRealTimers();
  });

  it('cools a while after the pointer leaves the chrome, not at once', () => {
    const { root, tip } = warmth();
    root.dispatch('pointerover', { target: tip });
    vi.advanceTimersByTime(TIP_WARM_MS);
    root.dispatch('pointerleave', {});
    vi.advanceTimersByTime(TIP_COOL_MS - 1);
    expect(root.dataset.tipsWarm).toBe('');
    root.dispatch('pointerenter', {});
    vi.advanceTimersByTime(TIP_COOL_MS);
    expect(root.dataset.tipsWarm, 'coming back in time keeps it warm').toBe('');
    root.dispatch('pointerleave', {});
    vi.advanceTimersByTime(TIP_COOL_MS);
    expect(root.dataset.tipsWarm).toBeUndefined();
    vi.useRealTimers();
  });

  it('ignores pointers over anything without a tooltip, and cleans up on dispose', () => {
    const { root, plain, handle } = warmth();
    root.dispatch('pointerover', { target: plain });
    vi.advanceTimersByTime(TIP_WARM_MS);
    expect(root.dataset.tipsWarm).toBeUndefined();
    handle.dispose();
    for (const type of ['pointerover', 'pointerout', 'pointerenter', 'pointerleave']) expect(root.listening(type)).toBe(false);
    vi.useRealTimers();
  });
});
