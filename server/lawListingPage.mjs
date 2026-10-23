import { parsePageQuery, LAW_LISTING_FEATURE } from '../src/lib/pagedFeatures.js';

const columns = [
  { key: 'title', label: 'Title' }, { key: 'date', label: 'Date' },
  { key: 'court', label: 'Forum' }, { key: 'record_type', label: 'Document type' },
  { key: 'availability', label: 'Text availability' }, { key: 'source_url', label: 'Source' },
];

/** Bounded canonical read. Only an explicit pre-seed response allows the legacy register. */
export async function serveLawListingPage(searchParams, { env = process.env, fetch = globalThis.fetch, authorization } = {}) {
  if (searchParams.get('feature') !== LAW_LISTING_FEATURE) return null;
  const opts = parsePageQuery(searchParams);
  if (!opts.ok || opts.answer.length) return { status: 400, body: { ok: false, error: opts.error || 'Bad parameter: answer' } };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || key.startsWith('sb_secret_')) throw new Error('Law listing public client configuration unavailable');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // A publishable key is not a JWT; omit Authorization for anonymous reads.
  if (authorization) headers.Authorization = authorization;
  const { ok: _ok, answer: _answer, ...p } = opts;
  if (!p.sort) { p.sort = 'date'; p.dir = 'desc'; }
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/law_listing_page`, {
    method: 'POST', headers, body: JSON.stringify({ p }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Law listing database unavailable');
  const data = await response.json();
  if (data?.active === false) return null;
  if (data?.active !== true || !Array.isArray(data.rows) || data.rows.length > p.pageSize
    || !Number.isInteger(data.total) || data.total < 0 || !Number.isInteger(data.totalAll) || data.totalAll < data.total) {
    throw new Error('Invalid Law listing response');
  }
  return { status: 200, body: {
    ok: true, feature: LAW_LISTING_FEATURE, tier: 'judiciary', paged: true, prepared: true,
    rows: data.rows, total: data.total, totalAll: data.totalAll, page: p.page, pageSize: p.pageSize,
    columns, filterGroups: [
      ['record_type', 'Document type', [['tribunal_order', 'Tribunal orders'], ['announcement', 'Public announcements']]],
      ['availability', 'Text availability', [['indexed', 'Indexed text'], ['source-only', 'Source only']]],
      ['court', 'Forum', [['NCLT', 'NCLT'], ['IBBI', 'IBBI']]],
    ].map(([col, title, values]) => ({ id: col, col, title, options: values.map(([value, label]) => ({ label, filterCol: col, filterValue: value })) })),
    overview: { title: 'Legal records', kpis: [{ label: 'Listings', value: data.totalAll, sub: 'Orders and announcements; not an indexed-document count' }], charts: [], note: 'Orders and public announcements are separate records. Text availability reflects verified indexed attachments.' },
    source: { adapter: 'law-canonical', links: [], note: 'Published legal records and verified document attachments.' },
    fallback: false,
  } };
}
