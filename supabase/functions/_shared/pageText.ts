// Page text for page-aware documents. Pure, no I/O. Chunk-contract spec
// (docs/specs/2026-09-30-rag-v2-chunk-contract.md) R1, R2 (margin notes) and R5 (locating blocks).
// Composes one text per page from a Mistral OCR response and the document text ocr_text from those,
// so that every chunk span (cut later by chunking.ts, per page) is an exact slice of both.
// Invariant: ocrText.slice(page.char_from, page.char_to) === page.text, in UTF-16 code units.

// ─── Mistral OCR input (only the fields read here) ───────────────────────────

export interface MistralDimensions {
  dpi?: number | null;
  width?: number | null;
  height?: number | null;
}

/** Pixel coordinates as Mistral returns them for blocks and images. */
export interface MistralBoxFields {
  top_left_x?: number | null;
  top_left_y?: number | null;
  bottom_right_x?: number | null;
  bottom_right_y?: number | null;
}

export interface MistralBlock extends MistralBoxFields {
  type: string;
  content: string;
}

export interface MistralImage extends MistralBoxFields {
  id: string;
}

export interface MistralTable {
  id: string;
  content: string;
  format?: string;
}

export interface MistralPage {
  /** 0-based physical page index; Mistral keeps the original index for a page-range request. */
  index: number;
  markdown: string;
  header?: string | null;
  footer?: string | null;
  dimensions?: MistralDimensions | null;
  blocks?: MistralBlock[];
  images?: MistralImage[];
  tables?: MistralTable[];
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ComposedPage {
  /** 1-based physical page number (Mistral index + 1). */
  page_number: number;
  text: string;
  char_from: number;
  char_to: number;
  /** Header and footer exactly as Mistral returned them (running lines live only here). */
  header: string | null;
  footer: string | null;
  /** True when at least one unique header (footer) line was put back into `text`. */
  header_in_text: boolean;
  footer_in_text: boolean;
  width_px: number | null;
  height_px: number | null;
  dpi: number | null;
}

export interface ComposedDocument {
  ocrText: string;
  pages: ComposedPage[];
  unresolvedTables: Array<{ page_number: number; id: string }>;
  /** Original Mistral image id → document-unique placeholder id (`img:<page>-<n>`). */
  imagePlaceholders: Array<{ page_number: number; id: string; placeholder: string }>;
}

export interface LocatedBlock {
  block_index: number;
  type: string;
  box: Box | undefined;
  /** Page-local UTF-16 offsets into the page text; null when the block was not found. */
  char_from: number | null;
  char_to: number | null;
}

/** Separator between page texts in ocr_text (R1.5). */
export const PAGE_SEPARATOR = '\n\n';

// ─── Boxes ───────────────────────────────────────────────────────────────────

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Pixels → 0..1, min/max ordered and clamped. Undefined when the page has no (or zero) dimensions or a
 * coordinate is missing. Port of TenderBase `extract-pdf/mistral.ts` `normaliseBBox`.
 */
export function normaliseBox(
  raw: MistralBoxFields,
  dims: { width?: number | null; height?: number | null } | null | undefined,
): Box | undefined {
  const w = num(dims?.width);
  const h = num(dims?.height);
  if (!w || !h) return undefined;
  const x0 = num(raw.top_left_x);
  const y0 = num(raw.top_left_y);
  const x1 = num(raw.bottom_right_x);
  const y1 = num(raw.bottom_right_y);
  if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) return undefined;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x0: clamp(Math.min(x0, x1) / w),
    y0: clamp(Math.min(y0, y1) / h),
    x1: clamp(Math.max(x0, x1) / w),
    y1: clamp(Math.max(y0, y1) / h),
  };
}

// ─── R1.1 tables, R1.2 images ────────────────────────────────────────────────

const TABLE_PLACEHOLDER = /\[([^\]\n]+?\.md)\]\(\1\)/g;
const IMAGE_PLACEHOLDER = /!\[([^\]\n]+)\]\(\1\)/g;
/** Any image or link token; a page holding only these and whitespace has no text (R1.4). */
const ANY_PLACEHOLDER = /!?\[[^\]\n]*\]\([^)\n]*\)/g;

/**
 * Replace `[tbl-….md](tbl-….md)` placeholders with the table's markdown (TenderBase `inlineTables`).
 * An unknown placeholder is left in place and reported: a dangling link is visible, a deleted one would
 * silently lose a table.
 */
export function inlineTables(
  markdown: string,
  tables: ReadonlyArray<{ id?: unknown; content?: unknown; format?: unknown }>,
): { markdown: string; unresolved: string[] } {
  const byId = new Map<string, string>();
  for (const t of tables) {
    if (typeof t.id === 'string' && typeof t.content === 'string') byId.set(t.id, t.content);
  }
  const unresolved: string[] = [];
  const out = markdown.replace(TABLE_PLACEHOLDER, (whole, id: string) => {
    const content = byId.get(id);
    if (content === undefined) {
      unresolved.push(id);
      return whole;
    }
    return content;
  });
  return { markdown: out, unresolved };
}

/**
 * Rewrite `![<id>](<id>)` to `![img:<page>-<n>](img:<page>-<n>)`, n 0-based per page in order of first
 * appearance; a repeated id reuses its placeholder. Images listed on the page but never referenced in
 * the markdown get the following numbers, so every stored image has a document-unique placeholder.
 */
export function rewriteImagePlaceholders(
  markdown: string,
  pageNumber: number,
  imageIds: readonly string[] = [],
): { markdown: string; placeholders: Array<{ id: string; placeholder: string }> } {
  const byId = new Map<string, string>();
  const assign = (id: string) => {
    let p = byId.get(id);
    if (p === undefined) {
      p = `img:${pageNumber}-${byId.size}`;
      byId.set(id, p);
    }
    return p;
  };
  const out = markdown.replace(IMAGE_PLACEHOLDER, (_whole, id: string) => {
    const p = assign(id);
    return `![${p}](${p})`;
  });
  for (const id of imageIds) assign(id);
  return { markdown: out, placeholders: [...byId].map(([id, placeholder]) => ({ id, placeholder })) };
}

// ─── R1.3 headers and footers ────────────────────────────────────────────────

/** NFKC, lowercase, every run of decimal digits of any script → '#', whitespace collapsed. */
export function normaliseChromeLine(line: string): string {
  return line.normalize('NFKC').toLowerCase().replace(/\p{Nd}+/gu, '#').replace(/\s+/g, ' ').trim();
}

function chromeLines(value: string | null | undefined): string[] {
  return (value ?? '').split('\n').map((l) => l.trim()).filter((l) => normaliseChromeLine(l) !== '');
}

/**
 * The normalised header/footer lines that are running: on ≥3 pages, or on ≥30% of pages when the
 * document has 4+ pages. Pages are counted once per line, whether the line is in the header or footer.
 * Documents of 1 or 2 pages have no running lines.
 */
export function runningLines(pages: ReadonlyArray<Pick<MistralPage, 'header' | 'footer'>>): Set<string> {
  const n = pages.length;
  const running = new Set<string>();
  if (n <= 2) return running;
  const count = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set([...chromeLines(p.header), ...chromeLines(p.footer)].map(normaliseChromeLine));
    for (const key of seen) count.set(key, (count.get(key) ?? 0) + 1);
  }
  for (const [key, c] of count) {
    if (c >= 3 || (n >= 4 && c * 10 >= n * 3)) running.add(key);
  }
  return running;
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/**
 * The unique lines not already at the page edge, in order. Header lines are consumed from the start of
 * the body, footer lines (in reverse) from its end; a line counts as present only on a whitespace
 * boundary, exact after trim.
 */
function missingAtEdge(body: string, lines: string[], edge: 'start' | 'end'): string[] {
  let rest = body;
  const missing: string[] = [];
  const ordered = edge === 'start' ? lines : [...lines].reverse();
  for (const line of ordered) {
    if (edge === 'start' && rest.startsWith(line) && isSpace(rest[line.length])) {
      rest = rest.slice(line.length).trimStart();
    } else if (edge === 'end' && rest.endsWith(line) && isSpace(rest[rest.length - line.length - 1])) {
      rest = rest.slice(0, rest.length - line.length).trimEnd();
    } else {
      missing.push(line);
    }
  }
  return edge === 'start' ? missing : missing.reverse();
}

// ─── R1.4, R1.5 composition ──────────────────────────────────────────────────

/**
 * Compose page texts and ocr_text. Per page: tables inlined, image placeholders rewritten, the body
 * trimmed, unique header lines put back on top and unique footer lines at the bottom (header lines
 * joined by '\n', then '\n\n', body, '\n\n', footer lines). A page whose composed text holds nothing but
 * placeholders and whitespace gets text ''. Page texts are joined with PAGE_SEPARATOR in page order;
 * an empty page still takes its position, so page k starts at (sum of earlier text lengths) + 2·k
 * and ocr_text holds four newlines around an empty page. Pages are sorted by Mistral index.
 */
export function composeDocument(input: readonly MistralPage[]): ComposedDocument {
  const pages = [...input].sort((a, b) => a.index - b.index);
  const running = runningLines(pages);
  const unique = (value: string | null | undefined) =>
    chromeLines(value).filter((l) => !running.has(normaliseChromeLine(l)));

  const unresolvedTables: ComposedDocument['unresolvedTables'] = [];
  const imagePlaceholders: ComposedDocument['imagePlaceholders'] = [];
  const out: ComposedPage[] = [];
  let offset = 0;

  pages.forEach((p, i) => {
    const pageNumber = p.index + 1;
    const tables = inlineTables(p.markdown ?? '', p.tables ?? []);
    for (const id of tables.unresolved) unresolvedTables.push({ page_number: pageNumber, id });
    const images = rewriteImagePlaceholders(tables.markdown, pageNumber, (p.images ?? []).map((im) => im.id));
    for (const m of images.placeholders) imagePlaceholders.push({ page_number: pageNumber, ...m });

    const body = images.markdown.trim();
    const head = missingAtEdge(body, unique(p.header), 'start');
    const foot = missingAtEdge(body, unique(p.footer), 'end');
    let text = [head.join('\n'), body, foot.join('\n')].filter((s) => s !== '').join('\n\n');
    if (text.replace(ANY_PLACEHOLDER, '').trim() === '') text = '';

    if (i > 0) offset += PAGE_SEPARATOR.length;
    out.push({
      page_number: pageNumber,
      text,
      char_from: offset,
      char_to: offset + text.length,
      header: p.header ?? null,
      footer: p.footer ?? null,
      header_in_text: text !== '' && head.length > 0,
      footer_in_text: text !== '' && foot.length > 0,
      width_px: num(p.dimensions?.width) ?? null,
      height_px: num(p.dimensions?.height) ?? null,
      dpi: num(p.dimensions?.dpi) ?? null,
    });
    offset += text.length;
  });

  return { ocrText: out.map((p) => p.text).join(PAGE_SEPARATOR), pages: out, unresolvedTables, imagePlaceholders };
}

// ─── R5 locating blocks ──────────────────────────────────────────────────────

/**
 * The matching form of a text: all whitespace removed, and the leading '#' run of each line (markdown
 * heading markers) removed. `at[k]` is the UTF-16 index in the source of compact character k.
 */
function compact(text: string): { s: string; at: number[] } {
  let s = '';
  const at: number[] = [];
  let lineStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      lineStart = true;
      continue;
    }
    if (/\s/.test(ch)) continue;
    if (lineStart && ch === '#') continue;
    lineStart = false;
    s += ch;
    at.push(i);
  }
  return { s, at };
}

/** Widen a match that starts at a line's first non-marker character over that line's leading '#' run. */
function widenOverMarker(text: string, from: number): number {
  let i = from;
  while (i > 0 && text[i - 1] !== '\n' && /[#\s]/.test(text[i - 1])) i--;
  const atLineStart = i === 0 || text[i - 1] === '\n';
  const marker = text.slice(i, from).indexOf('#');
  return atLineStart && marker >= 0 ? i + marker : from;
}

/**
 * Locate each block in its page text (R5). Matching is on the compact form (whitespace-insensitive,
 * leading '#' stripped); a match maps back to exact page-text offsets, widened over a heading marker.
 * Body blocks are found by forward search: each search starts where the previous located body block
 * ended, and a block not found leaves the cursor unchanged. Header blocks must sit at the start of the
 * page text (in order) and footer blocks at its end (in reverse order); anywhere else, e.g. a running
 * page number matching a stray digit, they are not located.
 */
export function locateBlocks(
  pageText: string,
  blocks: readonly MistralBlock[],
  dims?: MistralDimensions | null,
): LocatedBlock[] {
  const page = compact(pageText);
  const span = (k: number, len: number): [number, number] => [
    widenOverMarker(pageText, page.at[k]),
    page.at[k + len - 1] + 1,
  ];
  const result: LocatedBlock[] = blocks.map((b, i) => ({
    block_index: i,
    type: b.type,
    box: normaliseBox(b, dims),
    char_from: null,
    char_to: null,
  }));
  const needle = (b: MistralBlock) => compact(b.content ?? '').s;

  let head = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 'header') continue;
    const s = needle(blocks[i]);
    if (s && page.s.startsWith(s, head)) {
      [result[i].char_from, result[i].char_to] = span(head, s.length);
      head += s.length;
    }
  }
  let tail = page.s.length;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type !== 'footer') continue;
    const s = needle(blocks[i]);
    if (s && tail - s.length >= head && page.s.startsWith(s, tail - s.length)) {
      [result[i].char_from, result[i].char_to] = span(tail - s.length, s.length);
      tail -= s.length;
    }
  }
  let cursor = head;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'header' || blocks[i].type === 'footer') continue;
    const s = needle(blocks[i]);
    const k = s ? page.s.indexOf(s, cursor) : -1;
    if (k < 0) continue;
    [result[i].char_from, result[i].char_to] = span(k, s.length);
    cursor = k + s.length;
  }
  return result;
}

// ─── R2 margin notes ─────────────────────────────────────────────────────────

/** Thresholds measured on the 12-page bill (spec R2): notes at x 0.075–0.174 and 0.825–0.928. */
export const MARGIN = Object.freeze({ left: 0.18, right: 0.82, maxChars: 150, minLetters: 3 });
const ACT_CITATION = /^\p{Nd}+ of \p{Nd}{4}\.?$/u;

/**
 * A margin note (a bill's section title): an `aside_text` or `text` block whose normalised box lies
 * entirely in the outer margin (x1 ≤ 0.18 or x0 ≥ 0.82), with at most 150 characters and at least 3
 * letters, and not an Act citation such as "5 of 1908.". False when the page has no dimensions.
 */
export function isMarginNote(block: MistralBlock, dims: MistralDimensions | null | undefined): boolean {
  if (block.type !== 'aside_text' && block.type !== 'text') return false;
  const b = normaliseBox(block, dims);
  if (!b) return false;
  if (!(b.x1 <= MARGIN.left || b.x0 >= MARGIN.right)) return false;
  const content = (block.content ?? '').trim();
  if (content.length > MARGIN.maxChars) return false;
  if ((content.match(/\p{L}/gu) ?? []).length < MARGIN.minLetters) return false;
  return !ACT_CITATION.test(content);
}
