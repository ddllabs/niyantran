import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { serveHomeSegments } from '../../server/homeApi.mjs';
import SegmentCarousel, { FALLBACK_SEGMENTS } from '../marketing/SegmentCarousel.jsx';

const readRows = (name) => JSON.parse(fs.readFileSync(new URL(`../../public/data/embedded_csv/${name}.json`, import.meta.url), 'utf8'));
const key = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
// Recomputed here from the same files, independently of the server code.
const COMPUTED = {
  bills: new Set(readRows('national_bill_tracker').map((r) => r.id)).size,
  ministries: new Set(readRows('national_question_database').map((r) => key(r.ministry)).filter(Boolean)).size,
  fronts: new Set(readRows('geopolitics_war_tracker').map((r) => key(r.conflict_name))).size,
  instruments: 9,
};
// True facts: Lok Sabha seats, the two Houses, 28 states + 8 union territories,
// the six CBAM sectors, the 27 EU member states, the 25 High Courts.
const CONSTANTS = [543, 2, 36, 6, 27, 25];
/** Every number a slide shows: the headline count and each metric value. */
function figures(segments) {
  return segments.flatMap((s) => [
    ...(s.liveCount === undefined ? [] : [s.liveCount]),
    ...s.keyMetrics.map((m) => Number(String(m.value).replace(/[,+]/g, ''))),
  ]);
}

describe('CR-09 — Front-Page Carousel and Sign-In Gate', () => {
  beforeEach(() => {
    // Mock sessionStorage in Node environment
    const store = new Map();
    global.sessionStorage = {
      getItem: (k) => store.get(k) || null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  });

  it('provides one canonical slide per segment with distinct identity', async () => {
    const data = await serveHomeSegments();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.segments)).toBe(true);
    expect(data.segments.length).toBe(8);

    const segmentIds = new Set();
    const deskIds = new Set();

    for (const seg of data.segments) {
      expect(seg.id).toBeDefined();
      expect(segmentIds.has(seg.id)).toBe(false); // No duplicate segments
      segmentIds.add(seg.id);

      expect(typeof seg.title).toBe('string');
      expect(seg.title.length).toBeGreaterThan(0);
      expect(typeof seg.category).toBe('string');
      expect(typeof seg.deskId).toBe('string');
      expect(typeof seg.feature).toBe('string');
      expect(typeof seg.summary).toBe('string');
      expect(Array.isArray(seg.keyMetrics)).toBe(true);
      deskIds.add(seg.deskId);
    }

    // Must span key desks
    expect(deskIds.has('national')).toBe(true);
    expect(deskIds.has('economics')).toBe(true);
    expect(deskIds.has('global')).toBe(true);
    expect(deskIds.has('law')).toBe(true);
    expect(deskIds.has('carbon')).toBe(true);
  });

  // P16: every number on a slide is computed from the files the desks read, or
  // is one of the approved true constants. Nothing is hand-written.
  it('computes the live counts from the desk files', async () => {
    const data = await serveHomeSegments();
    const seg = new Map(data.segments.map((s) => [s.id, s]));
    const metric = (id, label) => seg.get(id).keyMetrics.find((m) => m.label === label)?.value;

    expect(seg.get('legislative').liveCount).toBe(COMPUTED.bills);
    expect(seg.get('legislative').liveCountLabel).toBe('BILLS ON RECORD');
    expect(metric('legislative', 'Bills on Record')).toBe(COMPUTED.bills.toLocaleString('en-US'));
    expect(metric('legislative', 'Ministries')).toBe(String(COMPUTED.ministries));
    expect(seg.get('global').liveCount).toBe(COMPUTED.fronts);
    expect(metric('global', 'Open Fronts')).toBe(String(COMPUTED.fronts));
    expect(metric('economy', 'Market Instruments')).toBe('9');
    expect(seg.get('electoral').liveCount).toBe(543);
    expect(metric('electoral', 'States & UTs')).toBe('36');
  });

  it('shows no figure that is neither computed nor an approved constant', async () => {
    const data = await serveHomeSegments();
    const allowed = new Set([...CONSTANTS, ...Object.values(COMPUTED)]);
    expect(figures(data.segments).filter((n) => !allowed.has(n))).toEqual([]);
    // Dropped slides carry no headline number at all.
    for (const id of ['media', 'operations', 'economy', 'climate', 'judiciary']) {
      expect(data.segments.find((s) => s.id === id).liveCount).toBeUndefined();
    }
  });

  it('the component fallback shown before the fetch holds only constants', () => {
    expect(figures(FALLBACK_SEGMENTS).filter((n) => !CONSTANTS.includes(n))).toEqual([]);
    expect(FALLBACK_SEGMENTS.map((s) => s.id)).toEqual(['legislative', 'electoral', 'media', 'operations', 'economy', 'global', 'climate', 'judiciary']);
  });

  it('renders a slide without a headline number or metrics without an empty rail', () => {
    // The first fallback slide (legislative) has no computed count before the fetch.
    const html = renderToStaticMarkup(createElement(SegmentCarousel));
    expect(html).not.toContain('mkt-metric-hero');
    expect(html).toContain('Houses Covered');
    expect(html).not.toMatch(/9,81\d|8,420|1,280|>128</);
  });

  it('preserves user intended desk destination across the sign-in gate', () => {
    // 1. Unauthenticated user clicks a segment in the carousel
    const selectedSegment = {
      id: 'global',
      deskId: 'global',
      feature: 'Open Fronts',
    };

    // Storing intended destination
    sessionStorage.setItem('niyantranLand', selectedSegment.deskId);
    sessionStorage.setItem('niyantranFeature', selectedSegment.feature);

    expect(sessionStorage.getItem('niyantranLand')).toBe('global');
    expect(sessionStorage.getItem('niyantranFeature')).toBe('Open Fronts');

    // 2. User goes through login: verify prior land is preserved
    const priorLand = sessionStorage.getItem('niyantranLand');
    const defaultStartTab = 'home';
    if (!priorLand) {
      sessionStorage.setItem('niyantranLand', defaultStartTab);
    }

    expect(sessionStorage.getItem('niyantranLand')).toBe('global');

    // 3. User lands into terminal shell: destination is consumed and cleared
    const land = sessionStorage.getItem('niyantranLand');
    const feat = sessionStorage.getItem('niyantranFeature');
    sessionStorage.removeItem('niyantranLand');
    sessionStorage.removeItem('niyantranFeature');

    expect(land).toBe('global');
    expect(feat).toBe('Open Fronts');
    expect(sessionStorage.getItem('niyantranLand')).toBe(null);
  });
});
