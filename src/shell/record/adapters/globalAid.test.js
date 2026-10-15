import { describe, expect, it } from 'vitest';
import pack from '../../../data/global-aid.json';
import { AID_COUNTRIES, compact, coveragePct, flattenAppeal, hydrateAppeal, money } from '../../../lib/globalAid.js';
import { countryPosition, regionPosition } from '../geoLookup.js';
import { contractProblems } from '../modelContract.js';
import globalAid from './globalAid.js';

/**
 * F121 batch 3, T18: Global Aid (the humanitarian appeal register).
 *
 * Fixtures are the real pack (src/data/global-aid.json, 16 appeals) through the real flattenAppeal,
 * exactly as the feed serves them (server/featureFeed.mjs). The pack holds no pack-level as-of and the
 * feed carries only `meta.wire`, so a row's own `dataThrough` is the as-of date.
 */
const rows = pack.appeals.map(flattenAppeal);
const feed = { feature: 'Global Aid', meta: { wire: pack.wire } };
const ctx = (list = rows, f = feed) => ({ rows: list, feed: f });
const byId = (id) => rows.find((r) => r.id === id);
const model = (row, c = ctx()) => globalAid(row, c);

const gho = byId('gho26'); // global appeal, no funded figure, agency UN OCHA (alone)
const unicef = byId('unicef26'); // portfolio appeal, nine UNICEF country plans beside it
const sudan = byId('sdn26'); // the only row with a comparable funded figure
const ida = byId('ida21'); // funded figure that must not become a coverage %
const wfp = byId('wfp26'); // no requirement
const palestine = byId('pal26'); // geography text is a phrase; the register's country is 'Palestine'

const countryIds = Object.keys(AID_COUNTRIES);
const sparse = [{}, { title: 'Mystery appeal' }, { name: 'Mystery appeal', agency: 'UNICEF' }, { id: 'x', name: 'x', requirement: 'abc', funded: 'abc', people_target: 'abc', sectors_json: 'not json' }];

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** The model without the feed rows its links open (they are data, not text the panel shows). */
const withoutLinkRows = (m) => (m.touches ? { ...m, touches: { ...m.touches, links: (m.touches.links || []).map(({ row: _row, ...l }) => l) } } : m);

/** The register's own prose (cards, the callout, links), shown verbatim, so a dash it holds is not ours to remove. */
function ownStrings(m) {
  const copy = {
    ...m,
    glance: { ...m.glance, callout: undefined },
    about: { ...m.about, cards: [] },
  };
  return strings(withoutLinkRows(copy));
}

/** Board row labels that repeat a glance tile label (a board must add rows, not echo tiles). */
const boardRepeats = (m) => {
  const tiles = new Set(m.glance.tiles.map((t) => t.label.toLowerCase()));
  return [m.glance.visual, m.glance.visual2]
    .filter((v) => v?.type === 'board')
    .flatMap((v) => v.rows.map((r) => r.label))
    .filter((label) => tiles.has(label.toLowerCase()));
};

describe('fixtures are real flattenAppeal output', () => {
  it('has 16 appeals; only Sudan holds a comparable funded figure', () => {
    expect(rows).toHaveLength(16);
    expect(rows.filter((r) => r.funded != null).map((r) => r.id)).toEqual(['ida21', 'sdn26']);
    expect(ida.coverageComparable).toBe('false');
    expect(wfp.requirement).toBeNull();
  });
});

describe('contract and hygiene', () => {
  it('honours the panel contract for every real row, with and without feed metadata', () => {
    for (const row of rows) {
      expect(contractProblems(model(row)), row.id).toEqual([]);
      expect(contractProblems(model(row, ctx(rows, { meta: { asOf: '2026-08' } }))), row.id).toEqual([]);
      expect(contractProblems(model(row, {})), row.id).toEqual([]);
      expect(contractProblems(model(row, ctx([]))), row.id).toEqual([]);
    }
  });

  it('honours the contract for sparse rows and never throws on them', () => {
    for (const row of sparse) expect(contractProblems(model(row, ctx([row, ...rows]))), JSON.stringify(row)).toEqual([]);
    expect(() => globalAid(sparse[0])).not.toThrow();
  });

  it('shows no dash, bracket token, undefined or NaN in anything the adapter writes', () => {
    for (const row of [...rows, ...sparse]) {
      const m = model(row, ctx([row, ...rows]));
      for (const text of ownStrings(m)) expect(text, row.id || row.name || '(empty)').not.toMatch(/—|\[|undefined|NaN|\bnull\b/);
      // The register's own prose may hold a dash, never a placeholder, undefined or NaN.
      for (const text of strings(withoutLinkRows(m))) expect(text, row.id || row.name || '(empty)').not.toMatch(/\[|undefined|NaN/);
    }
  });

  it('writes https links only', () => {
    for (const row of rows) for (const l of model(row).links) expect(l.href).toMatch(/^https:\/\//);
    expect(model({ ...sudan, source_url: 'http://example.org/x' }).links).toEqual([]);
    expect(model({ ...sudan, source_url: 'javascript:alert(1)' }).links).toEqual([]);
  });
});

describe('header, badge and tiles', () => {
  it('names the appeal, agency and period, with the source link labelled by the register', () => {
    const m = model(gho);
    expect(m.title).toBe('UN Global Humanitarian Appeal 2026');
    expect(m.meta).toEqual(['UN OCHA', '2026']);
    expect(m.links).toEqual([{ label: 'Source: United Nations', href: 'https://www.un.org/sg/en/content/highlight/2025-12-08.html' }]);
  });

  it('badges only a real status, by what it says', () => {
    expect(model(gho).badge).toEqual({ text: 'Active appeal', tone: 'green' });
    expect(model(byId('lbn26')).badge).toEqual({ text: 'Revised appeal', tone: 'amber' });
    expect(model(byId('wfp26')).badge).toEqual({ text: 'Implementation', tone: 'grey' });
    for (const status of ['', '—', 'n/a', 'Not stated']) expect(model({ ...gho, appeal_status: status, status }).badge, `status "${status}"`).toBeUndefined();
  });

  it('leads with requirement, funded, people targeted and data through', () => {
    expect(model(gho).glance.tiles.map((t) => t.label)).toEqual(['Requirement', 'Funded', 'People targeted', 'Data through']);
  });

  it('formats requirement and people targeted exactly as the dossier did (src/lib/globalAid.js)', () => {
    for (const row of rows) {
      const p = hydrateAppeal(row);
      const [req, , people, through] = model(row).glance.tiles;
      expect(req.value, row.id).toBe(p.requirement == null ? 'Not on record' : money(p.requirement));
      expect(people.value, row.id).toBe(p.target == null ? 'Not on record' : compact(p.target));
      expect(through.value, row.id).toBe(p.dataThrough || 'Not on record');
    }
    const [req, , people, through] = model(gho).glance.tiles;
    expect([req.value, people.value, through.value]).toEqual(['$33B', '135M', '08 Dec 2025']);
    expect(req.sub).toMatch(/not cash received/i);
  });

  it('computes the coverage % with coveragePct from the library, and only where it is comparable', () => {
    for (const row of rows) {
      const p = hydrateAppeal(row);
      const funded = model(row).glance.tiles[1];
      const c = coveragePct(p);
      if (c === null) expect(`${funded.value} ${funded.sub}`, row.id).not.toMatch(/\d%/);
      else expect(funded.sub, row.id).toContain(`${c}%`);
    }
    const s = model(sudan).glance.tiles[1];
    expect(s).toMatchObject({ label: 'Funded', value: '$351M' });
    expect(s.sub).toContain('36%');
  });

  it('never turns the IDA donor component into a coverage %, and says why', () => {
    const f = model(ida).glance.tiles[1];
    expect(f.value).toBe('$23.7B');
    expect(f.sub).not.toMatch(/\d%/);
    expect(f.sub).toMatch(/not comparable/i);
    expect(JSON.stringify(model(ida))).not.toMatch(/\b24%/);
  });

  it('says plainly when a funded figure or requirement is not on the row', () => {
    expect(model(gho).glance.tiles[1]).toMatchObject({ value: 'Not on record' });
    expect(model(gho).glance.tiles[1].sub).toMatch(/no dated receipt/i);
    expect(model(wfp).glance.tiles[0]).toMatchObject({ value: 'Not on record' });
    expect(model(palestine).glance.tiles[2].value).toBe('Not on record');
  });

  it('keeps the register\'s funding note as an amber caution', () => {
    for (const row of rows) {
      const c = model(row).glance.callout;
      expect(c.tone, row.id).toBe('amber');
      expect(c.text, row.id).toBe(row.fundingNote);
    }
    expect(model({ ...gho, fundingNote: '' }).glance.callout).toBeUndefined();
  });
});

describe('the map: where the appeal lands', () => {
  it('has no map for the global and portfolio appeals, which name no country', () => {
    for (const row of rows.filter((r) => !AID_COUNTRIES[r.id])) {
      expect(model(row).glance.visual, row.id).toBeUndefined();
      expect(model(row).glance.visual2, row.id).toBeUndefined();
    }
  });

  it('places each country plan at its country centre, approximate, and nothing else', () => {
    expect(countryIds).toHaveLength(9);
    for (const id of countryIds) {
      const v = model(byId(id)).glance.visual;
      expect(v.type, id).toBe('map');
      expect(v.title, id).toBe('Where the appeal lands');
      expect(v.points, id).toHaveLength(1);
      expect(v.points[0], id).toMatchObject({ ...countryPosition(AID_COUNTRIES[id]), label: AID_COUNTRIES[id], approximate: true });
    }
  });

  it('uses the register\'s country name for Palestine, whose geography text is a phrase', () => {
    expect(palestine.geography).toMatch(/Gaza/);
    const v = model(palestine).glance.visual;
    expect(v.points.map((p) => p.label)).toEqual(['Palestine']);
    expect(v.points.every((p) => p.approximate)).toBe(true);
  });

  it('captions the map as approximate, with how many of the named countries are shown', () => {
    for (const id of countryIds) {
      const v = model(byId(id)).glance.visual;
      expect(v.caption, id).toMatch(/1 of 1 named countr/i);
      expect(v.caption, id).toMatch(/approximate/i);
      expect(v.caption, id).toMatch(/no coordinates/i);
    }
  });

  it('counts a place it cannot position as named but not shown, and never places it', () => {
    const row = { ...sudan, id: 'zz', geography: 'Sudan, Chad and Atlantis' };
    const v = model(row).glance.visual;
    expect(v.points.map((p) => p.label)).toEqual(['Sudan', 'Chad']);
    expect(v.caption).toMatch(/2 of 2 named countr/i);
    expect(contractProblems(model(row))).toEqual([]);
  });

  it('shows the region only when the row names no country and the region is a known one', () => {
    const regional = { ...gho, id: 'zz', geography: '', region: 'South Asia' };
    const v = model(regional).glance.visual;
    expect(v.points).toHaveLength(1);
    expect(v.points[0]).toMatchObject({ ...regionPosition('South Asia'), label: 'South Asia', approximate: true });
    expect(v.caption).toMatch(/no country is named/i);
    expect(v.caption).toMatch(/approximate/i);
    for (const region of ['Global', 'Eastern & Southern Africa', 'Atlantis', 'constructor', '__proto__', '']) {
      expect(model({ ...gho, id: 'zz', geography: '', region }).glance.visual, `region "${region}"`).toBeUndefined();
    }
  });

  it('never falls back to the region when the row names a country, and never guesses an unknown one', () => {
    const unknown = { ...gho, id: 'zz', geography: 'Atlantis', region: 'South Asia' };
    expect(model(unknown).glance.visual).toBeUndefined();
    expect(model({ ...unknown, geography: '54 countries' }).glance.visual).toBeUndefined();
    // Afghanistan's region is a known region; its own country wins.
    const afg = model(byId('afg26')).glance.visual;
    expect(afg.points.map((p) => p.label)).toEqual(['Afghanistan']);
    expect(afg.points[0].lat).not.toBe(regionPosition('South Asia').lat);
    // A count statement names no place.
    expect(model({ ...gho, id: 'zz', geography: '54 countries', region: 'Global' }).glance.visual).toBeUndefined();
  });

  it('draws no board that repeats a tile label (the guard itself catches a repeat)', () => {
    for (const row of rows) expect(boardRepeats(model(row)), row.id).toEqual([]);
    const echo = { ...model(gho), glance: { ...model(gho).glance, visual: { type: 'board', title: 'Funding', rows: [{ label: 'Requirement', value: '$33B' }] } } };
    expect(boardRepeats(echo)).toEqual(['Requirement']);
  });
});

describe('about', () => {
  it('lists the sectors as chips, as the register names them', () => {
    expect(model(gho).about.chips).toEqual(['Food security', 'Health', 'WASH', 'Shelter', 'Protection', 'Education']);
    for (const row of rows) expect(model(row).about.chips, row.id).toEqual(hydrateAppeal(row).sectors);
  });

  it('holds agency, type, period, scope and, where stated, people in need and coordinator', () => {
    const rowsOf = Object.fromEntries(model(byId('fao26')).about.rows);
    expect(rowsOf).toMatchObject({ Agency: 'FAO', 'Plan period': '2026', Scope: '54 countries', 'People in need': '295M' });
    expect(rowsOf.Coordinator).toBe('FAO');
    expect(Object.fromEntries(model(gho).about.rows)).not.toHaveProperty('People in need');
    expect(model(gho).about.label).toBe('02 · About this appeal');
  });

  it('labels the brief as the register\'s text, not a live assessment, and shows the latest record', () => {
    const cards = model(gho).about.cards;
    const brief = cards.find((c) => /brief/i.test(c.heading));
    expect(brief.heading).toMatch(/register/i);
    expect(brief.heading).toMatch(/not a live assessment/i);
    expect(brief.body).toBe(gho.brief);
    const latest = cards.find((c) => /latest/i.test(c.heading));
    expect(latest.heading).toContain('08 Dec 2025');
    expect(latest.body).toBe(gho.latest);
    expect(model({ ...gho, brief: '', latest: '' }).about.cards).toEqual([]);
  });
});

describe('what it touches', () => {
  it('names no donors, which the rows do not hold', () => {
    for (const row of rows) expect(JSON.stringify(model(row).touches), row.id).not.toMatch(/donor/i);
  });
});

describe('related appeals the reader can open', () => {
  const related = (m) => m.touches.links.filter((l) => l.row);

  it('offers up to three appeals of the same agency, largest requirement first, each as the feed row', () => {
    const l = related(model(unicef));
    const expected = rows
      .filter((r) => r.agency === 'UNICEF' && r.id !== 'unicef26')
      .sort((a, b) => b.requirement - a.requirement)
      .slice(0, 3);
    expect(l.map((x) => x.row)).toEqual(expected);
    expect(l.every((x) => rows.includes(x.row))).toBe(true);
    expect(l.map((x) => x.title)).toEqual(['Sudan HAC 2026', 'Afghanistan HAC 2026', 'State of Palestine HAC 2026']);
    expect(l[0].detail).toMatch(/UNICEF/);
    expect(l[0].detail).toContain(money(expected[0].requirement));
  });

  it('adds a count link only when more than three are held, and counts them without the selection', () => {
    const links = model(unicef).touches.links;
    const count = links.find((l) => !l.row);
    expect(count.title).toBe('Other appeals by UNICEF');
    expect(count.detail).toMatch(/^9 on the register/);
    expect(model(sudan).touches.links.find((l) => !l.row).detail).toMatch(/^9 on the register/);
    const small = rows.filter((r) => r.agency !== 'UNICEF' || ['unicef26', 'afg26', 'sdn26'].includes(r.id));
    const twoPeers = model(unicef, ctx(small)).touches.links;
    expect(twoPeers.filter((l) => l.row)).toHaveLength(2);
    expect(twoPeers.find((l) => !l.row)).toBeUndefined();
  });

  it('has no related link for an agency alone on the register, and none for a bare row', () => {
    expect(model(gho).touches.links).toEqual([]);
    expect(model({ id: 'zz', name: 'Bare appeal' }).touches.links).toEqual([]);
    expect(model({ ...sudan, agency: '' }).touches.links).toEqual([]);
  });

  it('excludes the selection, including a copy of it, from the links and the counts', () => {
    for (const row of rows) {
      for (const selected of [row, { ...row }]) {
        const links = model(selected).touches.links;
        for (const l of links.filter((x) => x.row)) {
          expect(l.row.id, row.id).not.toBe(row.id);
          expect(l.title, row.id).not.toBe(row.name);
          expect(l.row.agency.toLowerCase(), row.id).toBe(row.agency.toLowerCase());
        }
        expect(links.length, row.id).toBeLessThanOrEqual(4);
        expect(new Set(links.map((l) => l.title)).size, row.id).toBe(links.length);
        const peers = rows.filter((r) => r.agency === row.agency && r.id !== row.id).length;
        const count = links.find((l) => !l.row);
        if (peers > 3) expect(count.detail, row.id).toMatch(new RegExp(`^${peers} on the register`));
        else expect(count, row.id).toBeUndefined();
        expect(contractProblems(model(selected)), row.id).toEqual([]);
      }
    }
  });

  it('matches the agency regardless of case and spacing', () => {
    const loud = rows.map((r) => (r.id === 'afg26' ? { ...r, agency: '  unicef ' } : r));
    expect(related(model(unicef, ctx(loud))).map((l) => l.row.id)).toContain('afg26');
  });
});

describe('footer and provenance', () => {
  it('asks about the appeal and names the register\'s source with the row\'s data-through date', () => {
    for (const row of rows) {
      const f = model(row).footer;
      expect(f.ask, row.id).toBe('Ask AI about this appeal');
      expect(f.provenance.asOf, row.id).toBe(row.dataThrough);
      expect(f.provenance.flags || [], row.id).not.toContain('as-of not on record');
      if (row.source_label) expect(f.provenance.source, row.id).toContain(row.source_label);
    }
    expect(model(gho).footer.provenance.source).toBe('United Nations (global aid appeal register)');
    expect(model(sudan).footer.provenance.asOf).toBe('30 Jun 2026');
  });

  it('falls back to the feed\'s as-of, then says plainly that none is on record', () => {
    const bare = { ...gho, dataThrough: '' };
    expect(model(bare, ctx(rows, { meta: { asOf: '2026-08' } })).footer.provenance).toMatchObject({ asOf: 'Aug 2026' });
    const none = model(bare).footer.provenance;
    expect(none.asOf).toBeFalsy();
    expect(none.flags).toContain('as-of not on record');
    expect(model(bare).glance.tiles[3].value).toBe('Not on record');
    expect(model(bare, ctx(rows, { meta: { asOf: 'not a date' } })).footer.provenance.flags).toContain('as-of not on record');
  });

  it('names the register when the row has no source label, and separates asks, commitments and receipts', () => {
    expect(model({ ...gho, source_label: '' }).footer.provenance.source).toBe('Global aid appeal register');
    expect(model(gho).footer.note).toMatch(/requirement/i);
    expect(model(gho).footer.note).toMatch(/not cash received|asks/i);
  });
});
