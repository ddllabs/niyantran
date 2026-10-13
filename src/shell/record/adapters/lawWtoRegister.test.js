import { describe, expect, it } from 'vitest';
import register from '../../../../public/data/embedded_csv/judiciary_wto_disputes.json';
import { wtoRows } from '../../../lib/lawPack.js';
import { contractProblems } from '../modelContract.js';
import { adapterFor } from '../registry.js';
import lawWtoRegister from './lawWtoRegister.js';

// F129 L2: the WTO register panel over the real collected register (646 disputes).
const rows = wtoRows(register);
const ctx = { rows, today: '2026-10-13' };
const byDs = (n) => rows.find((r) => r.ds === n);
const tile = (m, label) => m.glance.tiles.find((t) => t.label === label);
const board = (m) => Object.fromEntries(m.glance.visual2.rows.map((r) => [r.label, r.value]));

describe('WTO register record panel', () => {
  it('honours the contract for every dispute', () => {
    expect(rows.length).toBeGreaterThanOrEqual(646);
    for (const r of rows) expect(contractProblems(lawWtoRegister(r, ctx)), r.ds_number).toEqual([]);
  });

  it('answers the four questions, with no computed compliance date', () => {
    const m = lawWtoRegister(byDs(600), ctx);
    expect(m.title).toBe('DS600: EU and Certain Member States — Palm Oil (Malaysia)');
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Stage', 'Parties', 'Agreements cited', 'Compliance period ends']);
    expect(tile(m, 'Parties').value).toBe('Malaysia v. European Union, France, Lithuania');
    expect(tile(m, 'Compliance period ends')).toMatchObject({ value: 'Not on the row', clock: true });
    for (const r of rows) expect(tile(lawWtoRegister(r, ctx), 'Compliance period ends').value, r.ds_number).toBe('Not on the row');
  });

  it('maps complainant and respondent, but never the European Union, and says so', () => {
    const m = lawWtoRegister(byDs(600), ctx);
    const labels = m.glance.visual.points.map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(['Malaysia', 'France', 'Lithuania']));
    expect(labels).not.toContain('European Union');
    expect(m.glance.visual.caption).toMatch(/Not drawn: European Union/);
    expect(m.glance.visual.points.every((p) => p.approximate)).toBe(true);
  });

  it('marks compliance as partial only when the stage names it', () => {
    const compliance = rows.find((r) => /Compliance Panel/i.test(r.status));
    expect(board(lawWtoRegister(compliance, ctx))['Compliance and retaliation status']).toBe('Partial');
    const consult = rows.find((r) => r.status === 'In consultations');
    expect(board(lawWtoRegister(consult, ctx))['Compliance and retaliation status']).toBe('Not on the row');
  });

  it('links the same matter and the same respondent, never the dispute itself', () => {
    for (const r of rows) for (const l of lawWtoRegister(r, ctx).touches.links) expect(l.row.ds_number, r.ds_number).not.toBe(r.ds_number);
    const gasoline = lawWtoRegister(byDs(2), ctx).touches.links;
    expect(gasoline.some((l) => l.row.ds === 4 && /Same matter/.test(l.detail))).toBe(true);
  });

  it('credits the WTO and dates the register by its collection', () => {
    const m = lawWtoRegister(byDs(646), ctx);
    expect(m.footer.provenance.source).toBe('WTO dispute settlement register (wto.org)');
    expect(m.footer.provenance.asOf).toMatch(/\d{2} [A-Z][a-z]{2} \d{4}/);
    expect(m.links).toEqual([{ label: 'Official case page (wto.org)', href: 'https://www.wto.org/english/tratop_e/dispu_e/cases_e/ds646_e.htm' }]);
  });
});

describe('WTO module dispatch', () => {
  it('gives a register row the register panel and a news row the news panel', () => {
    const adapter = adapterFor('WTO Dispute Settlement', 'judiciary');
    expect(adapter(byDs(600), ctx).badge.text).toBe('WTO register');
    const news = { title: 'WTO panel rules on tariffs - Reuters', publisher: 'Reuters', date: 'Mon, 12 Oct 2026 09:00:00 GMT', source_url: 'https://news.google.com/rss/articles/x', section: 'COVERAGE — GOOGLE NEWS RSS' };
    expect(adapter(news, { rows: [news], feed: { feature: 'WTO Dispute Settlement' } }).badge.text).toBe('Coverage — not an order');
  });
});
