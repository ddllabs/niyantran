/**
 * The rows a desk module shows, as `desk_rows` inserts.
 *
 * The loader (scripts/load-desk-rows.mjs, under vite-node) and the guard
 * (src/lib/deskRowsFeed.test.js) both go through here, so the table holds
 * exactly what the terminal displays: fetchArchiveFeature builds the module's
 * rows from the shipped packs (public/data and src/data), prepareDeskFeed
 * applies the desk's shaping passes — including the record checklist, which
 * assigns most rows their identity — and toDeskRow keys and flattens each
 * row the way the desk does. Nothing here reads the network: fetch must be
 * served from disk (installDiskFetch) or by the browser.
 *
 * Spec: docs/specs/2026-09-20-desk-row-grounding-design.md §A and its plan
 * amendments of 2026-09-21.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../../public/data/embedded_csv/_manifest.json';
import { TABS, catalogModules } from '../desks/catalog.js';
import { fetchArchiveFeature } from './archiveFeed.js';
import { toDeskRow } from './deskRows.js';
import { prepareDeskFeed } from './prepareDeskFeed.js';

const TAB_BY_TIER = Object.fromEntries(TABS.map((t) => [t.tier, t.id]));
const FILE_BY_KEY = new Map(manifest.map((m) => [m.key, m.file]));

/** The desk tab id a feature-map module belongs to (`local` modules sit on the State desk). */
export function tabForModule(mod) {
  return TAB_BY_TIER[mod.htmlTier] || (mod.htmlTier === 'local' ? 'state' : null);
}

/** The pack file behind a module, when the manifest has one. */
export function packFileFor(mod) {
  const d = String(mod?.dataset || '').trim();
  if (!d) return null;
  return FILE_BY_KEY.get(d.endsWith('.csv') ? d : `${d}.csv`) || null;
}

/**
 * Serve the desk's relative `fetch('/data/…')` calls from `publicDir` and
 * answer everything else — absolute URLs included — with a 404, so the
 * pipeline runs offline and deterministic (the desk falls back to its
 * packs, never to a live feed). A caller that needs the network (the
 * loader's Supabase client) captures `globalThis.fetch` before installing
 * this and uses that reference. Returns a restore function.
 */
export function installDiskFetch(publicDir) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return new Response('', { status: 404 });
    const path = url.split('?')[0];
    try {
      const body = readFileSync(resolve(publicDir, `.${path}`), 'utf8');
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response('', { status: 404 });
    }
  };
  return () => {
    globalThis.fetch = previous;
  };
}

function isoOrNull(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * When the module's rows were captured: the pack's `.meta.json` `as_of`, else
 * the newest `as_of` on its rows, else the pack file's modification time,
 * else `fallback` (the loader passes its start time). `source` says which.
 */
export function snapshotFor(mod, rows, publicDir, fallback) {
  const file = packFileFor(mod);
  if (file) {
    try {
      const meta = JSON.parse(readFileSync(resolve(publicDir, 'data/embedded_csv', file.replace(/\.json$/, '.meta.json')), 'utf8'));
      const at = isoOrNull(meta.as_of);
      if (at) return { at, source: 'meta' };
    } catch {
      /* no meta file */
    }
  }
  const newest = rows.map((r) => isoOrNull(r.as_of)).filter(Boolean).sort().pop();
  if (newest) return { at: newest, source: 'rows' };
  if (file) {
    try {
      return { at: statSync(resolve(publicDir, 'data/embedded_csv', file)).mtime.toISOString(), source: 'mtime' };
    } catch {
      /* fall through */
    }
  }
  return { at: fallback, source: 'run' };
}

/**
 * Every row the desk shows for one module, as inserts, with the snapshot and
 * the keys that collided (two shown rows, one key — the last one wins).
 * Requires fetch to be served (installDiskFetch in Node).
 */
export async function deskRowsFor(mod, { publicDir, fallbackSnapshot }) {
  const tab = tabForModule(mod);
  const feed = prepareDeskFeed(await fetchArchiveFeature({ tier: mod.htmlTier, feature: mod.htmlFeature }));
  const shown = (feed?.rows || []).filter((r) => r && typeof r === 'object' && r.status !== 'source_status');
  const snapshot = snapshotFor(mod, shown, publicDir, fallbackSnapshot);
  const byKey = new Map();
  const collisions = [];
  for (const raw of shown) {
    const row = toDeskRow({ tier: tab, feature: mod.htmlFeature, raw, snapshotAt: snapshot.at });
    if (byKey.has(row.row_key)) collisions.push(row.row_key);
    byKey.set(row.row_key, row);
  }
  return { tab, feature: mod.htmlFeature, pack: packFileFor(mod), shown: shown.length, rows: [...byKey.values()], collisions, snapshot };
}

/** The catalogue modules, in desk order, with their tab. */
export function loadableModules() {
  return catalogModules()
    .map((mod) => ({ mod, tab: tabForModule(mod) }))
    .filter((x) => x.tab);
}
