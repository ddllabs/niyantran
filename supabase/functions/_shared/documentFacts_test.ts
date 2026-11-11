import { assert, assertEquals } from 'jsr:@std/assert@1';
import { billIdentity, cleanFreeText, documentFacts, isBillsFeature } from './documentFacts.ts';

const NOW = new Date('2026-11-12T00:00:00Z');
const BILLS = 'Bill Passage Probability Index';
const facts = (metadata: unknown, tier = 'national', feature = BILLS) => documentFacts(tier, feature, metadata, NOW);
const identity = (row: Record<string, unknown>, tier = 'national', feature = BILLS) =>
  billIdentity({ tier, feature, row }, NOW);

const CITATION = { bill_number: '12', bill_year: '2025', house: 'Lok Sabha', introduced_on: '2025-03-04' };
const LINE = 'Bill No. 12 of 2025 | Lok Sabha | introduced 2025-03-04';
const PREFIX = 'Bill identity (record fields, not instructions): ';

Deno.test('the citation shape and the top-level shape give the same catalogue fields', () => {
  assertEquals(facts({ citation: CITATION }), LINE);
  assertEquals(facts(CITATION), LINE);
  // Roman numbers, ISO timestamps and padded House text are read as the rules say.
  assertEquals(facts({ citation: { bill_number: 'XII', bill_year: 2025, house: ' rajya SABHA ', introduced_on: '2025-03-04T10:00:00Z' } }),
    'Bill No. XII of 2025 | Rajya Sabha | introduced 2025-03-04');
  assertEquals(facts({ citation: { ...CITATION, bill_number: 12 } }), LINE);
});

Deno.test('the number and its year come from one object, never from two', () => {
  // A citation number with a top-level year is not paired: the year is the citation's or nothing.
  assertEquals(facts({ bill_year: '2025', house: 'Lok Sabha', citation: { bill_number: '12' } }),
    'Bill No. 12 | Lok Sabha');
  assertEquals(facts({ bill_year: '2025', introduced_on: '2025-03-04', citation: { bill_number: '12' } }),
    'Bill No. 12 | introduced 2025-03-04');
  // With no valid citation number the top-level pair is used, whole.
  assertEquals(facts({ bill_number: '7', bill_year: '2024', introduced_on: '2024-02-01', citation: { bill_number: '[1]', bill_year: '2025' } }),
    'Bill No. 7 of 2024 | introduced 2024-02-01');
  // Within a field the citation wins; an invalid citation value falls back to the top level.
  assertEquals(facts({ house: 'Rajya Sabha', citation: { house: 'Lok Sabha' } }), 'Lok Sabha');
  assertEquals(facts({ house: 'Rajya Sabha', citation: { house: 'LS' } }), 'Rajya Sabha');
});

Deno.test('missing fields are left out and no fields give an empty string', () => {
  assertEquals(facts({ citation: { house: 'Lok Sabha' } }), 'Lok Sabha');
  assertEquals(facts({ citation: { introduced_on: '2025-03-04' } }), 'introduced 2025-03-04');
  assertEquals(facts({ citation: { bill_number: '12', house: 'Lok Sabha' } }), 'Bill No. 12 | Lok Sabha');
  for (const empty of [{}, { citation: {} }, null, undefined, 'x', 7, [], [CITATION]]) assertEquals(facts(empty), '');
  assert(!/undefined|null|n\/a/i.test(facts({ citation: { bill_number: null, house: undefined } })));
});

Deno.test('only the national Bills feature has a line; case and space variants of its name do', () => {
  assertEquals(facts({ citation: CITATION }, 'national', 'Parliamentary Question Database'), '');
  assertEquals(facts({ citation: CITATION }, 'national', 'NCLT / NCLAT (Insolvency)'), '');
  assertEquals(facts({ citation: CITATION }, 'law', BILLS), '');
  assertEquals(facts({ citation: CITATION }, 'regional', BILLS), '');
  assertEquals(facts({ citation: CITATION }, 'national', 'bill passage probability index '), LINE);
  assertEquals(facts({ citation: CITATION }, 'national', ' BILL  PASSAGE-probability_index'), LINE);
  assertEquals(facts({ citation: CITATION }, 'national', null as unknown as string), '');
  assertEquals(facts({ citation: CITATION }, null as unknown as string, BILLS), '');
  assert(isBillsFeature('national', BILLS));
  assert(isBillsFeature('national', 'bill passage probability index '));
  assert(!isBillsFeature('law', BILLS));
  assert(!isBillsFeature('national', 'Bill Passage'));
  assert(!isBillsFeature(null, BILLS));
  assert(!isBillsFeature('national', 42));
});

Deno.test('a year that is not the introduced year is not stated as the bill year', () => {
  assertEquals(facts({ citation: { ...CITATION, bill_year: '2024' } }), 'Bill No. 12 | Lok Sabha | introduced 2025-03-04');
  // No introduction date: nothing can confirm the year, so none is stated.
  assertEquals(facts({ citation: { bill_number: '12', bill_year: '2025' } }), 'Bill No. 12');
});

// One bill, one fixture row for each function: in both, a year attached to the bill number ("of yyyy") is the year of
// the introduction date, and no function states another year there.
const YEAR_FIXTURES: { name: string; citation: Record<string, unknown>; row: Record<string, unknown> }[] = [
  { name: 'all agree', citation: CITATION,
    row: { bill_name: 'The Finance Bill, 2025', bill_number: '12', house: 'Lok Sabha', date_introduced: '2025-03-04' } },
  { name: 'title year differs from the introduced year', citation: { ...CITATION, bill_year: '2025', introduced_on: '2024-07-23' },
    row: { bill_name: 'The Finance Bill, 2025', bill_number: '12', house: 'Lok Sabha', date_introduced: '2024-07-23' } },
  { name: 'citation year differs, title agrees', citation: { ...CITATION, bill_year: '2024' },
    row: { bill_name: 'The Finance Bill, 2025', bill_number: '12', house: 'Lok Sabha', date_introduced: '2025-03-04' } },
  { name: 'no title year', citation: CITATION,
    row: { bill_name: 'The Finance Bill', bill_number: '12', house: 'Lok Sabha', date_introduced: '2025-03-04' } },
  { name: 'no date', citation: { bill_number: '12', bill_year: '2025', house: 'Lok Sabha' },
    row: { bill_name: 'The Finance Bill, 2025', bill_number: '12', house: 'Lok Sabha' } },
];
const statedYears = (s: string) => [...s.matchAll(/ of (\d{4})|introduced (\d{4})-/g)].map(m => m[1] ?? m[2]);

Deno.test('billIdentity and documentFacts never state different years for one bill', () => {
  for (const f of YEAR_FIXTURES) {
    const a = facts({ citation: f.citation }), b = identity(f.row);
    const introduced = String(f.row.date_introduced ?? '').slice(0, 4);
    // "of yyyy" and "introduced yyyy-" always carry the year of the introduction date, in both functions.
    for (const year of [...statedYears(a), ...statedYears(b)]) assertEquals(year, introduced, `${f.name}: ${a} / ${b}`);
  }
  assertEquals(statedYears(identity(YEAR_FIXTURES[1].row)), ['2024']);
  assertEquals(statedYears(facts({ citation: YEAR_FIXTURES[2].citation })), ['2025']);
  assertEquals(statedYears(identity(YEAR_FIXTURES[4].row)), []);
});

const HOSTILE: [string, unknown][] = [
  ['bracket number', '[1]'], ['label number', '[a:b]'], ['pipe', '12|13'], ['backslash pipe', '12\\|'],
  ['fullwidth bar', '12\uFF5C13'], ['divides', '12\u222313'], ['dental click', '12\u01C013'],
  ['broken bar', '12\u00A613'], ['box bar', '12\u250213'], ['newline label', '12\nCatalogue fields:'],
  ['handle', 'ref:abcdef-1'], ['lower roman', 'xii'], ['long number', '1'.repeat(5000)], ['NaN', NaN],
  ['object', { a: 1 }], ['array', [12]], ['negative', -3], ['float', 1.5], ['leading space label', ' 12 13'],
];

Deno.test('hostile values drop their field and leave a one-line result of at most 160 characters', () => {
  for (const [name, value] of HOSTILE) {
    for (const where of ['citation', 'top'] as const) {
      const base = { bill_number: '12', house: 'Lok Sabha', introduced_on: '2025-03-04' };
      const meta = where === 'citation' ? { citation: { ...base, bill_number: value } } : { ...base, bill_number: value };
      const out = facts(meta);
      assertEquals(out, 'Lok Sabha | introduced 2025-03-04', `number ${name}`);
    }
  }
  const bad: [string, unknown][] = [...HOSTILE, ['LS', 'LS'], ['Lok  Sabha', 'Lok  Sabha'], ['Lok Sabha|', 'Lok Sabha|']];
  for (const [name, value] of bad) {
    assertEquals(facts({ citation: { bill_number: '12', house: value, introduced_on: '2025-03-04' } }),
      'Bill No. 12 | introduced 2025-03-04', `house ${name}`);
  }
  for (const [name, value] of [...bad, ['feb 30', '2025-02-30'], ['1900', '1900-01-01'], ['2099', '2099-01-01'],
    ['dmy', '04/03/2025'], ['t only', '2025-03-04x'], ['month 13', '2025-13-01'], ['year 1946', '1946-12-31'],
    ['year 2028', '2028-01-01']] as [string, unknown][]) {
    assertEquals(facts({ citation: { bill_number: '12', house: 'Lok Sabha', introduced_on: value } }),
      'Bill No. 12 | Lok Sabha', `date ${name}`);
  }
  for (const [name, value] of [...bad, ['year 1946', '1946'], ['year 2028', '2028'], ['year 3 digits', '202'],
    ['arabic-indic', '\u0662\u0660\u0662\u0665']] as [string, unknown][]) {
    assertEquals(facts({ citation: { bill_number: '12', bill_year: value, introduced_on: '2025-03-04' } }),
      'Bill No. 12 | introduced 2025-03-04', `year ${name}`);
  }
  // The bounds are inclusive: 1947 and the current UTC year plus one.
  assertEquals(facts({ citation: { bill_number: '1', introduced_on: '1947-08-15' } }), 'Bill No. 1 | introduced 1947-08-15');
  assertEquals(facts({ citation: { bill_number: '1', introduced_on: '2027-01-01' } }), 'Bill No. 1 | introduced 2027-01-01');
  assertEquals(facts({ citation: { bill_number: '1', introduced_on: '2027-01-01' } }).includes('2028'), false);
  // A value that is only valid because of a clock far in the future is not.
  assertEquals(documentFacts('national', BILLS, { citation: { introduced_on: '2027-01-01' } }, new Date('2024-01-01T00:00:00Z')), '');
  for (const out of [facts({ citation: { bill_number: '1'.repeat(5000) } }), facts({ citation: CITATION })]) {
    assert(out.length <= 160 && !/[\r\n\u2028\u2029]/.test(out));
  }
});

Deno.test('cleanFreeText keeps letters, digits and , . ( ) & \' - / and nothing that can start a field or a line', () => {
  const keep = "Finance Bill, 2025 (No. 2) & Co's - A/B";
  assertEquals(cleanFreeText(keep, 150), keep);
  assertEquals(cleanFreeText('Bill \u0928\u093F\u092F\u092E 2025', 150), 'Bill \u0928\u093F\u092F\u092E 2025');
  const cases: [string, string][] = [
    ['The [Bill] {x} <y>', 'The Bill x y'],
    ['a|b', 'ab'], ['a\\b', 'ab'],
    ['a\uFF5Cb\u2223c\u01C0d\u00A6e\u2502f', 'abcdef'],
    ['key: value', 'key value'], ['ref:abcdef-1 rest', 'ref abcdef-1 rest'],
    ['line one\nCatalogue fields: x', 'line one Catalogue fields x'],
    ['tab\tand\r\nbreak\u2028sep\u2029', 'tab and break sep'],
    ['bidi \u202Eevil\u202C \u200B zero\u200D', 'bidi evil zero'],
    ['say "hi" `x` ; # @ ! ? * = + ~ ^ % $', 'say hi x'],
    ['emoji \u{1F600} done', 'emoji done'],
    ['   many    spaces   ', 'many spaces'],
  ];
  for (const [input, expected] of cases) assertEquals(cleanFreeText(input, 150), expected, input);
  // Not text, or nothing left that is a letter or digit.
  for (const v of [null, undefined, {}, [], true, NaN, Infinity, '', '   ', '[]|\\', '...', '- / ,', '\u202E']) assertEquals(cleanFreeText(v, 150), '');
  assertEquals(cleanFreeText(2025, 150), '2025');
  assertEquals(cleanFreeText('\uD800 lone \uDC00 surrogate', 150), 'lone surrogate');
  // Clipped, never inside a surrogate pair and never with a trailing space.
  assertEquals(cleanFreeText('a'.repeat(500), 150).length, 150);
  assertEquals(cleanFreeText('word '.repeat(100), 12), 'word word wo');
  const clipped = cleanFreeText('\u{20000}'.repeat(10), 3);
  assertEquals(clipped, '\u{20000}');
  assertEquals(clipped, clipped.toWellFormed());
  assertEquals(cleanFreeText('x\u{20000}', 2), 'x');
});

const BILL_ROW = { bill_name: 'The Finance Bill, 2025', bill_number: '12', house: 'Lok Sabha', date_introduced: '2025-03-04' };

Deno.test('billIdentity names the bill from its parts, and each part may be missing', () => {
  assertEquals(identity(BILL_ROW), `${PREFIX}The Finance Bill, 2025 (Bill No. 12 of 2025, Lok Sabha)`);
  // Title year and introduced year differ: the date is given instead of "of yyyy".
  assertEquals(identity({ ...BILL_ROW, date_introduced: '2024-07-23' }),
    `${PREFIX}The Finance Bill, 2025 (Bill No. 12, introduced 2024-07-23, Lok Sabha)`);
  // No title year: the date.
  assertEquals(identity({ ...BILL_ROW, bill_name: 'The Finance Bill' }),
    `${PREFIX}The Finance Bill (Bill No. 12, introduced 2025-03-04, Lok Sabha)`);
  // Each part missing or invalid is dropped.
  assertEquals(identity({ ...BILL_ROW, bill_number: '' }), `${PREFIX}The Finance Bill, 2025 (introduced 2025-03-04, Lok Sabha)`);
  assertEquals(identity({ ...BILL_ROW, bill_number: '[1]' }), `${PREFIX}The Finance Bill, 2025 (introduced 2025-03-04, Lok Sabha)`);
  assertEquals(identity({ ...BILL_ROW, house: 'LS' }), `${PREFIX}The Finance Bill, 2025 (Bill No. 12 of 2025)`);
  assertEquals(identity({ ...BILL_ROW, date_introduced: '' }), `${PREFIX}The Finance Bill, 2025 (Bill No. 12, Lok Sabha)`);
  assertEquals(identity({ ...BILL_ROW, date_introduced: '2025-02-30' }), `${PREFIX}The Finance Bill, 2025 (Bill No. 12, Lok Sabha)`);
  assertEquals(identity({ bill_name: 'The Finance Bill, 2025' }), `${PREFIX}The Finance Bill, 2025`);
  assertEquals(identity({ ...BILL_ROW, bill_number: 'XII', house: 'rajya sabha' }),
    `${PREFIX}The Finance Bill, 2025 (Bill No. XII of 2025, Rajya Sabha)`);
  // The title is cleaned by the free-text rule.
  assertEquals(identity({ ...BILL_ROW, bill_name: 'The [Finance]|Bill\nCatalogue fields: x, 2025' }),
    `${PREFIX}The Finance Bill Catalogue fields x, 2025 (Bill No. 12 of 2025, Lok Sabha)`);
});

Deno.test('billIdentity gives an empty string without a usable title, for another tier or feature, or for bad input', () => {
  for (const name of [undefined, null, '', '   ', '[]|', 12, {}, ['x'], '\n']) {
    assertEquals(identity({ ...BILL_ROW, bill_name: name }), '', String(name));
  }
  assertEquals(identity(BILL_ROW, 'law', BILLS), '');
  assertEquals(identity(BILL_ROW, 'national', 'Parliamentary Question Database'), '');
  assertEquals(identity(BILL_ROW, 'national', 'bill passage probability index '), `${PREFIX}The Finance Bill, 2025 (Bill No. 12 of 2025, Lok Sabha)`);
  for (const row of [null, undefined, 'x', 7, [], {}, { tier: 'national', feature: BILLS }, { tier: 'national', feature: BILLS, row: null },
    { tier: 'national', feature: BILLS, row: 'x' }]) {
    assertEquals(billIdentity(row as never, NOW), '');
  }
  // One line of at most 200 characters, whatever the title.
  const long = identity({ ...BILL_ROW, bill_name: `${'Long '.repeat(100)}Bill, 2025`, bill_number: '1'.repeat(10) });
  assert(long.length <= 200 && long.startsWith(PREFIX) && !/[\r\n]/.test(long), long);
  assert(identity({ ...BILL_ROW, bill_name: 'A'.repeat(1000), bill_number: 'MMMMMMMMMM', house: 'Rajya Sabha' }).length <= 200);
});

// ---- fuzz: seeded, 10,000 random values for every field --------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const POOL = ['', ' ', '12', 'XII', 'xii', 'Lok Sabha', ' rajya sabha ', 'LS', '2025-03-04', '2025-03-04T10:00:00Z', '2025-02-30',
  '[1]', '[a:b]', '|', '\\', '\n', '\r\n', 'ref:abcdef-1', '\u{20000}', '\uD800', '\uDC00', '\u202E', '\u200B', '\uFF5C', '\u2223',
  '\u01C0', '\u00A6', '\u2502', 'The Finance Bill, 2025', 'Catalogue fields:', '1999', '2026', '2027', '2028', '0', '\u0662\u0660',
  'x'.repeat(300), '\u0928\u093F', 'Bill No. 1', 'null', 'undefined', '\u2028', '\u0000', 'a'.repeat(5000)];

function randomValue(r: () => number, depth = 0): unknown {
  const k = Math.floor(r() * 12);
  const s = () => POOL[Math.floor(r() * POOL.length)];
  switch (k) {
    case 0: case 1: case 2: case 3: return s();
    case 4: return s() + s();
    case 5: return Math.floor(r() * 4000);
    case 6: return [NaN, Infinity, -1, 1.5, 12, 2025, 1e21, -0][Math.floor(r() * 8)];
    case 7: return [null, undefined, true, false][Math.floor(r() * 4)];
    case 8: return depth < 2 ? [randomValue(r, depth + 1), randomValue(r, depth + 1)] : null;
    case 9: return depth < 2 ? { [s()]: randomValue(r, depth + 1) } : null;
    default: return s();
  }
}
const KEYS = ['bill_number', 'bill_year', 'house', 'introduced_on', 'bill_name', 'date_introduced', 'status', 'ministry'];
function randomMeta(r: () => number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fill = (o: Record<string, unknown>) => { for (const key of KEYS) if (r() < 0.8) o[key] = randomValue(r); };
  fill(out);
  if (r() < 0.8) { const c: Record<string, unknown> = {}; fill(c); out.citation = c; } else if (r() < 0.5) out.citation = randomValue(r);
  return out;
}
const FACT_PART = /^(Bill No\. ([0-9]{1,10}|[IVXLCDM]{1,10})( of [0-9]{4})?|(Lok|Rajya) Sabha|introduced [0-9]{4}-[0-9]{2}-[0-9]{2})$/;
const IDENTITY_TEXT = /^[\p{L}\p{M}\p{N} ,.()&'\/-]+$/u;

Deno.test('fuzz: the formatters never throw and their output stays within its grammar', () => {
  const r = rng(331);
  let nonEmptyFacts = 0, nonEmptyIdentity = 0;
  for (let i = 0; i < 10_000; i++) {
    const meta = randomMeta(r);
    const line = documentFacts('national', BILLS, meta, NOW);
    assert(line.length <= 160 && !/[\r\n\u2028\u2029]/.test(line), JSON.stringify(meta));
    if (line) {
      nonEmptyFacts++;
      const parts = line.split(' | ');
      for (const p of parts) assert(FACT_PART.test(p), `${line} <- ${JSON.stringify(meta)}`);
    }
    const idLine = billIdentity({ tier: 'national', feature: BILLS, row: meta }, NOW);
    assert(idLine.length <= 200 && !/[\r\n\u2028\u2029]/.test(idLine), idLine);
    if (idLine) {
      nonEmptyIdentity++;
      assert(idLine.startsWith(PREFIX));
      assert(IDENTITY_TEXT.test(idLine.slice(PREFIX.length)), idLine);
      assert(!/ref:[a-z0-9]{6}-\d/.test(idLine));
      assert(idLine === idLine.trim());
    }
    assertEquals(documentFacts('law', BILLS, meta, NOW), '');
    assertEquals(cleanFreeText(randomValue(r), 150).length <= 150, true);
  }
  assert(nonEmptyFacts > 500 && nonEmptyIdentity > 500, `${nonEmptyFacts} ${nonEmptyIdentity}`);
});

Deno.test('the formatters stay total when reading a value itself fails', () => {
  const hostile = {
    get citation(): never { throw new Error('citation getter'); },
    get bill_number(): never { throw new Error('boom'); },
    house: 'Lok Sabha',
  };
  assertEquals(facts(hostile), '');
  const poisoned = { toString() { throw new Error('toString'); }, valueOf() { throw new Error('valueOf'); } };
  assertEquals(facts({ citation: { bill_number: poisoned, house: poisoned, introduced_on: poisoned } }), '');
  assertEquals(identity({ bill_name: poisoned, bill_number: poisoned }), '');
  assertEquals(cleanFreeText(poisoned, 10), '');
  assertEquals(billIdentity({ tier: 'national', feature: BILLS, get row(): never { throw new Error('row getter'); } } as never, NOW), '');
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assertEquals(facts(revoked.proxy), '');
  assertEquals(documentFacts('national', BILLS, { citation: CITATION }, { getTime() { throw new Error('clock'); } } as unknown as Date), '');
});

Deno.test('cleanFreeText: invisible characters, stacked marks and further pipe lookalikes do not survive', () => {
  // Variation selectors and other default-ignorable characters can hide bytes in text.
  assertEquals(cleanFreeText('Fin\uFE0Fance\u{E0100} Bill', 80), 'Finance Bill');
  assertEquals(cleanFreeText('A\u034FB\u2060C', 80), 'ABC');
  // No more than three combining marks on one base character.
  assertEquals(cleanFreeText('e' + '\u0301'.repeat(40) + 'x', 80), 'e\u0301\u0301\u0301x');
  // A combining vertical line, and letters that look like a pipe, are removed like the pipe itself.
  assertEquals(cleanFreeText('A\u20D2B', 80), 'AB');
  assertEquals(cleanFreeText('A\u04C0B\u01C1C', 80), 'ABC');
  // Ordinary accented and Indic text keeps its marks.
  assertEquals(cleanFreeText('Café हिन्दी', 80), 'Café हिन्दी');
});
