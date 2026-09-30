// The chunker. Pure, no I/O. Order: heading → table → paragraph → sentence →
// character. Two invariants (RAG spec §B):
//   one unit  — a span is cut from exactly one ChunkUnit; chunkUnit takes one
//               unit, so a span cannot straddle two;
//   exact span — content === unit.text.slice(charFrom, charTo), untrimmed.
// The hash folds whitespace so an OCR re-run that changes only spacing keeps
// every embedding; CHUNK.version participates so a chunker change re-embeds.

import { normalise, sha256Hex } from './textNormalise.ts';
import { type ComposedDocument, isMarginNote, locateBlocks, type MistralPage } from './pageText.ts';

export interface ChunkOptions {
  targetChars: number;
  overlapChars: number;
  minChars: number;
  tableAtomicMax: number;
  maxChars: number;
  version: number;
}

export const CHUNK: Readonly<ChunkOptions> = Object.freeze({
  targetChars: 1000,
  overlapChars: 200,
  minChars: 200,
  tableAtomicMax: 1500,
  maxChars: 6000,
  // 2 (2026-09-29, F12): a table row must start and end with '|' and hold a
  // non-empty cell; version 1 treated any line starting with '|' as a table.
  version: 2,
});

export interface ChunkUnit {
  unitKey: string;
  text: string;
  sourceKind: 'document' | 'pdf_page';
  pageNumber?: number;
}

export interface ChunkSpan {
  unitKey: string;
  sourceKind: 'document' | 'pdf_page';
  pageNumber?: number;
  charFrom: number;
  charTo: number;
  content: string;
}

export interface ChunkRow extends ChunkSpan {
  chunkIndex: number;
  chunkHash: string;
  tokenEstimate: number;
}

export type Kind = 'heading' | 'table' | 'para';
export interface Block {
  kind: Kind;
  from: number;
  to: number;
}
interface Piece {
  from: number;
  to: number;
}

/**
 * Splitting options that are off for version 2. `atomicPlaceholders` (page chunking only, spec R3.3):
 * no span boundary falls strictly inside an image or link token `![…](…)` / `[…](…)`.
 */
export interface SplitOptions {
  atomicPlaceholders?: boolean;
}

/** Image and link tokens; the same pattern pageText.ts uses to recognise placeholders. */
const PLACEHOLDER_TOKEN = /!?\[[^\]\n]*\]\([^)\n]*\)/g;

function placeholderTokens(text: string): Piece[] {
  return [...text.matchAll(PLACEHOLDER_TOKEN)].map((m) => ({ from: m.index, to: m.index + m[0].length }));
}

/** The token that position i falls strictly inside (a cut there would split it), if any. */
function tokenAround(tokens: readonly Piece[], i: number): Piece | undefined {
  return tokens.find((t) => t.from < i && i < t.to);
}

/** Four characters per token is the working estimate for this OCR corpus. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkHashInput(version: number, unitKey: string, content: string): string {
  return `${version}|${unitKey}|${normalise(content)}`;
}

/**
 * Group lines into heading, table and paragraph blocks with absolute offsets. Blank lines end a block.
 * Exported because the reader imports it (src/ai/documentBlocks.js, RAG spec §H): the reader renders the
 * same document the chunker cut, so a second implementation of this would drift and put a citation's
 * highlight in the wrong block.
 */
/**
 * A Markdown table row: starts and ends with '|' and has at least one non-empty
 * cell. Scanned OCR leaves bare pipes for a table's printed rules ('|', '| |',
 * '| THE SCHEDULE'); those are text, not table structure.
 */
function isTableRow(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || !t.startsWith('|') || !t.endsWith('|')) return false;
  return t.slice(1, -1).split('|').some((cell) => cell.trim() !== '');
}

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let current: Block | null = null;
  let pos = 0;
  for (const line of text.split('\n')) {
    const from = pos;
    const to = pos + line.length;
    pos = to + 1;
    if (!line.trim()) {
      current = null;
      continue;
    }
    const kind: Kind = /^#{1,6}\s/.test(line) ? 'heading' : isTableRow(line) ? 'table' : 'para';
    if (kind === 'heading') {
      out.push({ kind, from, to });
      current = null;
      continue;
    }
    if (current && current.kind === kind) current.to = to;
    else {
      current = { kind, from, to };
      out.push(current);
    }
  }
  return out;
}

/**
 * Cut a block into pieces no longer than maxChars; tables stay whole below tableAtomicMax. With `tokens`
 * (placeholder atomicity), a sentence boundary inside a token is skipped and a hard cut inside one moves
 * back to the token's start (forward to its end when the token opens the piece). No tokens: version 2.
 */
function pieces(text: string, block: Block, o: ChunkOptions, tokens: readonly Piece[] = []): Piece[] {
  const len = block.to - block.from;
  let out: Piece[] = [];
  if (block.kind === 'table' && len > o.tableAtomicMax) {
    let start = block.from;
    const body = text.slice(block.from, block.to);
    for (const line of body.split('\n')) {
      out.push({ from: start, to: start + line.length });
      start += line.length + 1;
    }
  } else if (block.kind === 'para' && len > o.targetChars) {
    const body = text.slice(block.from, block.to);
    const boundary = /(?<=[.!?।])\s+/g;
    let start = 0;
    for (const m of body.matchAll(boundary)) {
      if (tokenAround(tokens, block.from + m.index)) continue;
      out.push({ from: block.from + start, to: block.from + m.index });
      start = m.index + m[0].length;
    }
    out.push({ from: block.from + start, to: block.to });
  } else {
    out = [{ from: block.from, to: block.to }];
  }
  const bounded: Piece[] = [];
  for (const p of out) {
    if (p.to - p.from <= o.maxChars) {
      if (p.to > p.from) bounded.push(p);
      continue;
    }
    if (tokens.length === 0) {
      for (let s = p.from; s < p.to; s += o.maxChars) bounded.push({ from: s, to: Math.min(p.to, s + o.maxChars) });
      continue;
    }
    for (let s = p.from; s < p.to;) {
      let e = Math.min(p.to, s + o.maxChars);
      const t = tokenAround(tokens, e);
      if (t) e = t.from > s ? t.from : t.to;
      bounded.push({ from: s, to: e });
      s = e;
    }
  }
  return bounded;
}

/** The first index after a whitespace at or after `from`, or `limit` when none. */
function snapForward(text: string, from: number, limit: number): number {
  let i = from;
  while (i < limit && !/\s/.test(text[i])) i++;
  return Math.min(i + 1, limit);
}

/** Greedy packing to targetChars with a whitespace-aligned overlap; short tails fold into the previous span. */
function pack(text: string, all: Piece[], o: ChunkOptions, tokens: readonly Piece[] = []): Piece[] {
  const spans: Piece[] = [];
  let cur: Piece | null = null;
  for (const p of all) {
    if (!cur) {
      cur = { from: p.from, to: p.to };
      continue;
    }
    if (p.to - cur.from <= o.targetChars) {
      cur.to = p.to;
      continue;
    }
    spans.push(cur);
    let from = snapForward(text, Math.max(cur.from + 1, cur.to - o.overlapChars), cur.to);
    const t = tokenAround(tokens, from);
    if (t) from = t.to;
    if (from > p.from || p.to - from > o.maxChars) from = p.from;
    cur = { from, to: p.to };
  }
  if (cur) spans.push(cur);
  const last = spans[spans.length - 1];
  const prev = spans[spans.length - 2];
  if (last && prev && last.to - last.from < o.minChars && last.to - prev.from <= o.maxChars) {
    prev.to = last.to;
    spans.pop();
  }
  return spans;
}

export function chunkUnit(unit: ChunkUnit, opts: Partial<ChunkOptions> = {}, split: SplitOptions = {}): ChunkSpan[] {
  const o: ChunkOptions = { ...CHUNK, ...opts };
  const tokens = split.atomicPlaceholders ? placeholderTokens(unit.text) : [];
  const all: Piece[] = [];
  for (const b of blocks(unit.text)) all.push(...pieces(unit.text, b, o, tokens));
  return pack(unit.text, all, o, tokens).map((s) => ({
    unitKey: unit.unitKey,
    sourceKind: unit.sourceKind,
    pageNumber: unit.pageNumber,
    charFrom: s.from,
    charTo: s.to,
    content: unit.text.slice(s.from, s.to),
  }));
}

/** Today's unit is the whole document; page-wise Markdown will call chunkUnit per page instead. */
export async function chunkDocument(ocrText: string, opts: Partial<ChunkOptions> = {}): Promise<ChunkRow[]> {
  const version = opts.version ?? CHUNK.version;
  const spans = chunkUnit({ unitKey: 'document', text: ocrText, sourceKind: 'document' }, opts);
  const rows: ChunkRow[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    rows.push({
      ...s,
      chunkIndex: i,
      chunkHash: await sha256Hex(chunkHashInput(version, s.unitKey, s.content)),
      tokenEstimate: estimateTokens(s.content),
    });
  }
  return rows;
}

// ─── Page chunks (chunk-contract spec R2–R5) ─────────────────────────────────

/**
 * The page chunker's version, hashed into every page chunk's identity. Separate from CHUNK.version so the
 * whole-document path (chunkDocument, ingest-documents) is untouched (spec R3.1).
 */
export const PAGE_CHUNK_VERSION = 3;

/** R2: the section a chunk belongs to. Each value whitespace-collapsed, at most SECTION_MAX_CHARS. */
export interface PageSection {
  heading?: string;
  note?: string;
}

/** A block by position, not id: the writer maps these to `document_page_blocks.id` (spec R5 write order). */
export interface BlockRef {
  page_number: number;
  block_index: number;
}

export interface PageChunkRow {
  /** Document-wide, contiguous from 0, in page order and then by span. */
  chunk_index: number;
  page_number: number;
  /** `'page:<n>'` (ADR 0004 amendment). */
  unit_key: string;
  source_kind: 'pdf_page';
  /** Global UTF-16 offsets: `ocrText.slice(char_from, char_to) === content`. */
  char_from: number;
  char_to: number;
  content: string;
  section: PageSection;
  /** Section prefix, a repeated table header when the chunk starts inside a table, then the content (R4). */
  embedding_input: string;
  /** SHA-256(PAGE_CHUNK_VERSION ‖ unit_key ‖ normalise(content)): identity, independent of the section. */
  chunk_hash: string;
  /** SHA-256(normalise(embedding_input)): decides whether an identity hit may keep its vector. */
  embed_hash: string;
  block_refs: BlockRef[];
  /** Placeholder ids (`img:<page>-<n>`) whose whole token lies inside the chunk. */
  image_placeholders: string[];
  token_estimate: number;
}

export interface PageChunkInput {
  /** The result of pageText.ts composeDocument. */
  document: ComposedDocument;
  /**
   * The Mistral pages the document was composed from (page_number = index + 1); only the blocks and
   * dimensions are read here, for sections (R2) and block links (R5). A page with no entry has no blocks.
   */
  pages: ReadonlyArray<Pick<MistralPage, 'index' | 'blocks' | 'dimensions'>>;
}

/** R2: section values and the "first 200 characters" window. */
export const SECTION_MAX_CHARS = 200;
export const SECTION_WINDOW_CHARS = 200;

type SectionEvent =
  | { pos: number; kind: 'heading'; value: string }
  | { pos: number; kind: 'note'; value: string }
  | { pos: number; kind: 'clear' };

/** Whitespace collapsed and trimmed, cut to SECTION_MAX_CHARS UTF-16 units without splitting a pair. */
function sectionValue(text: string): string {
  let v = normalise(text);
  if (v.length > SECTION_MAX_CHARS) {
    v = v.slice(0, SECTION_MAX_CHARS);
    if (/[\uD800-\uDBFF]$/.test(v)) v = v.slice(0, -1);
    v = v.trimEnd();
  }
  return v;
}

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

/**
 * R2 heading text of one Mistral `title` block: the first line's leading '#' run removed, lines joined
 * with a space, a trailing margin line number (`\s+\p{Nd}{1,3}$`) removed. Undefined when the title's
 * first (`#`) line has fewer than 3 letters: that is what drops the back page's "# A\nBILL".
 */
function titleText(content: string): string | undefined {
  const lines = content.split('\n');
  lines[0] = lines[0].replace(/^\s*#+\s*/, '');
  if (letters(lines[0]) < 3) return undefined;
  const text = normalise(lines.join(' ')).replace(/\s+\p{Nd}{1,3}$/u, '');
  return text === '' ? undefined : text;
}

/** A numbered section start (R2): a line matching `^\s*\p{Nd}+\.\s`. */
const SECTION_START = /^\s*\p{Nd}+\.\s/u;

/**
 * R2 section events in global (ocr_text) order. Headings: title runs (titles separated only by
 * whitespace, joined " › ") at the run's first title. Notes: margin notes (isMarginNote) at their
 * position. Clears: numbered section starts with no note of their own, where "own" means the nearest
 * margin note before the line ends before it with no letter in between. Unlocated blocks have no
 * position and are ignored.
 */
function sectionEvents(
  document: ComposedDocument,
  located: ReadonlyMap<
    number,
    ReadonlyArray<{ block_index: number; char_from: number | null; char_to: number | null }>
  >,
  sources: ReadonlyMap<number, Pick<MistralPage, 'index' | 'blocks' | 'dimensions'>>,
): SectionEvent[] {
  const titles: Array<{ from: number; to: number; text: string }> = [];
  const notes: Array<{ from: number; to: number; text: string }> = [];
  for (const page of document.pages) {
    const src = sources.get(page.page_number);
    for (const b of located.get(page.page_number) ?? []) {
      if (b.char_from === null || b.char_to === null || !src?.blocks) continue;
      const block = src.blocks[b.block_index];
      const span = { from: page.char_from + b.char_from, to: page.char_from + b.char_to };
      if (block.type === 'title') {
        const text = titleText(block.content ?? '');
        if (text !== undefined) titles.push({ ...span, text });
      } else if (isMarginNote(block, src.dimensions)) {
        notes.push({ ...span, text: block.content ?? '' });
      }
    }
  }

  const events: SectionEvent[] = [];
  let run: { from: number; to: number; parts: string[] } | null = null;
  const endRun = () => {
    if (run) events.push({ pos: run.from, kind: 'heading', value: sectionValue(run.parts.join(' › ')) });
    run = null;
  };
  for (const t of titles) {
    if (run && document.ocrText.slice(run.to, t.from).trim() === '') {
      run.to = t.to;
      run.parts.push(t.text);
    } else {
      endRun();
      run = { from: t.from, to: t.to, parts: [t.text] };
    }
  }
  endRun();
  for (const n of notes) {
    const value = sectionValue(n.text);
    if (value !== '') events.push({ pos: n.from, kind: 'note', value });
  }

  for (const page of document.pages) {
    let lineStart = 0;
    for (const line of page.text.split('\n')) {
      if (SECTION_START.test(line)) {
        const pos = page.char_from + lineStart + (line.length - line.trimStart().length);
        const own = notes.filter((n) => n.to <= pos).at(-1);
        if (!own || letters(document.ocrText.slice(own.to, pos)) > 0) events.push({ pos, kind: 'clear' });
      }
      lineStart += line.length + 1;
    }
  }

  const rank = { heading: 0, note: 1, clear: 2 } as const;
  return events.sort((a, b) => a.pos - b.pos || rank[a.kind] - rank[b.kind]);
}

/**
 * R2: the state at the chunk's start (every event at or before it), then any heading or note starting
 * within the chunk's first SECTION_WINDOW_CHARS (replace, not append). Clears inside the window are not
 * applied: the chunk's start still belongs to the earlier section.
 */
function sectionAt(events: readonly SectionEvent[], from: number, to: number): PageSection {
  let heading: string | undefined;
  let note: string | undefined;
  const windowEnd = Math.min(to, from + SECTION_WINDOW_CHARS);
  for (const e of events) {
    if (e.pos >= windowEnd) break;
    if (e.pos > from && e.kind === 'clear') continue;
    if (e.kind === 'heading') [heading, note] = [e.value, undefined];
    else if (e.kind === 'note') note = e.value;
    else note = undefined;
  }
  const section: PageSection = {};
  if (heading !== undefined) section.heading = heading;
  if (note !== undefined) section.note = note;
  return section;
}

/** R4 prefix table. */
function sectionPrefix(s: PageSection): string {
  if (s.heading !== undefined && s.note !== undefined) return `${s.heading} › ${s.note}\n\n`;
  if (s.heading !== undefined) return `${s.heading}\n\n`;
  if (s.note !== undefined) return `${s.note}\n\n`;
  return '';
}

const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*$/;

/**
 * R4: the header row and divider line of the table a chunk starts inside without opening it (page-local
 * `from` strictly inside the table block), followed by '\n'; '' otherwise, or when the table's second
 * line is not a divider (no identifiable header).
 */
function tableHeaderPrefix(pageText: string, tables: readonly Block[], from: number): string {
  const t = tables.find((b) => b.from < from && from < b.to);
  if (!t) return '';
  const [header, divider] = pageText.slice(t.from, t.to).split('\n');
  return divider !== undefined && TABLE_DIVIDER.test(divider) ? `${header}\n${divider}\n` : '';
}

/**
 * Chunk a composed page-aware document (spec R2–R5). One unit per non-empty page (`page:<n>`,
 * `pdf_page`), the version 2 sizes and split order with placeholder atomicity on; spans are exact and
 * made global by the page's char_from. Rows with an equal chunk_hash are dropped after the first, then
 * chunk_index is assigned contiguously. Block references are the page's located body blocks (header and
 * footer excluded) overlapping the chunk by at least one character.
 */
export async function chunkPages(input: PageChunkInput): Promise<{ rows: PageChunkRow[]; pageVersion: number }> {
  const { document } = input;
  const sources = new Map(input.pages.map((p) => [p.index + 1, p]));
  const located = new Map(
    document.pages.map((page) => {
      const src = sources.get(page.page_number);
      return [page.page_number, locateBlocks(page.text, src?.blocks ?? [], src?.dimensions)] as const;
    }),
  );
  const events = sectionEvents(document, located, sources);

  const rows: PageChunkRow[] = [];
  const seen = new Set<string>();
  for (const page of document.pages) {
    if (page.text === '') continue;
    const unitKey = `page:${page.page_number}`;
    const tables = blocks(page.text).filter((b) => b.kind === 'table');
    const bodyBlocks = (located.get(page.page_number) ?? []).filter(
      (b) => b.char_from !== null && b.char_to !== null && b.type !== 'header' && b.type !== 'footer',
    );
    const images = document.imagePlaceholders
      .filter((im) => im.page_number === page.page_number)
      .flatMap((im) => {
        const token = `![${im.placeholder}](${im.placeholder})`;
        const at: Piece[] = [];
        for (let i = page.text.indexOf(token); i >= 0; i = page.text.indexOf(token, i + 1)) {
          at.push({ from: i, to: i + token.length });
        }
        return at.map((span) => ({ placeholder: im.placeholder, ...span }));
      })
      .sort((a, b) => a.from - b.from);

    const unit: ChunkUnit = { unitKey, text: page.text, sourceKind: 'pdf_page', pageNumber: page.page_number };
    for (const s of chunkUnit(unit, {}, { atomicPlaceholders: true })) {
      const chunkHash = await sha256Hex(chunkHashInput(PAGE_CHUNK_VERSION, unitKey, s.content));
      if (seen.has(chunkHash)) continue;
      seen.add(chunkHash);
      const charFrom = page.char_from + s.charFrom;
      const charTo = page.char_from + s.charTo;
      const section = sectionAt(events, charFrom, charTo);
      const embeddingInput = sectionPrefix(section) + tableHeaderPrefix(page.text, tables, s.charFrom) + s.content;
      rows.push({
        chunk_index: rows.length,
        page_number: page.page_number,
        unit_key: unitKey,
        source_kind: 'pdf_page',
        char_from: charFrom,
        char_to: charTo,
        content: s.content,
        section,
        embedding_input: embeddingInput,
        chunk_hash: chunkHash,
        embed_hash: await sha256Hex(normalise(embeddingInput)),
        block_refs: bodyBlocks
          .filter((b) => Math.max(b.char_from!, s.charFrom) < Math.min(b.char_to!, s.charTo))
          .map((b) => ({ page_number: page.page_number, block_index: b.block_index })),
        image_placeholders: [
          ...new Set(images.filter((im) => im.from >= s.charFrom && im.to <= s.charTo).map((im) => im.placeholder)),
        ],
        token_estimate: estimateTokens(s.content),
      });
    }
  }
  return { rows, pageVersion: PAGE_CHUNK_VERSION };
}
