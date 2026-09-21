// Client mirror of the marker grammar in supabase/functions/_shared/citations.ts.
// Splits assistant text into strings and { citation: n } tokens so the markdown
// renderer can draw a bubble per marker. Groups and ranges expand the same way
// the server expands them; anything invalid stays text. Parity is proven on
// src/lib/__fixtures__/citations.json by both test suites.

export const MAX_CITATION_ID = 99;
export const MAX_RANGE_SPAN = 5;

const MARKER_RE = /\[([0-9](?:[0-9\s,–-]*[0-9])?)\](?!\()/g;

export function parseCitationIds(inner) {
  const ids = [];
  for (const part of String(inner).split(',')) {
    const p = part.trim();
    if (!p) return [];
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(p);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a < 1 || b < a || b > MAX_CITATION_ID || b - a > MAX_RANGE_SPAN) return [];
      for (let i = a; i <= b; i++) ids.push(i);
      continue;
    }
    if (!/^\d+$/.test(p)) return [];
    const n = Number(p);
    if (n < 1 || n > MAX_CITATION_ID) return [];
    ids.push(n);
  }
  return ids;
}

/** @returns {Array<string | { citation: number }>} */
export function splitCitationMarkers(text) {
  const src = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(MARKER_RE)) {
    const ids = parseCitationIds(m[1]);
    if (!ids.length) continue;
    if (m.index > last) out.push(src.slice(last, m.index));
    for (const n of ids) out.push({ citation: n });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}
