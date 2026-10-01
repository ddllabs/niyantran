import { describe, expect, it } from 'vitest';
import { NARROW_QUERY, REDUCED_MOTION_QUERY, nextPhase, overlayShift, overlayWidth } from './citationOverlayModel.js';

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
