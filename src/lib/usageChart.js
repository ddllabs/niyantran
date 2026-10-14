/**
 * The Credits usage chart's model (F153, spec "Charts (no library)"): pure functions, so the SVG and
 * its table fallback draw the same numbers and tests can check them without a browser.
 *
 * Series are models (or providers). The seven largest over the range keep a colour of their own; the
 * rest are one "Other" series. A colour comes from a stable hash of the series key, so a model keeps
 * its colour from one range to the next; two keys that hash alike take the next free slot, in key
 * order, so the assignment never depends on ranking.
 */
import { modelName, providerName, providerOf } from './creditUsage.js';

export const MAX_SERIES = 7;
export const OTHER = '__other';
/** Slot 7 is "Other". The colours themselves are CSS tokens (--cu-s0 … --cu-s7), light and dark. */
export const OTHER_SLOT = 7;

function hash(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** key -> colour slot 0..6, by hash with linear probing over the keys in sorted order. */
export function colorSlots(keys) {
  const slots = new Map();
  const taken = new Set();
  for (const key of [...new Set(keys)].sort()) {
    let slot = hash(key) % MAX_SERIES;
    for (let i = 0; i < MAX_SERIES && taken.has(slot); i++) slot = (slot + 1) % MAX_SERIES;
    taken.add(slot);
    slots.set(key, slot);
  }
  return slots;
}

/** Gridline values: zero and four steps of a round size whose top reaches `max`. */
export function niceTicks(max, steps = 4) {
  const target = Math.max(Number(max) || 0, 0) / steps;
  if (target <= 0) return Array.from({ length: steps + 1 }, (_, i) => i);
  const power = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= target - 1e-12) || 10 * power;
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

const DAY_LABEL = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const MONTH_LABEL = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' });

/** '2026-10-14' -> '14 Oct' (a day) or 'Oct 2026' (a month). The date is already an IST date. */
export function bucketLabel(bucket, kind = 'day') {
  const at = Date.parse(`${bucket}T00:00:00Z`);
  if (!Number.isFinite(at)) return String(bucket || '');
  return (kind === 'month' ? MONTH_LABEL : DAY_LABEL).format(at);
}

function keyOf(point, groupBy) {
  return groupBy === 'provider' ? providerOf(point.model) : point.model;
}

export function seriesLabel(key, groupBy) {
  if (key === OTHER) return 'Other';
  return groupBy === 'provider' ? providerName(key) : modelName(key);
}

/**
 * The stacked bars for one measure. `points` are the server's series elements ({bucket, model,
 * credits, calls, tokens}; model null for an empty bucket). Hidden series stay in the legend with
 * their totals but leave the bars and the scale.
 */
export function buildChart(points, { measure = 'credits', groupBy = 'model', hidden = new Set(), bucketKind = 'day' } = {}) {
  const list = Array.isArray(points) ? points : [];
  const order = [];
  const seen = new Set();
  const totals = new Map();
  for (const p of list) {
    if (!seen.has(p.bucket)) { seen.add(p.bucket); order.push(p.bucket); }
    if (!p.model) continue;
    const key = keyOf(p, groupBy);
    totals.set(key, (totals.get(key) || 0) + (Number(p[measure]) || 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const own = ranked.slice(0, MAX_SERIES).map(([key]) => key);
  const ownSet = new Set(own);
  const slots = colorSlots(own);
  const grand = ranked.reduce((sum, [, v]) => sum + v, 0);
  const otherTotal = ranked.slice(MAX_SERIES).reduce((sum, [, v]) => sum + v, 0);
  const series = own.map((key) => ({ key, label: seriesLabel(key, groupBy), slot: slots.get(key), total: totals.get(key) }));
  // An empty Other (models past the seventh with nothing on this measure) is left out of the legend.
  if (ranked.length > MAX_SERIES && otherTotal > 0) series.push({ key: OTHER, label: 'Other', slot: OTHER_SLOT, total: otherTotal });
  for (const s of series) {
    s.share = grand > 0 ? (100 * s.total) / grand : 0;
    s.hidden = hidden.has(s.key);
  }
  const visible = series.filter((s) => !s.hidden);

  const byBucket = new Map(order.map((b) => [b, new Map()]));
  for (const p of list) {
    if (!p.model) continue;
    const key = ownSet.has(keyOf(p, groupBy)) ? keyOf(p, groupBy) : OTHER;
    const cells = byBucket.get(p.bucket);
    cells.set(key, (cells.get(key) || 0) + (Number(p[measure]) || 0));
  }
  const buckets = order.map((bucket) => {
    const cells = byBucket.get(bucket);
    let y = 0;
    const segments = [];
    for (const s of visible) {
      const value = cells.get(s.key) || 0;
      if (value > 0) segments.push({ key: s.key, label: s.label, slot: s.slot, value, y0: y, y1: y + value });
      y += value;
    }
    const values = series.map((s) => ({ key: s.key, label: s.label, slot: s.slot, value: cells.get(s.key) || 0, hidden: s.hidden }));
    return { bucket, label: bucketLabel(bucket, bucketKind), total: y, segments, values };
  });
  const max = buckets.reduce((m, b) => Math.max(m, b.total), 0);
  return { measure, groupBy, bucketKind, series, buckets, ticks: niceTicks(max), grand, empty: grand <= 0 };
}

/** The three highlights under the chart, from a summary over the same range. */
export function highlights(summary) {
  const all = summary?.byModel || [];
  // An embedding model is plumbing behind every search, not a model anyone picks, so it is left out of
  // "most used" and "best value" (it would win both); its credits still count towards the providers.
  const models = all.filter((m) => !/embed/i.test(m.model));
  const byProvider = new Map();
  for (const m of all) byProvider.set(m.provider, (byProvider.get(m.provider) || 0) + m.credits);
  const total = all.reduce((s, m) => s + m.credits, 0);
  const [topProvider, topCredits] = [...byProvider.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const mostUsed = [...models].sort((a, b) => b.calls - a.calls || b.credits - a.credits)[0];
  // Lowest credits per call among models with at least 5 calls that cost anything (a free embedding
  // or dictation model would always "win").
  const value = models.filter((m) => m.calls >= 5 && m.credits > 0)
    .map((m) => ({ model: m.model, perCall: m.credits / m.calls }))
    .sort((a, b) => a.perCall - b.perCall)[0];
  return {
    topProvider: topProvider && total > 0 && topCredits > 0 ? { provider: topProvider, share: (100 * topCredits) / total } : null,
    mostUsed: mostUsed && mostUsed.calls > 0 ? { model: mostUsed.model, calls: mostUsed.calls } : null,
    bestValue: value || null,
  };
}

/** Credits per bucket, in order, for the small version's sparkline. */
export function bucketTotals(points, measure = 'credits') {
  const out = new Map();
  for (const p of Array.isArray(points) ? points : []) out.set(p.bucket, (out.get(p.bucket) || 0) + (Number(p[measure]) || 0));
  return [...out.entries()].map(([bucket, value]) => ({ bucket, value }));
}

/** "37%" or "<1%" for a share above zero. */
export function shareText(share) {
  const n = Number(share) || 0;
  if (n <= 0) return '0%';
  if (n < 1) return '<1%';
  return `${Math.round(n)}%`;
}
