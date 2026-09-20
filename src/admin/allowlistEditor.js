/**
 * Pure helpers for the allowlist editor (foundation spec §D.1). Kept free of
 * React and the DOM so they are tested in node; the component is verified in
 * a browser.
 */

/** Catalogue rows that are not yet on the allowlist, in id order. */
export function catalogueChoices(catalogue, models) {
  const listed = new Set((models || []).map((m) => m.model_id));
  return (catalogue || [])
    .filter((c) => c && c.model_id && !listed.has(c.model_id))
    .sort((a, b) => String(a.model_id).localeCompare(String(b.model_id)));
}

/** "low, Medium ,high,low" → ['low', 'medium', 'high'] */
export function parseEfforts(text) {
  const out = [];
  for (const part of String(text || '').split(',')) {
    const v = part.trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function formatEfforts(list) {
  return (Array.isArray(list) ? list : []).join(', ');
}

/** USD per token → "$0.10 / $0.40 per M tokens"; null when unknown. */
export function pricingLabel(pricing) {
  if (!pricing || pricing.prompt_usd == null || pricing.completion_usd == null) return null;
  const p = Number(pricing.prompt_usd);
  const c = Number(pricing.completion_usd);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  const fmt = (n) => `$${(n * 1e6).toFixed(n * 1e6 >= 10 ? 0 : 2)}`;
  return `${fmt(p)} / ${fmt(c)} per M tokens`;
}

const TIERS = [1, 2, 3];

/** The editable draft of a model row → the row admin-models PUT accepts. */
export function modelDraftToRow(draft) {
  const tier = Number(draft.tier);
  return {
    model_id: String(draft.model_id || '').trim(),
    label: String(draft.label || '').trim() || String(draft.model_id || '').trim(),
    tier: TIERS.includes(tier) ? tier : 2,
    efforts: Array.isArray(draft.efforts) ? draft.efforts : parseEfforts(draft.efforts),
    sort_order: Number.isFinite(Number(draft.sort_order)) ? Number(draft.sort_order) : 100,
    enabled: Boolean(draft.enabled),
    is_default: Boolean(draft.is_default),
  };
}

/** The four roles Niyantran routes by, in display order, for seeding an empty table. */
export const ROLE_SEEDS = [
  { role_id: 'DEFAULT_ANALYST', label: 'Default analyst', hint: 'Everyday briefing, tables, and multi-desk questions.', sort_order: 10 },
  { role_id: 'EXPERT_ESCALATION', label: 'Expert escalation', hint: 'Harder synthesis when the lite pass is not enough.', sort_order: 20 },
  { role_id: 'PDF_PARSER', label: 'PDF parser', hint: 'Read PDFs, scans, and attached documents.', sort_order: 30 },
  { role_id: 'VISUAL_RESEARCH', label: 'Visual research', hint: 'Charts, maps, images, and screenshot-backed questions.', sort_order: 40 },
];

/** Existing roles merged over the seeds, so an empty table still shows all four. */
export function rolesForDisplay(roles) {
  const byId = new Map((roles || []).map((r) => [r.role_id, r]));
  const out = ROLE_SEEDS.map((s) => ({ ...s, model_id: '', ...(byId.get(s.role_id) || {}) }));
  for (const r of roles || []) if (!ROLE_SEEDS.some((s) => s.role_id === r.role_id)) out.push(r);
  return out.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
}
