// F20: the desk-row loader writes only what changed. It compares each module's
// rows with what desk_rows holds, upserts new or changed rows, and deletes the
// keys that disappeared, instead of rewriting all 34,184 rows every run.
import { describe, expect, it } from 'vitest';
import { canonicalJson, planDeskRowSync } from './deskRowSync.js';

const row = (key, extra = {}) => ({
  tier: 'national', feature: 'Bill Passage Probability Index', row_key: key,
  row: { title: `Bill ${key}`, status: 'Pending', year: 2024 }, record_text: `Bill ${key} Pending 2024`,
  document_key: `bill:2024:${key}`, snapshot_at: '2026-09-20T00:00:00.000Z', ...extra,
});
// desk_rows as PostgREST returns it: jsonb reorders keys, timestamps come back with +00:00.
const stored = (r) => ({ ...r, row: Object.fromEntries(Object.entries(r.row).reverse()), snapshot_at: r.snapshot_at.replace('.000Z', '+00:00') });

describe('planDeskRowSync', () => {
  it('writes nothing when the rows are unchanged, whatever the key order and timestamp format', () => {
    const rows = [row('1'), row('2')];
    const plan = planDeskRowSync(rows.map(stored), rows);
    expect(plan).toEqual({ upserts: [], deleteKeys: [], unchanged: 2 });
  });

  it('upserts new and changed rows and deletes the keys that are gone', () => {
    const before = [row('1'), row('2'), row('3')].map(stored);
    const after = [row('1'), row('2', { row: { title: 'Bill 2', status: 'Passed', year: 2024 } }), row('4')];
    const plan = planDeskRowSync(before, after);
    expect(plan.upserts.map((r) => r.row_key).sort()).toEqual(['2', '4']);
    expect(plan.deleteKeys).toEqual(['3']);
    expect(plan.unchanged).toBe(1);
  });

  it('treats a changed record_text, document_key or snapshot as a change', () => {
    const before = [row('1'), row('2'), row('3')].map(stored);
    const after = [row('1', { record_text: 'changed' }), row('2', { document_key: null }), row('3', { snapshot_at: '2026-09-25T00:00:00.000Z' })];
    expect(planDeskRowSync(before, after).upserts).toHaveLength(3);
  });

  it('ignores snapshot_at when it is only the run time, so undated modules are not rewritten each run', () => {
    const before = [row('1')].map(stored);
    const after = [row('1', { snapshot_at: '2026-09-29T12:00:00.000Z' })];
    expect(planDeskRowSync(before, after, { ignoreSnapshot: true })).toEqual({ upserts: [], deleteKeys: [], unchanged: 1 });
  });

  it('canonicalJson sorts keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
