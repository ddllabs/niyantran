import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { DESK_CATALOG, DESK_TIERS, deskCatalogBlock, resolveFeature } from './deskCatalog.ts';
import { DESK_GROUNDING_RULES, selectedRecordBlock } from './deskGroundingRules.ts';

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
