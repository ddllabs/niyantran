import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { fingerprintRequest } from './persistence.ts';
import { documentIdsOf, documentKeysOf, LIMITS, type TextAttachment, validateRequest } from './validate.ts';

const base = { message: 'Question', turn_key: 'turn', focus: 'selection' as const };
function selection(row: Record<string, unknown>) {
  return validateRequest({ ...base, selection: { tier: 'national', feature: 'Bills', row } });
}
function acceptedRow(row: Record<string, unknown>) {
  const validated = selection(row);
  assert('request' in validated);
  return validated.request.selection!.row;
}

Deno.test('oversized column names are dropped without retaining a 500k key', () => {
  const row = acceptedRow({ ['x'.repeat(500_000)]: 'Untrusted', bill_name: 'Ordinary bill' });
  assertEquals(Object.keys(row), ['bill_name']);
  assertEquals(JSON.stringify(row), '{"bill_name":"Ordinary bill"}');
});

Deno.test('column names accept the exact 200-unit boundary and never truncate into another column', () => {
  const boundary = 'a'.repeat(200);
  const row = acceptedRow({
    [boundary]: 'Original',
    [boundary + 'x']: 'Forged replacement',
    [boundary + 'y']: 'Other',
  });
  assertEquals(Object.keys(row), [boundary]);
  assertEquals(row[boundary], 'Original');
});

Deno.test('Unicode names preserve exact spelling while respecting the UTF-16 boundary', () => {
  const atLimit = '📄'.repeat(100);
  const row = acceptedRow({
    [atLimit]: 'Kept',
    [atLimit + 'x']: 'Dropped',
    'विधेयक का नाम': 'Bill',
    'e\u0301': 'Distinct',
    '\u00e9': 'Also distinct',
  });
  assertEquals(Object.keys(row), [atLimit, 'विधेयक का नाम', 'e\u0301', '\u00e9']);
});

Deno.test('selection with only oversized column names uses the existing empty-row error', () => {
  assertEquals(selection({ ['a'.repeat(201)]: 'value' }), {
    fieldErrors: { selection: 'selection needs tier, feature and a non-empty row' },
  });
});

Deno.test('discarded names do not consume the 64 retained-column budget', () => {
  const input: Record<string, unknown> = {};
  for (let i = 0; i < 80; i++) input['x'.repeat(201) + i] = 'Dropped';
  for (let i = 0; i < 80; i++) input['Column ' + i] = 'v'.repeat(600);
  const row = acceptedRow(input);
  assertEquals(Object.keys(row), Array.from({ length: 64 }, (_, i) => 'Column ' + i));
  assert(Object.entries(row).every(([key, value]) => key.length <= 200 && value.length === LIMITS.cellChars));
});

Deno.test('ordinary header spelling and existing scalar filtering remain unchanged', () => {
  assertEquals(
    acceptedRow({
      ' Date of Introduction ': '2026-09-21',
      'Bill No. / Year': 42,
      'Passed?': false,
      empty: '',
      missing: null,
      nested: { x: 1 },
      list: [1],
    }),
    {
      ' Date of Introduction ': '2026-09-21',
      'Bill No. / Year': '42',
      'Passed?': 'false',
    },
  );
});

Deno.test('ordinary validated selection preserves canonical D3 intent and changed values still conflict', async () => {
  const first = selection({ title: 'Bill', house: 'Lok Sabha' });
  const reordered = selection({ house: 'Lok Sabha', title: 'Bill' });
  const changed = selection({ title: 'Different bill', house: 'Lok Sabha' });
  assert('request' in first && 'request' in reordered && 'request' in changed);
  assertEquals(first.request, {
    ...base,
    attachments: [],
    selection: { tier: 'national', feature: 'Bills', row: { title: 'Bill', house: 'Lok Sabha' } },
  });
  assertEquals(await fingerprintRequest(first.request), await fingerprintRequest(reordered.request));
  assert(await fingerprintRequest(first.request) !== await fingerprintRequest(changed.request));
});

Deno.test('turn key rejection, attachment limits and document scoping retain existing behavior', () => {
  assert('fieldErrors' in validateRequest({ ...base, turn_key: 'k'.repeat(65) }));
  const validated = validateRequest({
    ...base,
    selection: { tier: 'national', feature: 'Bills', row: { title: 'Bill' }, document_key: 'bill:1' },
    attachments: Array.from(
      { length: 14 },
      () => ({ kind: 'row', title: 'Attached', text: 'x'.repeat(40_001), document_key: 'bill:2' }),
    ),
  });
  assert('request' in validated);
  assertEquals(validated.request.attachments.length, 12);
  assertEquals((validated.request.attachments[0] as TextAttachment).text.length, 40_000);
  assertEquals(documentKeysOf(validated.request), ['bill:1', 'bill:2']);
});

Deno.test('inherited columns remain excluded from the retained row', () => {
  const row = Object.assign(Object.create({ inherited: 'Ignored' }), { title: 'Own bill' });
  assertEquals(acceptedRow(row), { title: 'Own bill' });
});

Deno.test('persona_probe accepts a persona enum value and refuses anything else', () => {
  const ok = validateRequest({ ...base, persona_probe: 'journalist' });
  assert('request' in ok);
  assertEquals(ok.request.persona_probe, 'journalist');
  const none = validateRequest(base);
  assert('request' in none);
  assertEquals('persona_probe' in none.request, false);
  for (const bad of ['student', 'hacker', 7, '']) {
    const res = validateRequest({ ...base, persona_probe: bad });
    assert('fieldErrors' in res, `refused ${String(bad)}`);
    assert(res.fieldErrors.persona_probe);
  }
});

// retrieval-scope: the "Ask about this document" chip. It is a pointer to an
// indexed document, never corpus content, so it carries an id and no text.
const DOC_A = '0b6f1a52-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const DOC_B = '1c7e2b63-4d5e-4f60-9bac-1d2e3f4a5b6c';

Deno.test('a document attachment is accepted with a title and a uuid, and needs no text', () => {
  const validated = validateRequest({
    ...base,
    focus: 'attached',
    attachments: [{ kind: 'document', title: 'RBI circular', document_id: DOC_A, feature: 'Regulatory' }],
  });
  assert('request' in validated, JSON.stringify(validated));
  assertEquals(validated.request.attachments, [
    { kind: 'document', title: 'RBI circular', document_id: DOC_A, feature: 'Regulatory' },
  ]);
  assertEquals(documentIdsOf(validated.request), [DOC_A]);
  assertEquals(documentKeysOf(validated.request), [], 'an id is not a document key');
});

Deno.test('a document attachment never carries text into the request, even when the client sends some', () => {
  const validated = validateRequest({
    ...base,
    attachments: [{ kind: 'document', title: 'T', document_id: DOC_A, text: 'inlined corpus text' }],
  });
  assert('request' in validated);
  assertEquals('text' in validated.request.attachments[0], false);
});

Deno.test('a malformed document_id is a 400 field error, not a silently dropped chip', () => {
  for (const bad of ['not-a-uuid', '', 42, null, undefined, `${DOC_A} `.repeat(2)]) {
    const res = validateRequest({ ...base, attachments: [{ kind: 'document', title: 'T', document_id: bad }] });
    assert('fieldErrors' in res, `refused ${JSON.stringify(bad)}`);
    assertStringIncludes(res.fieldErrors.attachments, 'document_id');
  }
});

Deno.test('documentIdsOf is distinct and the attachment cap still bounds the chips', () => {
  const chips = Array.from({ length: 14 }, (_, i) => ({
    kind: 'document',
    title: `Doc ${i}`,
    document_id: i < 13 ? DOC_B.slice(0, -2) + String(i).padStart(2, '0') : DOC_A,
  }));
  const validated = validateRequest({
    ...base,
    attachments: [{ kind: 'document', title: 'Dup', document_id: DOC_A.toUpperCase() }, ...chips],
  });
  assert('request' in validated);
  assertEquals(validated.request.attachments.length, LIMITS.attachments);
  const ids = documentIdsOf(validated.request);
  assertEquals(ids.length, LIMITS.attachments);
  assertEquals(ids[0], DOC_A, 'ids are compared case-insensitively and kept once');

  const twice = validateRequest({
    ...base,
    attachments: [
      { kind: 'document', title: 'One', document_id: DOC_A },
      { kind: 'document', title: 'Again', document_id: DOC_A },
      { kind: 'document', title: 'Two', document_id: DOC_B },
    ],
  });
  assert('request' in twice);
  assertEquals(documentIdsOf(twice.request), [DOC_A, DOC_B]);
});

Deno.test('an empty desk_context feature counts as absent', () => {
  for (const feature of ['', '   ']) {
    const validated = validateRequest({ ...base, focus: 'desk', desk_context: { tier: 'national', feature } });
    assert('request' in validated);
    assertEquals(validated.request.desk_context, { tier: 'national' });
  }
});
