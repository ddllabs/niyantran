import { describe, expect, it } from 'vitest';
import { contractProblems } from './modelContract.js';

const base = () => ({
  title: 'A record',
  glance: { tiles: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] },
  about: { label: '02 · About' },
  footer: { ask: 'Ask AI', provenance: { source: 'Register', asOf: '07 Sep 2026' } },
});

// F121: the contract eleven more adapters inherit. Each check must fail for the defect it guards.
describe('record panel contract', () => {
  it('accepts a minimal honest model', () => {
    expect(contractProblems(base())).toEqual([]);
  });

  it('requires an as-of date, or an explicit flag that none is on record', () => {
    const m = base();
    delete m.footer.provenance.asOf;
    expect(contractProblems(m)).toContain('missing as-of date');
    m.footer.provenance.flags = ['as-of not on record'];
    expect(contractProblems(m)).toEqual([]);
  });

  it('rejects a visual type the renderer cannot draw, and malformed map or timeline visuals', () => {
    const m = base();
    m.glance.visual = { type: 'orbit', title: 'Orbit' };
    expect(contractProblems(m).join()).toMatch(/unsupported visual type orbit/);
    m.glance.visual = { type: 'map', title: 'Map', points: [{ lat: 'x', lon: 2, label: '' }] };
    expect(contractProblems(m).join()).toMatch(/map point/);
    m.glance.visual = { type: 'timeline', title: 'Stages', steps: [{ label: 'A', now: true }, { label: 'B', now: true }] };
    expect(contractProblems(m).join()).toMatch(/one current step/);
  });

  it('accepts a well-formed value board and rejects an empty or unlabelled one', () => {
    const m = base();
    m.glance.visual = { type: 'board', title: 'Latest year', rows: [{ label: 'GDP growth', value: '6.5%', note: '2024', tone: 'green' }] };
    expect(contractProblems(m)).toEqual([]);
    m.glance.visual = { type: 'board', title: 'Latest year', rows: [] };
    expect(contractProblems(m).join()).toMatch(/board has no rows/);
    m.glance.visual = { type: 'board', title: 'Latest year', rows: [{ label: 'GDP growth', value: '' }] };
    expect(contractProblems(m).join()).toMatch(/board row/);
    m.glance.visual = { type: 'board', title: 'Latest year', rows: [{ label: 'GDP growth', value: '6.5%', tone: 'pink' }] };
    expect(contractProblems(m).join()).toMatch(/bad tone pink/);
    m.glance.visual = { type: 'board', title: 'Latest year', rows: [{ label: 'GDP growth', value: '6.5%' }, { label: 'GDP growth', value: '6.1%' }] };
    expect(contractProblems(m).join()).toMatch(/duplicate board row GDP growth/);
  });

  it('accepts a touch link that opens a related row, and rejects a row that is not a record', () => {
    const m = base();
    m.touches = { label: '03', lanes: ['A', 'B', 'C', 'D'], nodes: { center: { l1: 'This' } }, links: [{ title: 'Other', detail: 'x', row: { title: 'Other', note: '[date]', seat: 'undefined' } }] };
    expect(contractProblems(m)).toEqual([]); // the row is data to open, not text the panel shows
    m.touches.links = [{ title: 'Other', detail: 'x', row: 'Other' }];
    expect(contractProblems(m).join()).toMatch(/touch link Other has a row that is not a record/);
    m.touches.links = [{ title: 'Other', detail: 'x', row: [] }];
    expect(contractProblems(m).join()).toMatch(/touch link Other has a row that is not a record/);
  });

  it('rejects reference placeholders but allows ordinary prose', () => {
    const m = base();
    m.about.cards = [{ heading: 'Note', body: 'The order was declared null and void.' }];
    expect(contractProblems(m)).toEqual([]);
    m.about.rows = [['Began', '[date]']];
    expect(contractProblems(m).join()).toMatch(/placeholder/);
  });
});
