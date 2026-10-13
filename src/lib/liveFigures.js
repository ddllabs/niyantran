// F142 (owner 2026-10-14): the marketing pages' live counts. Pages render the measured figures
// (SITE_FIGURES) at once and swap in the counts from /api/site-figures when they arrive. One request
// at a time, shared by every figure on the page; a failure is forgotten (the next page asks again) and
// a good answer is reused for 15 minutes, as long as the server keeps it.
const LIVE_FIELDS = ['bills', 'documents', 'ministries', 'fronts'];
const REUSE_MS = 15 * 60 * 1000;
let pending = null;
let fetchedAt = 0;

export function resetLiveFigures() {
  pending = null;
  fetchedAt = 0;
}

/** The server's answer, or null on any failure (the page keeps the measured figures). */
export function fetchSiteFigures(fetchImpl = globalThis.fetch, now = Date.now) {
  if (pending && now() - fetchedAt > REUSE_MS) pending = null;
  if (!pending) {
    fetchedAt = now();
    const request = Promise.resolve()
      .then(() => fetchImpl('/api/site-figures'))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null)
      .then((body) => {
        if (body === null && pending === request) pending = null;
        return body;
      });
    pending = request;
  }
  return pending;
}

/** `base` with each live count that is a positive whole number; modules and endpoints stay as in code. */
export function mergeLiveFigures(base, live) {
  if (!live || typeof live !== 'object') return base;
  const next = { ...base };
  for (const k of LIVE_FIELDS) if (Number.isInteger(live[k]) && live[k] > 0) next[k] = live[k];
  return next;
}
