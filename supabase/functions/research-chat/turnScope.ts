// Current-turn context wins over an earlier conversation subject. Titles are
// search data only; never promote browser attachment text into evidence.
import type { ResearchRequest } from './validate.ts';

export const isContextQuestion = (message: string): boolean =>
  /\b(?:this|that|attached|selected)\b|^try again[.!?\s]*$/i.test(message);

export function presearchFor(request: ResearchRequest, hasHistory: boolean): string | undefined {
  if (request.focus === 'attached' || request.focus === 'selection') {
    const titles = [...new Set(request.attachments.filter(a => a.kind !== 'file').map(a => a.title.trim()).filter(Boolean))];
    const row = request.selection?.row;
    const selected = row && (row.bill_name || row.title || row.name || row.subject);
    const subject = request.focus === 'selection' && selected ? selected : titles.length === 1 ? titles[0] : undefined;
    if (subject && isContextQuestion(request.message)) {
      return `${subject} — ${request.message}`.slice(0, 300);
    }
  }
  return hasHistory ? undefined : request.message;
}

/** Only an unambiguous request for row metadata skips the missing-document web fallback.
 * Compound/detail questions stay eligible; small talk and explicit off are gated by caller. */
export function requiresWebContext(message: string): boolean {
  if (/\b(?:why|how|implications?|provisions?|details?|explain|impact|background|amendments?)\b/i.test(message)) return true;
  return !/\b(?:house|introduc(?:ed|tion)|sector|stage|status|bill (?:number|name)|date|ministry)\b/i.test(message);
}
