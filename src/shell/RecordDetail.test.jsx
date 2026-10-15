// Found by the F21 lint probe: SourceBriefBlock used useState, useEffect and
// resolveOrganisedBrief without importing them, so the right rail's record
// detail threw a ReferenceError for any selected row that has no analysis or
// CSV (RightRail renders RecordDetail with generateBrief on by default).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
import RecordDetail from './RecordDetail.jsx';

describe('RecordDetail', () => {
  it('renders a plain row with the generated brief block, without throwing', () => {
    const row = { id: 'r1', title: 'Cabinet approves a scheme', source_url: 'https://pib.gov.in/x', date: '2026-09-07' };
    const html = renderToStaticMarkup(createElement(RecordDetail, { row, feed: { feature: 'Cabinet Decisions', tier: 'national' }, onClear: () => {} }));
    expect(html).toContain('Cabinet approves a scheme');
  });

  // F123 (owner 2026-10-15): every record view has the stored AI brief, in the record panels' card.
  it('shows the record brief card, writing on first render', () => {
    const row = { id: 'r2', title: 'State rolls out a scheme', source_url: 'https://example.gov.in/x' };
    const html = renderToStaticMarkup(createElement(RecordDetail, { row, feed: { feature: 'Local Governance Brief', tier: 'state' }, onClear: () => {} }));
    expect(html).toContain('✦ Niyantran analysis');
    expect(html).toContain('Writing AI brief…');
  });

  it('asks for no record brief in a citation view (generateBrief off)', () => {
    const row = { id: 'r3', title: 'A cited row', source_url: 'https://example.gov.in/y' };
    const html = renderToStaticMarkup(createElement(RecordDetail, {
      row, feed: { feature: 'Local Governance Brief', tier: 'state' }, onClear: () => {}, generateBrief: false,
    }));
    expect(html).toContain('A cited row');
    expect(html).not.toContain('Writing AI brief…');
  });
});
