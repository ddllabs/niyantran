// B2: the pure helpers of transcript search, copy and download.
import { describe, expect, it, vi } from 'vitest';
import {
  buildTranscriptText, copyToClipboard, dateStamp, downloadTextFile, highlightParts, matchLines, transcriptFileName,
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
  it('reads a calendar date from an ISO string, or the local day of a Date', () => {
    expect(dateStamp('2026-11-19T05:00:00Z')).toBe('2026-11-19');
    expect(dateStamp('2026-11-19')).toBe('2026-11-19');
    expect(dateStamp(new Date(2026, 10, 19, 23, 30))).toBe('2026-11-19');
  });
  it('is empty for anything else', () => {
    expect(dateStamp(null)).toBe('');
    expect(dateStamp('not a date')).toBe('');
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
