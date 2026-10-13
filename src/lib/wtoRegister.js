/**
 * The WTO dispute settlement register (F129; docs/specs/2026-10-13-wto-register.md), read from the
 * data files the WTO's own case pages load (`dispute_case_arrays_e.js`, `dispute_arrays_e.js`).
 * The files are parsed as text, field by field; their JavaScript is never executed. Every value is
 * the WTO's own; a field the WTO leaves empty stays empty and an unknown member code is kept as
 * written.
 */

/** Member codes as the WTO writes them → names. Mostly ISO 3166 alpha-3; the WTO's own codes follow the table. */
const MEMBERS = {
  AFG: 'Afghanistan', ARE: 'United Arab Emirates', ARG: 'Argentina', ARM: 'Armenia', ATG: 'Antigua and Barbuda',
  AUS: 'Australia', BEL: 'Belgium', BEN: 'Benin', BGD: 'Bangladesh', BGR: 'Bulgaria', BHR: 'Bahrain', BLZ: 'Belize',
  BOL: 'Bolivia', BRA: 'Brazil', BRB: 'Barbados', BWA: 'Botswana', CAN: 'Canada', CHE: 'Switzerland', CHL: 'Chile',
  CHN: 'China', CIV: "Cote d'Ivoire", CMR: 'Cameroon', COL: 'Colombia', CRI: 'Costa Rica', CUB: 'Cuba', CZE: 'Czechia',
  DEU: 'Germany', DMA: 'Dominica', DNK: 'Denmark', DOM: 'Dominican Republic', ECU: 'Ecuador', EGY: 'Egypt',
  ESP: 'Spain', EST: 'Estonia', FJI: 'Fiji', FRA: 'France', GBR: 'United Kingdom', GHA: 'Ghana', GRC: 'Greece',
  GRD: 'Grenada', GTM: 'Guatemala', GUY: 'Guyana', HND: 'Honduras', HRV: 'Croatia', HUN: 'Hungary',
  IDN: 'Indonesia', IND: 'India', IRL: 'Ireland', ISL: 'Iceland', ISR: 'Israel', ITA: 'Italy', JAM: 'Jamaica',
  JPN: 'Japan', KAZ: 'Kazakhstan', KEN: 'Kenya', KGZ: 'Kyrgyzstan', KNA: 'Saint Kitts and Nevis', KOR: 'South Korea',
  KWT: 'Kuwait', LCA: 'Saint Lucia', LKA: 'Sri Lanka', LTU: 'Lithuania', LVA: 'Latvia', MAR: 'Morocco',
  MDA: 'Moldova', MDG: 'Madagascar', MEX: 'Mexico', MUS: 'Mauritius', MWI: 'Malawi', MYS: 'Malaysia',
  NAM: 'Namibia', NGA: 'Nigeria', NIC: 'Nicaragua', NLD: 'Netherlands', NOR: 'Norway', NZL: 'New Zealand',
  OMN: 'Oman', PAK: 'Pakistan', PAN: 'Panama', PER: 'Peru', PHL: 'Philippines', POL: 'Poland', PRT: 'Portugal',
  PRY: 'Paraguay', QAT: 'Qatar', RUS: 'Russia', SAU: 'Saudi Arabia', SEN: 'Senegal', SGP: 'Singapore',
  SLV: 'El Salvador', SUR: 'Suriname', SVK: 'Slovakia', SWE: 'Sweden', SWZ: 'Eswatini', TCD: 'Chad', THA: 'Thailand',
  TJK: 'Tajikistan', TTO: 'Trinidad and Tobago', TUN: 'Tunisia', TZA: 'Tanzania', UKR: 'Ukraine', URY: 'Uruguay',
  USA: 'United States', VCT: 'Saint Vincent and the Grenadines', VEN: 'Venezuela', VNM: 'Vietnam', YEM: 'Yemen',
  ZAF: 'South Africa', ZMB: 'Zambia', ZWE: 'Zimbabwe',
  // The WTO's own codes.
  CHT: 'Chinese Taipei', HKG: 'Hong Kong, China', ROM: 'Romania',
};

/**
 * A complainant's or respondent's name on the dispute's start date. EEC and TUR follow the WTO's own
 * rule for parties (showComplainant/showRespondent in dispute_code.js); without a date they stay as
 * written.
 */
export function memberName(code, startDate = '') {
  const c = String(code || '').trim();
  if ((c === 'EEC' || c === 'TUR') && !startDate) return c;
  if (c === 'EEC') return startDate >= '2009-12-01' ? 'European Union' : 'European Communities';
  if (c === 'TUR') return startDate >= '2022-06-01' ? 'Türkiye' : 'Turkey';
  return Object.hasOwn(MEMBERS, c) ? MEMBERS[c] : c;
}

const ENTITIES = {
  nbsp: ' ', mdash: '—', ndash: '–', amp: '&', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  uuml: 'ü', ouml: 'ö', auml: 'ä', eacute: 'é', egrave: 'è', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú',
  ntilde: 'ñ', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô', acirc: 'â', agrave: 'à', euml: 'ë', iuml: 'ï',
};

/** WTO text as plain text: HTML entities decoded once, tags removed, whitespace collapsed. */
export function wtoText(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    // Only a real, printable code point is decoded; anything else is left exactly as written.
    .replace(/&#(\d+);/g, (m, n) => {
      const cp = Number(n);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    })
    .replace(/&([a-z]+);/gi, (m, name) => (Object.hasOwn(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : m))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1995/01/10" or "1995_03_29" → "1995-01-10"; '' for anything else. */
const isoDate = (s) => {
  const m = /^(\d{4})[/_-](\d{2})[/_-](\d{2})$/.exec(String(s || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/** The string fields of one object literal: `name: "value"` pairs, escaped quotes allowed. */
function fieldsOf(body) {
  const out = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) out[m[1]] = m[2].replace(/\\(.)/g, '$1');
  return out;
}

/** Status code → name. Active entries win; a code kept only in a commented-out line still names its status. */
export function parseStatuses(arraysText) {
  const active = new Map();
  const commented = new Map();
  for (const m of String(arraysText || '').matchAll(/status_code\s*:\s*"(ST\d+)"\s*,\s*status_name\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const lineStart = arraysText.lastIndexOf('\n', m.index) + 1;
    const isComment = /^\s*\/\//.test(arraysText.slice(lineStart, m.index));
    (isComment ? commented : active).set(m[1], wtoText(m[2]));
  }
  return new Map([...commented, ...active]);
}

/** Agreement id ("A9") → short name ("GATT 1994"), from the agreement table. */
export function parseAgreements(arraysText) {
  const out = new Map();
  for (const m of String(arraysText || '').matchAll(/agreement_id\s*:\s*"(A\d+)"\s*,\s*agreement_name\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*agreement_short_name\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.set(m[1], wtoText(m[3]) || wtoText(m[2]));
  }
  return out;
}

/** A WTO exception list (`eec_exceptions = ["DS2", ...]`) as a set of DS numbers. */
function exceptionsOf(arraysText, name) {
  const m = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(String(arraysText || ''));
  return new Set(m ? [...m[1].matchAll(/"(DS\d+)"/g)].map((x) => x[1]) : []);
}

const caseUrl = (n) => `https://www.wto.org/english/tratop_e/dispu_e/cases_e/ds${n}_e.htm`;
const clean = (s) => String(s ?? '').trim();
const split = (s) => String(s || '').split('#').map((x) => x.trim()).filter(Boolean);

/**
 * The register rows: one per dispute, in DS order. `asOf` is the collection time (ISO). Nothing is
 * inferred: a blank stays blank, an unknown status code reads "Not stated", an unknown member code
 * stays as written.
 */
export function parseWtoRegister(caseText, arraysText, { asOf = '' } = {}) {
  const statuses = parseStatuses(arraysText);
  const agreements = parseAgreements(arraysText);
  const eecOld = exceptionsOf(arraysText, 'eec_exceptions');
  const turOld = exceptionsOf(arraysText, 'tur_exceptions');
  /** A third party's name, by the WTO's exception lists (showThirdParty in dispute_code.js), not by date. */
  const thirdPartyName = (c, ds) => (c === 'EEC' ? (eecOld.has(ds) ? 'European Communities' : 'European Union')
    : c === 'TUR' ? (turOld.has(ds) ? 'Turkey' : 'Türkiye') : memberName(c));
  const rows = [];
  // A record ends at a "};" that starts a line, as the WTO's file writes it, never at one inside a value.
  for (const m of String(caseText || '').matchAll(/ds_array\[(\d+)\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const n = Number(m[1]);
    const f = fieldsOf(m[2]);
    const start = isoDate(f.start_date);
    // Several current stages are separated by "|"; each is "code#date", with any added text after a third "#".
    const stages = String(f.status || '').split('|').map((part) => part.split('#')).filter(([code]) => clean(code)).map(([code, when, extra]) => ({
      status: (statuses.get(code.trim()) || 'Not stated') + wtoText(extra || ''),
      status_date: isoDate(when),
    }));
    const members = (codes) => split(codes).map((c) => memberName(c, start));
    const code = wtoText(f.code) || `DS${n}`;
    const respondents = members(f.destination);
    rows.push({
      ds_number: code,
      ds: n,
      title: wtoText(f.title),
      short_title: wtoText(f.short_title),
      complainants: members(f.origin),
      respondents,
      respondent: respondents.join('; '),
      third_parties: split(f.third_party).map((c) => thirdPartyName(c, code)),
      consultations_requested: start,
      stages,
      status: stages[0]?.status || '',
      status_date: stages[0]?.status_date || '',
      reports_adopted: /^true$/i.test(String(f.reports_adopted || '').trim()),
      agreements: [...new Set(split(f.agreement).map((a) => agreements.get(a.split('_')[0])).filter(Boolean))],
      last_updated: isoDate(f.update_date),
      source_url: caseUrl(n),
      source: 'World Trade Organization',
      as_of: asOf,
    });
  }
  return rows.sort((a, b) => a.ds - b.ds);
}
