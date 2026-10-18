// Found by the F21 lint probe: SourceBriefBlock used useState, useEffect and
// resolveOrganisedBrief without importing them, so the right rail's record
// detail threw a ReferenceError for any selected row that has no analysis or
// CSV (RightRail renders RecordDetail with generateBrief on by default).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient.js', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
const briefState = vi.hoisted(() => ({ current: { state: 'ready', brief: 'Stored analysis' } }));
vi.mock('./record/useRecordBrief.js', () => ({
  useRecordBrief: ({ selected }) => selected ? briefState.current : { state: 'none' },
  RECORD_BRIEF_ANIMATION_MS: 2500,
}));
beforeEach(() => { briefState.current = { state: 'ready', brief: 'Stored analysis' }; });
import RecordDetail from './RecordDetail.jsx';

describe('RecordDetail', () => {
  it('renders a plain row with the generated brief block, without throwing', () => {
    const row = { id: 'r1', title: 'Cabinet approves a scheme', source_url: 'https://pib.gov.in/x', date: '2026-09-07' };
    const html = renderToStaticMarkup(createElement(RecordDetail, { row, feed: { feature: 'Cabinet Decisions', tier: 'national' }, onClear: () => {} }));
    expect(html).toContain('Cabinet approves a scheme');
  });

  // F123 (owner 2026-10-15): every record view has the stored AI brief, in the record panels' card.
  it('shows a full-pane loader on first render', () => {
    briefState.current = { state: 'loading', record: 'r2' };
    const row = { id: 'r2', title: 'State rolls out a scheme', source_url: 'https://example.gov.in/x' };
    const html = renderToStaticMarkup(createElement(RecordDetail, { row, feed: { feature: 'Local Governance Brief', tier: 'state' }, onClear: () => {} }));
    expect(html).toContain('rp-record-loading');
    expect(html).not.toContain('State rolls out a scheme');
    expect(html).toContain('Loading the AI brief…');
  });

  // Owner 2026-10-15: one analysis box per record. Where the AI brief card is shown, the code-written
  // box (the Goa packs' brief / why_it_matters / watch_for / tags, or Open Fronts' template) is not;
  // those row fields are listed in All fields instead.
  describe('one analysis box', () => {
    const GOA_ROW = {
      ac: 1,
      name: 'Mandrem',
      district: 'North Goa',
      electors: 32242,
      title: 'Mandrem',
      brief: 'Mandrem has 32,242 electors across 48 booths.',
      why_it_matters: 'BJP polled 32.68% here at the 2022 Assembly.',
      watch_for: 'The seat has had 3 distinct winners across the last four polls.',
      tags: ['Mandrem', 'North Goa'],
    };
    const GOA_FEED = { tier: 'state', feature: 'Constituency Register', meta: { vintage: 'SIR final roll 2026 · elections 2017–2024' } };
    const render = (props) => renderToStaticMarkup(createElement(RecordDetail, { onClear: () => {}, ...props }));
    const field = (k, v) => `<div class="rdf-key">${k}</div><div class="rdf-val">${v}</div>`;

    it('shows only the AI brief card in a record view, and lists the row\'s analysis fields in All fields', () => {
      const html = render({ row: GOA_ROW, feed: GOA_FEED });
      expect(html.match(/niyantran analysis/gi)).toHaveLength(1);
      expect(html).toContain('Stored analysis');
      expect(html).not.toContain('rd-section rd-ai');
      expect(html).toContain(field('Brief', GOA_ROW.brief));
      expect(html).toContain(field('Why It Matters', GOA_ROW.why_it_matters));
      expect(html).toContain(field('Watch For', GOA_ROW.watch_for));
      expect(html).toContain(field('Tags', 'Mandrem, North Goa'));
    });

    it('shows no Open Fronts template analysis where the AI brief card is shown', () => {
      const row = { conflict_name: 'Russia–Ukraine War', region: 'Eastern Europe', conflict_type: 'Interstate war', current_stage: 'active' };
      const html = render({ row, feed: { tier: 'geopolitics', feature: 'Open Fronts' } });
      expect(html.match(/niyantran analysis/gi)).toHaveLength(1);
      expect(html).not.toContain('is tracked in Open Fronts as');
    });

    it('keeps the code-written box where no AI brief card is shown (a citation view)', () => {
      const html = render({ row: GOA_ROW, feed: GOA_FEED, generateBrief: false });
      expect(html).toContain('✦ NIYANTRAN ANALYSIS');
      expect(html).toContain(GOA_ROW.brief);
      expect(html.match(/BJP polled 32\.68% here/g)).toHaveLength(1);
      expect(html).not.toContain(field('Why It Matters', GOA_ROW.why_it_matters));
    });
  });

  // Owner 2026-10-15: "Source date" and "Last verified" were blank whenever the row had no date
  // fields. They fall back to what the feed's answer carries, labelled as the dataset's or the
  // fetch's, never as the record's own.
  describe('provenance fallbacks', () => {
    const cell = (html, label) => html.match(new RegExp(`<span class="rd-prov-k">${label}</span><span class="rd-prov-v">(.*?)</span>`))?.[1];
    const render = (row, feed) => renderToStaticMarkup(createElement(RecordDetail, { row, feed, onClear: () => {}, generateBrief: false }));
    const ROW = { title: 'A record with no dates', ministry: 'Law' };

    it('uses the row\'s own date and verified fields first', () => {
      const html = render({ ...ROW, date: '2026-05-12', last_verified: '2026-09-07' },
        { tier: 'national', feature: 'Cabinet Decisions', served: 'store', fetchedAt: '2026-10-15T08:57:08.221Z', coverage: { through: '2026-10-14' } });
      expect(cell(html, 'Source date')).toBe('12 May 2026');
      expect(cell(html, 'Last verified')).toBe('07 Sep 2026');
    });

    it('falls back to the dataset as-of date and the store\'s fetch time, in India time', () => {
      const html = render(ROW, { tier: 'national', feature: 'Cabinet Decisions', served: 'store', fetchedAt: '2026-10-15T08:57:08.221Z', coverage: { from: '', through: '2026-10-14' } });
      expect(cell(html, 'Source date')).toBe('dataset as of 14 Oct 2026');
      expect(cell(html, 'Last verified')).toBe('fetched 15 Oct 2026 · 14:27 IST');
    });

    it('prefers the answer\'s meta as-of to coverage, and says a register was loaded, not fetched', () => {
      const html = render(ROW, { tier: 'state', feature: 'MLA Directory', served: 'store', register: true, fetchedAt: '2026-10-15T08:57:08.221Z',
        meta: { as_of: '2026-08-19' }, coverage: { through: '2026-08-01' } });
      expect(cell(html, 'Source date')).toBe('dataset as of 19 Aug 2026');
      expect(cell(html, 'Last verified')).toBe('register loaded 15 Oct 2026 · 14:27 IST');
    });

    it('names a geography pack\'s vintage when the answer gives no date', () => {
      const vintage = 'SIR final roll 2026 · elections 2017–2024';
      const html = render(ROW, { tier: 'state', feature: 'Constituency Register', served: 'live', coverage: { from: vintage, through: '' }, meta: { vintage } });
      expect(cell(html, 'Source date')).toBe(`dataset vintage: ${vintage}`);
      expect(cell(html, 'Last verified')).toBe('—');
      // A store copy of such an answer keeps the vintage in coverage.from only.
      expect(cell(render(ROW, { coverage: { from: vintage, through: '' } }), 'Source date')).toBe(`dataset vintage: ${vintage}`);
    });

    it('uses a fetch time the answer\'s meta or source carries', () => {
      expect(cell(render(ROW, { meta: { fetched_at: '2026-10-15T00:00:00Z' } }), 'Last verified')).toBe('fetched 15 Oct 2026 · 05:30 IST');
      expect(cell(render(ROW, { source: { verifiedAt: '2026-10-14T18:30:00Z' } }), 'Last verified')).toBe('source checked 15 Oct 2026 · 00:00 IST');
    });

    it('stays blank when the answer carries nothing dated ("present" is not a date)', () => {
      const html = render(ROW, { tier: 'national', feature: 'Policy Pipeline Tracker (Draft-to-Gazette)', served: 'live', coverage: { from: '', through: 'present' } });
      expect(cell(html, 'Source date')).toBe('—');
      expect(cell(html, 'Last verified')).toBe('—');
    });
  });

  it('asks for no record brief in a citation view (generateBrief off)', () => {
    const row = { id: 'r3', title: 'A cited row', source_url: 'https://example.gov.in/y' };
    const html = renderToStaticMarkup(createElement(RecordDetail, {
      row, feed: { feature: 'Local Governance Brief', tier: 'state' }, onClear: () => {}, generateBrief: false,
    }));
    expect(html).toContain('A cited row');
    expect(html).not.toContain('Loading the AI brief…');
    expect(html).not.toContain('Writing the AI brief…');
  });
});
