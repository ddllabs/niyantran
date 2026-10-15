// F123 (owner 2026-10-15: every record panel has the stored AI brief): the National modules
// without a record-panel adapter render GenericRecord, which asks for the record brief through
// useRecordBrief and shows it in the same card as the record panels.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
import NationalRecord from './NationalRecord.jsx';

const row = { id: 'iu-1', title: 'Steel ministry notifies a quality order', source_url: 'https://pib.gov.in/x', date: '2026-10-14' };
const feed = { feature: 'Industry Updates (Ministry Data)', tier: 'national' };
const render = (props) => renderToStaticMarkup(<NationalRecord row={row} feature={feed.feature} onClear={() => {}} {...props} />);

describe('NationalRecord GenericRecord AI brief', () => {
  it('shows the record brief card, loading on first render', () => {
    const out = render({ feed, loading: false });
    expect(out).toContain('Steel ministry notifies a quality order');
    expect(out).toContain('✦ Niyantran analysis');
    expect(out).toContain('Loading the AI brief…');
  });

  it('shows no brief card while the feed loads', () => {
    expect(render({ feed, loading: true })).not.toContain('Niyantran analysis');
  });
});
