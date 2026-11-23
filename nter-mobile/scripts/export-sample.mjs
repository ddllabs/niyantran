// Builds the app's offline sample from nter.pro's OWN code and static archive, read-only.
// Run from a checkout of ddllabs/niyantran:  npx vite-node /path/to/nter-mobile-app/scripts/export-sample.mjs
// It never touches the live database: rows come from public/data (the archive the site itself ships).
import fs from 'node:fs';
import path from 'node:path';

const SITE = process.cwd();
const OUT = process.env.SAMPLE_OUT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src/sample');
const ROWS_PER_MODULE = Number(process.env.ROWS_PER_MODULE || 30);

// fetch shim: site-relative paths read from public/, anything remote is "offline".
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('/')) {
    const file = path.join(SITE, 'public', decodeURIComponent(url.split('?')[0]));
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
    const buf = fs.readFileSync(file);
    const type = file.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    return new Response(buf, { status: 200, headers: { 'content-type': type } });
  }
  void realFetch;
  throw new TypeError('offline');
};

const site = (p) => path.join(SITE, p);
const { NATIONAL_PRESENTATION } = await import(site('src/desks/landing/deskPresentation.js'));
const { GLOBAL_PRESENTATION } = await import(site('src/desks/landing/globalPresentation.js'));
const { LAW_PRESENTATION } = await import(site('src/desks/landing/lawPresentation.js'));
const { ECONOMICS_PRESENTATION } = await import(site('src/desks/landing/economicsPresentation.js'));
const { CARBON_PRESENTATION } = await import(site('src/desks/landing/carbonPresentation.js'));
const { SPORTS_PRESENTATION } = await import(site('src/desks/landing/sportsPresentation.js'));
const { ENTERTAINMENT_PRESENTATION } = await import(site('src/desks/landing/entertainmentPresentation.js'));
const { STATE_PRESENTATION } = await import(site('src/desks/landing/statePresentation.js'));
const { DESK_IMAGES, DESK_IMAGE_COMPOSITES } = await import(site('src/desks/landing/deskImages.js'));
const { DESK_DEFAULTS } = await import(site('src/desks/landing/deskDefaults.js'));
const { fetchArchiveFeature } = await import(site('src/lib/archiveFeed.js'));
const { feedColumns } = await import(site('src/lib/columns.js'));

const presentations = [NATIONAL_PRESENTATION, GLOBAL_PRESENTATION, STATE_PRESENTATION, LAW_PRESENTATION,
  ECONOMICS_PRESENTATION, CARBON_PRESENTATION, SPORTS_PRESENTATION, ENTERTAINMENT_PRESENTATION];

const imageOf = (name) => {
  if (!name) return null;
  if (DESK_IMAGE_COMPOSITES[name]) return { layers: DESK_IMAGE_COMPOSITES[name].map((f) => DESK_IMAGES[f] || f) };
  const file = /\.[a-z]+$/i.test(name) ? name : `${name}.jpg`;
  return DESK_IMAGES[file] || DESK_IMAGES[name] || null;
};
const plain = (v) => JSON.parse(JSON.stringify(v));

const desks = presentations.map((d) => ({
  id: d.id, name: d.name, title: d.title, description: d.description, heading: d.heading,
  image: imageOf(d.image), imageLabel: d.imageLabel || '', defaults: DESK_DEFAULTS[d.id] || {},
  groups: d.groups.map((g) => ({
    id: g.id, name: g.name, short: g.short || g.name, title: g.title, description: g.description,
    cardDescription: g.cardDescription || g.description, image: imageOf(g.image),
    modules: g.modules.map((m) => ({ tier: m.tier, feature: m.feature, title: m.title || m.feature, configured: m.configured !== false, existingOnly: !!m.existingOnly })),
  })),
}));

const SKIP = new Set(['status', 'id', 'reporting_search', 'adapter', 'host', 'fail_reason', 'backup_part', 'backup_function']);
const trimRow = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (v == null || v === '' || SKIP.has(k)) continue;
    if (typeof v === 'object') { const s = JSON.stringify(v); if (s.length <= 600) out[k] = v; continue; }
    out[k] = typeof v === 'string' && v.length > 1200 ? `${v.slice(0, 1200)}…` : v;
  }
  return out;
};

const modules = {};
let withRows = 0;
for (const d of desks) for (const g of d.groups) for (const m of g.modules) {
  const key = `${m.tier}::${m.feature}`;
  if (modules[key]) continue;
  let body = null;
  try { body = await fetchArchiveFeature({ tier: m.tier, feature: m.feature }); } catch (e) { body = { rows: [], source: { note: String(e.message || e) } }; }
  const all = (body?.rows || []).filter((r) => r && r.status !== 'source_status');
  let cols = [];
  try { cols = (feedColumns(m.feature, all) || []).slice(0, 8).map((c) => (typeof c === 'string' ? { key: c, label: c } : { key: c.key || c.field || c.id, label: c.label || c.title || c.key })); } catch { cols = []; }
  modules[key] = plain({
    tier: m.tier, feature: m.feature, desk: d.id, total: all.length, columns: cols.filter((c) => c.key),
    source: { adapter: body?.source?.adapter || body?.adapter || '', note: body?.source?.note || body?.note || '', kind: body?.source?.kind || '' },
    coverage: body?.coverage || null, rows: all.slice(0, ROWS_PER_MODULE).map(trimRow),
  });
  if (all.length) withRows++;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'desks.json'), JSON.stringify(desks));
// one file per desk so the app loads a desk's modules lazily
for (const d of desks) {
  const own = Object.fromEntries(Object.entries(modules).filter(([, v]) => v.desk === d.id));
  fs.writeFileSync(path.join(OUT, `modules-${d.id}.json`), JSON.stringify(own));
}
const count = Object.keys(modules).length;
console.log(JSON.stringify({ desks: desks.length, modules: count, withRows, out: OUT }));
