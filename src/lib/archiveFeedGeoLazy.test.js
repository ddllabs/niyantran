// F158: the Goa booth geography pack (src/data/niy-geo.json, about 120 KB compressed) was imported
// at the top of archiveFeed.js, so it travelled in a chunk every terminal visit loads. It now loads
// only when a geography module (a booth or state electoral-roll module) opens. These tests count
// how often the pack module is evaluated and make it fail to load, the way a lost chunk would.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const geo = vi.hoisted(() => ({ loads: 0, fail: false }));
const mode = vi.hoisted(() => ({ api: false }));

vi.mock('./apiMode.js', () => ({ featureFeedApiEnabled: () => mode.api, liveApiEnabled: () => false }));

const BOOTH = { tier: 'local', feature: 'Booth Register' };
const LOAD_ERROR = /Failed to fetch dynamically imported module: niy-geo/;
// vitest wraps an error thrown by a mock factory; the load error is its cause.
const errorText = (e) => `${e?.message} ${e?.cause?.message || ''}`;
const OTHER = { tier: 'geopolitics', feature: 'Alliances' };

beforeEach(() => {
  vi.resetModules();
  geo.loads = 0;
  geo.fail = false;
  mode.api = false;
  // Registered afresh for each test: a mocked module's result is otherwise kept across resetModules.
  vi.doMock('../data/niy-geo.json', async (importOriginal) => {
    geo.loads += 1;
    if (geo.fail) throw new Error('Failed to fetch dynamically imported module: niy-geo.json');
    return importOriginal();
  });
});

describe('Goa geography pack loads on demand (F158)', () => {
  it('is not loaded when the archive loads or a non-geography module opens', async () => {
    const { fetchArchiveFeature } = await import('./archiveFeed.js');
    const other = await fetchArchiveFeature(OTHER);
    expect(other.rows.length).toBeGreaterThan(0);
    expect(geo.loads).toBe(0);
  });

  it('is loaded when a booth module opens, and the module still gets its Goa rows', async () => {
    const { fetchArchiveFeature } = await import('./archiveFeed.js');
    expect(geo.loads).toBe(0);
    const booth = await fetchArchiveFeature(BOOTH);
    expect(geo.loads).toBe(1);
    expect(booth.source.kind).toBe('geo-pack');
    expect(booth.meta.state).toBe('Goa');
    expect(booth.rows.length).toBeGreaterThan(0);
  });

  it('when the pack cannot load, the booth module fails and other modules still open', async () => {
    geo.fail = true;
    const { fetchArchiveFeature } = await import('./archiveFeed.js');
    expect((await fetchArchiveFeature(OTHER)).rows.length).toBeGreaterThan(0);
    await expect(fetchArchiveFeature(BOOTH).then(() => 'resolved', errorText)).resolves.toMatch(LOAD_ERROR);
  });

  it('the failure reaches the desk as an error (no API on this host), so the module shows its error state', async () => {
    geo.fail = true;
    const { fetchFeature } = await import('./featureFeed.js');
    await expect(fetchFeature(BOOTH).then(() => 'resolved', errorText)).resolves.toMatch(LOAD_ERROR);
  });
});
