import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  type DeskRowsDeps,
  type DeskRowsResult,
  executeSearchDeskRows,
  MAX_ROW_COLUMNS,
  renderDeskRows,
  SEARCH_DESK_ROWS_TOOL,
} from './searchDeskRows.ts';

function fakeRpc(rows: Record<string, unknown>[] = []) {
  const calls: Record<string, unknown>[] = [];
  const deps: DeskRowsDeps = {
    rpc: (_fn, args) => {
      calls.push(args);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return { deps, calls };
}

const BILL = {
  tier: 'national',
  feature: 'Bill Passage Probability Index',
  row_key: '156-lok sabha-2026-08-09-the national co-operative development co',
  row: { id: '156-Lok Sabha-2026-08-09-THE NATIONAL CO-OPERATIVE DEVELOPMENT CO', bill_name: 'THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026', house: 'Lok Sabha' },
  record_text: 'Record: THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026\nhouse: Lok Sabha',
  document_key: 'bill:2026:156',
  snapshot_at: '2026-09-07T18:02:04.432Z',
  total: 6520,
};

Deno.test('the tool declaration is the fixed contract', () => {
  assertEquals(SEARCH_DESK_ROWS_TOOL.type, 'function');
  assertEquals(SEARCH_DESK_ROWS_TOOL.function.name, 'search_desk_rows');
  assertEquals(SEARCH_DESK_ROWS_TOOL.function.parameters.required, ['tier']);
  assertEquals(Object.keys(SEARCH_DESK_ROWS_TOOL.function.parameters.properties), ['tier', 'feature', 'query', 'filters', 'limit']);
  assertEquals(SEARCH_DESK_ROWS_TOOL.function.parameters.properties.tier.enum, [
    'global',
    'national',
    'state',
    'law',
    'economics',
    'carbon',
    'sports',
    'entertainment',
  ]);
  assertEquals(SEARCH_DESK_ROWS_TOOL.function.parameters.properties.limit.maximum, 50);
  assertEquals(SEARCH_DESK_ROWS_TOOL.function.parameters.additionalProperties, false);
});

Deno.test('filters travel as a bound JSON value: an injection payload arrives as a string inside p_filters', async () => {
  const { deps, calls } = fakeRpc([]);
  const payload = "'; drop table desk_rows; --";
  const res = await executeSearchDeskRows(deps, { tier: 'national', feature: 'Bill Passage Probability Index', filters: { house: payload } });
  assertEquals(res.rows, []);
  assertEquals(res.total, 0);
  assertEquals((calls[0].p_filters as Record<string, string>).house, payload);
  assertEquals(calls[0].p_feature, 'Bill Passage Probability Index');
  assertEquals(calls[0].p_query, null);
});

Deno.test('the limit is clamped to 1..50 and defaults to 20', async () => {
  const { deps, calls } = fakeRpc([]);
  await executeSearchDeskRows(deps, { tier: 'national', limit: 500 });
  await executeSearchDeskRows(deps, { tier: 'national', limit: 0 });
  await executeSearchDeskRows(deps, { tier: 'national' });
  assertEquals(calls.map((c) => c.p_limit), [50, 1, 20]);
});

Deno.test('the module name is resolved through the catalogue; an unknown one comes back as an error listing the desk', async () => {
  const { deps, calls } = fakeRpc([]);
  await executeSearchDeskRows(deps, { tier: 'national', feature: '  bill passage probability index ' });
  assertEquals(calls[0].p_feature, 'Bill Passage Probability Index');
  const bad = await executeSearchDeskRows(deps, { tier: 'national', feature: 'Nonexistent Module' });
  assert(bad.error);
  assertStringIncludes(bad.error!, 'Unknown module "Nonexistent Module" on the national desk');
  assertStringIncludes(bad.error!, 'Bill Passage Probability Index');
  assertEquals(calls.length, 1, 'no RPC call for an unknown module');
  const badTier = await executeSearchDeskRows(deps, { tier: 'moon' });
  assertStringIncludes(badTier.error!, 'Unknown desk "moon"');
});

Deno.test('rows are slimmed to 32 columns of 500 characters; total and snapshot come from the RPC', async () => {
  const wide: Record<string, string> = {};
  for (let i = 0; i < 40; i++) wide[`c${i}`] = 'x'.repeat(600);
  const { deps } = fakeRpc([{ ...BILL, row: wide, total: 3 }, { ...BILL, row_key: 'k2', snapshot_at: '2026-09-08T00:00:00.000Z', total: 3 }]);
  const res = await executeSearchDeskRows(deps, { tier: 'national' });
  assertEquals(res.total, 3);
  assertEquals(res.rows.length, 2);
  assertEquals(Object.keys(res.rows[0].row).length, MAX_ROW_COLUMNS);
  assertEquals(res.rows[0].row.c0.length, 500);
  assertEquals(res.rows[0].document_key, 'bill:2026:156');
  assertEquals(res.snapshot_at, '2026-09-08T00:00:00.000Z');
});

Deno.test('an RPC failure throws; an argument problem does not', async () => {
  const deps: DeskRowsDeps = { rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }) };
  await assertRejects(() => executeSearchDeskRows(deps, { tier: 'national' }), Error, 'boom');
});

Deno.test('renderDeskRows: labelled blocks, the TOTAL line, NO_RESULTS, and the error text verbatim', () => {
  const result: DeskRowsResult = {
    rows: [
      { tier: 'national', feature: BILL.feature, row_key: BILL.row_key, row: BILL.row, record_text: BILL.record_text, document_key: BILL.document_key, snapshot_at: BILL.snapshot_at },
    ],
    total: 6520,
    snapshot_at: BILL.snapshot_at,
  };
  const text = renderDeskRows(result, ['R3']);
  assert(text.startsWith(`R3 | Bill Passage Probability Index | ${BILL.row_key}\nRecord: THE NATIONAL`));
  assertStringIncludes(text, 'TOTAL: 6520 rows match (snapshot 2026-09-07T18:02:04.432Z); showing 1');
  assertEquals(renderDeskRows({ rows: [], total: 0, snapshot_at: null }, []), 'NO_RESULTS');
  assertEquals(renderDeskRows({ rows: [], total: 0, snapshot_at: null, error: 'Unknown module' }, []), 'Unknown module');
});
