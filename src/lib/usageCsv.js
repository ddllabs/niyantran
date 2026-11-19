/**
 * The All AI activity export (F153): CSV in credits only (F184, owner 2026-10-15: users buy and
 * spend credits). Split from creditUsage.js, which reads the reports.
 */
import { isRefund, roleLabel, rowChat, statusLabel } from './creditUsage.js';

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
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The activity rows as CSV, in credits (spent is positive, a refund is negative). Times are IST. One line per row; a grouped row's calls follow
 * it as indented lines when `withCalls` is set.
 */
export function activityCsv(rows, { withCalls = true } = {}) {
  // A number, so a negative one is not mistaken for text a spreadsheet might run as a formula.
  const credits = (value) => Number(num(value).toFixed(4));
  const lines = [['When (IST)', 'Chat', 'Question', 'Kind', 'Model', 'Thinking', 'Status', 'Calls', 'Tokens', 'Credits']];
  for (const row of rows) {
    const at = Date.parse(row.createdAt || '');
    lines.push([
      Number.isFinite(at) ? IST_STAMP.format(at).replace(',', '') : '',
      rowChat(row), row.question || '', isRefund(row) ? 'Refund' : 'Row', row.model || '', '', statusLabel(row.status),
      row.calls, row.tokens, isRefund(row) ? -credits(row.credits) || 0 : credits(row.credits),
    ]);
    if (withCalls) {
      for (const d of row.detail) {
        lines.push(['', '', '', roleLabel(d.role), d.model || '', d.effort || '', statusLabel(d.status), 1, d.tokens,
          d.free ? '0' : credits(d.credits)]);
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
