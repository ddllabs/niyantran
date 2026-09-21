// The chunker. Pure, no I/O. Order: heading → table → paragraph → sentence →
// character. Two invariants (RAG spec §B):
//   one unit  — a span is cut from exactly one ChunkUnit; chunkUnit takes one
//               unit, so a span cannot straddle two;
//   exact span — content === unit.text.slice(charFrom, charTo), untrimmed.
// The hash folds whitespace so an OCR re-run that changes only spacing keeps
// every embedding; CHUNK.version participates so a chunker change re-embeds.

import { normalise, sha256Hex } from './textNormalise.ts';

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
  version: 1,
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

type Kind = 'heading' | 'table' | 'para';
interface Block {
  kind: Kind;
  from: number;
  to: number;
}
interface Piece {
  from: number;
  to: number;
}

/** Four characters per token is the working estimate for this OCR corpus. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkHashInput(version: number, unitKey: string, content: string): string {
  return `${version}|${unitKey}|${normalise(content)}`;
}

/** Group lines into heading, table and paragraph blocks with absolute offsets. Blank lines end a block. */
function blocks(text: string): Block[] {
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
    const kind: Kind = /^#{1,6}\s/.test(line) ? 'heading' : /^\s*\|/.test(line) ? 'table' : 'para';
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

/** Cut a block into pieces no longer than maxChars; tables stay whole below tableAtomicMax. */
function pieces(text: string, block: Block, o: ChunkOptions): Piece[] {
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
    for (let s = p.from; s < p.to; s += o.maxChars) bounded.push({ from: s, to: Math.min(p.to, s + o.maxChars) });
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
function pack(text: string, all: Piece[], o: ChunkOptions): Piece[] {
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

export function chunkUnit(unit: ChunkUnit, opts: Partial<ChunkOptions> = {}): ChunkSpan[] {
  const o: ChunkOptions = { ...CHUNK, ...opts };
  const all: Piece[] = [];
  for (const b of blocks(unit.text)) all.push(...pieces(unit.text, b, o));
  return pack(unit.text, all, o).map((s) => ({
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
