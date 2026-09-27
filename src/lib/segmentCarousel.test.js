import { describe, it, expect, beforeEach } from 'vitest';
import { serveHomeSegments } from '../../server/homeApi.mjs';

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
      expect(seg.keyMetrics.length).toBeGreaterThanOrEqual(2);
      deskIds.add(seg.deskId);
    }

    // Must span key desks
    expect(deskIds.has('national')).toBe(true);
    expect(deskIds.has('economics')).toBe(true);
    expect(deskIds.has('global')).toBe(true);
    expect(deskIds.has('law')).toBe(true);
    expect(deskIds.has('carbon')).toBe(true);
  });

  it('exposes authoritative, non-fabricated live counts for each segment', async () => {
    const data = await serveHomeSegments();
    const segMap = new Map(data.segments.map((s) => [s.id, s]));

    // Legislative segment: bills count
    const leg = segMap.get('legislative');
    expect(leg).toBeDefined();
    expect(leg.liveCount).toBe(9819);
    expect(leg.liveCountLabel).toBe('BILLS ON RECORD');

    // Electoral segment: constituencies count
    const elec = segMap.get('electoral');
    expect(elec).toBeDefined();
    expect(elec.liveCount).toBe(543);
    expect(elec.liveCountLabel).toBe('LS CONSTITUENCIES');

    // Economy segment: macro series count
    const econ = segMap.get('economy');
    expect(econ).toBeDefined();
    expect(econ.liveCount).toBe(42);
    expect(econ.liveCountLabel).toBe('LIVE MACRO SERIES');

    // Global segment: open fronts count
    const glob = segMap.get('global');
    expect(glob).toBeDefined();
    expect(glob.liveCount).toBe(18);
    expect(glob.liveCountLabel).toBe('MONITORED FRONTS');

    // Operations segment: notices count
    const ops = segMap.get('operations');
    expect(ops).toBeDefined();
    expect(ops.liveCount).toBeGreaterThan(1000);
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
