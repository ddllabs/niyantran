// The generic search-only screen (F307; docs/specs/2026-11-12-regulatory-screen.md): one screen for a desk whose
// documents are stored, chunked and found by search with no listing link. The desk's specifics (spellings, hosts,
// limits, the suggested-key prefix, the completeness rules) are in a configuration file, `regulatory.json` for
// Regulatory, validated here before anything is built. Six checks are Bills' own (`bills.ts`), two take a parameter,
// the rest are new. One of them asks the live citation path's own resolver who published the document (no publisher,
// no load).
//
// Pack records are third-party data. Every field read here is checked for its type and shape first (through `get`,
// which reads own properties only), a malformed record is held with a code and never thrown on, and a finding holds
// field names, codes and counts, never a value from the record. A review is written only from checks that ran and
// passed: the density-only completeness basis is earned by checks 5 to 8 having passed on that very record, and a
// record whose basis was not recorded is not projected, so it is not screened.
import type { Check, Finding, Report, ReviewCheck, Screen, ScreenContext } from '../screen_types.ts';
import { type Rec, strip } from '../prepare.ts';
import { billUrlSegmentsOk } from '../../../supabase/functions/_shared/suppliedText.ts';
import { documentPublisher } from '../../../supabase/functions/_shared/publisher.ts';
import {
  collisionCheck,
  duplicateText,
  duplicateTextLive,
  fileUrlCollision,
  makeLength,
  makeLicenceAdmitted,
  servableCheck,
  textBinds,
} from './bills.ts';

/** What the configuration file holds. Every field is required; an unknown field is refused. */
export interface SearchOnlyConfig {
  collection: string;
  mapping_version: string;
  desk_tier: string;
  /** The spelling documents and chunks use (the live reads and the pack's desk_feature). */
  desk_feature: string;
  /** The spelling the listing and the pack's desk_rows_feature use; links are read under it, never written. */
  desk_rows_feature: string;
  doc_type: string;
  suggested_key_prefix: string;
  citation_required: string[];
  extraction_allowed: string[];
  source_hosts: string[];
  url_hosts: string[];
  /** Matches the file_url of a record whose official file can be page-checked; compiled case-insensitive. */
  pdf_url_rule: string;
  min_chars: number;
  max_chars: number;
  replacement_fields: string[];
  replacement_flags: string[];
  allow_density_only: boolean;
}

const SCHEMA_PREFIX = 'nter.citation_pack/1.';
const HEX40 = /^[0-9a-f]{40}$/;
const MAX_FIELD = 4_000;
const MAX_TITLE = 300;
/** SUPPLIED_TEXT.maxChars: the adapter takes no longer text. */
const ADAPTER_MAX_CHARS = 600_000;
const MAX_FILE_URL_BYTES = 2_000;
const MAX_SUGGESTED_KEY_BYTES = 500;
const utf8 = new TextEncoder();
/** The fields prepareSuppliedText copies as strings, each non-empty and at most 4,000 characters when not null. */
const COPIED = [
  'doc_type',
  'pack',
  'schema',
  'as_of',
  'source_host',
  'text_engine',
  'ocr_lang',
  'file_name',
  'file_url',
  'file_url_alt',
  'source_path',
  'source_archive_url',
  'language',
  'extraction',
  'licence',
  'licence_class',
  'attribution',
  'citation_text',
] as const;
/** Copied fields that prepareSuppliedText also parses as URLs (http or https, no credentials). */
const URL_FIELDS = ['file_url_alt', 'source_archive_url'] as const;
/** The completeness checks a density-only basis rests on (spec rows 5 to 8). */
const BASIS_CHECKS = ['text_binds', 'length', 'density', 'extraction'] as const;

export const BASIS_PAGE_CHECK = 'page_check';
export const BASIS_DENSITY_ONLY = 'density_only';
type Basis = typeof BASIS_PAGE_CHECK | typeof BASIS_DENSITY_ONLY;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
/** A record's own property, or undefined: nothing is read through the prototype. */
const get = (r: Rec, k: string): unknown => Object.hasOwn(r, k) ? r[k] : undefined;
/** A non-blank string, within `max` UTF-16 units, without NUL (the rule of suppliedText's `string`). */
const text = (v: unknown, max = MAX_FIELD): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max && !v.includes('\0');
/** Every string in a value (and every key) is well-formed UTF-16; the database refuses a lone surrogate. Bounded walk. */
function wellFormedDeep(v: unknown, budget = { nodes: 10_000 }, depth = 0): boolean {
  if (typeof v === 'string') return v.isWellFormed();
  if (!v || typeof v !== 'object') return true;
  if (depth > 8 || --budget.nodes < 0) return false;
  for (const x of Array.isArray(v) ? v : Object.entries(v).flat()) {
    if (!wellFormedDeep(x, budget, depth + 1)) return false;
  }
  return true;
}
const keyOf = (r: Rec): string | null => typeof r.source_key === 'string' && r.source_key !== '' ? r.source_key : null;
const hexKey = (r: Rec): boolean => typeof r.source_key === 'string' && HEX40.test(r.source_key);

// ---- the configuration ----

const CONFIG_FIELDS = [
  'collection',
  'mapping_version',
  'desk_tier',
  'desk_feature',
  'desk_rows_feature',
  'doc_type',
  'suggested_key_prefix',
  'citation_required',
  'extraction_allowed',
  'source_hosts',
  'url_hosts',
  'pdf_url_rule',
  'min_chars',
  'max_chars',
  'replacement_fields',
  'replacement_flags',
  'allow_density_only',
] as const;

/** Validates the configuration strictly: every field present with the right type, nothing else. */
export function parseSearchOnlyConfig(value: unknown): SearchOnlyConfig {
  const fail = (field: string, why: string): never => {
    throw new Error(`search-only configuration: ${field} ${why}`);
  };
  if (!isRec(value)) return fail('the configuration', 'must be an object');
  for (const k of Object.keys(value)) {
    if (!(CONFIG_FIELDS as readonly string[]).includes(k)) fail(k, 'is not a known field');
  }
  const word = (k: string): string => {
    const v = get(value, k);
    return text(v, 1_000) ? v : fail(k, 'must be a non-empty string of at most 1,000 characters');
  };
  const words = (k: string, allowEmpty = false): string[] => {
    const v = get(value, k);
    if (!Array.isArray(v) || (!allowEmpty && v.length === 0) || !v.every((x) => text(x, 1_000))) {
      return fail(
        k,
        allowEmpty ? 'must be a list of non-empty strings' : 'must be a non-empty list of non-empty strings',
      );
    }
    return v as string[];
  };
  const flag = (k: string): boolean => {
    const v = get(value, k);
    return typeof v === 'boolean' ? v : fail(k, 'must be true or false');
  };
  const count = (k: string): number => {
    const v = get(value, k);
    return Number.isSafeInteger(v) && (v as number) >= 1 ? v as number : fail(k, 'must be a positive integer');
  };
  const cfg: SearchOnlyConfig = {
    collection: word('collection'),
    mapping_version: word('mapping_version'),
    desk_tier: word('desk_tier'),
    desk_feature: word('desk_feature'),
    desk_rows_feature: word('desk_rows_feature'),
    doc_type: word('doc_type'),
    suggested_key_prefix: word('suggested_key_prefix'),
    citation_required: words('citation_required'),
    extraction_allowed: words('extraction_allowed'),
    source_hosts: words('source_hosts'),
    url_hosts: words('url_hosts'),
    pdf_url_rule: word('pdf_url_rule'),
    min_chars: count('min_chars'),
    max_chars: count('max_chars'),
    replacement_fields: words('replacement_fields', true),
    replacement_flags: words('replacement_flags', true),
    allow_density_only: flag('allow_density_only'),
  };
  for (const h of cfg.url_hosts) {
    if (!/^[a-z0-9.-]+$/.test(h)) fail('url_hosts', 'must hold plain lower-case host names');
  }
  if (cfg.max_chars <= cfg.min_chars) fail('max_chars', 'must be larger than min_chars');
  if (cfg.max_chars > ADAPTER_MAX_CHARS) {
    fail('max_chars', `must be at most ${ADAPTER_MAX_CHARS} (the adapter's limit)`);
  }
  if (!cfg.pdf_url_rule.startsWith('^https://') || !cfg.pdf_url_rule.endsWith('$')) {
    fail('pdf_url_rule', 'must be anchored at both ends: start with ^https:// and end with $');
  }
  // The rule's host (the plain host name right after ^https://, dots escaped) must be one of the official hosts.
  const ruleHost = /^\^https:\/\/((?:[a-z0-9-]+\\\.)*[a-z0-9-]+)\//.exec(cfg.pdf_url_rule)?.[1]?.replaceAll('\\.', '.');
  if (ruleHost === undefined || !cfg.url_hosts.includes(ruleHost)) {
    fail('pdf_url_rule', 'must name one host, written plainly, and it must be one of url_hosts');
  }
  try {
    new RegExp(cfg.pdf_url_rule, 'i');
  } catch {
    fail('pdf_url_rule', 'is not a regular expression');
  }
  return cfg;
}

/** The PDF URL rule of a configuration, compiled case-insensitive: for the page check and for this screen alike. */
export function pdfUrlRule(config: unknown): RegExp {
  return new RegExp(parseSearchOnlyConfig(config).pdf_url_rule, 'i');
}

// ---- helpers for checks ----

type Verdict = [reason: string, detail?: string];

function finding(check: string, covers: ReviewCheck[], reason: string, detail?: string): Finding {
  return detail === undefined ? { check, covers, reason } : { check, covers, reason, detail };
}

/** A per-record check from a function that lists what is wrong. The function is only given objects. */
function oneCheck(
  name: string,
  covers: ReviewCheck[],
  judge: (r: Rec, ctx: ScreenContext) => Verdict[] | Promise<Verdict[]>,
): Check {
  return {
    name,
    covers,
    async one(record, ctx) {
      const found = await judge(isRec(record) ? record : {}, ctx);
      return found.map(([reason, detail]) => finding(name, covers, reason, detail));
    },
  };
}

/** A key sent to the live reader: the reader refuses NUL and very long keys for the whole call, so a record's own bad
 * key is left out of the question (the record is held by the check that finds the key bad). */
const askable = (v: unknown): v is string =>
  typeof v === 'string' && v !== '' && v.length <= MAX_FIELD && !v.includes('\0');

/** The same whole-set check over the records whose source_key is 40 hex only: the others are held by record_shape, and
 * a finding for the rest would quote their key. */
function onHexKeys(check: Check): Check {
  return { ...check, all: (records, ctx) => check.all!(records.filter(hexKey), ctx) };
}

/** Records the check judged and found nothing on, by object: a name or a key could be shared by a record and its patch. */
type Passed = WeakMap<object, Set<string>>;

function tracked(check: Check, passed: Passed, scrub?: (f: Finding) => Finding): Check {
  return {
    ...check,
    async one(record, ctx) {
      const found = (await check.one!(record, ctx)).map((f) => scrub ? scrub(f) : f);
      if (found.length === 0 && isRec(record)) {
        const set = passed.get(record) ?? new Set<string>();
        set.add(check.name);
        passed.set(record, set);
      }
      return found;
    },
  };
}

// text_binds names the page number it did not expect (`numbered X`), which is a value from the record.
const withoutPageNumber = (f: Finding): Finding =>
  typeof f.detail === 'string' && /^page [0-9]+: numbered /.test(f.detail)
    ? { ...f, detail: f.detail.replace(/numbered .*$/s, 'numbered unexpectedly') }
    : f;

/** The two density numbers and the page-count rule: from the collection settings (the policy's values) and the config. */
function densityNumbers(settings: unknown): { minChars: number; minPages: number; requirePageCount: boolean } {
  const s = isRec(settings) ? settings : {};
  const minChars = s.minCharsPerPage, minPages = s.minPagesForDensity;
  if (typeof minChars !== 'number' || !Number.isFinite(minChars) || minChars <= 0) {
    throw new Error('search-only screen: settings.minCharsPerPage (a positive number) is required');
  }
  if (!Number.isSafeInteger(minPages) || (minPages as number) < 1) {
    throw new Error('search-only screen: settings.minPagesForDensity (a positive integer) is required');
  }
  if (typeof s.requirePageCount !== 'boolean') {
    throw new Error('search-only screen: settings.requirePageCount (true or false) is required');
  }
  return { minChars, minPages: minPages as number, requirePageCount: s.requirePageCount };
}

// ---- the report-only scan ----

// A PAN is five capitals, four digits and a capital; an Aadhaar number is twelve digits starting 2 to 9, in one run or
// in groups of four. Both must stand alone: no letter or digit (PAN) or digit (Aadhaar) touches them.
const PAN_SHAPE = /(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])/g;
const AADHAAR_SHAPE = /(?<![0-9])[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/g;

// Verhoeff's check: the dihedral multiplication table and the position permutation table.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True for a string of digits whose last digit is its Verhoeff check digit. */
export function verhoeffValid(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits)) return false;
  let c = 0;
  [...digits].reverse().forEach((ch, i) => {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(ch)]];
  });
  return c === 0;
}

/** Twelve digits (spaces and hyphens ignored) that read as three years, each between 1900 and 2099. */
export function yearLikeTriple(v: string): boolean {
  const d = v.replace(/[ -]/g, '');
  if (!/^[0-9]{12}$/.test(d)) return false;
  return [0, 4, 8].every((i) => {
    const y = Number(d.slice(i, i + 4));
    return y >= 1900 && y <= 2099;
  });
}

const SCAN_NOTE = 'strings shaped like identifiers; unverified upper bound; not evidence of personal data';

/**
 * Counts, by outcome (screened or held) and source host, of records and strings shaped like a PAN or an Aadhaar number.
 * An Aadhaar-shaped string is counted as shaped only when its Verhoeff check digit is right and it is not three
 * year-like groups; the others are counted apart, so nothing is hidden. It never keeps, returns or logs a value.
 */
function identifierShapes(cfg: SearchOnlyConfig): Report {
  return {
    name: 'identifier_shapes',
    note: SCAN_NOTE,
    one(record, _ctx, outcome) {
      const t = get(record, 'text');
      if (typeof t !== 'string') return [];
      const host = get(record, 'source_host');
      const pan = [...t.matchAll(PAN_SHAPE)].length;
      let aadhaar = 0, yearLike = 0, checksumFail = 0;
      for (const m of t.matchAll(AADHAAR_SHAPE)) {
        if (yearLikeTriple(m[0])) yearLike++;
        else if (!verhoeffValid(m[0].replace(/[ -]/g, ''))) checksumFail++;
        else aadhaar++;
      }
      return [{
        group: `${outcome}.${typeof host === 'string' && cfg.source_hosts.includes(host) ? host : 'other'}`,
        counts: {
          records: 1,
          shaped_like_pan_records: pan > 0 ? 1 : 0,
          shaped_like_pan_matches: pan,
          shaped_like_aadhaar_records: aadhaar > 0 ? 1 : 0,
          shaped_like_aadhaar_matches: aadhaar,
          aadhaar_shaped_year_like: yearLike,
          aadhaar_shaped_checksum_fail: checksumFail,
        },
      }];
    },
  };
}

// ---- the screen ----

/**
 * The search-only screen for one desk. `pageCheck` is the whole-set page check (page_check.ts), built with this
 * configuration's `pdfUrlRule`; it is only ever offered records whose file_url matches that rule.
 */
export function makeSearchOnlyScreen(config: unknown, pageCheck: Check): Screen {
  const cfg = parseSearchOnlyConfig(config);
  if (
    !pageCheck || typeof pageCheck.all !== 'function' || typeof pageCheck.one === 'function' ||
    pageCheck.needs !== 'pages'
  ) {
    throw new Error('search-only screen: the page check must be a whole-set check that needs the pages');
  }
  const pdfRule = new RegExp(cfg.pdf_url_rule, 'i');
  const passed: Passed = new WeakMap();
  const basisOf = new WeakMap<object, Basis>();

  // 1. Identity: the record's shape.
  const recordShape = oneCheck('record_shape', ['identity'], (r) => {
    const bad: string[] = [];
    const schema = get(r, 'schema');
    if (!text(schema) || !schema.startsWith(SCHEMA_PREFIX)) bad.push('schema');
    const sk = get(r, 'source_key');
    if (typeof sk !== 'string' || !HEX40.test(sk)) bad.push('source_key');
    if (get(r, 'desk_tier') !== cfg.desk_tier) bad.push('desk_tier');
    if (get(r, 'desk_feature') !== cfg.desk_feature) bad.push('desk_feature');
    if (get(r, 'desk_rows_feature') !== cfg.desk_rows_feature) bad.push('desk_rows_feature');
    if (get(r, 'doc_type') !== cfg.doc_type) bad.push('doc_type');
    const dk = get(r, 'document_key_suggested');
    // A key that is not a usable string is suggested_key_invalid (source_fields); only a usable one is judged here.
    if (text(dk) && !dk.startsWith(cfg.suggested_key_prefix)) bad.push('document_key_suggested');
    // The screen alone says how a record is known to be complete; a record that claims a basis is not trusted.
    if (Object.hasOwn(r, 'completeness_basis')) bad.push('completeness_basis');
    return bad.length ? [['bad_shape', bad.join(',')]] : [];
  });

  // 2. Identity: this screen loads new documents, not replacements.
  const notAReplacement = oneCheck('not_a_replacement', ['identity'], (r) => {
    const found = cfg.replacement_fields.some((f) => Object.hasOwn(r, f)) ||
      cfg.replacement_flags.some((f) => {
        const v = get(r, f);
        return v !== undefined && v !== null && v !== false;
      });
    return found ? [['replacement_not_supported']] : [];
  });

  // 3. Identity: the fields the adapter copies and the official source.
  const officialFileUrl = (u: string): boolean => {
    // The host is what stands before the first slash, and a slash must follow it (as admission reads it).
    const m = /^https:\/\/([^/]*)\//.exec(u);
    if (!m || !cfg.url_hosts.includes(m[1]) || !billUrlSegmentsOk(u)) return false;
    try {
      const p = new URL(u);
      return p.protocol === 'https:' && p.username === '' && p.password === '' && p.host === m[1] &&
        billUrlSegmentsOk(p.href);
    } catch {
      return false;
    }
  };
  const sourceFields = oneCheck('source_fields', ['identity'], (r) => {
    const out: Verdict[] = [];
    const title = get(r, 'title');
    if (!text(title, MAX_TITLE)) out.push(['title_invalid']);
    else if (!title.isWellFormed()) out.push(['field_invalid', 'title']);
    const citation = get(r, 'citation');
    if (!isRec(citation) || Object.keys(citation).length === 0) out.push(['citation_incomplete', 'citation']);
    else {
      const missing = cfg.citation_required.filter((f) => !text(get(citation, f)));
      if (missing.length) out.push(['citation_incomplete', missing.join(',')]);
      if (!wellFormedDeep(citation)) out.push(['field_invalid', 'citation']);
    }
    const quality = get(r, 'text_quality');
    if (quality !== undefined && quality !== 'ok') out.push(['text_quality']);
    for (const k of COPIED) {
      const v = get(r, k);
      if (v !== undefined && v !== null && (!text(v) || !v.isWellFormed())) out.push(['field_invalid', k]);
    }
    // The suggested key is the document's identity: a usable string of at most 500 UTF-8 bytes (admission's limit).
    const dk = get(r, 'document_key_suggested');
    if (!text(dk, MAX_FIELD) || !dk.isWellFormed() || utf8.encode(dk).length > MAX_SUGGESTED_KEY_BYTES) {
      out.push(['suggested_key_invalid']);
    }
    for (const k of URL_FIELDS) {
      const v = get(r, k);
      if (!text(v)) continue;
      try {
        const u = new URL(v);
        if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) out.push(['field_invalid', k]);
      } catch {
        out.push(['field_invalid', k]);
      }
    }
    const host = get(r, 'source_host');
    if (typeof host !== 'string' || !cfg.source_hosts.includes(host)) out.push(['unknown_host']);
    const url = get(r, 'file_url');
    if (text(url) && (utf8.encode(url).length > MAX_FILE_URL_BYTES || !officialFileUrl(url))) {
      out.push(['not_official_url']);
    }
    return out;
  });

  // 3b. Identity: the publisher the live citation path will show for the stored document (F332, "no publisher, no load").
  // The resolver is the one the chat calls (`hydrateDocumentRoles`), given what the stored row holds: the desk's tier and
  // feature (a record of another desk is held by record_shape), `metadata.source_host` and `metadata.citation` (the
  // payload's fields, copied as they are by prepareSuppliedText and ingest_admit_document) and the `file_url` column.
  // Whatever the resolver cannot name, this holds; the finding carries a fixed reason and no value from the record.
  const publisherUnresolved = oneCheck('publisher_unresolved', ['identity'], (r) => {
    const stored = { source_host: get(r, 'source_host'), citation: get(r, 'citation') };
    return documentPublisher(cfg.desk_tier, cfg.desk_feature, stored, get(r, 'file_url')) === ''
      ? [['publisher_unresolved']]
      : [];
  });

  // 4. Identity: the pack's links are read, never written.
  const linksShape = oneCheck('links_shape', ['identity'], (r) => {
    const links = get(r, 'links');
    if (links === undefined || links === null) return [];
    if (!Array.isArray(links)) return [['link_shape', 'links is not a list']];
    if (links.length === 0) return [];
    if (links.length > 1) return [['link_shape', `${links.length} links`]];
    const l = links[0];
    if (!isRec(l)) return [['link_shape', 'the link is not an object']];
    const bad: string[] = [];
    if (get(l, 'tier') !== cfg.desk_tier) bad.push('tier');
    if (get(l, 'feature') !== cfg.desk_rows_feature) bad.push('feature');
    if (get(l, 'role') !== 'primary_document') bad.push('role');
    if (!text(get(l, 'row_key'))) bad.push('row_key');
    const dk = get(r, 'document_key_suggested');
    if (!text(dk) || get(l, 'document_key') !== dk) bad.push('document_key');
    return bad.length ? [['link_shape', bad.join(',')]] : [];
  });

  // 7. Completeness: admission's density gate, on the text as admission sees it.
  const density = oneCheck('density', ['completeness'], (r, ctx) => {
    const { minChars, minPages, requirePageCount } = densityNumbers(ctx?.settings);
    const pages = get(r, 'pages');
    const np = Array.isArray(pages) ? pages.length : 0;
    if (np === 0) return requirePageCount ? [['no_page_spans']] : [];
    if (np < minPages) return [];
    const t = get(r, 'text');
    if (typeof t !== 'string') return [['below_density', 'text is not a string']];
    // prepare.ts strips control codes before the text is stored; admission counts what is stored (characters).
    const stored = [...strip({ text: t }, t).record.text as string].length;
    return stored / np < minChars
      ? [['below_density', `${np} pages, ${Math.floor(stored / np)} characters a page`]]
      : [];
  });

  // 8. Completeness: only the configured text-layer extractions.
  const extraction = oneCheck('extraction', ['completeness'], (r) => {
    const e = get(r, 'extraction');
    return typeof e === 'string' && cfg.extraction_allowed.includes(e) ? [] : [['extraction_not_allowed']];
  });

  const stats: Record<string, number | string[]> = {};
  const resetStats = () => {
    for (const k of Object.keys(stats)) delete stats[k];
    Object.assign(stats, {
      page_check: 0,
      density_only: 0,
      fetched: 0,
      cached: 0,
      unverifiedPages: 0,
      unverifiedRecords: 0,
      scans: [] as string[],
    });
  };
  resetStats();

  const isPdf = (r: Rec): boolean => {
    const u = get(r, 'file_url');
    return typeof u === 'string' && pdfRule.test(u) && billUrlSegmentsOk(u);
  };

  /** Why a record without a checkable PDF has no basis, or null when the density-only basis is earned. */
  const densityOnlyHold = (r: Rec): string | null => {
    if (!cfg.allow_density_only) return 'the density-only basis is not allowed and there is no checkable file';
    const ran = passed.get(r);
    for (const n of BASIS_CHECKS) if (!ran?.has(n)) return `check ${n} has not passed on this record`;
    const e = get(r, 'extraction');
    if (typeof e !== 'string' || !cfg.extraction_allowed.includes(e)) return 'extraction is not an allowed text layer';
    if (get(r, 'page_split') !== 'exact') return 'page_split is not exact';
    const pages = get(r, 'pages');
    if (!Array.isArray(pages) || pages.length === 0) return 'there are no page spans';
    return null;
  };

  // 17. Completeness: the page check for an official PDF, else the named density-only basis; never a default.
  const completenessBasis: Check & { stats: typeof stats } = {
    name: 'completeness_basis',
    covers: ['completeness'],
    needs: 'pages',
    onlyIfClean: true,
    stats,
    async all(records, ctx) {
      resetStats();
      const out = new Map<string, Finding[]>();
      const pdfs = records.filter(isPdf);
      const inner = (pageCheck as { stats?: unknown }).stats;
      const scansBefore = isRec(inner) && Array.isArray(inner.scans) ? inner.scans.length : 0;
      // A whole-set failure of the page check holds the records that needed it, and only those.
      let verdicts = new Map<string, Finding[]>();
      let pageFailed = false;
      if (pdfs.length) {
        try {
          const got = await pageCheck.all!(pdfs, ctx);
          if (!(got instanceof Map)) throw new TypeError('the page check did not return a map');
          verdicts = got;
        } catch {
          pageFailed = true;
        }
      }
      const offered = new Set(pdfs.map((r) => String(r.source_key)));
      for (const k of verdicts.keys()) {
        if (!offered.has(k)) throw new Error('the page check returned findings for a source_key it was not offered');
      }
      // PDFs the page check judged on page count alone: it has no text layer to compare, and lists them as scans.
      // Only the scans added by this call count (the list is kept for the whole run).
      const scanned = new Set(
        isRec(inner) && Array.isArray(inner.scans) ? inner.scans.slice(scansBefore).map(String) : [],
      );
      for (const r of records) {
        const k = keyOf(r);
        if (k === null) continue;
        if (isPdf(r)) {
          const found = verdicts.get(k) ?? [];
          if (pageFailed) out.set(k, [finding('completeness_basis', ['completeness'], 'page_check_error')]);
          else if (found.length) {
            out.set(k, found.map((f) => finding('completeness_basis', ['completeness'], f.reason, f.detail)));
          } else if (scanned.has(k)) {
            // A text-layer extraction of a file with no text layer is itself a mismatch.
            out.set(k, [finding('completeness_basis', ['completeness'], 'official_pdf_no_text')]);
          } else {
            basisOf.set(r, BASIS_PAGE_CHECK);
            (stats.page_check as number)++;
          }
          continue;
        }
        const why = densityOnlyHold(r);
        if (why !== null) out.set(k, [finding('completeness_basis', ['completeness'], 'no_completeness_basis', why)]);
        else {
          basisOf.set(r, BASIS_DENSITY_ONLY);
          (stats.density_only as number)++;
        }
      }
      if (pdfs.length && !pageFailed && isRec(inner)) {
        for (const [k, v] of Object.entries(inner)) {
          if (typeof v === 'number' && Number.isFinite(v) && k in stats) stats[k] = v;
          else if (k === 'scans' && Array.isArray(v)) stats.scans = v.map(String);
        }
      }
      return out;
    },
  };

  return {
    collection: cfg.collection,
    mappingVersion: cfg.mapping_version,
    rulesFiles: [
      'scripts/bulk-runner/screens/search_only.ts',
      'scripts/bulk-runner/screens/regulatory.json',
      'scripts/bulk-runner/screens/bills.ts',
      'scripts/bulk-runner/screen.ts',
      'scripts/bulk-runner/screen_types.ts',
      'scripts/bulk-runner/screens/index.ts',
      'scripts/bulk-runner/live.ts',
      'scripts/bulk-runner/page_check.ts',
      // Imported on a decision path: `strip` (density, duplicate texts), the URL segment rule, the text hash.
      'scripts/bulk-runner/prepare.ts',
      'supabase/functions/_shared/suppliedText.ts',
      'supabase/functions/_shared/textNormalise.ts',
      // Decides a hold (publisher_unresolved); it imports nothing.
      'supabase/functions/_shared/publisher.ts',
    ],
    listingRows: 'none',
    holdKeys: 'hex40',
    checks: [
      recordShape,
      notAReplacement,
      sourceFields,
      publisherUnresolved,
      linksShape,
      tracked(textBinds, passed, withoutPageNumber),
      tracked(makeLength(cfg.min_chars, cfg.max_chars), passed),
      tracked(density, passed),
      tracked(extraction, passed),
      servableCheck,
      makeLicenceAdmitted('search-only screen'),
      alreadyLive(cfg),
      suggestedKeyHeldLive(cfg),
      onHexKeys(
        collisionCheck('suggested_key_collision', 'suggested_key_collision', (r) => {
          const dk = get(r, 'document_key_suggested');
          return text(dk) ? dk : null;
        }),
      ),
      onHexKeys(fileUrlCollision),
      onHexKeys(duplicateText),
      duplicateTextLive,
      completenessBasis,
    ],
    reports: [identifierShapes(cfg)],
    project(record) {
      const basis = basisOf.get(record);
      if (basis === undefined) {
        throw new Error('search-only project: no completeness basis was recorded for this record');
      }
      return { ...record, completeness_basis: basis };
    },
  };
}

// ---- the live checks ----

/** 11. Dedupe: the source_key is held by any document; the file_url, when there is one, by a document of the desk. */
function alreadyLive(cfg: SearchOnlyConfig): Check {
  return {
    name: 'already_live',
    covers: ['dedupe'],
    needs: 'live',
    async all(records, ctx) {
      const out = new Map<string, Finding[]>();
      const keys = new Set<string>(), urls = new Set<string>();
      for (const r of records) {
        if (hexKey(r)) keys.add(r.source_key as string);
        const u = get(r, 'file_url');
        if (askable(u)) urls.add(u);
      }
      const docs = keys.size || urls.size
        ? await ctx.live.documents({ sourceKeys: [...keys], fileUrls: [...urls] })
        : [];
      const liveKeys = new Set(docs.map((d) => d.source_key).filter((x): x is string => typeof x === 'string'));
      const liveUrls = new Set(
        docs.filter((d) => d.desk_feature === cfg.desk_feature).map((d) => d.file_url).filter((x): x is string =>
          typeof x === 'string'
        ),
      );
      for (const r of records) {
        const k = keyOf(r);
        if (k === null) continue;
        const u = get(r, 'file_url');
        if (liveKeys.has(k)) out.set(k, [finding('already_live', ['dedupe'], 'already_live', 'source_key')]);
        else if (typeof u === 'string' && liveUrls.has(u)) {
          out.set(k, [finding('already_live', ['dedupe'], 'already_live', 'file_url')]);
        }
      }
      return out;
    },
  };
}

/** 12. Dedupe: a document of the desk already holds the record's suggested key. */
function suggestedKeyHeldLive(cfg: SearchOnlyConfig): Check {
  return {
    name: 'suggested_key_held_live',
    covers: ['dedupe'],
    needs: 'live',
    async all(records, ctx) {
      const out = new Map<string, Finding[]>();
      const asked = new Set<string>();
      for (const r of records) {
        const dk = get(r, 'document_key_suggested');
        if (keyOf(r) !== null && askable(dk)) asked.add(dk);
      }
      if (asked.size === 0) return out;
      const docs = await ctx.live.documents({
        sourceKeys: [],
        fileUrls: [],
        suggestedKeys: [...asked],
        tier: cfg.desk_tier,
        feature: cfg.desk_feature,
      });
      const held = new Set(
        docs.filter((d) => d.desk_feature === cfg.desk_feature).map((d) => d.document_key_suggested).filter((
          x,
        ): x is string => typeof x === 'string'),
      );
      for (const r of records) {
        const k = keyOf(r), dk = get(r, 'document_key_suggested');
        if (k !== null && typeof dk === 'string' && held.has(dk)) {
          out.set(k, [finding('suggested_key_held_live', ['dedupe'], 'suggested_key_held_live')]);
        }
      }
      return out;
    },
  };
}
