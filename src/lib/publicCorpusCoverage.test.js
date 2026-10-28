import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as coverage from './corpusCoverage.js';

const key = 'desk-record:["national","Questions","q1"]';
const chip = { kind: 'row', document_key: key };
const response = (state, ids = []) => ({ rpc: async () => ({ data: (ids.length ? ids : [null]).map(document_id => ({ document_key: key, document_id, coverage: state })), error: null }) });
beforeEach(() => coverage.resetCoverageCache());
afterEach(() => vi.useRealTimers());

it('F264 exposes exactly two public states, including unknown supplied records', async () => {
  expect(coverage.publicCorpusCapability(chip)).toBe('record');
  for (const state of ['unmapped', 'partial', 'registered', 'incomplete', 'held', 'unavailable']) {
    await coverage.refreshCoverage([key], response(state, state === 'partial' ? ['ready'] : []));
    expect(coverage.publicCorpusCapability(chip)).toBe('record');
  }
  await coverage.refreshCoverage([key], response('full', ['ready']));
  expect(coverage.publicCorpusCapability(chip)).toBe('full');
});

it('F264 never keeps Full text after failure, expiry, invalidation or an older response', async () => {
  vi.useFakeTimers();
  await coverage.refreshCoverage([key], response('full', ['ready']));
  expect(coverage.publicCorpusCapability(chip)).toBe('full');
  await vi.advanceTimersByTimeAsync(coverage.COVERAGE_TTL_MS);
  expect(coverage.publicCorpusCapability(chip)).toBe('record');
  let finish;
  const pending = coverage.refreshCoverage([key], { rpc: () => new Promise(resolve => { finish = resolve; }) });
  await coverage.refreshCoverage([key], { rpc: async () => ({ error: { message: 'offline' } }) });
  finish({ data: [{ document_key: key, coverage: 'full', document_id: 'ready' }], error: null });
  await pending;
  expect(coverage.publicCorpusCapability(chip)).toBe('record');
  coverage.resetCoverageCache();
  expect(coverage.publicCorpusCapability(chip)).toBe('record');
});

it('F264 partial ready IDs remain usable while unknown and held states do not enable auto web', async () => {
  await coverage.refreshCoverage([key], response('partial', ['ready']));
  expect(coverage.readyDocumentIds(chip)).toEqual(['ready']);
  expect(coverage.webDefaultFor({ focus: 'attached', attachments: [chip] })).toEqual({ on: false, reason: 'documents-in-scope' });
  await coverage.refreshCoverage([key], response('held'));
  expect(coverage.webDefaultFor({ focus: 'attached', attachments: [chip] })).toEqual({ on: false, reason: null });
  await coverage.refreshCoverage([key], response('unmapped'));
  expect(coverage.webDefaultFor({ focus: 'attached', attachments: [chip] })).toEqual({ on: true, reason: 'record-without-document' });
});
