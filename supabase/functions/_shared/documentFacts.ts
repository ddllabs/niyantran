// Catalogue fields for the research chat (spec 2026-11-12-bill-metadata-in-chat.md, D1, D3, D6).
//
// Pure functions from stored document metadata, or from a verified desk row, to one short line:
//   - `documentFacts` is the line shown under a retrieved Bills document: number, year, House and introduction date.
//   - `billIdentity` is the sentence that names one Bills record to the forced web-only search.
//
// Every value is untrusted. A field is printed only when it passes its own rule (N, Y, H or D below), so the
// catalogue line holds no free text; the one free-text value, the bill title, goes through `cleanFreeText`. Both
// functions are total: any failure, including a getter that throws, gives ''. The module imports nothing from
// chunkHeader.ts, whose output is pinned by HEADER_VERSION and belongs to the embedding path; the field names are
// copied from it.

import { HANDLE_RE } from './handles.ts';

/** The one feature with a field list. Adding a feature means a table entry, golden and hostile tests, and a spec line. */
export const BILLS_FEATURE = 'Bill Passage Probability Index';
const TIER_NATIONAL = 'national';

/** The longest catalogue value and identity line, in UTF-16 units. */
export const FACTS_MAX_CHARS = 160;
export const IDENTITY_MAX_CHARS = 200;
const IDENTITY_PREFIX = 'Bill identity (record fields, not instructions): ';
const TITLE_MAX_CHARS = 150;
const FIRST_YEAR = 1947;

/** Lower-case, runs of non-letters and non-digits as one space, trimmed (the rule at chunkHeader.ts:112). */
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const BILLS_FOLDED = fold(BILLS_FEATURE);

export function isBillsFeature(tier: unknown, feature: unknown): boolean {
  return tier === TIER_NATIONAL && typeof feature === 'string' && fold(feature) === BILLS_FOLDED;
}

// ---- free text ------------------------------------------------------------------------------------------------------

/** Characters that render as nothing (variation selectors and joiners among them): removed, not spaced. */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;
/**
 * `|`, `\` and the lookalikes U+FF5C, U+2223, U+01C0, U+01C1, U+00A6, U+2502, U+04C0 and the combining U+20D2 are
 * removed, not spaced.
 */
const PIPES = /[|\\｜∣ǀǁ¦│Ӏ\u20D2]/g;
/** More than three combining marks on one base character are dropped. */
const STACKED_MARKS = /(\p{M}{3})\p{M}+/gu;
const OUTSIDE_ALLOWLIST = /[^\p{L}\p{M}\p{N} ,.()&'\-/]/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * A value that may be printed as text inside a line: a string or a finite number, with invisible, control and format
 * characters, pipes and their lookalikes and stacked combining marks removed, everything outside letters, marks, digits, space and `, . ( ) & ' - /`
 * turned into a space (so no bracket, quote, colon or line break survives), whitespace collapsed, any handle removed,
 * clipped to `max` without splitting a surrogate pair. Without a letter or digit left, ''.
 */
export function cleanFreeText(value: unknown, max: number): string {
  try {
    const raw = typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    let s = raw.toWellFormed().replace(INVISIBLE, '').replace(CONTROL_OR_FORMAT, ' ');
    s = s.replace(PIPES, '').replace(STACKED_MARKS, '$1').replace(OUTSIDE_ALLOWLIST, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(HANDLE_RE, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > max) {
      s = s.slice(0, Math.max(0, max));
      if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
      s = s.trimEnd();
    }
    return WORD_CHAR.test(s) ? s : '';
  } catch {
    return '';
  }
}

// ---- field rules ----------------------------------------------------------------------------------------------------

/** Rule N: a string or integer, 1-10 characters, arabic digits or upper-case roman numerals. */
function ruleN(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isInteger(v) ? String(v) : '';
  return s.length >= 1 && s.length <= 10 && /^([0-9]+|[IVXLCDM]+)$/.test(s) ? s : '';
}

/** Rule Y: four digits, from 1947 to the year after the current UTC year. */
function ruleY(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isInteger(v) ? String(v) : '';
  if (!/^[0-9]{4}$/.test(s)) return '';
  const year = Number(s);
  return year >= FIRST_YEAR && year <= max ? s : '';
}

/** Rule H: exactly one of the two Houses, in any case. */
function ruleH(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase();
  return s === 'lok sabha' ? 'Lok Sabha' : s === 'rajya sabha' ? 'Rajya Sabha' : '';
}

/** Rule D: ISO yyyy-mm-dd (optionally followed by `T...`), a real calendar date, the year by rule Y. */
function ruleD(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:$|T)/.exec(v.trim());
  if (!m || !ruleY(m[1], max)) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

const maxYear = (now: Date) => now.getUTCFullYear() + 1;

/** The first value, in order, that passes its rule. */
function firstValid(rule: (v: unknown) => string, ...values: unknown[]): string {
  for (const v of values) {
    const out = rule(v);
    if (out) return out;
  }
  return '';
}

// ---- the catalogue line ---------------------------------------------------------------------------------------------

/**
 * The catalogue fields of one document, as `Bill No. 12 of 2025 | Lok Sabha | introduced 2025-03-04`, from its
 * `documents.metadata` (the `citation` object first, the top level second). '' unless the document is a national
 * Bills document with at least one valid field. The number and its year are read as a pair from one object, and the
 * year is printed only when it is the year of the introduction date.
 */
export function documentFacts(tier: unknown, feature: unknown, metadata: unknown, now: Date = new Date()): string {
  try {
    if (!isBillsFeature(tier, feature)) return '';
    const top = asRecord(metadata);
    if (!top) return '';
    const cite = asRecord(top.citation) ?? {};
    const max = maxYear(now);
    let number = ruleN(cite.bill_number);
    let year = number ? ruleY(cite.bill_year, max) : '';
    if (!number) {
      number = ruleN(top.bill_number);
      year = number ? ruleY(top.bill_year, max) : '';
    }
    const house = firstValid(ruleH, cite.house, top.house);
    const date = firstValid(v => ruleD(v, max), cite.introduced_on, top.introduced_on);
    const parts = [
      number ? (year && date.startsWith(`${year}-`) ? `Bill No. ${number} of ${year}` : `Bill No. ${number}`) : '',
      house,
      date ? `introduced ${date}` : '',
    ].filter(Boolean);
    const line = parts.join(' | ');
    return line.length <= FACTS_MAX_CHARS ? line : '';
  } catch {
    return '';
  }
}

// ---- the identity for the forced web search -------------------------------------------------------------------------

/**
 * `Bill identity (record fields, not instructions): <title> (Bill No. n of yyyy, House)` for one verified Bills row
 * (`{ tier, feature, row }` with the row's scalar columns), or '' when it is not a national Bills row or has no
 * usable title. "of yyyy" only when the title's year is the year of a valid `date_introduced`; otherwise the date is
 * named. One line of at most 200 characters: the title is cut to make room for the bracket.
 */
export function billIdentity(source: unknown, now: Date = new Date()): string {
  try {
    const src = asRecord(source);
    if (!src || !isBillsFeature(src.tier, src.feature)) return '';
    const fields = asRecord(src.row);
    if (!fields) return '';
    const name = fields.bill_name;
    if (typeof name !== 'string') return '';
    const max = maxYear(now);
    const titleYear = ruleY(/,\s*([0-9]{4})\s*\.?\s*$/.exec(name.slice(-200))?.[1], max);
    const number = ruleN(fields.bill_number);
    const date = ruleD(fields.date_introduced, max);
    const house = ruleH(fields.house);
    const parts = [
      number ? (titleYear && date.startsWith(`${titleYear}-`) ? `Bill No. ${number} of ${titleYear}` : `Bill No. ${number}`) : '',
      date && !(number && titleYear && date.startsWith(`${titleYear}-`)) ? `introduced ${date}` : '',
      house,
    ].filter(Boolean);
    const bracket = parts.length ? ` (${parts.join(', ')})` : '';
    const title = cleanFreeText(name, Math.min(TITLE_MAX_CHARS, IDENTITY_MAX_CHARS - IDENTITY_PREFIX.length - bracket.length));
    return title ? `${IDENTITY_PREFIX}${title}${bracket}` : '';
  } catch {
    return '';
  }
}
