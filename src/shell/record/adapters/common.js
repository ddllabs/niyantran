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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether the text names a company (F124): by a multi-word name or alias (any case, so an
 * all-capitals bill title still matches), or an upper-case abbreviation ("ONGC", "SAIL") standing as
 * a whole token. A single ordinary word ("Oil", "Reliance") is not a mention, though the ontology
 * lists it as an alias; and in text written in capitals every word looks like an abbreviation, so
 * abbreviations are not read from it.
 */
function namesCompany(company, text) {
  const t = String(text || '');
  const shouting = /[A-Z]/.test(t) && !/[a-z]/.test(t);
  return [company.name, company.legalName, ...(company.aliases || [])].filter(Boolean).some((alias) => {
    const a = String(alias).trim();
    const multiWord = /\s/.test(a);
    if (!multiWord && (shouting || !/^[A-Z0-9&]{3,}$/.test(a))) return false;
    return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(a)}($|[^A-Za-z0-9])`, multiWord ? 'i' : '').test(t);
  });
}

/** The companies of an impact model (buildRecordModel) that the record's own text names; never sector-level (P2). */
export function companiesNamedIn(impact, ontology, text) {
  const registered = new Map((ontology?.companies || []).map((c) => [`company:${c.id}`, c]));
  return (impact?.companies || [])
    .filter((c) => c.path !== 'P2' && registered.has(c.id) && namesCompany(registered.get(c.id), text))
    .map((c) => c.name)
    .filter(Boolean);
}
