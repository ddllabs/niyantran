import { DESK_CATALOGUE_IDENTITY as DESK_CATALOGUE } from '../desks/landing/deskCatalogueIdentity.js';

import PREVIEW from '../data/preview-figures.json';

// Figures shown on the marketing pages, before the live counts from /api/site-figures (F142) arrive.
// Bills and fronts start from the build-time snapshot (src/data/preview-figures.json, rebuilt by
// scripts/build-preview-figures.mjs from the files the desks read). Documents and ministries have no
// build-time source, so they are null ("—") until the live counts arrive; they are never a stale number.
// Modules, desks and source endpoints are counted from the code and the source registry.
export const SITE_FIGURES = {
  bills: PREVIEW.bills.total,
  documents: null,
  ministries: null,
  fronts: PREVIEW.fronts.fronts,
  modules: DESK_CATALOGUE.length,
  // F212: the hero's "Intelligence desks", one per desk tab: the count pricing and the proof card use (F30).
  desks: new Set(DESK_CATALOGUE.map((m) => m.tab)).size,
  // The unique source endpoint URLs in the source registry, counted at build time (registryEndpointCount).
  // It was a hand-kept 246 (F140) while the registry held fewer; the page shows what the registry holds.
  endpoints: PREVIEW.endpoints,
};

export { registryEndpointCount } from './previewFigures.js';

// A count that is not known (null) is shown as an em dash, never as zero or an old number.
export const figure = (n) => (Number.isFinite(n) ? n.toLocaleString('en-IN') : '—');
