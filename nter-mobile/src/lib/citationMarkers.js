// Client mirror of the citation marker grammar in nter.pro's supabase/functions/_shared/citations.ts
// (the website's src/lib/citationMarkers.js). Splits assistant text into strings and
// { citation: n } tokens so the answer can draw a bubble per marker; anything invalid stays text.
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
      if (a < 1 || b < a || b > 99 || b - a > 5) return [];
      for (let i = a; i <= b; i++) ids.push(i);
      continue;
    }
    if (!/^\d+$/.test(p)) return [];
    const n = Number(p);
    if (n < 1 || n > 99) return [];
    ids.push(n);
  }
  return ids;
}
export function splitCitationMarkers(src) {
  const s = String(src ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(MARKER_RE)) {
    const ids = parseCitationIds(m[1]);
    if (!ids.length) continue;
    if (m.index > last) out.push(s.slice(last, m.index));
    for (const n of ids) out.push({ citation: n });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
