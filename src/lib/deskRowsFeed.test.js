/**
 * The loader's source, driven exactly as the loader drives it, over every
 * catalogue module. Guards: the keys the loader stores are the keys the desk
 * computes for the same rows (so "Open in desk" and the selected-row path
 * resolve), a row re-keys identically from its stored slim form (what the
 * panel sends back), the big registers are complete, and collisions stay
 * rare. The per-module table is printed for the plan's verification record.
 */
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deskRowKey } from './deskRows.js';
import { deskRowsFor, installDiskFetch, loadableModules, tabForModule } from './deskRowsFeed.js';

const PUBLIC_DIR = resolve(__dirname, '../../public');
const RUN_AT = '2026-09-21T00:00:00.000Z';

/** Registers whose row counts are fixed by the shipped packs (2026-09-21). */
const EXPECTED_ROWS = {
  'Bill Passage Probability Index': 9817, // 9,819 pack rows, 2 key collisions
  'Policy Intelligence Graph': 9817,
  'Parliamentary Question Database': 8000,
  'Candidate Affidavit Database (Structured + API)': 483,
  'MP Profiles & Performance (MPLAD, attendance, debates)': 780,
  'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)': 121,
};

let restore;
let results;
beforeAll(async () => {
  restore = installDiskFetch(PUBLIC_DIR);
  results = [];
  for (const { mod } of loadableModules()) {
    const r = await deskRowsFor(mod, { publicDir: PUBLIC_DIR, fallbackSnapshot: RUN_AT });
    results.push(r);
  }
}, 120_000);
afterAll(() => restore?.());

describe('installDiskFetch', () => {
  it('serves relative /data paths from disk and keeps the pipeline offline: absolute URLs get a 404, never the network', async () => {
    const saved = globalThis.fetch;
    const seen = [];
    const upstream = async (input) => {
      seen.push(String(input));
      return new Response('upstream', { status: 299 });
    };
    globalThis.fetch = upstream;
    const undo = installDiskFetch(PUBLIC_DIR);
    try {
      const local = await fetch('/data/embedded_csv/_manifest.json');
      expect(local.status).toBe(200);
      expect(Array.isArray(await local.json())).toBe(true);
      expect((await fetch('/data/nope.json')).status).toBe(404);
      expect((await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/ind.1/scoreboard')).status).toBe(404);
      expect(seen).toEqual([]);
    } finally {
      undo();
      expect(globalThis.fetch).toBe(upstream);
      globalThis.fetch = saved;
    }
  });
});

describe('desk feed rows (the loader source)', () => {
  it('every catalogue module resolves to a desk tab', () => {
    for (const { mod } of loadableModules()) expect(tabForModule(mod), mod.htmlFeature).toBeTruthy();
  });

  it('prints the per-module table', () => {
    const lines = results.map(
      (r) =>
        `${r.tab.padEnd(13)} ${r.feature.padEnd(58)} shown ${String(r.shown).padStart(5)}  rows ${String(r.rows.length).padStart(5)}  collisions ${String(r.collisions.length).padStart(3)}  snapshot ${r.snapshot.source}`,
    );
    console.log(`\ndesk feed rows, ${results.length} modules\n${lines.join('\n')}\n`);
    expect(results.length).toBeGreaterThanOrEqual(70);
    expect(results.filter((r) => r.rows.length > 0).length).toBeGreaterThanOrEqual(30);
  });

  it('the big registers are complete', () => {
    for (const [feature, n] of Object.entries(EXPECTED_ROWS)) {
      const r = results.find((x) => x.feature === feature);
      expect(r, feature).toBeTruthy();
      expect(r.rows.length, `${feature}: rows`).toBe(n);
    }
  });

  it('collisions stay rare: at most 1 % of shown rows in any module', () => {
    for (const r of results) {
      if (!r.shown) continue;
      expect(r.collisions.length / r.shown, `${r.feature}: ${r.collisions.length} collisions in ${r.shown} rows`).toBeLessThanOrEqual(0.01);
    }
  });

  it('every stored row re-keys to its row_key from its slim form', () => {
    let checked = 0;
    for (const r of results) {
      for (const row of r.rows) {
        expect(deskRowKey(row.row), `${r.feature}: ${row.row_key}`).toBe(row.row_key);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30_000);
  });

  it('bill rows carry document keys; other modules do not', () => {
    const bills = results.find((x) => x.feature === 'Bill Passage Probability Index');
    const keyed = bills.rows.filter((r) => r.document_key).length;
    expect(keyed).toBe(bills.rows.length);
    // one 1972 Rajya Sabha number carries a space from the source ("XXX II"); keys are data, not validated
    expect(bills.rows.every((r) => /^bill:\d{4}:.+$/.test(r.document_key))).toBe(true);
    const questions = results.find((x) => x.feature === 'Parliamentary Question Database');
    expect(questions.rows.every((r) => r.document_key === null)).toBe(true);
  });

  it('snapshots are ISO timestamps with a named source', () => {
    for (const r of results) {
      expect(['meta', 'rows', 'mtime', 'run']).toContain(r.snapshot.source);
      expect(new Date(r.snapshot.at).toISOString()).toBe(r.snapshot.at);
      for (const row of r.rows) expect(row.snapshot_at).toBe(r.snapshot.at);
    }
  });
});
