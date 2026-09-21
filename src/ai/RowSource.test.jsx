import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RowSource from './RowSource.jsx';

const snapshot = {
  id: '156-Lok Sabha-2026-08-09-THE NATIONAL CO-OPERATIVE DEVELOPMENT CO',
  bill_name: 'THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026',
  bill_number: '156',
  house: 'Lok Sabha',
  current_stage: 'Passed',
  date_introduced: '2026-08-09 19:00:00',
  source_url: 'https://sansad.in/rs/legislation',
};

const base = {
  id: 2,
  kind: 'row',
  tier: 'national',
  feature: 'Bill Passage Probability Index',
  row_key: '156-lok sabha-2026-08-09-the national co-operative development co',
  title: snapshot.bill_name,
  row_snapshot: snapshot,
};

describe('RowSource', () => {
  it('renders the record detail from the snapshot with the captured-on date and Open in desk', () => {
    const html = renderToStaticMarkup(<RowSource citation={{ ...base, snapshot_at: '2026-09-07T18:02:04.432Z' }} onClose={() => {}} />);
    expect(html).toContain('THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026');
    expect(html).toContain('Lok Sabha');
    expect(html).toContain('as captured on 2026-09-07');
    expect(html).toContain('Open in desk');
    expect(html).toContain('Bill Passage Probability Index');
  });

  it('hides the date and the button for the injected selection (no snapshot)', () => {
    const html = renderToStaticMarkup(<RowSource citation={{ ...base, snapshot_at: null }} onClose={() => {}} />);
    expect(html).toContain('THE NATIONAL CO-OPERATIVE');
    expect(html).not.toContain('as captured on');
    expect(html).not.toContain('Open in desk');
  });

  it('renders nothing for a text citation or a missing snapshot', () => {
    expect(renderToStaticMarkup(<RowSource citation={{ kind: 'text' }} onClose={() => {}} />)).toBe('');
    expect(renderToStaticMarkup(<RowSource citation={{ ...base, row_snapshot: null }} onClose={() => {}} />)).toBe('');
  });
});
