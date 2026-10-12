/**
 * The RecordPanelModel contract (F121), as a checker every adapter test runs over real rows.
 * It returns the list of problems; an empty list means the model honours the spec: a title, two to
 * four glance tiles with values, no placeholder text, https-only links, a named source, and a
 * footer Ask AI label. docs/specs/2026-10-13-global-record-panels.md, "Panel anatomy".
 */
const TONES = new Set(['red', 'amber', 'green', 'blue', 'grey']);
const PLACEHOLDER = /\[[^\]]*\]|\bundefined\b|\bnull\b|\bNaN\b/;

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

export function contractProblems(model) {
  const problems = [];
  if (!model || typeof model !== 'object') return ['no model'];
  if (!String(model.title || '').trim()) problems.push('missing title');
  const tiles = model.glance?.tiles || [];
  if (tiles.length < 2 || tiles.length > 4) problems.push(`glance has ${tiles.length} tiles (needs 2–4)`);
  for (const t of tiles) {
    if (!String(t.label || '').trim() || !String(t.value || '').trim()) problems.push(`empty tile ${t.label || '?'}`);
    if (t.tone && !TONES.has(t.tone)) problems.push(`bad tone ${t.tone}`);
  }
  if (model.badge && (!String(model.badge.text || '').trim() || !TONES.has(model.badge.tone))) problems.push('bad badge');
  for (const l of model.links || []) if (!/^https:\/\//i.test(String(l.href || ''))) problems.push(`non-https link ${l.href}`);
  if (!String(model.about?.label || '').trim()) problems.push('missing about label');
  for (const [k, v] of model.about?.rows || []) if (!String(k || '').trim() || !String(v || '').trim()) problems.push(`empty about row ${k}`);
  if (model.touches) {
    if ((model.touches.lanes || []).length !== 4) problems.push('touches needs four lanes');
    if (!model.touches.nodes?.center) problems.push('touches needs a centre node');
  }
  if (!String(model.footer?.ask || '').trim()) problems.push('missing Ask AI label');
  if (!String(model.footer?.provenance?.source || '').trim()) problems.push('missing provenance source');
  for (const s of strings(model)) if (PLACEHOLDER.test(s)) problems.push(`placeholder text: ${s.slice(0, 60)}`);
  return problems;
}
