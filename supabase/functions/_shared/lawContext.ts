// Read-time source context only: never classify a speaker or rewrite a chunk.
import type { Chunk } from './retrieval.ts';

export interface LawContextRow {
  id: string;
  document_id: string;
  chunk_index: number;
  char_from: number;
  char_to: number;
  content: string;
}
export const LAW_CONTEXT_CHUNKS = 256;

export async function hydrateLawContext(
  chunks: Chunk[], read: (id: string) => Promise<LawContextRow[]>,
): Promise<Chunk[]> {
  const contexts = new Map<string, NonNullable<Chunk['preceding_heading']>>();
  const ids = [...new Set(chunks.filter(c => c.desk_tier === 'law').map(c => c.document_id))].slice(0, 4);
  for (const id of ids) {
    let rows: LawContextRow[];
    try { rows = await read(id); } catch { continue; }
    if (!rows.length || rows.length > LAW_CONTEXT_CHUNKS || rows.reduce((n,r)=>n + (typeof r.content === 'string' ? r.content.length : 300001),0) > 300000) continue;
    rows = [...rows].sort((a,b)=>a.chunk_index-b.chunk_index);
    if (rows.some((r,i)=>r.document_id !== id || r.chunk_index !== i || !r.id || typeof r.content !== 'string' ||
      !Number.isSafeInteger(r.char_from) || !Number.isSafeInteger(r.char_to) || r.char_from < 0 || r.char_to <= r.char_from ||
      (i > 0 && r.char_from < rows[i-1].char_from))) continue;
    const headings: { text: string; chunkId: string; charFrom: number; recognized: boolean }[] = [];
    for (const row of rows) {
      // Conservative typography only, quoted literally. Never infer a speaker
      // from a decimal paragraph number or label a passage as a judicial finding.
      for (const match of row.content.matchAll(/(?:^|[\n\f])([ \t]*\d{1,2}[.)][ \t]+[^\r\n\f]{1,160})(?=\r?$|[\n\f])/gm)) {
        const text = match[1].trim();
        const charFrom = row.char_from + match.index! + match[0].indexOf(match[1]) + match[1].indexOf(text);
        const recognized = /^\d{1,2}[.)][ \t]+[A-Z][A-Z \t/&()'-]{3,120}$/.test(text);
        headings.push({ text, chunkId: row.id, charFrom, recognized });
      }
    }
    for (const hit of chunks.filter(c=>c.desk_tier === 'law' && c.document_id === id)) {
      const same = rows[hit.chunk_index];
      if (!same || same.id !== hit.id || same.content !== hit.content || same.char_from !== hit.char_from || same.char_to !== hit.char_to) continue;
      const preceding = headings.filter(h=>h.charFrom < hit.char_from).sort((a,b)=>b.charFrom-a.charFrom)[0];
      if (preceding?.recognized) contexts.set(hit.id,{text:preceding.text,chunkId:preceding.chunkId,charFrom:preceding.charFrom});
    }
  }
  return chunks.map(c=>{
    const { preceding_heading: _untrusted, ...rest } = c;
    const heading = contexts.get(c.id);
    return { ...rest, ...(heading ? { preceding_heading: heading } : {}) };
  });
}
