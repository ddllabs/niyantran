import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MessageRow, { sameRow } from './MessageRow.jsx';
import WebSourceStrip from './WebSourceStrip.jsx';

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

// F131 §3: the "From the web" strip sits at the top of the answer, after the thinking notes; the row
// F130 drew under the answer is gone. The document source list stays under the answer.
describe('web sources at the top of the answer', () => {
  const WEB_SOURCES = [
    { url: 'https://www.rbi.org.in/a', title: 'RBI', domain: 'rbi.org.in', cited: true },
    { url: 'https://pib.gov.in/b', title: 'PIB', domain: 'pib.gov.in', cited: false },
  ];
  const doc = { id: 1, kind: 'text', chunk_id: 'c1', document_id: 'd1', title: 'The Delimitation Bill, 2026', char_from: 0, char_to: 40, text_hash: 'h', source_kind: 'document' };

  it('shows the strip after the ticker and above the answer text, and the document sources under the answer', () => {
    const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, content: 'ANSWER_TEXT [1].', sources: [doc], webSources: WEB_SOURCES }} />);
    expect(html).toContain('<span class="ai-web-strip-label">Web sources</span>');
    expect(html).toContain('2 pages');
    expect(html.match(/class="ai-web-strip"/g)).toHaveLength(1);
    expect(html.indexOf('ai-ticker')).toBeGreaterThan(-1);
    expect(html.indexOf('ai-ticker')).toBeLessThan(html.indexOf('ai-web-strip'));
    expect(html.indexOf('ai-web-strip')).toBeLessThan(html.indexOf('ANSWER_TEXT'));
    expect(html.indexOf('ANSWER_TEXT')).toBeLessThan(html.indexOf('ai-sources-block'));
    expect(html.slice(html.indexOf('ANSWER_TEXT'))).not.toContain('ai-web-strip');
    expect(html).not.toContain('ai-web-row');
  });

  it('says how many searches the saved turn ran, from its web_search steps', () => {
    const activity = [{ type: 'tool', name: 'web_search', step: 1, resultCount: 2, searches: 3, status: 'ok' }];
    const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, activity, webSources: WEB_SOURCES }} />);
    expect(html).toContain('2 pages from 3 searches');
    expect(html).not.toContain('ai-web-strip searching');
  });

  it('shows no strip without web sources: absent, empty, or on an old message', () => {
    for (const webSources of [undefined, [], null]) {
      const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, webSources }} />);
      expect(html).not.toContain('ai-web-strip');
    }
    expect(renderToStaticMarkup(<MessageRow {...base} m={{ id: 'u1', role: 'user', content: 'Q', webSources: WEB_SOURCES }} />)).not.toContain('ai-web-strip');
  });

  it('keeps web sources out of the document source list and the citation count', () => {
    const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, sources: [], webSources: WEB_SOURCES }} />);
    expect(html).not.toContain('ai-sources-block');
  });

  it('passes the web sources to the markdown, so a link to a searched page gets the site icon', () => {
    const html = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, content: 'See [RBI](https://www.rbi.org.in/a).', webSources: WEB_SOURCES }} />);
    expect(html).toContain('ai-web-link');
    const none = renderToStaticMarkup(<MessageRow {...base} m={{ ...m, content: 'See [RBI](https://www.rbi.org.in/a).' }} />);
    expect(none).not.toContain('ai-web-link');
  });

  it('clicking the strip opens the web list through onOpenSource', () => {
    const opened = [];
    const tree = MessageRow.type({ ...base, m: { ...m, webSources: WEB_SOURCES }, onOpenSource: (s) => opened.push(s) });
    const strip = findStrip(tree);
    expect(strip).toBeTruthy();
    expect(strip.props).toMatchObject({ sources: WEB_SOURCES, messageId: 'a1' });
    // The strip's own click payload is tested in WebSourceStrip.test.jsx; here it must be wired to onOpenSource.
    WebSourceStrip({ ...strip.props }).props.onClick();
    expect(opened).toEqual([{ kind: 'web', pages: WEB_SOURCES, searches: null, messageId: 'a1' }]);
  });
});

function findStrip(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findStrip(n); if (f) return f; } return null; }
  if (node.type === WebSourceStrip) return node;
  return findStrip(node.props?.children);
}

// Security pass M1: the message links only to its searched pages and its cited documents' files.
it('a saved answer links only to its web sources and cited files; any other link is plain text', () => {
  const m = {
    id: 'm1', role: 'assistant', status: 'complete',
    content: 'Per [RBI](https://rbi.org.in/x), the [bill](https://sansad.in/b.pdf) and [this](https://evil.example/p).',
    sources: [{ id: 1, kind: 'text', chunk_id: 'c', document_id: 'd', title: 'Bill', file_url: 'https://sansad.in/b.pdf', char_from: 0, char_to: 1, text_hash: 'h', source_kind: 'document' }],
    webSources: [{ url: 'https://rbi.org.in/x', title: 'RBI', domain: 'rbi.org.in', cited: true }],
  };
  const html = renderToStaticMarkup(<MessageRow m={m} lang="en" labelOf={(x) => x} onOpenSource={() => {}} />);
  expect(html).toContain('href="https://rbi.org.in/x"');
  expect(html).toContain('href="https://sansad.in/b.pdf"');
  expect(html).not.toContain('evil.example');
});

// F111 task 4b (docs/specs/2026-10-14-ai-credits.md §8): the credits an answer used, quietly, with the
// copy button and time. Only what the server has said; nothing is shown as 0 by guess.
describe('credits used by an answer', () => {
  const done = { ...m, status: 'complete', at: 1791000000000 };
  const out = (props) => renderToStaticMarkup(<MessageRow {...base} {...props} />);

  it('shows a finished answer\'s credits beside its actions', () => {
    const html = out({ m: done, credits: 38 });
    expect(html).toContain('<span class="ai-credit-used">38 credits</span>');
    expect(html.indexOf('ai-message-actions')).toBeLessThan(html.indexOf('ai-credit-used'));
  });

  it('formats like the rest of the app, and says "1 credit" for one', () => {
    expect(out({ m: done, credits: 1520.4 })).toContain('>1,520 credits<');
    expect(out({ m: done, credits: 4.5 })).toContain('>4.5 credits<');
    expect(out({ m: done, credits: 1 })).toContain('>1 credit<');
  });

  it('shows what a stopped answer was charged', () => {
    expect(out({ m: { ...done, status: 'cancelled' }, credits: 12 })).toContain('>12 credits<');
  });

  it('says "No credits used" for a failed answer with no text, and for a charge of nothing', () => {
    const failed = { ...done, status: 'error', content: '' };
    expect(out({ m: failed })).toContain('>No credits used<');
    expect(out({ m: { ...failed, status: 'interrupted' } })).toContain('>No credits used<');
    expect(out({ m: done, credits: 0 })).toContain('>No credits used<');
  });

  it('never says "No credits used" for a stopped answer: unknown shows nothing, known shows the number (review R, I1)', () => {
    const stopped = { ...done, status: 'cancelled' };
    for (const credits of [undefined, null, NaN]) expect(out({ m: stopped, credits })).not.toContain('ai-credit-used');
    expect(out({ m: stopped, credits: 7.5 })).toContain('>7.5 credits<');
    expect(out({ m: stopped, credits: 0 })).toContain('>0 credits<');
    expect(out({ m: { ...stopped, content: '' } })).not.toContain('No credits used');
    expect(out({ m: { ...stopped, content: '' }, credits: null })).not.toContain('ai-credit-used');
  });

  it('a failed answer that still showed text is charged like any other', () => {
    const partial = { ...done, status: 'error', content: 'Half an answer' };
    expect(out({ m: partial, credits: 9 })).toContain('>9 credits<');
    expect(out({ m: partial })).not.toContain('ai-credit-used');
  });

  it('shows nothing when the credits are unknown, never a guessed zero', () => {
    for (const credits of [undefined, null, NaN]) expect(out({ m: done, credits })).not.toContain('ai-credit-used');
    expect(out({ m: { ...done, status: 'running' }, credits: 5 })).not.toContain('ai-credit-used');
    expect(out({ m: { id: 'u1', role: 'user', content: 'Question?' }, credits: 5 })).not.toContain('ai-credit-used');
  });

  it('reads and shows credits only: no dollars, and no cost field', () => {
    const html = out({ m: { ...done, usage: { cost_usd: 0.04, observed: { cost_usd: 0.04 } }, cost: 0.04 }, credits: 38 });
    expect(html).not.toMatch(/\$|USD|cost/i);
  });

  it('is part of the row\'s render identity', () => {
    expect(sameRow({ ...base, credits: 1 }, { ...base, credits: 1 })).toBe(true);
    expect(sameRow({ ...base, credits: 1 }, { ...base, credits: 2 })).toBe(false);
    expect(sameRow({ ...base }, { ...base, credits: 2 })).toBe(false);
  });
});
