import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MessageRow, { sameRow } from './MessageRow.jsx';
import WebSourceRow from './WebSourceRow.jsx';

// panel-loading spec E: a saved message re-renders (and its markdown is parsed again) only when
// something it shows changed - not on every streaming frame, keystroke or controller emit.
const m = { id: 'a1', role: 'assistant', content: 'The Bill [1].', sources: [], model: 'google/gemini-3.8-flash' };
const labelOf = (id) => (id === 'google/gemini-3.8-flash' ? 'Gemini - Flash' : id);
const open = () => {};
const base = { m, lang: 'en', fallbackLabel: 'Niyantran', labelOf, onOpenSource: open };

it('E: equal props skip the re-render; a changed message, label source or language does not', () => {
  expect(sameRow(base, { ...base })).toBe(true);
  expect(sameRow(base, { ...base, m: { ...m, content: 'Changed.' } })).toBe(false);
  expect(sameRow(base, { ...base, labelOf: (id) => id })).toBe(false);
  expect(sameRow(base, { ...base, lang: 'hi' })).toBe(false);
});

it('E: the row renders what the inline markup did', () => {
  const html = renderToStaticMarkup(<MessageRow {...base} />);
  expect(html).toContain('class="ai-msg ai-msg-assistant"');
  expect(html).not.toContain('<span>Gemini - Flash</span>');
  expect(html).toContain('Gemini - Flash · Answered');
  expect(renderToStaticMarkup(<MessageRow {...base} m={{ id: 'u1', role: 'user', content: 'Question?' }} />)).not.toContain('<span>You</span>');
});

it('keeps user actions outside the colored message bubble',()=>{
  const html=renderToStaticMarkup(<MessageRow {...base} m={{id:'u1',role:'user',content:'Question?',at:1791000000000}} />);
  expect(html).toContain('class="ai-user-bubble">Question?</div><div class="ai-message-actions"');
  expect(html).toContain('aria-label="Copy message"');
  expect(html).toContain('<time');
});

// F124 T4b: the "From the web" row sits after the document sources, only when there are web sources.
describe('web sources under the answer', () => {
  const WEB_SOURCES = [
    { url: 'https://www.rbi.org.in/a', title: 'RBI', domain: 'rbi.org.in', cited: true },
    { url: 'https://pib.gov.in/b', title: 'PIB', domain: 'pib.gov.in', cited: false },
  ];
  const doc = { id: 1, kind: 'text', chunk_id: 'c1', document_id: 'd1', title: 'The Delimitation Bill, 2026', char_from: 0, char_to: 40, text_hash: 'h', source_kind: 'document' };

  it('shows the row for a message with web sources, after the document source list', () => {
    const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, content: 'Answer [1].', sources: [doc], webSources: WEB_SOURCES }} />);
    expect(html).toContain('From the web · unofficial');
    expect(html).toContain('2 sources');
    expect(html.indexOf('ai-sources-block')).toBeGreaterThan(-1);
    expect(html.indexOf('ai-sources-block')).toBeLessThan(html.indexOf('From the web'));
  });

  it('shows no row without web sources: absent, empty, or on an old message', () => {
    for (const webSources of [undefined, [], null]) {
      const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, webSources }} />);
      expect(html).not.toContain('From the web');
    }
    expect(renderToStaticMarkup(<MessageRow {...base} m={{ id: 'u1', role: 'user', content: 'Q', webSources: WEB_SOURCES }} />)).not.toContain('From the web');
  });

  it('keeps web sources out of the document source list and the citation count', () => {
    const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, sources: [], webSources: WEB_SOURCES }} />);
    expect(html).not.toContain('ai-sources-block');
  });

  it('passes the web sources to the markdown, so a link to a searched page gets the web mark', () => {
    const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, content: 'See [RBI](https://www.rbi.org.in/a).', webSources: WEB_SOURCES }} />);
    expect(html).toContain('ai-web-link');
    const none = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, content: 'See [RBI](https://www.rbi.org.in/a).' }} />);
    expect(none).not.toContain('ai-web-link');
  });

  it('clicking the row opens the web list through onOpenSource', () => {
    const opened = [];
    const tree = MessageRow.type({ ...base, m: { ...m, webSources: WEB_SOURCES }, onOpenSource: (s) => opened.push(s) });
    const row = findWebRow(tree);
    expect(row).toBeTruthy();
    expect(row.props).toMatchObject({ sources: WEB_SOURCES, messageId: 'a1' });
    // The row's own click payload is tested in WebSourceRow.test.jsx; here it must be wired to onOpenSource.
    WebSourceRow({ ...row.props }).props.onClick();
    expect(opened).toEqual([{ kind: 'web', pages: WEB_SOURCES, messageId: 'a1' }]);
  });
});

function findWebRow(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findWebRow(n); if (f) return f; } return null; }
  if (node.type === WebSourceRow) return node;
  return findWebRow(node.props?.children);
}
