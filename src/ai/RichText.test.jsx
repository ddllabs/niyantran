import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import RichText from './RichText.jsx';

// Vitest runs in the node environment and this repository adds no dependency,
// so there is no DOMParser here. The stand-in below is the smallest parser that
// still hands the walker a real tree parsed from a real string: tags with
// quoted and unquoted attributes, void tags, the raw-text content of <script>,
// and the <tbody> a real parser implies around a bare <tr>. It is deliberately
// permissive — it does not foster-parent stray cells the way a browser does, so
// more hostile markup reaches the walker here than would in a browser.
//
// The first test asserts the stand-in itself produces the hostile tree, so that
// none of the tests below can pass because the harness quietly swallowed the
// attack instead of the walker dropping it.

const VOID_TAGS = new Set(['br', 'col', 'img', 'hr', 'input', 'meta', 'link']);
const RAW_TAGS = new Set(['script', 'style']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENTITIES[e]);

const element = (tagName, attributes) => ({
  nodeType: 1, tagName, childNodes: [],
  getAttribute: (name) => (name in attributes ? attributes[name] : null),
});
const textNode = (data) => ({ nodeType: 3, data });

function attributesOf(source) {
  const out = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'`=<>]+))?/g;
  for (const m of source.matchAll(pattern)) out[m[1].toLowerCase()] = decode((m[2] ?? '').replace(/^["']|["']$/g, ''));
  return out;
}

class StandInDOMParser {
  parseFromString(html) {
    const body = element('body', {});
    const open = [body];
    const top = () => open[open.length - 1];
    const tags = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let at = 0;
    let m;
    while ((m = tags.exec(html))) {
      if (m.index > at) top().childNodes.push(textNode(decode(html.slice(at, m.index))));
      at = tags.lastIndex;
      const tag = m[2].toLowerCase();
      if (m[1]) {
        for (let i = open.length - 1; i > 0; i--) if (open[i].tagName === tag) { open.length = i; break; }
        continue;
      }
      if (tag === 'tr' && top().tagName === 'table') {
        const implied = element('tbody', {});
        top().childNodes.push(implied);
        open.push(implied);
      }
      const node = element(tag, attributesOf(m[3]));
      top().childNodes.push(node);
      if (VOID_TAGS.has(tag) || /\/\s*$/.test(m[3])) continue;
      if (RAW_TAGS.has(tag)) {
        const close = new RegExp(`</${tag}\\s*>`, 'i').exec(html.slice(at));
        node.childNodes.push(textNode(close ? html.slice(at, at + close.index) : html.slice(at)));
        at = close ? at + close.index + close[0].length : html.length;
        tags.lastIndex = at;
        continue;
      }
      open.push(node);
    }
    if (at < html.length) top().childNodes.push(textNode(decode(html.slice(at))));
    return { body };
  }
}

beforeAll(() => { globalThis.DOMParser = StandInDOMParser; });
afterAll(() => { delete globalThis.DOMParser; });

/** Render one whole block, the way SourceReader does. */
const render = (kind, source, mark = null) =>
  renderToStaticMarkup(<RichText text={source} kind={kind} from={0} to={source.length} mark={mark} />);

// The real stored shape, with the rowspan and colspan 1,590 chunks depend on.
const TARIFF = `<table border=1 style='margin: auto; word-wrap: break-word;'><tr><td rowspan="2">Tariff Item</td><td colspan="2">Rate of duty</td></tr></table>`;
// Everything the corpus scan said is present (style=, <img>, <a>) and everything
// it said is not (<script>, onerror=, javascript:), in one block.
const HOSTILE = `<table><tr><td><script>alert('xss')</script>Item</td>` +
  `<td><img src=x onerror="alert('img')"><a href="javascript:alert('href')">Rate</a></td>` +
  `<td style="position:fixed;top:0" onclick="alert('click')"><style>td{content:'leaked'}</style>` +
  `<iframe src="//evil.invalid"></iframe>Duty</td></tr></table>`;

describe('the stand-in parser really produces the hostile tree', () => {
  it('keeps the script, the event handlers, the javascript: href and the style', () => {
    const body = new StandInDOMParser().parseFromString(HOSTILE).body;
    const found = {};
    (function collect(node) {
      if (node.nodeType === 1) found[node.tagName] = node;
      for (const child of node.childNodes ?? []) collect(child);
    })(body);
    expect(Object.keys(found)).toEqual(expect.arrayContaining(['table', 'tbody', 'tr', 'td', 'script', 'img', 'a', 'iframe']));
    expect(found.script.childNodes[0].data).toBe("alert('xss')");
    expect(found.img.getAttribute('onerror')).toBe("alert('img')");
    expect(found.a.getAttribute('href')).toBe("javascript:alert('href')");
    expect(found.td.getAttribute('style')).toBe('position:fixed;top:0');
    expect(found.td.getAttribute('onclick')).toBe("alert('click')");
  });
});

describe('RichText neutralises stored markup', () => {
  const html = () => render('table', HOSTILE);

  it('drops a <script> and its content entirely', () => {
    expect(html()).not.toMatch(/script/i);
    expect(html()).not.toContain('xss');
  });

  it('drops an <img> and the onerror= riding on it', () => {
    expect(html()).not.toMatch(/<img/i);
    expect(html()).not.toMatch(/onerror/i);
    expect(html()).not.toContain("alert('img')");
  });

  it('never emits a javascript: href, and leaves the link text behind', () => {
    expect(html()).not.toContain('javascript:');
    expect(html()).not.toMatch(/href/i);
    expect(html()).not.toMatch(/<a[\s>]/i);
    expect(html()).toContain('Rate');
  });

  it('drops every event handler, every style= and the <style> and <iframe> subtrees', () => {
    expect(html()).not.toMatch(/on(click|error|load)/i);
    expect(html()).not.toMatch(/style=/i);
    expect(html()).not.toMatch(/iframe|evil\.invalid/i);
    // A dropped tag takes its content with it: unwrapping <style> would spill
    // the stylesheet into the document as visible text.
    expect(html()).not.toContain('leaked');
  });

  it('still renders the table it was given, so none of the above passes vacuously', () => {
    expect(html()).toContain('<table>');
    expect(html()).toContain('Item');
    expect(html()).toContain('Duty');
    expect(html()).toContain('class="ai-reader-table"');
  });

  it('leaves markup inside a paragraph block as text, escaped by React', () => {
    const out = render('para', `<script>alert('xss')</script>`);
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toMatch(/<script/i);
  });
});

describe('RichText renders a table', () => {
  it('keeps rowspan and colspan as integers and drops the rest of the stored attributes', () => {
    const out = render('table', TARIFF);
    // React 19 writes the prop name through as given, and HTML attribute names
    // are case-insensitive, so rowSpan= and rowspan= are the same attribute.
    expect(out).toMatch(/rowspan="2"/i);
    expect(out).toMatch(/colspan="2"/i);
    expect(out).toContain('Tariff Item');
    expect(out).not.toMatch(/style=|border=/i);
  });

  it('drops a span that is not a positive integer', () => {
    const out = render('table', '<table><tr><td colspan="alert(1)" rowspan="0">a</td><td colspan="-2">b</td></tr></table>');
    expect(out).not.toMatch(/colspan|rowspan/i);
    expect(out).toContain('>a</td>');
  });

  it('unwraps an unknown tag to its content rather than dropping the content', () => {
    const out = render('table', '<div id="wrap"><table><tr><td><form action="//evil.invalid"><b>kept</b></form></td></tr></table></div>');
    expect(out).not.toMatch(/<form|id="wrap"|evil\.invalid/i);
    expect(out.match(/<div/g)).toHaveLength(1);   // the reader's own scroll wrapper, and nothing else
    expect(out).toContain('<b>kept</b>');
  });

  it('renders a Markdown pipe table as a real table with a header row', () => {
    const out = render('table', '| Page | Column | Read |\n|---|---|---|\n| 1 | 3 | "persons" |');
    expect(out).toContain('<th>Page</th>');
    expect(out).toContain('<td>1</td>');
    expect(out).toContain('&quot;persons&quot;');
    expect(out).not.toContain('---');
  });

  it('renders a pipe table with no rule as body rows only', () => {
    const out = render('table', '| a | b |\n| c | d |');
    expect(out).not.toContain('<th>');
    expect(out.match(/<tr>/g)).toHaveLength(2);
  });

  it('marks the whole block, because a parsed tree has no character range to slice', () => {
    expect(render('table', TARIFF, { from: 0, to: 10 })).toContain('ai-reader-table ai-reader-hit');
    expect(render('table', TARIFF)).not.toContain('ai-reader-hit');
  });

  it('reads as text when the environment cannot parse markup at all', () => {
    const parser = globalThis.DOMParser;
    delete globalThis.DOMParser;
    try {
      expect(render('table', TARIFF)).toContain('&lt;table');
    } finally {
      globalThis.DOMParser = parser;
    }
  });
});

describe('RichText renders headings and text', () => {
  it('renders a heading by # depth, without the hashes', () => {
    expect(render('heading', '# Chapter 98')).toBe('<h4>Chapter 98</h4>');
    expect(render('heading', '## Notes')).toBe('<h5>Notes</h5>');
    expect(render('heading', '###### Deep')).toBe('<h6>Deep</h6>');
  });

  it('places the mark on the exact characters of a paragraph block', () => {
    expect(render('para', 'alpha beta gamma', { from: 6, to: 10 }))
      .toBe('alpha <mark class="ai-reader-mark">beta</mark> gamma');
  });

  it('clips a mark that runs past the block, and ignores one that misses it', () => {
    expect(render('para', 'alpha beta', { from: 6, to: 900 }))
      .toBe('alpha <mark class="ai-reader-mark">beta</mark>');
    expect(render('para', 'alpha beta', { from: 40, to: 50 })).toBe('alpha beta');
  });

  it('keeps a heading mark inside the visible text when the span covers the hashes', () => {
    expect(render('heading', '## Notes', { from: 0, to: 8 }))
      .toBe('<h5><mark class="ai-reader-mark">Notes</mark></h5>');
  });

  it('renders a gap block as its literal whitespace, which is what reproduces the document', () => {
    expect(render('gap', '\n\n\n')).toBe('\n\n\n');
  });
});
