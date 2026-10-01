// docs/specs/2026-10-01-rag-v2-citations-pdf.md, Amendment (revision 5) point 1: while a citation is
// open in the overlay (desktop), a completed click outside the chat and the viewer closes both.
import { describe, expect, it, vi } from 'vitest';
import {
  CITATION_VIEWER_ATTRIBUTE, KEEP_ATTRIBUTE, attachOutsideClose, isOutsideClick, isOutsideTarget, outsideCloseActive,
} from './citationOverlayModel.js';

/* A small element tree with the three DOM members the rules use: isConnected, contains, closest. */
function node(name, parent = null, attrs = {}) {
  const n = {
    name, parent, attrs, detached: false,
    get isConnected() { return !this.detached && (!this.parent || this.parent.isConnected); },
    contains(other) {
      for (let at = other; at; at = at.parent) if (at === this) return true;
      return false;
    },
    // Attribute selectors only, `[name]` or `[name="value"]`, comma-separated.
    closest(selector) {
      const tests = selector.split(',').map(s => /^\s*\[([\w-]+)(?:="([^"]*)")?\]\s*$/.exec(s));
      for (let at = this; at; at = at.parent) {
        if (tests.some(t => t && t[1] in at.attrs && (t[2] === undefined || at.attrs[t[1]] === t[2]))) return at;
      }
      return null;
    },
  };
  return n;
}

function page() {
  const body = node('body');
  const desk = node('desk', body);
  const deskRow = node('desk-row', desk);
  const topBar = node('top-bar', body);
  const dock = node('dock', body);
  const cov = node('cov', dock);
  const chat = node('chat', cov);
  const chatInput = node('chat-input', chat);
  const edge = node('edge-handle', cov);
  const divider = node('divider-handle', cov);
  const viewer = node('viewer', cov);
  const zoomIn = node('zoom-in', viewer);
  return { body, desk, deskRow, topBar, dock, cov, chat, chatInput, edge, divider, viewer, zoomIn };
}

/** The full view, portalled to the body: a backdrop root holding the modal dialog. */
function fullView(body) {
  const root = node('pv-full-root', body);
  const dialog = node('pv-full', root, { role: 'dialog', 'aria-modal': 'true' });
  const close = node('close-full', dialog);
  return { root, dialog, close };
}

describe('isOutsideTarget: one event target against the keep zone', () => {
  const p = page();
  const zones = [p.cov];
  it('inside the chat, the viewer and either handle is kept', () => {
    for (const t of [p.chat, p.chatInput, p.viewer, p.zoomIn, p.edge, p.divider, p.cov]) {
      expect(isOutsideTarget(t, { keepZones: zones })).toBe(false);
    }
  });
  it('the desk, a desk row and the top bar are outside', () => {
    for (const t of [p.desk, p.deskRow, p.topBar, p.body]) expect(isOutsideTarget(t, { keepZones: zones })).toBe(true);
  });
  it('anything under a [data-cov-keep] mark (a portalled menu or picker) is kept', () => {
    const menu = node('menu', p.body, { [KEEP_ATTRIBUTE]: '' });
    const item = node('item', menu);
    expect(KEEP_ATTRIBUTE).toBe('data-cov-keep');
    expect(isOutsideTarget(item, { keepZones: zones })).toBe(false);
    expect(isOutsideTarget(menu, { keepZones: zones })).toBe(false);
  });
  it('a modal dialog open anywhere (the full view, its backdrop) keeps every target', () => {
    const fv = fullView(p.body);
    expect(isOutsideTarget(fv.close, { keepZones: zones })).toBe(false); // inside the dialog itself
    expect(isOutsideTarget(fv.root, { keepZones: zones, modalOpen: true })).toBe(false); // the backdrop
    expect(isOutsideTarget(p.desk, { keepZones: zones, modalOpen: true })).toBe(false);
  });
  it('anything under the page viewer\'s [data-citation-viewer] root (the full-view backdrop) is kept, with no modal check', () => {
    // X2: the full view's root carries data-citation-viewer="full-view" (viewerDom.js VIEWER_ATTRIBUTE),
    // and its backdrop does not stop propagation, so the marker alone must keep it.
    expect(CITATION_VIEWER_ATTRIBUTE).toBe('data-citation-viewer');
    const root = node('pv-full-root', p.body, { 'data-citation-viewer': 'full-view' });
    const backdrop = node('backdrop', root);
    expect(isOutsideTarget(root, { keepZones: zones })).toBe(false);
    expect(isOutsideTarget(backdrop, { keepZones: zones })).toBe(false);
    expect(isOutsideClick({ downTarget: backdrop, upTarget: backdrop, clickTarget: backdrop, keepZones: zones })).toBe(false);
  });
  it('an unknown target (missing, detached, or not an element) is never judged outside', () => {
    const gone = node('removed-menu-item', p.desk);
    gone.detached = true;
    expect(isOutsideTarget(null, { keepZones: zones })).toBe(false);
    expect(isOutsideTarget(gone, { keepZones: zones })).toBe(false);
    expect(isOutsideTarget({ isConnected: true }, { keepZones: zones })).toBe(false);
  });
  it('missing zones are skipped, not fatal', () => {
    expect(isOutsideTarget(p.desk, { keepZones: [null, undefined, p.cov] })).toBe(true);
    expect(isOutsideTarget(p.chat, { keepZones: [null, p.cov] })).toBe(false);
  });
});

describe('isOutsideClick: pointerdown, pointerup and click all outside', () => {
  const p = page();
  const keepZones = [p.cov];
  const click = (down, up, at, extra = {}) => isOutsideClick({ downTarget: down, upTarget: up, clickTarget: at, keepZones, ...extra });

  it('a click on the desk closes', () => {
    expect(click(p.deskRow, p.deskRow, p.deskRow)).toBe(true);
    expect(click(p.topBar, p.topBar, p.topBar)).toBe(true);
  });
  it('a click inside the chat, the viewer or a handle closes nothing', () => {
    expect(click(p.chatInput, p.chatInput, p.chatInput)).toBe(false);
    expect(click(p.zoomIn, p.zoomIn, p.zoomIn)).toBe(false);
    expect(click(p.divider, p.divider, p.divider)).toBe(false);
  });
  it('inside the full-view dialog, or on its backdrop, closes nothing', () => {
    const fv = fullView(p.body);
    expect(click(fv.close, fv.close, fv.close)).toBe(false);
    expect(click(fv.root, fv.root, fv.root, { modalOpen: true })).toBe(false);
  });
  it('inside a marked portal closes nothing', () => {
    const picker = node('picker', p.body, { [KEEP_ATTRIBUTE]: '' });
    expect(click(picker, picker, picker)).toBe(false);
  });
  it('a drag that starts on a desk row and ends in the chat closes nothing', () => {
    // A text-selection drag still fires click, on the common ancestor (the body: outside).
    expect(click(p.deskRow, p.chatInput, p.body)).toBe(false);
  });
  it('a resize drag released outside closes nothing (it started on the handle)', () => {
    expect(click(p.edge, p.desk, p.body)).toBe(false);
    expect(click(p.edge, p.edge, p.edge)).toBe(false); // with pointer capture, up and click stay on the handle
  });
  it('a press inside released outside closes nothing', () => {
    expect(click(p.chatInput, p.desk, p.body)).toBe(false);
  });
  it('a click with no recorded pointerdown (keyboard activation) closes nothing', () => {
    expect(click(null, null, p.deskRow)).toBe(false);
  });
});

describe('outsideCloseActive: only with a citation open, on a desktop, with a handler', () => {
  const onOutside = () => {};
  it('is on while open on a desktop', () => {
    expect(outsideCloseActive({ open: true, narrow: false, onOutside })).toBe(true);
  });
  it('is off without a citation open (today\'s docked chat)', () => {
    expect(outsideCloseActive({ open: false, narrow: false, onOutside })).toBe(false);
  });
  it('is off on phones (narrow), where the viewer is full-screen', () => {
    expect(outsideCloseActive({ open: true, narrow: true, onOutside })).toBe(false);
  });
  it('is off without a handler', () => {
    expect(outsideCloseActive({ open: true, narrow: false })).toBe(false);
  });
});

/** A document stand-in: capture listeners by type, and querySelector for an open modal. */
function fakeDocument(modals = []) {
  const listeners = [];
  return {
    listeners,
    modals,
    addEventListener: vi.fn((type, fn, options) => listeners.push({ type, fn, options })),
    removeEventListener: vi.fn((type, fn, options) => {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn && Boolean(l.options?.capture ?? l.options) === Boolean(options?.capture ?? options));
      if (i >= 0) listeners.splice(i, 1);
    }),
    querySelector: vi.fn(selector => (selector === '[aria-modal="true"]' ? modals.find(m => m.isConnected) || null : null)),
    fire(type, target, extra = {}) {
      for (const l of listeners.filter(x => x.type === type)) l.fn({ type, target, button: 0, ...extra });
    },
  };
}

const press = (doc, down, up = down, at = up) => {
  doc.fire('pointerdown', down);
  doc.fire('pointerup', up);
  doc.fire('click', at);
};

describe('attachOutsideClose: the capture-phase listener pair', () => {
  it('attaches pointerdown, pointerup and click in the capture phase, and detaches exactly those', () => {
    const p = page();
    const doc = fakeDocument();
    const detach = attachOutsideClose(doc, { zones: () => [p.cov], onOutside: () => {} });
    expect(doc.listeners.map(l => l.type).sort()).toEqual(['click', 'pointerdown', 'pointerup']);
    for (const l of doc.listeners) expect(l.options?.capture ?? l.options).toBe(true);
    detach();
    expect(doc.listeners).toEqual([]);
    expect(doc.removeEventListener).toHaveBeenCalledTimes(3);
  });

  it('a completed click on the desk calls onOutside once; inside, never', () => {
    const p = page();
    const doc = fakeDocument();
    const onOutside = vi.fn();
    const detach = attachOutsideClose(doc, { zones: () => [p.cov], onOutside });
    press(doc, p.chatInput);
    press(doc, p.zoomIn);
    press(doc, p.divider, p.desk, p.body);
    expect(onOutside).not.toHaveBeenCalled();
    press(doc, p.deskRow);
    expect(onOutside).toHaveBeenCalledTimes(1);
    detach();
  });

  it('a drag from a desk row into the chat (no click after a drag-and-drop) closes nothing', () => {
    const p = page();
    const doc = fakeDocument();
    const onOutside = vi.fn();
    attachOutsideClose(doc, { zones: () => [p.cov], onOutside });
    doc.fire('pointerdown', p.deskRow);
    doc.fire('pointerup', p.chatInput);
    expect(onOutside).not.toHaveBeenCalled();
    // A later keyboard click elsewhere does not reuse that stale pointerdown.
    doc.fire('click', p.desk);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('a pointerdown while the full view is open is never outside, even on its backdrop', () => {
    const p = page();
    const fv = fullView(p.body);
    const doc = fakeDocument([fv.dialog]);
    const onOutside = vi.fn();
    attachOutsideClose(doc, { zones: () => [p.cov], onOutside });
    press(doc, fv.root);
    // The backdrop closed the full view on its own pointerdown: the click still closes nothing.
    doc.fire('pointerdown', fv.root);
    fv.root.detached = true;
    doc.fire('pointerup', p.body);
    doc.fire('click', p.body);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('ignores a secondary button (a right-click on the desk)', () => {
    const p = page();
    const doc = fakeDocument();
    const onOutside = vi.fn();
    attachOutsideClose(doc, { zones: () => [p.cov], onOutside });
    doc.fire('pointerdown', p.desk, { button: 2 });
    doc.fire('pointerup', p.desk, { button: 2 });
    doc.fire('click', p.desk);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('after detach, a click on the desk closes nothing', () => {
    const p = page();
    const doc = fakeDocument();
    const onOutside = vi.fn();
    attachOutsideClose(doc, { zones: () => [p.cov], onOutside })();
    press(doc, p.deskRow);
    expect(onOutside).not.toHaveBeenCalled();
  });

  it('no document (server render) attaches nothing and detaches safely', () => {
    expect(() => attachOutsideClose(null, { zones: () => [], onOutside: () => {} })()).not.toThrow();
  });
});
