import { describe, expect, it } from 'vitest';
import { parseFeedDate } from './feedDate.js';
import { plainText, text, titleCaseCaps } from './feedText.js';

const iso = (d) => (d ? d.toISOString() : null);

// F127: one strict date reader for every adapter, with options for the feeds that need them.
describe('parseFeedDate', () => {
  it('reads GDELT, ISO with a zone, bare dates and RFC 822 with a listed zone', () => {
    expect(iso(parseFeedDate('20261012T143000Z'))).toBe('2026-10-12T14:30:00.000Z');
    expect(iso(parseFeedDate('2026-10-12T14:30:00+05:30'))).toBe('2026-10-12T09:00:00.000Z');
    expect(iso(parseFeedDate('2026-10-12'))).toBe('2026-10-12T00:00:00.000Z');
    expect(iso(parseFeedDate('Mon, 12 Oct 2026 14:30:00 GMT'))).toBe('2026-10-12T14:30:00.000Z');
    expect(iso(parseFeedDate('Mon, 12 Oct 2026 20:00:00 +0530'))).toBe('2026-10-12T14:30:00.000Z');
    expect(iso(parseFeedDate('12 Oct 2026'))).toBe('2026-10-12T00:00:00.000Z');
  });

  it('refuses impossible dates, zoneless ISO times, unlisted zones and other text', () => {
    for (const v of ['2026-02-31', '2026-10-12T14:30:00', 'Mon, 12 Oct 2026 14:30:00 BST', 'yesterday', '', null, undefined, '12/10/2026', '+0560']) {
      expect(parseFeedDate(v), String(v)).toBeNull();
    }
  });

  it('reads IST as India time only when the feed is Indian', () => {
    expect(parseFeedDate('Mon, 12 Oct 2026 20:00:00 IST')).toBeNull();
    expect(iso(parseFeedDate('Mon, 12 Oct 2026 20:00:00 IST', { ist: true }))).toBe('2026-10-12T14:30:00.000Z');
  });

  it('reads full month names and "Sept" only with monthNames, never a fragment such as "Marc"', () => {
    expect(parseFeedDate('12 October 2026')).toBeNull();
    expect(parseFeedDate('12 Oct. 2026')).toBeNull();
    expect(iso(parseFeedDate('12 October, 2026', { monthNames: true }))).toBe('2026-10-12T00:00:00.000Z');
    expect(iso(parseFeedDate('12 Sept 2026', { monthNames: true }))).toBe('2026-09-12T00:00:00.000Z');
    expect(iso(parseFeedDate('12 Oct. 2026', { monthNames: true }))).toBe('2026-10-12T00:00:00.000Z');
    expect(parseFeedDate('12 Marc 2026', { monthNames: true })).toBeNull();
  });

  it('reads an RFC 822 time with no zone as its calendar day only with zonelessDay', () => {
    expect(parseFeedDate('Mon, 12 Oct 2026 23:55:00')).toBeNull();
    expect(iso(parseFeedDate('Mon, 12 Oct 2026 23:55:00', { zonelessDay: true }))).toBe('2026-10-12T00:00:00.000Z');
    expect(parseFeedDate('Mon, 12 Oct 2026 24:55:00', { zonelessDay: true })).toBeNull();
  });
});

describe('plainText', () => {
  it('decodes a few entities once, never &lt; or &gt;, and strips invisible characters', () => {
    expect(plainText('Tom &amp; Jerry&nbsp; &lt;b&gt;')).toBe('Tom & Jerry &lt;b&gt;');
    expect(plainText('a‮b​c‍d﻿')).toBe('abc‍d');
    expect(plainText(42)).toBe('42');
    expect(plainText({})).toBe('');
  });

  it('strips markup, written out or escaped, only when asked', () => {
    expect(plainText('<p>Notice</p> &lt;a href="x"&gt;link&lt;/a&gt;')).toBe('<p>Notice</p> &lt;a href="x"&gt;link&lt;/a&gt;');
    expect(plainText('<p>Notice</p> &lt;a href="x"&gt;link&lt;/a&gt;', { stripMarkup: true })).toBe('Notice link');
  });

  it('text() keeps strings and numbers only', () => {
    expect(text('  x ')).toBe('x');
    expect(text(null)).toBe('');
  });
});

// F127: register names print as the source writes them; only an all-capitals name is title-cased.
describe('titleCaseCaps', () => {
  it('prints a mixed-case name exactly as written', () => {
    expect(titleCaseCaps('The ASHA Workers (Regularisation of Service) Bill, 2024.')).toBe('The ASHA Workers (Regularisation of Service) Bill, 2024.');
    expect(titleCaseCaps('insertion of new Chapter VIIB')).toBe('insertion of new Chapter VIIB');
  });

  it('title-cases an all-capitals name, keeping small words, abbreviations and roman numerals', () => {
    expect(titleCaseCaps('MICRO, SMALL AND MEDIUM ENTERPRISES')).toBe('Micro, Small and Medium Enterprises');
    expect(titleCaseCaps('THE CENTRAL GOODS AND SERVICES TAX (GST) AMENDMENT BILL, 2026')).toBe('The Central Goods and Services Tax (GST) Amendment Bill, 2026');
    expect(titleCaseCaps('THE CONSTITUTION (AMENDMENT) BILL (INSERTION OF PART XIV AND ARTICLE 371A)')).toBe('The Constitution (Amendment) Bill (Insertion of Part XIV and Article 371A)');
    expect(titleCaseCaps('PERSONNEL,  PUBLIC  GRIEVANCES  AND  PENSIONS')).toBe('Personnel, Public Grievances and Pensions');
    expect(titleCaseCaps('MINISTRY OF AYUSH')).toBe('Ministry of AYUSH');
  });
});
