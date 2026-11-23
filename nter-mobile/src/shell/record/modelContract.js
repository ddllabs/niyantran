/**
 * The RecordPanelModel contract (F121), as a checker every adapter test runs over real rows.
 * It returns the list of problems; an empty list means the model honours the spec: a title, two to
 * four glance tiles with values, only registered and well-formed visuals, no placeholder text,
 * https-only links, a named source with an as-of date (or the flag "as-of not on record"), and a
 * footer Ask AI label. docs/specs/2026-10-13-global-record-panels.md, "Panel anatomy".
 */
import { VISUAL_TYPES } from './visuals/types.js';

const TONES = new Set(['red', 'amber', 'green', 'blue', 'grey']);
/** Reference-style placeholders ("[date]", "[as listed on the record]") and leaked JS values. */
const PLACEHOLDER = /\[[A-Za-z][A-Za-z0-9 /&,.'-]{0,40}\]|\bundefined\b|\bNaN\b|^\s*null\s*$/;
const NO_AS_OF = 'as-of not on record';

function visualProblems(v, where) {
  if (!v) return [];
  if (!VISUAL_TYPES.includes(v.type)) return [`unsupported visual type ${v.type} in ${where}`];
  const out = [];
  if (!String(v.title || '').trim()) out.push(`${where} has no title`);
  if (v.type === 'map') {
    if (!(v.points || []).length) out.push(`${where} map has no points`);
    for (const p of v.points || []) if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !String(p.label || '').trim()) out.push(`${where} has a bad map point ${p.label || '?'}`);
  }
  if (v.type === 'timeline') {
    if (!(v.steps || []).length || v.steps.some((st) => !String(st.label || '').trim())) out.push(`${where} timeline needs labelled steps`);
    if ((v.steps || []).filter((st) => st.now).length > 1) out.push(`${where} timeline has more than one current step`);
  }
  if (v.type === 'board') {
    if (!(v.rows || []).length) out.push(`${where} board has no rows`);
    const seen = new Set();
    for (const r of v.rows || []) {
      if (!String(r.label || '').trim() || !String(r.value || '').trim()) out.push(`${where} has an empty board row ${r.label || '?'}`);
      if (seen.has(r.label)) out.push(`${where} has a duplicate board row ${r.label}`);
      seen.add(r.label);
      if (r.tone && !TONES.has(r.tone)) out.push(`bad tone ${r.tone}`);
    }
  }
  return out;
}

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
  // F128: the Law clock tile is tinted so the eye finds the deadline first; one only, and last.
  const clocks = tiles.filter((t) => t.clock);
  if (clocks.length > 1 || (clocks.length === 1 && !tiles[tiles.length - 1].clock)) problems.push('glance needs at most one clock tile, last');
  if (model.badge && (!String(model.badge.text || '').trim() || !TONES.has(model.badge.tone))) problems.push('bad badge');
  problems.push(...visualProblems(model.glance?.visual, 'glance.visual'), ...visualProblems(model.glance?.visual2, 'glance.visual2'));
  for (const l of model.links || []) if (!/^https:\/\//i.test(String(l.href || ''))) problems.push(`non-https link ${l.href}`);
  if (!String(model.about?.label || '').trim()) problems.push('missing about label');
  for (const [k, v] of model.about?.rows || []) if (!String(k || '').trim() || !String(v || '').trim()) problems.push(`empty about row ${k}`);
  // F204: the relations graph is gone; only the related records under it are shown.
  if (model.touches) {
    for (const l of model.touches.links || []) if (l.row !== undefined && (!l.row || typeof l.row !== 'object' || Array.isArray(l.row))) problems.push(`touch link ${l.title} has a row that is not a record`);
  }
  const quick = model.quick || [];
  if (quick.length > 4) problems.push(`Quick exit has ${quick.length} buttons (at most 4)`);
  const quickSeen = new Set();
  for (const q of quick) {
    if (!String(q?.label || '').trim() || !String(q?.prompt || '').trim()) problems.push(`empty Quick exit ${q?.label || '?'}`);
    if (quickSeen.has(q?.label)) problems.push(`duplicate Quick exit ${q.label}`);
    quickSeen.add(q?.label);
  }
  const health = model.footer?.health || [];
  if (health.length > 4) problems.push(`health strip has ${health.length} pairs (at most 4)`);
  for (const pair of health) if (!Array.isArray(pair) || !String(pair[0] ?? '').trim() || !String(pair[1] ?? '').trim()) problems.push(`empty health pair ${Array.isArray(pair) ? pair[0] : '?'}`);
  if (!String(model.footer?.ask || '').trim()) problems.push('missing Ask AI label');
  if (!String(model.footer?.provenance?.source || '').trim()) problems.push('missing provenance source');
  if (!String(model.footer?.provenance?.asOf || '').trim() && !(model.footer?.provenance?.flags || []).includes(NO_AS_OF)) problems.push('missing as-of date');
  // A touch link's `row` is the record it opens, not text the panel shows, so it is not scanned. The
  // title is the record's own name as its source prints it (official bill titles carry a bracketed
  // purpose, "[to amend article 292]"), so it is source text, not a template placeholder.
  const { title: _title, ...rest } = model;
  // A link that opens a related record is titled with that record's own name, so it is source text too.
  const shown = model.touches ? { ...rest, touches: { ...model.touches, links: (model.touches.links || []).map(({ row, title, ...l }) => (row ? l : { title, ...l })) } } : rest;
  for (const s of strings(shown)) if (PLACEHOLDER.test(s)) problems.push(`placeholder text: ${s.slice(0, 60)}`);
  return problems;
}
