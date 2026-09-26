/**
 * Union Budget Expenditure Profile — Statement 1 (stat1.xlsx).
 * Source: https://www.indiabudget.gov.in/doc/eb/stat1.xlsx
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { writablePath } from './writableRoot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const STAT1_URL = 'https://www.indiabudget.gov.in/doc/eb/stat1.xlsx';
const CACHE_JSON = path.join(APP_ROOT, 'public', 'data', 'centre_state_fund_flow.json');
const CACHE_XLSX = writablePath('stat1.xlsx');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let mem = null;

function parseNum(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '...' || s === '…' || s === '-' || s === '—') return null;
  const cleaned = s.replace(/[$,₹\s]/g, '').replace(/,/g, '');
  if (!cleaned || cleaned === '...') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cell(row, i) {
  return row?.[i] == null ? '' : String(row[i]).trim();
}

export function parseStat1Buffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames.find((n) => /statement\s*1/i.test(n)) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  const profile = cell(grid[0], 0).replace(/\s+/g, ' ').trim() || 'Expenditure Profile';
  const unit = (grid.map((r) => cell(r, 0)).find((t) => /₹|crore/i.test(t)) || '(In ₹ Crores)')
    .replace(/[()]/g, '')
    .trim();

  const rows = [];
  for (const raw of grid) {
    const lineRaw = cell(raw, 1);
    const label = cell(raw, 2);
    if (!label || !/^\d+\.?$/.test(lineRaw.replace(/\s/g, '')) && !/^\d+\s*$/.test(lineRaw)) {
      // line col may be "1.  " with spaces
    }
    const lineMatch = String(lineRaw).match(/(\d+)/);
    if (!lineMatch || !label) continue;
    const line = Number(lineMatch[1]);
    if (!Number.isFinite(line) || line < 1 || line > 20) continue;

    const vals = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15].map((i) => parseNum(raw[i]));
    // Col 14 may be blank before Total BE 2026-27
    const [
      a_rev,
      a_cap,
      a_tot,
      be_rev,
      be_cap,
      be_tot,
      re_rev,
      re_cap,
      re_tot,
      be2_rev,
      be2_cap,
      be2_tot,
    ] = vals;

    const isAggregate = /\(\d/.test(label) || /total expenditure/i.test(label);
    rows.push({
      line,
      category: label,
      title: label,
      is_aggregate: isAggregate,
      unit: '₹ crore',
      profile,
      actuals_2425_revenue: a_rev,
      actuals_2425_capital: a_cap,
      actuals_2425_total: a_tot,
      be_2526_revenue: be_rev,
      be_2526_capital: be_cap,
      be_2526_total: be_tot,
      re_2526_revenue: re_rev,
      re_2526_capital: re_cap,
      re_2526_total: re_tot,
      be_2627_revenue: be2_rev,
      be_2627_capital: be2_cap,
      be_2627_total: be2_tot,
      // Convenience fields for side panel / generic table
      revenue_be_cr: be2_rev,
      capital_be_cr: be2_cap,
      total_be_cr: be2_tot,
      transfers_share:
        line === 5 || line === 6 || line === 7 || line === 8 ? 'centre→state / transfers block' : '',
      source_url: STAT1_URL,
      date: profile.match(/20\d{2}/)?.[0] ? `${profile.match(/20\d{2}-\d{4}/)?.[0] || ''}` : '',
    });
  }

  return {
    ok: rows.length > 0,
    profile,
    unit,
    sheet: sheetName,
    source_url: STAT1_URL,
    fetched_at: new Date().toISOString(),
    rows,
  };
}

async function downloadStat1() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45_000);
  try {
    const res = await fetch(STAT1_URL, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
        'User-Agent': UA,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error('response is not a valid XLSX');
    }
    return buf;
  } finally {
    clearTimeout(t);
  }
}

function writeDiskCache(pack) {
  try {
    fs.mkdirSync(path.dirname(CACHE_JSON), { recursive: true });
    fs.writeFileSync(CACHE_JSON, JSON.stringify(pack, null, 0));
  } catch {
    /* ignore */
  }
}

/** Live download → parse. Disk/memory used only if the live download fails. */
export async function loadCentreStateFundFlow() {
  try {
    const buf = await downloadStat1();
    try {
      fs.mkdirSync(path.dirname(CACHE_XLSX), { recursive: true });
      fs.writeFileSync(CACHE_XLSX, buf);
    } catch {
      /* ignore */
    }
    const pack = parseStat1Buffer(buf);
    if (!pack.ok) throw new Error('Statement 1 parse returned no rows');
    pack._at = Date.now();
    mem = pack;
    writeDiskCache(pack);
    return pack;
  } catch (err) {
    if (mem?.rows?.length) {
      return { ...mem, stale: true, error: err.message || String(err) };
    }
    try {
      if (fs.existsSync(CACHE_JSON)) {
        const disk = JSON.parse(fs.readFileSync(CACHE_JSON, 'utf8'));
        if (disk?.rows?.length) {
          return { ...disk, stale: true, error: err.message || String(err) };
        }
      }
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export { STAT1_URL };
