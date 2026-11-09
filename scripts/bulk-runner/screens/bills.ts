// The Bills screen (F307, S2): one Check per row of the spec's Bills table, except text per page, which another task
// supplies through `extra`. Spec: docs/specs/2026-11-10-screening-stage.md. The SQL rules are mirrored from
// supabase/migrations/20261107120000_bills_adapter.sql; where this file says "SQL line", that is the line mirrored.
// A check never passes a record it cannot judge, and a finding holds keys, numbers and reason names, never record text.
import type { Check, Finding, ReviewCheck, Screen, ScreenContext } from '../screen_types.ts';
import type { Rec } from '../prepare.ts';
import { sha256Hex } from '../../../supabase/functions/_shared/textNormalise.ts';

const BILLS = 'Bill Passage Probability Index';
const SCHEMA_PREFIX = 'nter.citation_pack/1.';
// What the pack calls a bill and a corrigendum in `doc_type` (assumed from the spec; no pack sample was read).
const BILL_DOC_TYPES = new Set(['bill', 'corrigendum']);
// SQL line 61: the official file URL rule, and no parent-directory segment.
const FILE_URL = /^https:\/\/sansad\.in\/getFile\/(BillsTexts|BillsPDFFiles)\//;
// SQL line 62: a bill number is arabic (Lok Sabha) or roman (Rajya Sabha); a year is four digits.
const NUMBER = /^([0-9]+|[IVXLCDM]+)$/;
const YEAR = /^[0-9]{4}$/;
// SQL line 63: the two houses.
const HOUSES = new Set(['Lok Sabha', 'Rajya Sabha']);
// SQL lines 65-66: the seven version roles (the pack names the role in citation.version).
const ROLES = new Set([
  'as_introduced',
  'as_passed_lok_sabha',
  'as_passed_rajya_sabha',
  'as_passed_both_houses',
  'gazette_notification',
  'synopsis',
  'errata',
]);
const MIN_CHARS = 200; // spec: Length
const MAX_CHARS = 600_000; // spec: Length (the adapter's own ceiling, SUPPLIED_TEXT.maxChars)
const DATE_WINDOW_DAYS = 3; // SQL line 89: abs(row date - record date) <= 3
const MIN_NAME = 8; // SQL line 64: a name of fewer than 8 letters and digits is incomplete

const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_KEY = /^[0-9a-f]{40}$/;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const keyOf = (r: Rec): string | null => str(r.source_key) ? r.source_key : null;

/** SQL lines 52-55 (bill_norm): the closing year removed, then letters and digits only. */
export function billNorm(v: unknown): string {
  return String(v ?? '').replace(/,?\s*[0-9]{4}\s*\.?\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** SQL lines 76-77: a real calendar date written YYYY-MM-DD, as a day number; else null. */
function isoDay(v: unknown): number | null {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : t / 86_400_000;
}

const citationOf = (r: Rec): Rec => isRec(r.citation) ? r.citation : {};
/** A number or year the pack may give as a string or a number (SQL reads both through ->>). */
const scalar = (v: unknown): string | null => str(v) ? v : isInt(v) ? String(v) : null;

/** SQL lines 62 and 67: the key a record's citation implies, or null when number or year is not well formed. */
function billKey(r: Rec): string | null {
  const c = citationOf(r);
  const n = scalar(c.bill_number), y = scalar(c.bill_year);
  return n !== null && y !== null && NUMBER.test(n) && YEAR.test(y) ? `bill:${y}:${n}` : null;
}

function finding(check: string, covers: ReviewCheck[], reason: string, detail?: string): Finding {
  return detail === undefined ? { check, covers, reason } : { check, covers, reason, detail };
}

type Verdict = [reason: string, detail?: string];
/** A per-record check from a function that lists what is wrong. */
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

const isCorrigendum = (r: Rec) => r.doc_type === 'corrigendum' || citationOf(r).version === 'errata';

const recordShape = oneCheck('record_shape', ['identity'], (r) => {
  const bad: string[] = [];
  if (!str(r.schema) || !r.schema.startsWith(SCHEMA_PREFIX)) bad.push('schema');
  if (!str(r.source_key) || !SOURCE_KEY.test(r.source_key)) bad.push('source_key');
  if (r.desk_tier !== 'national') bad.push('desk_tier');
  if (r.desk_feature !== BILLS) bad.push('desk_feature');
  if (r.desk_rows_feature !== BILLS) bad.push('desk_rows_feature');
  if (!str(r.doc_type) || !BILL_DOC_TYPES.has(r.doc_type)) bad.push('doc_type');
  return bad.length ? [['bad_shape', bad.join(',')]] : [];
});

const officialSource = oneCheck('official_source', ['identity'], (r) => {
  const url = r.file_url;
  if (!str(url) || !FILE_URL.test(url) || url.includes('..')) return [['not_official_url']];
  let last: string;
  try {
    last = new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return [['not_official_url']];
  }
  return r.file_name === last && last !== '' ? [] : [['file_name_mismatch']];
});

const citationComplete = oneCheck('citation_complete', ['identity'], (r) => {
  const c = citationOf(r);
  const bad: string[] = [];
  const n = scalar(c.bill_number), y = scalar(c.bill_year);
  if (n === null || !NUMBER.test(n)) bad.push('bill_number');
  if (y === null || !YEAR.test(y)) bad.push('bill_year');
  if (!str(c.house) || !HOUSES.has(c.house)) bad.push('house');
  if (billNorm(c.bill_name).length < MIN_NAME) bad.push('bill_name');
  if (!str(c.version) || !ROLES.has(c.version)) bad.push('version');
  return bad.length ? [['citation_incomplete', bad.join(',')]] : [];
});

const linksAgree = oneCheck('links_agree', ['identity'], (r) => {
  const links = r.links;
  if (!Array.isArray(links) || links.length === 0) return [['no_link']];
  const c = citationOf(r);
  const key = billKey(r);
  const n = scalar(c.bill_number), y = scalar(c.bill_year);
  const out: Verdict[] = [];
  links.forEach((l, i) => {
    const bad: string[] = [];
    if (!isRec(l)) bad.push('not_object');
    else {
      if (l.tier !== r.desk_tier) bad.push('tier');
      if (l.feature !== r.desk_rows_feature) bad.push('feature');
      if (key === null || l.document_key !== key) bad.push('document_key');
      if (!str(c.house) || l.house !== c.house) bad.push('house');
      if (n === null || scalar(l.bill_number) !== n) bad.push('bill_number');
      if (y === null || scalar(l.bill_year) !== y) bad.push('bill_year');
    }
    if (bad.length) out.push(['link_disagrees', `link ${i}: ${bad.join(',')}`]);
  });
  return out;
});

// Spec: Text binds. Offsets are in code points, as prepare.ts counts them.
const textBinds = oneCheck('text_binds', ['completeness'], async (r) => {
  const out: Verdict[] = [];
  const text = r.text;
  if (typeof text !== 'string') return [['text_hash_mismatch', 'text is not a string']];
  const cps = [...text];
  if (!str(r.content_sha256) || !SHA256.test(r.content_sha256) || await sha256Hex(text) !== r.content_sha256) {
    out.push(['text_hash_mismatch']);
  }
  if (r.n_chars !== cps.length) out.push(['n_chars_mismatch']);
  const split = r.page_split;
  if (split !== 'exact' && split !== 'none') out.push(['page_split', 'page_split is not exact or none']);

  const pages = r.pages;
  const noPages = pages === undefined || (Array.isArray(pages) && pages.length === 0);
  if (split === 'none' && noPages) {
    if (!isInt(r.page_count) || r.page_count < 1) out.push(['page_spans', 'page_count']);
    return out;
  }
  if (!Array.isArray(pages) || noPages) return [...out, ['page_spans', 'pages missing']];
  let end = -1; // the last character of the previous page; a form feed follows it
  let bad: string | null = null;
  for (let i = 0; i < pages.length && bad === null; i++) {
    const p = pages[i];
    const from = isRec(p) ? p.char_from : null, to = isRec(p) ? p.char_to : null;
    if (!isRec(p) || !isInt(from) || !isInt(to)) bad = `page ${i + 1}: not a span`;
    else if (p.page_number !== i + 1) bad = `page ${i + 1}: numbered ${String(p.page_number)}`;
    else if (from !== end + 1 || to < from || to > cps.length) bad = `page ${i + 1}: span not contiguous`;
    else if (i > 0 && cps[end] !== '\f') bad = `page ${i + 1}: no form feed before it`;
    else if (p.text !== cps.slice(from, to).join('')) bad = `page ${i + 1}: text differs from its span`;
    else end = to;
  }
  if (bad === null && end !== cps.length) bad = 'pages do not reach the end of the text';
  if (bad === null && r.page_count !== pages.length) bad = 'page_count differs from the pages';
  if (bad !== null) out.push(['page_spans', bad]);
  return out;
});

const length = oneCheck('length', ['completeness'], (r) => {
  if (typeof r.text !== 'string') return [['too_short', 'text is not a string']];
  // prepare.ts counts the ceiling in UTF-16 units (text.length), so this does.
  if (r.text.length < MIN_CHARS) return [['too_short']];
  if (r.text.length > MAX_CHARS) return [['too_long']];
  return [];
});

const servableCheck = oneCheck('servable_licence', ['sensitivity'], (r) => {
  const out: Verdict[] = [];
  if (r.servable !== true) out.push(['not_servable', typeof r.servable === 'boolean' ? undefined : 'servable missing']);
  const lc = r.licence_class;
  if (!str(lc)) out.push(['licence_barred', 'licence_class missing']);
  else {
    if (lc.startsWith('BARRED_')) out.push(['licence_barred']); // pack.ts's rule
    if (/personal_data/i.test(lc)) out.push(['personal_data']);
  }
  return out;
});

const licenceAdmitted = oneCheck('licence_admitted', ['rights'], (r, ctx) => {
  const admitted = ctx?.settings?.licenceClasses;
  if (!Array.isArray(admitted) || !admitted.every((c) => typeof c === 'string')) {
    throw new Error('bills screen: settings.licenceClasses (an array of strings) is required');
  }
  return str(r.licence_class) && admitted.includes(r.licence_class) ? [] : [['licence_not_admitted']];
});

// Live, one read for the whole set (never one per record).
const listingRow: Check = {
  name: 'listing_row',
  covers: ['identity'],
  needs: 'live',
  async all(records, ctx) {
    const out = new Map<string, Finding[]>();
    const add = (k: string, detail?: string) =>
      out.set(k, [finding('listing_row', ['identity'], 'no_live_row', detail)]);
    const keys = new Set<string>();
    for (const r of records) {
      const k = keyOf(r), dk = billKey(r);
      if (k !== null && dk !== null) keys.add(dk);
    }
    const rows = keys.size
      ? await ctx.live.deskRows({ tier: 'national', feature: BILLS, documentKeys: [...keys] })
      : [];
    // SQL lines 82-84 (ingest_bill_rows): the candidates are the rows of this key in this house.
    const candidates = new Map<string, Rec[]>();
    for (const x of rows) {
      if (!isRec(x.row) || !str(x.row.house)) continue;
      const at = `${x.document_key}\u0000${x.row.house}`;
      candidates.set(at, [...(candidates.get(at) ?? []), x.row]);
    }
    for (const r of records) {
      const k = keyOf(r);
      if (k === null) continue; // record_shape holds a record with no key
      const dk = billKey(r), house = citationOf(r).house;
      if (dk === null || !str(house)) {
        add(k, 'key or house cannot be read');
        continue;
      }
      const rowsOf = candidates.get(`${dk}\u0000${house}`) ?? [];
      if (rowsOf.length === 0) {
        add(k);
        continue;
      }
      // SQL line 87: of the candidates, those whose whole normalised name equals the record's.
      const c = citationOf(r);
      const name = billNorm(c.bill_name);
      const named = name === '' ? [] : rowsOf.filter((row) => billNorm(row.bill_name) === name);
      if (named.length === 0) {
        out.set(k, [
          finding('listing_row', ['identity'], 'listing_name_mismatch', `${rowsOf.length} row(s) of the key`),
        ]);
        continue;
      }
      // SQL lines 76-79 and 87-89: when the record gives a date, a matching row's date must be valid and within 3 days.
      if (c.introduced_on === undefined || c.introduced_on === null) continue;
      const given = isoDay(c.introduced_on);
      // Mirrored differently from the SQL, which ignores a malformed date: a date the record gives but that cannot be
      // read is held, since nothing then checks it.
      const near = given !== null && named.some((row) => {
        const d = isoDay(row.date_introduced);
        return d !== null && Math.abs(d - given) <= DATE_WINDOW_DAYS;
      });
      if (!near) {
        out.set(k, [
          finding(
            'listing_row',
            ['identity'],
            'listing_date_far',
            given === null ? 'introduced_on is not a date' : undefined,
          ),
        ]);
      }
    }
    return out;
  },
};

const alreadyLive: Check = {
  name: 'already_live',
  covers: ['dedupe'],
  needs: 'live',
  async all(records, ctx) {
    const out = new Map<string, Finding[]>();
    const add = (k: string, detail?: string) =>
      out.set(k, [finding('already_live', ['dedupe'], 'already_live', detail)]);
    const keys = new Set<string>(), urls = new Set<string>();
    for (const r of records) {
      if (keyOf(r) !== null) keys.add(r.source_key as string);
      if (str(r.file_url)) urls.add(r.file_url);
    }
    const docs = keys.size || urls.size ? await ctx.live.documents({ sourceKeys: [...keys], fileUrls: [...urls] }) : [];
    const liveKeys = new Set(docs.map((d) => d.source_key).filter(str));
    const liveUrls = new Set(docs.map((d) => d.file_url).filter(str));
    for (const r of records) {
      const k = keyOf(r);
      if (k === null) continue;
      if (!str(r.file_url)) add(k, 'file_url missing');
      else if (liveKeys.has(k) || liveUrls.has(r.file_url)) add(k);
    }
    return out;
  },
};

// Spec: the lowest source_key of a text stays, the rest are held.
const duplicateText: Check = {
  name: 'duplicate_text',
  covers: ['dedupe'],
  all(records) {
    const out = new Map<string, Finding[]>();
    const byHash = new Map<string, string[]>();
    for (const r of records) {
      const k = keyOf(r);
      if (k === null) continue;
      const h = r.content_sha256;
      if (!str(h) || !SHA256.test(h)) {
        out.set(k, [finding('duplicate_text', ['dedupe'], 'duplicate_text', 'content_sha256 missing or malformed')]);
      } else byHash.set(h, [...(byHash.get(h) ?? []), k]);
    }
    for (const keys of byHash.values()) {
      if (keys.length < 2) continue;
      const keep = [...keys].sort()[0];
      for (const k of keys) {
        if (k !== keep) out.set(k, [finding('duplicate_text', ['dedupe'], 'duplicate_text', `same text as ${keep}`)]);
      }
    }
    return Promise.resolve(out);
  },
};

// Spec: corrigenda wait for a mapping file, which is not located; prepare.ts holds the same until it is.
const corrigendum = oneCheck(
  'corrigendum',
  ['identity'],
  (r) => isCorrigendum(r) ? [['corrigendum_unmapped']] : [],
);

/**
 * The fields the adapter reads at the top of a bill (`document_key`, `document_role`), from fields the checks verified.
 * Throws rather than guess, and never overwrites a different value already there.
 */
function project(record: Rec): Rec {
  const key = billKey(record);
  const links = record.links;
  if (key === null) throw new Error('bills project: the citation gives no document key');
  if (!Array.isArray(links) || links.length === 0 || !links.every((l) => isRec(l) && l.document_key === key)) {
    throw new Error("bills project: the links do not all carry the citation's document key");
  }
  const role = citationOf(record).version;
  if (!str(role) || !ROLES.has(role)) throw new Error('bills project: citation.version is not a known role');
  for (const [field, value] of [['document_key', key], ['document_role', role]] as const) {
    if (record[field] !== undefined && record[field] !== value) {
      throw new Error(`bills project: ${field} is already set and differs`);
    }
  }
  return { ...record, document_key: key, document_role: role };
}

/** The Bills screen. `extra` (the page check) is appended to this screen's own checks. */
export function makeBillsScreen(extra: Check[] = []): Screen {
  return {
    collection: 'national-bills',
    mappingVersion: 'bills-screen-v1',
    rulesFiles: [
      'scripts/bulk-runner/screens/bills.ts',
      'scripts/bulk-runner/screen.ts',
      'scripts/bulk-runner/page_check.ts',
    ],
    checks: [
      recordShape,
      officialSource,
      citationComplete,
      linksAgree,
      listingRow,
      textBinds,
      length,
      servableCheck,
      licenceAdmitted,
      alreadyLive,
      duplicateText,
      corrigendum,
      ...extra,
    ],
    project,
  };
}
