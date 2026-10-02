import { describe, expect, it } from 'vitest';
import { TEXT_BATCH, TEXT_LAYOUT_KEY, batchPages, pageBatch, pagesToRead, readTextLayout, textItems, writeTextLayout } from './textModel.js';

describe('batches', () => {
  it(`reads the Text view in batches of ${TEXT_BATCH} pages, the last cut at the document's end`, () => {
    expect(pageBatch(1)).toBe(0);
    expect(pageBatch(10)).toBe(0);
    expect(pageBatch(11)).toBe(1);
    expect(batchPages(1, 25)).toEqual([11, 20]);
    expect(batchPages(2, 25)).toEqual([21, 25]);
  });

  it('the batches to read for the pages near the view: each once, not those read or being read', () => {
    expect(pagesToRead([3, 4, 12], { known: new Set([0]), total: 30 })).toEqual([1]);
    expect(pagesToRead([3, 29], { known: new Set(), total: 30 })).toEqual([0, 2]);
  });
});

describe('the Text layout choice', () => {
  const memory = () => {
    const data = new Map();
    return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data };
  };

  it('is Continuous unless the reader chose One page, and is kept only when chosen', () => {
    const storage = memory();
    expect(readTextLayout(storage)).toBe('continuous');
    writeTextLayout('page', storage);
    expect(storage.data.get(TEXT_LAYOUT_KEY)).toBe('page');
    expect(readTextLayout(storage)).toBe('page');
    writeTextLayout('sideways', storage);
    expect(readTextLayout(storage)).toBe('page');
  });

  it('never throws on blocked storage', () => {
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(readTextLayout(blocked)).toBe('continuous');
    expect(() => writeTextLayout('page', blocked)).not.toThrow();
  });
});

describe('textItems', () => {
  // A rendered page: text nodes inside blocks and inline marks, in document order.
  const text = data => ({ nodeType: 3, data });
  const el = (...childNodes) => ({ nodeType: 1, childNodes });

  it('lists every text node in document order, as items the matcher reads', () => {
    const container = el(el(text('In section '), el(text('11')), text(' of')), text('\n\n'), el(text('the Act')));
    const items = textItems(container);
    expect(items.map(i => i.str)).toEqual(['In section ', '11', ' of', '\n\n', 'the Act']);
    expect(items.every(i => i.hasEOL === false && i.node.nodeType === 3)).toBe(true);
  });
});
