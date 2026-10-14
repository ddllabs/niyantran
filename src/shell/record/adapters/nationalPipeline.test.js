import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import embedded from '../../../../public/data/embedded_csv/national_policy_pipeline.json';
import analysis from '../../../../public/data/embedded_json/national_policy_pipeline_analysis.json';
import ontology from '../../../../public/data/ontology.json';
import { buildRecordModel, DESKS } from '../../../lib/impactRecord.js';
import { contractProblems } from '../modelContract.js';
import nationalPipeline from './nationalPipeline.js';

// The embedded register exactly as the server serves it (server/nationalFeed.mjs, Policy Pipeline
// branch: `{ ...r, id: String(i) }` over loadEmbedded rows). loadEmbedded runs every row through
// flattenRow (server/featureFeed.mjs), which adds `title` (= policy_name) and an empty `date`
// (date_reported is not one of the date keys it reads), so the row carries both.
const register = embedded.map((r, i) => ({ ...r, date: '', title: r.policy_name, id: String(i) }));

// A live row exactly as the server builds it: parseRssOrXml gives { date, title, source_url,
// summary } (server/featureFeed.mjs, flattenRow over the RSS item), then enrichPibEnglish
// (server/nationalFeed.mjs) adds { id: `pib-${idx}`, stage: 'PIB release', source: 'Press
// Information Bureau', topic, language: 'en' }. There is no policy_name, ministry or date_reported.
const live = (n, over = {}) => {
  const title = [
    'Cabinet approves extension of the rural housing scheme',
    'India and Japan sign agreement on semiconductor cooperation',
    'Minister reviews progress of the national highways programme',
    'Government notifies new rules for the fertiliser subsidy',
  ][n % 4] + (n >= 4 ? ` (${n})` : '');
  return {
    date: '2026-10-12',
    title,
    source_url: `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${2200000 + n}&Lang=1`,
    summary: 'Release text from the feed.',
    id: `pib-${n}`,
    stage: 'PIB release',
    source: 'Press Information Bureau',
    topic: title,
    language: 'en',
    ...over,
  };
};
const liveRows = Array.from({ length: 6 }, (_, i) => live(i));

const packs = { desk: DESKS.pipeline, analysis, ontology, ready: true };
const ctx = (rows, over = {}) => ({ rows, feed: { feature: 'Policy Pipeline Tracker (Draft-to-Gazette)' }, packs, ...over });
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'row') strings(x, out);
  return out;
};
const text = (m) => strings(m).join(' | ');
const everyRow = [...register, ...liveRows];

afterEach(() => vi.unstubAllGlobals());

// F124 N5: the Policy Pipeline Tracker serves two kinds of row. The live PIB feed gives press
// releases, which are not draft-to-gazette stages; the embedded register gives eight press-reported
// policy items with a stage. The panel must say which it is showing and never dress one as the other.
describe('National policy pipeline adapter', () => {
  it('honours the panel contract for every register row and live release, with and without the packs', () => {
    for (const row of everyRow) {
      expect(contractProblems(nationalPipeline(row, ctx(everyRow, { packs: null }))), `${row.id} no packs`).toEqual([]);
      expect(contractProblems(nationalPipeline(row, ctx(everyRow))), `${row.id} packs`).toEqual([]);
      expect(contractProblems(nationalPipeline(row, ctx(everyRow, { packs: { ...packs, ready: false, analysis: null, ontology: null } }))), `${row.id} loading`).toEqual([]);
    }
  });

  it('survives sparse rows and a missing context', () => {
    const sparse = [{ id: 'x' }, { id: '9', title: 'Only a title' }, { policy_name: 'Only a name' }, { id: 'p', stage: 'PIB release' }, { id: 'q', ministry: 'Finance', stage: '', date_reported: 'not a date' }];
    for (const row of sparse) {
      expect(contractProblems(nationalPipeline(row, ctx([row]))), JSON.stringify(row)).toEqual([]);
      expect(contractProblems(nationalPipeline(row)), JSON.stringify(row)).toEqual([]);
      expect(contractProblems(nationalPipeline(row, { rows: undefined, packs: null })), JSON.stringify(row)).toEqual([]);
    }
  });

  it('never shows a news.google.com link or lets one reach the model', () => {
    for (const row of register) {
      expect(row.source_url).toMatch(/news\.google\.com/); // the premise: every register link is a Google News link
      const m = nationalPipeline(row, ctx(register));
      expect(m.links, row.policy_name).toEqual([]);
      expect(text(m)).not.toMatch(/news\.google\.com/i);
    }
    // A reachable https source is kept; http, Google and a Google link smuggled into another field are not.
    const ok = nationalPipeline({ ...register[0], source_url: 'https://example.org/draft.pdf' }, ctx(register));
    expect(ok.links).toHaveLength(1);
    expect(ok.links[0].href).toBe('https://example.org/draft.pdf');
    expect(nationalPipeline({ ...register[0], source_url: 'http://example.org/draft' }, ctx(register)).links).toEqual([]);
    expect(nationalPipeline({ ...register[0], source_url: 'https://news.google.com/rss/articles/x' }, ctx(register)).links).toEqual([]);
    expect(nationalPipeline({ ...register[0], source_url: 'https://www.google.com/url?q=https://news.google.com/rss/x' }, ctx(register)).links).toEqual([]);
  });

  it('keeps a live release\'s own https PIB link and drops a plain-http one', () => {
    const m = nationalPipeline(liveRows[0], ctx(liveRows));
    expect(m.links).toEqual([{ label: expect.stringMatching(/pib/i), href: liveRows[0].source_url }]);
    expect(nationalPipeline(live(1, { source_url: 'http://pib.gov.in/newsite/PrintRelease.aspx?relid=1' }), ctx(liveRows)).links).toEqual([]);
  });

  describe('the stage board', () => {
    it('counts each stage value in the register, once, and marks only this row\'s stage', () => {
      const expected = new Map();
      for (const r of register) expected.set(r.stage, (expected.get(r.stage) || 0) + 1);
      for (const row of register) {
        const v = nationalPipeline(row, ctx(register)).glance.visual;
        expect(v.type).toBe('board');
        expect(v.title).toBe('What the stage column contains');
        const labels = v.rows.map((r) => r.label);
        expect(new Set(labels).size).toBe(labels.length);
        expect(labels.sort()).toEqual([...expected.keys()].sort());
        for (const r of v.rows) expect(r.value).toBe(`${expected.get(r.label)} ${expected.get(r.label) === 1 ? 'item' : 'items'}`);
        const marked = v.rows.filter((r) => /this (policy|item)/i.test(r.note || ''));
        expect(marked.map((r) => r.label)).toEqual([row.stage]);
      }
    });

    it('merges stage values that differ only in case or spacing, so labels stay unique', () => {
      const rows = [
        { id: '0', policy_name: 'A', stage: 'Public comments invited' },
        { id: '1', policy_name: 'B', stage: 'public comments invited ' },
        { id: '2', policy_name: 'C', stage: ' Public  comments invited' },
        { id: '3', policy_name: 'D', stage: 'Cabinet approval pending' },
        { id: '4', policy_name: 'E', stage: '' },
      ];
      const v = nationalPipeline(rows[1], ctx(rows)).glance.visual;
      const labels = v.rows.map((r) => r.label);
      expect(new Set(labels).size).toBe(labels.length);
      expect(v.rows.find((r) => /public comments/i.test(r.label)).value).toBe('3 items');
      expect(v.rows.find((r) => /public comments/i.test(r.label)).note).toMatch(/this/i);
      expect(v.rows.find((r) => r.label === 'Cabinet approval pending').value).toBe('1 item');
      expect(v.rows.find((r) => /not on record/i.test(r.label)).value).toBe('1 item');
      expect(contractProblems(nationalPipeline(rows[1], ctx(rows)))).toEqual([]);
    });

    it('still lists the selection\'s own stage when the row list does not hold it', () => {
      const v = nationalPipeline({ ...register[0], id: 'elsewhere' }, ctx([])).glance.visual;
      expect(v.rows.map((r) => r.label)).toEqual([register[0].stage]);
      expect(v.rows[0].value).toBe('1 item');
    });

    it('says plainly that live stages are press releases, not draft-to-gazette stages', () => {
      const v = nationalPipeline(liveRows[0], ctx(liveRows)).glance.visual;
      expect(v.rows).toHaveLength(1);
      expect(v.rows[0]).toMatchObject({ label: 'PIB release', value: '6 items' });
      expect(v.caption).toMatch(/press releases/i);
      expect(v.caption).toMatch(/not draft-to-gazette stages/i);
      // The register caption makes no such claim about the feed, and does not call the stages confirmed.
      const r = nationalPipeline(register[0], ctx(register)).glance.visual;
      expect(r.caption).not.toMatch(/^these are press releases/i);
      expect(r.caption).toMatch(/press/i);
      expect(r.caption).toMatch(/not (confirmed|checked)/i);
    });
  });

  describe('a live PIB press release', () => {
    it('is badged as a neutral press release and never as a pipeline stage', () => {
      for (const row of liveRows) {
        const m = nationalPipeline(row, ctx(liveRows));
        expect(m.badge).toEqual({ text: 'Press release', tone: 'grey' });
        expect(m.glance.tiles[0]).toMatchObject({ label: 'Stage', value: 'PIB release' });
        expect(m.glance.tiles[0].sub).toMatch(/press release/i);
        expect(m.glance.tiles[0].tone).toBeUndefined();
        expect(m.touches.nodes.center).toMatchObject({ code: 'P', l1: 'This release' });
        expect(text(m)).not.toMatch(/draft released|public comments invited|cabinet approval pending|awaiting gazette/i);
      }
    });

    it('is titled, dated and sourced from its own fields, with no ministry invented', () => {
      const m = nationalPipeline(liveRows[0], ctx(liveRows));
      expect(m.title).toBe(liveRows[0].title);
      expect(m.glance.tiles.map((t) => t.label)).toEqual(['Stage', 'Released']);
      expect(m.glance.tiles[1].value).toBe('12 Oct 2026');
      expect(m.meta).toEqual(['Press Information Bureau']);
      expect(m.touches.nodes.left).toMatchObject({ l1: 'Press Information Bureau' });
      expect(m.touches.links.filter((l) => l.row)).toEqual([]);
      expect(m.about.rows.map(([k]) => k)).not.toContain('Ministry');
    });

    it('reads an RSS date as given by the feed and drops an unreadable one', () => {
      const rfc = nationalPipeline(live(0, { date: 'Mon, 12 Oct 2026 14:30:00 +0530' }), ctx(liveRows));
      expect(rfc.glance.tiles.find((t) => t.label === 'Released').value).toBe('12 Oct 2026');
      expect(rfc.footer.provenance.asOf).toBe('12 Oct 2026');
      const bad = nationalPipeline(live(0, { date: 'yesterday' }), ctx(liveRows));
      expect(bad.glance.tiles.map((t) => t.label)).toEqual(['Stage', 'Source']);
      expect(bad.footer.provenance.asOf).toBeUndefined();
      expect(bad.footer.provenance.flags).toEqual(['as-of not on record']);
      expect(contractProblems(bad)).toEqual([]);
    });

    it('does not take the register\'s analysis, even when its id matches a pack key', () => {
      const clash = live(0, { id: '0' });
      expect(analysis['0']).toBeTruthy();
      const m = nationalPipeline(clash, ctx(liveRows));
      expect(m.about.cards || []).toEqual([]);
      expect(m.about.chips || []).toEqual([]);
      expect(text(m)).not.toContain(analysis['0'].brief);
    });
  });

  describe('a register item', () => {
    it('leads with stage, reported date and ministry, and badges the stage as the register states it', () => {
      for (const row of register) {
        const m = nationalPipeline(row, ctx(register));
        expect(m.title).toBe(row.policy_name);
        expect(m.glance.tiles.map((t) => t.label)).toEqual(['Stage', 'Reported', 'Ministry']);
        expect(m.glance.tiles[0].value).toBe(row.stage);
        expect(m.glance.tiles[2].value).toBe(row.ministry);
        expect(m.badge.text).toBe(row.stage);
        expect(m.badge.tone).not.toBe('grey');
        expect(m.meta[0]).toBe(row.ministry);
      }
      const m = nationalPipeline(register[0], ctx(register));
      expect(m.glance.tiles[1].value).toBe('05 Jul 2026'); // date_reported 2026-07-05, not the empty `date`
    });

    it('shows the reporting outlet from the source headline, never the Google News link', () => {
      const m = nationalPipeline(register[0], ctx(register));
      expect(m.touches.nodes.left).toMatchObject({ l1: 'The News Minute' });
      expect(m.meta).toEqual([register[0].ministry, 'The News Minute']);
      expect(m.about.rows).toContainEqual(['Source headline', register[0].source_title]);
      // An outlet is the part after the last " - "; a headline with an earlier dash keeps it.
      const dash = register.find((r) => /Explained/.test(r.source_title));
      expect(nationalPipeline(dash, ctx(register)).touches.nodes.left.l1).toBe('Vajiram & Ravi');
      // No outlet to read: the lane is left empty rather than guessed.
      expect(nationalPipeline({ ...register[0], source_title: 'A headline with no outlet' }, ctx(register)).touches.nodes.left).toBeUndefined();
    });

    it('draws a lane of exactly source, item, instrument, sectors, and holds no instrument', () => {
      for (const row of register) {
        const t = nationalPipeline(row, ctx(register)).touches;
        expect(t.lanes).toEqual(['SOURCE', 'ITEM', 'INSTRUMENT', 'SECTORS']);
        expect(t.nodes.center).toMatchObject({ code: 'P', l1: 'This policy', l2: row.stage });
        expect(t.nodes.right).toBeUndefined(); // neither the row nor the pack holds an instrument
      }
    });

    it('draws sectors from the ontology for the pipeline desk, and none until the packs load', () => {
      let drawn = 0;
      for (const [i, row] of register.entries()) {
        const a = analysis[String(i)];
        const impact = buildRecordModel(row, a, ontology, DESKS.pipeline);
        const far = nationalPipeline(row, ctx(register)).touches.nodes.far;
        if (impact.sectors.length) {
          drawn += 1;
          expect(far.l1, row.policy_name).toBe(impact.sectors[0].name);
          if (impact.sectors.length > 1) expect(far.l2).toBe(`+${impact.sectors.length - 1} more`);
        } else expect(far, row.policy_name).toBeUndefined();
        expect(nationalPipeline(row, ctx(register, { packs: null })).touches.nodes.far).toBeUndefined();
      }
      expect(drawn).toBeGreaterThan(0);
    });

    it('shows the pack\'s tags and analysis labelled as register analysis, and only once the packs are ready', () => {
      const m = nationalPipeline(register[0], ctx(register));
      expect(m.about.chips).toEqual(analysis['0'].tags);
      const headings = m.about.cards.map((c) => c.heading);
      expect(headings).toEqual(['Summary (register analysis)', 'Why it matters (register analysis)', 'What to watch for (register analysis)']);
      expect(m.about.cards[0].body).toBe(analysis['0'].brief);
      const bare = nationalPipeline(register[0], ctx(register, { packs: null }));
      expect(bare.about.cards || []).toEqual([]);
      expect(bare.about.chips || []).toEqual([]);
    });

    it('states the about rows the register holds, and omits what it lacks', () => {
      const m = nationalPipeline(register[3], ctx(register));
      expect(m.about.label).toBe('02 · About this policy');
      expect(m.about.rows.map(([k]) => k)).toEqual(['Ministry', 'Stage', 'Reported', 'Source headline']);
      const thin = nationalPipeline({ policy_name: 'X', stage: 'Public comments invited' }, ctx([]));
      expect(thin.about.rows.map(([k]) => k)).toEqual(['Stage']);
    });
  });

  describe('related items', () => {
    const rows = [
      ...register,
      { ...register[0], policy_name: 'Second health item', title: 'Second health item', id: '8', date_reported: '2026-07-06' },
      { ...register[0], policy_name: 'Third health item', title: 'Third health item', id: '9', date_reported: '2026-07-07' },
      { ...register[0], policy_name: 'Fourth health item', title: 'Fourth health item', id: '10', date_reported: '2026-07-08', ministry: ' health and family welfare ' },
      { ...register[0], policy_name: 'Fifth health item', title: 'Fifth health item', id: '11', date_reported: '2026-07-09' },
      { ...register[0] }, // a copy of the selection (same id), as a re-fetched list would hold
    ];

    it('links up to three others from the same ministry, never the selection or a copy of it', () => {
      const sel = rows[0];
      const links = nationalPipeline({ ...sel }, ctx(rows)).touches.links.filter((l) => l.row);
      expect(links).toHaveLength(3);
      for (const l of links) {
        expect(rows).toContain(l.row);
        expect(l.row.id).not.toBe(sel.id);
        expect(l.row.policy_name).not.toBe(sel.policy_name);
        expect(l.row.ministry.trim().toLowerCase()).toBe(sel.ministry.toLowerCase());
        expect(l.title).toBe(l.row.policy_name);
        expect(l.detail).toContain(l.row.stage);
      }
      expect(new Set(links.map((l) => l.row.id)).size).toBe(3);
      // The most recently reported come first.
      expect(links.map((l) => l.row.id)).toEqual(['11', '10', '9']);
      const more = nationalPipeline(sel, ctx(rows)).touches.links.find((l) => !l.row);
      expect(more.title).toMatch(/other health and family welfare items/i);
      expect(more.detail).toMatch(/4/);
    });

    it('offers nothing when the ministry has no other item, or the row has no ministry', () => {
      expect(nationalPipeline(register[1], ctx(register)).touches.links).toEqual([]);
      expect(nationalPipeline(live(0), ctx(liveRows)).touches.links).toEqual([]);
      expect(nationalPipeline({ id: 'z', policy_name: 'No ministry' }, ctx([{ id: 'y', policy_name: 'Other, no ministry' }])).touches.links).toEqual([]);
    });
  });

  it('keeps reader-facing text free of dashes-as-blanks, undefined, NaN and null', () => {
    const rows = [...everyRow, { id: 'x' }, { id: 'y', policy_name: 'Name only' }, { id: 'w', stage: 'PIB release' }, { id: 'v', ministry: 'Finance', date_reported: 'nope' }];
    for (const row of rows) {
      for (const c of [ctx(rows), ctx(rows, { packs: null }), {}]) {
        const s = text(nationalPipeline(row, c));
        expect(s, JSON.stringify(row)).not.toMatch(/—|undefined|NaN|\bnull\b|\[object|\{\}/);
      }
    }
  });

  it('names its source and as-of, and tells the reader how far to trust the stage', () => {
    const r = nationalPipeline(register[0], ctx(register));
    expect(r.footer.ask).toBe('Ask AI about this policy');
    expect(r.footer.provenance.source).toMatch(/policy pipeline register/i);
    expect(r.footer.provenance.asOf).toBe('05 Jul 2026');
    expect(r.footer.provenance.flags).toEqual([]);
    expect(r.footer.note).toMatch(/press/i);
    expect(r.footer.note).toMatch(/not confirmed/i);
    expect(r.footer.note).toMatch(/cabinet decisions/i);

    const l = nationalPipeline(liveRows[0], ctx(liveRows));
    expect(l.footer.ask).toBe('Ask AI about this release');
    expect(l.footer.provenance.source).toMatch(/pib press release feed/i);
    expect(l.footer.provenance.asOf).toBe('12 Oct 2026');
    expect(l.footer.note).toMatch(/press release is not a stage/i);
    expect(l.footer.note).toMatch(/draft-to-gazette/i);
    expect(l.footer.note).toMatch(/shared with cabinet decisions/i);

    const undated = nationalPipeline({ ...register[0], date_reported: '' }, ctx(register));
    expect(undated.footer.provenance.asOf).toBeUndefined();
    expect(undated.footer.provenance.flags).toEqual(['as-of not on record']);
    expect(contractProblems(undated)).toEqual([]);
  });

  it('makes no network or AI call: not at runtime, and not by import', () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call from an adapter'); });
    vi.stubGlobal('fetch', fetchSpy);
    for (const row of everyRow) nationalPipeline(row, ctx(everyRow));
    expect(fetchSpy).not.toHaveBeenCalled();
    const src = readFileSync(new URL('./nationalPipeline.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/resolveOrganisedBrief|ensureDeskBrief|sourceDoc|useEntryBrief|\bfetch\s*\(|XMLHttpRequest|\/api\//);
  });
});
