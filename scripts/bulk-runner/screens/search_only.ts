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
import {
  type Check,
  type Finding,
  type Report,
  REVIEW_CHECKS,
  type ReviewCheck,
  type Screen,
  type ScreenContext,
} from '../screen_types.ts';
import { type PrepareOptions, prepareRecord, type Rec, strip } from '../prepare.ts';
import { sha256Hex } from '../../../supabase/functions/_shared/textNormalise.ts';
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

/**
 * What the configuration file holds. Every field is required except the ones marked optional (F374, the five National
 * desks); an unknown field is refused. An absent optional field means what Regulatory's file always meant.
 */
export interface SearchOnlyConfig {
  collection: string;
  mapping_version: string;
  desk_tier: string;
  /** The spelling documents and chunks use (the live reads and the pack's desk_feature). */
  desk_feature: string;
  /** The spelling the listing and the pack's desk_rows_feature use; links are read under it, never written. */
  desk_rows_feature: string;
  doc_type: string;
  /** Optional: further doc_type values the pack uses for this desk (budget_doc beside budget_document). Default none. */
  doc_type_also: string[];
  /**
   * Optional: what a record's document_key_suggested must start with. Absent: the desk's packs carry no suggested key
   * (Cabinet, Transfers), and a record that carries one is held as bad_shape.
   */
  suggested_key_prefix?: string;
  citation_required: string[];
  extraction_allowed: string[];
  source_hosts: string[];
  url_hosts: string[];
  /**
   * Optional. Matches the file_url of a record whose official file can be page-checked; compiled case-insensitive. It
   * names one host, or several as `(?:a\.b|c\.d)`, each one of url_hosts. Absent: the desk has no file to page-check
   * (Cabinet and MP Profiles are web pages), and no record is ever offered to the page check.
   */
  pdf_url_rule?: string;
  min_chars: number;
  max_chars: number;
  replacement_fields: string[];
  replacement_flags: string[];
  allow_density_only: boolean;
  /**
   * Optional, default false. True: the pack's `links` are not read. A search-only document has no listing link
   * (prepare.ts copies none and admission writes none), and the packs of Cabinet, Transfers, Industry v1.3 and MP
   * Profiles carry links in a shape links_shape would hold (no row_key, a document_key the record does not carry, the
   * listing spelled with commas).
   */
  ignore_pack_links: boolean;
  /**
   * Optional, default false. True: the desk's text is a web page or a dataset with no pages (page_split none and no
   * page_count in the pack). Such a record passes text_binds with no spans and may rest on the density-only basis with
   * no spans. A record that does carry spans is judged as ever. The policy's requirePageCount still applies: admission
   * refuses a page-less record when it is set, so the screen holds it too.
   */
  unpaged_text: boolean;
  /**
   * Optional, default none. Accepted spellings of the desk mapped to the one written: a record naming a key of this
   * map in desk_feature or desk_rows_feature passes the identity check, and the screened record carries the value in
   * that field (project). Every value is this configuration's desk_feature or desk_rows_feature.
   */
  spelling_rewrites: Record<string, string>;
}

/** What `makeSearchOnlyScreen` takes beside the configuration and the page check. */
export interface SearchOnlyOptions {
  /**
   * The repository path of this screen's configuration file, hashed with the rules in place of Regulatory's. Absent:
   * `scripts/bulk-runner/screens/regulatory.json`.
   */
  configFile?: string;
  /** Who published the stored document (default: the live citation path's resolver). A seam for tests. */
  publisher?: (tier: unknown, feature: unknown, metadata: unknown, fileUrl: unknown) => string;
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
  'doc_type_also',
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
  'ignore_pack_links',
  'unpaged_text',
  'spelling_rewrites',
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
  /** An optional flag: absent (or undefined) is false. */
  const optionalFlag = (k: string): boolean => get(value, k) === undefined ? false : flag(k);
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
    doc_type_also: get(value, 'doc_type_also') === undefined ? [] : words('doc_type_also'),
    suggested_key_prefix: get(value, 'suggested_key_prefix') === undefined ? undefined : word('suggested_key_prefix'),
    citation_required: words('citation_required'),
    extraction_allowed: words('extraction_allowed'),
    source_hosts: words('source_hosts'),
    url_hosts: words('url_hosts'),
    pdf_url_rule: get(value, 'pdf_url_rule') === undefined ? undefined : word('pdf_url_rule'),
    min_chars: count('min_chars'),
    max_chars: count('max_chars'),
    replacement_fields: words('replacement_fields', true),
    replacement_flags: words('replacement_flags', true),
    allow_density_only: flag('allow_density_only'),
    ignore_pack_links: optionalFlag('ignore_pack_links'),
    unpaged_text: optionalFlag('unpaged_text'),
    spelling_rewrites: spellings(value, fail),
  };
  if (cfg.doc_type_also.includes(cfg.doc_type) || new Set(cfg.doc_type_also).size !== cfg.doc_type_also.length) {
    fail('doc_type_also', 'must not repeat a doc_type');
  }
  for (const to of Object.values(cfg.spelling_rewrites)) {
    if (to !== cfg.desk_feature && to !== cfg.desk_rows_feature) {
      fail('spelling_rewrites', 'must map to this desk_feature or desk_rows_feature');
    }
  }
  for (const from of Object.keys(cfg.spelling_rewrites)) {
    if (from === cfg.desk_feature || from === cfg.desk_rows_feature) {
      fail('spelling_rewrites', 'must not accept a spelling the desk already writes');
    }
  }
  for (const h of cfg.url_hosts) {
    if (!/^[a-z0-9.-]+$/.test(h)) fail('url_hosts', 'must hold plain lower-case host names');
  }
  if (cfg.max_chars <= cfg.min_chars) fail('max_chars', 'must be larger than min_chars');
  if (cfg.max_chars > ADAPTER_MAX_CHARS) {
    fail('max_chars', `must be at most ${ADAPTER_MAX_CHARS} (the adapter's limit)`);
  }
  if (cfg.pdf_url_rule !== undefined) {
    if (!cfg.pdf_url_rule.startsWith('^https://') || !cfg.pdf_url_rule.endsWith('$')) {
      fail('pdf_url_rule', 'must be anchored at both ends: start with ^https:// and end with $');
    }
    // The rule's host (the plain host name right after ^https://, dots escaped; or a group `(?:a|b)` of them) must be
    // official: every host it names is one of url_hosts.
    const named = RULE_HOSTS.exec(cfg.pdf_url_rule);
    const ruleHosts = (named?.[1] ?? named?.[2])?.split('|').map((h) => h.replaceAll('\\.', '.'));
    if (ruleHosts === undefined || !ruleHosts.every((h) => cfg.url_hosts.includes(h))) {
      fail('pdf_url_rule', 'must name its hosts plainly (one, or a group of them), and each must be one of url_hosts');
    }
    try {
      new RegExp(cfg.pdf_url_rule, 'i');
    } catch {
      fail('pdf_url_rule', 'is not a regular expression');
    }
  }
  return cfg;
}

const PLAIN_HOST = String.raw`(?:[a-z0-9-]+\\\.)*[a-z0-9-]+`;
/** The host part of a pdf_url_rule: `^https://host/` or `^https://(?:host|host)/`, dots escaped. */
const RULE_HOSTS = new RegExp(
  String.raw`^\^https:\/\/(?:(${PLAIN_HOST})|\(\?:(${PLAIN_HOST}(?:\|${PLAIN_HOST})*)\))\/`,
);

/** The optional `spelling_rewrites` map: an object of non-empty strings to non-empty strings, copied. */
function spellings(value: Rec, fail: (field: string, why: string) => never): Record<string, string> {
  const v = get(value, 'spelling_rewrites');
  if (v === undefined) return {};
  if (!isRec(v)) return fail('spelling_rewrites', 'must be an object of accepted spellings to the one written');
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(v)) {
    if (!text(from, 1_000) || !text(to, 1_000)) {
      return fail('spelling_rewrites', 'must map non-empty strings to non-empty strings');
    }
    out[from] = to;
  }
  return out;
}

/** The PDF URL rule of a configuration, compiled case-insensitive: for the page check and for this screen alike. */
export function pdfUrlRule(config: unknown): RegExp {
  const rule = parseSearchOnlyConfig(config).pdf_url_rule;
  // A desk with no rule has no file to page-check: the empty negative lookahead matches nothing.
  return rule === undefined ? /(?!)/ : new RegExp(rule, 'i');
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

/** The prepare options of the run, from the context; a missing or unusable block is an error (the check then fails closed). */
function prepareOptionsOf(ctx: ScreenContext | undefined): PrepareOptions {
  const p = ctx?.prepare;
  if (
    !isRec(p) || !Number.isSafeInteger(p.maxChunks) ||
    (p.maxChunks as number) < 1
  ) {
    throw new Error(
      'search-only screen: the collection file prepare block (maxChunks) is required',
    );
  }
  // A patch replaces a pack record under its key; this check probes records one by one and would hold the original as
  // superseded_by_patch. A collection that uses patches is not one this check can judge.
  if (p.patches !== undefined && p.patches !== null) {
    throw new Error('search-only screen: prepare.patches is not supported with prepare_holds');
  }
  return p as unknown as PrepareOptions;
}

/** What a prepare hold may say: its chunk count, or the numbers of its own fixed sentences; never a value of the record. */
function holdDetail(
  h: { reason: string; detail?: string; chunks?: number },
): string | undefined {
  if (h.reason === 'over_chunk_limit' && typeof h.chunks === 'number') {
    return `${h.chunks} chunks`;
  }
  if (
    (h.reason === 'over_chunk_limit' || h.reason === 'control_codes_excess') &&
    typeof h.detail === 'string' &&
    /^[A-Za-z0-9 ,.()-]{1,160}$/.test(h.detail)
  ) {
    return h.detail;
  }
  return undefined;
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

const DEFAULT_CONFIG_FILE = 'scripts/bulk-runner/screens/regulatory.json';

/**
 * text_binds for a desk whose text is a web page or a dataset (unpaged_text). The pack gives such a record
 * page_split 'none', no spans and no page_count; text_binds wants a split-less record's page_count to equal its spans,
 * so this asks it with the count the record has: 0. A record with a declared count, or with spans, is asked as it is.
 */
const unpagedTextBinds: Check = {
  ...textBinds,
  one: (record, ctx) => {
    const pages = get(record, 'pages');
    const unpaged = get(record, 'page_split') === 'none' && get(record, 'page_count') == null &&
      (pages === undefined || (Array.isArray(pages) && pages.length === 0));
    return textBinds.one!(unpaged ? { ...record, page_count: 0 } : record, ctx);
  },
};

/** Counts the records whose desk spelling the screen rewrote (screened records only: a held record is not written). */
function deskSpelling(respell: (r: Rec) => Rec): Report {
  return {
    name: 'desk_spelling',
    note:
      "records whose desk_feature or desk_rows_feature was rewritten to the desk's one spelling; screened records only",
    one(record, _ctx, outcome) {
      return [{
        group: outcome,
        counts: { records: 1, rewritten: outcome === 'screened' && respell(record) !== record ? 1 : 0 },
      }];
    },
  };
}

/**
 * The search-only screen for one desk. `pageCheck` is the whole-set page check (page_check.ts), built with this
 * configuration's `pdfUrlRule`; it is only ever offered records whose file_url matches that rule.
 */
export function makeSearchOnlyScreen(config: unknown, pageCheck: Check, options: SearchOnlyOptions = {}): Screen {
  const cfg = parseSearchOnlyConfig(config);
  const configFile = options.configFile ?? DEFAULT_CONFIG_FILE;
  if (!/^scripts\/bulk-runner\/screens\/[a-z_]+\.json$/.test(configFile)) {
    throw new Error('search-only screen: configFile must be a configuration file under scripts/bulk-runner/screens/');
  }
  const publisherOf = options.publisher ?? documentPublisher;
  if (
    !pageCheck || typeof pageCheck.all !== 'function' || typeof pageCheck.one === 'function' ||
    pageCheck.needs !== 'pages'
  ) {
    throw new Error('search-only screen: the page check must be a whole-set check that needs the pages');
  }
  const pdfRule = cfg.pdf_url_rule === undefined ? null : new RegExp(cfg.pdf_url_rule, 'i');
  const rewrites = new Map(Object.entries(cfg.spelling_rewrites));
  /** The spelling the desk writes for a value the desk accepts: the value itself, or what the map says. */
  const accepted = (v: unknown, written: string): boolean =>
    v === written || (typeof v === 'string' && rewrites.get(v) === written);
  /** The record with its accepted spellings replaced by the written ones; the same object when nothing changes. */
  const respell = (r: Rec): Rec => {
    const f = get(r, 'desk_feature'), rows = get(r, 'desk_rows_feature');
    const nf = typeof f === 'string' ? rewrites.get(f) : undefined,
      nr = typeof rows === 'string' ? rewrites.get(rows) : undefined;
    return nf === undefined && nr === undefined ? r : {
      ...r,
      ...(nf === undefined ? {} : { desk_feature: nf }),
      ...(nr === undefined ? {} : { desk_rows_feature: nr }),
    };
  };
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
    if (!accepted(get(r, 'desk_feature'), cfg.desk_feature)) bad.push('desk_feature');
    if (!accepted(get(r, 'desk_rows_feature'), cfg.desk_rows_feature)) bad.push('desk_rows_feature');
    const docType = get(r, 'doc_type');
    if (docType !== cfg.doc_type && !(typeof docType === 'string' && cfg.doc_type_also.includes(docType))) {
      bad.push('doc_type');
    }
    const dk = get(r, 'document_key_suggested');
    if (cfg.suggested_key_prefix === undefined) {
      // The desk's packs carry no suggested key; one that appears is not this desk's shape (absent and null are alike).
      if (dk !== undefined && dk !== null) bad.push('document_key_suggested');
    } else if (text(dk) && !dk.startsWith(cfg.suggested_key_prefix)) {
      // A key that is not a usable string is suggested_key_invalid (source_fields); only a usable one is judged here.
      bad.push('document_key_suggested');
    }
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
    // A desk with no key prefix expects none: a key that appears is held by record_shape, and an absent one is no fault.
    if (cfg.suggested_key_prefix !== undefined || (dk !== undefined && dk !== null)) {
      if (!text(dk, MAX_FIELD) || !dk.isWellFormed() || utf8.encode(dk).length > MAX_SUGGESTED_KEY_BYTES) {
        out.push(['suggested_key_invalid']);
      }
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
    return publisherOf(cfg.desk_tier, cfg.desk_feature, stored, get(r, 'file_url')) === ''
      ? [['publisher_unresolved']]
      : [];
  });

  // 4. Identity: the pack's links are read, never written.
  const linksShape = oneCheck('links_shape', ['identity'], (r) => {
    // A desk that writes no listing link does not read the pack's (see ignore_pack_links).
    if (cfg.ignore_pack_links) return [];
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
    return typeof u === 'string' && pdfRule !== null && pdfRule.test(u) && billUrlSegmentsOk(u);
  };
  /**
   * A text with no page spans cannot be compared with a PDF page by page, so it is never offered to the page check,
   * which would fetch the file (F369 D2: a web page's text is never checked against, or fetched as, the blocked PDF).
   * Such a record whose link is a checkable PDF has no basis. Only an unpaged desk can bring one this far.
   */
  const unpagedPdf = (r: Rec): boolean => {
    const pages = get(r, 'pages');
    return isPdf(r) && (!Array.isArray(pages) || pages.length === 0);
  };

  /** Why a record without a checkable PDF has no basis, or null when the density-only basis is earned. */
  const densityOnlyHold = (r: Rec): string | null => {
    if (!cfg.allow_density_only) return 'the density-only basis is not allowed and there is no checkable file';
    const ran = passed.get(r);
    for (const n of BASIS_CHECKS) if (!ran?.has(n)) return `check ${n} has not passed on this record`;
    const e = get(r, 'extraction');
    if (typeof e !== 'string' || !cfg.extraction_allowed.includes(e)) return 'extraction is not an allowed text layer';
    const pages = get(r, 'pages');
    const noPages = !Array.isArray(pages) || pages.length === 0;
    if (cfg.unpaged_text && noPages) {
      // A web page or dataset: no spans, and the pack says so (split none; text_binds checked the rest).
      if (get(r, 'page_split') !== 'none') return 'page_split is not none';
      return null;
    }
    if (get(r, 'page_split') !== 'exact') return 'page_split is not exact';
    if (noPages) return 'there are no page spans';
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
      const pdfs = records.filter((r) => isPdf(r) && !unpagedPdf(r));
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
        if (unpagedPdf(r)) {
          out.set(k, [
            finding(
              'completeness_basis',
              ['completeness'],
              'no_completeness_basis',
              'a text with no page spans is not checked against a PDF',
            ),
          ]);
          continue;
        }
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

  // 18. Completeness (F339): what the runner's prepare step would hold. The screen counts characters, prepare counts
  // chunks (and control codes), so a record could pass here and be held there. This asks prepare itself, with the
  // options the runner reads from the same collection file (`ctx.prepare`): no second chunker and no second limit.
  // prepare is given the record as the runner will receive it (the screen's own additions, with a placeholder review
  // that has no effect on the chunks), and its reason code is the finding's. Only records that every other check passed
  // are probed, so the cost is spent on the records that would be admitted.
  const prepareHolds: Check = {
    name: 'prepare_holds',
    covers: ['completeness'],
    onlyIfClean: true,
    async one(record, ctx) {
      const options = prepareOptionsOf(ctx);
      const basis = basisOf.get(record);
      if (basis === undefined) {
        throw new Error(
          'prepare_holds: no completeness basis was recorded for this record',
        );
      }
      const hash = await sha256Hex(record.text as string);
      const probe: Rec = {
        ...respell(record),
        completeness_basis: basis,
        text_sha256: hash,
        review: {
          status: 'eligible',
          text_sha256: hash,
          source_key: record.source_key,
          rules_sha256: '0'.repeat(64),
          package_id: 'probe',
          mapping_version: 'probe',
          decision_id: 'probe',
          checks: Object.fromEntries(REVIEW_CHECKS.map((c) => [c, true])),
        },
      };
      const done = await prepareRecord(probe, options);
      if (done.kind === 'request') return [];
      const h = done.hold;
      return [
        finding('prepare_holds', ['completeness'], h.reason, holdDetail(h)),
      ];
    },
  };

  return {
    collection: cfg.collection,
    mappingVersion: cfg.mapping_version,
    rulesFiles: [
      'scripts/bulk-runner/screens/search_only.ts',
      configFile,
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
      tracked(cfg.unpaged_text ? unpagedTextBinds : textBinds, passed, withoutPageNumber),
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
      duplicateTitleLive(cfg),
      completenessBasis,
      prepareHolds,
    ],
    usesPrepare: true,
    desk: { tier: cfg.desk_tier, feature: cfg.desk_feature },
    ...(rewrites.size ? { projectRewrites: ['desk_feature', 'desk_rows_feature'] as const } : {}),
    reports: rewrites.size ? [identifierShapes(cfg), deskSpelling(respell)] : [identifierShapes(cfg)],
    project(record) {
      const basis = basisOf.get(record);
      if (basis === undefined) {
        throw new Error('search-only project: no completeness basis was recorded for this record');
      }
      return respell({ ...record, completeness_basis: basis });
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

/** Letters and digits only, lower case, every other run (spaces, underscores, hyphens, commas) one space, trimmed. */
export const normaliseTitle = (v: string): string => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A host as compared between a record and a live document: a leading `www.` is not part of the name. */
const bareHost = (h: unknown): string | null => typeof h === 'string' ? h.replace(/^www\./i, '').toLowerCase() : null;
/** A file name without its last extension (`A_b.PDF` to `A_b`). */
const fileStem = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,6}$/, '');

/**
 * 13b. Dedupe (F345): a live document of the desk, from the same source host, with the same file date and the same
 * normalised title under another key. The pack's title is often the file name, and an OCR-derived live document's title
 * is that name with hyphens for spaces; the content hash and the key differ, so the other live checks miss it. The
 * record's `title_stem` and `title` are compared with the live document's title and file stem. A document that holds
 * the record's own key is `already_live`, and is not reported again here.
 */
function duplicateTitleLive(cfg: SearchOnlyConfig): Check {
  return {
    name: 'duplicate_title_live',
    covers: ['dedupe'],
    needs: 'live',
    async all(records, ctx) {
      const out = new Map<string, Finding[]>();
      const asked = new Map<string, Set<string>>();
      const mtimes = new Set<string>();
      for (const r of records) {
        const k = keyOf(r),
          m = get(r, 'file_mtime'),
          host = get(r, 'source_host');
        if (k === null || !askable(m) || typeof host !== 'string') continue;
        const names = new Set<string>();
        for (const f of ['title_stem', 'title']) {
          const v = get(r, f);
          const n = typeof v === 'string' ? normaliseTitle(v) : '';
          if (n !== '') names.add(n);
        }
        if (names.size === 0) continue;
        asked.set(k, names);
        mtimes.add(m);
      }
      if (mtimes.size === 0) return out;
      const docs = await ctx.live.documents({
        sourceKeys: [],
        fileUrls: [],
        fileMtimes: [...mtimes],
        tier: cfg.desk_tier,
        feature: cfg.desk_feature,
      });
      const ofDesk = docs.filter((d) => d.desk_feature === cfg.desk_feature && typeof d.file_mtime === 'string');
      for (const r of records) {
        const k = keyOf(r);
        const names = k === null ? undefined : asked.get(k);
        if (k === null || !names) continue;
        const m = get(r, 'file_mtime'), host = get(r, 'source_host');
        const held = ofDesk.filter((d) => {
          if (
            d.file_mtime !== m || bareHost(d.source_host) !== bareHost(host) || d.source_key === k
          ) return false;
          const theirs = [
            d.title,
            typeof d.file_name === 'string' ? fileStem(d.file_name) : null,
          ]
            .map((v) => typeof v === 'string' ? normaliseTitle(v) : '');
          return theirs.some((n) => n !== '' && names.has(n));
        }).map((d) => d.source_key ?? `document ${d.id}`).sort();
        if (held.length) {
          out.set(k, [
            finding(
              'duplicate_title_live',
              ['dedupe'],
              'duplicate_title_live',
              `held by ${held[0]}`,
            ),
          ]);
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
