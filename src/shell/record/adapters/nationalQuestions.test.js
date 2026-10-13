import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import questions from '../../../../public/data/embedded_csv/national_question_database.json';
import analysis from '../../../../public/data/embedded_json/national_question_database_analysis.json';
import ontology from '../../../../public/data/ontology.json';
import { analysisFor, buildRecordModel, DESKS } from '../../../lib/impactRecord.js';
import { shapeParliamentaryQuestionRows } from '../../../lib/shapeQuestions.js';
import { contractProblems } from '../modelContract.js';
import nationalQuestions from './nationalQuestions.js';

// The real impact builder, wrapped so one test can hand the adapter a company drawn by sector (path P2),
// which the question desk's own configuration never produces.
vi.mock('../../../lib/impactRecord.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, buildRecordModel: vi.fn(real.buildRecordModel) };
});

// The packs exactly as loadRecordPacks hands them over (the question pack is keyed by row id).
const packs = { desk: DESKS.question, analysis, ontology, ready: true };
const ctx = (over = {}) => ({ rows: questions, feed: { feature: 'Parliamentary Question Database' }, packs, ...over });
// Every string a reader can see. A touch link's `row` is the record it opens, not shown text.
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'row') strings(x, out);
  return out;
};
const realBuild = (...args) => vi.mocked(buildRecordModel).getMockImplementation()(...args);
const withAnalysis = questions.filter((r) => analysisFor(r, analysis));
// Building a model with the packs links against the whole ontology (about a millisecond per row), so
// the with-packs loops cover every fifth row plus every row the pack covers; no-pack loops cover all 8,000.
const sample = questions.filter((r, i) => i % 5 === 0 || analysisFor(r, analysis) || /\b(ONGC|SAIL|NHPC|NTPC|Coal India)\b/.test(r.subject || ''));
const byId = (id) => questions.find((r) => r.id === id);
const plain = questions[0]; // id 1, Mani A (DMK), MSME, unstarred; in the pack
const bare = questions.find((r) => !analysisFor(r, analysis));
const starred = questions.find((r) => r.question_type === 'STARRED');
// A member with several questions on the register, and the number of others they hold.
const prolific = questions.find((r) => r.mp_name === 'P P Chaudhary');
const named = (text) => questions.find((r) => r.subject === text);
const blank = { id: 'x-1', date: '', ministry: '', mp_name: '', party: '', house: '', question_type: '', subject: '', source_url: '' };

// F124 N3: a question panel shows what the register holds (who asked what of which ministry, and
// when) and nothing it does not: the register has no answer text, and the shaping helper's "Not
// reported" defaults are placeholders, not data.
describe('National questions adapter', () => {
  it('honours the panel contract for every question, with and without the packs loaded', () => {
    for (const row of questions) expect(contractProblems(nationalQuestions(row, ctx({ packs: null }))), row.id).toEqual([]);
    for (const row of sample) expect(contractProblems(nationalQuestions(row, ctx())), row.id).toEqual([]);
    for (const row of questions.slice(0, 50)) expect(contractProblems(nationalQuestions(row, ctx({ packs: { ready: false } }))), row.id).toEqual([]);
  });

  it('honours the contract for rows the desk shaped, including missing fields', () => {
    const shaped = shapeParliamentaryQuestionRows([plain, starred, blank, { ...plain, id: 'x-2', mp_name: '', ministry: '', question_type: '' }]);
    for (const row of shaped) expect(contractProblems(nationalQuestions(row, ctx({ rows: shaped }))), row.id).toEqual([]);
  });

  it('titles the panel with the subject and puts house and type in the meta', () => {
    const m = nationalQuestions(plain, ctx());
    expect(m.title).toBe('Expanding Khadi Production in Tamil Nadu');
    expect(m.meta).toEqual(['Lok Sabha', 'Unstarred question']);
    expect(nationalQuestions(starred, ctx()).meta).toContain('Starred question');
  });

  it('shows Tabled, Ministry, Asked by (party beneath) and Type as the tiles', () => {
    const tiles = nationalQuestions(plain, ctx()).glance.tiles;
    expect(tiles.map((t) => t.label)).toEqual(['Tabled', 'Ministry', 'Asked by', 'Type']);
    expect(tiles[0].value).toBe('02 Apr 2026');
    expect(tiles[1].value).toBe('Micro, Small and Medium Enterprises'); // title case, not the register's capitals
    expect(tiles[2]).toMatchObject({ value: 'Mani A', sub: 'DMK' });
    expect(tiles[3].value).toBe('Unstarred');
  });

  it('badges nothing for the real register, whose status is empty, and only a status the row holds', () => {
    for (const row of questions.slice(0, 500)) expect(nationalQuestions(row, ctx()).badge, row.id).toBeUndefined();
    expect(nationalQuestions({ ...plain, status: 'Answered' }, ctx()).badge).toMatchObject({ text: 'Answered' });
    expect(nationalQuestions({ ...plain, status: 'source_status' }, ctx()).badge).toBeUndefined();
  });

  it('never shows the shaping helper\'s "Not reported" defaults, or a dash, as a value', () => {
    const [shaped] = shapeParliamentaryQuestionRows([{ ...plain, mp_name: '', ministry: '', house: '', question_type: '', party: '—' }]);
    expect(shaped.mp_name).toBe('Not reported'); // the defect this guards against
    const m = nationalQuestions(shaped, ctx({ packs: null }));
    const text = strings(m).join(' | ');
    expect(text).not.toMatch(/not reported/i);
    expect(text).not.toContain('—');
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Tabled', 'Ministry']);
    expect(m.glance.tiles[1].value).toBe('Not on record');
    expect(m.meta).toEqual([]);
    expect(m.about.rows.map(([k]) => k)).toEqual(['Tabled']);
    expect(m.touches.nodes.left).toBeUndefined();
  });

  it('reads the date from the row, and says "Not on record" rather than guessing one', () => {
    expect(nationalQuestions({ ...plain, date: '' }, ctx()).glance.tiles[0].value).toBe('02 Apr 2026'); // occurred_at
    const none = nationalQuestions({ ...plain, date: '', occurred_at: '', source_date_raw: '02.04.2026' }, ctx());
    expect(none.glance.tiles[0].value).toBe('Not on record'); // dd.mm.yyyy is not parsed, so never misread
    expect(none.glance.visual.steps[0]).toMatchObject({ done: true, detail: 'Date not on record' });
    // 02.04.2026 is 2 April in India; read month-first it would be 4 February. Never parsed, so never misread.
    expect(nationalQuestions({ ...plain, date: '02.04.2026', occurred_at: '' }, ctx()).glance.tiles[0].value).toBe('Not on record');
  });

  it('draws the lifecycle as Tabled (dated, done) then an Answer that is not on record', () => {
    for (const row of [plain, starred, bare]) {
      const v = nationalQuestions(row, ctx()).glance.visual;
      expect(v).toMatchObject({ type: 'timeline', title: 'Question lifecycle' });
      expect(v.steps.map((s) => s.label)).toEqual(['Tabled', 'Answer']);
      expect(v.steps[0]).toMatchObject({ done: true, detail: expect.stringMatching(/\d{4}/) });
      expect(v.steps[1].done).toBeFalsy();
      expect(v.steps[1].detail).toMatch(/not on record/i);
      expect(v.steps.filter((s) => s.now).length).toBeLessThanOrEqual(1);
      expect(v.caption).toMatch(/no answer text/i);
    }
  });

  it('keeps the lifecycle\'s answer step undone even when a row carries answer-like words', () => {
    const v = nationalQuestions({ ...plain, status: 'Answered', answer_text: 'Yes', has_answer: 'Yes' }, ctx()).glance.visual;
    expect(v.steps[1].done).toBeFalsy();
    expect(v.steps[1].detail).toMatch(/not on record/i);
  });

  it('lists member, party, ministry, house, type and date as the About rows', () => {
    const rows = Object.fromEntries(nationalQuestions(plain, ctx()).about.rows);
    expect(rows).toEqual({
      Member: 'Mani A',
      Party: 'DMK',
      Ministry: 'Micro, Small and Medium Enterprises',
      House: 'Lok Sabha',
      Type: 'Unstarred',
      Tabled: '02 Apr 2026',
    });
  });

  it('adds the pack\'s brief, why it matters and watch for as register analysis, with tags as chips', () => {
    const a = analysisFor(plain, analysis);
    const about = nationalQuestions(plain, ctx()).about;
    expect(about.cards.map((c) => c.heading)).toEqual([
      'Summary (register analysis)',
      'Why it matters (register analysis)',
      'Watch for (register analysis)',
    ]);
    expect(about.cards[0].body).toBe(a.brief);
    expect(about.cards[1].body).toBe(a.why_it_matters);
    expect(about.cards[2].body).toBe(a.watch_for);
    expect(about.chips).toEqual([...new Set(a.tags)]);
    for (const row of withAnalysis) {
      const chips = nationalQuestions(row, ctx()).about.chips;
      expect(new Set(chips).size, row.id).toBe(chips.length); // the panel keys chips by text
    }
  });

  it('lists each tag once, because the panel keys chips by their text', () => {
    const dupes = { ...analysis, 1: { ...analysis['1'], tags: ['DMK Party', ' DMK Party', 'Khadi', ''] } };
    expect(nationalQuestions(plain, ctx({ packs: { ...packs, analysis: dupes } })).about.chips).toEqual(['DMK Party', 'Khadi']);
  });

  it('shows no analysis for a question the pack does not cover, or before the packs load', () => {
    for (const p of [packs, null, { ready: false }]) {
      const about = nationalQuestions(bare, ctx({ packs: p })).about;
      expect(about.cards || []).toEqual([]);
      expect(about.chips || []).toEqual([]);
    }
    expect(nationalQuestions(plain, ctx({ packs: { ...packs, ready: false } })).about.cards || []).toEqual([]);
  });

  it('draws ministry, question, sectors & segments and named companies as the touch lanes', () => {
    const t = nationalQuestions(plain, ctx()).touches;
    expect(t.lanes).toEqual(['MINISTRY', 'QUESTION', 'SECTORS & SEGMENTS', 'COMPANIES']);
    expect(t.nodes.left.l1).toBe('Micro, Small and Medium Enterprises');
    expect(t.nodes.center).toMatchObject({ code: 'Q', l1: 'This question' });
    const pharma = nationalQuestions(named('Research and Innovation in Pharma-MedTech Sector'), ctx()).touches;
    expect(pharma.nodes.right.l1).toBe('Pharmaceuticals');
    expect(pharma.nodes.right.l2).toBe('+2 more');
    expect(pharma.nodes.far).toBeUndefined(); // nothing named: "None on record"
  });

  it('has no sector, segment or company lane content until the packs load', () => {
    const t = nationalQuestions(named('Research and Innovation in Pharma-MedTech Sector'), ctx({ packs: null })).touches;
    expect(t.nodes.right).toBeUndefined();
    expect(t.nodes.far).toBeUndefined();
    expect(t.nodes.left).toBeDefined();
  });

  it('names a company only where the question itself names it', () => {
    const company = (text) => nationalQuestions(named(text), ctx()).touches.nodes.far;
    expect(company('Crude Oil Exploration by ONGC')).toMatchObject({ l1: 'ONGC' });
    expect(company('Coal India Limited Production Target')).toMatchObject({ l1: 'Coal India' });
    // Ordinary words that also happen to be a company's short name are not naming it.
    expect(company('CSR Projects by Oil Companies in Tamil Nadu')).toBeUndefined();
    expect(company('Self Reliance of Domestic Fertilizer Industry')).toBeUndefined();
    expect(company('Persistent Challenges in Punjab')).toBeUndefined();
    let drawn = 0;
    for (const row of sample) {
      const far = nationalQuestions(row, ctx()).touches.nodes.far;
      if (far) { drawn += 1; expect(far.l2, row.id).toMatch(/named in the question|more named$/); }
    }
    expect(drawn).toBeGreaterThan(0); // the sample must contain questions that name a company
  });

  it('never draws a company by sector association (path P2), even one the text names', () => {
    const row = named('Crude Oil Exploration by ONGC');
    buildRecordModel.mockImplementationOnce((...args) => {
      const m = realBuild(...args);
      m.companies = [{ nt: 'company', id: 'company:ongc', name: 'ONGC', path: 'P2' }];
      return m;
    });
    expect(nationalQuestions(row, ctx()).touches.nodes.far).toBeUndefined();
    expect(nationalQuestions(row, ctx()).touches.nodes.far).toMatchObject({ l1: 'ONGC' }); // P1, from the real builder
  });

  it('links up to three other questions by the same member, most recent first, never the selection or a copy', () => {
    const own = questions.filter((r) => r.mp_name === prolific.mp_name);
    expect(own.length).toBeGreaterThan(5);
    const copy = { ...prolific };
    const links = nationalQuestions(copy, ctx()).touches.links;
    const rows = links.filter((l) => l.row);
    expect(rows).toHaveLength(3);
    for (const l of rows) {
      expect(questions).toContain(l.row);
      expect(l.row.id).not.toBe(prolific.id);
      expect(l.row.mp_name).toBe(prolific.mp_name);
    }
    const dates = rows.map((l) => l.row.date);
    expect(dates).toEqual([...dates].sort().reverse());
    const newest = own.filter((r) => r.id !== prolific.id).map((r) => r.date).sort().reverse()[0];
    expect(dates[0]).toBe(newest);
    expect(links.at(-1)).toMatchObject({ title: expect.stringContaining(prolific.mp_name), detail: `${own.length - 1} others on the register` });
    expect(links.at(-1).row).toBeUndefined();
  });

  it('excludes the selection by its id even when the copy differs, and a duplicate record of it by content', () => {
    const sameId = { ...prolific, subject: 'A different subject', date: '2020-01-01' };
    const twin = { ...prolific, id: 'twin' };
    const rows = [prolific, sameId, twin, { ...prolific, id: 'other', subject: 'Genuinely other', date: '2026-01-01' }];
    const links = nationalQuestions(prolific, ctx({ rows })).touches.links;
    expect(links.map((l) => l.row?.id)).toEqual(['other']);
  });

  it('shows no count link when a member has three or fewer other questions, and none for an unnamed member', () => {
    const few = [plain, { ...plain, id: 'a', subject: 'One' }, { ...plain, id: 'b', subject: 'Other' }];
    const t = nationalQuestions(plain, ctx({ rows: few })).touches.links;
    expect(t.filter((l) => l.row)).toHaveLength(2);
    expect(t.some((l) => !l.row)).toBe(false);
    const none = nationalQuestions({ ...plain, mp_name: 'Not reported' }, ctx({ rows: [{ ...plain, mp_name: 'Not reported', id: 'q' }] })).touches.links;
    expect(none).toEqual([]);
  });

  it('gives every related link a distinct title, because the panel keys links by title', () => {
    const rows = [prolific, ...[1, 2, 3, 4].map((i) => ({ ...prolific, id: `d${i}`, date: `2026-03-0${i}` }))];
    const links = nationalQuestions(prolific, ctx({ rows })).touches.links;
    expect(links.filter((l) => l.row)).toHaveLength(3);
    expect(new Set(links.map((l) => l.title)).size).toBe(links.length);
  });

  it('skips feed status rows when listing related questions', () => {
    const rows = [plain, { ...plain, id: 's', status: 'source_status', subject: 'Source offline' }, { ...plain, id: 't', subject: 'Real one' }];
    const links = nationalQuestions(plain, ctx({ rows })).touches.links;
    expect(links.map((l) => l.row?.id)).toEqual(['t']);
  });

  it('links the question PDF over https only', () => {
    expect(nationalQuestions(plain, ctx()).links).toEqual([{ label: 'Question (PDF)', href: plain.source_url }]);
    expect(nationalQuestions({ ...plain, source_url: 'http://sansad.in/x.pdf' }, ctx()).links).toEqual([]);
    expect(nationalQuestions({ ...plain, source_url: 'https://sansad.in/question/7' }, ctx()).links).toEqual([{ label: 'Source on Sansad', href: 'https://sansad.in/question/7' }]);
    expect(nationalQuestions({ ...plain, source_url: '' }, ctx()).links).toEqual([]);
  });

  it('names the Digital Sansad register and its as-of date, and says what a question is and is not', () => {
    const f = nationalQuestions(plain, ctx()).footer;
    expect(f.ask).toBe('Ask AI about this question');
    expect(f.provenance.source).toMatch(/digital sansad/i);
    expect(f.provenance.source).toMatch(/question register/i);
    expect(f.provenance.asOf).toBe('07 Sep 2026');
    expect(f.provenance.flags).toEqual([]);
    expect(f.note).toMatch(/member's claim, not a finding/i);
    expect(f.note).toMatch(/answer is not on record here/i);
  });

  it('flags a missing as-of date and an unconfirmed provenance', () => {
    const f = nationalQuestions({ ...plain, as_of: '', provenance: 'unconfirmed' }, ctx()).footer.provenance;
    expect(f.asOf).toBeFalsy();
    expect(f.flags).toEqual(['as-of not on record', 'provenance unconfirmed']);
  });

  it('shows no dash, undefined, NaN or null in reader-facing text for any question', () => {
    for (const row of sample) {
      const m = nationalQuestions(row, ctx());
      const { title: _t, ...rest } = m;
      const shown = strings({ ...rest, touches: { ...m.touches, links: m.touches.links.map(({ title: _lt, ...l }) => l) } });
      for (const s of shown) expect(s, row.id).not.toMatch(/—|\bundefined\b|\bNaN\b|^\s*null\s*$|not reported/i);
    }
  });

  it('is synchronous and makes no network or AI call', () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call'); });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const out = nationalQuestions(plain, ctx());
      expect(typeof out?.then).toBe('undefined'); // not a promise
      nationalQuestions(bare, ctx({ packs: null }));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const src = readFileSync(new URL('./nationalQuestions.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|\basync\b|\bawait\b|resolveOrganisedBrief|ensureDeskBrief|loadAnalysisMap|loadOntology/);
    const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
    // feedText.js (F127) is a pure helper that imports nothing.
    expect(imports.sort()).toEqual(['../../../lib/impactRecord.js', './common.js', './feedText.js']);
  });

  it('does not mutate the row or the context rows', () => {
    const before = JSON.stringify([plain, ctx().rows.slice(0, 20)]);
    nationalQuestions(plain, ctx());
    expect(JSON.stringify([plain, ctx().rows.slice(0, 20)])).toBe(before);
  });

  it('covers the whole real register', () => {
    expect(questions).toHaveLength(8000);
    expect(byId('1')).toBe(plain);
  });
});
