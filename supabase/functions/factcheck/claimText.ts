// Text rules for claims: clipping to the column caps, normalisation for de-duplication, the status
// mapping, and the guard that keeps "A said X" out of claim_en (spec L6, G2b defect a).

import type { ClaimKind, ClaimStatus } from './types.ts';

// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]+/g;

/** Plain single-spaced text of at most `max` characters (code points), never splitting a pair. */
export function clip(text: string, max: number): string {
  const clean = text.replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  const points = Array.from(clean);
  return points.length <= max ? clean : points.slice(0, max).join('').trim();
}

/** The last `max` characters (code points) of the cleaned text: the END of a long text is kept. */
export function clipEnd(text: string, max: number): string {
  const points = Array.from(text.replace(CONTROL, '').replace(/\s+/g, ' ').trim());
  return points.length <= max ? points.join('') : points.slice(-max).join('').trim();
}

/** The key two claims are compared by: case, punctuation and spacing do not matter. */
export function normaliseClaim(text: string): string {
  // Digit groups ("20,000") are joined first, so they match "20000".
  // A minus sign before a number is kept ("-5" is not "5"); a hyphen inside a range ("2020-21") is not.
  return text.normalize('NFC').toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(
    /(^|[^\p{L}\p{N}])[-\u2212](?=\d)/gu,
    '$1neg',
  ).replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

export function mapStatus(c: { kind: ClaimKind; checkable: boolean; needs_context: boolean }): ClaimStatus {
  if (c.kind !== 'claim') return 'not_checkable';
  if (c.needs_context) return 'needs_context';
  return c.checkable ? 'pending' : 'not_checkable';
}

const VERBS =
  'said|says|stated|states|claimed|claims|alleged|alleges|announced|declared|told|asserted|asserts|mentioned|reported|reports|added|noted|argued|insisted|stressed|promised|revealed|admitted';
// Verbs that take a clause directly ("Shah said crime fell"); every other speech verb needs "that", so
// "Taliban claimed responsibility" and "Police reported 3 thefts" keep their meaning.
const PLAIN = 'said|says|stated|states';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const upperFirst = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);
const MIN_REST = 8;
// A remainder that starts with one of these leans on the subject that was removed ("Tehran stated that it
// will not bow down" -> "it ..."), so stripping would leave a claim nobody can check: it is left as written.
const PRONOUN =
  /^(?:he|she|it|they|we|i|you|his|her|its|their|our|my|this|that|these|those|him|them)(?![\p{L}\p{N}])/iu;
// Place or occasion between the name and the verb, or between the verb and "that".
const BEFORE_VERB = String.raw`(?:,?\s+(?:at|in|on|during|while|speaking|addressing|after|before)\b[^,]{0,80}?,?)?`;
const AFTER_VERB = String.raw`(?:\s+(?:at|in|on|during|to|while|after|before|about|over)\b[^,]{0,80}?)?`;
const PLACEHOLDER = /^(?:the\s+)?(?:speaker|anchor|host|presenter|unknown|unnamed|narrator)$/iu;

/** A claimant that says nobody in particular: a stripped subject may replace it. */
export const isPlaceholderClaimant = (c: string | null): boolean => c === null || PLACEHOLDER.test(c.trim());

/**
 * Removes a leading "<someone> said (that)" from a claim and returns the text and the subject removed.
 * Recognised:
 *  - the subject is the claimant or the reporter the model itself named ("said"/"stated" with or without
 *    "that", any other speech verb with "that");
 *  - a name-like subject (up to six words, the first capitalised) followed by a speech verb AND "that",
 *    with an optional place or occasion between name and verb or between verb and "that";
 *  - "According to <someone>, ".
 * Never applied when the remainder starts with a pronoun or is under 8 characters. Applied up to three
 * times for nested attributions; the subject returned is the outermost one removed.
 */
export function attribution(
  claim: string,
  claimant: string | null,
  reportedBy: string | null,
): { text: string; subject: string | null } {
  const names = [claimant, reportedBy].filter((n): n is string => !!n && n.trim().length > 0).map((n) =>
    escape(n.trim())
  );
  const known = names.length
    ? new RegExp(
      `^(?:according to\\s+)?(${
        names.join('|')
      })${BEFORE_VERB}\\s*,?\\s+(?:(?:${PLAIN})(?:\\s+that)?|(?:${VERBS})${AFTER_VERB}\\s+that)[,:]?\\s+(.+)$`,
      'iu',
    )
    : null;
  const according = /^according to\s+([^,]{1,80}),\s+(.+)$/iu;
  const generic = new RegExp(
    `^((?:\\p{Lu}[\\p{L}.'\u2019-]*\\s+){0,5}?[\\p{L}.'\u2019-]+)${BEFORE_VERB}\\s+(?:${VERBS})${AFTER_VERB}\\s+that[,:]?\\s+(.+)$`,
    'u',
  );
  let current = claim.trim();
  let subject: string | null = null;
  for (let i = 0; i < 3; i++) {
    const m = known?.exec(current) ?? according.exec(current) ??
      (/^\p{Lu}/u.test(current) ? generic.exec(current) : null);
    const rest = m?.[2]?.trim();
    if (!m || !rest || Array.from(rest).length < MIN_REST || PRONOUN.test(rest)) break;
    subject ??= m[1].trim();
    current = upperFirst(rest);
  }
  return { text: current, subject };
}

export const stripAttribution = (claim: string, claimant: string | null, reportedBy: string | null): string =>
  attribution(claim, claimant, reportedBy).text;
