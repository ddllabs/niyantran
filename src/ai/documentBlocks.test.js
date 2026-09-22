import { describe, expect, it } from 'vitest';
import { blocks } from '../../supabase/functions/_shared/chunking.ts';
import { documentBlocks, readerWindow, visibleBlocks, WINDOW_CHARS } from './documentBlocks.js';

// A real stored fragment (the tariff tables carry rowspan and colspan), a real
// OCR head with its deliberate trailing spaces, a Markdown pipe table and the
// shapes that break offset arithmetic: no trailing newline, blank first line,
// runs of blank lines, nothing at all.
const HTML = `<table border=1 style='margin: auto; word-wrap: break-word;'><tr><td rowspan="2">Tariff Item</td><td colspan="2">Rate of duty</td></tr></table>`;
const DOCS = {
  gazette: 'EXTRAORDINARY :\nPART I — Section 1\nPUBLISHED BY AUTHORITY\n\nThe following Act of Parliament received the assent of the President on\nthe 20th December, 2005, and is hereby published for general information:—   ',
  mixed: `# Chapter 98\n\nThe rates below apply.\n\n${HTML}\n\n| Page | Column | Read |\n|---|---|---|\n| 1 | 3 | "persons" |\n\n## Notes\nSee clause 4.`,
  ragged: '\n\n\nleading blank lines\n\n\n\ntrailing newline follows\n',
  noEol: 'one line and no newline at the end',
  blank: '\n \n\t\n',
  empty: '',
};

describe('documentBlocks', () => {
  it('covers every character: concatenating the blocks reproduces ocr_text exactly', () => {
    for (const [name, text] of Object.entries(DOCS)) {
      const parts = documentBlocks(text).map((b) => text.slice(b.from, b.to));
      expect(parts.join(''), name).toBe(text);
    }
  });

  it('returns ordered, touching, non-empty blocks from 0 to the end', () => {
    for (const [name, text] of Object.entries(DOCS)) {
      const out = documentBlocks(text);
      if (!text.length) {
        expect(out, name).toEqual([]);
        continue;
      }
      expect(out[0].from, name).toBe(0);
      expect(out[out.length - 1].to, name).toBe(text.length);
      for (let i = 0; i < out.length; i++) {
        expect(out[i].to, name).toBeGreaterThan(out[i].from);
        if (i) expect(out[i].from, name).toBe(out[i - 1].to);
      }
    }
  });

  it('never moves a boundary the chunker set: the non-gap blocks are the chunker blocks', () => {
    for (const [name, text] of Object.entries(DOCS)) {
      const mine = documentBlocks(text).filter((b) => b.kind !== 'gap').map((b) => `${b.from}:${b.to}`);
      expect(mine, name).toEqual(blocks(text).map((b) => `${b.from}:${b.to}`));
    }
  });

  it('keeps the chunker kinds and relabels only an HTML table the chunker called a paragraph', () => {
    const text = DOCS.mixed;
    const kinds = documentBlocks(text).filter((b) => b.kind !== 'gap');
    expect(kinds.map((b) => b.kind)).toEqual(['heading', 'para', 'table', 'table', 'heading', 'para']);
    expect(text.slice(kinds[2].from, kinds[2].to)).toBe(HTML);
    // The chunker sees that same block as prose, because it only calls a line a
    // table when it starts with '|'. Relabelling is the whole difference.
    expect(blocks(text).find((b) => b.from === kinds[2].from).kind).toBe('para');
    expect(kinds[3].kind).toBe('table');
    expect(text.slice(kinds[3].from, kinds[3].to).startsWith('| Page')).toBe(true);
  });

  it('gives a heading a block of its own and treats blank-line runs as gaps', () => {
    const out = documentBlocks(DOCS.ragged);
    expect(out.map((b) => b.kind)).toEqual(['gap', 'para', 'gap', 'para', 'gap']);
    expect(DOCS.ragged.slice(out[0].from, out[0].to)).toBe('\n\n\n');
    expect(documentBlocks('# Title\nbody').map((b) => b.kind)).toEqual(['heading', 'gap', 'para']);
  });

  it('treats a null document as empty', () => {
    expect(documentBlocks(null)).toEqual([]);
  });
});

describe('the reader window over those blocks', () => {
  // One paragraph of 99 characters plus a blank line, repeated: 5.39 MB, the
  // size of the largest document in the corpus.
  const huge = `${'x'.repeat(99)}\n\n`.repeat(53400);
  const span = { from: 3000000, to: 3000040, status: 'exact' };

  it('renders a small document whole, so no control appears', () => {
    const text = DOCS.mixed;
    const shown = visibleBlocks(documentBlocks(text), readerWindow(text.length, { from: 0, to: 4 }, WINDOW_CHARS), WINDOW_CHARS);
    expect(shown[0].from).toBe(0);
    expect(shown[shown.length - 1].to).toBe(text.length);
  });

  it('keeps the 5.39 MB document inside the budget and around the citation', () => {
    const started = Date.now();
    const all = documentBlocks(huge);
    const shown = visibleBlocks(all, readerWindow(huge.length, span, WINDOW_CHARS), WINDOW_CHARS);
    const chars = shown.reduce((n, b) => n + (b.to - b.from), 0);
    expect(huge.length).toBeGreaterThan(5000000);
    expect(chars).toBeLessThanOrEqual(WINDOW_CHARS + (span.to - span.from));
    expect(shown[0].from).toBeLessThanOrEqual(span.from);
    expect(shown[shown.length - 1].to).toBeGreaterThanOrEqual(span.to);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('shows more each time the budget doubles, and stops at the ends', () => {
    const all = documentBlocks(huge);
    const chars = (budget) =>
      visibleBlocks(all, readerWindow(huge.length, span, budget), budget).reduce((n, b) => n + (b.to - b.from), 0);
    expect(chars(WINDOW_CHARS * 2)).toBeGreaterThan(chars(WINDOW_CHARS));
    const whole = visibleBlocks(all, readerWindow(huge.length, span, huge.length * 4), huge.length * 4);
    expect(whole[0].from).toBe(0);
    expect(whole[whole.length - 1].to).toBe(huge.length);
  });

  it('clips a paragraph at the window edge but keeps a table whole', () => {
    const text = DOCS.mixed;
    const all = documentBlocks(text);
    const table = all.find((b) => b.kind === 'table');
    const view = { from: table.from + 4, to: table.from + 8 };
    const shown = visibleBlocks(all, view, WINDOW_CHARS);
    expect(shown).toEqual([{ kind: 'table', from: table.from, to: table.to }]);
    const para = all.find((b) => b.kind === 'para');
    const edge = visibleBlocks(all, { from: para.from + 2, to: para.to - 2 }, WINDOW_CHARS);
    expect(edge).toEqual([{ kind: 'para', from: para.from + 2, to: para.to - 2 }]);
  });

  it('reads a table too big for the budget as clipped text rather than half a table', () => {
    const all = documentBlocks(`${HTML}\n`);
    const shown = visibleBlocks(all, { from: 0, to: 20 }, 10);
    expect(shown[0]).toEqual({ kind: 'para', from: 0, to: 20 });
  });
});
