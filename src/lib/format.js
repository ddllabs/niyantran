/**
 * Shared display formatters for the desk data-display contract.
 */

import { softenDashes, toTitleCase } from './textStyle.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value).trim();
  if (!s || /^n\/?a$/i.test(s) || s === '—' || s === '-') return null;

  // 02.04.2026 or 02-04-2026 (prefer DMY for Indian sources)
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    if (!Number.isNaN(d.getTime())) return d;
  }

  // 2018-12-20 00:00:00.0 / ISO
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Canonical UI date: `05 Sep 2026`. */
export function formatDate(value) {
  const d = parseDate(value);
  if (!d) return null;
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Secondary time label: `14:30 IST`. */
export function formatTimeIst(value) {
  const d = parseDate(value);
  if (!d) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (hh === '00' && mm === '00') return null;
  return `${hh}:${mm} IST`;
}

export function formatDateTime(value) {
  const day = formatDate(value);
  if (!day) return '';
  const t = formatTimeIst(value);
  return t ? `${day} · ${t}` : day;
}

export function formatNumber(value, { digits = 0, empty = '-' } = {}) {
  if (value == null || value === '') return empty;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return empty;
  return n.toLocaleString('en-IN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatPercent(value, { digits = 1, empty = '-' } = {}) {
  if (value == null || value === '') return empty;
  let n = typeof value === 'number' ? value : Number(String(value).replace(/%/g, '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return empty;
  // If stored as 0–1 fraction, expand.
  if (Math.abs(n) <= 1 && String(value).includes('.') && !String(value).includes('%')) {
    /* keep as-is if already looks like 0.5 meaning 0.5% — desks usually store percent points */
  }
  return `${n.toFixed(digits)}%`;
}

export function formatPp(value, { digits = 1, empty = '-' } = {}) {
  if (value == null || value === '') return empty;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return empty;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)} pp`;
}

/**
 * Concise INR display. Exact raw stays for detail rail/export.
 * Accepts rupee strings like "Rs 8,05,85,824~ 8 Crore+".
 */
export function formatInrCompact(value, { empty = '-' } = {}) {
  if (value == null || value === '') return empty;
  const raw = String(value);
  const croreHint = raw.match(/([\d.]+)\s*Crore/i);
  if (croreHint) {
    const n = Number(croreHint[1]);
    if (Number.isFinite(n)) return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} cr`;
  }
  const digits = raw.replace(/[^\d.]/g, '');
  const n = Number(digits);
  if (!Number.isFinite(n) || n === 0 && !/\d/.test(raw)) return empty;
  if (n >= 1e7) return `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function formatUsdCompact(value, { empty = '-' } = {}) {
  if (value == null || value === '') return empty;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,$]/g, ''));
  if (!Number.isFinite(n)) return empty;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}bn`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}m`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * Null contract: `—` for unavailable, keep `0` for measured zero,
 * `Not reported` when source omitted a field.
 */
export function formatNull(value, { omitted = false, empty = '-' } = {}) {
  if (omitted) return 'Not reported';
  if (value == null || value === '') return empty;
  if (value === 0 || value === '0') return '0';
  return String(value);
}

const DATEISH =
  /^(date|introduced|tabled|published|updated|verified|effective|deadline|as_of|asof|net|order_date|event_date|last_verified|data_through|started|since)$/i;
const PCTISH = /(pct|percent|%|vote_share|turnout|utilization|utilisation|gap_pct|net_pct)/i;
const INRISH = /(asset|liabilit|mplads|outlay|value_inr|budget|sanction)/i;

export function formatCell(value, col = {}) {
  if (value == null || String(value).trim() === '') return '-';
  const key = String(col.key || col.label || '');
  if (col.date || DATEISH.test(key)) {
    return formatDate(value) || formatNull(value);
  }
  if (col.pct || PCTISH.test(key)) {
    return formatPercent(value);
  }
  if (col.inr || (/assets|liabilities/i.test(key) && /rs|crore|₹/i.test(String(value)))) {
    return formatInrCompact(value);
  }
  if (col.num && typeof value === 'number') {
    return formatNumber(value, { digits: col.digits ?? 0 });
  }
  // Normalize ISO timestamps embedded in otherwise free text cells.
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value)) || /^\d{1,2}[./-]\d{1,2}[./-]\d{4}/.test(String(value))) {
    const d = formatDate(value);
    if (d) return d;
  }
  // Bills + cabinet/decision titles: Title Case every word (uniform; kills ALL CAPS mix).
  if (/bill_name|^bill$/i.test(key)) {
    return toTitleCaseEveryWord(String(value).trim());
  }
  if (/title|policy_name|subject|topic|decision|headline/i.test(key) && (col.dot || /topic|decision/i.test(key))) {
    return toTitleCase(softenDashes(String(value).trim()));
  }
  if (/house|sector|stage|current_stage|ministry|party|department/i.test(key)) {
    return formatStatus(value);
  }
  return softenDashes(String(value));
}

function toTitleCaseEveryWord(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/\b[\w'’]+/g, (word) => {
      if (/^(ias|ips|un|eu|uk|us|nato|rbi|sebi|gdp|be|re|fy|sc|hc|nclt|nclat|cbi|ed|mplad|gst)$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

export function truncateTwoLines(text, max = 160) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Controlled Title Case for status / stage pills (not SCREAMING or lowercase mix). */
export function formatStatus(value) {
  if (value == null || String(value).trim() === '') return '-';
  const s = String(value).trim().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ');
  return s.replace(/\b[\w']+\b/g, (w) => {
    if (/^(IAS|IPS|UN|EU|UK|US|NATO|RBI|SEBI|GDP|BE|RE|FY|SC|HC|NCLT|NCLAT|CBI|ED)$/i.test(w)) {
      return w.toUpperCase();
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

/**
 * Semantic status tone classification for cards and status pills.
 * Expected semantic direction:
 *   Active / Passed / Verified → green
 *   Pending / Under Review / Medium → amber
 *   High / Critical / Escalating → red
 *   Stable / Low / Frozen → neutral
 */
export function getStatusToneClass(value) {
  if (value == null || String(value).trim() === '' || value === '-') {
    return 'status-neutral';
  }
  const s = String(value).trim().toLowerCase();

  // Green / Positive: Active, Passed, Verified, Resolved, Complete, Enacted, Assented, Safe
  if (/^(active|passed|verified|resolved|complete|completed|enacted|assented|safe|normal|operational|yes|approved)$/i.test(s)
      || s.includes('passed') || s.includes('verified') || s.includes('assented')) {
    return 'status-green';
  }

  // Red / Critical: Critical, High, Severe, Escalating, Urgent, Failed, Rejected, Danger
  if (/^(critical|escalating|severe|danger|high|urgent|failed|emergency|red)$/i.test(s)
      || s.includes('escalating') || s.includes('critical') || s.includes('severe')) {
    return 'status-red';
  }

  // Amber / Warning / Medium: Pending, Under Review, Medium, Warning, In Progress, Introduced, Moderate
  if (/^(pending|under review|medium|warning|in progress|introduced|moderate|caution|amber|review|deliberation)$/i.test(s)
      || s.includes('pending') || s.includes('under review') || s.includes('progress') || s.includes('review') || s.includes('medium')) {
    return 'status-amber';
  }

  // Neutral / Stable / Low / Frozen
  if (/^(stable|low|frozen|neutral|muted|info|on hold|paused|dormant)$/i.test(s)
      || s.includes('stable') || s.includes('low') || s.includes('frozen')) {
    return 'status-neutral';
  }

  return 'status-neutral';
}
