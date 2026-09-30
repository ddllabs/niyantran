// The citation ladder's pure half (RAG spec §G). The model cites handles as
// [n]; these functions expand groups, rescue handle tokens left in prose,
// build sources for the ids that resolve, renumber them 1..k and strip
// markers that resolve to nothing. The repair pass (a second model call)
// lives in streaming-research-agent and calls these before and after.
// The marker grammar is mirrored by src/lib/citationMarkers.js; the shared
// fixture src/lib/__fixtures__/citations.json is read by both test suites.

import type { CitationBox, CitationImage, CitationSource, TextCitation } from './citation.types.ts';
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

/** At most this many boxes on one citation (chunk-contract spec, "Citation payload"). */
export const MAX_CITATION_BOXES = 20;

/** document_page_blocks as the handler's one evidence read returns it. Untrusted in shape: every field is checked. */
export interface PageBlockRow {
  id: string;
  document_id: string;
  extract_hash: string;
  page_number: number;
  x0: number | null;
  y0: number | null;
  x1: number | null;
  y1: number | null;
}

/** document_page_images as the evidence read returns it. The storage path is never read. */
export interface PageImageRow {
  id: string;
  document_id: string;
  extract_hash: string;
  page_number: number;
  sha256: string;
  mime: string;
}

export interface PageEvidenceRows {
  blocks: PageBlockRow[];
  images: PageImageRow[];
}

/**
 * Boxes, images and the extraction for each cited chunk, keyed by chunk id,
 * prepared by the handler's async step so the ladder can stay pure. A chunk
 * with nothing to show has no entry.
 */
export interface PageEvidence {
  boxesByChunk: Map<string, CitationBox[]>;
  imagesByChunk: Map<string, CitationImage[]>;
  extractHashByChunk: Map<string, string>;
}

/**
 * The block and image ids to read for these (cited) chunks: distinct, in
 * order. Each chunk contributes at most twice MAX_CITATION_BOXES block ids. A
 * chunk never crosses a page and a box is null exactly when its page has no
 * dimensions, so its blocks are boxed all or none; the headroom is for rows
 * that no longer exist.
 */
export function citedPageRefs(chunks: Chunk[]): { blockIds: string[]; imageIds: string[] } {
  const blocks = new Set<string>();
  const images = new Set<string>();
  for (const c of chunks) {
    for (const id of (c.block_ids ?? []).slice(0, MAX_CITATION_BOXES * 2)) blocks.add(id);
    for (const id of c.image_ids ?? []) images.add(id);
  }
  return { blockIds: [...blocks], imageIds: [...images] };
}

const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const pageOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Map the evidence rows onto the chunks that link them. Boxes follow the
 * chunk's block_ids order, skip a block with a null or malformed box, and stop
 * at MAX_CITATION_BOXES. A row of another document is ignored. extract_hash is
 * the extraction the boxes came from (only boxes of that one extraction are
 * kept), or, with no box, the images'. Images are content-addressed and kept
 * whatever their extraction.
 */
export function pageEvidenceMaps(chunks: Chunk[], rows: PageEvidenceRows): PageEvidence {
  const blocks = new Map<string, PageBlockRow>();
  for (const b of rows.blocks ?? []) if (b && text(b.id)) blocks.set(b.id, b);
  const images = new Map<string, PageImageRow>();
  for (const i of rows.images ?? []) if (i && text(i.id)) images.set(i.id, i);
  const out: PageEvidence = { boxesByChunk: new Map(), imagesByChunk: new Map(), extractHashByChunk: new Map() };
  for (const c of chunks) {
    let hash: string | undefined;
    const boxes: CitationBox[] = [];
    for (const id of c.block_ids ?? []) {
      if (boxes.length >= MAX_CITATION_BOXES) break;
      const b = blocks.get(id);
      const page = pageOf(b?.page_number);
      if (!b || b.document_id !== c.document_id || !text(b.extract_hash) || page === null) continue;
      if (!unit(b.x0) || !unit(b.y0) || !unit(b.x1) || !unit(b.y1) || b.x0 > b.x1 || b.y0 > b.y1) continue;
      if (hash !== undefined && b.extract_hash !== hash) continue;
      hash = b.extract_hash;
      boxes.push({ page, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
    }
    const imgs: CitationImage[] = [];
    let imageHash: string | undefined;
    for (const id of c.image_ids ?? []) {
      const i = images.get(id);
      const page = pageOf(i?.page_number);
      if (!i || i.document_id !== c.document_id || page === null || !text(i.sha256) || !text(i.mime)) continue;
      imageHash ??= text(i.extract_hash) ? i.extract_hash : undefined;
      imgs.push({ page, sha256: i.sha256, mime: i.mime });
    }
    if (boxes.length) out.boxesByChunk.set(c.id, boxes);
    if (imgs.length) out.imagesByChunk.set(c.id, imgs);
    const extract = hash ?? (imgs.length ? imageHash : undefined);
    if (extract) out.extractHashByChunk.set(c.id, extract);
  }
  return out;
}

/**
 * One chunk as a text citation. An old chunk (no section, no page evidence)
 * gives exactly the pre-contract shape: the optional page fields are added as
 * keys only when they have a value.
 */
export function textCitation(id: number, c: Chunk, page?: PageEvidence): TextCitation {
  const out: TextCitation = {
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
  };
  const extract = page?.extractHashByChunk.get(c.id);
  const boxes = page?.boxesByChunk.get(c.id);
  const images = page?.imagesByChunk.get(c.id);
  if (extract) out.extract_hash = extract;
  if (boxes?.length) out.boxes = boxes.slice(0, MAX_CITATION_BOXES).map((b) => ({ ...b }));
  if (images?.length) out.images = images.map((i) => ({ ...i }));
  if (c.section) out.section = { ...c.section };
  return out;
}

/** Text sources for the cited ids that resolve to a chunk, in cited order, ids preserved. */
export function buildSources(
  chunksById: Record<number, Chunk> | Map<number, Chunk>,
  cited: number[],
  page?: PageEvidence,
): TextCitation[] {
  const get = (id: number) => (chunksById instanceof Map ? chunksById.get(id) : chunksById[id]);
  const out: TextCitation[] = [];
  for (const id of cited) {
    const c = get(id);
    if (c) out.push(textCitation(id, c, page));
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
