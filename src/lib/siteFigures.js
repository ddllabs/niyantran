import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

// Figures shown on the marketing pages. Bills and documents were measured on
// NTER on 2026-10-12 (read-only query): 9,817 rows in the national bill desk,
// the same unique-ID count the home carousel computes, and 3,431 indexed
// full-text documents. Re-measure before changing them; never type a guess.
export const SITE_FIGURES = {
  bills: 9817,
  documents: 3431,
  modules: DESK_CATALOGUE.length,
};

export const figure = (n) => n.toLocaleString('en-IN');
