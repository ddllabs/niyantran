// The citation ladder's pure half (RAG spec §G). The model cites handles as
// [n]; these functions expand groups, rescue handle tokens left in prose,
// build sources for the ids that resolve, renumber them 1..k and strip
// markers that resolve to nothing. The repair pass (a second model call)
// lives in streaming-research-agent and calls these before and after.
// The marker grammar is mirrored by src/lib/citationMarkers.js; the shared
// fixture src/lib/__fixtures__/citations.json is read by both test suites.

import type { CitationSource, TextCitation } from './citation.types.ts';
import type { Chunk } from './retrieval.ts';

export const MAX_CITATION_ID = 99;
export const MAX_RANGE_SPAN = 5;

/** A bracket whose inside is digits, commas, spaces and dashes, not followed by "(" (a markdown link). */
export const MARKER_RE = /\[([0-9](?:[0-9\s,–-]*[0-9])?)\](?!\()/g;

/**
 * A bracketed token the model invented as a citation. MARKER_RE only matches
 * digits, so anything else the model bracketed was never examined by the ladder
 * and reached the reader verbatim: a real turn rendered
 * `[open-fronts:south-sudan-instability:0]` throughout an answer that resolved
 * no sources at all. The key was not even from the corpus - the app mints its
 * own ids in recordChecklist.js - so no data fix can prevent every source.
 *
 * The shape targeted is an identifier: bracketed, no whitespace, containing a
 * colon, and not a markdown link. Ordinary prose survives - `[sic]`,
 * `[see below]`, `[1]` and `[text](url)` are all untouched.
 */
export const INVENTED_MARKER_RE = /\[[^\]\s]*:[^\]\s]*\](?!\()/g;

/**
 * Remove invented citation markers and tidy the space they leave behind.
 *
 * Text with no invented marker is returned byte for byte. The tidying must not
 * touch an answer it did not change: the repair pass accepts a repair only when
 * nothing but citation markers was inserted, and it compares against this
 * output, so trimming an unrelated trailing space made a valid repair look like
 * a rewrite and the turn logged the repair as an error.
 */
export function stripInventedMarkers(answer: string): string {
  const text = String(answer ?? '');
  INVENTED_MARKER_RE.lastIndex = 0;
  if (!INVENTED_MARKER_RE.test(text)) return text;
  INVENTED_MARKER_RE.lastIndex = 0;
  return text
    .replace(INVENTED_MARKER_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]+$/gm, '');
}


/** Ids named inside one bracket, expanded and validated; [] when any part is invalid. */
export function parseCitationIds(inner: string): number[] {
  const ids: number[] = [];
  for (const part of inner.split(',')) {
    const p = part.trim();
    if (!p) return [];
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(p);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a < 1 || b < a || b > MAX_CITATION_ID || b - a > MAX_RANGE_SPAN) return [];
      for (let i = a; i <= b; i++) ids.push(i);
      continue;
    }
    if (!/^\d+$/.test(p)) return [];
    const n = Number(p);
    if (n < 1 || n > MAX_CITATION_ID) return [];
    ids.push(n);
  }
  return ids;
}

/** [2, 3] and [2-4] become [2][3] and [2][3][4]; invalid brackets are left as text. */
export function expandGroupedCitations(text: string): string {
  return text.replace(MARKER_RE, (whole, inner: string) => {
    const ids = parseCitationIds(inner);
    return ids.length ? ids.map((n) => `[${n}]`).join('') : whole;
  });
}

/** Every valid citation id in the text, in order of first appearance. */
export function citedIds(text: string): number[] {
  const seen: number[] = [];
  for (const m of expandGroupedCitations(text).matchAll(MARKER_RE)) {
    for (const n of parseCitationIds(m[1])) if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** Rescue exact map keys, including legacy short nonces, as [id]. */
export function recoverHandleCitations(answer: string, handles: Record<string, number>): string {
  const keys = Object.keys(handles).sort((a, b) => b.length - a.length);
  let out = answer;
  // A bracket the model filled with handles instead of numbers - `[h1, h2]` -
  // goes as a unit, or rewriting each handle in place would leave the outer
  // brackets stranded around the numbers: `[[1], [2]]`. Only a bracket whose
  // every part is an issued handle is touched, so ordinary prose in brackets
  // and real `[1]` markers are left exactly as they are.
  out = out.replace(/\[([^\]]+)\](?!\()/g, (whole, inner: string) => {
    const parts = inner.split(',').map((p) => p.trim());
    if (!parts.length || parts.some((p) => handles[p] === undefined)) return whole;
    return parts.map((p) => `[${handles[p]}]`).join('');
  });
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match paired brackets as a unit (including claim[handle]), or a bare
    // token with the same identifier boundaries as HANDLE_RE. Never rewrite
    // an issued prefix of a longer/unissued handle or a forged identifier.
    const token = new RegExp(`\\[${escaped}\\]|(?<![\\p{L}\\p{M}\\p{N}_:-])${escaped}(?![\\p{L}\\p{M}\\p{N}_-])`, 'gu');
    out = out.replace(token, `[${handles[key]}]`);
  }
  return out;
}

/** Text sources for the cited ids that resolve to a chunk, in cited order, ids preserved. */
export function buildSources(chunksById: Record<number, Chunk> | Map<number, Chunk>, cited: number[]): TextCitation[] {
  const get = (id: number) => (chunksById instanceof Map ? chunksById.get(id) : chunksById[id]);
  const out: TextCitation[] = [];
  for (const id of cited) {
    const c = get(id);
    if (!c) continue;
    out.push({
      id,
      kind: 'text',
      chunk_id: c.id,
      document_id: c.document_id,
      title: c.title,
      file_name: c.file_name,
      file_url: c.file_url,
      desk_tier: c.desk_tier,
      desk_feature: c.desk_feature,
      char_from: c.char_from,
      char_to: c.char_to,
      text_hash: c.text_hash,
      source_kind: c.source_kind,
      page_number: c.page_number,
    });
  }
  return out;
}

/**
 * Keep only the sources the answer cites and that exist; renumber them 1..k in
 * order of first appearance; rewrite the markers; strip markers that resolve
 * to nothing.
 */
export function renumberCitations(answer: string, sources: CitationSource[]): { answer: string; sources: CitationSource[] } {
  const expanded = expandGroupedCitations(answer);
  const byOld = new Map<number, CitationSource>();
  for (const s of sources) byOld.set(s.id, s);
  const order: number[] = [];
  for (const id of citedIds(expanded)) if (byOld.has(id) && !order.includes(id)) order.push(id);
  const renumber = new Map<number, number>();
  order.forEach((old, i) => renumber.set(old, i + 1));
  const rewritten = expanded.replace(MARKER_RE, (whole, inner: string) => {
    const ids = parseCitationIds(inner);
    if (!ids.length) return whole;
    return ids
      .filter((n) => renumber.has(n))
      .map((n) => `[${renumber.get(n)}]`)
      .join('');
  });
  const next = order.map((old) => ({ ...byOld.get(old)!, id: renumber.get(old)! }) as CitationSource);
  // Numeric markers that resolve to nothing are dropped above. Invented ones are
  // not numeric, so they have to be removed here or they reach the reader.
  const cleaned = stripInventedMarkers(rewritten);
  return { answer: cleaned.replace(/[ \t]+([.,;:])/g, '$1'), sources: next };
}
