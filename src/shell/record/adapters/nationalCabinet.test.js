import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import stored from '../../../../public/data/embedded_csv/national_cabinet_decisions.json';
import RecordPanel from '../RecordPanel.jsx';
import { contractProblems } from '../modelContract.js';
import nationalCabinet, { statesCabinetDecision } from './nationalCabinet.js';

/**
 * F124 N6: Cabinet Decisions (National). The module serves every PIB press release, not Cabinet
 * decisions (F125 will filter it), so these tests pin the one rule that matters: an item is called a
 * Cabinet decision only when its own title says the Cabinet approved something.
 *
 * Row shapes, both from server/nationalFeed.mjs (the "cabinet decisions" branch, lines 590-621):
 *  - LIVE: `parseRssOrXml` (server/featureFeed.mjs 715-745) builds { date (the RSS pubDate as
 *    written), title (entities NOT decoded), source_url, summary } through `flattenRow` (435-501);
 *    `enrichPibEnglish` (162-205) then adds id `pib-<n>`, stage 'PIB release', source
 *    'Press Information Bureau', topic (= title) and language 'en' (lines 165-182). A Hindi title is
 *    resolved from the release page, which replaces date with 'YYYY-MM-DD' and source_url with the
 *    English page (lines 186-196). `shaped` (593-600) finally sets ministry to the row's ministry
 *    or else its source, so a live row's "ministry" is "Press Information Bureau": the publisher.
 *    These fixtures were also compared with the output of the real serveFeatureFeed under a stubbed
 *    fetch (key sets asserted in the first block).
 *  - STORED: public/data/embedded_csv/national_cabinet_decisions.json, six rows, passed through the
 *    same `shaped` step (it adds title = topic and id `cabinet-<i>`, line 596).
 */
const LIVE_KEYS = ['date', 'title', 'source_url', 'summary', 'id', 'stage', 'source', 'topic', 'language', 'ministry'];
const STORED_KEYS = ['topic', 'ministry', 'date', 'source_url', 'pdf_url', 'occurred_at', 'as_of', 'provenance', 'source_date_raw', 'title', 'id'];

const PIB = (prid) => `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${prid}`;
let seq = 0;
/** A live row exactly as enrichPibEnglish + shaped leave it for a title that needed no translation. */
const live = ({ title, date = 'Mon, 12 Oct 2026 14:30:00 GMT', summary = '', url } = {}) => {
  const n = seq++;
  const prid = 2400000 + n;
  return {
    date, title, source_url: url === undefined ? PIB(prid) : url, summary,
    id: `pib-${n}`, stage: 'PIB release', source: 'Press Information Bureau', topic: title, language: 'en', ministry: 'Press Information Bureau',
  };
};
/** The shape of a Hindi-titled release resolved to English (nationalFeed.mjs 186-196): ISO date, English page link. */
const resolved = (title, prid) => ({ ...live({ title, url: `${PIB(prid)}&Lang=1` }), date: '2026-10-11' });
/** `shaped` applied to a stored row, as the server serves it. */
const shaped = (r, i) => ({ ...r, id: `cabinet-${i}`, topic: r.topic || r.title || '', title: r.title || r.topic || '', ministry: r.ministry || r.source || 'Press Information Bureau' });
const STORED = stored.map(shaped);

const L = {
  msp: live({ title: 'Cabinet approves Kharif MSP &amp; related measures', summary: 'The Union Cabinet chaired by the Prime Minister approved the prices today.' }),
  home: live({ title: 'Union Home Minister inaugurates new facility in Gujarat', date: 'Mon, 12 Oct 2026 10:05:00 GMT' }),
  secretary: live({ title: 'Cabinet Secretary reviews preparedness for winter session', date: 'Mon, 12 Oct 2026 09:00:00 GMT', summary: 'Review meeting held.' }),
  chaired: live({ title: 'Union Cabinet chaired by Prime Minister Shri Narendra Modi approves extension of a farm scheme', date: 'Sun, 11 Oct 2026 18:40:00 GMT' }),
  state: live({ title: 'Assam Cabinet approves new tea policy', date: 'Sun, 11 Oct 2026 12:00:00 GMT' }),
  ccea: live({ title: 'Cabinet Committee on Economic Affairs approves construction of a new rail line', date: 'Sat, 10 Oct 2026 16:00:00 +0530' }),
  briefing: live({ title: 'Union Minister briefs media on Cabinet decisions', date: 'Sat, 10 Oct 2026 15:00:00 GMT' }),
  passive: live({ title: 'Metro extension approved by the Union Cabinet', date: 'Fri, 09 Oct 2026 11:00:00 IST' }),
  apprised: live({ title: 'Cabinet apprised of progress on the Digital India mission', date: '09 October 2026' }),
  hindi: resolved('Cabinet approves metro extension', 2400900),
  oddDate: live({ title: 'Prime Minister addresses a rally', date: 'Monday last week', url: 'http://www.pib.gov.in/PressReleasePage.aspx?PRID=2400901' }),
  noZone: live({ title: 'Minister reviews port capacity', date: '2026-10-12T14:30:00' }),
  noLink: live({ title: 'Minister reviews flood response', url: '' }),
  markup: live({ title: 'Minister ‮opens‬ a hall &amp; a library', summary: 'Opened &lt;script&gt;alert(1)&lt;/script&gt; today &amp; it went well.' }),
};
const LIVE = Object.values(L);
// Frozen, so an adapter that writes to a row it was given throws instead of quietly changing a fixture.
[...stored, ...STORED, ...LIVE].forEach((r) => Object.freeze(r));
const ctx = (rows, over = {}) => ({ rows, feed: { feature: 'Cabinet Decisions', fallback: false, source: { adapter: 'live' } }, ...over });
const storedCtx = (rows = STORED) => ({ rows, feed: { feature: 'Cabinet Decisions', fallback: true, source: { adapter: 'embedded' } } });

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'row') strings(x, out);
  return out;
};
const tile = (m, label) => m.glance.tiles.find((t) => t.label === label);
const kindOf = (m) => tile(m, 'Kind').value;
const board = (m) => m.glance.visual;
const boardRow = (m, label) => board(m).rows.find((r) => r.label === label);

describe('Cabinet Decisions fixtures match the shapes the server serves', () => {
  it('has the live and stored key sets that the real serveFeatureFeed produced under a stubbed fetch', () => {
    for (const r of LIVE) expect(Object.keys(r), r.id).toEqual(LIVE_KEYS);
    for (const r of STORED) expect(Object.keys(r), r.id).toEqual(expect.arrayContaining(STORED_KEYS));
    expect(STORED).toHaveLength(6);
  });
});

describe('Cabinet decision detection (the only basis for the label)', () => {
  it('counts a title that says the Cabinet, a Cabinet committee or the CCEA approved something', () => {
    for (const t of [
      'Cabinet approves Minimum Support Prices (MSP) for Kharif Crops for Marketing Season 2026-27',
      'Union Cabinet approves a new rail corridor',
      'Union Cabinet chaired by Prime Minister Shri Narendra Modi approves extension of a farm scheme',
      'Cabinet Committee on Economic Affairs approves construction of a new rail line',
      'CCEA approves a revised cost estimate',
      'Cabinet also approves the revised guidelines',
      'Cabinet gives ex-post facto approval to the agreement',
      'Cabinet approval for the new airport',
      'Cabinet clears a semiconductor unit',
      'Metro extension approved by the Union Cabinet',
      'Scheme approved by CCEA',
      'Cabinet Committee on Economic Affairs (CCEA) approves a pipeline',
      'Chaired by the Prime Minister, Cabinet approves the proposal',
    ]) expect(statesCabinetDecision(t), t).toBe(true);
  });

  it('does not count a Cabinet Secretary or Minister, another body\'s cabinet, a briefing, or a bare mention', () => {
    for (const t of [
      'Cabinet Secretary reviews preparedness for winter session',
      'Cabinet Secretary approves the roadmap',
      'Plan approved by Cabinet Secretary after review',
      'Plan approved by Assam Cabinet',
      'Union Cabinet Minister approves the plan',
      'Cabinet Minister Shri Pralhad Joshi clears the backlog',
      'Assam Cabinet approves new tea policy',
      'Haryana Cabinet clears a land policy',
      'Union Minister briefs media on Cabinet decisions',
      'Cabinet briefing: Minister clears the backlog',
      'Cabinet apprised of progress on the Digital India mission',
      'Prime Minister chairs a Cabinet meeting',
      'Union Home Minister inaugurates new facility in Gujarat',
      'Vice-President attends public reception in Shillong',
      'Minister approves the plan after the Cabinet meeting',
      'CCEA',
      '',
      undefined,
    ]) expect(statesCabinetDecision(t), String(t)).toBe(false);
  });
});

describe('National cabinet adapter', () => {
  it('honours the panel contract for every stored and live-shaped row, with and without the feed rows', () => {
    for (const rows of [STORED, stored]) {
      for (const r of rows) {
        expect(contractProblems(nationalCabinet(r, storedCtx(rows))), r.id || r.topic).toEqual([]);
        expect(contractProblems(nationalCabinet(r, {})), r.id || r.topic).toEqual([]);
      }
    }
    for (const r of LIVE) {
      expect(contractProblems(nationalCabinet(r, ctx(LIVE))), r.id).toEqual([]);
      expect(contractProblems(nationalCabinet(r, {})), r.id).toEqual([]);
    }
  });

  describe('the Cabinet decision label', () => {
    it('is given to exactly the stored row whose own title says Cabinet approved, and to no other', () => {
      const marked = STORED.filter((r) => kindOf(nationalCabinet(r, storedCtx())) === 'Cabinet decision');
      expect(marked).toHaveLength(1);
      expect(marked[0].source_url).toBe(PIB(2260617));
      for (const r of STORED) {
        const m = nationalCabinet(r, storedCtx());
        const isCabinet = r === marked[0];
        expect(m.badge).toEqual(isCabinet ? { text: 'Cabinet decision', tone: 'blue' } : { text: 'Press release', tone: 'grey' });
        expect(m.touches.nodes.center.l2).toBe(isCabinet ? 'Cabinet decision' : 'Press release');
      }
    });

    it('is given to exactly the live-shaped rows whose titles say so, though every one is stamped "PIB release"', () => {
      const expected = new Set([L.msp, L.chaired, L.ccea, L.passive, L.hindi]);
      for (const r of LIVE) {
        const m = nationalCabinet(r, ctx(LIVE));
        expect(kindOf(m), r.title).toBe(expected.has(r) ? 'Cabinet decision' : 'Press release');
        expect(m.badge.text).toBe(expected.has(r) ? 'Cabinet decision' : 'Press release');
        expect(m.badge.tone).toBe(expected.has(r) ? 'blue' : 'grey');
      }
      // The look-alikes that must stay press releases.
      for (const r of [L.secretary, L.state, L.briefing, L.apprised]) expect(kindOf(nationalCabinet(r, ctx(LIVE))), r.title).toBe('Press release');
    });

    it('does not follow the row\'s ministry, its stage, its source or its provenance', () => {
      const ccea = STORED[0];
      const notADecision = { ...STORED[1], ministry: ccea.ministry, provenance: 'official', stage: 'Cabinet decision' };
      const m = nationalCabinet(notADecision, storedCtx());
      expect(m.badge.text).toBe('Press release');
      expect(kindOf(m)).toBe('Press release');
      const noCabinetWord = { ...ccea, title: 'Minimum Support Prices announced for Kharif crops', topic: 'Minimum Support Prices announced for Kharif crops' };
      expect(nationalCabinet(noCabinetWord, storedCtx()).badge.text).toBe('Press release');
    });

    it('says what it rests on, and never reads "Cabinet decision" outside the rows that earned it', () => {
      for (const r of [...STORED.slice(1), L.home, L.secretary, L.state]) {
        const all = strings(nationalCabinet(r, ctx([...STORED, ...LIVE]))).filter((s) => /cabinet decision\b/i.test(s));
        // Only the explanatory board row, caption and footer note may name the term, never a label for this item.
        expect(all.every((s) => /^(?:Stated as Cabinet decisions|.*not a list of Cabinet decisions.*|.*not yet filtered to Cabinet decisions.*)$/.test(s)), `${r.title}: ${all.join(' | ')}`).toBe(true);
      }
      const m = nationalCabinet(L.msp, ctx(LIVE));
      expect(tile(m, 'Kind').sub).toMatch(/title states a Cabinet approval/i);
      expect(tile(nationalCabinet(L.home, ctx(LIVE)), 'Kind').sub).toMatch(/title does not state/i);
    });
  });

  describe('stored or live', () => {
    it('recognises the stored register from the row alone, and from the feed alone', () => {
      const rowAlone = nationalCabinet(STORED[0], {});
      expect(rowAlone.footer.provenance.source).toBe('PIB press releases (stored register)');
      expect(rowAlone.glance.visual.title).toBe('What the stored register holds');
      const feedAlone = nationalCabinet(L.msp, storedCtx([L.msp]));
      expect(feedAlone.footer.provenance.source).toBe('PIB press releases (stored register)');
      expect(feedAlone.glance.visual.title).toBe('What the stored register holds');
      const liveOnly = nationalCabinet(L.msp, ctx([L.msp]));
      expect(liveOnly.footer.provenance.source).toBe('PIB press releases (RSS)');
      expect(liveOnly.glance.visual.title).toBe('What the feed served today');
    });
  });

  describe('tiles', () => {
    it('shows Date, Ministry and Kind, and no machine field or invented figure', () => {
      for (const r of [...STORED, ...LIVE]) {
        const m = nationalCabinet(r, r.id.startsWith('pib') ? ctx(LIVE) : storedCtx());
        expect(m.glance.tiles.map((t) => t.label), r.id).toEqual(['Date', 'Ministry', 'Kind']);
        const text = strings([m.glance, m.about, m.footer, m.touches]).join('\n');
        expect(text, r.id).not.toMatch(/\b(?:as_of|occurred_at|provenance|source_date_raw|pdf_url|source_url|language)\b/);
        expect(text, r.id).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/); // a raw timestamp
        expect(text, r.id).not.toMatch(/\b(?:pib|cabinet)-\d+\b/); // a machine row id
      }
    });

    it('never shows a decision type or an outlay, even when the title names an amount', () => {
      const withAmount = STORED[1]; // "lays foundation for projects worth over Rs 1,000 crore"
      const m = nationalCabinet(withAmount, storedCtx());
      expect(m.glance.tiles.map((t) => t.label).join()).not.toMatch(/outlay|decision type/i);
      expect(m.about.rows.map(([k]) => k).join()).not.toMatch(/outlay|decision type/i);
      for (const r of [...STORED, ...LIVE]) expect(tile(nationalCabinet(r, {}), 'Kind').label).toBe('Kind');
    });

    it('reads the date strictly, in India time, and says "Not on record" for anything it cannot read', () => {
      const date = (r) => tile(nationalCabinet(r, ctx(LIVE)), 'Date').value;
      expect(date(L.msp)).toBe('12 Oct 2026'); // 14:30 GMT
      expect(date(live({ title: 'x1', date: 'Mon, 12 Oct 2026 23:45:00 GMT' }))).toBe('13 Oct 2026'); // 05:15 next day in India
      expect(date(L.ccea)).toBe('10 Oct 2026'); // +0530 as written
      expect(date(L.passive)).toBe('09 Oct 2026'); // IST read as India Standard Time
      expect(date(L.hindi)).toBe('11 Oct 2026'); // a bare ISO date is that date
      expect(date(L.apprised)).toBe('09 Oct 2026'); // full month name
      expect(date(L.oddDate)).toBe('Not on record');
      expect(date(L.noZone)).toBe('Not on record'); // a time with no zone is not guessed
      expect(date(live({ title: 'x5', date: 'Mon, 12 Oct 2026 14:30:00' }))).toBe('Not on record');
      expect(date(live({ title: 'x2', date: '31 Feb 2026' }))).toBe('Not on record'); // impossible
      expect(date(live({ title: 'x3', date: 'Mon, 12 Oct 2026 14:30:00 BST' }))).toBe('Not on record'); // ambiguous zone
      expect(date(live({ title: 'x4', date: '' }))).toBe('Not on record');
      expect(tile(nationalCabinet(L.oddDate, {}), 'Date').sub).toMatch(/no readable date/i);
      expect(date(STORED[0])).toBe('12 May 2026');
    });
  });

  describe('ministry', () => {
    it('does not present the publisher as a ministry', () => {
      for (const r of [...LIVE, ...STORED.slice(1)]) {
        const m = nationalCabinet(r, ctx(LIVE));
        expect(tile(m, 'Ministry').value, r.id).toBe('Not on record');
        expect(m.meta, r.id).toEqual(['PIB']);
        expect(m.touches.nodes.left, r.id).toBeUndefined();
        expect(strings(m.about.rows).join('|'), r.id).not.toMatch(/Ministry on record/);
      }
    });

    it('shows the ministry the row holds, in the tile, meta, about and left lane', () => {
      const m = nationalCabinet(STORED[0], storedCtx());
      expect(tile(m, 'Ministry')).toMatchObject({ value: 'Cabinet Committee on Economic Affairs', sub: 'as tagged in the feed' });
      expect(m.meta).toEqual(['Cabinet Committee on Economic Affairs', 'PIB']);
      expect(m.about.rows).toContainEqual(['Ministry on record', 'Cabinet Committee on Economic Affairs']);
      expect(m.touches.nodes.left).toMatchObject({ l1: 'Cabinet Committee on Economic Affairs' });
    });
  });

  describe('the board "What the feed served today"', () => {
    it('describes the feed\'s make-up, once per release, with the selection counted and marked', () => {
      const rows = LIVE;
      const m = nationalCabinet(L.msp, ctx(rows));
      const v = board(m);
      expect(v).toMatchObject({ type: 'board', title: 'What the feed served today' });
      expect(boardRow(m, 'Items in this feed').value).toBe(String(rows.length));
      expect(boardRow(m, 'Stated as Cabinet decisions')).toMatchObject({ value: '5', note: 'includes this item', tone: 'blue' });
      expect(boardRow(m, 'Other releases').value).toBe(String(rows.length - 5));
      expect(boardRow(m, 'Ministry tagged')).toMatchObject({ value: `0 of ${rows.length}`, note: 'the feed does not tag a ministry' });
      const other = boardRow(nationalCabinet(L.home, ctx(rows)), 'Other releases');
      expect(other.note).toBe('includes this item');
      expect(boardRow(nationalCabinet(L.home, ctx(rows)), 'Stated as Cabinet decisions').note).not.toMatch(/includes this item/);
    });

    it('says the feed is the unfiltered PIB stream and that the count is a text match', () => {
      const cap = board(nationalCabinet(L.home, ctx(LIVE))).caption;
      expect(cap).toMatch(/unfiltered PIB stream/);
      expect(cap).toMatch(/not a list of Cabinet decisions/);
      expect(cap).toMatch(/text match/);
    });

    it('counts a copy of the selection once, and not a source-status notice', () => {
      const statusRow = { date: '2026-10-12', title: 'Source offline or empty', source_url: '', status: 'source_status', adapter: 'pib', feature: 'Cabinet Decisions' };
      const rows = [...LIVE, statusRow, { ...L.msp }];
      const m = nationalCabinet({ ...L.msp }, ctx(rows));
      expect(boardRow(m, 'Items in this feed').value).toBe(String(LIVE.length));
      expect(boardRow(m, 'Stated as Cabinet decisions').value).toBe('5');
      // A selection missing from the rows is still part of the feed it came from.
      expect(boardRow(nationalCabinet(L.msp, ctx([])), 'Items in this feed').value).toBe('1');
    });

    it('lists the ministries most represented when rows carry them, with unique labels and this item\'s ministry marked', () => {
      const tag = (r, ministry) => ({ ...r, ministry });
      const rows = [
        tag(live({ title: 'Finance one' }), 'Ministry of Finance'), tag(live({ title: 'Finance two' }), 'Ministry of Finance'), tag(live({ title: 'Finance three' }), 'ministry of finance'),
        tag(live({ title: 'Health one' }), 'Ministry of Health'), tag(live({ title: 'Health two' }), 'Ministry of Health'),
        tag(live({ title: 'Rail one' }), 'Ministry of Railways'), tag(live({ title: 'Rail two' }), 'Ministry of Railways'),
        tag(live({ title: 'Power one' }), 'Ministry of Power'),
        live({ title: 'Untagged' }),
      ];
      const selected = rows[7]; // the only Power item
      const m = nationalCabinet(selected, ctx(rows));
      const labels = board(m).rows.map((r) => r.label);
      expect(new Set(labels.map((l) => l.toLowerCase())).size).toBe(labels.length);
      expect(contractProblems(m)).toEqual([]);
      expect(boardRow(m, 'Ministry of Finance').value).toBe('3 items');
      expect(boardRow(m, 'Ministry tagged')).toMatchObject({ value: '8 of 9', note: 'items that name a ministry' });
      // Three most represented, plus the selection's own ministry although it is smaller.
      expect(labels).toContain('Ministry of Health');
      expect(labels).toContain('Ministry of Railways');
      expect(boardRow(m, 'Ministry of Power')).toMatchObject({ value: '1 item', note: "This item's ministry" });
      expect(labels.filter((l) => /^Ministry of /.test(l))).toHaveLength(4);
    });

    it('is titled for the stored register when the rows are the stored copy, with the register\'s as-of', () => {
      const m = nationalCabinet(STORED[0], storedCtx());
      expect(board(m)).toMatchObject({ title: 'What the stored register holds', right: 'as of 07 Sep 2026' });
      expect(board(m).caption).toMatch(/stored copy/);
      expect(boardRow(m, 'Items in this feed')).toMatchObject({ value: '6', note: 'in the stored register' });
      expect(boardRow(m, 'Stated as Cabinet decisions')).toMatchObject({ value: '1', note: 'includes this item' });
      expect(boardRow(m, 'Other releases').value).toBe('5');
      expect(boardRow(m, 'Ministry tagged').value).toBe('1 of 6');
    });
  });

  describe('touch lanes and related items', () => {
    const tagged = (n, ministry = 'Ministry of Finance') => Array.from({ length: n }, (_, i) => ({ ...live({ title: `Finance release ${i + 1}`, date: `2026-10-0${(i % 9) + 1}` }), ministry }));

    it('uses the lanes Ministry, Decision, Sectors, States, with the item at the centre and sectors and states on record as none', () => {
      const m = nationalCabinet(L.msp, ctx(LIVE));
      expect(m.touches.lanes).toEqual(['MINISTRY', 'DECISION', 'SECTORS', 'STATES']);
      expect(m.touches.nodes.center).toMatchObject({ code: 'C', l1: 'This item', l2: 'Cabinet decision' });
      expect(m.touches.nodes.right).toBeUndefined();
      expect(m.touches.nodes.far).toBeUndefined();
      const html = renderToStaticMarkup(createElement(RecordPanel, { model: m }));
      expect(html).toContain('None on record');
    });

    it('links up to three other items from the same ministry: newest first, never the selection or a copy of it', () => {
      const rows = [...tagged(7), ...tagged(2, 'Ministry of Health')];
      const selected = rows[6]; // the newest, so it would head the list if it were not excluded
      const links = nationalCabinet({ ...selected }, ctx(rows)).touches.links;
      const open = links.filter((l) => l.row);
      expect(open).toHaveLength(3);
      for (const l of open) {
        expect(rows).toContain(l.row);
        expect(l.row).not.toBe(selected);
        expect(l.row.id).not.toBe(selected.id);
        expect(l.row.source_url).not.toBe(selected.source_url);
        expect(l.row.ministry).toBe('Ministry of Finance');
        expect(l.title).not.toBe(selected.title);
      }
      const dates = open.map((l) => l.row.date);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(links.at(-1)).toMatchObject({ title: 'More from Ministry of Finance', detail: '3 more in this feed' });
      expect(links.at(-1).row).toBeUndefined();
      expect(new Set(links.map((l) => l.title)).size).toBe(links.length);
    });

    it('lists nothing when the ministry is not held, rather than grouping by the publisher', () => {
      expect(nationalCabinet(L.msp, ctx(LIVE)).touches.links).toEqual([]);
      expect(nationalCabinet(STORED[1], storedCtx()).touches.links).toEqual([]);
    });

    it('lists one link per distinct title and none for the same release repeated', () => {
      const a = { ...live({ title: 'Same headline' }), ministry: 'Ministry of Finance' };
      const aCopy = { ...a };
      const b = { ...live({ title: 'Same headline' }), ministry: 'Ministry of Finance' };
      const self = { ...live({ title: 'Selected' }), ministry: 'Ministry of Finance' };
      const links = nationalCabinet(self, ctx([self, a, aCopy, b])).touches.links;
      expect(links.map((l) => l.title)).toEqual(['Same headline']);
    });

    it('labels each related item for what its own title says', () => {
      const ccea = { ...live({ title: 'Cabinet approves a new scheme' }), ministry: 'Ministry of Finance' };
      const plain = { ...live({ title: 'Minister opens a hall', date: '2026-10-01' }), ministry: 'Ministry of Finance' };
      const self = { ...live({ title: 'Selected' }), ministry: 'Ministry of Finance' };
      const links = nationalCabinet(self, ctx([self, ccea, plain])).touches.links;
      expect(links.find((l) => l.row === ccea).detail).toMatch(/^Cabinet decision/);
      expect(links.find((l) => l.row === plain).detail).toMatch(/^Press release/);
    });
  });

  describe('links', () => {
    it('shows the release and its PDF, https only, and one link when they are the same address', () => {
      const m = nationalCabinet(STORED[0], storedCtx());
      expect(m.links).toEqual([{ label: 'PIB release', href: PIB(2260617) }]); // pdf_url equals source_url in the stored rows
      const withPdf = nationalCabinet({ ...STORED[0], pdf_url: 'https://www.pib.gov.in/PressReleasePDF/2260617.pdf' }, storedCtx());
      expect(withPdf.links).toEqual([{ label: 'PIB release', href: PIB(2260617) }, { label: 'Release PDF', href: 'https://www.pib.gov.in/PressReleasePDF/2260617.pdf' }]);
      expect(nationalCabinet(L.oddDate, ctx(LIVE)).links).toEqual([]); // an http link is neither shown nor opened
      expect(nationalCabinet({ ...STORED[0], source_url: 'javascript:alert(1)', pdf_url: 'ftp://x/y.pdf' }, storedCtx()).links).toEqual([]);
      for (const r of [...STORED, ...LIVE]) for (const l of nationalCabinet(r, {}).links) expect(l.href).toMatch(/^https:\/\//);
    });
  });

  describe('plain text', () => {
    it('decodes the entities RSS leaves in a title once, and strips invisible controls', () => {
      expect(nationalCabinet(L.msp, ctx(LIVE)).title).toBe('Cabinet approves Kharif MSP & related measures');
      expect(nationalCabinet(L.markup, ctx(LIVE)).title).toBe('Minister opens a hall & a library');
    });

    it('keeps escaped markup in a summary as text, decoded once and never turned back into markup', () => {
      const m = nationalCabinet(L.markup, ctx(LIVE));
      const card = m.about.cards[0];
      expect(card.heading).toBe('Summary as published');
      expect(card.body).toBe('Opened &lt;script&gt;alert(1)&lt;/script&gt; today & it went well.');
      const html = renderToStaticMarkup(createElement(RecordPanel, { model: m }));
      expect(html).not.toContain('<script');
      expect(html).toContain('&amp;lt;script&amp;gt;');
    });

    it('shows a summary only when the row holds one', () => {
      expect(nationalCabinet(L.home, ctx(LIVE)).about.cards).toEqual([]);
      expect(nationalCabinet(L.secretary, ctx(LIVE)).about.cards).toEqual([{ heading: 'Summary as published', body: 'Review meeting held.' }]);
    });
  });

  describe('about, footer and wording', () => {
    it('names the release number, publisher and register as-of in About', () => {
      expect(nationalCabinet(STORED[0], storedCtx()).about.rows).toEqual([
        ['Ministry on record', 'Cabinet Committee on Economic Affairs'],
        ['Released', '12 May 2026'],
        ['PIB release number', '2260617'],
        ['Published by', 'Press Information Bureau'],
        ['Register as of', '07 Sep 2026'],
      ]);
      const liveAbout = nationalCabinet(L.msp, ctx(LIVE)).about.rows.map(([k]) => k);
      expect(liveAbout).toEqual(['Released', 'PIB release number', 'Published by']);
      // No link, no release number: the row's machine id is not a stand-in.
      expect(nationalCabinet(L.noLink, ctx(LIVE)).about.rows.map(([k]) => k)).toEqual(['Released', 'Published by']);
      expect(nationalCabinet(L.noLink, ctx(LIVE)).links).toEqual([]);
    });

    it('names the source and as-of: stored rows carry their own, live rows say it is not on record', () => {
      const f = nationalCabinet(STORED[0], storedCtx()).footer;
      expect(f.ask).toBe('Ask AI about this release');
      expect(f.provenance).toEqual({ source: 'PIB press releases (stored register)', asOf: '07 Sep 2026', flags: ['stored copy, not the live feed'] });
      const l = nationalCabinet(L.msp, ctx(LIVE)).footer;
      expect(l.provenance).toEqual({ source: 'PIB press releases (RSS)', asOf: '', flags: ['as-of not on record'] });
      for (const r of STORED) expect(nationalCabinet(r, storedCtx()).footer.provenance.asOf, r.id).toBe('07 Sep 2026');
    });

    it('says a press release is not an approval, an approval is not an implementation, and the feed is not filtered yet', () => {
      for (const r of [STORED[0], L.msp, L.home]) {
        const note = nationalCabinet(r, ctx(LIVE)).footer.note;
        expect(note).toMatch(/press release is not an approval/i);
        expect(note).toMatch(/approval is not an implementation/i);
        expect(note).toMatch(/not yet filtered to Cabinet decisions/i);
      }
    });

    it('leaks no dash, undefined, NaN or null into any reader-facing string, and none of the reference\'s review notes', () => {
      for (const r of [...STORED, ...LIVE]) {
        const all = strings(nationalCabinet(r, ctx([...STORED, ...LIVE])));
        for (const s of all) {
          expect(s, r.id).not.toMatch(/—/);
          expect(s, r.id).not.toMatch(/\bundefined\b|\bNaN\b|^\s*null\s*$/);
          expect(s, r.id).not.toMatch(/\bSplit required\b|filtering is the whole fix/i);
        }
        expect(all, r.id).not.toContain('Gap');
        expect(all, r.id).not.toContain('Fix');
      }
    });

    it('does not change the rows it is given', () => {
      const rows = JSON.parse(JSON.stringify([...STORED, ...LIVE]));
      const before = JSON.stringify(rows);
      for (const r of rows) nationalCabinet(r, ctx(rows));
      expect(JSON.stringify(rows)).toBe(before);
      for (const r of [...STORED, ...LIVE]) expect(() => nationalCabinet(r, ctx([...STORED, ...LIVE]))).not.toThrow(); // frozen fixtures
    });

    it('renders as a panel with the item\'s own kind and nothing else claiming a Cabinet decision', () => {
      const press = renderToStaticMarkup(createElement(RecordPanel, { model: nationalCabinet(L.home, ctx(LIVE)) }));
      expect(press).toContain('rp-badge rp-grey">Press release<');
      expect(press).not.toContain('rp-badge rp-blue');
      const decision = renderToStaticMarkup(createElement(RecordPanel, { model: nationalCabinet(L.msp, ctx(LIVE)) }));
      expect(decision).toContain('rp-badge rp-blue">Cabinet decision<');
    });
  });
});
