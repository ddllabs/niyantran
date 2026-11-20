// F366 slice B: pure helpers for the Claims tab and the latest-claim strip. Nothing here touches React.
import { claimBadge } from './factCheckText.js';

/** The five verdict filters, in the order the count tiles are drawn. */
export const FILTER_KEYS = ['supported', 'contradicted', 'partly_true', 'no_evidence', 'opinion'];

/**
 * The result a card shows for a claim. With a re-check price and earlier results, that is the newest result
 * (the panel keeps them newest first); otherwise the claim itself. The card, the filter and the strip all
 * use this one rule.
 */
export function shownResult(claim, recheck, priced) {
  return priced && recheck?.results?.length ? recheck.results[0] : claim;
}

/** `ctx` is { rechecks: view.rechecks, price: view.flag.recheckCredits } as the panel reads them. */
export function badgeOf(claim, ctx) {
  const priced = typeof ctx?.price === 'number';
  return claimBadge(shownResult(claim, ctx?.rechecks?.[claim.id], priced));
}

/** { supported: n, ... } for the five verdicts; a claim with no verdict is in none of them. */
export function verdictCounts(claims, ctx) {
  const counts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0]));
  for (const c of claims) {
    const key = badgeOf(c, ctx).key;
    if (Object.hasOwn(counts, key)) counts[key] += 1;
  }
  return counts;
}

/** With no filter on every claim; otherwise only those whose verdict is among `active`. */
export function filterClaims(claims, active, ctx) {
  if (!active || active.length === 0) return claims;
  return claims.filter((c) => active.includes(badgeOf(c, ctx).key));
}

/** The newest claim (last in the list) that has a verdict: { claim, badge }, or null. */
export function latestVerdictClaim(claims, ctx) {
  for (let i = claims.length - 1; i >= 0; i -= 1) {
    const badge = badgeOf(claims[i], ctx);
    if (FILTER_KEYS.includes(badge.key)) return { claim: claims[i], badge };
  }
  return null;
}
