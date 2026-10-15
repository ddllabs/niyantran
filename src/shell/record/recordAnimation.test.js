// F211 (owner 2026-10-16): the client's record animation is loaded once, on the first brief write,
// from the copied package in public/animation; a failed load leaves the card's own writing look.
import { describe, expect, it, vi } from 'vitest';
import { loadRecordAnimation, RECORD_ANIMATION_SRC } from './recordAnimation.js';

function fakes({ defined = false } = {}) {
  const appended = [];
  let whenDefined;
  const doc = {
    head: { appendChild: (el) => { appended.push(el); return el; } },
    createElement: (tag) => ({ tag, set src(v) { this._src = v; }, get src() { return this._src; } }),
    querySelector: () => appended[0] || null,
  };
  const registry = {
    get: () => (defined ? class {} : undefined),
    whenDefined: vi.fn(() => new Promise((r) => { whenDefined = r; })),
  };
  return { doc, registry, appended, define: () => whenDefined?.() };
}

describe('loadRecordAnimation', () => {
  it('adds the package script once and resolves when the element is defined', async () => {
    const f = fakes();
    const first = loadRecordAnimation(f.doc, f.registry);
    const second = loadRecordAnimation(f.doc, f.registry);
    expect(f.appended).toHaveLength(1);
    expect(f.appended[0].tag).toBe('script');
    expect(f.appended[0].src).toBe(RECORD_ANIMATION_SRC);
    expect(RECORD_ANIMATION_SRC).toBe('/animation/nter-record-loader.js');
    f.define();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it('adds nothing when the element is already defined', async () => {
    const f = fakes({ defined: true });
    await expect(loadRecordAnimation(f.doc, f.registry)).resolves.toBe(true);
    expect(f.appended).toHaveLength(0);
  });

  it('resolves false when the script fails, so the card keeps its own look', async () => {
    const f = fakes();
    const p = loadRecordAnimation(f.doc, f.registry);
    f.appended[0].onerror();
    await expect(p).resolves.toBe(false);
  });

  it('resolves false without a document (server render, tests)', async () => {
    await expect(loadRecordAnimation(null, null)).resolves.toBe(false);
  });
});
