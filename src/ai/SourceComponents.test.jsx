import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SourceList, { documentChips } from './SourceList.jsx';
import SourceReader from './SourceReader.jsx';

const text = (id, document_id, title, extra = {}) => ({
  id, kind: 'text', chunk_id: `c${id}`, document_id, title, char_from: 0, char_to: 5, text_hash: 'h', source_kind: 'document', ...extra,
});
const row = { id: 9, kind: 'row', tier: 'national', feature: 'Bills', row_key: 'k', title: 'A bill', row_snapshot: {}, snapshot_at: null };

describe('SourceList', () => {
  it('renders one chip per distinct document, in first-citation order, ignoring row citations', () => {
    const sources = [text(1, 'd2', 'Second doc'), text(2, 'd1', 'First doc', { file_name: 'first.pdf' }), text(3, 'd2', 'Second doc'), row];
    expect(documentChips(sources).map((c) => c.document_id)).toEqual(['d2', 'd1']);
    expect(documentChips(sources)[0].first.id).toBe(1);
    const html = renderToStaticMarkup(<SourceList sources={sources} />);
    expect(html.match(/ai-source-chip/g)).toHaveLength(2);
    expect(html).toContain('first.pdf');
    expect(html.indexOf('Second doc')).toBeLessThan(html.indexOf('First doc'));
  });

  it('renders nothing without text sources', () => {
    expect(renderToStaticMarkup(<SourceList sources={[row]} />)).toBe('');
    expect(renderToStaticMarkup(<SourceList sources={[]} />)).toBe('');
  });
});

describe('SourceReader', () => {
  it('renders the citation header and the loading state before the document arrives', () => {
    const never = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) };
    const html = renderToStaticMarkup(<SourceReader citation={text(1, 'd1', 'Gazette 2005', { file_name: '2005-115-gaz.pdf' })} client={never} />);
    expect(html).toContain('Gazette 2005');
    expect(html).toContain('2005-115-gaz.pdf');
    expect(html).toContain('Loading…');
    expect(html).not.toContain('Open file');
  });
});
