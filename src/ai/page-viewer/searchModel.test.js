import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_QUERY, SEARCH_DEBOUNCE_MS, createSearchRunner, foldQuery, layerMatches, matchLabel, matchList, recognisedOnly,
  snippetEdges, snippetParts, startMatch, stepMatch,
} from './searchModel.js';

describe('foldQuery', () => {
  it('folds as the database does: Markdown marks and spacing to one space, trimmed, lower case', () => {
    expect(foldQuery('  The   **Accused**\n person ')).toBe('the accused person');
    expect(foldQuery('Section_11 | `Act`')).toBe('section 11 act');
  });

  it(`is empty under ${MIN_QUERY} characters, so nothing is searched`, () => {
    expect(foldQuery('a')).toBe('');
    expect(foldQuery(' * a _ ')).toBe('');
    expect(foldQuery('ab')).toBe('ab');
  });

  it('folds as migration 43 does: every Unicode space JavaScript\'s \\s matches, and NFC (क़ precomposed becomes क + ◌़)', () => {
    expect(foldQuery('pay\u00a0the\u2003duty\u202fnow')).toBe('pay the duty now');
    expect(foldQuery('\u0958\u093e\u0928\u0942\u0928')).toBe('\u0915\u093c\u093e\u0928\u0942\u0928');
    expect(layerMatches([{ str: 'pay\u00a0the duty', hasEOL: false }], foldQuery('pay the'))).toHaveLength(1);
  });

  it('lower-cases as the database does (en_US.UTF-8): dotted İ to i, and Σ to σ even at a word\'s end', () => {
    expect(foldQuery('İSTANBUL ΟΔΟΣ')).toBe('istanbul οδοσ');
    expect(layerMatches([{ str: 'İstanbul and ΟΔΟΣ', hasEOL: false }], foldQuery('istanbul'))).toEqual([{ startItem: 0, startOffset: 0, endItem: 0, endOffset: 8 }]);
    expect(layerMatches([{ str: 'İstanbul and ΟΔΟΣ', hasEOL: false }], foldQuery('οδοσ'))).toEqual([{ startItem: 0, startOffset: 13, endItem: 0, endOffset: 17 }]);
  });

  it('keeps Hindi as typed, composed', () => {
    expect(foldQuery('राष्ट्रीय  खेल')).toBe('राष्ट्रीय खेल'.normalize('NFC'));
  });

  it('is cut at 200 characters, as the database cuts it', () => {
    expect(foldQuery('x'.repeat(250))).toHaveLength(200);
  });
});

describe('layerMatches', () => {
  // pdf.js items: one line per item here, with the line ends it reports.
  const items = [
    { str: 'The accused was found in', hasEOL: true },
    { str: 'possession of the ACCUSED', hasEOL: false },
    { str: "'s papers; an accused", hasEOL: true },
    { str: 'person.', hasEOL: false },
  ];

  it('finds every occurrence, case-insensitively, as item and offset pairs', () => {
    expect(layerMatches(items, 'accused')).toEqual([
      { startItem: 0, startOffset: 4, endItem: 0, endOffset: 11 },
      { startItem: 1, startOffset: 18, endItem: 1, endOffset: 25 },
      { startItem: 2, startOffset: 14, endItem: 2, endOffset: 21 },
    ]);
  });

  it('matches across a line end as across one space', () => {
    expect(layerMatches(items, 'found in possession')).toEqual([{ startItem: 0, startOffset: 16, endItem: 1, endOffset: 10 }]);
    expect(layerMatches(items, 'accused person')).toEqual([{ startItem: 2, startOffset: 14, endItem: 3, endOffset: 6 }]);
  });

  it('joins items on one line without inventing a space', () => {
    expect(layerMatches(items, "accused's")).toEqual([{ startItem: 1, startOffset: 18, endItem: 2, endOffset: 2 }]);
  });

  it('treats runs of spacing and Markdown marks in the layer as one space', () => {
    expect(layerMatches([{ str: 'Clause   *11*  of', hasEOL: false }], 'clause 11 of')).toEqual([{ startItem: 0, startOffset: 0, endItem: 0, endOffset: 17 }]);
  });

  it('counts as the database does: occurrences do not overlap', () => {
    expect(layerMatches([{ str: 'aaaa', hasEOL: false }], 'aa')).toHaveLength(2);
  });

  it('finds nothing for an empty query or layer', () => {
    expect(layerMatches(items, '')).toEqual([]);
    expect(layerMatches([], 'accused')).toEqual([]);
  });
});

describe('matches', () => {
  const pages = [{ page: 3, hits: 2, snippets: [] }, { page: 8, hits: 1, snippets: [] }, { page: 11, hits: 3, snippets: [] }];

  it('lists every match in page order, each as its page and its index on that page', () => {
    expect(matchList(pages).map(m => `${m.page}.${m.index}`)).toEqual(['3.0', '3.1', '8.0', '11.0', '11.1', '11.2']);
  });

  it('starts at the first match on or after the reader\'s page, else the first', () => {
    const list = matchList(pages);
    expect(startMatch(list, 8)).toBe(2);
    expect(startMatch(list, 9)).toBe(3);
    expect(startMatch(list, 12)).toBe(0);
    expect(startMatch([], 4)).toBe(-1);
  });

  it('steps forward and back, wrapping at either end', () => {
    expect(stepMatch(6, 5, 1)).toBe(0);
    expect(stepMatch(6, 0, -1)).toBe(5);
    expect(stepMatch(6, 2, 1)).toBe(3);
    expect(stepMatch(0, -1, 1)).toBe(-1);
  });

  it('labels the position, the empty result, the wait and a failure', () => {
    expect(matchLabel({ status: 'ok', total: 9, current: 2 })).toBe('3 of 9');
    expect(matchLabel({ status: 'ok', total: 0, current: -1 })).toBe('No matches');
    expect(matchLabel({ status: 'loading', total: 0, current: -1 })).toBe('Searching…');
    expect(matchLabel({ status: 'error', total: 0, current: -1 })).toBe("Couldn't search");
    expect(matchLabel({ status: 'idle', total: 0, current: -1 })).toBe('');
    expect(matchLabel({ status: 'ok', total: 200, current: 0, capped: true })).toBe('1 of 200+');
  });
});

describe('recognisedOnly', () => {
  const match = { page: 7, index: 2 };

  it('is true when the drawn page holds fewer matches than the current one needs', () => {
    expect(recognisedOnly({ match, query: 'act', layer: { query: 'act', count: 2 } })).toBe(true);
    expect(recognisedOnly({ match, query: 'act', layer: { query: 'act', count: 0 } })).toBe(true);
  });

  it('is false while the page is undrawn, once it holds the match, for an earlier query, or without the Highlight API', () => {
    expect(recognisedOnly({ match, query: 'act', layer: undefined })).toBe(false);
    expect(recognisedOnly({ match, query: 'act', layer: { query: 'act', count: 3 } })).toBe(false);
    expect(recognisedOnly({ match, query: 'act', layer: { query: 'ac', count: 0 } })).toBe(false);
    expect(recognisedOnly({ match, query: 'act', layer: { query: 'act', count: null } })).toBe(false);
    expect(recognisedOnly({ match: null, query: 'act', layer: { query: 'act', count: 0 } })).toBe(false);
  });
});

describe('snippetParts', () => {
  it('trims the words the database cut at either end, and splits out each match', () => {
    const parts = snippetParts('cused was found in possession of the accused person and the accused was', 'accused', { cutStart: true, cutEnd: true });
    expect(parts).toEqual([
      { text: '…was found in possession of the ', match: false },
      { text: 'accused', match: true },
      { text: ' person and the ', match: false },
      { text: 'accused', match: true },
      { text: '…', match: false },
    ]);
  });

  it('splits out a match after a dotted İ without shifting it', () => {
    expect(snippetParts('İzmir accused', 'accused', { cutStart: false, cutEnd: false })).toEqual([
      { text: 'İzmir ', match: false },
      { text: 'accused', match: true },
    ]);
  });

  it('keeps an edge the database did not cut', () => {
    expect(snippetParts('Accused persons', 'accused', { cutStart: false, cutEnd: false })).toEqual([
      { text: 'Accused', match: true },
      { text: ' persons', match: false },
    ]);
  });
});

describe('snippetEdges', () => {
  // The database cuts a snippet from 60 characters before its first match to 60 after it, or at the
  // page's start or end where those come first.
  it('a snippet was cut at the start when its first match sits 60 or more characters in', () => {
    const before = 'x'.repeat(60);
    expect(snippetEdges(`${before}accused${'y'.repeat(60)}`, 'accused')).toEqual({ cutStart: true, cutEnd: true });
    expect(snippetEdges(`short accused${'y'.repeat(60)}`, 'accused')).toEqual({ cutStart: false, cutEnd: true });
  });

  it('a snippet reached the page end when fewer than 60 characters follow its first match', () => {
    expect(snippetEdges(`${'x'.repeat(60)}accused tail`, 'accused')).toEqual({ cutStart: true, cutEnd: false });
  });
});

describe('createSearchRunner', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it(`searches ${SEARCH_DEBOUNCE_MS} ms after typing stops, once per settled query`, async () => {
    const search = vi.fn(async ({ query }) => ({ status: 'ok', pages: [{ page: 1, hits: 1, snippets: [query] }] }));
    const results = [];
    const runner = createSearchRunner({ search, onResult: r => results.push(r) });
    runner.run('ac');
    vi.advanceTimersByTime(100);
    runner.run('acc');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(search).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0].query).toBe('acc');
    expect(results.at(-1)).toMatchObject({ query: 'acc', status: 'ok' });
  });

  it('cancels a superseded search, so its late answer is never reported', async () => {
    let release;
    const search = vi.fn(({ query, signal }) => (query === 'first'
      ? new Promise((resolve) => { release = () => resolve(signal.aborted ? { status: 'aborted' } : { status: 'ok', pages: [] }); })
      : Promise.resolve({ status: 'ok', pages: [] })));
    const results = [];
    const runner = createSearchRunner({ search, onResult: r => results.push(r) });
    runner.run('first');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    const firstSignal = search.mock.calls[0][0].signal;
    runner.run('second');
    expect(firstSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    release();
    await vi.runAllTimersAsync();
    expect(results.map(r => r.query)).toEqual(['second']);
  });

  it('reports a cleared query at once, without searching, and stops on cancel', async () => {
    const search = vi.fn(async () => ({ status: 'ok', pages: [] }));
    const results = [];
    const runner = createSearchRunner({ search, onResult: r => results.push(r) });
    runner.run('a');
    expect(results).toEqual([{ query: '', status: 'idle', pages: [] }]);
    runner.run('abc');
    runner.cancel();
    await vi.runAllTimersAsync();
    expect(search).not.toHaveBeenCalled();
  });
});
