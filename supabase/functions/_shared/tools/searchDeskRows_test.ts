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
  assertEquals(Object.keys(SEARCH_DESK_ROWS_TOOL.function.parameters.properties), ['tier', 'feature', 'query', 'filters', 'date_from', 'date_to', 'limit']);
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
  // The block header carries the handle and the feature, never the row key:
  // offering the model a second, readable identifier made it cite that instead
  // of the handle, and the turn then resolved no sources at all.
  assert(text.startsWith('R3 | Bill Passage Probability Index\nRecord: THE NATIONAL'));
  assert(!text.includes(BILL.row_key), 'the row key must not reach the model');
  assertStringIncludes(text, 'TOTAL: 6520 rows match (snapshot 2026-09-07T18:02:04.432Z); showing 1');
  assertEquals(renderDeskRows({ rows: [], total: 0, snapshot_at: null }, []), 'NO_RESULTS');
  assertEquals(renderDeskRows({ rows: [], total: 0, snapshot_at: null, error: 'Unknown module' }, []), 'Unknown module');
});

// ---- F197 (D3, 2026-10-15): an unknown filter field never comes back as a silent zero. ----

/** The Bill Passage fields as the loader stores them (src/lib/deskRows.js flattenRow adds `date`). */
const BILL_FIELDS = [
  'as_of', 'bill_category', 'bill_name', 'bill_number', 'bill_type', 'current_stage', 'date', 'date_introduced',
  'entityName', 'eventDate', 'house', 'id', 'occurred_at', 'provenance', 'sector', 'source_date_raw', 'source_url',
  'sourceName', 'sourcePublishedAt', 'title',
];

/** A register shaped like the D3 one: 23 Lok Sabha bills introduced in 2026, 11 of them assented,
 * beside Lok Sabha bills of 2025 and Rajya Sabha bills of 2026 that a year question must not count. */
function register(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const add = (house: string, date: string, stage: string, n: number) =>
    rows.push({
      tier: 'national',
      feature: 'Bill Passage Probability Index',
      row_key: `${n}-${house}-${date}`.toLowerCase(),
      row: { bill_name: `BILL ${n}`, house, current_stage: stage, date_introduced: `${date} 19:00:00`, date: `${date} 19:00:00` },
      record_text: `Record: BILL ${n}\nhouse: ${house}`,
      document_key: null,
      snapshot_at: '2026-10-01T00:00:00.000Z',
    });
  for (let i = 0; i < 23; i++) add('Lok Sabha', `2026-${String(1 + (i % 9)).padStart(2, '0')}-1${i % 10}`, i < 11 ? 'Assented' : 'Pending', i);
  for (let i = 0; i < 7; i++) add('Lok Sabha', `2025-12-0${1 + i}`, 'Assented', 100 + i);
  for (let i = 0; i < 5; i++) add('Rajya Sabha', `2026-03-0${1 + i}`, 'Assented', 200 + i);
  return rows;
}

/** search_desk_rows and desk_row_fields as the migration defines them (20261015210000), over rows. */
function fakeDesk(rows = register(), fields = BILL_FIELDS) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const iso = (v: unknown) => /^\s*(\d{4}(-\d{2}(-\d{2})?)?)/.exec(String(v ?? ''))?.[1] ?? null;
  const deps: DeskRowsDeps = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'desk_row_fields') {
        const dated = rows.filter((r) => iso((r.row as Record<string, string>).date)).length;
        return Promise.resolve({ data: { rows: rows.length, dated, fields } as never, error: null });
      }
      const filters = (args.p_filters ?? {}) as Record<string, string>;
      const from = args.p_date_from as string | undefined;
      const to = args.p_date_to as string | undefined;
      const scope = rows.filter((r) => r.tier === args.p_tier && (!args.p_feature || r.feature === args.p_feature)).filter((r) => {
        if (!from && !to) return true;
        const d = iso((r.row as Record<string, string>).date);
        return !!d && (!from || d >= from.slice(0, d.length)) && (!to || d <= to.slice(0, d.length));
      });
      const match = (exact: boolean) =>
        scope.filter((r) =>
          Object.entries(filters).every(([k, v]) => {
            const have = (r.row as Record<string, string>)[k];
            return exact ? have === v : have != null && have.trim().toLowerCase() === v.trim().toLowerCase();
          })
        );
      let hit = match(true);
      if (!hit.length && Object.keys(filters).length) hit = match(false);
      return Promise.resolve({ data: hit.slice(0, Number(args.p_limit)).map((r) => ({ ...r, total: hit.length })), error: null });
    },
  };
  return { deps, calls };
}

Deno.test('F197: the D3 call - an unknown field is an error listing the module\'s real fields, never a silent zero', async () => {
  const { deps, calls } = fakeDesk();
  const res = await executeSearchDeskRows(deps, {
    tier: 'national',
    feature: 'Bill Passage Probability Index',
    filters: { year: '2026', house: 'Lok Sabha' },
  });
  assert(res.error, 'an unknown field must be an error');
  assertStringIncludes(res.error!, 'Unknown filter field "year"');
  assertStringIncludes(res.error!, 'Bill Passage Probability Index');
  for (const f of ['house', 'current_stage', 'date_introduced', 'bill_type']) assertStringIncludes(res.error!, f);
  assertStringIncludes(res.error!, 'date_from');
  assertEquals(res.rows, []);
  // The model sees the error, not NO_RESULTS and not a TOTAL of 0.
  const shown = renderDeskRows(res, []);
  assertEquals(shown, res.error);
  assert(!shown.includes('TOTAL'));
  assertEquals(calls.map((c) => c.fn), ['search_desk_rows', 'desk_row_fields']);
  assertEquals(calls[1].args, { p_tier: 'national', p_feature: 'Bill Passage Probability Index' });
});

Deno.test('F197: the year question as a date range counts the 23 bills and the 11 assented', async () => {
  const { deps, calls } = fakeDesk();
  const all = await executeSearchDeskRows(deps, {
    tier: 'national',
    feature: 'Bill Passage Probability Index',
    filters: { house: 'Lok Sabha' },
    date_from: '2026',
    date_to: '2026',
  });
  assertEquals(all.error, undefined);
  assertEquals(all.total, 23);
  assertEquals(calls[0].args.p_date_from, '2026-01-01');
  assertEquals(calls[0].args.p_date_to, '2026-12-31');
  // "assented" as the reader typed it finds "Assented".
  const assented = await executeSearchDeskRows(deps, {
    tier: 'national',
    feature: 'Bill Passage Probability Index',
    filters: { house: 'Lok Sabha', current_stage: 'assented' },
    date_from: '2026-01-01',
    date_to: '2026-12-31',
  });
  assertEquals(assented.total, 11);
  assertStringIncludes(renderDeskRows(assented, assented.rows.map((_, i) => `R${i + 1}`)), 'TOTAL: 11 rows match');
  assert(!calls.some((c) => c.fn === 'desk_row_fields'), 'a search that found rows needs no field check');
});

Deno.test('F197: date bounds are ISO dates; a month ends on its last day; bad or reversed bounds are errors with no RPC', async () => {
  const { deps, calls: all } = fakeDesk();
  const calls = { get length() { return all.length; } };
  const searches = () => all.filter((c) => c.fn === 'search_desk_rows');
  await executeSearchDeskRows(deps, { tier: 'national', date_from: '2024-02', date_to: '2024-02' });
  assertEquals([searches()[0].args.p_date_from, searches()[0].args.p_date_to], ['2024-02-01', '2024-02-29']);
  await executeSearchDeskRows(deps, { tier: 'national', date_to: '2026-08-09' });
  assertEquals(searches()[1].args.p_date_to, '2026-08-09');
  assert(!('p_date_from' in searches()[1].args), 'an absent bound is not sent');
  await executeSearchDeskRows(deps, { tier: 'national' });
  assert(!('p_date_from' in searches()[2].args) && !('p_date_to' in searches()[2].args), 'no bounds, no date parameters');
  for (
    const bad of [{ date_from: '2026/01/01' }, { date_to: 'last year' }, { date_from: '2026-13' }, { date_from: '2026-02-30' }, {
      date_from: '2026',
      date_to: '2025',
    }]
  ) {
    const before = calls.length;
    const res = await executeSearchDeskRows(deps, { tier: 'national', ...bad });
    assert(res.error, `should be refused: ${JSON.stringify(bad)}`);
    assertEquals(calls.length, before, 'no RPC for a bad bound');
  }
});

Deno.test('F197: a true zero says which conditions matched nothing; a date range on an undated module is an error', async () => {
  const { deps } = fakeDesk();
  const none = await executeSearchDeskRows(deps, {
    tier: 'national',
    feature: 'Bill Passage Probability Index',
    filters: { house: 'Lok Sabha', current_stage: 'Withdrawn' },
    date_from: '2026',
    date_to: '2026',
  });
  assertEquals(none.error, undefined);
  const shown = renderDeskRows(none, []);
  assert(shown !== 'NO_RESULTS', 'a filtered zero must not read as an empty record');
  assertStringIncludes(shown, 'TOTAL: 0 rows match');
  assertStringIncludes(shown, 'house = "Lok Sabha"');
  assertStringIncludes(shown, 'current_stage = "Withdrawn"');
  assertStringIncludes(shown, '2026-01-01 to 2026-12-31');
  assertStringIncludes(shown, '0 matching rows for');

  const bare = register().map((r) => ({ ...r, row: { house: (r.row as Record<string, string>).house } }));
  const undated = fakeDesk(bare, ['house']);
  const res = await executeSearchDeskRows(undated.deps, { tier: 'national', feature: 'Bill Passage Probability Index', date_from: '2026' });
  assert(res.error);
  assertStringIncludes(res.error!, 'no dated rows');
  assertStringIncludes(res.error!, 'house');
});
