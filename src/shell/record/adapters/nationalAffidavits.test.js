import { describe, expect, it } from 'vitest';
import embedded from '../../../../public/data/embedded_csv/national_candidate_affidavit.json';
import mpRegister from '../../../../public/data/embedded_csv/national_mp_report_card.json';
import { contractProblems } from '../modelContract.js';
import nationalAffidavits, { declaredFigure, electionOf } from './nationalAffidavits.js';

// The embedded affidavit register exactly as the server serves it (server/nationalFeed.mjs, Candidate
// Affidavit branch: loadEmbedded runs every row through flattenRow, which adds `date` (empty, the
// register has none) and `title` (= name) and leaves every other field as held).
const register = embedded.map((r) => ({ ...r, date: '', title: r.name }));
const ctx = (over = {}) => ({ rows: register, feed: { feature: 'Candidate Affidavit Database (Structured + API)' }, packs: null, ...over });
const model = (row, c = ctx()) => nationalAffidavits(row, c);

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'row') strings(x, out);
  return out;
};
const text = (m) => strings(m).join(' | ');
const tile = (m, label) => m.glance.tiles.find((t) => t.label === label);
const aboutRow = (m, key) => m.about.rows.find(([k]) => k === key)?.[1];
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const plain = (s) => String(s).replace(/\s+/g, ' ').trim(); // the register writes "Rs\u00a08,05,85,824~ 8\u00a0Crore+"

const sample = register[0]; // Rs 8,05,85,824 assets, Rs 88,67,236 liabilities, 0 cases, Graduate
const withCases = register.find((r) => r.criminal_cases === '16');
const zeroCases = register.find((r) => r.criminal_cases === '0');
const zeroLiabilities = register.find((r) => plain(r.liabilities) === 'Rs 0~');
const thousands = register.find((r) => /Thou/.test(r.liabilities));
const sharedName = ['AURANGABAD', 'HAMIRPUR', 'MAHARAJGANJ'];

// F124 N8: a candidate panel shows what the candidate declared in the nomination affidavit (assets,
// liabilities, a count of criminal cases, education) exactly as the register holds it, and says that
// none of it is verified, that individual cases are not on record, and that the source restricts
// redistribution. No row holds a date, an outcome, a case list or a pending/convicted split.
describe('National candidate affidavit adapter', () => {
  it('honours the panel contract for every candidate in the register', () => {
    expect(register).toHaveLength(483);
    for (const row of register) expect(contractProblems(model(row)), row.id + row.name).toEqual([]);
  });

  describe('title and meta', () => {
    it('puts the candidate\'s name in the title and the party, constituency and election in the meta, with no badge', () => {
      const m = model(sample);
      expect(m.title).toBe(plain(sample.name));
      expect(m.meta).toEqual([sample.party, sample.constituency, 'Lok Sabha 2024']);
      expect(m.badge).toBeUndefined();
      for (const row of register) expect(model(row).meta, row.name).toEqual([row.party, row.constituency, 'Lok Sabha 2024']);
    });

    it('names the election only where the record\'s own link says it, never otherwise', () => {
      expect(electionOf('https://myneta.info/LokSabha2024/candidate.php?candidate_id=2408')).toBe('Lok Sabha 2024');
      for (const url of ['', 'https://myneta.info/candidate.php?candidate_id=1', 'https://example.com/LokSabha2024/candidate.php', 'http://myneta.info/LokSabha2024/candidate.php', 'https://myneta.info/RajyaSabha2024/x', 'not a url']) {
        expect(electionOf(url), url).toBe('');
        const m = model({ ...sample, source_url: url });
        expect(m.meta.some((x) => /sabha|2024/i.test(x)), url).toBe(false);
        expect(text({ ...m, links: [] }), url).not.toMatch(/2024/); // the link's own address is the source's, not a claim
        expect(contractProblems(m), url).toEqual([]);
      }
      // A different year in the link is reported as that year, not forced to 2024.
      expect(model({ ...sample, source_url: 'https://myneta.info/LokSabha2019/candidate.php?candidate_id=1' }).meta).toContain('Lok Sabha 2019');
    });

    it('collapses stray whitespace in a name', () => {
      expect(model({ ...sample, name: '  Some   Candidate ' }).title).toBe('Some Candidate');
    });
  });

  describe('glance tiles', () => {
    it('shows declared assets as the exact rupee figure the row holds, not rounded, converted or glossed', () => {
      expect(tile(model(sample), 'Declared assets').value).toBe('Rs 8,05,85,824');
      for (const row of register) {
        const t = tile(model(row), 'Declared assets');
        expect(t.value, row.name).toBe(plain(row.total_assets.split('~')[0]));
        expect(t.value, row.name).toMatch(/^Rs [\d,]+$/);
        expect(t.value, row.name).not.toMatch(/crore|lac|thou|~|\+|\./i);
      }
    });

    it('shows liabilities the same way, and Rs 0 as a real value rather than as missing', () => {
      expect(tile(model(sample), 'Liabilities').value).toBe('Rs 88,67,236');
      expect(zeroLiabilities).toBeTruthy();
      expect(tile(model(zeroLiabilities), 'Liabilities').value).toBe('Rs 0');
      expect(tile(model(thousands), 'Liabilities').value).toMatch(/^Rs [\d,]+$/);
      for (const row of register) {
        const t = tile(model(row), 'Liabilities');
        expect(t.value, row.name).toBe(plain(row.liabilities.split('~')[0]));
        expect(t.value, row.name).not.toMatch(/crore|lac|thou|~|\+|\.|not on record/i);
      }
    });

    it('labels assets and liabilities as declared, not verified', () => {
      for (const label of ['Declared assets', 'Liabilities']) expect(tile(model(sample), label).sub).toMatch(/declared/i);
    });

    it('shows the declared count of criminal cases exactly, labelled as declared', () => {
      const m = model(withCases);
      expect(tile(m, 'Criminal cases').value).toBe('16');
      expect(tile(m, 'Criminal cases').sub).toMatch(/declared/i);
      for (const row of register) expect(tile(model(row), 'Criminal cases').value, row.name).toBe(row.criminal_cases);
    });

    it('shows 0 criminal cases as "0", not as missing, and a blank count as "Not on record"', () => {
      expect(zeroCases).toBeTruthy();
      expect(tile(model(zeroCases), 'Criminal cases').value).toBe('0');
      expect(tile(model({ ...zeroCases, criminal_cases: 0 }), 'Criminal cases').value).toBe('0');
      for (const blank of ['', undefined, null, '  ']) {
        const m = model({ ...zeroCases, criminal_cases: blank });
        expect(tile(m, 'Criminal cases').value).toBe('Not on record');
        expect(contractProblems(m)).toEqual([]);
      }
    });

    it('does not tone a named person\'s tiles: no colour, score or grade', () => {
      for (const row of register) for (const t of model(row).glance.tiles) expect(t.tone, `${row.name} ${t.label}`).toBeUndefined();
    });

    it('shows education as the register holds it', () => {
      expect(tile(model(sample), 'Education').value).toBe(sample.education);
      for (const row of register) expect(tile(model(row), 'Education').value, row.name).toBe(row.education);
    });

    it('uses the four tiles in the order assets, liabilities, criminal cases, education, and no visual', () => {
      for (const row of register) {
        const m = model(row);
        expect(m.glance.tiles.map((t) => t.label)).toEqual(['Declared assets', 'Liabilities', 'Criminal cases', 'Education']);
        expect(m.glance.visual).toBeUndefined();
        expect(m.glance.visual2).toBeUndefined();
        expect(m.glance.callout).toBeUndefined();
      }
    });

    it('reads "Not on record" for a figure the row does not hold, never a dash, zero or guess', () => {
      const bare = model({ id: 'x', name: 'Bare Candidate', source_url: '' });
      for (const label of ['Declared assets', 'Liabilities', 'Criminal cases', 'Education']) expect(tile(bare, label).value).toBe('Not on record');
      expect(contractProblems(bare)).toEqual([]);
    });
  });

  describe('declaredFigure', () => {
    it('splits the register\'s "Rs <exact>~ <gloss>" into the exact figure and the source\'s own gloss', () => {
      expect(declaredFigure('Rs\u00a08,05,85,824~ 8\u00a0Crore+')).toEqual({ exact: 'Rs 8,05,85,824', stated: 'Rs 8,05,85,824~ 8 Crore+' });
      expect(declaredFigure('Rs\u00a00~')).toEqual({ exact: 'Rs 0', stated: 'Rs 0~' });
    });

    it('returns a statement of a shape it does not know whole and unaltered, and nothing for a blank', () => {
      expect(declaredFigure('Nil')).toEqual({ exact: 'Nil', stated: 'Nil' });
      expect(declaredFigure('  Rs  12,000 ')).toEqual({ exact: 'Rs 12,000', stated: 'Rs 12,000' });
      for (const blank of ['', '  ', undefined, null]) expect(declaredFigure(blank)).toEqual({ exact: '', stated: '' });
    });
  });

  describe('criminal cases: a declared count only', () => {
    it('never splits, estimates or infers pending against convicted cases, anywhere in any panel', () => {
      for (const row of [...register, withCases, zeroCases]) expect(text(model(row)), row.name).not.toMatch(/pending|convict|acquit|sentenc|serious|heinous|guilty|conviction/i);
    });

    it('says individual cases are not on record and that only a count is held', () => {
      const body = model(withCases).about.cards.map((c) => `${c.heading} ${c.body}`).join(' | ');
      expect(body).toMatch(/individual cases[^|]*not on record/i);
      expect(body).toMatch(/only a count/i);
      expect(body).toMatch(/declared/i);
    });

    it('does not turn the count into a rate, score, or ranking', () => {
      for (const row of [withCases, zeroCases, sample]) expect(text(model(row))).not.toMatch(/\b(rank(ed|s|ing)?|score|grade|crimometer|top|worst|most|least)\b/i);
    });
  });

  describe('licence', () => {
    it('says the figures are viewable here, not for export, and that the source restricts redistribution', () => {
      for (const row of [sample, withCases, zeroCases]) {
        const m = model(row);
        const cards = m.about.cards.map((c) => `${c.heading} ${c.body}`).join(' | ');
        expect(cards).toMatch(/restricts? (commercial use and )?redistribution/i);
        expect(cards).toMatch(/viewable here, not for export/i);
        expect(m.footer.provenance.source).toMatch(/licence-restricted: viewable, not exportable/i);
        expect(m.footer.note).toMatch(/redistribution/i);
      }
    });

    it('offers no download, export or PDF action, even if a row carries a PDF link', () => {
      for (const row of [sample, { ...sample, pdf_url: 'https://example.org/affidavit.pdf' }, { ...sample, source_url: 'https://myneta.info/x.pdf' }]) {
        const m = model(row);
        for (const l of m.links) expect(l.label, l.href).not.toMatch(/download|export|pdf|save|csv|embed/i);
        expect(m.links.some((l) => /pdf_url|affidavit\.pdf/.test(l.href)), row.pdf_url).toBe(false);
        // "viewable here, not for export" is the caveat itself; nothing may invite an export.
        expect(text(m)).not.toMatch(/\bdownload|\bsave\b|\bcsv\b|\bexport (it|the|this|these|all|to|as)\b/i);
      }
    });
  });

  describe('links', () => {
    it('links only the affidavit record on the source, over https', () => {
      for (const row of register) {
        const links = model(row).links;
        expect(links, row.name).toHaveLength(1);
        expect(links[0].href).toBe(row.source_url);
        expect(links[0].label).toMatch(/affidavit record/i);
        expect(links[0].href).toMatch(/^https:\/\//);
      }
      expect(model({ ...sample, source_url: 'http://myneta.info/LokSabha2024/candidate.php?candidate_id=1' }).links).toEqual([]);
      expect(model({ ...sample, source_url: 'javascript:alert(1)' }).links).toEqual([]);
      expect(model({ ...sample, source_url: '' }).links).toEqual([]);
    });
  });

  describe('about', () => {
    it('lists party, constituency, education, assets and liabilities as declared', () => {
      const m = model(sample);
      expect(m.about.label).toBe('02 · As declared in the affidavit');
      expect(m.about.rows).toEqual([
        ['Party', sample.party],
        ['Constituency', sample.constituency],
        ['Education', sample.education],
        ['Declared assets', plain(sample.total_assets)],
        ['Liabilities', plain(sample.liabilities)],
      ]);
    });

    it('keeps the source\'s own wording of an amount in About, tilde and rounded gloss included, with no non-breaking spaces', () => {
      for (const row of register) {
        const m = model(row);
        expect(aboutRow(m, 'Declared assets'), row.name).toBe(plain(row.total_assets));
        expect(aboutRow(m, 'Liabilities'), row.name).toBe(plain(row.liabilities));
        expect(text(m), row.name).not.toMatch(/\u00a0/);
      }
    });

    it('omits an About row the register does not hold', () => {
      const m = model({ id: 'x', name: 'Bare Candidate', source_url: '' });
      expect(m.about.rows).toEqual([]);
      expect(contractProblems(m)).toEqual([]);
    });

    it('says every figure is what the candidate declared, not what was verified', () => {
      const body = model(sample).about.cards.map((c) => `${c.heading} ${c.body}`).join(' | ');
      expect(body).toMatch(/declared/i);
      expect(body).toMatch(/not (what was )?verified/i);
    });

    it('carries over nothing from the retired view\'s empty or build-note blocks', () => {
      for (const row of [sample, withCases]) {
        expect(text(model(row))).not.toMatch(/wealth change|pending analysis|2019|embed|not in this build|not published|first-time|first-timer/i);
      }
    });
  });

  describe('touch lanes', () => {
    it('draws party, this candidate, constituency and outcome, in that order', () => {
      const t = model(sample).touches;
      expect(t.lanes).toEqual(['PARTY', 'CANDIDATE', 'CONSTITUENCY', 'OUTCOME']);
      expect(t.label).toBeTruthy();
      expect(t.nodes.center).toMatchObject({ code: 'A' });
      expect(t.nodes.left.l1).toBe(sample.party);
      expect(t.nodes.right.l1).toBe(sample.constituency);
    });

    it('leaves the outcome lane empty ("None on record") for every candidate, and never infers a winner', () => {
      for (const row of register) {
        const m = model(row);
        expect(m.touches.nodes.far, row.name).toBeUndefined();
        expect(text(m), row.name).not.toMatch(/\b(winner|won|win|wins|elected|defeated|lost|victor\w*|runner|margin|result)\b/i);
      }
      // Even a row that carried an outcome-like field is not read for one: the register holds none.
      expect(model({ ...sample, outcome: 'Won', result: 'Won', winner: 'yes' }).touches.nodes.far).toBeUndefined();
    });

    it('leaves a lane empty when the register holds nothing for it, with the centre kept', () => {
      const nodes = model({ id: 'x', name: 'Bare Candidate', source_url: '' }).touches.nodes;
      expect(nodes.left).toBeUndefined();
      expect(nodes.right).toBeUndefined();
      expect(nodes.far).toBeUndefined();
      expect(nodes.center).toMatchObject({ code: 'A' });
      expect(model({ ...sample, party: '' }).touches.nodes.left).toBeUndefined();
      expect(model({ ...sample, constituency: '' }).touches.nodes.right).toBeUndefined();
    });
  });

  describe('related candidates', () => {
    // The register holds one declared candidate per constituency name, apart from three names that
    // two candidates share (below). The row carries no state, so a shared name cannot show a shared
    // seat, and the three pairs are different seats in different states. The panel therefore draws
    // no related-candidate link, and never invents a relation from a name.
    it('has one candidate per constituency name, except three names that two candidates share', () => {
      const counts = new Map();
      for (const r of register) counts.set(r.constituency, (counts.get(r.constituency) || 0) + 1);
      expect(counts.size).toBe(480);
      expect([...counts].filter(([, n]) => n > 1).map(([c, n]) => [c, n]).sort()).toEqual(sharedName.map((c) => [c, 2]).sort());
    });

    it('shows that each shared name is two different seats: the member register places the pair in different states', () => {
      for (const c of sharedName) {
        const states = mpRegister.filter((m) => String(m.constituency).trim().toUpperCase() === c).map((m) => m.state);
        expect(states, c).toHaveLength(2);
        expect(new Set(states).size, c).toBe(2);
      }
    });

    it('draws no related-candidate link for any candidate, including those whose constituency name is shared', () => {
      for (const row of register) expect(model(row).touches.links, row.name).toEqual([]);
      for (const c of sharedName) for (const row of register.filter((r) => r.constituency === c)) expect(model(row).touches.links, row.name).toEqual([]);
    });

    it('does not link a candidate to another of the same constituency name even when the host passes them', () => {
      const a = { ...sample, id: '1', name: 'A One', constituency: 'TESTVILLE' };
      const b = { ...sample, id: '2', name: 'B Two', constituency: 'TESTVILLE', source_url: 'https://myneta.info/LokSabha2024/candidate.php?candidate_id=2' };
      expect(model(a, ctx({ rows: [a, b] })).touches.links).toEqual([]);
      expect(model(a, ctx({ rows: undefined })).touches.links).toEqual([]);
    });
  });

  describe('no empty-value placeholders', () => {
    it('has no dash placeholder, "undefined", "NaN", bare null or empty string in any reader-facing string', () => {
      const rows = [...register, { id: 'x', name: 'Bare Candidate', source_url: '' }, { ...sample, criminal_cases: undefined, education: undefined, party: undefined, constituency: undefined, total_assets: undefined, liabilities: undefined }];
      for (const row of rows) {
        const m = model(row);
        for (const raw of strings(m)) {
          // A party can be spelled with a dash ("Nationalist Congress Party – Sharadchandra Pawar"); that is the
          // source's own text, so it is taken out before looking for a dash used as a placeholder.
          const s = row.party ? raw.split(clean(row.party)).join('') : raw;
          expect(s, raw).not.toMatch(/[—–]|\bundefined\b|\bNaN\b|^\s*null\s*$/);
          expect(raw.trim(), 'empty string').not.toBe('');
        }
        expect(contractProblems(m), row.name).toEqual([]);
      }
    });

    it('never shows "Not reported" or "Not published" as a value', () => {
      for (const row of register) expect(text(model(row)), row.name).not.toMatch(/not reported|not published/i);
    });
  });

  describe('footer and provenance', () => {
    it('offers Ask AI about this affidavit and names the MyNeta / ADR source with its licence', () => {
      for (const row of register) {
        const f = model(row).footer;
        expect(f.ask).toBe('Ask AI about this affidavit');
        expect(f.provenance.source).toBe('MyNeta / ADR candidate affidavits (licence-restricted: viewable, not exportable)');
      }
    });

    it('carries the as-of flag because no row holds a date, and shows no date it has not been given', () => {
      for (const row of register) {
        const f = model(row).footer;
        expect(f.provenance.asOf, row.name).toBeUndefined();
        expect(f.provenance.flags).toEqual(['as-of not on record']);
      }
    });

    it('shows an as-of date, and drops the flag, only when the row itself holds one', () => {
      const f = model({ ...sample, as_of: '2026-09-07T18:01:00Z' }).footer;
      expect(f.provenance.asOf).toBe('07 Sep 2026');
      expect(f.provenance.flags).toEqual([]);
      expect(contractProblems(model({ ...sample, as_of: '2026-09-07T18:01:00Z' }))).toEqual([]);
      expect(model({ ...sample, as_of: 'not a date' }).footer.provenance.flags).toEqual(['as-of not on record']);
    });

    it('notes that the affidavit is the authority and the row only an index to it, as declared and not verified', () => {
      const note = model(sample).footer.note;
      expect(note).toMatch(/affidavit is the authority/i);
      expect(note).toMatch(/index/i);
      expect(note).toMatch(/not verified/i);
    });
  });
});
