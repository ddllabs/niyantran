// Source-only context for existing OCR. No inferred page coordinates or margin
// notes: uncertain layout stays ordinary text. Versions 2 and 3 remain unchanged.
import { CHUNK, blocks, tableHeaderPrefix, chunkUnit, estimateTokens, type ChunkRow, type PageSection } from './chunking.ts';
import { normalise, sha256Hex } from './textNormalise.ts';

export const TEXT_CONTEXT_VERSION = 4;
export interface ContextChunk extends ChunkRow {
  section: PageSection;
  embedding_input: string;
  embed_hash: string;
}
interface Region { from: number; section: PageSection }
const bounded = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Explicit source markers only. Clause numbers are copied, not named from a TOC. */
function regions(text: string): Region[] {
  const out: Region[] = [{ from: 0, section: {} }];
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(m => m[0].length);
  let toc = false;
  let enacted = false;
  let section: PageSection = {};
  const markdown: string[] = [];
  const add = (from: number, next: PageSection) => {
    section = next;
    if (out.at(-1)!.from === from) out[out.length - 1] = { from, section: { ...next } };
    else out.push({ from, section: { ...next } });
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i][0].replace(/\n$/, '');
    const line = raw.trim();
    const from = lines[i].index;
    if (/^(?:ARRANGEMENT OF (?:CLAUSES|SECTIONS)|TABLE OF CONTENTS|CONTENTS)$/i.test(line)) {
      toc = true;
      enacted = false;
      markdown.length = 0;
      add(from, {});
      continue;
    }
    if (/\bBE\s+it\s+enacted\b/i.test(line)) {
      toc = false;
      enacted = true;
      add(from, {});
      continue;
    }
    if (toc) continue;
    const md = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (md) {
      markdown.length = md[1].length - 1;
      markdown.push(bounded(md[2]));
      add(from, { heading: bounded(markdown.filter(Boolean).join(' › ')) });
      continue;
    }
    if (/^(?:CHAPTER|PART)\s+(?:[IVXLCDM]+|\d+)(?:\s*[-—:]\s*[^\n]+)?$/.test(line)) {
      // A following uppercase title is usable only when it is close and clearly
      // a title, rather than a clause, page number, header, or running prose.
      let title = '';
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const candidate = lines[j][0].trim();
        if (!candidate) continue;
        if (/^[A-Z][A-Z ,&()’'\-–—]+$/.test(candidate) && candidate.length <= 160 && !/^(?:CLAUSES|SECTIONS|BILL)$/.test(candidate)) title = candidate;
        break;
      }
      markdown.length = 0;
      add(from, { heading: bounded(title ? line + ' › ' + title : line) });
      continue;
    }
    if (/^EXTRACTS FROM\b/.test(line) && line.length <= 200 && line === line.toUpperCase()) {
      enacted = false;
      markdown.length = 0;
      add(from, { heading: bounded(line) });
      continue;
    }
    if (/^[“"']?(?:(?:THE\s+)?(?:(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\s+)?SCHEDULE(?:\s+[IVXLCDM\d]+)?|ANNEXURE(?:\s+[A-ZIVXLCDM\d]+)?|STATEMENT OF OBJECTS AND REASONS|FINANCIAL MEMORANDUM|MEMORANDUM REGARDING DELEGATED LEGISLATION)\.?$/.test(line)) {
      enacted = false;
      markdown.length = 0;
      add(from, { heading: bounded(line) });
      continue;
    }
    if (enacted) {
      // Left-margin labels occur before the numbered clause, separated by layout
      // whitespace. Require that form, or a line-leading number, never a number
      // inside a sentence. Subclauses `(1)` and years are not clause markers.
      const clause = /^(?:([A-Za-z][A-Za-z .,()’'\-]{0,80}?)\s{2,})?\s*(\d{1,3}\.)\s+(?=[A-Z(“"'])/.exec(raw);
      if (clause) add(from, { ...(section.heading ? { heading: section.heading } : {}), note: bounded([clause[1], clause[2]].filter(Boolean).join(' › ')) });
    }
  }
  return out;
}

/** Pack within each detected section, retaining exact global source offsets. */
export async function chunkTextWithContext(text: string): Promise<ContextChunk[]> {
  const boundaries = regions(text);
  const rows: ContextChunk[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const { from, section } = boundaries[i];
    const to = boundaries[i + 1]?.from ?? text.length;
    const regionText = text.slice(from, to);
    const tables = blocks(regionText).filter(b => b.kind === 'table');
    const spans = chunkUnit({ unitKey: 'document', sourceKind: 'document', text: regionText }, {}, { atomicPlaceholders: true, wordBoundaries: true });
    // Keep a short opening label with its following paragraph when size permits.
    // This never crosses a detected section boundary or changes source bytes.
    for (let j = 0; j + 1 < spans.length; j++) {
      const a = spans[j], b = spans[j + 1];
      if (a.content.length < CHUNK.minChars && b.charTo - a.charFrom <= CHUNK.maxChars) {
        a.charTo = b.charTo;
        a.content = regionText.slice(a.charFrom, a.charTo);
        spans.splice(j + 1, 1);
        j--;
      }
    }
    const prefix = [section.heading, section.note].filter(Boolean).join(' › ');
    for (const s of spans) {
      const embedding_input = (prefix ? prefix + '\n\n' : '') + tableHeaderPrefix(regionText, tables, s.charFrom) + s.content;
      const embed_hash = await sha256Hex(normalise(embedding_input));
      rows.push({
        ...s, charFrom: from + s.charFrom, charTo: from + s.charTo,
        chunkIndex: rows.length,
        // Context changes invalidate reuse, even for identical continuation text.
        chunkHash: await sha256Hex(`${TEXT_CONTEXT_VERSION}|document|${embed_hash}`),
        tokenEstimate: estimateTokens(embedding_input), section: { ...section },
        embedding_input, embed_hash,
      });
    }
  }
  return rows;
}
