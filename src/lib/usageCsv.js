/**
 * The All AI activity export (F153, spec Decision 8): CSV in credits with their rupee value, never
 * dollars. Split from creditUsage.js, which reads the reports.
 */
import { roleLabel, rowChat, statusLabel } from './creditUsage.js';

function num(value) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? 0 : n;
}

const IST_STAMP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function cell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // A cell a spreadsheet would run as a formula is kept as text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The activity rows as CSV, in credits with their rupee value (credits x the published rupees per
 * credit, 2 places) and never dollars. Times are IST. One line per row; a grouped row's calls follow
 * it as indented lines when `withCalls` is set.
 */
export function activityCsv(rows, inrPerCredit, { withCalls = true } = {}) {
  const rate = Number(inrPerCredit);
  const inr = (credits) => (Number.isFinite(rate) && rate > 0 ? (num(credits) * rate).toFixed(2) : '');
  const credits = (value) => String(Number(num(value).toFixed(4)));
  const lines = [['When (IST)', 'Chat', 'Question', 'Kind', 'Model', 'Thinking', 'Status', 'Calls', 'Tokens', 'Credits', 'Rupees (₹)']];
  for (const row of rows) {
    const at = Date.parse(row.createdAt || '');
    lines.push([
      Number.isFinite(at) ? IST_STAMP.format(at).replace(',', '') : '',
      rowChat(row), row.question || '', 'Row', row.model || '', '', statusLabel(row.status),
      row.calls, row.tokens, credits(row.credits), inr(row.credits),
    ]);
    if (withCalls) {
      for (const d of row.detail) {
        lines.push(['', '', '', roleLabel(d.role), d.model || '', d.effort || '', statusLabel(d.status), 1, d.tokens,
          d.free ? '0' : credits(d.credits), d.free ? '0.00' : inr(d.credits)]);
      }
    }
  }
  return `${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Hands the browser a CSV file to save. */
export function downloadCsv(filename, csv) {
  if (typeof document === 'undefined') return;
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
