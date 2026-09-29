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
});
