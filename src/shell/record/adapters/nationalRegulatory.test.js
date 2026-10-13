import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rows from '../../../../public/data/embedded_csv/national_regulatory_watch.json';
import pack from '../../../../public/data/embedded_json/national_regulatory_watch_analysis.json';
import ontology from '../../../../public/data/ontology.json';
import { analysisFor, buildRecordModel, DESKS } from '../../../lib/impactRecord.js';
import { contractProblems } from '../modelContract.js';
import nationalRegulatory from './nationalRegulatory.js';

// The pack exactly as loadRecordPacks hands it over: loadAnalysisMap returns the raw map for this desk.
const packs = { desk: DESKS.regulatory, analysis: pack, ontology, ready: true };
const ctx = (over = {}) => ({ rows, feed: { feature: 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)' }, packs, ...over });
const model = (row, over) => nationalRegulatory(row, ctx(over));

/**
 * Live rows, as the server builds them. server/featureFeed.mjs parseRssOrXml (lines 715-743)
 * pushes flattenRow({ date: pubDate, title, source_url: href, summary }), and flattenRow (lines
 * 435-502) returns exactly { ...fields, date, title, source_url }. So a live row holds these four
 * keys and nothing else: no id, regulator, action type or PDF. nationalFeed.mjs (the Regulatory
 * Body Watch branch, line 329) tries RBI notifications, RBI press releases, then SEBI, via tryUrls.
 */
const LIVE_KEYS = ['date', 'source_url', 'summary', 'title'];
const live = (over = {}) => ({
  date: 'Tue, 13 Oct 2026 10:16:00 +0530',
  title: 'RBI issues Master Direction on Credit Derivatives, 2026',
  source_url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=13700&Mode=0',
  summary: 'The Reserve Bank has issued directions on credit derivatives for regulated entities.',
  ...over,
});
const liveRows = [
  live(),
  live({ date: 'Mon, 12 Oct 2026 20:00:00 GMT', title: 'Auction of State Government Securities', source_url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63400' }),
  live({ date: 'Fri, 09 Oct 2026 09:00:00 IST', title: 'Money Market Operations as on October 8, 2026', source_url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63399', summary: '' }),
  live({ date: '2026-10-07', title: 'SEBI circular on investor charters', source_url: 'https://www.sebi.gov.in/legal/circulars/oct-2026/investor-charters_100.html', summary: 'A circular.' }),
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fromLabel = (label) => { const [d, m, y] = label.split(' '); return `${y}-${String(MONTHS.indexOf(m) + 1).padStart(2, '0')}-${d}`; };
const labelOf = (iso) => { const [y, m, d] = iso.split('-'); return `${d} ${MONTHS[Number(m) - 1]} ${y}`; };

/** Reader-facing strings: everything but the opened related record. */
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'row') strings(x, out);
  return out;
};
/** Strings that are the platform's own wording: not the notice's title, a related notice's title or pack/feed prose. */
const ownWords = (m) => strings({ ...m, title: undefined, touches: m.touches && { ...m.touches, links: [] }, about: { ...m.about, cards: [] } });

/** What the panel draws as nodes and fixed links: not the titles of the related notices it opens. */
const drawn = (m) => strings([m.touches.nodes, m.touches.links.filter((l) => !l.row)]).join(' | ');
const hasName = (text, name) => new RegExp(`(^|[^A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`).test(text);
const impactOf = (row) => buildRecordModel(row, analysisFor(row, pack), ontology, DESKS.regulatory);
const byId = (id) => rows.find((r) => r.id === id);
const penalty = rows.find((r) => r.action_type === 'penalty' && /Bank of Baroda/.test(r.title));
const masterDirection = rows.find((r) => r.action_type === 'master_direction' && r.regulator === 'RBI');
const routine = rows.find((r) => r.action_type === 'routine');
const other = rows.find((r) => r.action_type === 'other');
const direction = rows.find((r) => r.action_type === 'direction');
const sebi = rows.find((r) => r.regulator === 'SEBI');
const unpacked = rows.find((r) => !analysisFor(r, pack));
const day = (r) => r.date;
const ordered = [...rows].sort((a, b) => day(a).localeCompare(day(b)));
const earliest = ordered[0];
const latest = ordered.at(-1);
const middle = rows.find((r) => day(r) > day(earliest) && day(r) < day(latest));

afterEach(() => vi.unstubAllGlobals());

// F124 N4: a notice panel shows only what the row and its analysis hold. A live feed row holds
// four fields, so its panel is smaller, never padded with placeholders.
describe('National regulatory adapter', () => {
  it('uses fixtures that match the live row shape exactly', () => {
    for (const r of liveRows) expect(Object.keys(r).sort()).toEqual(LIVE_KEYS);
  });

  it('honours the panel contract for every embedded row, with and without packs, and for live rows', () => {
    expect(rows).toHaveLength(121);
    for (const r of rows) {
      expect(contractProblems(model(r)), r.id).toEqual([]);
      expect(contractProblems(model(r, { packs: null })), r.id).toEqual([]);
      expect(contractProblems(model(r, { packs: { ...packs, ready: false } })), r.id).toEqual([]);
    }
    for (const r of liveRows) {
      expect(contractProblems(model(r)), r.title).toEqual([]);
      expect(contractProblems(model(r, { packs: null })), r.title).toEqual([]);
      expect(contractProblems(model(r, { rows: liveRows })), r.title).toEqual([]);
      expect(contractProblems(nationalRegulatory(r)), r.title).toEqual([]); // no ctx at all
    }
  });

  describe('tiles', () => {
    it('shows Issued, Regulator and Action type for an embedded row, plus the pack category when held', () => {
      const m = model(penalty);
      expect(m.glance.tiles.map((t) => t.label)).toEqual(['Issued', 'Regulator', 'Action type', 'Category']);
      expect(m.glance.tiles.find((t) => t.label === 'Regulator').value).toBe('RBI');
      expect(m.glance.tiles.find((t) => t.label === 'Action type').value).toBe('Penalty');
      expect(m.glance.tiles.find((t) => t.label === 'Category').sub).toMatch(/register analysis/i);
      expect(model(unpacked).glance.tiles.map((t) => t.label)).toEqual(['Issued', 'Regulator', 'Action type']);
      expect(model(penalty, { packs: null }).glance.tiles.map((t) => t.label)).toEqual(['Issued', 'Regulator', 'Action type']);
    });

    it('shows Issued and a Regulator that reads "Not on record" for a live row, and no action type', () => {
      for (const r of liveRows) {
        const m = model(r);
        expect(m.glance.tiles.map((t) => t.label)).toEqual(['Issued', 'Regulator']);
        expect(m.glance.tiles[1].value).toBe('Not on record');
        expect(m.badge).toBeUndefined();
      }
    });

    it('labels the action types readably', () => {
      expect(model(masterDirection).glance.tiles.find((t) => t.label === 'Action type').value).toBe('Master direction');
      expect(model(routine).glance.tiles.find((t) => t.label === 'Action type').value).toBe('Routine');
      expect(model(other).glance.tiles.find((t) => t.label === 'Action type').value).toBe('Other');
    });

    it('never prints placeholder wording as data', () => {
      for (const r of [...rows, ...liveRows]) expect(ownWords(model(r)).join(' | '), r.title).not.toMatch(/not on row|\bnull\b|—|\bundefined\b|\bNaN\b/i);
    });
  });

  describe('dates', () => {
    it('reads an embedded ISO date as that calendar day', () => {
      expect(model(byId('1')).glance.tiles[0].value).toBe('03 Jul 2026');
      for (const r of rows) expect(model(r).glance.tiles[0].value, r.id).toBe(labelOf(r.date));
    });

    it('reads RFC 822 feed dates in India time with no timezone drift', () => {
      const issued = (date) => model(live({ date })).glance.tiles[0].value;
      expect(issued('Tue, 13 Oct 2026 10:16:00 +0530')).toBe('13 Oct 2026');
      expect(issued('Mon, 12 Oct 2026 20:00:00 GMT')).toBe('13 Oct 2026'); // 01:30 on the 13th in India
      expect(issued('Mon, 12 Oct 2026 10:00:00 GMT')).toBe('12 Oct 2026');
      expect(issued('Fri, 09 Oct 2026 09:00:00 IST')).toBe('09 Oct 2026');
      expect(issued('Mon, 12 Oct 2026 23:30:00 -0500')).toBe('13 Oct 2026'); // 04:30 UTC, 10:00 IST on the 13th
      expect(issued('2026-10-07')).toBe('07 Oct 2026');
      expect(issued('2026-10-07T23:30:00Z')).toBe('08 Oct 2026');
    });

    it('gives the same label whatever the machine time zone is', () => {
      const saved = process.env.TZ;
      try {
        const labels = ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Kolkata'].map((tz) => {
          process.env.TZ = tz;
          return [model(live()).glance.tiles[0].value, model(live({ date: '2026-10-07' })).glance.tiles[0].value, model(byId('1')).glance.tiles[0].value];
        });
        expect(labels[1]).toEqual(labels[0]);
        expect(labels[2]).toEqual(labels[0]);
        expect(labels[0]).toEqual(['13 Oct 2026', '07 Oct 2026', '03 Jul 2026']);
      } finally {
        if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
      }
    });

    it('reads the RBI feed\'s zoneless pubDate as the calendar day it names, without converting the time', () => {
      // The live RBI RSS sends "Mon, 12 Oct 2026 23:55:00" with no zone (seen 2026-10-13).
      for (const [date, label] of [['Mon, 12 Oct 2026 23:55:00', '12 Oct 2026'], ['Sat, 10 Oct 2026 01:20:00', '10 Oct 2026']]) {
        const m = model(live({ date }));
        expect(m.glance.tiles[0].value, date).toBe(label);
        expect(m.footer.provenance.asOf, date).toBe(label);
      }
    });

    it('does not guess at a date it cannot read: no date, a flag, and no window timeline', () => {
      for (const date of ['', '12/10/2026', 'Tuesday', 'Tue, 31 Feb 2026 10:00:00 GMT', 'Tue, 13 Oct 2026 10:16:00 XYZ', '2026-10-07T10:00:00']) {
        const m = model(live({ date }));
        expect(m.glance.tiles[0].value, date).toBe('Not on record');
        expect(m.footer.provenance.asOf, date).toBeUndefined();
        expect(m.footer.provenance.flags, date).toContain('as-of not on record');
        expect(m.glance.visual, date).toBeUndefined();
        expect(contractProblems(m), date).toEqual([]);
      }
    });
  });

  describe('header', () => {
    it('badges only a real action type: penalty red, direction amber, routine grey, nothing for other', () => {
      expect(model(penalty).badge).toMatchObject({ tone: 'red' });
      expect(model(masterDirection).badge).toMatchObject({ tone: 'amber' });
      expect(model(direction).badge).toMatchObject({ tone: 'amber' });
      expect(model(routine).badge).toMatchObject({ tone: 'grey' });
      expect(model(other).badge).toBeUndefined();
    });

    it('titles the notice and names the regulator and type in the meta where held', () => {
      const m = model(penalty);
      expect(m.title).toBe(penalty.title);
      expect(m.meta).toEqual(['RBI', 'Penalty']);
      expect(model(live()).meta).toEqual(['Regulatory notice']);
    });

    it('decodes feed entities and strips escaped markup from live text, leaving plain text', () => {
      const m = model(live({ title: 'Banks &amp; NBFCs: directions &#39;2026&#39;', summary: '&lt;p&gt;The Bank &amp; the market&lt;/p&gt;<b>now</b>‮ hidden\u0007' }));
      expect(m.title).toBe("Banks & NBFCs: directions '2026'");
      const card = m.about.cards.find((c) => /feed/i.test(c.heading));
      expect(card.body).toBe('The Bank & the market now hidden');
    });

    it('links the instrument PDF and the source, https only, with no duplicates', () => {
      const m = model(penalty);
      expect(m.links.map((l) => l.href)).toEqual([penalty.pdf_url, penalty.detail_url]);
      expect(m.links[0].label).toMatch(/pdf/i);
      for (const r of [...rows, ...liveRows]) {
        const hrefs = model(r).links.map((l) => l.href);
        expect(new Set(hrefs).size, r.title).toBe(hrefs.length);
        for (const h of hrefs) expect(h).toMatch(/^https:\/\//);
      }
      expect(model(live({ source_url: 'http://www.rbi.org.in/x' })).links).toEqual([]);
      expect(model(live({ source_url: 'https://news.google.com/rss/articles/abc' })).links).toEqual([]);
      const pdfSource = 'https://rbidocs.rbi.org.in/rdocs/x.PDF';
      expect(model(live({ source_url: pdfSource })).links).toHaveLength(1);
    });

    it('takes a SEBI PDF from the pack when the row holds none, as the current view does', () => {
      expect(sebi.pdf_url).toBe('');
      expect(analysisFor(sebi, pack).pdf_url).toMatch(/^https:/);
      expect(model(sebi).links.some((l) => /pdf/i.test(l.label) && l.href === analysisFor(sebi, pack).pdf_url)).toBe(true);
      expect(model(sebi, { packs: null }).links.some((l) => /pdf/i.test(l.label))).toBe(false);
    });

    it('pairs each row with its own analysis entry: a PDF held by both agrees', () => {
      for (const r of rows) { const a = analysisFor(r, pack); if (a && r.pdf_url) expect(a.pdf_url, r.id).toBe(r.pdf_url); }
    });
  });

  describe('the rolling window', () => {
    const steps = (r, over) => model(r, over).glance.visual.steps;

    it('draws a timeline titled "The rolling window" for every dated notice', () => {
      for (const r of rows) {
        const v = model(r).glance.visual;
        expect(v.type, r.id).toBe('timeline');
        expect(v.title).toBe('The rolling window');
      }
    });

    it('orders the steps by date and marks exactly one as now', () => {
      for (const r of rows) {
        const s = steps(r);
        expect(s.filter((x) => x.now), r.id).toHaveLength(1);
        const dates = s.map((x) => fromLabel(x.detail.slice(0, 11)));
        expect(dates, r.id).toEqual([...dates].sort());
        expect(new Set(s.map((x) => x.label)).size, r.id).toBe(s.length); // labels are keys
      }
    });

    it('places a middle notice between the earliest and the latest on hand', () => {
      const s = steps(middle);
      expect(s.map((x) => x.label)).toEqual(['Earliest on hand', 'This notice', 'Latest on hand']);
      expect(s[0].detail).toBe(labelOf(earliest.date));
      expect(s[1].detail).toBe(labelOf(middle.date));
      expect(s[2].detail).toBe(labelOf(latest.date));
      expect(s[1].now).toBe(true);
      expect(s[0].done).toBe(true);
    });

    it('does not repeat the notice as its own earliest or latest', () => {
      const first = steps(earliest);
      expect(first.map((x) => x.label)).toEqual(['This notice', 'Latest on hand']);
      expect(first[0].detail).toMatch(/earliest on hand/i);
      const last = steps(latest);
      expect(last.map((x) => x.label)).toEqual(['Earliest on hand', 'This notice']);
      expect(last.at(-1).detail).toMatch(/latest on hand/i);
      const alone = steps(earliest, { rows: [earliest] });
      expect(alone.map((x) => x.label)).toEqual(['This notice']);
    });

    it('uses only dates the rows hold', () => {
      const held = new Set(rows.map((r) => labelOf(r.date)));
      for (const r of rows) for (const s of steps(r)) expect(held.has(s.detail.slice(0, 11)), `${r.id} ${s.detail}`).toBe(true);
    });

    it('says it is a rolling window of N notices, not an archive', () => {
      const v = model(middle).glance.visual;
      expect(v.caption).toMatch(/rolling window of 121 notices/i);
      expect(v.caption).toMatch(/not an archive/i);
      expect(v.right).toBe('121 notices');
      expect(model(live(), { rows: liveRows }).glance.visual.caption).toMatch(/rolling window of 4 notices/i);
    });

    it('counts a selection that is not in the list, and a copy of it only once', () => {
      expect(model(middle, { rows: [] }).glance.visual.caption).toMatch(/window of 1 notice\b/i);
      expect(model({ ...middle }).glance.visual.caption).toMatch(/window of 121 notices/i);
    });

    it('leaves undated and status rows out of the places, and says how many it could not place', () => {
      const status = { status: 'source_status', title: 'Source offline or empty', date: '' };
      const undated = { ...live({ date: 'soon' }) };
      const caption = model(liveRows[0], { rows: [...liveRows, undated, status] }).glance.visual.caption;
      expect(caption).toMatch(/window of 5 notices/i);
      expect(caption).toMatch(/1 has no readable date/i);
    });
  });

  describe('touches', () => {
    it('uses the four lanes: regulator, instrument, entity classes, sectors', () => {
      for (const r of [penalty, routine, sebi, ...liveRows]) expect(model(r).touches.lanes).toEqual(['REGULATOR', 'INSTRUMENT', 'ENTITY CLASSES', 'SECTORS']);
    });

    it('draws the regulator, this notice, the classes the regulator governs and the sectors its text names', () => {
      const n = model(penalty).touches.nodes;
      expect(n.left.l1).toBe('RBI');
      expect(n.left.l2).toBe('Reserve Bank of India');
      expect(n.center).toMatchObject({ code: 'N', l1: 'This notice', l2: 'Penalty' });
      expect(n.right.l1).toBe('Banks'); // RBI governs banks, public and private banks, NBFCs
      expect(n.right.l2).toMatch(/\+3 more/);
      expect(n.far.l1).toBe('Banks'); // a penalty on a bank names the sector in its own text
    });

    it('never draws an ontology theme as an entity class (keyword matches such as "auction" are not entity classes)', () => {
      const themes = ontology.themes.map((t) => t.name);
      expect(impactOf(byId('1')).segments.some((s) => s.kind === 'theme')).toBe(true); // the defect the guard is about
      for (const r of rows) {
        const m = model(r);
        const shown = strings([m.touches.nodes, m.about.rows]);
        for (const t of themes) expect(shown.some((s) => s.includes(t)), `${r.id} ${t}`).toBe(false);
      }
    });

    it('reads the SEBI classes from the ontology, and nothing about a regulator the ontology does not know', () => {
      expect(model(sebi).touches.nodes.right.l1).toBe('Financial Services');
      // The ontology knows TRAI, though no TRAI notice is held today; it would read its own classes.
      const trai = model({ ...penalty, regulator: 'TRAI' }).touches.nodes;
      expect(trai.left).toMatchObject({ l1: 'TRAI', l2: 'Telecom Regulatory Authority of India' });
      expect(trai.right.l1).toBe('Telecom');
      const unknown = model({ ...penalty, regulator: 'Unlisted Authority' }).touches.nodes;
      expect(unknown.left).toMatchObject({ l1: 'Unlisted Authority', l2: 'issuing regulator' });
      expect(unknown.right).toBeUndefined();
    });

    it('omits what it does not hold, so the lane reads "None on record"', () => {
      const n = model(liveRows[0]).touches.nodes;
      expect(n.left).toBeUndefined(); // a live row names no regulator
      expect(n.right).toBeUndefined();
      expect(n.far).toBeUndefined();
      expect(n.center).toMatchObject({ code: 'N', l1: 'This notice' });
      const bare = model(penalty, { packs: null }).touches.nodes;
      expect(bare.left.l1).toBe('RBI');
      expect(bare.right).toBeUndefined();
      expect(bare.far).toBeUndefined();
    });

    it('draws no company for a routine notice, and says the links are withheld', () => {
      const names = ontology.companies.map((c) => c.name);
      const routineRows = rows.filter((r) => impactOf(r).routine);
      expect(routineRows.length).toBeGreaterThan(40);
      // Money Market Operations rows are matched to "Central Bank of India" by the shared impact model.
      expect(routineRows.some((r) => impactOf(r).companies.length > 0)).toBe(true);
      for (const r of routineRows) {
        const m = model(r);
        const shown = `${drawn(m)} | ${strings(m.about.rows).join(' | ')}`;
        for (const n of names) expect(hasName(shown, n), `${r.id} ${n}`).toBe(false);
        expect(m.touches.links.some((l) => /withheld/i.test(l.title) && /routine/i.test(l.detail)), r.id).toBe(true);
      }
      // A routine notice whose own title names a company still draws none.
      const named = { ...routine, title: 'Auction of Treasury Bills held with Bank of Baroda' };
      expect(impactOf(named).routine).toBe(true);
      expect(impactOf(named).companies.some((c) => c.path === 'P1' && c.name === 'Bank of Baroda')).toBe(true);
      expect(drawn(model(named))).not.toContain('Bank of Baroda');
    });

    it('names a company for a non-routine notice only when its full name is in the title', () => {
      const bob = rows.find((r) => /Bank of Baroda/.test(r.title) && r.action_type === 'penalty');
      const link = model(bob).touches.links.find((l) => /named in the title/i.test(l.title));
      expect(link.detail).toContain('Bank of Baroda');
      // The shared impact model also matches "Central Bank" inside "Co-operative Central Bank" and a rate
      // quoted from the State Bank of India; neither is a company the notice is about.
      const coop = byId('49');
      expect(impactOf(coop).companies.some((c) => c.path === 'P1' && c.name === 'Central Bank of India')).toBe(true);
      const nirmal = byId('13');
      expect(impactOf(nirmal).companies.some((c) => c.path === 'P1' && c.name === 'State Bank of India')).toBe(true);
      for (const r of [coop, nirmal]) expect(model(r).touches.links.some((l) => /named in the title/i.test(l.title)), r.id).toBe(false);
    });

    it('draws no sector-level (path P2) company for any notice', () => {
      for (const r of rows) {
        const shown = drawn(model(r));
        for (const c of ontology.companies) if (hasName(shown, c.name)) expect(r.title, `${r.id} ${c.name}`).toContain(c.name);
      }
    });
  });

  describe('related notices', () => {
    const links = (r, over) => model(r, over).touches.links.filter((l) => l.row);

    it('links up to three other notices from the same regulator, never the selection or a copy of it', () => {
      for (const r of [penalty, routine, sebi, middle]) {
        const l = links({ ...r });
        expect(l.length, r.id).toBeGreaterThan(0);
        expect(l.length, r.id).toBeLessThanOrEqual(3);
        for (const x of l) {
          expect(rows).toContain(x.row);
          expect(x.row.regulator).toBe(r.regulator);
          expect(x.row.id).not.toBe(r.id);
          expect(`${x.row.title}|${x.row.date}`).not.toBe(`${r.title}|${r.date}`);
        }
      }
    });

    it('lists the most recent first, with a count of the rest', () => {
      const l = model(sebi).touches.links;
      const dates = l.filter((x) => x.row).map((x) => x.row.date);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(l.at(-1)).toMatchObject({ title: 'Other SEBI notices' });
      expect(l.at(-1).detail).toMatch(/^\d+ in this window$/);
    });

    it('excludes a same-titled, same-dated copy and keeps every link title distinct', () => {
      const a = { id: 'a', regulator: 'RBI', title: 'Notice A', date: '2026-07-03' };
      const copy = { ...a, id: 'a2' };
      const sameTitle = (id, date) => ({ id, regulator: 'RBI', title: 'Repeated title', date });
      const list = [a, copy, sameTitle('b', '2026-07-02'), sameTitle('c', '2026-07-01'), { id: 'd', regulator: 'RBI', title: 'Notice D', date: '2026-06-30' }, { id: 'e', regulator: 'SEBI', title: 'Other regulator', date: '2026-07-04' }];
      const l = model(a, { rows: list }).touches.links;
      expect(l.filter((x) => x.row).map((x) => x.row.id)).toEqual(['b', 'd']);
      expect(new Set(l.map((x) => x.title)).size).toBe(l.length);
      for (const r of rows) { const t = model(r).touches.links.map((x) => x.title); expect(new Set(t).size, r.id).toBe(t.length); }
    });

    it('links nothing for a row that names no regulator, and uses only the rows on hand', () => {
      expect(links(liveRows[0], { rows: liveRows })).toEqual([]);
      expect(links(penalty, { rows: [penalty] })).toEqual([]);
      expect(links(penalty, { rows: undefined })).toEqual([]);
    });
  });

  describe('about', () => {
    it('lists regulator, action type, issued date and detail page for an embedded row', () => {
      const m = model(penalty);
      const about = Object.fromEntries(m.about.rows);
      expect(about.Regulator).toBe('RBI');
      expect(about['Action type']).toBe('Penalty');
      expect(about.Issued).toBe(labelOf(penalty.date));
      expect(about['Detail page']).toBe('rbi.org.in');
      expect(m.about.label).toBe('02 · About this notice');
    });

    it('shows the pack brief and possible effects as register analysis only when held', () => {
      const a = analysisFor(penalty, pack);
      const cards = model(penalty).about.cards;
      expect(cards.find((c) => /^Summary/.test(c.heading))).toMatchObject({ heading: 'Summary (register analysis)', body: a.brief });
      expect(cards.find((c) => /^Possible effects/.test(c.heading))).toMatchObject({ heading: 'Possible effects (register analysis)' });
      expect(cards.find((c) => /^Possible effects/.test(c.heading)).body).toContain(a.possible_effects[0]);
      expect(model(unpacked).about.cards).toEqual([]);
      expect(model(penalty, { packs: null }).about.cards).toEqual([]);
    });

    it('shows a live summary as plain text from the feed, and nothing when the feed sent none', () => {
      const m = model(live());
      expect(m.about.cards).toEqual([{ heading: 'Summary as published by the feed', body: live().summary }]);
      expect(model(live({ summary: '' })).about.cards).toEqual([]);
    });

    it('does not attach an embedded analysis entry to a live row', () => {
      const m = model(live({ id: undefined }));
      expect(m.about.cards.every((c) => /feed/i.test(c.heading))).toBe(true);
      expect(m.glance.tiles.some((t) => t.label === 'Category')).toBe(false);
    });
  });

  describe('footer', () => {
    it('asks about the instrument and names the register with the notice date as its as-of', () => {
      const f = model(penalty).footer;
      expect(f.ask).toBe('Ask AI about this instrument');
      expect(f.provenance.source).toMatch(/RBI/);
      expect(f.provenance.source).toMatch(/register/i);
      expect(f.provenance.asOf).toBe(labelOf(penalty.date));
      expect(f.provenance.flags).toEqual([]);
      expect(model(sebi).footer.provenance.source).toMatch(/SEBI/);
    });

    it('names the regulator RSS feed for a live row without claiming which regulator', () => {
      const f = model(live()).footer;
      expect(f.provenance.source).toMatch(/RSS/);
      expect(f.provenance.source).toContain('www.rbi.org.in');
      expect(f.provenance.asOf).toBe('13 Oct 2026');
      const noLink = model(live({ source_url: '' })).footer.provenance.source;
      expect(noLink).toMatch(/RSS/);
      expect(noLink).not.toMatch(/rbi\.org|sebi\.gov/i);
    });

    it('says this is a rolling window, not an archive, so it cannot answer what applies to us', () => {
      for (const r of [penalty, ...liveRows]) {
        const note = model(r).footer.note;
        expect(note, r.title).toMatch(/rolling window/i);
        expect(note, r.title).toMatch(/not an archive/i);
        expect(note, r.title).toMatch(/what applies/i);
        expect(note, r.title).toMatch(/TRAI and CCI/);
      }
      expect(model(penalty).footer.note).toMatch(/121 notices/);
    });
  });

  describe('no generation and no network', () => {
    it('makes no network call while building any model', () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      for (const r of [...rows, ...liveRows]) model(r);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not import or name a generation, source-reading or network function', () => {
      const source = readFileSync(fileURLToPath(new URL('./nationalRegulatory.js', import.meta.url)), 'utf8');
      expect(source).not.toMatch(/resolveOrganisedBrief|ensureDeskBrief|sourceDoc|\bfetch\s*\(|XMLHttpRequest|\/api\/|loadAnalysisMap|loadOntology/);
      const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
      // feedDate.js and feedText.js (F127) are pure helpers that import nothing.
      expect(imports.sort()).toEqual(['../../../lib/impactRecord.js', './common.js', './feedDate.js', './feedText.js']);
    });
  });
});
