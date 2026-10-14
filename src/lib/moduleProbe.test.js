// F169 T0: the pure parts of scripts/module-probe.mjs (row counting, newest date, module
// selection, comparison). The network part is exercised by running the script.
import { describe, expect, it } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import {
  compareRuns,
  newestDate,
  parseArgs,
  realRows,
  selectModules,
  summarise,
} from '../../scripts/module-probe.mjs';

const NOW = Date.parse('2026-10-14T12:00:00Z');

describe('row counting', () => {
  it('does not count the status row the server adds to an empty answer', () => {
    const body = { rows: [{ status: 'source_status', reason: 'pending' }, { title: 'a' }, { title: 'b' }] };
    expect(realRows(body)).toHaveLength(2);
    expect(summarise(body)).toMatchObject({ pr: 2, statusRows: 1 });
    expect(summarise({ rows: [{ status: 'source_status' }] })).toMatchObject({ pr: 0, statusRows: 1 });
  });

  it('reads served, fallback, adapter and kind from the answer', () => {
    const body = { served: 'archive', fallback: true, source: { adapter: 'embedded', kind: 'backup-pack' }, rows: [{ title: 'x' }] };
    expect(summarise(body)).toEqual({ pr: 1, ps: 'archive', pn: '', fallback: true, adapter: 'embedded', kind: 'backup-pack', statusRows: 0 });
  });
});

describe('newest row date', () => {
  it('takes the latest date across the usual date fields', () => {
    const rows = [{ date: '2026-09-01' }, { published: 'Tue, 13 Oct 2026 08:00:00 GMT' }, { order_date: '2026-07-02' }];
    expect(newestDate(rows, NOW)).toBe('2026-10-13');
    expect(newestDate([{ last_verified: '2026-08-21', year: 2026 }], NOW)).toBe('2026-08-21');
  });

  it("reads GDELT's compact form", () => {
    expect(newestDate([{ seendate: '20261012T093000Z' }], NOW)).toBe('2026-10-12');
  });

  it('ignores bare years, unparseable text and dates far in the future', () => {
    const rows = [{ date: '2031' }, { date: 'soon' }, { date: '2029-01-01' }, { updated: '2026-08-09' }];
    expect(newestDate(rows, NOW)).toBe('2026-08-09');
    expect(newestDate([{ title: 'no date' }], NOW)).toBe('');
    expect(newestDate([{ date: '2026' }, { year: 2025 }], NOW)).toBe('');
  });
});

describe('module selection from the catalogue', () => {
  it('probes every desk module in the code catalogue by default', () => {
    const { list } = selectModules(DESK_CATALOGUE);
    expect(list).toHaveLength(DESK_CATALOGUE.length);
    expect(list.length).toBeGreaterThan(100);
  });

  it('filters by desk name or tab, and by module exactly before by substring', () => {
    const national = selectModules(DESK_CATALOGUE, { desks: ['National'] }).list;
    expect(national.length).toBeGreaterThan(0);
    expect(national.every((e) => e.desk === 'National')).toBe(true);
    expect(selectModules(DESK_CATALOGUE, { desks: ['national'] }).list).toEqual(national);

    // "Cabinet Decisions" exists on National and State; the desk narrows it.
    const cabinet = selectModules(DESK_CATALOGUE, { desks: ['state'], modules: ['cabinet decisions'] }).list;
    expect(cabinet.map((e) => `${e.desk}:${e.feature}`)).toEqual(['State:Cabinet Decisions']);

    const partial = selectModules(DESK_CATALOGUE, { modules: ['Box Office'] });
    expect(partial.list.map((e) => e.feature)).toEqual(['Box Office Tracker']);
    expect(selectModules(DESK_CATALOGUE, { modules: ['No such module'] }).unmatched).toEqual(['No such module']);
  });

  it('keeps a module name containing commas whole', () => {
    const opts = parseArgs(['--module', 'Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)', '--desk', 'economics']);
    expect(selectModules(DESK_CATALOGUE, opts).list).toHaveLength(1);
    expect(parseArgs(['--delay', '10']).delay).toBe(1000);
  });
});

describe('comparing runs', () => {
  const audit = [
    { d: 'National', m: 'Cabinet Decisions', pr: 1, ps: 'live', pms: 900, pn: '2026-10-14', br: 158 },
    { d: 'Global', m: 'Transit', pr: 0, ps: 'archive', pms: [4050, 4071], pn: '' },
    { d: 'Sports', m: 'Athlete Index', pr: 50, ps: 'live', pms: 300, pn: '' },
  ];
  const run = {
    modules: [
      { d: 'National', m: 'Cabinet Decisions', pr: 20, ps: 'live', pms: 1200, pn: '2026-10-14', adapter: 'rss', kind: '', fallback: false },
      { d: 'Sports', m: 'Athlete Index', pr: 50, ps: 'live', pms: 4100, pn: '', adapter: 'api', kind: '', fallback: false },
      { d: 'Entertainment', m: 'Box Office Tracker', pr: 0, ps: 'archive', pms: 4000, pn: '' },
    ],
  };

  it('reports changed fields, and modules found in only one run', () => {
    const out = compareRuns(audit, run);
    expect(out.changed).toEqual([{ d: 'National', m: 'Cabinet Decisions', diffs: [{ field: 'pr', before: 1, after: 20 }] }]);
    expect(out.onlyBefore).toEqual([{ d: 'Global', m: 'Transit' }]);
    expect(out.onlyAfter).toEqual([{ d: 'Entertainment', m: 'Box Office Tracker' }]);
  });

  it('compares adapter and kind when both runs have them, and never the time taken', () => {
    const later = { modules: run.modules.map((r) => (r.m === 'Athlete Index' ? { ...r, adapter: 'embedded', kind: 'backup-pack', pms: 10 } : r)) };
    const out = compareRuns(run, later);
    expect(out.changed).toEqual([{
      d: 'Sports',
      m: 'Athlete Index',
      diffs: [{ field: 'adapter', before: 'api', after: 'embedded' }, { field: 'kind', before: '', after: 'backup-pack' }],
    }]);
    expect(compareRuns(run, run).changed).toEqual([]);
  });
});
