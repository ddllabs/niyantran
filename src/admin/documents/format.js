// Formatting shared by the Documents tab's pieces.

/** Decimal megabytes, as the upload limits are stated: two places under 10 MB, one above. */
export function formatMB(bytes) {
  const mb = (Number(bytes) || 0) / 1_000_000;
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

/** US dollars to four places (a page of OCR costs $0.004). */
export function formatUsd(value) {
  return `$${(Number(value) || 0).toFixed(4)}`;
}

/** "in 30 s", "3 min ago", "3 h ago", "just now"; "—" when there is no time. */
export function relativeTime(iso, now = Date.now()) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '—';
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < 5_000) return 'just now';
  let amount;
  if (abs < 60_000) amount = `${Math.round(abs / 1000)} s`;
  else if (abs < 3_600_000) amount = `${Math.round(abs / 60_000)} min`;
  else if (abs < 48 * 3_600_000) amount = `${Math.round(abs / 3_600_000)} h`;
  else amount = `${Math.round(abs / 86_400_000)} d`;
  return diff > 0 ? `in ${amount}` : `${amount} ago`;
}

export function titleFromFileName(name) {
  const bare = String(name ?? '').replace(/\.pdf$/i, '').trim();
  return bare || String(name ?? '');
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
