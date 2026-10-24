// Read-time source context only: never classify a speaker or rewrite a chunk.
import { type Chunk, rowToChunk } from './retrieval.ts';

export interface LawContextRow {
  id: string;
  document_id: string;
  chunk_index: number;
  char_from: number;
  char_to: number;
  content: string;
  source_kind?: string;
  page_number?: number | null;
  block_ids?: string[] | null;
  image_ids?: string[] | null;
}
export const LAW_CONTEXT_CHUNKS = 256;

export async function hydrateLawContext(
  chunks: Chunk[], read: (id: string) => Promise<LawContextRow[]>,
): Promise<Chunk[]> {
  const enriched = [...chunks];
  const finalPassages = new Set<string>();
  const trails = new Map<string, NonNullable<Chunk['heading_context']>>();
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
    const verified = chunks.filter(c => c.desk_tier === 'law' && c.document_id === id &&
      rows[c.chunk_index]?.id === c.id && rows[c.chunk_index].content === c.content &&
      rows[c.chunk_index].char_from === c.char_from && rows[c.chunk_index].char_to === c.char_to);
    if (!verified.length) continue;
    // Fewer rows than the requested prefix limit proves this authorized read
    // reached the end. These are original chunks, not an inferred operative order.
    if (rows.length < LAW_CONTEXT_CHUNKS) {
      const exemplar = verified[0];
      for (const row of rows.slice(-2)) {
        finalPassages.add(row.id);
        if (enriched.some(c => c.id === row.id)) continue;
        enriched.push(await rowToChunk({ ...row, title: exemplar.title, file_name: exemplar.file_name,
          file_url: exemplar.file_url, desk_tier: exemplar.desk_tier, desk_feature: exemplar.desk_feature,
          document_role: exemplar.document_role }));
      }
    }
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
    for (const hit of enriched.filter(c=>c.desk_tier === 'law' && c.document_id === id)) {
      const same = rows[hit.chunk_index];
      if (!same || same.id !== hit.id || same.content !== hit.content || same.char_from !== hit.char_from || same.char_to !== hit.char_to) continue;
      const preceding = headings.filter(h=>h.charFrom < hit.char_from).sort((a,b)=>b.charFrom-a.charFrom)[0];
      const before = headings.filter(h=>h.charFrom < hit.char_from).sort((a,b)=>a.charFrom-b.charFrom);
      const anchor = before.findLastIndex(h=>h.recognized);
      const trail = before.slice(anchor);
      // Preserve ambiguous intervening source lines, never silently inherit a stale speaker.
      if (anchor >= 0 && trail.length > 1 && trail.length <= 8) trails.set(hit.id, trail.map(({text,chunkId,charFrom})=>({text,chunkId,charFrom})));
      if (preceding?.recognized) contexts.set(hit.id,{text:preceding.text,chunkId:preceding.chunkId,charFrom:preceding.charFrom});
    }
  }
  // Preserve the best relevance hit, then complete-document endings before lower-ranked hits.
  const ordered = enriched.length ? [enriched[0], ...enriched.slice(1).filter(c=>finalPassages.has(c.id)), ...enriched.slice(1).filter(c=>!finalPassages.has(c.id))] : [];
  return ordered.map(c=>{
    const { preceding_heading: _untrusted, heading_context: _untrustedTrail, ...rest } = c;
    const heading = contexts.get(c.id);
    return { ...rest, ...(heading ? { preceding_heading: heading } : {}), ...(trails.has(c.id) ? {heading_context: trails.get(c.id)} : {}) };
  });
}

/** Literal source context for both retrieval and final synthesis, never a role classifier. */
export function lawAttributionContext(c: Chunk): string {
  if (c.heading_context?.length) return `Earlier uppercase numbered heading followed by intervening numbered source lines, in source order: ${JSON.stringify(c.heading_context.map(h=>h.text))}. These lines may be quoted precedent or a new section; establish the speaker from original wording and paragraph continuity. Do not assume the earlier heading still governs.`;
  if (c.preceding_heading) return `Nearest recognized heading: ${JSON.stringify(c.preceding_heading.text)}. Positional context does not by itself establish the governing speaker; intervening unnumbered headings may exist. Reported speech controls the speaker.`;
  return 'Governing heading unavailable; establish speaker from the original wording or state uncertainty.';
}
