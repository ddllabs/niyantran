/**
 * The Credits usage page's data (F153, docs/specs/2026-10-14-credits-usage-page.md, Data).
 *
 * Three read-only reports, each for the signed-in user only: my_usage_summary, my_usage_timeseries
 * and my_usage_activity. They return credits, counts and tokens; never dollars or a rate. Credits are
 * shown as credits only (F184, owner 2026-10-15).
 * Nothing is cached: the page reads afresh each time it opens.
 */
import { supabase } from './supabaseClient.js';

/** Charges began at the credits launch (spec Decision 4); earlier calls show 0 credits. */
export const CREDITS_STARTED_AT = '2026-10-14T05:46:00Z';
export const CREDITS_STARTED_NOTE = 'Credits started on 14 Oct 2026';

const DAY_MS = 86400000;
const IST_OFFSET_MS = 330 * 60000;

export const RANGES = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'lifetime', label: 'Lifetime', days: null },
];

export const MEASURES = [
  { id: 'credits', label: 'Credits' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'calls', label: 'Calls' },
];

function num(value) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? 0 : n;
}

function text(value) {
  return typeof value === 'string' && value ? value : null;
}

/** The start of the IST calendar day that instant `ms` falls in, as epoch milliseconds. */
export function istDayStart(ms) {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/**
 * The window a range asks the server for: whole IST days ending today (so "last 7 days" is today and
 * the six days before it), or, for lifetime, everything by month.
 */
export function rangeWindow(rangeId, now = Date.now()) {
  const range = RANGES.find((r) => r.id === rangeId) || RANGES[1];
  const to = new Date(now).toISOString();
  if (!range.days) return { range: range.id, from: null, to, bucket: 'month' };
  const from = new Date(istDayStart(now) - (range.days - 1) * DAY_MS).toISOString();
  return { range: range.id, from, to, bucket: 'day' };
}

export function shapeSummary(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    credits: num(data.credits),
    calls: num(data.calls),
    failedCalls: num(data.failed_calls),
    tokens: num(data.tokens),
    answers: num(data.answers),
    answersFree: num(data.answers_free),
    webSearches: num(data.web_searches),
    webSearchCredits: num(data.web_search_credits),
    modelsUsed: num(data.models_used),
    providers: num(data.providers),
    byModel: Array.isArray(data.by_model)
      ? data.by_model.map((m) => ({
        model: text(m?.model) || 'unknown',
        provider: text(m?.provider) || 'other',
        credits: num(m?.credits),
        calls: num(m?.calls),
        tokens: num(m?.tokens),
      }))
      : [],
    byFeature: Array.isArray(data.by_feature)
      ? data.by_feature.map((f) => ({ feature: String(f?.feature || ''), calls: num(f?.calls), credits: num(f?.credits), searches: num(f?.searches) }))
      : [],
    lifetimeCredits: num(data.lifetime_credits),
  };
}

export function shapeSeries(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.series)) return null;
  return {
    bucket: data.bucket === 'month' ? 'month' : 'day',
    points: data.series
      .filter((p) => typeof p?.bucket_start === 'string')
      .map((p) => ({ bucket: p.bucket_start, model: text(p.model), credits: num(p.credits), calls: num(p.calls), tokens: num(p.tokens) })),
  };
}

export function shapeActivity(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) return null;
  return {
    total: num(data.total),
    rows: data.rows.map((r) => ({
      turnKey: text(r?.turn_key),
      createdAt: text(r?.created_at),
      conversationId: text(r?.conversation_id),
      title: text(r?.title),
      question: text(r?.question),
      status: text(r?.status) || 'failed',
      model: text(r?.model),
      calls: num(r?.calls),
      tokens: num(r?.tokens),
      credits: num(r?.credits),
      detail: Array.isArray(r?.detail)
        ? r.detail.map((d) => ({
          role: text(d?.role) || 'other',
          model: text(d?.model),
          effort: text(d?.effort),
          tokens: num(d?.tokens),
          credits: num(d?.credits),
          free: d?.free === true,
          status: text(d?.status) || 'failed',
        }))
        : [],
    })),
  };
}

/** One report call for whoever is signed in. Resolves to the shaped answer, or null on any failure. */
async function report(name, args, shape) {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user?.id) return null;
    const result = await supabase.rpc(name, args);
    if (result.error) return null;
    return shape(result.data);
  } catch {
    return null;
  }
}

export function loadUsageSummary(from, to) {
  return report('my_usage_summary', { p_from: from ?? null, p_to: to ?? null }, shapeSummary);
}

export function loadUsageSeries(from, to, bucket) {
  return report('my_usage_timeseries', { p_from: from ?? null, p_to: to ?? null, p_bucket: bucket === 'month' ? 'month' : 'day' }, shapeSeries);
}

export const ACTIVITY_PAGE = 50;

export function loadUsageActivity({ offset = 0, limit = ACTIVITY_PAGE, grouped = true, model = null, status = 'all', kind = 'all' } = {}) {
  return report('my_usage_activity', {
    p_offset: offset, p_limit: limit, p_grouped: grouped, p_model: model || null, p_status: status, p_kind: kind,
  }, shapeActivity);
}

/** Every row the filters match, a page of 100 at a time, up to `cap` rows. Null when a page fails. */
export async function loadAllActivity(filters, cap = 2000) {
  const rows = [];
  for (let offset = 0; offset < cap; offset += 100) {
    const page = await loadUsageActivity({ ...filters, offset, limit: 100 });
    if (!page) return null;
    rows.push(...page.rows);
    if (!page.rows.length || rows.length >= page.total) break;
  }
  return rows.slice(0, cap);
}

// ---- Words and numbers --------------------------------------------------------------------------

const INDIAN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** A whole number with Indian grouping: 2,27,000. */
export function indianNumber(value) {
  return INDIAN.format(Math.round(num(value)));
}

/** Tokens, abbreviated: 950, 12.4K, 2.27M, 1.1B. */
export function formatTokens(value) {
  const n = Math.abs(num(value));
  const short = (x, digits) => String(Number(x.toFixed(digits)));
  if (n >= 1e9) return `${short(n / 1e9, 2)}B`;
  if (n >= 1e6) return `${short(n / 1e6, 2)}M`;
  if (n >= 1e3) return `${short(n / 1e3, 1)}K`;
  return String(Math.round(n));
}

const PROVIDERS = {
  google: 'Google', anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', 'x-ai': 'xAI', 'z-ai': 'Z.ai',
  meta: 'Meta', 'meta-llama': 'Meta', mistralai: 'Mistral', qwen: 'Qwen', moonshotai: 'Moonshot', other: 'Other',
};

/** The vendor part of a model id, as the server reports it ('~openai/gpt-luna-latest' is openai). */
export function providerOf(model) {
  const id = String(model || '').replace(/^~+/, '');
  const at = id.indexOf('/');
  return at > 0 ? id.slice(0, at).toLowerCase() : 'other';
}

export function providerName(provider) {
  const key = String(provider || 'other');
  return PROVIDERS[key] || key.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** The model's own name, without its vendor: 'gemini-3.7-flash'. */
export function modelName(model) {
  const id = String(model || '').replace(/^~+/, '');
  if (!id || id === 'unknown') return 'Unknown model';
  const at = id.indexOf('/');
  return at >= 0 ? id.slice(at + 1) : id;
}

const ROLES = { answer: 'Answer', search: 'Search and plan', repair: 'Repair', dictation: 'Dictation' };
export function roleLabel(role) {
  return ROLES[role] || 'Other';
}

const STATUSES = { succeeded: 'Succeeded', stopped: 'Stopped', failed: 'Failed', running: 'Running' };
export function statusLabel(status) {
  return STATUSES[status] || 'Failed';
}

export function effortLabel(effort) {
  if (!effort) return '—';
  if (effort === 'xhigh') return 'Extra high';
  return effort[0].toUpperCase() + effort.slice(1);
}

const FEATURES = { research: 'AI research', dictation: 'Dictation' };
export function featureLabel(feature) {
  return FEATURES[feature] || 'Other';
}

/** True for a row charged before credits existed, which shows 0 credits with the launch note. */
export function beforeCredits(iso) {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) && at < Date.parse(CREDITS_STARTED_AT);
}

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
const DAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

/** "14 Oct, 11:30", in IST. */
export function whenText(iso) {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? WHEN.format(at) : '';
}

/** "14 Oct 2026", in IST. */
export function dayText(iso) {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? DAY.format(at) : '';
}

/**
 * The chat column's words for a row: its title; "Untitled" for a saved chat without one; "Deleted
 * conversation" for an answer whose chat is gone (it still has its turn); "Dictation" for a dictation
 * call, which belongs to no chat.
 */
export function rowChat(row) {
  if (row.title) return row.title;
  if (row.conversationId) return 'Untitled';
  return row.turnKey ? 'Deleted conversation' : 'Dictation';
}
