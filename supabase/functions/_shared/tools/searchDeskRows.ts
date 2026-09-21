// The search_desk_rows tool (desk-row-grounding spec §C, fixed interface,
// consumed by streaming-research-agent exactly as declared here). The
// executor validates the arguments, resolves the module name through the
// catalogue, clamps the limit, passes the filters as a bound JSON value and
// slims the rows; labelling rows with handles and rendering them for the
// model is renderDeskRows. Argument problems come back as `error` text the
// loop shows the model verbatim; infrastructure failures throw.

import { DESK_CATALOG, DESK_TIERS, resolveFeature } from '../deskCatalog.ts';

export const SEARCH_DESK_ROWS_TOOL = {
  type: 'function',
  function: {
    name: 'search_desk_rows',
    description:
      'Look up rows in a terminal desk module and get the true total. Use for counts, lists, filters and comparisons across rows. Not for what a document says — use search_documents for that.',
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['global', 'national', 'state', 'law', 'economics', 'carbon', 'sports', 'entertainment'] },
        feature: {
          type: 'string',
          description: 'Module name from the catalogue, e.g. "Bill Passage Probability Index". Omit to search every module in the tier.',
        },
        query: { type: 'string', description: 'Free text matched against every column.' },
        filters: { type: 'object', additionalProperties: { type: 'string' }, description: 'Exact column = value conditions.' },
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
}

export interface DeskRowsDeps {
  rpc(fn: 'search_desk_rows', args: Record<string, unknown>): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
}

export interface SearchDeskRowsArgs {
  tier: string;
  feature?: string;
  query?: string;
  filters?: Record<string, string>;
  limit?: number;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_ROW_COLUMNS = 32;
export const MAX_CELL_CHARS = 500;

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

  const { data, error } = await deps.rpc('search_desk_rows', {
    p_tier: tier,
    p_feature: feature,
    p_query: query,
    p_filters: filters,
    p_limit: limit,
  });
  if (error) throw new Error(`search_desk_rows: ${error.message}`);
  const raw = (data ?? []) as Record<string, unknown>[];
  const rows = raw.map(rowToDeskRow);
  const total = raw.length ? Number(raw[0].total ?? rows.length) : 0;
  const snapshot_at = rows.map((r) => r.snapshot_at).filter(Boolean).sort().pop() ?? null;
  return { rows, total, snapshot_at };
}

/** The text the loop shows the model: one labelled row per block, then the true total. */
export function renderDeskRows(result: DeskRowsResult, handles: string[]): string {
  if (result.error) return result.error;
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
