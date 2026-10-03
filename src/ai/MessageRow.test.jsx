import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import MessageRow, { sameRow } from './MessageRow.jsx';

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
