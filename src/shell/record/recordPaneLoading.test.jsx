import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ brief: { state: 'loading', record: 'row-a' } }));
vi.mock('./useRecordBrief.js', () => ({ useRecordBrief: () => state.brief, RECORD_BRIEF_ANIMATION_MS: 2500 }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: { auth: {} } }));
import RecordPanel, { RecordPaneLoading } from './RecordPanel.jsx';
import RecordDetail from '../RecordDetail.jsx';
import NationalRecord from '../../desks/NationalRecord.jsx';

const row = { id: 'pane-test', title: 'Visible record details', source_url: 'https://example.gov.in/record' };
const feed = { tier: 'national', feature: 'Industry Updates (Ministry Data)' };
const renderers = {
  adapted: (onClose) => <RecordPanel model={{ title: row.title }} brief={state.brief} onClose={onClose} />,
  fallback: (onClose) => <RecordDetail row={row} feed={feed} onClear={onClose} />,
  national: (onClose) => <NationalRecord row={row} feed={feed} feature={feed.feature} onClear={onClose} />,
};

beforeEach(() => { state.brief = { state: 'loading', record: 'row-a' }; });
for (const [name, render] of Object.entries(renderers)) {
  describe(`${name} pane-wide loading`, () => {
    for (const waiting of ['loading', 'writing', 'pending']) {
      it(`replaces record details with one full-pane animation for ${waiting}`, () => {
        state.brief = { state: waiting, record: 'row-a' };
        const html = renderToStaticMarkup(render(vi.fn()));
        expect(html).toContain('rp-record-loading');
        expect(html).toContain('aria-busy="true"');
        expect(html.match(/<nter-record-loader/g)).toHaveLength(1);
        expect(html).toContain('aria-label="Close record"');
        expect(html).not.toContain(row.title);
        expect(html).toContain(waiting === 'loading' ? 'Loading the AI brief…' : 'Writing the AI brief…');
      });
    }
    for (const terminal of ['ready', 'error', 'unavailable', 'none']) {
      it(`reveals details and removes the pane loader for ${terminal}`, () => {
        state.brief = { state: terminal, brief: 'Stored analysis', record: 'row-a' };
        const html = renderToStaticMarkup(render(vi.fn()));
        expect(html).toContain(row.title);
        expect(html).not.toContain('rp-record-loading');
        expect(html).not.toContain('<nter-record-loader');
      });
    }
  });
}

it('keeps Close record connected while waiting', () => {
  const close = vi.fn();
  const tree = RecordPaneLoading({ brief: state.brief, onClose: close });
  tree.props.children[0].props.onClick();
  expect(close).toHaveBeenCalledTimes(1);
});
