import { describe, expect, it } from 'vitest';
import embedded from '../../../../public/data/embedded_csv/national_mp_report_card.json';
import { contractProblems } from '../modelContract.js';
import nationalMps, { houseFromSource } from './nationalMps.js';

// The embedded member register exactly as the server serves it (server/nationalFeed.mjs, MP Profiles
// branch: loadEmbedded runs every row through flattenRow, which adds `date` (empty, the register has
// none) and `title` (= mp_name) and leaves every other field as held).
const register = embedded.map((r) => ({ ...r, date: '', title: r.mp_name }));
const ctx = (over = {}) => ({ rows: register, feed: { feature: 'MP Profiles & Performance (MPLAD, attendance, debates)' }, packs: null, ...over });
const model = (row, c = ctx()) => nationalMps(row, c);

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'row') strings(x, out);
  return out;
};
const text = (m) => strings(m).join(' | ');
const tile = (m, label) => m.glance.tiles.find((t) => t.label === label);
const aboutRow = (m, key) => m.about.rows.find(([k]) => k === key)?.[1];

const isLs = (r) => /\/ls\//.test(r.source_url);
const isRs = (r) => /\/rs\//.test(r.source_url);
const ls = register.find((r) => isLs(r) && r.constituency && r.committees && r.questions_asked !== '0');
const rs = register.find((r) => isRs(r) && r.committees);
const noCommittees = register.find((r) => !r.committees);
const zeroQuestions = register.find((r) => r.questions_asked === '0');
const noQuestions = register.find((r) => r.questions_asked === '');
const repeated = register.find((r) => {
  const parts = r.committees.split(';').map((s) => s.trim()).filter(Boolean);
  return new Set(parts).size < parts.length;
});
// A member whose list repeats a committee and still names more than one distinct committee.
const repeatedSeveral = register.find((r) => {
  const parts = r.committees.split(';').map((s) => s.trim()).filter(Boolean);
  return new Set(parts).size < parts.length && new Set(parts).size > 1;
});
const withPeers = register.find((r) => isLs(r) && register.filter((x) => x.party === r.party && x.state === r.state).length > 6);
const loner = register.find((r) => register.filter((x) => x.party === r.party && x.state === r.state).length === 1);

// F124 N7: a member panel shows what the register holds (counts of questions and committees, party,
// state, constituency) and says plainly what it does not (attendance, debates, MPLADS). The house is
// read from the member's own source link, because the register has no house column; the party stays as held.
describe('National MP profiles adapter', () => {
  it('honours the panel contract for every member in the register', () => {
    expect(register).toHaveLength(782);
    for (const row of register) expect(contractProblems(model(row)), row.id + row.mp_name).toEqual([]);
  });

  it('puts the member\'s name in the title and the party as held, the house and the state in the meta, with no badge', () => {
    const m = model(ls);
    expect(m.title).toBe(ls.mp_name.replace(/\s+/g, ' '));
    expect(m.meta).toEqual([ls.party, 'Lok Sabha', ls.state]);
    expect(m.badge).toBeUndefined();
    for (const row of register) expect(model(row).meta[0], row.mp_name).toBe(row.party); // never normalised here
  });

  it('collapses the stray double spaces some register names hold', () => {
    const odd = register.filter((r) => /\s{2,}/.test(r.mp_name));
    expect(odd.length).toBeGreaterThan(0);
    for (const row of odd) expect(model(row).title).not.toMatch(/\s{2,}/);
  });

  describe('house, derived from the member\'s own source link', () => {
    it('reads /ls/ as Lok Sabha and /rs/ as Rajya Sabha, and every embedded row is one or the other', () => {
      expect(houseFromSource('https://sansad.in/ls/members/biographyM/5814?from=members')).toBe('Lok Sabha');
      expect(houseFromSource('https://sansad.in/rs/members/biographyM/2556')).toBe('Rajya Sabha');
      const counts = { 'Lok Sabha': 0, 'Rajya Sabha': 0 };
      for (const row of register) counts[houseFromSource(row.source_url)] += 1;
      expect(counts).toEqual({ 'Lok Sabha': 540, 'Rajya Sabha': 242 });
      expect(aboutRow(model(ls), 'House')).toBe('Lok Sabha');
      expect(aboutRow(model(rs), 'House')).toBe('Rajya Sabha');
      expect(model(rs).meta).toContain('Rajya Sabha');
    });

    it('says the house is not on record for any other link, and never guesses', () => {
      for (const url of ['', 'https://sansad.in/members/biographyM/1', 'https://sansad.in/lsx/members/1', 'https://sansad.in/x/ls/members/1', 'https://example.com/ls/members/1', 'http://sansad.in/ls/members/1', 'not a url']) {
        expect(houseFromSource(url), url).toBe('');
        const m = model({ ...ls, source_url: url });
        expect(aboutRow(m, 'House'), url).toBe('Not on record');
        expect(m.meta.some((x) => /sabha/i.test(x)), url).toBe(false);
        expect(contractProblems(m), url).toEqual([]);
      }
    });

    it('explains where the house comes from, since the register has no house column', () => {
      const card = model(ls).about.cards.find((c) => /house/i.test(c.heading));
      expect(card.body).toMatch(/source link/i);
      expect(card.body).toMatch(/no house column/i);
    });
  });

  describe('glance tiles', () => {
    it('shows questions asked as a register count, and committees as the count of distinct committees held', () => {
      const m = model(ls);
      expect(tile(m, 'Questions asked')).toMatchObject({ value: ls.questions_asked });
      expect(tile(m, 'Questions asked').sub).toMatch(/register count/i);
      const distinct = new Set(ls.committees.split(';').map((s) => s.trim().toLowerCase()).filter(Boolean)).size;
      expect(tile(m, 'Committees').value).toBe(String(distinct));
    });

    it('counts a committee listed more than once only once, and says so', () => {
      const m = model(repeated);
      const parts = repeated.committees.split(';').map((s) => s.trim()).filter(Boolean);
      expect(Number(tile(m, 'Committees').value)).toBeLessThan(parts.length);
      expect(tile(m, 'Committees').sub).toMatch(/repeat/i);
      expect(new Set(m.about.chips).size).toBe(m.about.chips.length); // panel keys chips by name
    });

    it('reads "Not on record" for committees or questions the register leaves blank, never none or zero', () => {
      expect(tile(model(noCommittees), 'Committees').value).toBe('Not on record');
      expect(model(noCommittees).about.chips || []).toEqual([]);
      expect(tile(model(noQuestions), 'Questions asked').value).toBe('Not on record');
    });

    it('shows a held count of 0 as 0, not as missing', () => {
      expect(tile(model(zeroQuestions), 'Questions asked').value).toBe('0');
    });

    it('shows the constituency for a Lok Sabha member and the state for a Rajya Sabha member, who holds no constituency', () => {
      expect(tile(model(ls), 'Constituency')).toMatchObject({ value: ls.constituency, sub: ls.state });
      expect(tile(model(ls), 'State')).toBeUndefined();
      const m = model(rs);
      expect(rs.constituency).toBe('');
      expect(tile(m, 'State')).toMatchObject({ value: rs.state });
      expect(tile(m, 'Constituency')).toBeUndefined();
    });

    it('shows attendance as "Not on record" because readers expect it and the register leaves it empty', () => {
      for (const row of register) {
        const t = tile(model(row), 'Attendance');
        expect(t, row.mp_name).toMatchObject({ value: 'Not on record' });
      }
    });

    it('shows an attendance figure only if a row ever holds one, as the register\'s figure', () => {
      const t = tile(model({ ...ls, attendance_pct: '87' }), 'Attendance');
      expect(t.value).toBe('87%');
      expect(t.sub).toMatch(/register/i);
      expect(text(model({ ...ls, attendance_pct: '87' }))).not.toMatch(/attendance[^|]*not on record/i);
    });

    it('has no tile for debates or MPLADS, and no figure for them anywhere', () => {
      for (const row of [ls, rs, noCommittees]) {
        const m = model({ ...row, debates: '12', mplads: '80%' });
        expect(m.glance.tiles.some((t) => /debate|mplad/i.test(t.label))).toBe(false);
        expect(text(m)).not.toMatch(/\b12\b.*debate|debate.*\b12\b|80\s*%/i);
        // They are mentioned only to say they are not on record.
        for (const s of strings(m).filter((x) => /mplad|debate/i.test(x))) expect(s, s).toMatch(/not on record/i);
      }
    });

    it('uses between two and four tiles and no visual (the tiles already hold every register count)', () => {
      for (const row of register) {
        const m = model(row);
        expect(m.glance.tiles.length).toBeGreaterThanOrEqual(2);
        expect(m.glance.tiles.length).toBeLessThanOrEqual(4);
        expect(m.glance.visual).toBeUndefined();
      }
    });
  });

  describe('no empty-value placeholders', () => {
    it('never shows "Not reported" as a value or anywhere else', () => {
      for (const row of register) expect(text(model(row)), row.mp_name).not.toMatch(/not reported/i);
    });

    it('has no dash placeholder, "undefined", "NaN" or bare null in any reader-facing string', () => {
      const rows = [...register, { id: 'x', mp_name: 'Bare Member', source_url: '' }, { ...ls, questions_asked: undefined, committees: undefined, party: undefined, state: undefined, constituency: undefined }];
      for (const row of rows) {
        const m = model(row);
        for (const s of strings(m)) {
          expect(s, s).not.toMatch(/[—–]|\bundefined\b|\bNaN\b|^\s*null\s*$/);
          expect(s.trim(), 'empty string').not.toBe('');
        }
        expect(contractProblems(m), row.mp_name).toEqual([]);
      }
    });
  });

  describe('about', () => {
    it('lists party as held, house, constituency and state, and the committees as chips', () => {
      const m = model(ls);
      expect(m.about.rows).toEqual([
        ['Party', ls.party],
        ['House', 'Lok Sabha'],
        ['Constituency', ls.constituency],
        ['State', ls.state],
      ]);
      expect(m.about.chips.length).toBeGreaterThan(0);
      for (const c of m.about.chips) expect(ls.committees).toContain(c);
      expect(m.about.label).toMatch(/about this member/i);
    });

    it('says every count is a register count, not a measure of effectiveness or a ranking, and what is not on record', () => {
      const body = model(ls).about.cards.map((c) => `${c.heading} ${c.body}`).join(' | ');
      expect(body).toMatch(/register count/i);
      expect(body).toMatch(/not a measure of effectiveness/i);
      expect(body).toMatch(/not a ranking/i);
      expect(body).toMatch(/attendance, debates and MPLADS[^|]*not on record/i);
      expect(body).toMatch(/period the register does not state/i);
    });

    it('never ranks or praises a member', () => {
      for (const row of [ls, rs, withPeers]) expect(text(model(row))).not.toMatch(/\b(top|best|worst|most active|least active|leading|rank(ed|s)?\b)/i);
    });
  });

  describe('touch lanes', () => {
    it('draws party, this member, constituency (or state) and committees', () => {
      const t = model(ls).touches;
      expect(t.lanes).toEqual(['PARTY', 'MEMBER', 'CONSTITUENCY', 'COMMITTEES']);
      expect(t.nodes.center).toMatchObject({ code: 'M' });
      expect(t.nodes.left.l1).toBe(ls.party);
      expect(t.nodes.right.l1).toBe(ls.constituency);
      const first = ls.committees.split(';')[0].trim();
      expect(t.nodes.far.l1).toBe(first);
    });

    it('falls back to the state for a Rajya Sabha member, and leaves the committees lane empty when none is held', () => {
      expect(model(rs).touches.nodes.right).toMatchObject({ l1: rs.state });
      expect(model(noCommittees).touches.nodes.far).toBeUndefined();
    });

    it('leaves a lane empty (so the panel says "None on record") when the register holds nothing for it', () => {
      const bare = model({ id: 'x', mp_name: 'Bare Member', source_url: '' }).touches.nodes;
      expect(bare.left).toBeUndefined();
      expect(bare.right).toBeUndefined();
      expect(bare.far).toBeUndefined();
      expect(bare.center).toMatchObject({ code: 'M' });
      expect(bare.center.l2).toBeUndefined();
      expect(model({ ...ls, party: '' }).touches.nodes.left).toBeUndefined();
    });

    it('counts the remaining committees, not the repeats', () => {
      const far = model(repeatedSeveral).touches.nodes.far;
      const distinct = Number(tile(model(repeatedSeveral), 'Committees').value);
      expect(distinct).toBeGreaterThan(1); // the fixture must reach the branch
      expect(far.l2).toBe(`+${distinct - 1} more`);
    });
  });

  describe('related members', () => {
    const links = (row, c = ctx()) => model(row, c).touches.links.filter((l) => l.row);

    it('links at most three members of the same party as held and the same state, as register rows', () => {
      const l = links(withPeers);
      expect(l.length).toBe(3);
      for (const { row } of l) {
        expect(register).toContain(row);
        expect(row.party).toBe(withPeers.party);
        expect(row.state).toBe(withPeers.state);
      }
    });

    it('never links the selection, or a copy of it', () => {
      for (const sel of [withPeers, { ...withPeers }, { ...withPeers, id: 'other-id' }]) {
        for (const { row } of links(sel)) {
          expect(row.source_url).not.toBe(sel.source_url);
          expect(row.mp_name).not.toBe(sel.mp_name);
        }
      }
    });

    it('does not take a different member for the selection just because they share a row id', () => {
      // Two real members (a Lok Sabha and a Rajya Sabha one) carry the same id; ids are not unique here.
      const clash = { ...withPeers, mp_name: 'Someone Else', source_url: 'https://sansad.in/rs/members/biographyM/9999' };
      expect(links(withPeers, ctx({ rows: [withPeers, clash] })).map((x) => x.row)).toEqual([clash]);
      const ids = register.map((r) => r.id);
      expect(ids.length - new Set(ids).size).toBeGreaterThan(0);
    });

    it('does not join parties the register names differently', () => {
      const bjp = register.find((r) => r.party === 'BJP' && register.some((x) => x.party === 'Bharatiya Janata Party' && x.state === r.state));
      expect(bjp).toBeTruthy();
      for (const { row } of links(bjp)) expect(row.party).toBe('BJP');
      expect(model(bjp).footer.note).toMatch(/party names are shown as the register holds them/i);
    });

    it('counts the members beyond the three shown, without a link to open', () => {
      const all = register.filter((x) => x.party === withPeers.party && x.state === withPeers.state && x.source_url !== withPeers.source_url);
      const more = model(withPeers).touches.links.find((l) => !l.row);
      expect(more.detail).toBe(`${all.length - 3} more on the register`);
      expect(more.title).toContain(withPeers.party);
    });

    it('has no related links for a member alone in their party and state, or with no party', () => {
      expect(model(loner).touches.links).toEqual([]);
      expect(model({ ...ls, party: '' }).touches.links).toEqual([]);
      expect(model({ ...ls, state: '' }).touches.links).toEqual([]);
      expect(model(ls, ctx({ rows: undefined })).touches.links).toEqual([]);
    });

    it('lists the first three related members in name order, never by question count', () => {
      const peers = register.filter((x) => x.party === withPeers.party && x.state === withPeers.state && x.source_url !== withPeers.source_url);
      const expected = peers.map((x) => x.source_url).sort((p, q) => {
        const a = peers.find((x) => x.source_url === p).mp_name;
        const b = peers.find((x) => x.source_url === q).mp_name;
        return a.localeCompare(b);
      }).slice(0, 3);
      expect(links(withPeers).map((l) => l.row.source_url)).toEqual(expected);
    });

    it('matches the party on its exact spelling: not another name for it, not another case', () => {
      const member = (name, party, n) => ({ id: String(n), mp_name: name, party, state: 'Test State', constituency: '', source_url: `https://sansad.in/ls/members/biographyM/${n}` });
      const sel = member('Zed Member', 'BJP', 1);
      const rows = [sel, member('Aaa Member', 'Bharatiya Janata Party', 2), member('Bbb Member', 'bjp', 3), member('Ccc Member', 'BJP', 4), { ...member('Ddd Member', 'BJP', 5), state: 'Other State' }];
      expect(links(sel, ctx({ rows })).map((l) => l.row.mp_name)).toEqual(['Ccc Member']);
    });

  });

  describe('links, footer and provenance', () => {
    it('links the member\'s source profile over https only', () => {
      expect(model(ls).links).toEqual([expect.objectContaining({ href: ls.source_url })]);
      expect(model({ ...ls, source_url: 'http://sansad.in/ls/members/1' }).links).toEqual([]);
      expect(model({ ...ls, source_url: 'javascript:alert(1)' }).links).toEqual([]);
    });

    it('names the Sansad profile register, and carries the as-of flag because the register holds no date', () => {
      for (const row of register) {
        const f = model(row).footer;
        expect(f.provenance.source).toMatch(/sansad/i);
        expect(f.provenance.asOf, row.mp_name).toBeUndefined();
        expect(f.provenance.flags).toEqual(['as-of not on record']);
      }
    });

    it('shows an as-of date, and drops the flag, only when the row itself holds one', () => {
      const f = model({ ...ls, as_of: '2026-09-07T18:01:00Z' }).footer;
      expect(f.provenance.asOf).toBe('07 Sep 2026');
      expect(f.provenance.flags).toEqual([]);
      expect(contractProblems(model({ ...ls, as_of: '2026-09-07T18:01:00Z' }))).toEqual([]);
      expect(model({ ...ls, as_of: 'not a date' }).footer.provenance.flags).toEqual(['as-of not on record']);
    });

    it('offers Ask AI about this member and notes that the register is not a ranking', () => {
      const f = model(ls).footer;
      expect(f.ask).toBe('Ask AI about this member');
      expect(f.note).toMatch(/not a ranking/i);
    });

    it('does not claim the "18th Lok Sabha" or a 2024 election coverage the register does not state', () => {
      for (const row of [ls, rs]) expect(text(model(row))).not.toMatch(/18th lok sabha|2024 election/i);
    });
  });
});
