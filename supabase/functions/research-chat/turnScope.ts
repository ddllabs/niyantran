// Current-turn context wins over an earlier conversation subject. Titles are
// search data only; never promote browser attachment text into evidence.
import type { ResearchRequest } from './validate.ts';

export const isContextQuestion = (message: string): boolean =>
  /\b(?:this|that|attached|selected)\b|^try again[.!?\s]*$/i.test(message);

export interface VerifiedSubjects {
  selection?: Record<string, string>;
  attachments: Record<string, string>[];
}

/** Subject precedes person name: a parliamentary member is not the question. */
export function verifiedSubject(row: Record<string, string>): string | undefined {
  return ['bill_name', 'subject', 'title', 'case_title', 'name'].map(key => row[key]?.trim()).find(Boolean);
}

export function presearchFor(request: ResearchRequest, hasHistory: boolean, verified: VerifiedSubjects = { attachments: [] }): string | undefined {
  if (request.focus === 'attached' || request.focus === 'selection') {
    const titles = [...new Set(verified.attachments.map(verifiedSubject).filter(Boolean))];
    const selected = verified.selection && verifiedSubject(verified.selection);
    const subject = request.focus === 'selection' && selected ? selected : titles.length === 1 ? titles[0] : titles.length === 0 ? selected : undefined;
    const law = request.desk_context?.tier === 'law' || request.selection?.tier === 'law' || request.attachments.some(a => a.tier === 'law');
    if (subject && (isContextQuestion(request.message) || law)) {
      return `${subject} — ${request.message}`.slice(0, 300);
    }
  }
  if (request.desk_context?.tier === 'law' || request.selection?.tier === 'law' || request.attachments.some(a => a.tier === 'law')) return request.message;
  return hasHistory ? undefined : request.message;
}

/** Only an unambiguous request for row metadata skips the missing-document web fallback.
 * Compound/detail questions stay eligible; small talk and explicit off are gated by caller. */
export function requiresWebContext(message: string): boolean {
  if (/\b(?:why|how|implications?|provisions?|details?|explain|impact|background|amendments?)\b/i.test(message)) return true;
  return !/\b(?:house|introduc(?:ed|tion)|sector|stage|status|bill (?:number|name)|date|ministry)\b/i.test(message);
}
