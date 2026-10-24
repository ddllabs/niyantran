import { lawAttributionContext } from '../_shared/lawContext.ts';
import type { EvidenceMap } from './sources.ts';

export interface LawPassage {
  id: string;
  sources: string[];
  text: string;
  context: string;
  section?: string;
  title: string;
  documentId: string;
}
interface Span { source: string; start: number; text: string }
interface Unit { spans: Span[]; opening?: number; section?: string; context: string; title: string; documentId: string }

/** Read-time units only. Storage chunks and citation handles are never rewritten. */
export function lawReviewEvidence(evidence: EvidenceMap, limit = 80_000): LawPassage[] {
  const units = new Map<string, Unit>();
  const structured = new Set([...evidence.values()].filter(e => e.kind === 'text' && e.chunk.desk_tier === 'law' && /(?:^|[\n\f])[ \t]*\d{1,2}\.\d{1,3}[ \t]/.test(e.chunk.content)).map(e => e.kind === 'text' ? e.chunk.document_id : ''));
  for (const [source, e] of evidence) {
    if (e.kind !== 'text') continue;
    const c = e.chunk, documentId = c.document_id ?? '';
    const starts = c.desk_tier === 'law' && Number.isSafeInteger(c.char_from)
      ? [...c.content.matchAll(/(?:^|[\n\f])([ \t]*\d{1,2}\.\d{1,3}[ \t]+[^\r\n\f])/g)]
        .map(m => m.index! + m[0].indexOf(m[1]) + m[1].search(/\S/))
        .filter(start => {
          const prefix = c.content.slice(0,start);
          const open = prefix.lastIndexOf('“'), close = prefix.lastIndexOf('”');
          return !(open > close && c.content.indexOf('”',start) >= 0);
        }) : [];
    const boundaries = [...new Set([0, ...starts, c.content.length])];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i], text = c.content.slice(start, boundaries[i + 1]);
      if (!text.trim()) continue;
      const begins = starts.includes(start);
      const opening = begins ? c.char_from + start : c.paragraph_context?.charFrom;
      if (opening === undefined && structured.has(documentId)) continue;
      const key = opening === undefined ? source : `${documentId}:paragraph:${opening}`;
      let unit = units.get(key);
      const context = lawAttributionContext(begins ? { ...c, paragraph_context: undefined } : c);
      if (!unit) {
        unit = { spans: [], opening, context, title: (c.title ?? '').slice(0,300), documentId };
        units.set(key, unit);
      }
      // The opening's context takes precedence over a later continuation's context.
      if (begins) {
        unit.context = context;
        const number = text.match(/^(\d{1,2})\./)?.[1];
        const headings = [...(c.heading_context ?? []), ...(c.preceding_heading ? [c.preceding_heading] : [])];
        const matching = headings.findLast(h => h.text.match(/^(\d{1,2})[.)]\s/)?.[1] === number);
        // Literal numbering/heading association, not a generated speaker label.
        if (matching) unit.section = matching.text;
      }
      unit.spans.push({source, start: Number.isSafeInteger(c.char_from) ? c.char_from + start : 0, text});
    }
  }
  const out: LawPassage[] = []; let used = 0;
  for (const unit of units.values()) {
    const spans = unit.spans.sort((a,b)=>a.start-b.start);
    // Never publish an orphaned continuation as a selectable paragraph.
    if (unit.opening !== undefined && spans[0].start !== unit.opening) continue;
    const sources = [...new Set(spans.map(s=>s.source))];
    if (sources.length > 8) continue;
    let end = -1, text = '', conflict = false;
    const contributing = new Set<string>();
    for (const span of spans) {
      const skip = Math.max(0, end - span.start);
      if (skip > 0) {
        for (const previous of spans) {
          if (previous === span || previous.start > span.start) continue;
          const overlap = Math.min(previous.start + previous.text.length - span.start, span.text.length);
          if (overlap > 0 && previous.text.slice(span.start-previous.start,span.start-previous.start+overlap) !== span.text.slice(0,overlap)) { conflict = true; break; }
        }
        if (conflict) break;
      }
      if (skip >= span.text.length) continue;
      contributing.add(span.source);
      if (end >= 0 && span.start > end) text += '\n[Gap between supplied original spans]\n';
      text += span.text.slice(skip); end = span.start + span.text.length;
    }
    if (conflict || (unit.opening !== undefined && text.length > 12000)) continue;
    const size = text.length + unit.context.length + unit.title.length + unit.documentId.length + sources.join('').length + 100;
    if (used + size > limit) continue;
    used += size;
    out.push({id:`p${out.length+1}`,sources:sources.filter(source=>contributing.has(source)),text,context:unit.context,...(unit.section ? {section:unit.section} : {}),title:unit.title,documentId:unit.documentId});
  }
  return out;
}
