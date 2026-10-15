import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { DESK_CATALOG, DESK_TIERS, deskCatalogBlock, resolveFeature } from './deskCatalog.ts';
import { DESK_GROUNDING_RULES, selectedRecordBlock } from './deskGroundingRules.ts';
import { executeSearchDeskRows } from './tools/searchDeskRows.ts';

const NATIONAL = [
  'Bill Passage Probability Index',
  'Policy Intelligence Graph',
  'Parliamentary Question Database',
  'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)',
  'Candidate Affidavit Database (Structured + API)',
  'MP Profiles & Performance (MPLAD, attendance, debates)',
  'Central Tender Aggregator + Constituency Filter',
  'Bureaucratic Transfers — AGMUT Cadre',
  'Cabinet Decisions',
  'Centre-sanctioned Projects & Completion Rate',
  'Budget Utilisation & Schemes',
  'Industry Updates (Ministry Data)',
];

Deno.test('every catalogue entry sits on a desk the tool enum names, with a feature, a bucket and a row count', () => {
  assert(DESK_CATALOG.length >= 70, `${DESK_CATALOG.length} entries`);
  for (const e of DESK_CATALOG) {
    assert((DESK_TIERS as readonly string[]).includes(e.tier), `${e.feature}: tier ${e.tier}`);
    assert(e.feature.trim().length > 0);
    assert(e.bucket.trim().length > 0, `${e.feature}: bucket`);
    assert(Number.isInteger(e.rows) && e.rows >= 0, `${e.feature}: rows`);
  }
  const bills = DESK_CATALOG.find((e) => e.feature === 'Bill Passage Probability Index')!;
  assertEquals(bills.tier, 'national');
  assert(bills.rows >= 9_000, `bills rows ${bills.rows}`);
  assert(bills.note && bills.note.length > 0, 'bills carry the registry note');
});

Deno.test('the national block lists all twelve national modules in long form and the other desks by name only', () => {
  const block = deskCatalogBlock('national');
  for (const name of NATIONAL) assertStringIncludes(block, `- ${name} (`);
  assertStringIncludes(block, 'rows');
  assertStringIncludes(block, 'no rows loaded');
  assertStringIncludes(block, 'Other desks:');
  assertStringIncludes(block, 'global: Open Fronts');
  assert(!block.includes('- Open Fronts ('), 'other desks are not in long form');
  const all = deskCatalogBlock();
  assertStringIncludes(all, 'national: Bill Passage Probability Index');
  assert(!all.includes('- Bill Passage'), 'no long form without a tier');
});

Deno.test('resolveFeature: exact, then case/dash/space-insensitive, within the tier', () => {
  assertEquals(resolveFeature('national', 'Bill Passage Probability Index')?.feature, 'Bill Passage Probability Index');
  assertEquals(resolveFeature('national', '  bill passage   probability index ')?.feature, 'Bill Passage Probability Index');
  assertEquals(resolveFeature('national', 'Bureaucratic Transfers - AGMUT Cadre')?.feature, 'Bureaucratic Transfers — AGMUT Cadre');
  assertEquals(resolveFeature('law', 'Bill Passage Probability Index'), null);
  assertEquals(resolveFeature('national', ''), null);
  assertEquals(resolveFeature('national', 'Nonexistent Module'), null);
});

Deno.test('the grounding rules carry the five rules; the selected-record block names handle, module, desk and text', () => {
  for (const phrase of ['quoting TOTAL', 'Selected record', 'search_documents', 'snapshot', 'Never print a row_key']) {
    assertStringIncludes(DESK_GROUNDING_RULES, phrase);
  }
  const block = selectedRecordBlock({ handle: 'S1', tier: 'national', feature: 'Bill Passage Probability Index', recordText: 'bill_name: THE X BILL, 2026' });
  assert(block.startsWith('Selected record S1'));
  assertStringIncludes(block, 'Bill Passage Probability Index');
  assertStringIncludes(block, 'national desk');
  assertStringIncludes(block, 'bill_name: THE X BILL, 2026');
});

// The eight RBI Handbook modules (src/lib/handbookDeskRows.js writes their desk_rows, one feature each,
// on the state desk). The names are spelled here exactly as the loader writes them.
const HANDBOOK_MODULES = [
  'State Economic Data (GSDP, sectors)',
  'State Fiscal Deep-Dive',
  'NITI Aayog State Indices',
  'District Health & Nutrition Indicators',
  'District Education Indicators',
  'District Economic & Livelihood Indicators',
  'District Agriculture & Rural Indicators',
  'District Infrastructure & Connectivity',
];

Deno.test('every handbook module is in the catalogue on the state desk, and resolveFeature accepts its name exactly as the loader writes it', () => {
  for (const name of HANDBOOK_MODULES) {
    const hit = resolveFeature('state', name);
    assertEquals(hit?.feature, name, name);
    assertEquals(hit?.tier, 'state', name);
    // A module the tool resolves is never reached on another desk.
    assertEquals(resolveFeature('national', name), null, name);
  }
});

Deno.test('a module-scoped search of a handbook module reaches the store with the exact feature name, not "Unknown module"', async () => {
  for (const name of HANDBOOK_MODULES) {
    const calls: Record<string, unknown>[] = [];
    const res = await executeSearchDeskRows(
      { rpc: (_fn, args) => (calls.push(args), Promise.resolve({ data: [], error: null })) },
      { tier: 'state', feature: name, filters: { table_no: '176', state: 'Bihar', year: '2023-24' } },
    );
    assert(!String(res.error ?? '').includes('Unknown module'), `${name}: ${res.error}`);
    assertEquals(calls[0].p_feature, name);
  }
});

Deno.test('the state block lists each handbook module with its tables, searchable fields and how years are written', () => {
  const block = deskCatalogBlock('state');
  for (const name of HANDBOOK_MODULES) assertStringIncludes(block, `- ${name} (`);
  assertStringIncludes(block, 'Table 176: State-wise Composition of Outstanding Liabilities');
  assertStringIncludes(block, 'Table 21: Gross State Domestic Product (Current Prices)');
  assertStringIncludes(block, 'Table 106: State-wise Sustainable Development Goals (SDGs) Score');
  assertStringIncludes(block, 'table_no');
  assertStringIncludes(block, '"2019-20"');
  assertStringIncludes(block, '1 April 2019');
  assertStringIncludes(block, 'calendar year');
  // The modules that are not the handbook keep their one-line form.
  assertStringIncludes(block, '- Constituency Register (');
  const handbookStart = block.indexOf(`- ${HANDBOOK_MODULES[0]} (`);
  assert(!block.slice(0, handbookStart).includes('Table '), 'tables appear only under handbook modules');
  // A handbook module is not "no rows loaded": the catalogue cannot count rows the loader writes later.
  assert(!block.slice(handbookStart).includes('no rows loaded'), 'a handbook module is not "no rows loaded"');
});

Deno.test('the other desks list the handbook modules by name only', () => {
  const block = deskCatalogBlock('national');
  for (const name of HANDBOOK_MODULES) assertStringIncludes(block, name);
  assert(!block.includes('Table 176'), 'no table list on another desk');
});

Deno.test('the grounding rules tell the model to filter handbook figures and to quote them with year, unit and RBI link', () => {
  for (
    const phrase of [
      'RBI Handbook',
      'table_no',
      'state and year',
      'never guess a value',
      'year, unit and RBI link',
    ]
  ) assertStringIncludes(DESK_GROUNDING_RULES, phrase);
});

Deno.test('the tool description and the prompt both allow a year filter on handbook rows, so the model gets one instruction', async () => {
  const prompt = await Deno.readTextFile(new URL('../research-chat/prompt.ts', import.meta.url));
  const tool = await Deno.readTextFile(new URL('./tools/searchDeskRows.ts', import.meta.url));
  for (const text of [prompt, tool]) assertStringIncludes(text, 'where year is filtered exactly as written');
});
