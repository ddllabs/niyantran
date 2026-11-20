// B2: the pure helpers of transcript search, copy and download.
import { describe, expect, it, vi } from 'vitest';
import {
  buildTranscriptText, cleanLine, copyToClipboard, dateStamp, downloadTextFile, highlightParts, matchLines, transcriptFileName,
} from './transcriptTools.js';

const lines = [
  { key: 1, time: '00:05', text: 'Good evening and welcome' },
  { key: 2, time: '00:12', text: 'The GDP grew by 7 percent' },
  { key: 3, time: '00:20', text: 'सरकार ने कहा कि विकास दर बढ़ी है' },
];

describe('matchLines', () => {
  it('returns every line for an empty or blank phrase', () => {
    expect(matchLines(lines, '')).toBe(lines);
    expect(matchLines(lines, '   ')).toBe(lines);
  });
  it('matches without regard to case', () => {
    expect(matchLines(lines, 'gdp').map((l) => l.key)).toEqual([2]);
    expect(matchLines(lines, 'GOOD EVENING').map((l) => l.key)).toEqual([1]);
  });
  it('matches Devanagari, including a composed and a decomposed spelling of the same letters', () => {
    expect(matchLines(lines, 'विकास').map((l) => l.key)).toEqual([3]);
    expect(matchLines(lines, 'बढ़ी'.normalize('NFD')).map((l) => l.key)).toEqual([3]);
  });
  it('treats characters that mean something in a pattern as plain text', () => {
    const odd = [{ key: 1, text: 'cost (approx.) is 5+5' }, { key: 2, text: 'cost approx is 55' }];
    expect(matchLines(odd, '(approx.)').map((l) => l.key)).toEqual([1]);
    expect(matchLines(odd, '5+5').map((l) => l.key)).toEqual([1]);
    expect(() => matchLines(odd, '[')).not.toThrow();
  });
  it('a run of spaces in the phrase matches any run of spaces in the line', () => {
    expect(matchLines(lines, 'good   evening').map((l) => l.key)).toEqual([1]);
  });
  it('returns nothing when no line matches', () => {
    expect(matchLines(lines, 'zzz')).toEqual([]);
  });
});

describe('highlightParts', () => {
  it('splits a line into plain and matching parts, keeping the text as it was written', () => {
    expect(highlightParts('The GDP grew; gdp again', 'gdp')).toEqual([
      { text: 'The ', hit: false }, { text: 'GDP', hit: true }, { text: ' grew; ', hit: false }, { text: 'gdp', hit: true }, { text: ' again', hit: false },
    ]);
  });
  it('is one plain part with no phrase', () => {
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', hit: false }]);
  });
  it('works for Devanagari', () => {
    const parts = highlightParts(lines[2].text, 'विकास');
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['विकास']);
    expect(parts.map((p) => p.text).join('')).toBe(lines[2].text.normalize('NFC'));
  });
});

describe('dateStamp', () => {
  it('a date alone is kept as it is', () => {
    expect(dateStamp('2026-11-19')).toBe('2026-11-19');
  });
  it('a time is read as the LOCAL day of the zone given (review 8): just after midnight in India is the next day', () => {
    expect(dateStamp('2026-11-18T19:00:00Z', 'Asia/Kolkata')).toBe('2026-11-19'); // 00:30 IST
    expect(dateStamp('2026-11-18T18:29:00Z', 'Asia/Kolkata')).toBe('2026-11-18'); // 23:59 IST
    expect(dateStamp('2026-11-18T19:00:00Z', 'UTC')).toBe('2026-11-18');
    expect(dateStamp(new Date('2026-11-18T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-19');
  });
  it('uses the runtime zone when none is given', () => {
    const d = new Date(2026, 10, 19, 23, 30); // local time
    expect(dateStamp(d)).toBe('2026-11-19');
    expect(dateStamp(d.toISOString())).toBe('2026-11-19');
  });
  it('is empty for anything else', () => {
    expect(dateStamp(null)).toBe('');
    expect(dateStamp('not a date')).toBe('');
    expect(dateStamp(new Date('nope'))).toBe('');
  });
});

describe('cleanLine (review 3 and 4)', () => {
  it('turns new lines and control characters into single spaces', () => {
    expect(cleanLine('a\nb\r\n\u0007c\td')).toBe('a b c d');
  });
  it('removes bidi overrides and isolates, so a line or URL cannot be reversed', () => {
    expect(cleanLine('see \u202Egpj.exe\u202C now \u2066x\u2069')).toBe('see gpj.exe now x');
  });
  it('removes zero-width and other format characters, and a BOM', () => {
    expect(cleanLine('a\u200Bb\u2060c\uFEFFd')).toBe('abcd');
  });
  it('turns line and paragraph separators and NEL into spaces', () => {
    expect(cleanLine('a\u2028b\u2029c\u0085d')).toBe('a b c d');
  });
  it('keeps ZWJ and ZWNJ between letters, where Devanagari and Persian need them', () => {
    const conjunct = 'क्\u200Dष'; // ka + virama + ZWJ + ssa
    expect(cleanLine(conjunct)).toBe(conjunct);
    expect(cleanLine(conjunct)).not.toBe('क्ष');
    expect(cleanLine('می\u200Cخواهم')).toBe('می\u200Cخواهم');
  });
  it('drops ZWJ and ZWNJ anywhere else: at the ends, after a space, next to a symbol or digit', () => {
    expect(cleanLine('\u200Dab\u200C')).toBe('ab');
    expect(cleanLine('a \u200Db')).toBe('a b');
    expect(cleanLine('1\u200D2')).toBe('12');
    expect(cleanLine('a\u200D\u200Db')).toBe('ab');
  });
  it('is empty for nothing, and normalises composed text', () => {
    expect(cleanLine(null)).toBe('');
    expect(cleanLine('e\u0301')).toBe('\u00e9');
  });
});

describe('buildTranscriptText', () => {
  it('writes the title, the date, a blank line and the lines in order with their time marks', () => {
    expect(buildTranscriptText({ title: 'DD News', date: '2026-11-19', lines })).toBe([
      'DD News', '2026-11-19', '', '[00:05] Good evening and welcome', '[00:12] The GDP grew by 7 percent', '[00:20] सरकार ने कहा कि विकास दर बढ़ी है', '',
    ].join('\n'));
  });
  it('leaves out the title and the date when they are not known, and the mark of a line that has none', () => {
    expect(buildTranscriptText({ lines: [{ key: 1, text: 'one' }, { key: 2, time: '00:01', text: 'two' }] })).toBe('one\n[00:01] two\n');
  });
  it('can leave out the header (for the clipboard)', () => {
    expect(buildTranscriptText({ title: 'X', date: '2026-11-19', lines: [lines[0]], header: false })).toBe('[00:05] Good evening and welcome\n');
  });
});

describe('buildTranscriptText cleans what it writes (review 4)', () => {
  it('a line holding a new line cannot forge a time-marked line, and the title cannot add lines', () => {
    const t = buildTranscriptText({ title: 'DD\n[00:99] forged', date: '2026-11-19', lines: [{ time: '00:05', text: 'real\n[00:59] forged' }] });
    expect(t.split('\n')).toEqual(['DD [00:99] forged', '2026-11-19', '', '[00:05] real [00:59] forged', '']);
  });
  it('the date is the day in the zone given', () => {
    const t = buildTranscriptText({ title: 'X', date: '2026-11-18T19:00:00Z', timeZone: 'Asia/Kolkata', lines: [] });
    expect(t.split('\n')[1]).toBe('2026-11-19');
  });
});

describe('transcriptFileName', () => {
  it('is the title and the date, safe for a file system', () => {
    expect(transcriptFileName({ title: 'DD News: Live / 9 pm', date: '2026-11-19' })).toBe('transcript-DD-News-Live-9-pm-2026-11-19.txt');
  });
  it('keeps Devanagari letters and marks', () => {
    expect(transcriptFileName({ title: 'आज तक', date: '2026-11-19' })).toBe('transcript-आज-तक-2026-11-19.txt');
  });
  it('falls back to a plain name', () => {
    expect(transcriptFileName({})).toBe('transcript.txt');
    expect(transcriptFileName({ title: '///', date: '' })).toBe('transcript.txt');
  });
  it('keeps a long title short', () => {
    expect(transcriptFileName({ title: 'a'.repeat(300), date: '2026-11-19' }).length).toBeLessThan(100);
  });
  it('cuts a long title by whole characters, never inside one (review 6)', () => {
    const name = transcriptFileName({ title: 'क'.repeat(59) + '𠮷𠮷𠮷', date: '2026-11-19' });
    expect(name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect([...name.slice('transcript-'.length)].length).toBeLessThanOrEqual(60 + '-2026-11-19.txt'.length);
    const astral = transcriptFileName({ title: '𠮷'.repeat(80), date: '' });
    expect([...astral].length).toBe('transcript-'.length + 60 + '.txt'.length);
  });
  it('names the day in the zone given (review 8)', () => {
    expect(transcriptFileName({ title: 'X', date: '2026-11-18T19:00:00Z', timeZone: 'Asia/Kolkata' })).toBe('transcript-X-2026-11-19.txt');
  });
});

describe('copyToClipboard', () => {
  it('reports ok when the browser accepts the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyToClipboard('hello', { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });
  it('reports a refusal, a missing clipboard, and a throw, without throwing', async () => {
    expect(await copyToClipboard('x', { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).toBe(false);
    expect(await copyToClipboard('x', { writeText: () => { throw new Error('sync'); } })).toBe(false);
    expect(await copyToClipboard('x', undefined)).toBe(false);
    expect(await copyToClipboard('x', {})).toBe(false);
  });
});

describe('downloadTextFile', () => {
  const env = () => {
    const a = { click: vi.fn(), remove: vi.fn(), style: {}, set href(v) { this._h = v; }, get href() { return this._h; } };
    const body = { appendChild: vi.fn() };
    const Blob = vi.fn(function Blob(parts, opts) { this.parts = parts; this.opts = opts; });
    return {
      a, body, Blob,
      doc: { createElement: vi.fn(() => a), body },
      url: { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() },
    };
  };
  it('makes a plain-text file in the browser and clicks a link to it', () => {
    const e = env();
    expect(downloadTextFile('t.txt', 'hello', { document: e.doc, URL: e.url, Blob: e.Blob })).toBe(true);
    expect(e.Blob).toHaveBeenCalledWith(['hello'], { type: 'text/plain;charset=utf-8' });
    expect(e.a.download).toBe('t.txt');
    expect(e.a.href).toBe('blob:x');
    expect(e.a.click).toHaveBeenCalledTimes(1);
  });
  it('reports a failure instead of throwing', () => {
    const e = env();
    e.url.createObjectURL = () => { throw new Error('no'); };
    expect(downloadTextFile('t.txt', 'x', { document: e.doc, URL: e.url, Blob: e.Blob })).toBe(false);
    expect(downloadTextFile('t.txt', 'x', {})).toBe(false);
  });
});
