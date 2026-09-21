/**
 * The committed catalogue (supabase/functions/_shared/deskCatalog.json) must
 * equal what deskCatalogBuild.js builds from src/desks/catalog.js and the
 * desk feed today. Regenerate with:
 *   npx vite-node --config vitest.config.js scripts/build-desk-catalog.mjs
 */
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import committed from '../../supabase/functions/_shared/deskCatalog.json';
import { buildDeskCatalog } from './deskCatalogBuild.js';
import { deskRowsFor, installDiskFetch } from './deskRowsFeed.js';

const PUBLIC_DIR = resolve(__dirname, '../../public');

let restore;
beforeAll(() => {
  restore = installDiskFetch(PUBLIC_DIR);
});
afterAll(() => restore?.());

describe('desk catalogue', () => {
  it('is not stale relative to catalog.js and the desk feed', async () => {
    const fresh = await buildDeskCatalog({
      rowsFor: async (mod) => (await deskRowsFor(mod, { publicDir: PUBLIC_DIR, fallbackSnapshot: '2026-09-21T00:00:00.000Z' })).rows.length,
    });
    expect(committed.entries.length, 'entry count').toBe(fresh.length);
    for (let i = 0; i < fresh.length; i++) {
      expect(committed.entries[i], `entry ${i}: ${fresh[i].feature}`).toEqual(fresh[i]);
    }
  }, 60_000);

  it('names every module once per desk', () => {
    const seen = new Set();
    for (const e of committed.entries) {
      const k = `${e.tier}|${e.feature}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });
});
