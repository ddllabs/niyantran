import { presentRows, sourceLinks } from './common.js';

/**
 * NCLT / NCLAT (Insolvency) → record panel (F128 L2; docs/specs/2026-10-13-law-record-panels.md).
 * Rows are the stored pack as `insolvencyRows` (src/lib/lawPack.js) shapes it for the server and the
 * client fallback alike: 148 NCLT orders as IBBI republishes them (court "NCLT": subject with the case
 * number in brackets, entity, remarks, date, an IBBI-hosted PDF) and 286 IBBI public announcements
 * (court "IBBI": announcement type, corporate debtor, applicant, insolvency professional, date and the
 * stated last date for claims).
 *
 * The four tiles answer the Law reference's questions in order, and the fourth is the clock. The only
 * clock any row states is an announcement's last date for claims; it is marked closed against
 * `ctx.today` and never extended, inferred or computed from the Code. An NCLT order holds no next date,
 * so its clock reads "Not on the row". The bench code inside a case number ("(MB)") is printed as
 * written, never decoded, and no CIN, bench, sector or NCLAT appeal is asserted.
 */
const NOT_ON_ROW = 'Not on the row';
const ON_ROW = 'On the row';
const DAY = 86400000;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const isIbbi = (row) => row?.court === 'IBBI';

/** The three announcement types IBBI writes, in short; any other type is shown as written. */
const PROCESS = {
  'public announcement of corporate insolvency resolution process': 'CIRP',
  'public announcement of voluntary liquidation process': 'Voluntary liquidation',
  'public announcement of liquidation process': 'Liquidation',
};
const processOf = (row) => {
  const held = clean(row.process_type || row.remarks || row.subject);
  return PROCESS[held.toLowerCase()] || held;
};

/** The case number as the subject writes it in its last brackets ("[C.P. (IB)/1231(MB)2025]"), or ''. */
export function caseNumberOf(subject) {
  const m = /\[([^\]]+)\]\s*$/.exec(clean(subject));
  return m ? m[1].trim() : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A YYYY-MM-DD calendar date as UTC midnight, or NaN; read strictly, never guessed. */
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).getUTCDate() === Number(m[3]) ? ms : NaN;
}

/** "08 Aug 2026" for a YYYY-MM-DD date the pack holds; '' for anything else. */
function dateLabel(s) {
  const ms = parseDay(s);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Whole days from `today` to `date` (both YYYY-MM-DD), or null when either is not such a date. */
function daysUntil(date, today) {
  const a = parseDay(date);
  const b = parseDay(today);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / DAY) : null;
}

function claimsTile(row, today) {
  const stated = dateLabel(row.last_submission_date);
  if (!stated) return { label: 'Claims due', value: NOT_ON_ROW, sub: 'no last date on the row', clock: true };
  const days = daysUntil(row.last_submission_date, today);
  if (days === null) return { label: 'Claims due', value: stated, sub: 'last date stated in the announcement', clock: true };
  if (days < 0) return { label: 'Claims due', value: 'Closed', sub: `${stated} · ${-days} ${days === -1 ? 'day' : 'days'} ago`, tone: 'red', clock: true };
  if (days === 0) return { label: 'Claims due', value: 'Closes today', sub: stated, tone: 'amber', clock: true };
  return { label: 'Claims due', value: `${days} ${days === 1 ? 'day' : 'days'} left`, sub: stated, tone: 'amber', clock: true };
}

/** "What a lawyer needs · what this row has": each field marked from the row itself. */
function needsBoard(needs) {
  const held = needs.filter((n) => n.value === ON_ROW).length;
  return {
    type: 'board',
    title: 'What a lawyer needs · what this row has',
    right: `${held} of ${needs.length} on the row`,
    rows: needs.map((n) => ({ ...n, tone: n.value === ON_ROW ? 'green' : n.value === NOT_ON_ROW ? 'red' : 'amber' })),
    caption: 'Marked from this row. A field not on the row may still be in the linked document; it has not been read here.',
  };
}
const need = (label, present, note) => ({ label, value: present ? ON_ROW : NOT_ON_ROW, ...(note ? { note } : {}) });

const companyKey = (s) => clean(s).toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function relatedLinks(row, rows) {
  const key = companyKey(row.entity);
  const ip = clean(row.insolvency_professional).toLowerCase();
  const others = rows.filter((r) => r && r !== row);
  const sameCompany = key ? others.filter((r) => companyKey(r.entity) === key) : [];
  const sameIp = ip ? others.filter((r) => isIbbi(r) && clean(r.insolvency_professional).toLowerCase() === ip && !sameCompany.includes(r)) : [];
  const describe = (r) => (isIbbi(r)
    ? `IBBI announcement · ${processOf(r)} · ${dateLabel(r.date) || 'undated'}`
    : `NCLT order · ${clean(r.remarks) || 'order'} · ${dateLabel(r.date) || 'undated'}`);
  return [
    ...sameCompany.slice(0, 3).map((r) => ({ title: clean(r.title), detail: `Same company · ${describe(r)}`, row: r })),
    ...sameIp.slice(0, 2).map((r) => ({ title: clean(r.title), detail: `Same insolvency professional · ${describe(r)}`, row: r })),
  ];
}

function health(rows) {
  if (!rows.length) return [];
  const notices = rows.filter(isIbbi);
  const withDate = notices.filter((r) => clean(r.last_submission_date)).length;
  return [
    ['Rows', String(rows.length)],
    ['IBBI notices', String(notices.length)],
    ['NCLT orders', String(rows.filter((r) => r?.court === 'NCLT').length)],
    ...(notices.length ? [['Claims date on row', `${Math.round((withDate / notices.length) * 100)}%`]] : []),
  ];
}

const isPdf = (url) => /\.pdf(?:$|[?#])/i.test(String(url || ''));
const NOTE = 'Names print exactly as the source prints them. Nothing here is a finding about solvency, conduct or outcome.';

function announcement(row, ctx) {
  const debtor = clean(row.entity || row.title);
  const applicant = clean(row.applicant);
  const ip = clean(row.insolvency_professional);
  const announced = dateLabel(row.date);
  const process = processOf(row);
  const clock = claimsTile(row, ctx.today);
  const claimsStated = dateLabel(row.last_submission_date);
  // null when there is no today to compare with: the step is then neither done nor current.
  const claimsDays = claimsStated ? daysUntil(row.last_submission_date, ctx.today) : null;
  const claimsStep = claimsDays === null ? {} : claimsDays >= 0 ? { now: true } : { done: true };
  const steps = [
    ...(announced ? [{ label: 'Public announcement', detail: announced, done: true }] : []),
    ...(claimsStated ? [{ label: 'Last date for claims', detail: claimsStated, ...claimsStep }] : []),
  ];
  return {
    title: debtor,
    meta: ['IBBI public announcement', announced ? `Announced ${announced}` : ''].filter(Boolean),
    badge: { text: 'Registry record', tone: 'green' },
    links: sourceLinks(row, 'Announcement (IBBI)'),
    glance: {
      tiles: [
        { label: 'Process', value: process || NOT_ON_ROW, sub: 'public announcement' },
        { label: 'Applicant', value: applicant || NOT_ON_ROW, sub: applicant && companyKey(applicant) === companyKey(debtor) ? 'same as the corporate debtor' : 'as named' },
        { label: 'Insolvency professional', value: ip || NOT_ON_ROW, sub: 'named in the announcement' },
        clock,
      ],
      visual: steps.length ? { type: 'timeline', title: 'Where this matter stands', right: process, steps, caption: 'Dates as the announcement states them. Later steps in the process are not on the row.' } : undefined,
      visual2: needsBoard([
        need('Corporate debtor', debtor),
        need('Process type', process),
        need('Insolvency professional', ip),
        need('Announcement date', announced),
        need('Claims deadline', claimsStated),
        { label: 'Announcement PDF', value: isPdf(row.source_url) ? ON_ROW : row.source_url ? 'Partial' : NOT_ON_ROW, ...(row.source_url && !isPdf(row.source_url) ? { note: 'linked document is not a PDF' } : {}) },
        need('CIN', false),
        need('NCLT bench', false),
      ]),
      callout: { tone: 'amber', text: 'The claims date is the last date the announcement states. Whether it was extended, and whether any claim was admitted, is not on the row.' },
    },
    about: {
      label: '02 · The pointers',
      rows: presentRows([
        ['Corporate debtor', debtor],
        ['Announcement', clean(row.process_type || row.subject)],
        ['Applicant', applicant],
        ['Insolvency professional', ip],
        ['Announced', announced],
        ['Last date for claims', claimsStated],
      ]),
      cards: [{ heading: 'What this record does not settle', body: 'Whether the company is insolvent, whether any claim will be admitted, and the order of priority in distribution. Those come from later filings, not from a public announcement.' }],
    },
    quick: [
      { label: 'Claim note', prompt: `Draft a claim note for a creditor of ${debtor} under this IBBI public announcement. Use only the attached record and the announcement it links, and flag anything they do not state.` },
      { label: 'Deadline sheet', prompt: `Draft a limitation and deadline sheet for the ${process || 'insolvency'} of ${debtor}, using only the dates the attached announcement states. Do not compute any date the announcement does not give.` },
      { label: 'Client status update', prompt: `Draft a short client status update on the ${process || 'insolvency'} of ${debtor}, from the attached IBBI announcement only.` },
    ],
    touches: {
      label: '03 · Entity & what it touches',
      links: relatedLinks(row, ctx.rows || []),
    },
    footer: {
      ask: 'Ask AI about this matter',
      // The pack holds no snapshot date; the announcement date is the record's own, shown above.
      provenance: { source: 'IBBI public announcements (stored copy)', flags: ['as-of not on record'] },
      health: health(ctx.rows || []),
      note: NOTE,
    },
  };
}

function order(row, ctx) {
  const debtor = clean(row.entity);
  const remarks = clean(row.remarks);
  const caseNo = (typeof row.case_number === 'string' ? clean(row.case_number) : '') || caseNumberOf(row.subject || row.title);
  const dated = dateLabel(row.date);
  return {
    title: clean(row.title),
    meta: ['NCLT order, as republished by IBBI', dated ? `Dated ${dated}` : ''].filter(Boolean),
    badge: { text: 'Registry record', tone: 'green' },
    links: sourceLinks(row, 'Order PDF (IBBI)'),
    glance: {
      tiles: [
        { label: 'Order', value: remarks || NOT_ON_ROW, sub: 'as recorded by IBBI' },
        { label: 'Forum', value: 'NCLT', sub: caseNo || 'case number not on the row' },
        { label: 'Corporate debtor', value: debtor || NOT_ON_ROW, sub: debtor ? 'as named' : '' },
        { label: 'Next date', value: NOT_ON_ROW, sub: 'the index entry carries no next date', clock: true },
      ],
      visual2: needsBoard([
        need('Case number', caseNo),
        need('Order type', remarks),
        need('Corporate debtor', debtor),
        need('Order date', dated),
        need('Order PDF', isPdf(row.source_url)),
        need('Bench', false, caseNo ? 'may appear inside the case number' : ''),
        need('CIN', false),
        need('NCLAT appeal', false),
      ]),
      callout: { tone: 'amber', text: 'These are NCLT orders as IBBI republishes them. NCLAT appeals are not in this register.' },
    },
    about: {
      label: '02 · The pointers',
      rows: presentRows([
        ['Case', caseNo],
        ['Corporate debtor', debtor],
        ['Order', remarks],
        ['Dated', dated],
      ]),
      cards: [{ heading: 'What this record does not settle', body: 'The order\'s terms, the bench and any appeal are in the order itself. This row is IBBI\'s index entry for it.' }],
    },
    quick: [
      { label: 'Order note', prompt: `Draft a short note on this NCLT order${debtor ? ` concerning ${debtor}` : ''}, using only the attached record and the order PDF it links. Flag anything they do not state.` },
      { label: 'Client status update', prompt: `Draft a short client status update on this NCLT order${debtor ? ` concerning ${debtor}` : ''}, from the attached record only.` },
    ],
    touches: {
      label: '03 · Entity & what it touches',
      links: relatedLinks(row, ctx.rows || []),
    },
    footer: {
      ask: 'Ask AI about this order',
      provenance: { source: 'NCLT orders as republished on ibbi.gov.in (stored copy)', flags: ['as-of not on record'] },
      health: health(ctx.rows || []),
      note: NOTE,
    },
  };
}

export default function lawInsolvency(row, ctx = {}) {
  return isIbbi(row) ? announcement(row, ctx) : order(row, ctx);
}
