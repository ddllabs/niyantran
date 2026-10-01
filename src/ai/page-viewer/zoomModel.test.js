import { describe, expect, it, vi } from 'vitest';
import {
  CSS_PX_PER_PT, DEFAULT_ZOOM, ZOOM_KEY, ZOOM_STEPS, boxRect, contentBox, layoutPage, nextZoomStep, readZoomState,
  wheelZoomFactor, writeZoomState, zoomBy, zoomReadout,
} from './zoomModel.js';

/** An A4 page in PDF points. */
const A4 = { width: 595, height: 842 };
const body = (x0, y0, x1, y1, type = 'text') => ({ type, x0, y0, x1, y1 });
const close = (actual, expected) => expect(actual).toBeCloseTo(expected, 6);

describe('contentBox', () => {
  it('is the union of the body blocks plus 2% padding', () => {
    const box = contentBox([body(0.3, 0.2, 0.6, 0.4), body(0.25, 0.5, 0.7, 0.8)]);
    close(box.x0, 0.23);
    close(box.y0, 0.18);
    close(box.x1, 0.72);
    close(box.y1, 0.82);
  });

  it('leaves out header and footer blocks and keeps margin notes', () => {
    const box = contentBox([
      body(0.05, 0.01, 0.95, 0.04, 'header'),
      body(0.3, 0.2, 0.6, 0.4),
      body(0.1, 0.3, 0.2, 0.35, 'aside_text'),
      body(0.05, 0.96, 0.95, 0.99, 'footer'),
    ]);
    close(box.x0, 0.08);
    close(box.y0, 0.18);
    close(box.x1, 0.62);
    close(box.y1, 0.42);
  });

  it('clamps the padded box to the page', () => {
    expect(contentBox([body(0.005, 0, 1, 0.99)])).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it('is null with no usable block: none, only header/footer, null or empty boxes', () => {
    expect(contentBox([])).toBeNull();
    expect(contentBox(undefined)).toBeNull();
    expect(contentBox([body(0.1, 0.1, 0.9, 0.2, 'header'), body(0.1, 0.9, 0.9, 0.95, 'footer')])).toBeNull();
    expect(contentBox([{ type: 'text', x0: null, y0: null, x1: null, y1: null }, body(0.4, 0.4, 0.4, 0.5)])).toBeNull();
  });

  it('widens to keep every cited box on the page inside the crop', () => {
    const box = contentBox([body(0.3, 0.2, 0.6, 0.4)], [{ page: 3, x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.3 }]);
    close(box.x0, 0.08);
  });
});

describe('layoutPage', () => {
  const blocks = [body(0.25, 0.1, 0.75, 0.9)];
  const pane = { width: 480, height: 600 };

  it('Fit text: the content box width fills the pane, and the page is cropped to it', () => {
    const layout = layoutPage({ state: DEFAULT_ZOOM, page: A4, pane, blocks });
    // content box 0.23..0.77 wide (0.54 of 595 pt) → 480 px.
    close(layout.scale, 480 / (0.54 * 595));
    expect(layout.fit).toBe('text');
    close(layout.crop.x0, 0.23);
    close(layout.crop.y1, 0.92);
    close(layout.pageCss.width, 595 * layout.scale);
    close(layout.cropCss.width, 480);
    close(layout.cropCss.height, 0.84 * 842 * layout.scale);
    close(layout.offset.left, -0.23 * layout.pageCss.width);
    close(layout.offset.top, -0.08 * layout.pageCss.height);
  });

  it('Fit text falls back to Fit width when the page has no blocks', () => {
    const layout = layoutPage({ state: DEFAULT_ZOOM, page: A4, pane, blocks: [] });
    expect(layout.fit).toBe('width');
    close(layout.scale, 480 / 595);
    expect(layout.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    close(layout.offset.left, 0);
    close(layout.offset.top, 0);
  });

  it('Fit width: the page width is the pane width, uncropped', () => {
    const layout = layoutPage({ state: { fit: 'width', zoom: null }, page: A4, pane, blocks });
    close(layout.scale, 480 / 595);
    close(layout.cropCss.width, 480);
    expect(layout.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it('Fit page: the whole page fits the pane width and the available height', () => {
    const tall = layoutPage({ state: { fit: 'page', zoom: null }, page: A4, pane, blocks });
    close(tall.scale, 600 / 842);
    expect(tall.pageCss.height).toBeLessThanOrEqual(600 + 1e-9);
    expect(tall.pageCss.width).toBeLessThanOrEqual(480);
    const wide = layoutPage({ state: { fit: 'page', zoom: null }, page: A4, pane: { width: 300, height: 2000 }, blocks });
    close(wide.scale, 300 / 595);
    const unknownHeight = layoutPage({ state: { fit: 'page', zoom: null }, page: A4, pane: { width: 300, height: 0 }, blocks });
    close(unknownHeight.scale, 300 / 595);
  });

  it('manual zoom: 100% is the natural size at 96 CSS px per inch, and keeps the fit\'s crop', () => {
    const natural = layoutPage({ state: { fit: 'width', zoom: 1 }, page: A4, pane, blocks });
    close(natural.scale, 96 / 72);
    close(natural.pageCss.width, 595 * 96 / 72);
    expect(natural.percent).toBe(100);
    expect(natural.fit).toBeNull();
    expect(natural.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const textZoom = layoutPage({ state: { fit: 'text', zoom: 2 }, page: A4, pane, blocks });
    close(textZoom.scale, 2 * CSS_PX_PER_PT);
    close(textZoom.crop.x0, 0.23);
    // Wider than the pane: the crop is wider than 480 px and scrolls inside the viewer.
    expect(textZoom.cropCss.width).toBeGreaterThan(480);
  });

  it('caps a fit at 300% so a page with one tiny block is not blown up', () => {
    const layout = layoutPage({ state: DEFAULT_ZOOM, page: A4, pane: { width: 1600, height: 900 }, blocks: [body(0.5, 0.5, 0.52, 0.51)] });
    close(layout.scale, 3 * CSS_PX_PER_PT);
    expect(layout.percent).toBe(300);
  });

  it('has the readout percent of the effective scale', () => {
    const layout = layoutPage({ state: { fit: 'width', zoom: null }, page: A4, pane, blocks });
    expect(layout.percent).toBe(Math.round((480 / 595) / CSS_PX_PER_PT * 100));
  });

  it('is null until the pane and page have a size', () => {
    expect(layoutPage({ state: DEFAULT_ZOOM, page: A4, pane: { width: 0, height: 0 }, blocks })).toBeNull();
    expect(layoutPage({ state: DEFAULT_ZOOM, page: null, pane, blocks })).toBeNull();
  });
});

describe('boxRect: highlight boxes inside the crop', () => {
  const blocks = [body(0.25, 0.1, 0.75, 0.9)];
  const layout = layoutPage({ state: DEFAULT_ZOOM, page: A4, pane: { width: 480, height: 600 }, blocks });

  it('a box at the content edge maps to the crop edge', () => {
    const edge = boxRect({ x0: layout.crop.x0, y0: layout.crop.y0, x1: layout.crop.x1, y1: layout.crop.y1 }, layout);
    close(edge.left, 0);
    close(edge.top, 0);
    close(edge.left + edge.width, layout.cropCss.width);
    close(edge.top + edge.height, layout.cropCss.height);
  });

  it('scales with the zoom, so a box keeps its place on the passage', () => {
    const zoomed = layoutPage({ state: { fit: 'text', zoom: 2 }, page: A4, pane: { width: 480, height: 600 }, blocks });
    const box = { x0: 0.3, y0: 0.5, x1: 0.6, y1: 0.55 };
    const a = boxRect(box, layout);
    const b = boxRect(box, zoomed);
    close(a.left, (0.3 - layout.crop.x0) * layout.pageCss.width);
    close(b.width / a.width, zoomed.scale / layout.scale);
  });
});

describe('zoom steps', () => {
  it('runs from 50% to 300%', () => {
    expect(ZOOM_STEPS).toEqual([0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]);
  });

  it('steps from an arbitrary effective scale to the next step each way', () => {
    expect(nextZoomStep(1.013, 1)).toBe(1.25);
    expect(nextZoomStep(1.013, -1)).toBe(1);
    expect(nextZoomStep(1, 1)).toBe(1.25);
    expect(nextZoomStep(1, -1)).toBe(0.8);
    expect(nextZoomStep(0.42, 1)).toBe(0.5);
    expect(nextZoomStep(0.672, -1)).toBe(0.5);
  });

  it('has no step past the ends', () => {
    expect(nextZoomStep(3, 1)).toBeNull();
    expect(nextZoomStep(0.5, -1)).toBeNull();
    expect(nextZoomStep(0.42, -1)).toBeNull();
  });

  it('reads out the effective percent', () => {
    expect(zoomReadout(1)).toBe('100%');
    expect(zoomReadout(1.0138)).toBe('101%');
    expect(zoomReadout(null)).toBe('—');
  });

  it('zoomBy multiplies and clamps to 50-300%', () => {
    close(zoomBy(1, 1.1), 1.1);
    expect(zoomBy(2.9, 2)).toBe(3);
    expect(zoomBy(0.6, 0.5)).toBe(0.5);
  });
});

describe('wheelZoomFactor', () => {
  it('ignores a wheel without ctrl or meta', () => {
    expect(wheelZoomFactor({ deltaY: -100 })).toBeNull();
  });

  it('zooms in on ctrl/meta wheel up (and pinch out), out on wheel down', () => {
    expect(wheelZoomFactor({ deltaY: -100, ctrlKey: true })).toBeGreaterThan(1);
    expect(wheelZoomFactor({ deltaY: 100, metaKey: true })).toBeLessThan(1);
    // A pinch sends small deltas: a small step.
    const pinch = wheelZoomFactor({ deltaY: -4, ctrlKey: true });
    expect(pinch).toBeGreaterThan(1);
    expect(pinch).toBeLessThan(1.1);
  });

  it('limits one mouse notch to a moderate step', () => {
    expect(wheelZoomFactor({ deltaY: -1000, ctrlKey: true })).toBeLessThan(1.3);
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1, ctrlKey: true })).toBeLessThan(1.3);
  });
});

describe('remembered zoom', () => {
  const memory = () => {
    const data = new Map();
    return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
  };

  it('defaults to Fit text', () => {
    expect(DEFAULT_ZOOM).toEqual({ fit: 'text', zoom: null });
    expect(readZoomState(memory())).toEqual(DEFAULT_ZOOM);
  });

  it('round-trips a fit or a manual zoom under its key', () => {
    const storage = memory();
    writeZoomState({ fit: 'page', zoom: null }, storage);
    expect(storage.data.has(ZOOM_KEY)).toBe(true);
    expect(ZOOM_KEY).toBe('niyantranCitationZoom');
    expect(readZoomState(storage)).toEqual({ fit: 'page', zoom: null });
    writeZoomState({ fit: 'text', zoom: 1.5 }, storage);
    expect(readZoomState(storage)).toEqual({ fit: 'text', zoom: 1.5 });
  });

  it('ignores a malformed or out-of-range value', () => {
    for (const raw of ['nope', '{"fit":"huge"}', '{"fit":"text","zoom":9}', '{"fit":"text","zoom":"2"}', 'null']) {
      const storage = memory();
      storage.setItem(ZOOM_KEY, raw);
      expect(readZoomState(storage)).toEqual(DEFAULT_ZOOM);
    }
  });

  it('survives storage that throws', () => {
    const throwing = { getItem: vi.fn(() => { throw new Error('blocked'); }), setItem: vi.fn(() => { throw new Error('quota'); }) };
    expect(readZoomState(throwing)).toEqual(DEFAULT_ZOOM);
    expect(() => writeZoomState({ fit: 'width', zoom: null }, throwing)).not.toThrow();
    expect(throwing.setItem).toHaveBeenCalled();
  });
});
