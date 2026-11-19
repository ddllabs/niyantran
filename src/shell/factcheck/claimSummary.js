// B3: the numbers behind the Summary tab. Made only from the claims the panel already holds, with the same
// "newest result" rule as the cards and the verdict tiles. No request, no model.
import { FILTER_KEYS, badgeOf } from './claimFilter.js';

const ATTENTION = ['contradicted', 'partly_true'];

/** { total, verdicts, withVerdict, notCheckable, notChecked, checking, needsContext, failed, noSources, attention }. */
export function summarizeClaims(claims, ctx) {
  const s = {
    total: claims.length, verdicts: Object.fromEntries(FILTER_KEYS.map((k) => [k, 0])), withVerdict: 0,
    notCheckable: 0, notChecked: 0, checking: 0, needsContext: 0, failed: 0, noSources: 0, attention: [],
  };
  const flagged = [];
  for (const claim of claims) {
    const badge = badgeOf(claim, ctx);
    if (Object.hasOwn(s.verdicts, badge.key)) {
      s.verdicts[badge.key] += 1;
      s.withVerdict += 1;
      if (ATTENTION.includes(badge.key)) flagged.push({ claim, badge });
    } else if (badge.key === 'not_checkable') s.notCheckable += 1;
    else if (badge.key === 'unchecked') s.notChecked += 1;
    else if (badge.key === 'pending') s.checking += 1;
    else if (badge.key === 'needs_context') s.needsContext += 1;
    else if (badge.key === 'no_sources') s.noSources += 1;
    else s.failed += 1;
  }
  s.attention = ATTENTION.flatMap((key) => flagged.filter((f) => f.badge.key === key));
  return s;
}

/** "14 claims in this session: 9 with a verdict, 3 not checkable, 2 not checked"; empty counts are left out. */
export function summarySentence(s) {
  if (s.total === 0) return 'No claims yet.';
  const parts = [
    [s.withVerdict, 'with a verdict'], [s.notCheckable, 'not checkable'], [s.notChecked, 'not checked'], [s.checking, 'being checked'],
    [s.needsContext, 'needing context'], [s.failed, 'failed'], [s.noSources, 'without a source'],
  ].filter(([n]) => n > 0).map(([n, text]) => `${n} ${text}`);
  return `${s.total} ${s.total === 1 ? 'claim' : 'claims'} in this session: ${parts.join(', ')}`;
}
