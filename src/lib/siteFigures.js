import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

// Figures shown on the marketing pages. Bills and documents were measured on
// NTER on 2026-10-12 (read-only query): 9,817 rows in the national bill desk,
// the same unique-ID count the home carousel computes, and 3,431 indexed
// full-text documents. Re-measure before changing them; never type a guess.
export const SITE_FIGURES = {
  bills: 9817,
  documents: 3431,
  modules: DESK_CATALOGUE.length,
  // F140 (owner 2026-10-13): unique source endpoint URLs in src/data/source-registry.json (the seed
  // registry), counted 2026-10-14. siteFigures.test.js recounts the registry and fails if they drift.
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
