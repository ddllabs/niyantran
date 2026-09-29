/**
 * Exhaustive desk backup packs under backup/{DESK}/*.xlsx
 * Used only when live + archive return no real rows.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_ROOT = path.join(__dirname, '..', 'backup');
const DEFAULT_CAP = 500;

const TIER_TO_DESK = {
  global: 'GLOBAL',
  national: 'NATIONAL',
  state: 'STATE',
  local: 'STATE',
  judiciary: 'LAW',
  law: 'LAW',
  finance: 'ECONOMICS',
  economics: 'ECONOMICS',
  climate: 'CARBON',
  carbon: 'CARBON',
  sports: 'SPORTS',
  entertainment: 'ENTERTAINMENT',
};

/** Feature → backup manifest function (norm keys). */
const FEATURE_ALIASES = {
  'up high court allahabad order feed': 'high court case tracker',
  'nse bse delayed market feed': 'nse bse market feed',
  'nse bse market feed': 'nse bse market feed',
  'music charts india top 25': 'india music charts',
  'music charts global top 25': 'global music charts',
  'key financial indicators gdp cpi pmi emp to pop':
    'all countries key financial indicators gdp cpi pmi emp to pop',
  'prediction market political odds': 'prediction market',
  'hc judge profiles bench analytics': 'judge profiles bench analytics',
  'candidate affidavit database structured api': 'candidate affidavit database',
  'sector policy power energy green critical minerals':
    'sector policy power energy green critical minerals',
};

let indexCache = null;
const fileRowCache = new Map();

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadIndex() {
  if (indexCache) return indexCache;
  const byDesk = new Map();
  const byFunction = new Map();
  if (!fs.existsSync(BACKUP_ROOT)) {
    indexCache = { byDesk, byFunction };
    return indexCache;
  }
  for (const desk of fs.readdirSync(BACKUP_ROOT)) {
    const manPath = path.join(BACKUP_ROOT, desk, 'manifest.json');
    if (!fs.existsSync(manPath)) continue;
    let man;
    try {
      man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    } catch {
      continue;
    }
    const parts = Array.isArray(man.parts) ? man.parts : [];
    byDesk.set(desk.toUpperCase(), parts);
    for (const p of parts) {
      const key = norm(p.function);
      if (!key) continue;
      if (!byFunction.has(key)) byFunction.set(key, []);
      byFunction.get(key).push({ desk: desk.toUpperCase(), ...p });
    }
  }
  indexCache = { byDesk, byFunction };
  return indexCache;
}

function scoreMatch(featureNorm, functionNorm) {
  if (!featureNorm || !functionNorm) return 0;
  if (featureNorm === functionNorm) return 100;
  if (featureNorm.startsWith(functionNorm) || functionNorm.startsWith(featureNorm)) {
    const ratio =
      Math.min(featureNorm.length, functionNorm.length) /
      Math.max(featureNorm.length, functionNorm.length);
    return 70 + ratio * 20;
  }
  if (featureNorm.includes(functionNorm) || functionNorm.includes(featureNorm)) {
    // Avoid "Infra" stealing "Satellite Infrastructure".
    if (functionNorm.length < 10 && featureNorm.length > functionNorm.length + 6) return 15;
    const ratio =
      Math.min(featureNorm.length, functionNorm.length) /
      Math.max(featureNorm.length, functionNorm.length);
    return 45 + ratio * 30;
  }
  const a = new Set(featureNorm.split(' ').filter((w) => w.length > 2));
  const b = functionNorm.split(' ').filter((w) => w.length > 2);
  if (!a.size || !b.length) return 0;
  let hit = 0;
  for (const w of b) if (a.has(w)) hit += 1;
  const overlap = hit / Math.max(a.size, b.length);
  return overlap >= 0.6 ? overlap * 55 : overlap * 35;
}

function resolveParts(featureName, tier) {
  const { byFunction } = loadIndex();
  const featureNorm = norm(featureName);
  const aliasTarget = FEATURE_ALIASES[featureNorm];
  const want = aliasTarget || featureNorm;
  const preferDesk = TIER_TO_DESK[norm(tier)] || '';

  let best = null;
  let bestScore = 0;

  const consider = (fnNorm, parts) => {
    const s = scoreMatch(want, fnNorm);
    if (s < 45) return;
    const deskBonus = preferDesk && parts.some((p) => p.desk === preferDesk) ? 5 : 0;
    const score = s + deskBonus;
    if (score > bestScore) {
      bestScore = score;
      best = parts;
    }
  };

  if (aliasTarget && byFunction.has(aliasTarget)) {
    consider(aliasTarget, byFunction.get(aliasTarget));
  }
  for (const [fnNorm, parts] of byFunction.entries()) {
    consider(fnNorm, parts);
  }

  if (!best?.length) return null;

  // Prefer preferred desk copies when the same function exists in multiple desks
  // (e.g. Cabinet Decisions NATIONAL vs STATE).
  let parts = best;
  if (preferDesk) {
    const deskOnly = parts.filter((p) => p.desk === preferDesk);
    if (deskOnly.length) parts = deskOnly;
  }

  // High-court style: only load the part matching the feature (Allahabad, etc.).
  const courtHints = [
    'allahabad',
    'bombay',
    'calcutta',
    'delhi',
    'madras',
    'karnataka',
    'kerala',
    'gujarat',
    'rajasthan',
    'patna',
    'orissa',
    'odisha',
    'gauhati',
    'telangana',
    'andhra',
    'chhattisgarh',
    'himachal',
    'jammu',
    'jharkhand',
    'madhya',
    'manipur',
    'meghalaya',
    'punjab',
    'haryana',
    'sikkim',
    'tripura',
    'uttarakhand',
  ];
  const hint = courtHints.find((h) => featureNorm.includes(h));
  if (hint) {
    const filtered = parts.filter(
      (p) => norm(p.part).includes(hint) || norm(p.file).includes(hint),
    );
    if (filtered.length) parts = filtered;
  }

  return { parts, score: bestScore, functionName: parts[0]?.function || featureName };
}

function isHeaderRow(row) {
  const first = String(row?.[0] ?? '')
    .trim()
    .toLowerCase();
  return first === 'record_id' || first === 'id' || first === 'title';
}

function cleanHeaders(headerRow) {
  const headers = [];
  for (const cell of headerRow || []) {
    const h = String(cell ?? '').trim();
    if (!h) {
      headers.push('');
      continue;
    }
    // Chart / KPI spill into the header row after real columns.
    if (/^\d{4}-\d{2}/.test(h) || (/^\d+$/.test(h) && headers.length > 8)) break;
    if (!/^[A-Za-z_][A-Za-z0-9_ %./()-]*$/.test(h) && headers.length > 5) break;
    headers.push(h);
  }
  return headers;
}

function rowFromCells(headers, cells) {
  const out = {};
  let nonempty = 0;
  for (let i = 0; i < headers.length; i += 1) {
    const key = headers[i];
    if (!key) continue;
    let v = cells[i];
    if (v == null) v = '';
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    else v = typeof v === 'string' ? v.trim() : v;
    if (v !== '' && v != null) nonempty += 1;
    out[key] = v;
  }
  if (!nonempty) return null;

  const title =
    out.record_title ||
    out.title ||
    out.case_title ||
    out.name ||
    out.subject ||
    out.primary_entity ||
    '';
  const date =
    out.record_date ||
    out.date ||
    out.published_at ||
    out.source_published_at ||
    out.order_date ||
    '';
  const source_url = out.source_url || out.publisher_url || out.url || out.link || '';

  return {
    ...out,
    title: String(title || out.record_id || '').trim(),
    date: String(date || '').slice(0, 32),
    source_url: String(source_url || ''),
  };
}

function parseXlsxRows(filePath, cap) {
  const st = fs.statSync(filePath);
  const cacheKey = `${filePath}::${st.mtimeMs}::${cap}`;
  const hit = fileRowCache.get(cacheKey);
  if (hit) return hit;

  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  let headerIdx = grid.findIndex(isHeaderRow);
  if (headerIdx < 0) {
    // Fallback: first row with ≥5 string headers
    headerIdx = grid.findIndex(
      (r) => (r || []).filter((c) => /^[A-Za-z_]/.test(String(c || ''))).length >= 5,
    );
  }
  if (headerIdx < 0) {
    fileRowCache.set(cacheKey, []);
    return [];
  }

  const headers = cleanHeaders(grid[headerIdx]);
  if (!headers.length) {
    fileRowCache.set(cacheKey, []);
    return [];
  }

  const rows = [];
  for (let i = headerIdx + 1; i < grid.length && rows.length < cap; i += 1) {
    const mapped = rowFromCells(headers, grid[i] || []);
    if (!mapped) continue;
    if (!mapped.title && !mapped.record_id) continue;
    // Skip leftover KPI / chart rows
    if (/^records$/i.test(mapped.title) || /enrichment records/i.test(mapped.title)) continue;
    rows.push(mapped);
  }

  fileRowCache.set(cacheKey, rows);
  return rows;
}

/**
 * Load exhaustive backup rows for a desk feature.
 * @returns {{ rows: object[], meta: object } | null}
 */
export function loadBackupForFeature(featureName, tier = '', { cap = DEFAULT_CAP } = {}) {
  const resolved = resolveParts(featureName, tier);
  if (!resolved?.parts?.length) return null;

  const rows = [];
  const filesUsed = [];
  for (const part of resolved.parts) {
    if (rows.length >= cap) break;
    const filePath = path.join(BACKUP_ROOT, part.desk, part.file);
    if (!fs.existsSync(filePath)) continue;
    const chunk = parseXlsxRows(filePath, cap - rows.length);
    if (!chunk.length) continue;
    filesUsed.push(part.file);
    for (const r of chunk) {
      rows.push({
        ...r,
        backup_part: part.part || 'FULL',
        backup_function: part.function,
      });
      if (rows.length >= cap) break;
    }
  }

  if (!rows.length) return null;

  const coverageScope = resolved.parts.map((p) => p.coverage_scope).filter(Boolean)[0] || '';
  const totalDeclared = resolved.parts.reduce((n, p) => n + (Number(p.records) || 0), 0);

  return {
    rows,
    meta: {
      heading: resolved.functionName,
      backup: true,
      exhaustive: true,
      files: filesUsed,
      declaredRecords: totalDeclared,
      coverageScope,
      status: 'BACKUP · EXHAUSTIVE PACK',
    },
    note:
      `Exhaustive shipped backup · ${rows.length.toLocaleString()} row` +
      `${rows.length === 1 ? '' : 's'}` +
      (totalDeclared > rows.length ? ` (pack has ${totalDeclared.toLocaleString()}; capped for display)` : '') +
      (coverageScope ? ` · ${coverageScope}` : '') +
      '. Live and archive returned no rows.',
  };
}

export function backupHasFeature(featureName, tier = '') {
  return Boolean(resolveParts(featureName, tier));
}

/** Test helper / admin: list indexed backup functions. */
export function listBackupFunctions() {
  const { byFunction } = loadIndex();
  return [...byFunction.keys()].sort();
}
