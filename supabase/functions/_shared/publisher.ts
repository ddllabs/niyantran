// Who published a cited document (spec 2026-11-12-citation-attribution.md, D1).
//
// Pure and total. v1 covered the national Regulatory feature; F374 adds the five National desks of the search-only
// route (Budget, Cabinet, Transfers, Industry, MP Profiles), each named from its document's hosts. The name returned is
// always one of the constants from the tables below: for Regulatory, chosen from the document's stored regulator code
// and from the hosts it names; for the five desks, from the hosts alone. No value from a pack or a document is ever
// printed as the name. Every input is untrusted. A host that is malformed or outside the desk's domains is not a
// candidate and does not block (an archived copy of a document is a legitimate file_url); an unknown regulator code,
// or two different publishers among the candidates, gives no name.

/** The longest publisher a citation or a passage header may carry. */
export const PUBLISHER_MAX_CHARS = 80;

const TIER_NATIONAL = 'national';

/** Lower-case, runs of non-letters and non-digits as one space, trimmed (the rule at chunkHeader.ts:112). */
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Both spellings of the feature (spaces in the stored value, slashes in the catalogue) fold to this. */
const REGULATORY_FOLDED = 'regulatory body watch rbi sebi trai cci';

const REGULATORS: Readonly<Record<string, { name: string; domain: string }>> = Object.freeze({
  RBI: { name: 'Reserve Bank of India', domain: 'rbi.org.in' },
  SEBI: { name: 'Securities and Exchange Board of India', domain: 'sebi.gov.in' },
  TRAI: { name: 'Telecom Regulatory Authority of India', domain: 'trai.gov.in' },
  CCI: { name: 'Competition Commission of India', domain: 'cci.gov.in' },
});
const CODES = Object.keys(REGULATORS);

/**
 * The National desks named by host alone (F374). The key is the desk's feature folded as `fold` folds it, so the packs'
 * spellings (a hyphen or a dash in Transfers, commas in MP Profiles) are one desk. A document is named only when every
 * host it carries that falls under one of the desk's domains falls under the same one; a host outside the desk's
 * domains is not a candidate and does not block (an archived copy), but a document with no host of its own gets no name.
 */
const HOST_DESKS: Readonly<Record<string, ReadonlyArray<{ name: string; domain: string }>>> = Object.freeze({
  'budget utilisation schemes': [{ name: 'Ministry of Finance, Government of India', domain: 'indiabudget.gov.in' }],
  'cabinet decisions': [{ name: 'Press Information Bureau, Government of India', domain: 'pib.gov.in' }],
  'bureaucratic transfers agmut cadre': [{ name: 'Ministry of Home Affairs, Government of India', domain: 'mha.gov.in' }],
  'mp profiles performance mplad attendance debates': [{ name: 'Parliament of India', domain: 'sansad.in' }],
  'industry updates ministry data': [
    { name: 'Department for Promotion of Industry and Internal Trade', domain: 'dpiit.gov.in' },
    { name: 'Office of the Economic Adviser, DPIIT', domain: 'eaindustry.nic.in' },
    { name: 'Ministry of Statistics and Programme Implementation', domain: 'mospi.gov.in' },
  ],
});

const NAMES: ReadonlySet<string> = new Set([
  ...CODES.map((code) => REGULATORS[code].name),
  ...Object.values(HOST_DESKS).flatMap((rows) => rows.map((r) => r.name)),
]);

export function isRegulatoryFeature(tier: unknown, feature: unknown): boolean {
  try {
    return tier === TIER_NATIONAL && typeof feature === 'string' && fold(feature) === REGULATORY_FOLDED;
  } catch {
    return false;
  }
}

/** The folded name of a National desk named by host, or null (national tier only). */
function hostDesk(tier: unknown, feature: unknown): ReadonlyArray<{ name: string; domain: string }> | null {
  try {
    if (tier !== TIER_NATIONAL || typeof feature !== 'string') return null;
    const folded = fold(feature);
    return Object.hasOwn(HOST_DESKS, folded) ? HOST_DESKS[folded] : null;
  } catch {
    return null;
  }
}

/**
 * True only when `name` is a table name that this desk can have: one of the four regulators for Regulatory, one of the
 * desk's own names for a host-named desk. Callers that keep a publisher off a stored or retrieved chunk should ask this,
 * not `isPublisherName` with `isRegulatoryFeature`: the table now holds names of other desks (a Regulatory chunk
 * carrying "Parliament of India" is not valid).
 */
export function isPublisherFor(tier: unknown, feature: unknown, name: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (isRegulatoryFeature(tier, feature)) return CODES.some((code) => REGULATORS[code].name === name);
  const desk = hostDesk(tier, feature);
  return desk !== null && desk.some((r) => r.name === name);
}

/** True only for one of the table's names, exactly. */
export function isPublisherName(value: unknown): boolean {
  return typeof value === 'string' && NAMES.has(value);
}

const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * A bare host: ASCII labels of 1-63 characters, no empty label, at most 253 characters, one trailing dot allowed.
 * Returned lower-cased, or null when it is not one. Validation runs before lower-casing so that characters which fold
 * to ASCII (the Kelvin sign) do not pass.
 */
function bareHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value.endsWith('.') ? value.slice(0, -1) : value;
  if (!host || host.length > 253) return null;
  for (const label of host.split('.')) if (label.length > 63 || !LABEL.test(label)) return null;
  return host.toLowerCase();
}

/** The host of an http(s) URL with no credentials, or null. A port is ignored. */
function urlHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return bareHost(parsed.hostname);
}

function codeOfHost(host: string | null): string | null {
  if (!host) return null;
  for (const code of CODES) {
    const domain = REGULATORS[code].domain;
    if (host === domain || host.endsWith(`.${domain}`)) return code;
  }
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The publisher of a document: one of the names in the tables, or '' when the document is not Regulatory or one of the
 * five host-named desks, has no candidate, names a regulator outside the table, or the candidates disagree. Never throws.
 */
export function documentPublisher(tier: unknown, feature: unknown, metadata: unknown, fileUrl: unknown): string {
  try {
    const desk = hostDesk(tier, feature);
    if (desk !== null) {
      const meta = isObject(metadata) ? metadata : {};
      const citation = isObject(meta.citation) ? meta.citation : {};
      const names = new Set<string>();
      for (const host of [bareHost(meta.source_host), bareHost(citation.source_host), urlHost(fileUrl)]) {
        if (!host) continue;
        const row = desk.find((r) => host === r.domain || host.endsWith(`.${r.domain}`));
        if (row) names.add(row.name);
      }
      return names.size === 1 ? [...names][0] : '';
    }
    if (!isRegulatoryFeature(tier, feature)) return '';
    const meta = isObject(metadata) ? metadata : {};
    const citation = isObject(meta.citation) ? meta.citation : {};
    const codes = new Set<string>();
    const regulator = citation.regulator;
    // Present but not a string (an array, a number, an object, a boolean) names a publisher we cannot name: it blocks.
    if (regulator !== undefined && regulator !== null && typeof regulator !== 'string') return '';
    if (typeof regulator === 'string' && regulator.trim()) {
      const code = regulator.trim();
      // ASCII letters only: U+0131 and U+017F would otherwise upper-case to I and S.
      if (!/^[A-Za-z]+$/.test(code) || !Object.hasOwn(REGULATORS, code.toUpperCase())) return '';
      codes.add(code.toUpperCase());
    }
    for (const host of [bareHost(meta.source_host), bareHost(citation.source_host), urlHost(fileUrl)]) {
      const code = codeOfHost(host);
      if (code) codes.add(code);
    }
    if (codes.size !== 1) return '';
    return REGULATORS[[...codes][0]].name;
  } catch {
    return '';
  }
}
