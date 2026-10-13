import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COVERAGE_TTL_MS, coverageOf, documentModules, indexedDocumentKeys, recheckCoverage, refreshCoverage, resetCoverageCache, webDefaultFor } from './corpusCoverage.js';

/** A Supabase query chain that answers with `rows`, recording what it was asked. */
function client(rows, { error = null, calls = [] } = {}) {
  return {
    calls,
    from() {
      const chain = {
        select: () => chain,
        in(_col, keys) { calls.push([...keys]); return chain; },
        not: () => Promise.resolve({ data: rows, error }),
      };
      return chain;
    },
  };
}

beforeEach(() => resetCoverageCache());

it('answers with the keys that have indexed text, and nothing for the rest', async () => {
  const db = client([{ document_key: 'bill:2021:116' }]);
  const found = await indexedDocumentKeys(['bill:2021:116', 'bill:2026:153'], db);
  expect([...found]).toEqual(['bill:2021:116']);
  expect(coverageOf({ document_key: 'bill:2021:116' }, found)).toBe('full');
  expect(coverageOf({ document_key: 'bill:2026:153' }, found)).toBe('row');
});

it('asks once per key: a second call queries only what it has not already answered', async () => {
  const calls = [];
  const db = client([{ document_key: 'a' }], { calls });
  await indexedDocumentKeys(['a', 'b'], db);
  await indexedDocumentKeys(['a', 'b'], db);
  expect(calls).toEqual([['a', 'b']]);
  const third = await indexedDocumentKeys(['a', 'b', 'c'], db);
  expect(calls[1]).toEqual(['c']);
  expect([...third]).toEqual(['a']);
});

// "No full text" is a claim about the corpus. A failed request is not evidence
// for it, and a chip that says "Record only" because the network blinked is
// worse than a chip that says nothing.
it('a failed lookup says nothing rather than saying no', async () => {
  const db = client(null, { error: { message: 'network' } });
  const found = await indexedDocumentKeys(['bill:2026:153'], db);
  expect(found.size).toBe(0);
  expect(coverageOf({ document_key: 'bill:2026:153' }, found)).toBe(null);
});

it('an attachment with no key, and an unresolved lookup, both show nothing', async () => {
  const found = await indexedDocumentKeys([], client([]));
  expect(coverageOf({ title: 'A dropped file' }, found)).toBe(null);
  expect(coverageOf({ document_key: 'bill:2026:153' }, null)).toBe(null);
});

it('blank and duplicate keys are never sent to the database', async () => {
  const calls = [];
  const db = client([], { calls });
  await indexedDocumentKeys(['a', 'a', '', '   ', null, undefined], db);
  expect(calls).toEqual([['a']]);
  const none = vi.fn();
  await indexedDocumentKeys([], { from: none });
  expect(none).not.toHaveBeenCalled();
});

// A document chip names a document the reader just opened from a citation, so
// it is in the corpus by construction; there is no key to look up.
it('a document chip is full text without a lookup', () => {
  expect(coverageOf({ kind: 'document', document_id: 'd1', title: 'T' }, null)).toBe('full');
  expect(coverageOf({ kind: 'document', document_id: 'd1', title: 'T' }, new Set())).toBe('full');
  // Without an id it names nothing.
  expect(coverageOf({ kind: 'document', title: 'T' }, new Set())).toBe(null);
});

// ─── D9: answers expire, and an attach re-checks (plan C3) ───────────────────
//
// An admin can now link, unlink and delete documents (Amendment A), so "this
// key has no full text" is no longer true for the whole session. A clock is
// passed in so the lifetime is tested without waiting.

describe('answer lifetime', () => {
  /** A clock the test moves by hand. */
  function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = (ms) => { t += ms; };
    return now;
  }

  /** A database whose answer the test can change between calls. */
  function liveClient(calls = []) {
    const db = { rows: [], fail: false };
    db.client = {
      from() {
        const chain = {
          select: () => chain,
          in(_col, keys) { calls.push([...keys]); return chain; },
          not: () => Promise.resolve(db.fail ? { data: null, error: { message: 'network' } } : { data: db.rows, error: null }),
        };
        return chain;
      },
    };
    return db;
  }

  it('is a minute', () => {
    expect(COVERAGE_TTL_MS).toBe(60_000);
  });

  it('a fresh answer is reused: no second query inside the lifetime', async () => {
    const calls = [];
    const db = liveClient(calls);
    const now = clock();
    await indexedDocumentKeys(['a'], db.client, now);
    now.advance(COVERAGE_TTL_MS - 1);
    db.rows = [{ document_key: 'a' }];
    const found = await indexedDocumentKeys(['a'], db.client, now);
    expect(calls).toEqual([['a']]);
    expect([...found]).toEqual([]);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe('row');
  });

  it('an expired answer is asked again, and only the expired keys are', async () => {
    const calls = [];
    const db = liveClient(calls);
    const now = clock();
    await indexedDocumentKeys(['a'], db.client, now);
    now.advance(30_000);
    await indexedDocumentKeys(['a', 'b'], db.client, now);
    now.advance(COVERAGE_TTL_MS - 30_000);
    db.rows = [{ document_key: 'a' }];
    const found = await indexedDocumentKeys(['a', 'b'], db.client, now);
    expect(calls).toEqual([['a'], ['b'], ['a']]);
    expect([...found]).toEqual(['a']);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe('full');
  });

  // Supervisor decision (C3 review): a badge keeps its last answer while a re-check is due, rather
  // than going blank every minute; the panel's periodic re-query (C4) replaces it.
  it('an expired "no" keeps showing "Record only" until it is asked again', async () => {
    const db = liveClient();
    const now = clock();
    const found = await indexedDocumentKeys(['a'], db.client, now);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe('row');
    now.advance(COVERAGE_TTL_MS * 3);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe('row');
  });

  // The panel re-checks every COVERAGE_TTL_MS. Timers drift, so the last answer is often a few
  // milliseconds short of its lifetime when the tick fires; a re-check that skipped "fresh" answers
  // then waited a whole extra minute (C5: a re-link showed after more than 90 s).
  it('recheckCoverage asks about every key again, even an answer a few ms short of its lifetime', async () => {
    const calls = [];
    const db = liveClient(calls);
    const now = clock();
    await indexedDocumentKeys(['a', 'b'], db.client, now);
    db.rows = [{ document_key: 'a' }];
    now.advance(COVERAGE_TTL_MS - 10);
    const found = await recheckCoverage(['a', 'b'], db.client, now);
    expect(calls).toEqual([['a', 'b'], ['a', 'b']]);
    expect([...found]).toEqual(['a']);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe('full');
    expect(coverageOf({ document_key: 'b' }, found, now)).toBe('row');
  });

  it('a failed recheckCoverage keeps the last answers, whatever their age', async () => {
    const db = liveClient();
    const now = clock();
    db.rows = [{ document_key: 'a' }];
    await indexedDocumentKeys(['a', 'b'], db.client, now);
    db.fail = true;
    now.advance(COVERAGE_TTL_MS * 2);
    const found = await recheckCoverage(['a', 'b'], db.client, now);
    expect([...found]).toEqual(['a']);
    expect(coverageOf({ document_key: 'b' }, found, now)).toBe('row');
  });

  it('refreshCoverage asks again now, even inside the lifetime, and answers the new set', async () => {
    const calls = [];
    const db = liveClient(calls);
    const now = clock();
    await indexedDocumentKeys(['a', 'b'], db.client, now);
    now.advance(1_000);
    db.rows = [{ document_key: 'b' }];
    const found = await refreshCoverage(['b', 'b', ' '], db.client, now);
    expect(calls).toEqual([['a', 'b'], ['b']]);
    expect([...found]).toEqual(['b']);
    expect(coverageOf({ document_key: 'b' }, found, now)).toBe('full');
    // The refreshed answer then lives its own minute; the untouched one keeps its own.
    const again = await indexedDocumentKeys(['a', 'b'], db.client, now);
    expect(calls).toHaveLength(2);
    expect([...again]).toEqual(['b']);
  });

  it('refreshCoverage turns a stale "full" into "row" when the link is gone', async () => {
    const db = liveClient();
    const now = clock();
    db.rows = [{ document_key: 'a' }];
    await indexedDocumentKeys(['a'], db.client, now);
    db.rows = [];
    const found = await refreshCoverage(['a'], db.client, now);
    expect(found.size).toBe(0);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe('row');
  });

  it('a failed refresh answers nothing rather than keeping or inventing an answer', async () => {
    const db = liveClient();
    const now = clock();
    await indexedDocumentKeys(['a'], db.client, now);
    expect(coverageOf({ document_key: 'a' }, new Set(), now)).toBe('row');
    db.fail = true;
    const found = await refreshCoverage(['a'], db.client, now);
    expect(found.size).toBe(0);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe(null);
  });

  it('a failed re-query of an expired key answers nothing', async () => {
    const db = liveClient();
    const now = clock();
    db.rows = [{ document_key: 'a' }];
    await indexedDocumentKeys(['a'], db.client, now);
    now.advance(COVERAGE_TTL_MS);
    db.fail = true;
    const found = await indexedDocumentKeys(['a'], db.client, now);
    expect(found.size).toBe(0);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe(null);
  });

  // A lookup started before the refresh must not land after it and put the
  // old answer back.
  it('an older lookup that answers late does not overwrite a newer refresh', async () => {
    const now = clock();
    let release;
    const slowRows = new Promise((resolve) => { release = resolve; });
    const slow = {
      from() {
        const chain = { select: () => chain, in: () => chain, not: () => slowRows };
        return chain;
      },
    };
    const late = indexedDocumentKeys(['a'], slow, now);
    now.advance(10);
    const db = liveClient();
    db.rows = [{ document_key: 'a' }];
    await refreshCoverage(['a'], db.client, now);
    release({ data: [], error: null });
    await late;
    const found = await indexedDocumentKeys(['a'], db.client, now);
    expect([...found]).toEqual(['a']);
    expect(coverageOf({ document_key: 'a' }, found, now)).toBe('full');
  });

  it('refreshCoverage with no keys asks nothing', async () => {
    const none = vi.fn();
    const found = await refreshCoverage([], { from: none });
    expect(found.size).toBe(0);
    expect(none).not.toHaveBeenCalled();
  });
});


// F130 T4a: the globe's prediction (web-search spec §1, §6). It mirrors the server's rule, so the
// reader sees in advance what the turn will do.
describe('documentModules', () => {
  const rpcClient = (results, calls = []) => ({ calls, rpc: (name) => { calls.push(name); const next = results.shift(); return Promise.resolve(next); } });
  const rows = [{ desk_tier: 'National', desk_feature: 'Bills' }, { desk_tier: 'Global', desk_feature: 'Treaties' }];

  it('calls the document_modules RPC once and caches the answer', async () => {
    const db = rpcClient([{ data: rows, error: null }]);
    expect(await documentModules(db)).toEqual(rows);
    expect(await documentModules(db)).toEqual(rows);
    expect(db.calls).toEqual(['document_modules']);
  });

  it('a failure returns null and is not cached, so the next call asks again', async () => {
    const db = rpcClient([{ data: null, error: { message: 'offline' } }, { data: rows, error: null }]);
    expect(await documentModules(db)).toBe(null);
    expect(await documentModules(db)).toEqual(rows);
    expect(db.calls).toHaveLength(2);
  });

  it('a thrown request is a failure too, and rows without a tier and feature are dropped', async () => {
    const throwing = { rpc: () => Promise.reject(new Error('network')) };
    expect(await documentModules(throwing)).toBe(null);
    const db = rpcClient([{ data: [...rows, { desk_tier: 'National' }, null, { desk_tier: '', desk_feature: 'x' }], error: null }]);
    expect(await documentModules(db)).toEqual(rows);
  });

  it('with no client it answers null', async () => {
    expect(await documentModules(null)).toBe(null);
  });

  it('resetCoverageCache forgets the modules', async () => {
    const db = rpcClient([{ data: rows, error: null }, { data: [], error: null }]);
    await documentModules(db);
    resetCoverageCache();
    expect(await documentModules(db)).toEqual([]);
    expect(db.calls).toHaveLength(2);
  });
});

describe('webDefaultFor', () => {
  const modules = [{ desk_tier: 'National', desk_feature: 'Bills' }];
  const indexedKeys = new Set(['bill:2026:153']);
  const row = (document_key) => ({ kind: 'row', title: 'A row', ...(document_key ? { document_key } : {}) });

  it('broad focus is off', () => {
    expect(webDefaultFor({ focus: 'broad', attachments: [row()], indexedKeys, deskContext: null, modules })).toEqual({ on: false, reason: 'broad' });
  });

  it.each(['attached', 'selection'])('%s: a row without a document key is on', (focus) => {
    expect(webDefaultFor({ focus, attachments: [row()], indexedKeys, modules })).toEqual({ on: true, reason: 'record-without-document' });
  });

  it('a record whose key is not indexed is on; a record whose key is indexed is off', () => {
    expect(webDefaultFor({ focus: 'attached', attachments: [row('bill:2026:999')], indexedKeys, modules })).toEqual({ on: true, reason: 'record-without-document' });
    expect(webDefaultFor({ focus: 'attached', attachments: [{ kind: 'record', document_key: 'bill:2026:999' }], indexedKeys, modules })).toEqual({ on: true, reason: 'record-without-document' });
    expect(webDefaultFor({ focus: 'attached', attachments: [row('bill:2026:153')], indexedKeys, modules })).toEqual({ on: false, reason: 'documents-in-scope' });
  });

  it('one record without a document is enough, among records that have one', () => {
    expect(webDefaultFor({ focus: 'attached', attachments: [row('bill:2026:153'), row()], indexedKeys, modules })).toEqual({ on: true, reason: 'record-without-document' });
  });

  it('a document attachment is indexed by construction', () => {
    expect(webDefaultFor({ focus: 'attached', attachments: [{ kind: 'document', document_id: 'd1' }], indexedKeys: null, modules })).toEqual({ on: false, reason: 'documents-in-scope' });
  });

  it('an uploaded file is not a record: only files, or nothing attached, is no-record', () => {
    expect(webDefaultFor({ focus: 'attached', attachments: [{ kind: 'file', title: 'f.pdf' }], indexedKeys, modules })).toEqual({ on: false, reason: 'no-record' });
    expect(webDefaultFor({ focus: 'attached', attachments: [], indexedKeys, modules })).toEqual({ on: false, reason: 'no-record' });
    expect(webDefaultFor({ focus: 'selection', attachments: [{ kind: 'feature', title: 'Bills' }], indexedKeys, modules })).toEqual({ on: false, reason: 'no-record' });
  });

  it('a file beside an indexed record leaves the record to decide', () => {
    expect(webDefaultFor({ focus: 'attached', attachments: [{ kind: 'file' }, row('bill:2026:153')], indexedKeys, modules })).toEqual({ on: false, reason: 'documents-in-scope' });
  });

  it('a keyed record whose coverage has not answered yet is unknown: off, with no reason', () => {
    expect(webDefaultFor({ focus: 'attached', attachments: [row('bill:2026:153')], indexedKeys: null, modules })).toEqual({ on: false, reason: null });
    // A record that definitely has no document is on whatever the lookup says.
    expect(webDefaultFor({ focus: 'attached', attachments: [row('bill:2026:153'), row()], indexedKeys: null, modules })).toEqual({ on: true, reason: 'record-without-document' });
  });

  it('desk focus follows the open module', () => {
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: null, modules })).toEqual({ on: false, reason: 'no-record' });
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: { tier: 'National' }, modules })).toEqual({ on: false, reason: 'no-record' });
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: { tier: 'National', feature: 'Bills' }, modules })).toEqual({ on: false, reason: 'documents-in-scope' });
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: { tier: 'National', feature: 'Orders' }, modules })).toEqual({ on: true, reason: 'module-without-documents' });
    // Module names repeat across tiers: the pair decides.
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: { tier: 'Global', feature: 'Bills' }, modules })).toEqual({ on: true, reason: 'module-without-documents' });
  });

  it('desk focus matches names the way the server does: case and punctuation do not matter', () => {
    const catalogue = [{ desk_tier: 'National', desk_feature: 'Regulatory (RBI SEBI TRAI CCI)' }];
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: { tier: 'national', feature: 'Regulatory (RBI/SEBI/TRAI/CCI)' }, modules: catalogue })).toEqual({ on: false, reason: 'documents-in-scope' });
  });

  it('desk focus with the module list unknown is off, with no reason', () => {
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: { tier: 'National', feature: 'Bills' }, modules: null })).toEqual({ on: false, reason: null });
    expect(webDefaultFor({ focus: 'desk', attachments: [], indexedKeys, deskContext: null, modules: null })).toEqual({ on: false, reason: 'no-record' });
  });

  it('desk focus ignores attachments, as the server does', () => {
    expect(webDefaultFor({ focus: 'desk', attachments: [row()], indexedKeys, deskContext: { tier: 'National', feature: 'Bills' }, modules })).toEqual({ on: false, reason: 'documents-in-scope' });
  });
});
