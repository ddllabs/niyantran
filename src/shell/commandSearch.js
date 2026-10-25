import { DESK_CATALOGUE_IDENTITY } from '../desks/landing/deskCatalogueIdentity.js';
import { supabase } from '../lib/supabaseClient.js';
import { aiDragProps, rowDragProps } from '../lib/aiDrop.js';

function destination(module, tabs) {
  return tabs.find(t => t.tier === module.htmlTier || (t.id === 'state' && module.htmlTier === 'local'));
}
function matches(text, query) {
  return query.toLowerCase().trim().split(/\s+/).every(word => text.toLowerCase().includes(word));
}
export function navigationMatches(query, tabs, modules) {
  if (query.trim().length < 2) return [];
  const desks = tabs.filter(t => matches(`${t.label} ${t.labelHi || ''} ${t.tier}`, query))
    .map(t => ({ kind: 'desk', id: `desk:${t.id}`, title: t.label, tab: t.id, feature: '', detail: `${t.label} desk` }));
  const features = modules.flatMap(m => {
    const tab = destination(m, tabs);
    if (!tab || !matches(`${m.htmlFeature} ${m.bucket} ${m.htmlTier} ${tab.label}`, query)) return [];
    const entry = DESK_CATALOGUE_IDENTITY.find(e => e.tab === tab.id && e.feature === m.htmlFeature);
    return [{ kind: 'module', id: `module:${tab.id}:${m.htmlFeature}`, title: entry?.title || m.htmlFeature,
      tab: tab.id, tier: m.htmlTier, feature: m.htmlFeature, detail: `${tab.label} → ${entry?.group || m.bucket}` }];
  }).slice(0, 10);
  return [...desks, ...features];
}
export async function recordMatches(query, tabs, modules, signal, client = supabase) {
  const tiers = tabs.filter(t => t.id !== 'home');
  const responses = await Promise.allSettled(tiers.map(async tab => {
    const { data, error } = await client.rpc('search_desk_rows', {
      p_tier: tab.id, p_feature: null, p_query: query.trim(), p_filters: {}, p_limit: 50,
    }).abortSignal(signal);
    if (error) throw new Error('Record search is unavailable. Try again.');
    const rows = (data || []).flatMap(r => {
      const module = modules.find(m => m.htmlFeature === r.feature && destination(m, tabs)?.id === tab.id);
      if (!module || r.tier !== tab.id) return [];
      const row = r.row || {};
      const title = row.bill_name || row.title || row.subject || row.name || row.question || row.commodity || row.country || r.feature;
      const entry = DESK_CATALOGUE_IDENTITY.find(e => e.tab === tab.id && e.feature === r.feature);
      return [{ kind: 'record', id: `record:${r.tier}:${r.feature}:${r.row_key}`, title: String(title),
        tab: tab.id, tier: r.tier, feature: r.feature, row_key: r.row_key,
        // The row the search returned is what a drag into AI research carries (F134).
        row: r.row || null, document_key: r.document_key,
        detail: `${tab.label} → ${entry?.group || module.bucket || 'Records'} → ${entry?.title || r.feature}`, snapshot_at: r.snapshot_at }];
    });
    return { rows, total: Math.max(data?.length || 0, Number(data?.[0]?.total) || 0) };
  }));
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
  const success = responses.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!success.length && tiers.length) throw new Error('Record search is unavailable. Try again.');
  const rank = hit => hit.title.toLowerCase() === query.trim().toLowerCase() ? 0 : hit.title.toLowerCase().includes(query.trim().toLowerCase()) ? 1 : 2;
  // Interleave equally ranked desks: a broad query cannot crowd out later desks.
  const hits = success.flatMap(({ rows }) => rows.map((hit, position) => ({ ...hit, position })))
    .sort((a, b) => rank(a) - rank(b) || a.position - b.position || a.detail.localeCompare(b.detail) || a.id.localeCompare(b.id));
  hits.coverage = {
    failed: responses.flatMap((r, i) => r.status === 'rejected' ? [tiers[i].label] : []),
    total: success.reduce((sum, r) => sum + r.total, 0),
    truncated: success.some(r => r.total > r.rows.length),
    limitPerDesk: 50,
  };
  return hits;
}

/** Drag props for a search result: a record drags as its row, a module as a feature, a desk as a tab (F134). */
export function resultDragProps(hit) {
  if (hit.kind === 'desk') return aiDragProps({ kind: 'tab', tab: hit.tab, title: hit.title });
  if (hit.kind === 'record' && hit.row) return rowDragProps(hit.row, { title: hit.title, feature: hit.feature, tab: hit.tab });
  return aiDragProps({ kind: 'feature', tab: hit.tab, tier: hit.tier, feature: hit.feature, title: hit.title });
}
