// The eight desks with their sectors and modules, generated from nter.pro's own presentation
// files (scripts/export-sample.mjs), so the app always shows the site's structure and wording.
import DESKS_RAW from '../sample/desks.json';
import { asset } from '../lib/asset.js';

export const DESK_ICON = { national: 'building', global: 'globe', state: 'map', law: 'scale', economics: 'chart', carbon: 'leaf', sports: 'trophy', entertainment: 'film' };

// The site's hashed image paths (/images/desks-v6/<hash>.<ext>) are shipped as WebP in /desks.
export function deskImg(img) {
  if (!img) return null;
  if (typeof img === 'object' && img.layers) return deskImg(img.layers[0]);
  const m = /desks-v6\/([0-9a-f]+)\.(jpg|jpeg|png|svg)$/i.exec(String(img));
  if (!m) return String(img);
  return asset(`/desks/${m[1]}.${m[2].toLowerCase() === 'svg' ? 'svg' : 'webp'}`);
}
export function deskImgLayers(img) {
  if (img && typeof img === 'object' && img.layers) return img.layers.map(deskImg);
  return [deskImg(img)].filter(Boolean);
}

export const DESKS = DESKS_RAW.map((d) => ({
  ...d,
  icon: DESK_ICON[d.id] || 'globe',
  titleText: Array.isArray(d.title) ? d.title.join(' ') : d.title,
  moduleCount: d.groups.reduce((n, g) => n + g.modules.length, 0),
}));
export const deskById = (id) => DESKS.find((d) => d.id === id) || null;

export const ALL_MODULES = DESKS.flatMap((d) => d.groups.flatMap((g, gi) => g.modules.map((m) => ({ ...m, desk: d.id, deskName: d.name, group: g.id, groupIndex: gi, groupName: g.name }))));
export const moduleKey = (m) => `${m.tier}::${m.feature}`;

export function searchModules(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  return ALL_MODULES.filter((m) => `${m.title} ${m.feature} ${m.groupName} ${m.deskName}`.toLowerCase().includes(s)).slice(0, 30);
}

// Modules the site pages on the server (src/lib/pagedFeatures.js).
export const PAGED_FEATURES = new Set(['Bill Passage Probability Index', 'Parliamentary Question Database', 'NCLT / NCLAT (Insolvency)']);
