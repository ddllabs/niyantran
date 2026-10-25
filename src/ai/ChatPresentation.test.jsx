import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import CitationBubble from './CitationBubble.jsx';
import SourceList from './SourceList.jsx';
import SuggestionPills from './SuggestionPills.jsx';

const source = { id: 1, kind: 'text', title: 'Bill', chunk_id: 'chunk', document_id: 'doc', char_from: 0, char_to: 5, text_hash: 'hash', source_kind: 'document' };
it('selects the opened passage rather than every repeated reference number', () => {
  const render = selectedSource => renderToStaticMarkup(<CitationBubble n={1} source={source} selectedSource={selectedSource} />);
  expect(render(source)).toContain('aria-pressed="true"');
  expect(render({ ...source, chunk_id: 'other' })).toContain('aria-pressed="false"');
});
it('gives each citation its own action alongside the document CTA', () => {
  const html = renderToStaticMarkup(<SourceList sources={[source, { ...source, id: 2 }]} />);
  expect(html).toContain('Cited passages');
  expect(html).not.toContain('<details');
  expect((html.match(/<button/g)||[])).toHaveLength(3);
  expect(html).toContain('aria-label="Source 1: Bill"');
  expect(html).toContain('Open citations');
});
it('keeps every suggestion directly available without a More questions disclosure', () => {
  const html = renderToStaticMarkup(<SuggestionPills questions={['First?', 'Second?', 'Third?']} label="Follow-ups" />);
  expect(html).not.toContain('<details');
  expect((html.match(/<button/g)||[])).toHaveLength(3);
  expect(html).toContain('Third?');
});
