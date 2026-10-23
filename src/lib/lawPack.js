import { withNcltListingCorrections } from './lawListingCorrections.js';

/**
 * Extracted judiciary tables. GDELT news searches and GitHub listings are not court orders.
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const SLICE = [
  [/^supreme court order/i, 'sc'],
  [/^order archive by topic/i, 'archive'],
  [/^nclt/i, 'nclt'],
  [/^wto dispute settlement$/i, 'wto'],
  [/supreme courts & precedent/i, 'scotus'],
];

export function lawSlice(feature) {
  const n = String(feature || '');
  const hit = SLICE.find(([re]) => re.test(n));
  return hit ? hit[1] : '';
}

export function isLawExtract(feature) {
  const s = lawSlice(feature);
  return s === 'sc' || s === 'archive' || s === 'nclt' || s === 'wto';
}

export function isUsScotusDesk(feature) {
  return lawSlice(feature) === 'scotus' && /united states/i.test(String(feature || ''));
}

export function lawNote(slice) {
  if (slice === 'sc') {
    return 'Extracted Supreme Court order table (case title, diary, date, PDF). Not a news search.';
  }
  if (slice === 'archive') {
    return 'Same extracted order table, grouped by subject. Topic is a classifier, not a recommendation.';
  }
  if (slice === 'nclt') {
    return 'Extracted NCLT orders plus IBBI public announcements. NCLAT bodies are not in this pack.';
  }
  if (slice === 'wto') {
    return 'The WTO dispute settlement register (DS1 onward), as the WTO publishes it: parties, stage and dates. Collected from wto.org; the official case page is the authority.';
  }
  return 'Extracted judiciary pack.';
}

export function scOrderRows(raw) {
  return (raw || [])
    .map((r) => {
      const title = String(r.case_title || r.title || '').trim();
      if (!title) return null;
      const pdf = r.pdf_url || r.source_url || '';
      const sciPdf = /sci\.gov\.in/i.test(String(pdf));
      return {
        case_title: title,
        title,
        diary_no: r.diary_no || r.diary || '',
        date: r.order_date || r.date || '',
        order_date: r.order_date || r.date || '',
        topic: r.topic || 'Other / Unclassified',
        court: r.court || 'Supreme Court',
        // F128: the table's snapshot time, so the record panel's "as of" is not the order date.
        as_of: r.as_of || '',
        source_url: pdf,
        pdf_url: pdf,
        pdf_note: sciPdf
          ? 'SCI view-pdf links often need a live court session and may fail (403 / blank) offline — a dead PDF is a source limit, not a missing order.'
          : '',
      };
    })
    .filter(Boolean);
}

export function archiveOrderRows(raw) {
  return scOrderRows(raw).sort((a, b) => {
    const t = String(a.topic).localeCompare(String(b.topic));
    if (t) return t;
    return String(b.date).localeCompare(String(a.date));
  });
}

function ncltOne(r) {
  const title = String(r.subject || r.title || r.entity || '').trim();
  if (!title) return null;
  return {
    title,
    subject: r.subject || title,
    entity: r.entity || '',
    date: r.date || '',
    remarks: r.remarks || '',
    court: 'NCLT',
    source_url: r.source_url || '',
  };
}

function ibbiOne(r) {
  const title = String(r.corporate_debtor || r.title || '').trim();
  if (!title) return null;
  return {
    title,
    subject: r.type || 'IBBI announcement',
    entity: r.corporate_debtor || title,
    date: r.date || '',
    remarks: r.type || '',
    applicant: r.applicant || '',
    insolvency_professional: r.insolvency_professional || '',
    // F128: the announcement's stated last date for claims, kept as written for the record panel.
    process_type: r.type || '',
    last_submission_date: r.last_submission_date || '',
    court: 'IBBI',
    source_url: r.source_url || '',
  };
}

export function insolvencyRows(nclt, ibbi) {
  const a = (nclt || []).map(ncltOne).filter(Boolean);
  const b = (ibbi || []).map(ibbiOne).filter(Boolean);
  return [...a, ...b].sort((x, y) => String(y.date).localeCompare(String(x.date)));
}

/**
 * The WTO register (F129) for the desk table: newest dispute first, with the parties also as one line
 * each for the table. The register's own fields are kept as collected.
 */
export function wtoRows(raw) {
  return (raw || [])
    .filter((r) => r && r.ds_number)
    .map((r) => ({
      ...r,
      complainant: (r.complainants || []).join('; '),
      date: r.consultations_requested || '',
    }))
    .sort((a, b) => b.ds - a.ds);
}

export function lawRows(slice, packs) {
  if (slice === 'sc') return scOrderRows(packs?.sc);
  if (slice === 'archive') return archiveOrderRows(packs?.sc);
  if (slice === 'nclt') return withNcltListingCorrections(insolvencyRows(packs?.nclt, packs?.ibbi));
  if (slice === 'wto') return wtoRows(packs?.wto);
  return [];
}

export function mapCourtListener(json) {
  const results = Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [];
  return results
    .map((r) => {
      const path = r.absolute_url || r.absoluteUrl || '';
      const href = /^https?:/i.test(path) ? path : path ? `https://www.courtlistener.com${path}` : r.download_url || '';
      const cites = r.citation || r.cite || r.neutralCite || '';
      return {
        title: r.caseName || r.case_name || r.caseNameFull || r.caption || '',
        caseName: r.caseName || r.case_name || '',
        date: r.dateFiled || r.date_filed || '',
        court: r.court || 'SCOTUS',
        cite: Array.isArray(cites) ? cites.filter(Boolean).join('; ') : String(cites || ''),
        status: r.status || r.precedential_status || r.precedentialStatus || '',
        docket: r.docketNumber || r.docket_number || '',
        source_url: href,
      };
    })
    .filter((r) => r.title);
}

export function isGithubListing(rows, url) {
  if (!/api\.github\.com\/repos\/.+\/contents/i.test(String(url || ''))) return false;
  const n = (rows || []).slice(0, 8);
  if (!n.length) return false;
  return n.every((r) => r && (r.sha || r.git_url) && (r.type === 'file' || r.type === 'dir' || r.name));
}

export { norm };
