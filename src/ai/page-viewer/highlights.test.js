import { describe, expect, it, vi } from 'vitest';
import { createHighlighter, layerItems, markMatches, markPage, needsFallback } from './highlights.js';

/** A fake pdf.js text layer: one span per text item, a <br> after an item that ends a line. */
function textLayer(items) {
  const nodes = [];
  for (const { str, eol, marked } of items) {
    const span = { nodeName: 'SPAN', textContent: str, firstChild: str ? { nodeType: 3, data: str } : null, classList: { contains: c => Boolean(marked) && c === 'markedContent' } };
    nodes.push(span);
    if (eol) nodes.push({ nodeName: 'BR' });
  }
  nodes.forEach((n, i) => { n.nextSibling = nodes[i + 1] ?? null; });
  return { querySelectorAll: sel => (sel === 'span' ? nodes.filter(n => n.nodeName === 'SPAN') : []) };
}

function fakeDocument() {
  const ranges = [];
  return {
    ranges,
    createRange() {
      const range = { setStart: vi.fn((node, at) => { range.start = [node.data, at]; }), setEnd: vi.fn((node, at) => { range.end = [node.data, at]; }) };
      ranges.push(range);
      return range;
    },
  };
}

function fakeEnv() {
  const registry = new Map();
  return {
    registry,
    CSS: { highlights: { set: (k, v) => registry.set(k, v), delete: k => registry.delete(k) } },
    Highlight: class { constructor(...ranges) { this.ranges = ranges; } },
  };
}

describe('layerItems', () => {
  it('reads each text span in order, with its end of line and text node, skipping marked-content wrappers', () => {
    const items = layerItems(textLayer([{ str: 'In section 11', eol: true }, { str: '', marked: true }, { str: 'of the Act' }]));
    expect(items.map(i => [i.str, i.hasEOL])).toEqual([['In section 11', true], ['of the Act', false]]);
    expect(items[1].node.data).toBe('of the Act');
  });
});

describe('markPage', () => {
  const layer = () => textLayer([
    { str: 'Preamble line.', eol: true },
    { str: 'In section 11 of the principal', eol: true },
    { str: 'Act, the words who are shall', eol: true },
    { str: 'be inserted. Line 5', eol: false },
  ]);

  it('marks the passage\'s exact words as one range, from its first word to its last', () => {
    const doc = fakeDocument();
    const env = fakeEnv();
    const highlighter = createHighlighter('pv-cite', env);
    const result = markPage({ container: layer(), passageText: '**In section 11** of the principal Act, the words "who are" shall be inserted', page: 4, doc, highlighter });
    expect(result).toBe('exact');
    expect(doc.ranges).toHaveLength(1);
    expect(doc.ranges[0].start).toEqual(['In section 11 of the principal', 0]);
    expect(doc.ranges[0].end).toEqual(['be inserted. Line 5', 11]);
    expect(env.registry.get('pv-cite').ranges).toEqual([doc.ranges[0]]);
  });

  it('is missing, and marks nothing, when the passage is not in the layer or the layer is empty', () => {
    const doc = fakeDocument();
    const env = fakeEnv();
    const highlighter = createHighlighter('pv-cite', env);
    expect(markPage({ container: layer(), passageText: 'entirely different words that appear nowhere here', page: 4, doc, highlighter })).toBe('missing');
    expect(markPage({ container: textLayer([]), passageText: 'In section 11 of the principal Act', page: 4, doc, highlighter })).toBe('missing');
    expect(doc.ranges).toHaveLength(0);
    expect(env.registry.has('pv-cite')).toBe(false);
  });

  it('is unsupported, and marks nothing, without the Highlight API', () => {
    const doc = fakeDocument();
    const highlighter = createHighlighter('pv-cite', {});
    expect(highlighter.supported).toBe(false);
    expect(markPage({ container: layer(), passageText: 'In section 11 of the principal Act', page: 4, doc, highlighter })).toBe('unsupported');
    expect(doc.ranges).toHaveLength(0);
  });
});

describe('createHighlighter', () => {
  it('holds each page\'s ranges, registers them all under one name, and forgets a page or everything', () => {
    const env = fakeEnv();
    const h = createHighlighter('pv-cite', env);
    h.set(4, ['r4']);
    h.set(5, ['r5a', 'r5b']);
    expect(env.registry.get('pv-cite').ranges).toEqual(['r4', 'r5a', 'r5b']);
    h.clear(4);
    expect(env.registry.get('pv-cite').ranges).toEqual(['r5a', 'r5b']);
    h.clear(5);
    expect(env.registry.has('pv-cite')).toBe(false);
    h.set(6, ['r6']);
    h.dispose();
    expect(env.registry.has('pv-cite')).toBe(false);
  });
});

describe('needsFallback', () => {
  const marks = new Map([[4, 'In section 11 of the principal Act']]);

  it('shows the boxes when there is no stored text to mark the page with', () => {
    expect(needsFallback({ marks: null, results: new Map(), page: 4 })).toBe(true);
    expect(needsFallback({ marks, results: new Map(), page: 5 })).toBe(true);
  });

  it('shows nothing while the page is being marked, and nothing once it is marked exactly', () => {
    expect(needsFallback({ marks, results: new Map(), page: 4 })).toBe(false);
    expect(needsFallback({ marks, results: new Map([[4, { text: marks.get(4), result: 'exact' }]]), page: 4 })).toBe(false);
  });

  it('shows the boxes when the page reported no match or no Highlight API', () => {
    for (const result of ['missing', 'unsupported']) {
      expect(needsFallback({ marks, results: new Map([[4, { text: marks.get(4), result }]]), page: 4 })).toBe(true);
    }
  });

  it('ignores a result made for an earlier passage', () => {
    expect(needsFallback({ marks, results: new Map([[4, { text: 'an earlier passage', result: 'missing' }]]), page: 4 })).toBe(false);
  });
});

describe('markMatches', () => {
  const layer = () => textLayer([
    { str: 'The accused was found in', eol: true },
    { str: 'possession; the accused', eol: true },
    { str: 'person was not.', eol: false },
  ]);

  it('marks every match on the page, the current one under its own name, and answers the count', () => {
    const doc = fakeDocument();
    const env = fakeEnv();
    const all = createHighlighter('pv-match', env);
    const focus = createHighlighter('pv-match-current', env);
    const marked = markMatches({ container: layer(), query: 'accused', page: 4, current: 1, doc, all, focus });
    expect(marked.count).toBe(2);
    expect(marked.current).toBe(env.registry.get('pv-match-current').ranges[0]);
    expect(env.registry.get('pv-match').ranges.map(r => r.start)).toEqual([['The accused was found in', 4]]);
    expect(env.registry.get('pv-match-current').ranges.map(r => [r.start, r.end])).toEqual([[['possession; the accused', 16], ['possession; the accused', 23]]]);
  });

  it('marks across a line end, and leaves the current name empty when the current match is not on this layer', () => {
    const doc = fakeDocument();
    const env = fakeEnv();
    const all = createHighlighter('pv-match', env);
    const focus = createHighlighter('pv-match-current', env);
    expect(markMatches({ container: layer(), query: 'accused person', page: 4, current: 3, doc, all, focus })).toEqual({ count: 1, current: null });
    expect(env.registry.get('pv-match').ranges.map(r => [r.start, r.end])).toEqual([[['possession; the accused', 16], ['person was not.', 6]]]);
    expect(env.registry.has('pv-match-current')).toBe(false);
  });

  it('answers null (unknown, not none) and marks nothing without the Highlight API', () => {
    const doc = fakeDocument();
    const all = createHighlighter('pv-match', {});
    const focus = createHighlighter('pv-match-current', {});
    expect(markMatches({ container: layer(), query: 'accused', page: 4, current: 0, doc, all, focus })).toBeNull();
    expect(doc.ranges).toHaveLength(0);
  });
});
