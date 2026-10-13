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
    return [{ kind: 'module', id: `module:${tab.id}:${m.htmlFeature}`, title: m.htmlFeature,
      tab: tab.id, tier: m.htmlTier, feature: m.htmlFeature, detail: `${tab.label} · ${m.bucket}` }];
  }).slice(0, 10);
  return [...desks, ...features];
}
export async function recordMatches(query, tabs, modules, signal, client = supabase) {
  const tiers = tabs.filter(t => t.id !== 'home');
  const responses = await Promise.all(tiers.map(async tab => {
    const { data, error } = await client.rpc('search_desk_rows', {
      p_tier: tab.id, p_feature: null, p_query: query.trim(), p_filters: {}, p_limit: 4,
    }).abortSignal(signal);
    if (error) throw new Error('Record search is unavailable. Try again.');
    return (data || []).flatMap(r => {
      const module = modules.find(m => m.htmlFeature === r.feature && destination(m, tabs)?.id === tab.id);
      if (!module || r.tier !== tab.id) return [];
      const row = r.row || {};
      const title = row.bill_name || row.title || row.subject || row.name || row.question || row.commodity || row.country || r.feature;
      return [{ kind: 'record', id: `record:${r.tier}:${r.feature}:${r.row_key}`, title: String(title),
        tab: tab.id, tier: r.tier, feature: r.feature, row_key: r.row_key,
        // The row the search returned is what a drag into AI research carries (F134).
        row: r.row || null, document_key: r.document_key,
        detail: `${tab.label} · ${r.feature}`, snapshot_at: r.snapshot_at }];
    });
  }));
  return responses.flat().slice(0, 16);
}

/** Drag props for a search result: a record drags as its row, a module as a feature, a desk as a tab (F134). */
export function resultDragProps(hit) {
  if (hit.kind === 'desk') return aiDragProps({ kind: 'tab', tab: hit.tab, title: hit.title });
  if (hit.kind === 'record' && hit.row) return rowDragProps(hit.row, { title: hit.title, feature: hit.feature, tab: hit.tab });
  return aiDragProps({ kind: 'feature', tab: hit.tab, tier: hit.tier, feature: hit.feature, title: hit.title });
}
