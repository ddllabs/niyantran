// F169 phase 4 (C4 follow-up): an answer from the scheduled feed store is fresh, served data. It does
// not carry the green LIVE badge (its header says "updated N min ago"), it is not an archive or a
// stored copy, and the probe and admin counts treat it as live, whatever adapter the live answer had.
import { describe, expect, it } from 'vitest';
import { DATA_STATE, isTerminalState, resolveDataState } from './dataState.js';
import { feedKindLabel } from './normalise.js';
import { checkOutcome } from './refreshFeeds.js';

const FETCHED = new Date(Date.now() - 5 * 60_000).toISOString();
const store = (extra = {}) => ({
  ok: true, tier: 'finance', feature: 'X', served: 'store', fallback: false, fetchedAt: FETCHED,
  rows: [{ title: 'A', date: '2026-10-15' }],
  source: { adapter: 'api', links: [], note: 'Google News topic search.', kind: '' },
  coverage: { from: '', through: '7d', exhaustive: false },
  ...extra,
});

describe('the data state of an answer from the store', () => {
  it('is neither LIVE nor an archive, and shows no badge', () => {
    const state = resolveDataState(store());
    expect(state.id).toBe('served');
    expect(state.id).not.toBe('live');
    expect(state.label).toBe('');
    expect(state.hideBadge).toBe(true);
    expect(feedKindLabel(store())).toBe('');
    expect(isTerminalState(state)).toBe(false);
    expect(DATA_STATE.served.id).toBe('served');
  });

  it('does that whatever adapter the live answer had, and for a curated or packed module too', () => {
    for (const adapter of ['api', 'news-search', 'embedded', 'register', 'source-library']) {
      expect(resolveDataState(store({ source: { adapter, links: [], note: '' } })).id, adapter).toBe('served');
    }
    expect(resolveDataState(store({ source: { adapter: 'api', kind: 'finance-pack', note: 'Live request' } })).id).toBe('served');
    expect(resolveDataState(store({ meta: { curated: true } })).id).toBe('served');
  });

  it('keeps the live answer\'s detail, coverage and no stored-records banner', () => {
    const state = resolveDataState(store());
    expect(state.detail).toBe('Google News topic search.');
    expect(state.coverage).toBe('1 records · through 7d');
    expect(state.fallback).toBeUndefined();
  });

  it('other answers keep their states', () => {
    expect(resolveDataState({ ...store(), served: 'live', fetchedAt: undefined }).id).toBe('live');
    expect(resolveDataState({ ...store(), served: 'archive', fallback: true, fetchedAt: undefined }).id).toBe('archived');
    // A "store" answer with no usable fetched time is not trusted as one, and is not live either
    // (module audit 2026-10-15, C1: LIVE only when served live).
    expect(resolveDataState(store({ fetchedAt: undefined })).id).not.toBe('served');
    expect(resolveDataState(store({ fetchedAt: undefined })).id).not.toBe('live');
  });

  it('an empty or status-row answer is still a state card, not "served"', () => {
    expect(resolveDataState(store({ rows: [] })).id).not.toBe('served');
    expect(resolveDataState(store({ rows: [{ status: 'source_status', title: 'Source offline or empty' }] })).id).not.toBe('served');
  });
});

// Review of 1345bfd, finding 1: a stored copy past its freshness limit (`stale: true`, kept because the live
// path brought nothing better) is still served, but its tone warns, so the header can say so.
describe('a stale answer from the store', () => {
  it('warns, and is still served data with no badge', () => {
    const state = resolveDataState(store({ stale: true }));
    expect(state.id).toBe('served');
    expect(state.tone).toBe('warn');
    expect(state.stale).toBe(true);
    expect(state.hideBadge).toBe(true);
    expect(isTerminalState(state)).toBe(false);
  });

  it('a fresh one keeps the ok tone, and DATA_STATE.served is not changed', () => {
    expect(resolveDataState(store()).tone).toBe('ok');
    expect(resolveDataState(store()).stale).toBeUndefined();
    resolveDataState(store({ stale: true }));
    expect(DATA_STATE.served.tone).toBe('ok');
  });
});

describe('the probe counts an answer from the store as live (refreshFeeds.checkOutcome)', () => {
  it('whatever its adapter', () => {
    for (const adapter of ['api', 'news-search', 'source-library', 'register']) {
      expect(checkOutcome(store({ source: { adapter, links: [], note: '' } })), adapter).toEqual({ ok: true, fallback: false, rows: 1, status: 'live', error: null });
    }
  });

  it('real stored answers are still stored', () => {
    expect(checkOutcome({ ...store(), served: 'archive', fetchedAt: undefined }).status).toBe('archive');
    expect(checkOutcome({ ...store(), fallback: true, served: 'live', fetchedAt: undefined }).status).toBe('archive');
    expect(checkOutcome({ ...store(), served: 'live', fetchedAt: undefined, source: { adapter: 'source-library' } }).status).toBe('archive');
    expect(checkOutcome({ ...store(), served: 'live', fetchedAt: undefined, source: { adapter: 'embedded' } }).status).toBe('archive');
  });
});
