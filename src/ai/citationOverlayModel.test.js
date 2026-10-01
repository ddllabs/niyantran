import { describe, expect, it } from 'vitest';
import {
  NARROW_QUERY, REDUCED_MOTION_QUERY, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, SPLIT_STORAGE_KEY, WIDTH_STORAGE_KEY,
  clampSplit, clampWidth, defaultWidth, dragSplit, dragWidth, nextPhase, overlayShift, overlayWidth, readStoredSplit,
  readStoredWidth, resolveSplit, resolveWidth, stepSplit, stepWidth, widthBounds, writeStored,
} from './citationOverlayModel.js';

// docs/specs/2026-10-01-rag-v2-citations-pdf.md, decision 7 and Design > Layout: the overlay's
// left edge sits at the middle of the screen, never narrower than 960 px where the screen allows.
describe('overlayWidth: max(50vw, 960px), capped at the viewport', () => {
  it('is 960 px on a 1440 px screen, so each half is 480 px', () => {
    expect(overlayWidth(1440)).toBe(960);
  });
  it('is half the screen once half the screen is wider than 960 px', () => {
    expect(overlayWidth(2000)).toBe(1000);
    expect(overlayWidth(2560)).toBe(1280);
  });
  it('is exactly 960 px at 1920 px (half) and at 960 px (whole)', () => {
    expect(overlayWidth(1920)).toBe(960);
    expect(overlayWidth(960)).toBe(960);
  });
  it('is the whole viewport on screens narrower than 960 px', () => {
    expect(overlayWidth(800)).toBe(800);
    expect(overlayWidth(901)).toBe(901);
  });
  it('is 0 for a missing or nonsense viewport', () => {
    expect(overlayWidth(undefined)).toBe(0);
    expect(overlayWidth(-5)).toBe(0);
    expect(overlayWidth(Number.NaN)).toBe(0);
  });
});

describe('overlayShift: how far right the overlay starts, so its left edge begins at the dock', () => {
  it('is the overlay width less the dock width', () => {
    expect(overlayShift(1440, 547)).toBe(413);
  });
  it('is never negative: a dock wider than the overlay starts in place', () => {
    expect(overlayShift(1440, 1200)).toBe(0);
  });
  it('is 0 when the dock has not been measured', () => {
    expect(overlayShift(1440, undefined)).toBe(0);
  });
});

describe('nextPhase: closed → opening → open → closing → closed', () => {
  it('opening a citation starts the widening, and a closed overlay stays closed', () => {
    expect(nextPhase('closed', true, { instant: false })).toBe('opening');
    expect(nextPhase('closed', false, { instant: false })).toBe('closed');
  });
  it('an overlay that is opening or open stays so while the citation is open', () => {
    expect(nextPhase('opening', true, { instant: false })).toBe('opening');
    expect(nextPhase('open', true, { instant: false })).toBe('open');
  });
  it('closing the citation animates back before the chat returns to the dock', () => {
    expect(nextPhase('open', false, { instant: false })).toBe('closing');
    expect(nextPhase('opening', false, { instant: false })).toBe('closing');
    expect(nextPhase('closing', false, { instant: false })).toBe('closing');
  });
  it('reopening while it animates back turns round without passing through closed', () => {
    expect(nextPhase('closing', true, { instant: false })).toBe('open');
  });
  it('reduced motion and phones switch instantly, both ways', () => {
    expect(nextPhase('closed', true, { instant: true })).toBe('open');
    expect(nextPhase('open', false, { instant: true })).toBe('closed');
    expect(nextPhase('closing', false, { instant: true })).toBe('closed');
  });
});

describe('media queries', () => {
  it('phones use the app breakpoint at which the dock stacks under the desk (index.css, 900 px)', () => {
    expect(NARROW_QUERY).toBe('(max-width: 900px)');
  });
  it('reduced motion is the standard query', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });
});

// Revision 4, point 1: the outer edge sets the overlay's width, from 960 px (or the viewport, if
// narrower) to the viewport less 120 px, so a sliver of the desk stays visible.
describe('widthBounds: 960 px (or the viewport) to the viewport less 120 px', () => {
  it('runs from 960 px to the viewport less 120 px on a wide screen', () => {
    expect(widthBounds(1440)).toEqual({ min: 960, max: 1320 });
    expect(widthBounds(2560)).toEqual({ min: 960, max: 2440 });
  });
  it('never has a maximum below the minimum: between 960 and 1080 px it is pinned at 960 px', () => {
    expect(widthBounds(1000)).toEqual({ min: 960, max: 960 });
    expect(widthBounds(1080)).toEqual({ min: 960, max: 960 });
    expect(widthBounds(1081)).toEqual({ min: 960, max: 961 });
  });
  it('is the whole viewport on screens narrower than 960 px', () => {
    expect(widthBounds(901)).toEqual({ min: 901, max: 901 });
  });
  it('is 0 to 0 for a missing or nonsense viewport', () => {
    expect(widthBounds(undefined)).toEqual({ min: 0, max: 0 });
    expect(widthBounds(Number.NaN)).toEqual({ min: 0, max: 0 });
  });
});

describe('defaultWidth: today\'s rule, max(50vw, 960px) capped at the viewport', () => {
  it('matches overlayWidth and always lies within the bounds', () => {
    for (const vw of [800, 960, 1000, 1080, 1100, 1440, 1920, 2000, 2560, 3840]) {
      const { min, max } = widthBounds(vw);
      expect(defaultWidth(vw)).toBe(overlayWidth(vw));
      expect(defaultWidth(vw)).toBeGreaterThanOrEqual(min);
      expect(defaultWidth(vw)).toBeLessThanOrEqual(max);
    }
  });
});

describe('clampWidth', () => {
  it('keeps a width inside the bounds, rounded to whole pixels', () => {
    expect(clampWidth(1100, 1440)).toBe(1100);
    expect(clampWidth(1100.6, 1440)).toBe(1101);
  });
  it('raises a width below 960 px to 960 px', () => {
    expect(clampWidth(500, 1440)).toBe(960);
  });
  it('lowers a width that would cover the last 120 px of the desk', () => {
    expect(clampWidth(1400, 1440)).toBe(1320);
  });
  it('follows a shrinking viewport: a width chosen on a wide screen is clamped on a narrow one', () => {
    expect(clampWidth(2000, 2560)).toBe(2000);
    expect(clampWidth(2000, 1440)).toBe(1320);
    expect(clampWidth(2000, 1000)).toBe(960);
    expect(clampWidth(2000, 800)).toBe(800);
  });
  it('falls back to the default width for a non-number', () => {
    expect(clampWidth(Number.NaN, 1440)).toBe(960);
    expect(clampWidth(undefined, 2560)).toBe(1280);
    expect(clampWidth(Infinity, 1440)).toBe(960);
  });
});

describe('resolveWidth: the chosen width, or the default when none was chosen', () => {
  it('uses the default rule while nothing was chosen, so it tracks the viewport', () => {
    expect(resolveWidth(null, 1440)).toBe(960);
    expect(resolveWidth(null, 2560)).toBe(1280);
  });
  it('clamps a chosen width to the current viewport', () => {
    expect(resolveWidth(1200, 1440)).toBe(1200);
    expect(resolveWidth(1200, 1100)).toBe(980);
  });
});

// Revision 4, point 1: the middle divider sets the viewer's share between 30% and 75%.
describe('clampSplit: the viewer share, 30% to 75%, default 50%', () => {
  it('keeps a share inside the range, to a tenth of a percent', () => {
    expect(clampSplit(50)).toBe(50);
    expect(clampSplit(62.345)).toBe(62.3);
  });
  it('clamps to 30% and 75%', () => {
    expect(clampSplit(10)).toBe(30);
    expect(clampSplit(90)).toBe(75);
  });
  it('falls back to 50% for a non-number', () => {
    expect(clampSplit(Number.NaN)).toBe(50);
    expect(clampSplit(undefined)).toBe(50);
    expect(clampSplit(-Infinity)).toBe(50);
  });
  it('the constants are those of the spec', () => {
    expect([SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT]).toEqual([30, 75, 50]);
  });
  it('resolveSplit uses 50% while nothing was chosen', () => {
    expect(resolveSplit(null)).toBe(50);
    expect(resolveSplit(80)).toBe(75);
  });
});

describe('dragWidth and dragSplit: pointer travel into a clamped value', () => {
  it('dragging the outer edge left widens the overlay by the distance moved', () => {
    expect(dragWidth(960, 500, 400, 1440)).toBe(1060);
    expect(dragWidth(1060, 400, 450, 1440)).toBe(1010);
  });
  it('the dragged width stays within the bounds', () => {
    expect(dragWidth(960, 500, 0, 1440)).toBe(1320);
    expect(dragWidth(960, 500, 900, 1440)).toBe(960);
  });
  it('dragging the divider left grows the viewer share, as a fraction of the overlay width', () => {
    expect(dragSplit(50, 600, 500, 1000)).toBe(60);
    expect(dragSplit(50, 600, 650, 1000)).toBe(45);
  });
  it('the dragged share stays within 30% to 75%', () => {
    expect(dragSplit(50, 600, 0, 1000)).toBe(75);
    expect(dragSplit(50, 600, 1600, 1000)).toBe(30);
  });
  it('an unmeasured overlay leaves the share where it started', () => {
    expect(dragSplit(55, 600, 100, 0)).toBe(55);
  });
});

describe('stepWidth: the outer edge\'s keys (16 px, Shift 4×, Home/End)', () => {
  it('ArrowLeft moves the edge left, widening by 16 px; ArrowRight narrows by 16 px', () => {
    expect(stepWidth(1000, 'ArrowLeft', { viewportWidth: 1440 })).toBe(1016);
    expect(stepWidth(1000, 'ArrowRight', { viewportWidth: 1440 })).toBe(984);
  });
  it('Shift makes the step 64 px', () => {
    expect(stepWidth(1000, 'ArrowLeft', { shift: true, viewportWidth: 1440 })).toBe(1064);
    expect(stepWidth(1100, 'ArrowRight', { shift: true, viewportWidth: 1440 })).toBe(1036);
  });
  it('the steps stay within the bounds', () => {
    expect(stepWidth(1310, 'ArrowLeft', { viewportWidth: 1440 })).toBe(1320);
    expect(stepWidth(970, 'ArrowRight', { viewportWidth: 1440 })).toBe(960);
  });
  it('Home goes to the minimum and End to the maximum', () => {
    expect(stepWidth(1100, 'Home', { viewportWidth: 1440 })).toBe(960);
    expect(stepWidth(1100, 'End', { viewportWidth: 1440 })).toBe(1320);
  });
  it('any other key is not handled', () => {
    expect(stepWidth(1100, 'ArrowUp', { viewportWidth: 1440 })).toBeNull();
    expect(stepWidth(1100, 'Enter', { viewportWidth: 1440 })).toBeNull();
  });
});

describe('stepSplit: the divider\'s keys (2%, Shift 4×, Home/End)', () => {
  it('ArrowLeft moves the divider left, growing the viewer by 2%; ArrowRight shrinks it', () => {
    expect(stepSplit(50, 'ArrowLeft')).toBe(52);
    expect(stepSplit(50, 'ArrowRight')).toBe(48);
  });
  it('Shift makes the step 8%', () => {
    expect(stepSplit(50, 'ArrowLeft', { shift: true })).toBe(58);
    expect(stepSplit(50, 'ArrowRight', { shift: true })).toBe(42);
  });
  it('the steps stay within 30% to 75%', () => {
    expect(stepSplit(74, 'ArrowLeft', { shift: true })).toBe(75);
    expect(stepSplit(31, 'ArrowRight')).toBe(30);
  });
  it('Home goes to 30% and End to 75%', () => {
    expect(stepSplit(50, 'Home')).toBe(30);
    expect(stepSplit(50, 'End')).toBe(75);
  });
  it('any other key is not handled', () => {
    expect(stepSplit(50, 'ArrowDown')).toBeNull();
  });
});

/** An in-memory Storage; `broken` makes every call throw, as a blocked or private storage can. */
function memoryStorage(initial = {}, { broken = false } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => { if (broken) throw new Error('SecurityError'); };
  return {
    data,
    getItem: (k) => { guard(); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { guard(); data.set(k, String(v)); },
    removeItem: (k) => { guard(); data.delete(k); },
  };
}

describe('storage: per browser, under the spec\'s keys, never throwing', () => {
  it('uses the keys niyantranCitationOverlayWidth and niyantranCitationSplit', () => {
    expect(WIDTH_STORAGE_KEY).toBe('niyantranCitationOverlayWidth');
    expect(SPLIT_STORAGE_KEY).toBe('niyantranCitationSplit');
  });
  it('reads a stored width, re-clamped to the current viewport', () => {
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: '1200' }), 1440)).toBe(1200);
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: '2000' }), 1440)).toBe(1320);
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: '100' }), 1440)).toBe(960);
  });
  it('keeps a stored width as it is while the viewport is unknown', () => {
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: '1200' }), 0)).toBe(1200);
  });
  it('reads a stored share, re-clamped to 30% to 75%', () => {
    expect(readStoredSplit(memoryStorage({ niyantranCitationSplit: '62.5' }))).toBe(62.5);
    expect(readStoredSplit(memoryStorage({ niyantranCitationSplit: '99' }))).toBe(75);
  });
  it('returns null for nothing stored, junk, a missing storage or a throwing one', () => {
    expect(readStoredWidth(memoryStorage(), 1440)).toBeNull();
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: 'wide' }), 1440)).toBeNull();
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: '' }), 1440)).toBeNull();
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: '-5' }), 1440)).toBeNull();
    expect(readStoredSplit(memoryStorage({ niyantranCitationSplit: 'half' }))).toBeNull();
    expect(readStoredSplit(null)).toBeNull();
    expect(readStoredWidth(undefined, 1440)).toBeNull();
    expect(readStoredWidth(memoryStorage({ niyantranCitationOverlayWidth: '1200' }, { broken: true }), 1440)).toBeNull();
    expect(readStoredSplit(memoryStorage({ niyantranCitationSplit: '60' }, { broken: true }))).toBeNull();
  });
  it('writes a value, and removes the key for null (a reset)', () => {
    const storage = memoryStorage();
    writeStored(storage, WIDTH_STORAGE_KEY, 1200);
    expect(storage.data.get('niyantranCitationOverlayWidth')).toBe('1200');
    writeStored(storage, WIDTH_STORAGE_KEY, null);
    expect(storage.data.has('niyantranCitationOverlayWidth')).toBe(false);
  });
  it('never throws on a missing or throwing storage', () => {
    expect(() => writeStored(null, SPLIT_STORAGE_KEY, 60)).not.toThrow();
    expect(() => writeStored(memoryStorage({}, { broken: true }), SPLIT_STORAGE_KEY, 60)).not.toThrow();
    expect(() => writeStored(memoryStorage({}, { broken: true }), SPLIT_STORAGE_KEY, null)).not.toThrow();
  });
});

describe('overlayShift with a resized overlay', () => {
  it('the slide starts from the dock using the current width, not the default', () => {
    expect(overlayShift(1440, 547, 1200)).toBe(653);
    expect(overlayShift(1440, 547)).toBe(413);
  });
});
