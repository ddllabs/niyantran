// F15: the question pills are a labelled list of buttons, so a screen reader
// announces how many suggestions there are and what they are for.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SuggestionPills from './SuggestionPills.jsx';

describe('SuggestionPills', () => {
  it('renders a labelled list with one item per question', () => {
    const html = renderToStaticMarkup(createElement(SuggestionPills, { questions: ['First?', 'Second?', ' '], label: 'Suggested follow-up questions' }));
    expect(html).toMatch(/^<ul class="ai-suggest ai-v2-suggest" role="list" aria-label="Suggested follow-up questions">/);
    expect(html.match(/<li role="listitem">/g)).toHaveLength(2);
    expect(html.match(/<button type="button">/g)).toHaveLength(2);
    expect(html).not.toContain('role="group"');
  });

  it('renders nothing without questions', () => {
    expect(renderToStaticMarkup(createElement(SuggestionPills, { questions: [], label: 'x' }))).toBe('');
  });
});
