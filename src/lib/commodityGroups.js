import { applyVizFilter } from './nationalKpi.js';

/**
 * The Global Commodities board's groups, filtered by the search text and the chart filter (F122).
 * The feed carries the pack's own groups (`meta.groups`, items as [name, level, change, pct]); a
 * search keeps only the items whose row matches, by commodity or by group, and drops empty groups.
 * Without the pack's groups, they are built from the rows.
 */
export function commodityGroups(feed, { q = '', vizFilter = null } = {}) {
  const rows = (feed?.rows || []).filter((r) => applyVizFilter(r, vizFilter));
  const n = String(q || '').trim().toLowerCase();
  const kept = n ? rows.filter((r) => `${r.commodity || r.title || ''} ${r.group || ''}`.toLowerCase().includes(n)) : rows;
  const packGroups = Array.isArray(feed?.meta?.groups) && feed.meta.groups.length ? feed.meta.groups : null;
  if (packGroups) {
    if (kept.length === (feed?.rows || []).length) return packGroups;
    const names = new Set(kept.map((r) => r.commodity || r.title));
    return packGroups.map((g) => ({ ...g, items: (g.items || []).filter(([name]) => names.has(name)) })).filter((g) => g.items.length);
  }
  const map = new Map();
  for (const r of kept) {
    const g = r.group || 'Other';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push([r.commodity || r.title, r.level, r.change, r.pct]);
  }
  return [...map.entries()].map(([g, items]) => ({ g, items }));
}
