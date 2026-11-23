/** Display helpers for casing and copy cleanup (feedback: less AI-looking UI). */

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'vs', 'via']);

const ACRONYMS = new Map([
  ['msp', 'MSP'],
  ['pib', 'PIB'],
  ['ncr', 'NCR'],
  ['rbi', 'RBI'],
  ['sebi', 'SEBI'],
  ['gst', 'GST'],
  ['niti', 'NITI'],
  ['pact', 'PACT'],
  ['ddu-gky', 'DDU-GKY'],
  ['ddugky', 'DDU-GKY'],
  ['e-fast', 'e-FAST'],
  ['ai', 'AI'],
  ['uk', 'UK'],
  ['us', 'US'],
  ['eu', 'EU'],
  ['un', 'UN'],
  ['ias', 'IAS'],
  ['ips', 'IPS'],
  ['fy', 'FY'],
  ['ceo', 'CEO'],
  ['cm', 'CM'],
  ['mp', 'MP'],
  ['mla', 'MLA'],
  ['sc', 'SC'],
  ['hc', 'HC'],
]);

/** Sentence case for headlines / decisions. Uniform casing; keeps short acronyms. */
export function toSentenceCase(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  let out = s.toLowerCase().replace(/^\s*[a-z]/, (c) => c.toUpperCase());
  out = out.replace(/\b[a-z](?:\.[a-z])+\b/gi, (m) => m.toUpperCase());
  out = out.replace(/\b[\w'-]+\b/g, (word) => ACRONYMS.get(word.toLowerCase()) || word);
  return out;
}

export function toTitleCase(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/\b[\w'’.-]+\b/g, (word, i) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
      if (i > 0 && SMALL.has(lower)) return lower;
      if (/^[a-z](?:\.[a-z])+$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

/** Replace em/en dashes with plain hyphens or commas for UI copy. */
export function softenDashes(value) {
  return String(value || '')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, '-')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function looksHindi(value) {
  const s = String(value || '');
  if (!s) return false;
  // Fresh regex each call — a shared /g pattern keeps lastIndex and under-counts.
  const hits = (s.match(/[\u0900-\u097F]/g) || []).length;
  return hits >= 4 || hits / Math.max(1, s.length) > 0.2;
}

/** Drop Hindi-primary rows. When strict and none remain English, return []. */
export function preferEnglishRows(
  rows,
  { titleKeys = ['title', 'headline', 'subject', 'decision', 'name', 'topic'], strict = false } = {},
) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const english = rows.filter((r) => {
    if (r?.status === 'source_status') return true;
    const blob = titleKeys.map((k) => r?.[k]).filter(Boolean).join(' ');
    return !looksHindi(blob);
  });
  const realEn = english.filter((r) => r?.status !== 'source_status');
  if (strict) return english;
  if (!realEn.length) return rows;
  if (realEn.length >= Math.min(1, rows.filter((r) => r?.status !== 'source_status').length * 0.15)) {
    return english;
  }
  return rows;
}

/** Cabinet desk: normalize topic/title and keep English-only rows. */
export function shapeCabinetEnglishRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  return rows
    .map((r) => {
      if (r?.status === 'source_status') return r;
      const rawTopic = String(r.topic || r.title || r.headline || '').trim();
      const topic = toTitleCase(rawTopic);
      return {
        ...r,
        topic,
        title: topic,
        // The issuing body as the source names it (F125): title-casing turned "(CCEA)" into "(Ccea)".
        ministry: String(r.ministry || '').trim() || toTitleCase(r.source || r.department || 'Press Information Bureau'),
      };
    })
    .filter((r) => r?.status === 'source_status' || !looksHindi(`${r.topic || ''} ${r.title || ''}`));
}
