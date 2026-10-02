// research-coverage fix B (docs/specs/2026-10-02-research-coverage.md): signals that a draft
// stopped digging too early, read from the draft and the passages the turn retrieved. No model
// call: the agent sends the model back once with digNudge's message when one holds.
import { handlesIn } from '../_shared/handles.ts';
import type { Chunk } from '../_shared/retrieval.ts';

/** At most this many provisions are named in one nudge. */
export const DIG_REFERENCES = 4;

const ORDINAL = '(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)';
/** "section 12", "sections 5", "clause 7", "the Schedule", "the Second Schedule". */
const REFERENCE = new RegExp(`\\b(?:(section|clause)s?\\s+(\\d{1,3}[A-Z]?)\\b|(the\\s+(?:${ORDINAL}\\s+)?Schedule)\\b)`, 'gi');
/** Another law named later in the same clause: "of the Indian Penal Code", "to the Code of Civil
 * Procedure", "of the principal Act", "and clause (e) of section 12AA of the Essential Commodities
 * Act". "of this Act" stays our own. */
const ELSEWHERE = /^[^.;\n]{0,160}?\b(?:of|to|under)\s+(?:the\s+)?(?!this\b)[^.;\n]{0,80}?\b(?:Act|Code|Constitution|Ordinance|Rules|Regulations)\b/i;
/** Not a reference to follow: a summary's source note "(Section 8)", a Schedule heading's "(See
 * sections 2 and 3)", or "a new section 35AD" that an amendment inserts into another Act. */
const NOT_FOLLOWED = /(?:\(\s*|\bsee\s+|\bnew\s+)$/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether one of these passages begins the provision: a line opening "12." or a Schedule heading. */
function begun(passages: Chunk[], label: string): boolean {
  const schedule = /^the\s+(?:(\w+)\s+)?schedule$/i.exec(label);
  const start = schedule
    ? new RegExp(`(?:^|\\n)\\s*#*\\s*(?:THE\\s+)?${schedule[1] ? escape(schedule[1]) + '\\s+' : `(?:${ORDINAL}\\s+)?`}SCHEDULE\\s*(?:\\n|\\(|$)`, 'i')
    : new RegExp(`(?:^|\\n)\\s*#*\\s*${escape(label.split(' ')[1])}\\.\\s`);
  return passages.some((p) => start.test(p.content));
}

/**
 * S1: provisions of their own document that the cited passages name but no retrieved passage of
 * that document begins, in the order cited. References to other laws are not ours to follow.
 */
export function unfollowedReferences(cited: Chunk[], retrieved: Chunk[]): string[] {
  const out: string[] = [];
  for (const passage of cited) {
    const own = [passage, ...retrieved.filter((r) => r.document_id === passage.document_id)];
    for (const m of passage.content.matchAll(REFERENCE)) {
      if (NOT_FOLLOWED.test(passage.content.slice(Math.max(0, m.index! - 6), m.index))) continue;
      if (ELSEWHERE.test(passage.content.slice(m.index! + m[0].length))) continue;
      // "THE SECOND SCHEDULE" and "the second Schedule" both read "the Second Schedule".
      const label = m[3]
        ? ['the', ...m[3].split(/\s+/).slice(1).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())].join(' ')
        : `${m[1].toLowerCase()} ${m[2]}`;
      if (out.includes(label) || begun(own, label)) continue;
      out.push(label);
      if (out.length === DIG_REFERENCES) return out;
    }
  }
  return out;
}

/** S2: the draft says "Not in record." after fewer than two searches. */
export function gaveUpEarly(draft: string, searches: number): boolean {
  return searches < 2 && /Not in record\./i.test(draft);
}

const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** The message that sends the model back, or null when no signal holds. */
export function digNudge(draft: string, chunks: Chunk[], searches: number, lookup: (handle: string) => string | undefined): string | null {
  const citedIds = new Set(handlesIn(draft).map(lookup).filter((k): k is string => !!k));
  const refs = unfollowedReferences(chunks.filter((c) => citedIds.has(c.id)), chunks);
  const early = gaveUpEarly(draft, searches);
  if (!refs.length && !early) return null;
  const parts = ['Before you answer:'];
  if (refs.length) {
    parts.push(`the passages you cite refer to ${list(refs)} of the same document, which you have not retrieved. Search for ${refs.length === 1 ? 'it' : 'them'}, with the query phrased as the provision itself would read. If they are not needed for this question, answer now.`);
  }
  if (early) {
    parts.push(`you marked a point **Not in record.** after a single search. Search again for that point with a different query, phrased as the document would phrase it, before deciding it is not in the record.`);
  }
  return parts.join(' ');
}
