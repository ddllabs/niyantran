/** Small helpers shared by the Global record adapters (F121). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "07 Sep 2026" in India time for an ISO timestamp or date, "Jul 2026" for a month; '' when it is not a date. */
export function dateLabel(value) {
  if (!value) return '';
  const month = /^(\d{4})-(\d{2})$/.exec(String(value).trim());
  if (month) return `${MONTHS[Number(month[2]) - 1] || ''} ${month[1]}`.trim();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // India time without locale data (ICU writes "Sept" in some runtimes): shift by +05:30, read UTC.
  const ist = new Date(d.getTime() + 330 * 60000);
  return `${String(ist.getUTCDate()).padStart(2, '0')} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

/** Today's date in India (YYYY-MM-DD), for marking a stated deadline as passed; UTC would be a day behind before 05:30 IST. */
export function todayInIndia(now = new Date()) {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

export const cap = (s) => {
  const text = String(s ?? '').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The row's own https source link, if any, as a header link. */
export const sourceLinks = (row, label = 'Source record') => (/^https:\/\//i.test(String(row?.source_url || '')) ? [{ label, href: row.source_url }] : []);

/** Only the [label, value] rows whose value is present. */
export const presentRows = (pairs) => pairs.filter(([, v]) => String(v ?? '').trim());

/** The provenance flag a register row carries ("unconfirmed"), as footer text. */
export const provenanceFlags = (row) => (String(row?.provenance || '').toLowerCase() === 'unconfirmed' ? ['provenance unconfirmed'] : []);
