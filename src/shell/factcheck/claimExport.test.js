// B1: the plain-text builders for one claim (Copy) and a whole session (Export).
import { describe, expect, it } from 'vitest';
import { AUTOMATED_LINE, claimCopyText, exportFileName, sessionExportText, sessionStartOf } from './claimExport.js';

const claim = (over = {}) => ({
  id: 'k1', claim_en: 'The tax rate is 18 percent', status: 'checked', verdict: 'contradicted', reason: 'The rate is 12 percent.',
  sources: [{ url: 'https://a.test/x', title: 'Official release' }, { url: 'https://b.test/y', title: '' }], checked_at: '2026-11-18T10:01:00Z', ...over,
});

describe('claimCopyText', () => {
  it('has the claim, verdict, reason, sources, date, channel and the automated-check line', () => {
    expect(claimCopyText({ claim: claim(), shown: claim(), source: 'DD News', timeZone: 'UTC' })).toBe([
      'Claim: The tax rate is 18 percent',
      'Verdict: Contradicted',
      'Reason: The rate is 12 percent.',
      'Sources:',
      '- https://a.test/x (Official release)',
      '- https://b.test/y',
      'Checked: 2026-11-18',
      'Channel or video: DD News',
      AUTOMATED_LINE,
      '',
    ].join('\n'));
    expect(AUTOMATED_LINE).toBe('Automated check; read the sources before quoting.');
  });
  it('leaves out what is missing: no reason, no sources, no date, no channel', () => {
    const bare = claim({ reason: null, sources: [], checked_at: null, verdict: 'opinion' });
    expect(claimCopyText({ claim: bare, shown: bare })).toBe(`Claim: The tax rate is 18 percent\nVerdict: Opinion\n${AUTOMATED_LINE}\n`);
  });
  it('lists only http(s) sources', () => {
    const s = claim({ sources: [{ url: 'javascript:alert(1)', title: 'bad' }, { url: 'ftp://x.test/f', title: 'ftp' }, { url: 'http://ok.test/a', title: 'ok' }, { url: 'notaurl', title: 'junk' }] });
    const t = claimCopyText({ claim: s, shown: s });
    expect(t).toContain('- http://ok.test/a (ok)');
    expect(t).not.toMatch(/javascript|ftp|junk/);
  });
  it('uses the newest result of a re-checked claim for the verdict, reason and sources, and keeps the original claim text', () => {
    const newer = { status: 'checked', verdict: 'supported', reason: 'Now confirmed.', sources: [{ url: 'https://n.test/', title: 'New' }], checked_at: '2026-11-19T09:00:00Z' };
    const t = claimCopyText({ claim: claim(), shown: newer, timeZone: 'UTC' });
    expect(t).toContain('Claim: The tax rate is 18 percent');
    expect(t).toContain('Verdict: Supported');
    expect(t).toContain('Reason: Now confirmed.');
    expect(t).toContain('Checked: 2026-11-19');
    expect(t).not.toContain('12 percent');
  });
  it('keeps Devanagari as it is', () => {
    const d = claim({ claim_en: 'सरकार ने कहा कि दर 18 प्रतिशत है', reason: 'दर 12 प्रतिशत है।' });
    const t = claimCopyText({ claim: d, shown: d });
    expect(t).toContain('Claim: सरकार ने कहा कि दर 18 प्रतिशत है');
    expect(t).toContain('Reason: दर 12 प्रतिशत है।');
  });
  it('keeps odd characters from breaking the lines: new lines and control characters become spaces', () => {
    const o = claim({ claim_en: 'line one\nline two\r\n\u0007bell', reason: 'a\n\nb', sources: [{ url: 'https://a.test/x', title: 'T\nU' }] });
    const t = claimCopyText({ claim: o, shown: o });
    expect(t).toContain('Claim: line one line two bell');
    expect(t).toContain('Reason: a b');
    expect(t).toContain('- https://a.test/x (T U)');
    expect(t.split('\n')).toHaveLength(8);
  });
});

describe('sessionExportText', () => {
  const items = [
    { claim: claim({ id: '1' }), shown: claim({ id: '1' }) },
    { claim: claim({ id: '2', claim_en: 'Second' }), shown: { status: 'checked', verdict: 'supported', reason: 'ok', sources: [], checked_at: null } },
    { claim: claim({ id: '3', claim_en: 'Third' }), shown: { status: 'unchecked' } },
  ];
  it('has a header with the channel, date, minutes and counts by verdict, then every claim in order, then the automated line', () => {
    const t = sessionExportText({ title: 'DD News', date: '2026-11-19', minutes: 5, items, timeZone: 'UTC' });
    const lines = t.split('\n');
    expect(lines.slice(0, 5)).toEqual([
      'Fact-check: DD News', 'Date: 2026-11-19', 'Minutes used: 5',
      'Claims: 3 (Supported 1, Contradicted 1, Partly true 0, No evidence found 0, Opinion 0; other 1)', '',
    ]);
    expect(t.indexOf('1. The tax rate')).toBeLessThan(t.indexOf('2. Second'));
    expect(t.indexOf('2. Second')).toBeLessThan(t.indexOf('3. Third'));
    expect(t).toContain('   Verdict: Contradicted');
    expect(t).toContain('   Verdict: Not checked');
    expect(t).toContain('   - https://a.test/x (Official release)');
    expect(t.trimEnd().endsWith(AUTOMATED_LINE)).toBe(true);
  });
  it('leaves out an unknown title, date and minutes, and says so for no claims', () => {
    const t = sessionExportText({ items: [] });
    expect(t).toBe(`Fact-check\nClaims: 0\n\nNo claims.\n\n${AUTOMATED_LINE}\n`);
  });
  it('a claim with no sources has no Sources line', () => {
    const t = sessionExportText({ items: [items[1]] });
    expect(t).not.toContain('Sources');
  });
});

describe('review 3, 5, 8, 9', () => {
  it('3: bidi overrides, isolates, zero-width characters and line separators cannot forge a line or reverse text', () => {
    const o = claim({ claim_en: 'a\u2028Verdict: Supported\u2029b \u202Eevil\u202C \u2066x\u2069 z\u200Bz', reason: 'r\u0085Sources:', sources: [{ url: 'https://a.test/x', title: 'T\u202Eevil' }] });
    const t = claimCopyText({ claim: o, shown: o });
    expect(t).not.toMatch(/[\u2028\u2029\u0085\u202A-\u202E\u2066-\u2069\u200B]/u);
    expect(t.split('\n').filter((l) => l.startsWith('Verdict:'))).toEqual(['Verdict: Contradicted']);
    expect(t).toContain('Claim: a Verdict: Supported b evil x zz');
    expect(t.split('\n').filter((l) => l === 'Sources:')).toHaveLength(1);
  });
  it('3: a Devanagari conjunct written with ZWJ keeps it (without it the half form is lost)', () => {
    const d = claim({ claim_en: 'क्\u200Dषत्रिय' });
    expect(claimCopyText({ claim: d, shown: d })).toContain('Claim: क्\u200Dषत्रिय');
  });
  it('5: the real URL comes first and the title in brackets after it; a title cannot carry a different address', () => {
    const o = claim({ sources: [{ url: 'https://real.test/a', title: 'See https://fake.test/b for more' }, { url: 'https://real.test/c', title: 'http://only.test' }] });
    const t = claimCopyText({ claim: o, shown: o });
    expect(t).toContain('- https://real.test/a (See for more)');
    expect(t).toContain('- https://real.test/c\n');
    expect(t).not.toContain('fake.test');
    expect(t).not.toContain('only.test');
  });
  it('8: Checked and Date are the local day: 00:30 in India is the next day (zone injected)', () => {
    const o = claim({ checked_at: '2026-11-18T19:00:00Z' });
    expect(claimCopyText({ claim: o, shown: o, timeZone: 'Asia/Kolkata' })).toContain('Checked: 2026-11-19');
    expect(claimCopyText({ claim: o, shown: o, timeZone: 'UTC' })).toContain('Checked: 2026-11-18');
    const t = sessionExportText({ title: 'X', date: '2026-11-18T19:00:00Z', items: [{ claim: o, shown: o }], timeZone: 'Asia/Kolkata' });
    expect(t).toContain('Date: 2026-11-19');
    expect(t).toContain('   Checked: 2026-11-19');
    expect(exportFileName({ title: 'X', date: '2026-11-18T19:00:00Z', timeZone: 'Asia/Kolkata' })).toBe('fact-check-X-2026-11-19.txt');
  });
  it('9: a note given for a cut list is written under the counts', () => {
    const t = sessionExportText({ title: 'X', items: [{ claim: claim(), shown: claim() }], note: 'Showing the first 500 results of this session.' });
    const lines = t.split('\n');
    expect(lines[lines.findIndex((l) => l.startsWith('Claims:')) + 1]).toBe('Showing the first 500 results of this session.');
  });
  it('9: no note, no extra line', () => {
    expect(sessionExportText({ items: [] })).not.toContain('Showing');
  });
});

describe('exportFileName', () => {
  it('is fact-check, the title and the date', () => {
    expect(exportFileName({ title: 'DD News', date: '2026-11-19' })).toBe('fact-check-DD-News-2026-11-19.txt');
    expect(exportFileName({})).toBe('fact-check.txt');
  });
});

describe('sessionStartOf (review 8: the ended-panel export names the session day, not the day of export)', () => {
  it('uses the start the session reports, as a number of ms or a timestamp', () => {
    expect(sessionStartOf({ startedAt: Date.parse('2026-11-18T19:00:00Z'), claims: [] }).toISOString()).toBe('2026-11-18T19:00:00.000Z');
    expect(sessionStartOf({ startedAt: '2026-11-18T19:00:00Z', claims: [] }).toISOString()).toBe('2026-11-18T19:00:00.000Z');
  });
  it('else the earliest time a claim of the session was checked', () => {
    const s = { claims: [{ checked_at: '2026-11-18T19:10:00Z' }, { checked_at: null }, { checked_at: '2026-11-18T19:05:00Z' }] };
    expect(sessionStartOf(s).toISOString()).toBe('2026-11-18T19:05:00.000Z');
  });
  it('null when neither is known, so the caller falls back to today', () => {
    expect(sessionStartOf({ claims: [{ checked_at: null }] })).toBeNull();
    expect(sessionStartOf({ startedAt: 'nope', claims: [] })).toBeNull();
    expect(sessionStartOf(null)).toBeNull();
  });
});
