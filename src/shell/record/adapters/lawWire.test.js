import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RecordPanel from '../RecordPanel.jsx';
import { contractProblems } from '../modelContract.js';
import lawWire, { LAW_WIRE_FEATURES } from './lawWire.js';

/**
 * F128 L4: the nine Law wire modules. A wire item is news coverage of a forum, never a record of
 * it. The fixtures copy the two live row shapes built in server/featureFeed.mjs:
 *  - Google News RSS: `parseRssOrXml` gives { date (RFC 822 pubDate), title ("Headline - Publisher"),
 *    source_url (a news.google.com redirect), summary (tags stripped, at most 400 characters, often
 *    the headline again), publisher (from <source>; absent when the item has none) }, and the judiciary
 *    wire branch adds section "COVERAGE — GOOGLE NEWS RSS" and reporting_search;
 *  - GDELT DOC 2.0 fallback: the article's own fields (url, title, seendate "20261012T143000Z", domain,
 *    language, sourcecountry) plus date (= seendate), source_url (= url), section "COVERAGE — GDELT 2.0".
 */
const GOOGLE_LABEL = 'Google News RSS — coverage mentions, not an official court dataset';
const GDELT_LABEL = 'GDELT DOC 2.0 — news reporting search, not an official court dataset';
const google = (over = {}) => ({
  date: 'Mon, 12 Oct 2026 14:30:00 GMT',
  title: 'High Court stays eviction drive near the river - The Hindu',
  source_url: 'https://news.google.com/rss/articles/CBMiR2h0dHBzOi8vZXhhbXBsZS5jb20?oc=5',
  summary: 'The court said the notices were issued without a hearing and listed the matter again after the vacation.',
  publisher: 'The Hindu',
  section: 'COVERAGE — GOOGLE NEWS RSS',
  reporting_search: GOOGLE_LABEL,
  ...over,
});
const gdelt = (over = {}) => ({
  url: 'https://www.livelaw.in/top-stories/tribunal-sets-aside-penalty-2026-10-12',
  title: 'Tribunal sets aside penalty on telecom operator',
  seendate: '20261012T143000Z',
  domain: 'livelaw.in',
  language: 'English',
  sourcecountry: 'India',
  date: '20261012T143000Z',
  source_url: 'https://www.livelaw.in/top-stories/tribunal-sets-aside-penalty-2026-10-12',
  section: 'COVERAGE — GDELT 2.0',
  reporting_search: GDELT_LABEL,
  ...over,
});

const FIXTURES = {
  'google with publisher': google(),
  'google without publisher': google({ publisher: undefined, title: 'Tribunal reserves order in telecom dues case - Mint' }),
  'google ampersand': google({ title: 'Tata &amp; Sons challenge heard - Business Standard', publisher: 'Business Standard', summary: 'Arguments on the &amp; clause continue.' }),
  'google GMT date': google({ date: 'Tue, 13 Oct 2026 01:05:00 GMT' }),
  'summary repeats the title': google({ summary: 'High Court stays eviction drive near the river  The Hindu' }),
  'empty summary': google({ summary: '' }),
  'gdelt with domain': gdelt(),
  'gdelt without domain': gdelt({ domain: '' }),
  'zoneless date': google({ date: 'Mon, 12 Oct 2026 14:30:00' }),
  'garbage date': google({ date: 'a few hours ago' }),
  'no date at all': google({ date: '' }),
  'http link': google({ source_url: 'http://news.example.com/plain' }),
  'no link': google({ source_url: '' }),
  'bidi and control characters': google({ title: 'Court‮ hears\u0007 appeal​ today - M‮int', publisher: 'M⁦int​', summary: 'Hearing\u0000 on⁩ Friday‏.' }),
  'checklist-derived fields': google({ entityName: 'DERIVED-ENTITY-MARK', id: 'DERIVED-ID-MARK', eventDate: '2031-01-01' }),
};

// The nine modules, written out independently of the adapter (the task table).
const CASES = [
  {
    feature: 'UP High Court (Allahabad) Order Feed', pub: 'the Allahabad High Court', clock: 'Next date',
    needs: ['CNR', 'Stage', 'Bench and roster', 'Interim order status', 'Next date and purpose', 'Order sheet text', 'Connected matters'],
    quick: ['Hearing note', 'Client status update'],
    callout: 'This module holds news coverage of the Allahabad High Court, not its cause lists or orders. A report of an order is not the order.',
    cite: 'There is no case to cite. Cite the publisher and the date, and say plainly that the underlying order was not read.',
  },
  {
    feature: 'District Court Case Tracker', pub: 'eCourts', clock: 'Next date',
    needs: ['CNR number', 'Case type, number and year', 'Parties', 'Acts and sections', 'Stage', 'Last and next hearing date', 'Order PDFs'],
    quick: ['Hearing note', 'Client status update'],
    callout: 'A district-court tracker with no case on it: the rows are news items, and none reaches a cause list, a stage or an order.',
    cite: 'There is no case to cite. Cite the publisher and the date, and say plainly that the underlying order was not read.',
  },
  {
    feature: 'NGT Environmental Litigation Tracker', pub: 'the NGT', clock: 'Compliance by',
    needs: ['Original Application number and year', 'Zonal bench', 'Applicant and respondent', 'Project or clearance challenged', 'Direction issued', 'Compliance deadline', 'Committee reports on record'],
    quick: ['Case note', 'Compliance & deadline sheet'],
    callout: 'NGT directions carry compliance deadlines and compensation, the two things a client asks about first. Neither is on this row, and neither can be inferred from a headline.',
    cite: 'A direction has consequences; a report of a direction does not. Quote the publisher, and get the order before advising.',
  },
  {
    feature: 'CAT & Consumer Disputes (NCDRC) Watch', pub: 'CAT and the NCDRC', clock: 'Appeal window',
    needs: ['OA or complaint number', 'Bench or commission', 'Applicant or complainant and opposite party', 'Service cadre, or value of goods and services', 'Impugned order or deficiency alleged', 'Relief sought', 'Relief granted'],
    quick: ['Case note', 'Limitation & deadline sheet'],
    callout: 'Service law (CAT) and consumer law (NCDRC) share no procedure, limitation period or relief. This item does not say which forum, if either, decided anything.',
    cite: 'Say which forum, or say neither.',
  },
  {
    feature: 'HC Judge Profiles & Bench Analytics', pub: 'the High Courts and the Supreme Court collegium', clock: 'Retires',
    needs: ['Appointment and elevation dates', 'Parent High Court', 'Benches and rosters sat on', 'Judgments authored', 'Subject distribution', 'Cited-by count', 'Denominator for every rate shown'],
    quick: ['Bench memo (factual)'],
    callout: 'Factual only. This row is commentary, not a record of a judge: no appointment dates, judgments or rates are on it, and none are computed.',
    cite: 'Commentary about a judge is not a record of a judge. Attribute it to the publisher and leave it there.',
  },
  {
    feature: 'ICC Proceedings', pub: 'the ICC', clock: 'Next step',
    needs: ['Situation and case number', 'Chamber', 'Suspect or accused', 'Charges under the Rome Statute', 'Procedural stage', 'Filing date and document number', 'Warrant status'],
    quick: ['Case brief', 'Chronology'],
    callout: 'ICC coverage names individuals. Nothing on this row establishes a charge, a warrant or a stage; a headline about a named person is not a court record.',
    cite: 'Name the stage or do not name the person. “Reported to be under investigation” and “charged” are different claims.',
  },
  {
    feature: 'ICJ Proceedings', pub: 'the ICJ', clock: 'Next time-limit',
    needs: ['Case title and General List number', 'Applicant and respondent', 'Basis of jurisdiction', 'Phase', 'Orders and judgments with dates', 'Time-limits fixed for pleadings', 'Separate and dissenting opinions'],
    quick: ['Case brief', 'Chronology'],
    callout: 'The ICJ publishes its contentious and advisory lists, numbered. This row is a news item, not an entry in them.',
    cite: 'Provisional measures bind. A report that measures were sought does not.',
  },
  {
    feature: 'WTO Dispute Settlement', pub: 'the WTO', clock: 'Compliance period ends',
    needs: ['DS number', 'Complainant and respondent', 'Measure at issue', 'Agreements and articles cited', 'Panel composition and third parties', 'Current stage with its date', 'Compliance and retaliation status'],
    quick: ['Dispute brief', 'Chronology'],
    callout: 'WTO disputes carry a DS number and a published timeline. This row is a news item and names neither.',
    cite: 'Cite the dispute number or cite nothing.',
  },
  {
    feature: 'Sector Tribunals (ITAT / TDSAT / SAT / DRT)', pub: 'ITAT, TDSAT, SAT and DRT', clock: 'Appeal window',
    needs: ['Appeal or OA number', 'Bench', 'Assessment year, licence or order appealed against', 'Section or regulation in dispute', 'Quantum or penalty', 'Stay status', 'Date of pronouncement and appeal window'],
    quick: ['Case note', 'Limitation & deadline sheet'],
    callout: 'Four tribunals, four statutes, four limitation regimes. This item does not establish which tribunal, if any, decided anything.',
    cite: 'An ITAT order binds differently from a SAT order. Naming the wrong forum is worse than naming none.',
  },
];
const BROAD = ' It was found by a keyword search for this forum and may still not concern it.';
const UNKNOWN = 'Some Other Court Watch';

const feedOf = (feature) => ({ feature, coverage: { through: '7d' } });
const build = (row, feature, extra = {}) => lawWire(row, { rows: [row], feed: feedOf(feature), today: '2026-10-13', ...extra });
const tile = (m, label) => m.glance.tiles.find((t) => t.label === label);
const allStrings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
};
const everyFeature = [...CASES.map((c) => c.feature), UNKNOWN];

describe('Law wire modules (F128 L4)', () => {
  it('names the nine modules exactly', () => {
    expect(LAW_WIRE_FEATURES).toEqual(CASES.map((c) => c.feature));
    expect(LAW_WIRE_FEATURES).toHaveLength(9);
  });

  it('honours the contract for every fixture in every module, and for an unknown module', () => {
    for (const [name, row] of Object.entries(FIXTURES)) {
      for (const feature of everyFeature) expect(contractProblems(build(row, feature)), `${name} / ${feature}`).toEqual([]);
    }
    expect(contractProblems(lawWire(google(), {}))).toEqual([]);
    expect(contractProblems(lawWire(google()))).toEqual([]);
    expect(contractProblems(lawWire({}, { feed: feedOf(CASES[0].feature) }))).toEqual([]);
  });

  describe.each(CASES)('$feature', (c) => {
    it('asks the four questions in order with the forum\'s clock last and tinted', () => {
      const m = build(google(), c.feature);
      expect(m.glance.tiles.map((t) => t.label)).toEqual(['Published', 'Publisher', 'What it is', c.clock]);
      const last = m.glance.tiles[3];
      expect(last).toMatchObject({ value: 'Not on the row', sub: 'the item is coverage', clock: true });
      expect(m.glance.tiles.filter((t) => t.clock)).toHaveLength(1);
      expect(tile(m, 'What it is')).toMatchObject({ value: 'Coverage', sub: 'a news report, not an order' });
    });

    it('lists what a lawyer needs, all marked absent, and says who publishes it', () => {
      const m = build(google(), c.feature);
      expect(m.glance.visual2.title).toBe('What a lawyer needs · what this row has');
      expect(m.glance.visual2.rows.map((r) => r.label)).toEqual(c.needs);
      expect(m.glance.visual2.rows.every((r) => r.value === 'Not on the row' && r.tone === 'red')).toBe(true);
      expect(m.glance.visual2.right).toBe('0 of 7 on the row');
      expect(m.glance.visual2.caption).toBe(`These fields are published by ${c.pub}. This row is a news item and holds none of them.`);
      expect(m.glance.visual).toBeUndefined();
    });

    it('states the module\'s limit as a red callout ending with the broad-search warning', () => {
      const m = build(google(), c.feature);
      expect(m.glance.callout).toEqual({ tone: 'red', text: c.callout + BROAD });
      expect(m.glance.callout.text).not.toMatch(/\b(split|rename|review note)\b/i);
    });

    it('carries the cite card and the Quick exit buttons for the module', () => {
      const m = build(google(), c.feature);
      expect(m.about.cards.at(-1)).toEqual({ heading: 'If you cite this', body: c.cite });
      expect(m.quick.map((q) => q.label)).toEqual(c.quick);
      for (const q of m.quick) {
        expect(q.prompt).toContain('High Court stays eviction drive near the river');
        expect(q.prompt).toMatch(/news (item|report)/i);
        expect(q.prompt).toMatch(/not a court record/i);
        expect(q.prompt).toMatch(/attached item only/i);
        expect(q.prompt).toMatch(/underlying order or record was not read/i);
      }
    });

    it('names the provenance', () => {
      const m = build(google(), c.feature);
      expect(m.footer.provenance.source).toBe(`Google News search results (live); not a record from ${c.pub}`);
      const g = build(gdelt(), c.feature);
      expect(g.footer.provenance.source).toBe(`News search results (live); not a record from ${c.pub}`);
    });
  });

  it('gives an unknown module a valid generic coverage panel', () => {
    const m = build(google(), UNKNOWN);
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Published', 'Publisher', 'What it is', 'Next date']);
    expect(m.glance.visual2.rows.map((r) => r.label)).toEqual(['Case number', 'Parties', 'Forum', 'Stage', 'Order text']);
    expect(m.glance.visual2.right).toBe('0 of 5 on the row');
    expect(m.badge).toEqual({ text: 'Coverage — not an order', tone: 'red' });
    expect(m.glance.callout.tone).toBe('red');
    expect(m.glance.callout.text.endsWith(BROAD.trim())).toBe(true);
    expect(m.quick.length).toBeGreaterThan(0);
    expect(m.about.cards.at(-1).heading).toBe('If you cite this');
    expect(m.footer.provenance.source).toMatch(/^Google News search results \(live\); not a record from /);
  });

  it('marks every wire item as coverage, never as a record', () => {
    for (const row of Object.values(FIXTURES)) {
      expect(build(row, CASES[0].feature).badge).toEqual({ text: 'Coverage — not an order', tone: 'red' });
    }
    expect(build(google(), CASES[0].feature).footer.note).toBe('The item is coverage. Nothing here is an order, a charge, a holding or a stage.');
  });

  describe('headline and publisher', () => {
    it('strips a trailing " - <publisher>" only when it equals the row\'s publisher field exactly', () => {
      expect(build(google(), CASES[0].feature).title).toBe('High Court stays eviction drive near the river');
      // Different publisher text, a longer publisher, a different case and no publisher field: kept as published.
      expect(build(google({ publisher: 'The Hindu BusinessLine' }), CASES[0].feature).title).toBe('High Court stays eviction drive near the river - The Hindu');
      expect(build(google({ publisher: 'the hindu' }), CASES[0].feature).title).toBe('High Court stays eviction drive near the river - The Hindu');
      expect(build(google({ publisher: undefined }), CASES[0].feature).title).toBe('High Court stays eviction drive near the river - The Hindu');
      // A GDELT domain is not a publisher field.
      expect(build(gdelt({ title: 'Tribunal sets aside penalty - livelaw.in' }), CASES[0].feature).title).toBe('Tribunal sets aside penalty - livelaw.in');
      // Only the trailing suffix; a publisher inside the headline stays.
      expect(build(google({ title: 'The Hindu - editorial on courts - The Hindu' }), CASES[0].feature).title).toBe('The Hindu - editorial on courts');
      // Never an empty title.
      expect(build(google({ title: ' - The Hindu' }), CASES[0].feature).title).toBe('- The Hindu');
    });

    it('decodes the few RSS entities once and never turns text back into markup', () => {
      const m = build(google({ title: 'Tata &amp; Sons &amp;amp; Co &lt;b&gt;bold&lt;/b&gt; - Business Standard', publisher: 'Business Standard' }), CASES[0].feature);
      expect(m.title).toBe('Tata & Sons &amp; Co &lt;b&gt;bold&lt;/b&gt;');
      expect(build(FIXTURES['google ampersand'], CASES[0].feature).title).toBe('Tata & Sons challenge heard');
    });

    it('removes bidi marks and control characters from everything it shows', () => {
      const m = build(FIXTURES['bidi and control characters'], CASES[0].feature);
      expect(m.title).toBe('Court hears appeal today');
      expect(tile(m, 'Publisher').value).toBe('Mint');
      // JSON.stringify would escape the C0 controls, so scan the raw strings.
      const shown = allStrings(m).join('\n');
      // eslint-disable-next-line no-control-regex
      expect(shown).not.toMatch(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/);
      expect(shown.length).toBeGreaterThan(500);
      expect(m.about.cards[0].body).toBe('Hearing on Friday.');
    });

    it('keeps the headline as published in the pointers and never shows checklist-derived fields', () => {
      const m = build(FIXTURES['checklist-derived fields'], CASES[0].feature);
      expect(m.about.label).toBe('02 · The pointers');
      expect(m.about.rows).toEqual([
        ['Headline', 'High Court stays eviction drive near the river - The Hindu'],
        ['Publisher', 'The Hindu'],
        ['Published', '12 Oct 2026'],
        ['Section', 'COVERAGE — GOOGLE NEWS'],
      ]);
      const shown = JSON.stringify(m);
      expect(shown).not.toContain('DERIVED-ENTITY-MARK');
      expect(shown).not.toContain('DERIVED-ID-MARK');
      expect(shown).not.toContain('2031-01-01');
    });

    it('omits pointer rows the item does not hold', () => {
      const m = build({ title: 'Bare headline' }, CASES[0].feature);
      expect(m.about.rows).toEqual([['Headline', 'Bare headline']]);
    });
  });

  describe('publication date', () => {
    const published = (row) => tile(build(row, CASES[0].feature), 'Published');

    it('reads an RFC 822 pubDate with a listed zone, as an India date', () => {
      expect(published(google()).value).toBe('12 Oct 2026');
      // 01:05 GMT on the 13th is 06:35 in India; 20:00 GMT on the 12th is already the 13th in India.
      expect(published(google({ date: 'Tue, 13 Oct 2026 01:05:00 GMT' })).value).toBe('13 Oct 2026');
      expect(published(google({ date: 'Mon, 12 Oct 2026 20:00:00 GMT' })).value).toBe('13 Oct 2026');
      expect(published(google({ date: 'Mon, 12 Oct 2026 20:00:00 -0500' })).value).toBe('13 Oct 2026');
      expect(published(google({ date: '12 Oct 2026 08:00 EST' })).value).toBe('12 Oct 2026');
    });

    it('reads a GDELT seendate and an ISO date with a zone', () => {
      expect(published(gdelt()).value).toBe('12 Oct 2026');
      expect(published(gdelt({ seendate: '20261012T200000Z', date: '20261012T200000Z' })).value).toBe('13 Oct 2026');
      expect(published(google({ date: '2026-10-12T20:00:00+00:00' })).value).toBe('13 Oct 2026');
      expect(published(google({ date: '2026-10-12' })).value).toBe('12 Oct 2026');
    });

    it('does not guess: a time with no zone, an unlisted zone, an impossible date or prose is not a date', () => {
      for (const date of ['Mon, 12 Oct 2026 14:30:00', 'Mon, 12 Oct 2026 14:30:00 IST', 'Sat, 31 Feb 2026 10:00:00 GMT', 'a few hours ago', '2026-10-12T14:30:00', '12/10/2026', '', undefined, 20261012]) {
        const t = published(google({ date }));
        expect(t.value, String(date)).toBe('Not on the row');
        const m = build(google({ date }), CASES[0].feature);
        expect(m.footer.provenance.asOf, String(date)).toBeUndefined();
        expect(m.footer.provenance.flags, String(date)).toEqual(['as-of not on record']);
        expect(m.meta.join(' | '), String(date)).not.toMatch(/Published/);
      }
    });

    it('states how the date was known', () => {
      expect(published(google()).sub).toBe('India date; feed publication date');
      expect(published(gdelt()).sub).toBe('India date; first seen by the news search');
    });

    it('uses the date as the footer as-of and in the meta', () => {
      const m = build(google(), CASES[0].feature);
      expect(m.footer.provenance).toMatchObject({ asOf: '12 Oct 2026', flags: [] });
      expect(m.meta).toEqual(['The Hindu', 'Published 12 Oct 2026']);
    });
  });

  describe('publisher tile', () => {
    it('names the publisher as Google News does, else the GDELT domain, else says it is not on the row', () => {
      const g = build(google(), CASES[0].feature);
      expect(tile(g, 'Publisher')).toMatchObject({ value: 'The Hindu', sub: 'as Google News names it' });
      const d = build(gdelt(), CASES[0].feature);
      expect(tile(d, 'Publisher')).toMatchObject({ value: 'livelaw.in', sub: 'publisher domain' });
      const none = build(FIXTURES['google without publisher'], CASES[0].feature);
      expect(tile(none, 'Publisher').value).toBe('Not on the row');
      expect(none.meta).toEqual(['Published 12 Oct 2026']);
    });
  });

  describe('summary card', () => {
    const cards = (row) => build(row, CASES[0].feature).about.cards;

    it('quotes the summary as plain text under "Summary as published"', () => {
      const c = cards(google());
      expect(c).toHaveLength(2);
      expect(c[0]).toEqual({ heading: 'Summary as published', body: 'The court said the notices were issued without a hearing and listed the matter again after the vacation.' });
      expect(cards(FIXTURES['google ampersand'])[0].body).toBe('Arguments on the & clause continue.');
    });

    it('is left out when the summary is empty or only repeats the headline or publisher', () => {
      for (const name of ['summary repeats the title', 'empty summary']) {
        const c = cards(FIXTURES[name]);
        expect(c.map((x) => x.heading), name).toEqual(['If you cite this']);
      }
      for (const summary of [
        'High Court stays eviction drive near the river - The Hindu',
        'High Court stays eviction drive near the river',
        'High Court stays eviction drive near the river&nbsp;&nbsp;The Hindu',
        'The Hindu',
        '  ',
      ]) expect(cards(google({ summary })).map((x) => x.heading), summary).toEqual(['If you cite this']);
      // A summary that adds anything is kept.
      expect(cards(google({ summary: 'High Court stays eviction drive near the river. Hearing on Friday.' })).map((x) => x.heading)).toEqual(['Summary as published', 'If you cite this']);
    });

    it('keeps a non-Latin summary rather than reading it as a repeat', () => {
      const c = cards(google({ title: 'उच्च न्यायालय ने रोक लगाई - Dainik', publisher: 'Dainik', summary: 'सुनवाई शुक्रवार को होगी।' }));
      expect(c.map((x) => x.heading)).toEqual(['Summary as published', 'If you cite this']);
    });
  });

  describe('links', () => {
    it('opens the original item only over https', () => {
      expect(build(google(), CASES[0].feature).links).toEqual([{ label: 'Open the original item', href: google().source_url }]);
      expect(build(FIXTURES['http link'], CASES[0].feature).links).toEqual([]);
      expect(build(FIXTURES['no link'], CASES[0].feature).links).toEqual([]);
    });

    it('relates the same publisher\'s other items and never the item itself', () => {
      const self = google();
      const copy = { ...google() }; // the selection may be a copy of its feed row
      const rows = [
        { status: 'source_status', title: 'Feed notice', publisher: 'The Hindu', source_url: '' },
        self,
        google({ title: 'Second story - The Hindu', source_url: 'https://news.google.com/rss/articles/two', date: 'Sun, 11 Oct 2026 08:00:00 GMT' }),
        google({ title: 'Third story - The Hindu', source_url: 'https://news.google.com/rss/articles/three', date: 'Not a date' }),
        google({ title: 'Fourth story - The Hindu', source_url: 'https://news.google.com/rss/articles/four' }),
        google({ title: 'Fifth story - The Hindu', source_url: 'https://news.google.com/rss/articles/five' }),
        google({ title: 'Other outlet story - Mint', source_url: 'https://news.google.com/rss/articles/six', publisher: 'Mint' }),
        google({ title: 'No outlet story', source_url: 'https://news.google.com/rss/articles/seven', publisher: undefined }),
      ];
      for (const record of [self, copy]) {
        const links = lawWire(record, { rows, feed: feedOf(CASES[0].feature), today: '2026-10-13' }).touches.links;
        expect(links).toHaveLength(3);
        for (const l of links) {
          expect(l.row).toBeTruthy();
          expect(l.row).not.toBe(record);
          expect(l.row.source_url).not.toBe(record.source_url);
          expect(l.row.publisher).toBe('The Hindu');
          expect(l.detail).toMatch(/^Same publisher · /);
        }
        expect(links[0]).toMatchObject({ title: 'Second story', detail: 'Same publisher · 11 Oct 2026' });
        expect(links[1]).toMatchObject({ title: 'Third story', detail: 'Same publisher · undated' });
      }
      // No publisher on the record: nothing is related.
      const bare = lawWire(rows.at(-1), { rows, feed: feedOf(CASES[0].feature) });
      expect(bare.touches.links).toEqual([]);
    });

    it('finds the same GDELT domain regardless of case and a leading www', () => {
      const a = gdelt();
      const b = gdelt({ title: 'Another story', domain: 'www.LiveLaw.in', url: 'https://www.livelaw.in/b', source_url: 'https://www.livelaw.in/b' });
      const links = lawWire(a, { rows: [a, b], feed: feedOf(CASES[0].feature) }).touches.links;
      expect(links.map((l) => l.title)).toEqual(['Another story']);
    });

    it('numbers the section 03', () => {
      const m = build(google(), CASES[0].feature);
      expect(m.touches.label).toBe('03 · Entity & what it touches');
    });
  });

  describe('footer', () => {
    const feed = feedOf(CASES[0].feature);
    it('computes the health strip from the rows on hand', () => {
      const rows = [google(), google({ source_url: 'https://news.google.com/rss/articles/b' }), google({ publisher: undefined, source_url: 'https://news.google.com/rss/articles/c' }), google({ publisher: undefined, source_url: 'https://news.google.com/rss/articles/d' }), { status: 'source_status', title: 'Notice' }];
      expect(lawWire(rows[0], { rows, feed }).footer.health).toEqual([['Rows', '4'], ['Record-level rows', '0'], ['Publisher named', '50%']]);
      const g = [gdelt(), gdelt({ domain: '' , url: 'https://example.org/x', source_url: 'https://example.org/x' })];
      expect(lawWire(g[0], { rows: g, feed: feedOf(CASES[0].feature) }).footer.health).toEqual([['Rows', '2'], ['Record-level rows', '0'], ['Publisher named', '50%']]);
      // No rows passed: the record itself is the one row.
      expect(lawWire(google(), { feed }).footer.health).toEqual([['Rows', '1'], ['Record-level rows', '0'], ['Publisher named', '100%']]);
    });

    it('asks about the item and names the live source, with a flag when no date is on record', () => {
      const m = build(google(), CASES[0].feature);
      expect(m.footer.ask).toBe('Ask AI about this item');
      expect(build(FIXTURES['no date at all'], CASES[0].feature).footer.provenance.flags).toEqual(['as-of not on record']);
    });

    it('tells a GDELT row from a Google News row by its section and fields when the envelope is silent', () => {
      // F165: both are named plainly now; a GDELT row is still told apart by what its date means.
      expect(lawWire(gdelt(), { rows: [], feed: { feature: CASES[0].feature } }).glance.tiles[0].sub).toBe('India date; first seen by the news search');
      expect(lawWire(gdelt(), { rows: [], feed: { feature: CASES[0].feature } }).footer.provenance.source).toMatch(/^News search results/);
      expect(lawWire(google(), { rows: [], feed: { feature: CASES[0].feature } }).footer.provenance.source).toMatch(/^Google News search results/);
    });
  });

  describe('Quick exit prompts', () => {
    it('name the headline, call it a news item and ask for nothing beyond it', () => {
      const m = build(google(), 'ICC Proceedings');
      expect(m.quick[0].prompt).toBe('Draft a case brief on “High Court stays eviction drive near the river”. The attached item is a news item, not a court record. Draft from the attached item only, do not state a stage, holding, charge or date it does not give, and state plainly that the underlying order or record was not read.');
    });
  });

  describe('no claim of an order, charge, holding or stage', () => {
    const BANNED = /\border\b|\bordered\b|charged|convicted|warrant issued|\bstage\b|\bholding\b|\bheld\b/i;
    const NEGATED = /not an order/gi;

    it('is absent from every tile value, badge and meta of every fixture in every module', () => {
      for (const [name, row] of Object.entries(FIXTURES)) {
        for (const feature of everyFeature) {
          const m = build(row, feature);
          // The headline is the publisher's own words, so meta carries only publisher and date.
          for (const t of m.glance.tiles) {
            expect(t.value, `${name} / ${feature} / ${t.label}`).not.toMatch(BANNED);
            expect(String(t.sub || '').replace(NEGATED, ''), `${name} / ${feature} / ${t.label} sub`).not.toMatch(BANNED);
          }
          expect(m.badge.text.replace(NEGATED, ''), `${name} / ${feature} badge`).not.toMatch(BANNED);
          for (const part of m.meta) expect(part, `${name} / ${feature} meta`).not.toMatch(BANNED);
          expect(m.glance.visual2.rows.every((r) => r.value === 'Not on the row'), `${name} / ${feature} board`).toBe(true);
        }
      }
    });

    it('would catch a tile that did claim one', () => {
      expect('Order passed').toMatch(BANNED);
      expect('Charged').toMatch(BANNED);
      expect('Warrant issued').toMatch(BANNED);
      expect('Stage: hearing').toMatch(BANNED);
    });
  });

  describe('rendering', () => {
    it('renders the panel with hostile text escaped, not as markup', () => {
      const row = google({ title: '<img src=x onerror=alert(1)> in court - The Hindu', summary: '<script>alert(1)</script> told the bench' });
      const html = renderToStaticMarkup(createElement(RecordPanel, { model: build(row, CASES[0].feature) }));
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; told the bench');
      expect(html).toContain('Coverage — not an order');
      expect(html).toContain('0 of 7 on the row');
    });
  });
});
