// F142 (owner 2026-10-14): the marketing pages' live counts. Pages render the measured figures
// (SITE_FIGURES) at once and swap in the counts from /api/site-figures when they arrive. One request
// per page load, shared by every figure on the page.
const LIVE_FIELDS = ['bills', 'documents', 'ministries', 'fronts'];
let pending = null;

export function resetLiveFigures() {
  pending = null;
}

/** The server's answer, or null on any failure (the page keeps the measured figures). */
export function fetchSiteFigures(fetchImpl = globalThis.fetch) {
  pending ??= Promise.resolve()
    .then(() => fetchImpl('/api/site-figures'))
    .then((r) => (r && r.ok ? r.json() : null))
    .catch(() => null);
  return pending;
}

/** `base` with each live count that is a positive whole number; modules and endpoints stay as in code. */
export function mergeLiveFigures(base, live) {
  if (!live || typeof live !== 'object') return base;
  const next = { ...base };
  for (const k of LIVE_FIELDS) if (Number.isInteger(live[k]) && live[k] > 0) next[k] = live[k];
  return next;
}
