import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

import { MEASURED_FIGURES } from './measuredFigures.js';

// Figures shown on the marketing pages. Bills and documents start from the last measured values
// (measuredFigures.js) and are replaced by the live counts from /api/site-figures (F142) once they
// arrive. Modules and source endpoints are counted from the code.
export const SITE_FIGURES = {
  bills: MEASURED_FIGURES.bills,
  documents: MEASURED_FIGURES.documents,
  ministries: MEASURED_FIGURES.ministries,
  fronts: MEASURED_FIGURES.fronts,
  modules: DESK_CATALOGUE.length,
  // F140 (owner 2026-10-13): the published "Source endpoints" figure. The owner kept 246 (counted
  // from src/data/source-registry.json on 2026-10-14, 189 of them per-module search URLs). F180
  // (2026-10-15) took the 131 GDELT search addresses out of the registry, which now counts 115
  // (registryEndpointCount); whether the homepage shows 115 is the owner's decision, so the published
  // figure stays 246 until then.
  endpoints: 246,
};

/** Unique source endpoint URLs across a registry's `sourceUrls` lists (newline- or pipe-separated). */
export function registryEndpointCount(registry) {
  const urls = new Set();
  for (const entry of registry || []) {
    for (const url of String(entry?.sourceUrls || '').split(/\s*\|\s*|\s+/)) if (/^https?:\/\//.test(url)) urls.add(url);
  }
  return urls.size;
}

export const figure = (n) => n.toLocaleString('en-IN');
