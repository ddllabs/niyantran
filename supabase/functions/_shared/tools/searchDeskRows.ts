// The search_desk_rows tool (desk-row-grounding spec §C, fixed interface,
// consumed by streaming-research-agent exactly as declared here). The
// executor validates the arguments, resolves the module name through the
// catalogue, clamps the limit, passes the filters as a bound JSON value and
// slims the rows; labelling rows with handles and rendering them for the
// model is renderDeskRows. Argument problems come back as `error` text the
// loop shows the model verbatim; infrastructure failures throw.
//
// F197 (D3, 2026-10-15): filters were exact containment and nothing else, so
// `{"year":"2026"}` - a field no bill row has - matched nothing and the model
// reported "0 bills" as fact. Now a search with filters or a date range that
// returns no row asks desk_row_fields what the scope's rows carry: a field
// they do not carry is an error listing the real ones, and a true zero is
// rendered with the conditions that produced it. A year or date question uses
// date_from/date_to on the row's `date` (for a bill, its introduction date),
// and a value that matches nothing exactly is retried by the RPC without case
// (migration 20261015210000).

import { DESK_CATALOG, DESK_TIERS, resolveFeature } from '../deskCatalog.ts';

export const SEARCH_DESK_ROWS_TOOL = {
  type: 'function',
  function: {
    name: 'search_desk_rows',
    description:
      'Look up rows in a terminal desk module and get the true total. Use for counts, lists, filters and comparisons across rows. Not for what a document says — use search_documents for that. Filters name the module\'s own fields (an unknown field is refused with the list of real ones); for a year or a period use date_from and date_to, never a "year" filter. A TOTAL of 0 means no row matches those conditions, not that the subject is absent from the record.',
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['global', 'national', 'state', 'law', 'economics', 'carbon', 'sports', 'entertainment'] },
        feature: {
          type: 'string',
          description: 'Module name from the catalogue, e.g. "Bill Passage Probability Index". Omit to search every module in the tier.',
        },
        query: { type: 'string', description: 'Free text matched against every column.' },
        filters: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Column = value conditions on the module\'s own fields, e.g. {"house":"Lok Sabha","current_stage":"Assented"}. Values match ignoring case.',
        },
        date_from: {
          type: 'string',
          description:
            'Earliest date, inclusive: YYYY, YYYY-MM or YYYY-MM-DD. Applies to the row\'s date (for a bill, the date it was introduced). For "in 2026" send date_from "2026" and date_to "2026".',
        },
        date_to: { type: 'string', description: 'Latest date, inclusive: YYYY, YYYY-MM or YYYY-MM-DD.' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['tier'],
      additionalProperties: false,
    },
  },
} as const;

export interface DeskRow {
  tier: string;
  feature: string;
  row_key: string;
  row: Record<string, string>; // slim: ≤ 32 columns, each ≤ 500 chars
  record_text: string;
  document_key: string | null;
  snapshot_at: string;
}

export interface DeskRowsResult {
  rows: DeskRow[];
  total: number;
  snapshot_at: string | null;
  /** An argument problem, phrased for the model; rows are empty when set. */
  error?: string;
  /** The filters and date range the search applied, as the model reads them, and the module (or
   * desk) searched. Set when there were any, so a zero can say what matched nothing. */
  conditions?: string;
  scope?: string;
}

export interface DeskRowsDeps {
  rpc(
    fn: 'search_desk_rows' | 'desk_row_fields',
    args: Record<string, unknown>,
  ): Promise<{ data: unknown | null; error: { message: string } | null }>;
}

export interface SearchDeskRowsArgs {
  tier: string;
  feature?: string;
  query?: string;
  filters?: Record<string, string>;
  /** YYYY, YYYY-MM or YYYY-MM-DD: inclusive bounds on the row's `date`. */
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_ROW_COLUMNS = 32;
export const MAX_CELL_CHARS = 500;
/** The most field names an unknown-field error lists. */
export const MAX_LISTED_FIELDS = 60;

function clampLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)));
}

/** Filters as a plain object of string values; nested or empty values are dropped. */
export function cleanFilters(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val == null || typeof val === 'object') continue;
    const s = String(val);
    if (!s.trim()) continue;
    out[k] = s;
  }
  return out;
}

/**
 * A date bound as 'YYYY-MM-DD': a year or a month widens to its first day (`from`) or its last
 * (`to`). Null when absent; an Error when it is not a real date in one of the three forms.
 */
export function dateBound(v: unknown, end: 'from' | 'to'): string | null | Error {
  if (v == null || (typeof v === 'string' && !v.trim())) return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(v).trim());
  if (!m) return new Error('not YYYY, YYYY-MM or YYYY-MM-DD');
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : end === 'from' ? 1 : 12;
  if (month < 1 || month > 12) return new Error('not a real month');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = m[3] ? Number(m[3]) : end === 'from' ? 1 : last;
  if (day < 1 || day > last) return new Error('not a real day');
  return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** What desk_row_fields answers: the fields the scope's rows carry, its rows and its dated rows. */
interface ScopeFields {
  rows: number;
  dated: number;
  fields: string[];
}
function scopeFields(data: unknown): ScopeFields {
  const d = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return {
    rows: Number(d.rows) || 0,
    dated: Number(d.dated) || 0,
    fields: Array.isArray(d.fields) ? d.fields.map(String) : [],
  };
}
function listFields(fields: string[]): string {
  if (!fields.length) return '(none: the scope holds no rows)';
  const shown = fields.slice(0, MAX_LISTED_FIELDS).join(', ');
  return fields.length > MAX_LISTED_FIELDS ? `${shown}, and ${fields.length - MAX_LISTED_FIELDS} more` : shown;
}

export function slimRow(row: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!row || typeof row !== 'object') return out;
  let n = 0;
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (v == null || v === '' || typeof v === 'object') continue;
    out[k] = String(v).slice(0, MAX_CELL_CHARS);
    if (++n >= MAX_ROW_COLUMNS) break;
  }
  return out;
}

function rowToDeskRow(r: Record<string, unknown>): DeskRow {
  return {
    tier: String(r.tier ?? ''),
    feature: String(r.feature ?? ''),
    row_key: String(r.row_key ?? ''),
    row: slimRow(r.row),
    record_text: String(r.record_text ?? ''),
    document_key: r.document_key == null ? null : String(r.document_key),
    snapshot_at: String(r.snapshot_at ?? ''),
  };
}

export async function executeSearchDeskRows(deps: DeskRowsDeps, args: SearchDeskRowsArgs): Promise<DeskRowsResult> {
  const tier = String(args?.tier ?? '').trim();
  if (!(DESK_TIERS as readonly string[]).includes(tier)) {
    return { rows: [], total: 0, snapshot_at: null, error: `Unknown desk "${tier}". Desks: ${DESK_TIERS.join(', ')}.` };
  }
  let feature: string | null = null;
  const wanted = args?.feature == null ? '' : String(args.feature).trim();
  if (wanted) {
    const hit = resolveFeature(tier, wanted);
    if (!hit) {
      const names = DESK_CATALOG.filter((e) => e.tier === tier).map((e) => e.feature).join(', ');
      return { rows: [], total: 0, snapshot_at: null, error: `Unknown module "${wanted}" on the ${tier} desk. Modules: ${names}.` };
    }
    feature = hit.feature;
  }
  const query = typeof args?.query === 'string' && args.query.trim() ? args.query.trim() : null;
  const filters = cleanFilters(args?.filters);
  const limit = clampLimit(args?.limit);
  const from = dateBound(args?.date_from, 'from');
  const to = dateBound(args?.date_to, 'to');
  for (const [name, bound, raw] of [['date_from', from, args?.date_from], ['date_to', to, args?.date_to]] as const) {
    if (bound instanceof Error) {
      return { rows: [], total: 0, snapshot_at: null, error: `${name} "${raw}" is ${bound.message}. Send YYYY, YYYY-MM or YYYY-MM-DD.` };
    }
  }
  if (from && to && from > to) {
    return { rows: [], total: 0, snapshot_at: null, error: `date_from ${from} is after date_to ${to}.` };
  }
  const scope = feature ?? `the ${tier} desk`;
  const conditions = [
    ...Object.entries(filters).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
    ...(from || to ? [`date ${from ?? 'any'} to ${to ?? 'any'}`] : []),
  ].join(', ');

  const { data, error } = await deps.rpc('search_desk_rows', {
    p_tier: tier,
    p_feature: feature,
    p_query: query,
    p_filters: filters,
    p_limit: limit,
    // Sent only when set, so a search without dates works against either version of the RPC.
    ...(from ? { p_date_from: from } : {}),
    ...(to ? { p_date_to: to } : {}),
  });
  if (error) throw new Error(`search_desk_rows: ${error.message}`);
  const raw = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const rows = raw.map(rowToDeskRow);
  const total = raw.length ? Number(raw[0].total ?? rows.length) : 0;
  const snapshot_at = rows.map((r) => r.snapshot_at).filter(Boolean).sort().pop() ?? null;
  if (!conditions) return { rows, total, snapshot_at };
  if (rows.length) return { rows, total, snapshot_at, conditions, scope };

  // A filtered or dated search found nothing. Containment cannot match a field the rows do not
  // carry, so this is the one result worth checking: ask what the scope's rows hold.
  const known = await deps.rpc('desk_row_fields', { p_tier: tier, p_feature: feature });
  if (known.error) throw new Error(`desk_row_fields: ${known.error.message}`);
  const scoped = scopeFields(known.data);
  const unknown = Object.keys(filters).filter((k) => !scoped.fields.includes(k));
  if (unknown.length) {
    const named = unknown.map((k) => `"${k}"`).join(', ');
    return {
      rows: [],
      total: 0,
      snapshot_at: null,
      error: `Unknown filter field${unknown.length > 1 ? 's' : ''} ${named} for ${scope}: no row has ${unknown.length > 1 ? 'them' : 'it'}, ` +
        `so this search was not run as asked and its zero means nothing. Filterable fields: ${listFields(scoped.fields)}. ` +
        'For a year or a period, use date_from and date_to (they apply to the row\'s date) instead of a filter.',
    };
  }
  if ((from || to) && scoped.rows > 0 && scoped.dated === 0) {
    return {
      rows: [],
      total: 0,
      snapshot_at: null,
      error: `${scope} has no dated rows, so date_from and date_to cannot apply. Search without them, or filter on its fields: ${
        listFields(scoped.fields)
      }.`,
    };
  }
  return { rows, total, snapshot_at, conditions, scope };
}

/** The text the loop shows the model: one labelled row per block, then the true total. */
export function renderDeskRows(result: DeskRowsResult, handles: string[]): string {
  if (result.error) return result.error;
  if (!result.rows.length && result.conditions) {
    // F197: a zero after filters is a count of the rows that meet these conditions, and says so.
    return `TOTAL: 0 rows match ${result.conditions} in ${result.scope ?? 'this desk'}. ` +
      `Report it as "0 matching rows for ${result.conditions}", not as a fact about the record at large; ` +
      'if the question needs another field or value, search again.';
  }
  if (!result.rows.length) return 'NO_RESULTS';
  // The row_key is deliberately absent. Printing it beside the handle offered
  // the model two identifiers for the same row and it cited the readable one,
  // producing `[open-fronts:russia-ukraine-war:0]` - which resolves to nothing,
  // so the turn persisted no sources at all. The handle is the only citable
  // token; resolution back to the row is the assigner's map, not the prompt.
  const blocks = result.rows.map((r, i) => `${handles[i] ?? `R${i + 1}`} | ${r.feature}\n${r.record_text}`);
  blocks.push(`TOTAL: ${result.total} rows match (snapshot ${result.snapshot_at ?? 'unknown'}); showing ${result.rows.length}`);
  return blocks.join('\n\n');
}
