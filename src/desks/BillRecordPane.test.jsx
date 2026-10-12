import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../shell/EntryBriefInline.jsx', () => ({ useEntryBrief: () => ({ brief: null }), briefPlainLines: () => [] }));
import BillRecordPane from './BillRecordPane.jsx';

describe('record facts without a provisional relationship graph', () => {
  it.each(['bill', 'pipeline', 'question', 'regulatory'])('preserves record actions and removes graph presentation for %s', desk => {
    const html = renderToStaticMarkup(<BillRecordPane desk={desk}
      row={{ title: 'Record fixture', bill_name: 'Record fixture', sector: 'Finance', ministry: 'Finance', source_url: 'https://example.invalid/record' }} />);
    expect(html).not.toContain('Linkage graph for');
    expect(html).not.toContain('Rebuild layout');
    expect(html).not.toContain('Where the impact lands');
    expect(html).not.toContain('How the impact travels');
    expect(html).not.toContain('Link strength');
    expect(html).toContain('Full reasoning');
    expect(html).toContain('Ask AI');
    expect(html).toContain('https://example.invalid/record');
    expect(html).toContain('What this');
  });
});
