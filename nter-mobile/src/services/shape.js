// Pure helpers shared by the live and sample services: how a record is titled, which columns a
// module shows, what plan a member is effectively on, and how a record travels to the AI.
// Kept free of I/O so they are unit-tested directly.
import { PLAN_RANK } from '../data/plans.js';

const TITLE_KEYS = ['bill_name', 'title', 'headline', 'subject', 'name', 'question', 'case_title', 'scheme', 'commodity', 'country', 'state', 'indicator', 'company', 'party', 'event', 'label'];
const META_KEYS = new Set(['id', 'row_key', 'status', 'source_url', 'url', 'link', 'raw', 'record_text', 'tier', 'feature', 'desk', 'img', 'image', '_key', 'iso3', 'lat', 'lon', 'lng']);

const text = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v).trim());

export function rowTitle(row, fallback = 'Record') {
  if (!row || typeof row !== 'object') return fallback;
  for (const k of TITLE_KEYS) if (text(row[k])) return text(row[k]);
  const first = Object.entries(row).find(([k, v]) => !META_KEYS.has(k) && typeof v === 'string' && v.trim().length > 3 && !/^https?:/i.test(v));
  return first ? first[1].trim() : fallback;
}

export const humanKey = (k) => String(k).replace(/_/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase());

// The fields worth showing on a record, in a stable order: title keys first, then the rest.
export function rowFields(row, limit = 40) {
  if (!row || typeof row !== 'object') return [];
  const keys = Object.keys(row).filter((k) => !META_KEYS.has(k) && text(row[k]) !== '');
  keys.sort((a, b) => (TITLE_KEYS.includes(a) ? 0 : 1) - (TITLE_KEYS.includes(b) ? 0 : 1));
  // The same value under two names (bill_name and title, date and date_introduced) shows once.
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    const v = text(row[k]);
    const norm = v.toLowerCase().replace(/[t ]00:00:00(\.0+)?([+-]\d\d:\d\d|z)?$/i, '');
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ key: k, label: humanKey(k), value: v });
  }
  return out.slice(0, limit);
}

export function rowLink(row) {
  const u = text(row?.source_url) || text(row?.url) || text(row?.link);
  return /^https:\/\//i.test(u) ? u : '';
}

// Columns for a module list: the API's when it sends them, otherwise the first few populated
// scalar fields of the first rows.
export function pickColumns(rows, given) {
  if (Array.isArray(given) && given.length) {
    return given.map((c) => (typeof c === 'string' ? { key: c, label: humanKey(c) } : { key: c.key || c.id, label: c.label || humanKey(c.key || c.id) })).filter((c) => c.key).slice(0, 8);
  }
  const counts = new Map();
  for (const r of (rows || []).slice(0, 20)) {
    for (const [k, v] of Object.entries(r || {})) if (!META_KEYS.has(k) && text(v)) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key]) => ({ key, label: humanKey(key) }));
}

// The site's effective-plan rule: a paid plan counts only while active, not lapsed, and before
// its access deadline; everything else is Free.
export function effectivePlan(ent, now = Date.now()) {
  if (!ent || !ent.plan || ent.plan === 'free') return 'free';
  if (ent.status && ent.status !== 'active') return 'free';
  if (ent.lapsed) return 'free';
  const until = Date.parse(ent.access_until || ent.grace_until || ent.period_end || '');
  if (Number.isFinite(until) && until < now) return 'free';
  return PLAN_RANK[ent.plan] != null ? ent.plan : 'free';
}

export function creditsSummary(cycle) {
  if (!cycle) return null;
  const balance = Number(cycle.balance) || 0;
  const held = Number(cycle.held) || 0;
  const allowance = Number(cycle.cycle?.allowance) || 0;
  const available = Math.max(0, balance - held);
  return {
    balance, held, available, allowance,
    used: Number(cycle.used_this_cycle) || 0,
    endsAt: cycle.cycle?.ends_at || null,
    plan: cycle.plan || 'free',
    low: available <= 2000 || (allowance > 0 && available <= allowance * 0.1),
    recent: Array.isArray(cycle.recent) ? cycle.recent : [],
  };
}

export const planAllows = (memberPlan, minPlan) => (PLAN_RANK[memberPlan] ?? 0) >= (PLAN_RANK[minPlan || 'plus'] ?? 1);

// A record as research-chat takes it: a `row` attachment whose text is the record, line by line,
// within the function's limits (64 fields, 500 characters a cell, 40,000 in all).
export function recordAttachment({ row, module }) {
  const lines = [`Module: ${module?.title || module?.feature || ''}`];
  let n = 0;
  for (const [k, v] of Object.entries(row || {})) {
    const t = text(v);
    if (!t || k === 'raw' || k === 'record_text') continue;
    lines.push(`${k}: ${t.slice(0, 500)}`);
    if (++n >= 64) break;
  }
  return {
    kind: 'row',
    title: rowTitle(row, module?.title || 'Record').slice(0, 200),
    text: lines.join('\n').slice(0, 40000),
    ...(module?.feature ? { feature: module.feature } : {}),
    ...(module?.desk ? { tier: module.desk } : {}),
  };
}

// A story from nter.news as an attachment, so "Ask AI" on a story researches that story.
export function storyAttachment(story) {
  const body = [story.title, story.dek, story.body, story.link ? `Link: ${story.link}` : ''].filter(Boolean).join('\n\n');
  return { kind: 'record', title: String(story.title || 'nter.news story').slice(0, 200), text: body.slice(0, 40000) };
}

// Citation markers ([1], [2, 3], [4-6]) follow the same grammar as the website's src/lib/citationMarkers.js.
export { parseCitationIds, splitCitationMarkers } from '../lib/citationMarkers.js';

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function turnKey() {
  const a = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues?.(a);
  return `m-${Date.now().toString(36)}-${[...a].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)}`;
}

// The landing page's "record at a glance" figures: the website's last measured values, replaced
// by /api/site-figures when the live service answers.
export const SITE_FIGURES = { bills: 9817, documents: 3431, ministries: 56, fronts: 88, modules: 120, desks: 8, endpoints: 246, houses: 2, since: 1952 };
export function mergeFigures(live) {
  const next = { ...SITE_FIGURES };
  for (const k of ['bills', 'documents', 'ministries', 'fronts']) if (Number.isInteger(live?.[k]) && live[k] > 0) next[k] = live[k];
  return next;
}

// desk-brief answers in two shapes: format 2 {brief, why, watch, tags} and the older format 1
// {headline, points[]}. The record card reads one shape.
export function normalizeBrief(r) {
  if (!r || r.state !== 'ready') return null;
  if (r.format === 1 || Array.isArray(r.points)) {
    return { lead: r.headline || '', points: Array.isArray(r.points) ? r.points : [], why: '', watch: '', tags: [], model: r.model, writtenAt: r.writtenAt, sample: r.sample };
  }
  return { lead: r.brief || '', points: [], why: r.why || '', watch: r.watch || '', tags: Array.isArray(r.tags) ? r.tags : [], model: r.model, writtenAt: r.writtenAt, sample: r.sample };
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
