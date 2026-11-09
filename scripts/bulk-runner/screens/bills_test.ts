// Tests for the Bills screen. Records are built by hand in the pack's shape; live reads go through a fake LiveReader.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { sha256Hex } from '../../../supabase/functions/_shared/textNormalise.ts';
import type { Check, Finding, LiveDeskRow, LiveDocument, LiveReader, ScreenContext } from '../screen_types.ts';
import { REVIEW_CHECKS } from '../screen_types.ts';
import type { Rec } from '../prepare.ts';
import { billNorm, makeBillsScreen } from './bills.ts';

const BILLS = 'Bill Passage Probability Index';
const LICENCE = 'gazette_s52_1_q_i_unconfirmed';
const key = (n: number) => n.toString(16).padStart(40, '0');

type DocQuery = Parameters<LiveReader['documents']>[0];
class FakeLive implements LiveReader {
  rowCalls: { tier: string; feature: string; documentKeys: string[] }[] = [];
  docCalls: DocQuery[] = [];
  /** A reader that ignores the tier and feature of a query, as a faulty one might: the check must not trust it. */
  leaky = false;
  constructor(public rows: LiveDeskRow[] = [], public docs: LiveDocument[] = []) {}
  identity() {
    return Promise.resolve({ database: 'fake', server: 'fake', documents: 1, deskRows: 1 });
  }
  deskRows(q: { tier: string; feature: string; documentKeys: string[] }) {
    this.rowCalls.push(q);
    return Promise.resolve(this.rows.filter((r) => q.documentKeys.includes(r.document_key ?? '')));
  }
  documents(q: DocQuery) {
    this.docCalls.push(q);
    return Promise.resolve(
      this.docs.filter((d) =>
        q.sourceKeys.includes(d.source_key ?? '') || q.fileUrls.includes(d.file_url ?? '') ||
        (q.contentHashes ?? []).includes(d.content_sha256 ?? '\0') ||
        ((q.documentKeys ?? []).includes(d.document_key ?? '\0') &&
          (this.leaky || q.feature === undefined || q.feature === d.desk_feature))
      ),
    );
  }
}

const NAME = 'The River Navigation (Amendment) Bill, 2025';
const liveRow = (documentKey: string, house = 'Lok Sabha', row: Rec = {}): LiveDeskRow => ({
  tier: 'national',
  feature: BILLS,
  row_key: `row-${documentKey.split(':').pop()}`,
  document_key: documentKey,
  row: { house, bill_name: NAME, date_introduced: '2025-03-04', ...row },
});
const liveDoc = (o: Partial<LiveDocument>): LiveDocument => ({
  id: 'd1',
  source_key: null,
  file_url: null,
  file_name: null,
  desk_feature: BILLS,
  document_key: null,
  house: null,
  document_role: null,
  content_sha256: null,
  ...o,
});

const ctxOf = (live: LiveReader = new FakeLive(), settings: Rec = { licenceClasses: [LICENCE] }): ScreenContext => ({
  live,
  settings,
});

const PAGE_TEXTS = (n: number) => [
  `THE RIVER NAVIGATION (AMENDMENT) BILL, 2025 ${n}\nBill No. 12 of 2025. A Bill to amend the law on river navigation. `
    .padEnd(120, 'a'),
  'Be it enacted by Parliament in the Seventy-sixth Year of the Republic of India as follows: short title and commencement. '
    .padEnd(
      120,
      'b',
    ),
];

/** A clean Bills record in the pack's shape. `n` makes the key, bill number, URL and text distinct. */
async function bill(n = 1, over: Rec = {}): Promise<Rec> {
  const texts = PAGE_TEXTS(n);
  const text = texts.join('\f');
  let at = 0;
  const pages = texts.map((t, i) => {
    const p = { page_number: i + 1, char_from: at, char_to: at + [...t].length, text: t };
    at = p.char_to + 1;
    return p;
  });
  const name = 'The River Navigation (Amendment) Bill, 2025';
  const file = `${2200 + n}LS.pdf`;
  return {
    schema: 'nter.citation_pack/1.1',
    source_key: key(n),
    desk_tier: 'national',
    desk_feature: BILLS,
    desk_rows_feature: BILLS,
    doc_type: 'bill',
    title: name,
    file_name: file,
    file_url: `https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/${file}?source=legislation`,
    servable: true,
    licence_class: LICENCE,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: 2,
    page_split: 'exact',
    citation: {
      kind: 'bill',
      bill_name: name,
      bill_number: String(n),
      bill_year: '2025',
      house: 'Lok Sabha',
      version: 'as_introduced',
      status: 'Pending',
      introduced_on: '2025-03-04',
    },
    links: [{
      tier: 'national',
      feature: BILLS,
      row_key: `row-${n}`,
      document_key: `bill:2025:${n}`,
      role: 'as_introduced',
      house: 'Lok Sabha',
      bill_name: name,
      bill_number: String(n),
      bill_year: '2025',
    }],
    pages,
    text,
    ...over,
  };
}

/** A record whose text was replaced, with every hash, count and span following it. */
async function withText(r: Rec, texts: string[]): Promise<Rec> {
  const text = texts.join('\f');
  let at = 0;
  const pages = texts.map((t, i) => {
    const p = { page_number: i + 1, char_from: at, char_to: at + [...t].length, text: t };
    at = p.char_to + 1;
    return p;
  });
  return {
    ...r,
    text,
    pages,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: texts.length,
  };
}

const withCitation = (r: Rec, c: Rec): Rec => ({ ...r, citation: { ...(r.citation as Rec), ...c } });
const withLink = (r: Rec, l: Rec): Rec => ({ ...r, links: [{ ...(r.links as Rec[])[0], ...l }] });

const screen = () => makeBillsScreen();
const CLEAN_ROWS = (n: number) => Array.from({ length: n }, (_, i) => liveRow(`bill:2025:${i + 1}`));

/** Every finding the screen makes, by source_key, running `one` per record and `all` once over the set. */
async function runAll(records: Rec[], ctx = ctxOf(new FakeLive(CLEAN_ROWS(records.length + 5))), checks?: Check[]) {
  const out = new Map<string, Finding[]>();
  const put = (k: string, fs: Finding[]) => out.set(k, [...(out.get(k) ?? []), ...fs]);
  for (const c of checks ?? screen().checks) {
    if (c.one) { for (const r of records) put(String(r.source_key), await c.one(r, ctx)); }
    if (c.all) { for (const [k, fs] of await c.all(records, ctx)) put(k, fs); }
  }
  return out;
}
const reasons = (m: Map<string, Finding[]>, k: string) => (m.get(k) ?? []).map((f) => f.reason).sort();
const checkNamed = (name: string) => {
  const c = screen().checks.find((x) => x.name === name);
  assert(c, `no check ${name}`);
  return c;
};
const oneReasons = async (name: string, r: Rec, ctx = ctxOf()) =>
  (await checkNamed(name).one!(r, ctx)).map((f) => f.reason);

Deno.test('screen definition: collection, version, rules files, all five review checks covered', () => {
  const s = screen();
  assertEquals(s.collection, 'national-bills');
  assertEquals(s.mappingVersion, 'bills-screen-v1');
  assertEquals(s.rulesFiles, [
    'scripts/bulk-runner/screens/bills.ts',
    'scripts/bulk-runner/screen.ts',
    'scripts/bulk-runner/screen_types.ts',
    'scripts/bulk-runner/screens/index.ts',
    'scripts/bulk-runner/live.ts',
    'scripts/bulk-runner/page_check.ts',
  ]);
  const covered = new Set(s.checks.flatMap((c) => c.covers));
  for (const c of REVIEW_CHECKS) assert(covered.has(c), `${c} not covered`);
  for (const c of s.checks) assert(!!c.one !== !!c.all, `${c.name} must have exactly one of one/all`);
  assertEquals(s.checks.filter((c) => c.needs === 'live').map((c) => c.name).sort(), [
    'already_live',
    'duplicate_text_live',
    'listing_row',
    'role_held_live',
  ]);
});

Deno.test("extra checks follow the screen's own, in order", () => {
  const page: Check = { name: 'page_text', covers: ['completeness'], needs: 'pages', one: () => Promise.resolve([]) };
  const base = screen().checks.map((c) => c.name);
  assertEquals(makeBillsScreen([page]).checks.map((c) => c.name), [...base, 'page_text']);
});

Deno.test('a clean record passes every check, and so does a set of them', async () => {
  const records = [await bill(1), await bill(2), await bill(3)];
  const found = await runAll(records);
  assertEquals([...found.values()].flat(), []);
});

Deno.test('record shape: each wrong field is bad_shape and names the field', async () => {
  const cases: [string, Rec][] = [
    ['schema', { schema: 'other/1' }],
    ['schema', { schema: undefined }],
    ['source_key', { source_key: 'abc' }],
    ['source_key', { source_key: 'A'.repeat(40) }],
    ['desk_tier', { desk_tier: 'law' }],
    ['desk_feature', { desk_feature: 'Parliamentary Question Database' }],
    ['desk_rows_feature', { desk_rows_feature: 'Other' }],
    ['doc_type', { doc_type: 'parl_question' }],
    ['doc_type', { doc_type: 7 }],
  ];
  for (const [field, over] of cases) {
    const f = await checkNamed('record_shape').one!(await bill(1, over), ctxOf());
    assertEquals(f.map((x) => x.reason), ['bad_shape'], field);
    assertEquals(f[0].detail, field);
    assertEquals(f[0].covers, ['identity']);
  }
  assertEquals(await oneReasons('record_shape', await bill(1, { doc_type: 'corrigendum' })), []);
});

Deno.test('official source: the URL rule, no parent segment, and file_name is the last path segment', async () => {
  const bad = [
    'http://sansad.in/getFile/BillsTexts/x/2201LS.pdf',
    'https://sansad.in/getFile/Other/x/2201LS.pdf',
    'https://evil.example/getFile/BillsTexts/x/2201LS.pdf',
    'https://sansad.in/getFile/BillsTexts/../x/2201LS.pdf',
    'https://sansad.in.evil.example/getFile/BillsTexts/x/2201LS.pdf',
  ];
  for (const file_url of bad) {
    assertEquals(await oneReasons('official_source', await bill(1, { file_url })), ['not_official_url'], file_url);
  }
  assertEquals(await oneReasons('official_source', await bill(1, { file_url: undefined })), ['not_official_url']);
  assertEquals(await oneReasons('official_source', await bill(1, { file_url: 5 })), ['not_official_url']);
  assertEquals(await oneReasons('official_source', await bill(1, { file_name: 'other.pdf' })), ['file_name_mismatch']);
  assertEquals(await oneReasons('official_source', await bill(1, { file_name: undefined })), ['file_name_mismatch']);
  // File names with spaces: the URL path is percent-encoded, the file name is not.
  const spaced = 'https://sansad.in/getFile/BillsTexts/x/nationl%20food%20LXI%20of%2008.pdf?source=legislation';
  assertEquals(
    await oneReasons('official_source', await bill(1, { file_url: spaced, file_name: 'nationl food LXI of 08.pdf' })),
    [],
  );
  assertEquals(
    await oneReasons(
      'official_source',
      await bill(1, { file_url: spaced, file_name: 'nationl%20food%20LXI%20of%2008.pdf' }),
    ),
    ['file_name_mismatch'],
  );
  const raw = 'https://sansad.in/getFile/BillsTexts/x/a b.pdf';
  assertEquals(await oneReasons('official_source', await bill(1, { file_url: raw, file_name: 'a b.pdf' })), []);
  // A malformed percent-encoding cannot be decoded: held, not guessed.
  const broken = 'https://sansad.in/getFile/BillsTexts/x/bad%E0%A4%A.pdf';
  assertEquals(await oneReasons('official_source', await bill(1, { file_url: broken, file_name: 'bad%E0%A4%A.pdf' })), [
    'file_name_mismatch',
  ]);
  const pdfs = 'https://sansad.in/getFile/BillsPDFFiles/a/b/9LS.pdf';
  assertEquals(await oneReasons('official_source', await bill(1, { file_url: pdfs, file_name: '9LS.pdf' })), []);
});

Deno.test('citation complete: number, year, house, name and role, each missing or wrong', async () => {
  const cases: [string, Rec][] = [
    ['bill_number', { bill_number: undefined }],
    ['bill_number', { bill_number: '12a' }],
    ['bill_number', { bill_number: {} }],
    ['bill_year', { bill_year: '25' }],
    ['bill_year', { bill_year: undefined }],
    ['house', { house: 'Vidhan Sabha' }],
    ['house', { house: undefined }],
    ['bill_name', { bill_name: 'Bill' }],
    ['bill_name', { bill_name: 'हिन्दी विधेयक, 2025' }],
    ['bill_name', { bill_name: undefined }],
    ['version', { version: 'draft' }],
    ['version', { version: undefined }],
  ];
  for (const [field, over] of cases) {
    const f = await checkNamed('citation_complete').one!(withCitation(await bill(1), over), ctxOf());
    assertEquals(f.map((x) => x.reason), ['citation_incomplete'], field);
    assertEquals(f[0].detail, field);
  }
  const noCitation = await checkNamed('citation_complete').one!(await bill(1, { citation: undefined }), ctxOf());
  assertEquals(noCitation.map((x) => x.reason), ['citation_incomplete']);
  // Roman numbers (Rajya Sabha), all seven roles, and a numeric year/number are fine.
  for (
    const version of [
      'as_introduced',
      'as_passed_lok_sabha',
      'as_passed_rajya_sabha',
      'as_passed_both_houses',
      'gazette_notification',
      'synopsis',
      'errata',
    ]
  ) {
    assertEquals(
      await oneReasons(
        'citation_complete',
        withCitation(await bill(1), { version, bill_number: 'LXII', house: 'Rajya Sabha' }),
      ),
      [],
      version,
    );
  }
  assertEquals(
    await oneReasons('citation_complete', withCitation(await bill(1), { bill_number: 12, bill_year: 2025 })),
    [],
  );
});

Deno.test('billNorm mirrors the SQL: closing year removed, letters and digits only', () => {
  assertEquals(billNorm('The River Navigation (Amendment) Bill, 2025'), 'theriver' + 'navigationamendmentbill');
  assertEquals(billNorm('The Finance Bill, 2024.'), 'thefinancebill');
  assertEquals(billNorm(undefined), '');
});

// Ground truth: public.bill_norm evaluated on the production database (read-only). There `\s` matches the Unicode
// White_Space characters (NBSP, figure space, narrow no-break space, em space, ideographic space) but not U+FEFF.
Deno.test('billNorm equals public.bill_norm on the production database (14 vectors)', () => {
  const vectors: [string, string][] = [
    ['A Bill, 2025', 'abill'],
    ['A Bill, 2025\u00a0', 'abill'],
    ['A Bill, 2025\u2007', 'abill'],
    ['A Bill, 2025\u202f', 'abill'],
    ['A Bill, 2025\ufeff', 'abill2025'],
    ['A Bill, 2025\u2003', 'abill'],
    ['A Bill, 2025\u3000', 'abill'],
    ['The \u00c1nti-Bill (No. 2), 2019', 'thentibillno2'],
    ['THE   Code \u00a0of Bill , 2011  ', 'thecodeofbill'],
    ['Bill 2011 Amendment, 2012', 'bill2011amendment'],
    ['R\u0101\u1e63\u1e6dra Bill, 2020', 'rrabill'],
    ['Bill,2020.', 'bill'],
    ['  ', ''],
    ['\u092c\u093f\u0932, 2020', ''],
  ];
  vectors.forEach(([input, want], i) => assertEquals(billNorm(input), want, `vector ${i + 1}`));
  assertEquals(billNorm(undefined), '');
  assertEquals(billNorm(null), '');
});

Deno.test('links agree: none, wrong tier, feature, key, house, number, year, and a non-object link', async () => {
  assertEquals(await oneReasons('links_agree', await bill(1, { links: [] })), ['no_link']);
  assertEquals(await oneReasons('links_agree', await bill(1, { links: undefined })), ['no_link']);
  const cases: [string, Rec][] = [
    ['tier', { tier: 'law' }],
    ['feature', { feature: 'Other' }],
    ['document_key', { document_key: 'bill:2025:99' }],
    ['document_key', { document_key: 'bill:2024:1' }],
    ['house', { house: 'Rajya Sabha' }],
    ['bill_number', { bill_number: '2' }],
    ['bill_year', { bill_year: '2024' }],
    ['role', { role: 'synopsis' }],
    ['role', { role: undefined }],
  ];
  for (const [field, over] of cases) {
    const f = await checkNamed('links_agree').one!(withLink(await bill(1), over), ctxOf());
    assertEquals(f.map((x) => x.reason), ['link_disagrees'], field);
    assert(f[0].detail?.includes(field), `${field}: ${f[0].detail}`);
  }
  const f = await checkNamed('links_agree').one!(await bill(1, { links: [null] }), ctxOf());
  assertEquals(f.map((x) => x.reason), ['link_disagrees']);
  // One good link and one bad link: the bad one is found.
  const r = await bill(1);
  const both = { ...r, links: [(r.links as Rec[])[0], { ...(r.links as Rec[])[0], house: 'Rajya Sabha' }] };
  const two = await checkNamed('links_agree').one!(both, ctxOf());
  assertEquals(two.map((x) => x.detail), ['link 1: house']);
  assertEquals(await oneReasons('links_agree', await bill(1)), []);
});

Deno.test('listing row: one read for the whole set; a row needs the key and the house', async () => {
  const live = new FakeLive([
    liveRow('bill:2025:1'),
    liveRow('bill:2025:2', 'Rajya Sabha'), // right key, wrong house
    liveRow('bill:2025:4'),
  ]);
  const records = [await bill(1), await bill(2), await bill(3), await bill(4), await bill(5)];
  const found = await checkNamed('listing_row').all!(records, ctxOf(live));
  assertEquals(live.rowCalls.length, 1, 'one deskRows call for five records');
  assertEquals(live.rowCalls[0].tier, 'national');
  assertEquals(live.rowCalls[0].feature, BILLS);
  assertEquals([...live.rowCalls[0].documentKeys].sort(), [
    'bill:2025:1',
    'bill:2025:2',
    'bill:2025:3',
    'bill:2025:4',
    'bill:2025:5',
  ]);
  assertEquals([...found.keys()].sort(), [key(2), key(3), key(5)]);
  assertEquals(found.get(key(2))![0].reason, 'no_live_row');
  assertEquals(found.get(key(2))![0].covers, ['identity']);
});

Deno.test('listing row: a record whose key or house cannot be read is held, not passed; a shared key is read once', async () => {
  const live = new FakeLive([liveRow('bill:2025:1')]);
  const records = [
    await bill(1),
    await bill(1, { source_key: key(9) }), // same bill, another document
    withCitation(await bill(2), { bill_year: undefined }),
    withCitation(await bill(3), { house: undefined }),
  ];
  const found = await checkNamed('listing_row').all!(records, ctxOf(live));
  assertEquals([...found.keys()].sort(), [key(2), key(3)]);
  assertEquals(live.rowCalls[0].documentKeys.sort(), ['bill:2025:1', 'bill:2025:3']);
  // Nothing to look up: no read at all.
  const none = new FakeLive();
  await checkNamed('listing_row').all!([withCitation(await bill(2), { bill_year: undefined })], ctxOf(none));
  assertEquals(none.rowCalls.length, 0);
});

Deno.test('text binds: hash, n_chars, page_split, each page-span break', async () => {
  const r = await bill(1);
  const spans = r.pages as Rec[];
  const hashBad = await checkNamed('text_binds').one!({ ...r, content_sha256: 'a'.repeat(64) }, ctxOf());
  assertEquals(hashBad.map((x) => x.reason), ['text_hash_mismatch']);
  assertEquals(
    (await checkNamed('text_binds').one!({ ...r, content_sha256: undefined }, ctxOf())).map((x) => x.reason),
    ['text_hash_mismatch'],
  );
  assertEquals((await checkNamed('text_binds').one!({ ...r, text: undefined }, ctxOf())).map((x) => x.reason), [
    'text_hash_mismatch',
  ]);
  assertEquals(await oneReasons('text_binds', { ...r, n_chars: (r.n_chars as number) + 1 }), ['n_chars_mismatch']);
  assertEquals(await oneReasons('text_binds', { ...r, n_chars: undefined }), ['n_chars_mismatch']);
  assertEquals(await oneReasons('text_binds', { ...r, page_split: 'approx' }), ['page_split']);
  assertEquals(await oneReasons('text_binds', { ...r, page_split: undefined }), ['page_split']);

  const span = async (pages: unknown, extra: Rec = {}) => {
    const f = await checkNamed('text_binds').one!({ ...r, pages, ...extra }, ctxOf());
    assertEquals(f.map((x) => x.reason), ['page_spans']);
    return f[0].detail;
  };
  assertEquals(await span([{ ...spans[0], page_number: 2 }, spans[1]]), 'page 1: numbered 2');
  assertEquals(
    await span([spans[0], { ...spans[1], char_from: spans[1].char_from as number + 1 }]),
    'page 2: span not contiguous',
  );
  assertEquals(await span([spans[0], { ...spans[1], text: 'different' }]), 'page 2: text differs from its span');
  assertEquals(await span([spans[0]]), 'pages do not reach the end of the text');
  assertEquals(await span(spans, { page_count: 3 }), 'page_count differs from the pages');
  assertEquals(await span([spans[0], { ...spans[1], char_from: 'x' }]), 'page 2: not a span');
  assertEquals(await span(undefined), 'pages missing');
  assertEquals(await span([]), 'pages missing');
  // Pages joined by a space, not a form feed: everything else binds, only the separator is wrong.
  const texts = PAGE_TEXTS(1);
  const spaced = await withText(r, texts);
  const text = texts.join(' ');
  const noFf = { ...spaced, text, content_sha256: await sha256Hex(text), n_chars: [...text].length };
  const f = await checkNamed('text_binds').one!(noFf, ctxOf());
  assertEquals(f.map((x) => [x.reason, x.detail]), [['page_spans', 'page 2: no form feed before it']]);
  assertEquals(await oneReasons('text_binds', r), []);
});

Deno.test('text binds: counts code points', async () => {
  const astral = await withText(await bill(1), ['𝔅ill text 😀 here', 'second 😀 page']);
  assertEquals(await oneReasons('text_binds', astral), []);
});

Deno.test('text binds: page_split none passes only if page_count equals the page spans (prepare and admission)', async () => {
  const base = await bill(1);
  const pages = base.pages as Rec[];
  const none = { ...base, page_split: 'none' };
  const run = async (o: Rec) => {
    const f = await checkNamed('text_binds').one!({ ...none, ...o }, ctxOf());
    return f.map((x) => [x.reason, x.detail]);
  };
  // No spans and a page_count of 1 would make the worker refuse (page count mismatch).
  assertEquals(await run({ pages: [], page_count: 1 }), [['page_count_unsplittable', '1 declared, 0 spans']]);
  assertEquals(await run({ pages: undefined, page_count: 5 }), [['page_count_unsplittable', '5 declared, 0 spans']]);
  assertEquals(await run({ pages: [], page_count: undefined }), [['page_count_unsplittable', 'page_count missing']]);
  assertEquals(await run({ pages: [], page_count: 0 }), []);
  assertEquals(await run({ pages: undefined, page_count: 0 }), []);
  // Spans present: page_count must equal them, and the spans are checked as for exact.
  assertEquals(await run({}), []);
  assertEquals(await run({ page_count: 3 }), [['page_count_unsplittable', '3 declared, 2 spans']]);
  assertEquals(await run({ pages: [pages[0], { ...pages[1], page_number: 5 }] }), [[
    'page_spans',
    'page 2: numbered 5',
  ]]);
});

Deno.test('text binds: page spans without text are cut from the record text and need no text field', async () => {
  const r = await bill(1);
  const bare = (r.pages as Rec[]).map(({ text: _t, ...span }) => span);
  assertEquals(await oneReasons('text_binds', { ...r, pages: bare }), []);
  // Still contiguous and numbered.
  assertEquals(await oneReasons('text_binds', { ...r, pages: [bare[0], { ...bare[1], char_from: 1 }] }), [
    'page_spans',
  ]);
});

Deno.test('length: under 200 and over 600,000 characters, and no text', async () => {
  const short = await withText(await bill(1), ['short']);
  assertEquals(await oneReasons('length', short), ['too_short']);
  const edge = await withText(await bill(1), ['x'.repeat(199)]);
  assertEquals(await oneReasons('length', edge), ['too_short']);
  const ok = await withText(await bill(1), ['x'.repeat(200)]);
  assertEquals(await oneReasons('length', ok), []);
  const max = await withText(await bill(1), ['x'.repeat(600_000)]);
  assertEquals(await oneReasons('length', max), []);
  const long = await withText(await bill(1), ['x'.repeat(600_001)]);
  assertEquals(await oneReasons('length', long), ['too_long']);
  assertEquals(await oneReasons('length', { ...(await bill(1)), text: undefined }), ['too_short']);
});

Deno.test('servable and licence: not servable, barred, personal data, and fields that cannot be judged', async () => {
  const name = 'servable_licence';
  assertEquals(await oneReasons(name, await bill(1, { servable: false })), ['not_servable']);
  // v1.1 records have no servable field: absent counts as servable. Only an explicit false holds; anything else is malformed.
  assertEquals(await oneReasons(name, await bill(1, { servable: undefined })), []);
  assertEquals(await oneReasons(name, await bill(1, { servable: true })), []);
  assertEquals(await oneReasons(name, await bill(1, { servable: 'yes' })), ['servable_malformed']);
  assertEquals(await oneReasons(name, await bill(1, { servable: null })), ['servable_malformed']);
  assertEquals(await oneReasons(name, await bill(1, { servable: 0 })), ['servable_malformed']);
  assertEquals(await oneReasons(name, await bill(1, { licence_class: 'BARRED_PRIVATE' })), ['licence_barred']);
  assertEquals(await oneReasons(name, await bill(1, { licence_class: undefined })), ['licence_barred']);
  assertEquals(await oneReasons(name, await bill(1, { licence_class: 'eci_govt_PERSONAL_DATA_G02' })), [
    'personal_data',
  ]);
  assertEquals(await oneReasons(name, await bill(1, { licence_class: 'BARRED_PERSONAL_DATA' })), [
    'licence_barred',
    'personal_data',
  ]);
  assertEquals(await oneReasons(name, await bill(1, { servable: false, licence_class: 'BARRED_X' })), [
    'not_servable',
    'licence_barred',
  ]);
  assertEquals(await oneReasons(name, await bill(1, { licence_class: 'NOT_BARRED_X' })), []);
  assertEquals(await oneReasons(name, await bill(1)), []);
  assertEquals((await checkNamed(name).one!(await bill(1, { servable: false }), ctxOf()))[0].covers, ['sensitivity']);
});

Deno.test("licence admitted: only the collection's classes; refuses to run without the setting", async () => {
  const name = 'licence_admitted';
  assertEquals(await oneReasons(name, await bill(1)), []);
  assertEquals(await oneReasons(name, await bill(1, { licence_class: 'OPEN' })), ['licence_not_admitted']);
  assertEquals(await oneReasons(name, await bill(1, { licence_class: undefined })), ['licence_not_admitted']);
  assertEquals(
    await oneReasons(
      name,
      await bill(1, { licence_class: 'OPEN' }),
      ctxOf(new FakeLive(), { licenceClasses: ['OPEN', LICENCE] }),
    ),
    [],
  );
  assertEquals(await oneReasons(name, await bill(1), ctxOf(new FakeLive(), { licenceClasses: [] })), [
    'licence_not_admitted',
  ]);
  for (const settings of [{}, { licenceClasses: 'OPEN' }, { licenceClasses: [1] }]) {
    await assertRejects(
      async () => void await checkNamed(name).one!(await bill(1), ctxOf(new FakeLive(), settings)),
      Error,
      'licenceClasses',
    );
  }
  assertEquals((await checkNamed(name).one!(await bill(1, { licence_class: 'OPEN' }), ctxOf()))[0].covers, ['rights']);
});

Deno.test('already live: by source_key or by file_url, one read for the whole set', async () => {
  const records = [await bill(1), await bill(2), await bill(3), await bill(4)];
  const live = new FakeLive([], [
    liveDoc({ source_key: key(1) }),
    liveDoc({ id: 'd2', file_url: records[2].file_url as string }),
    liveDoc({ id: 'd3', source_key: key(77), file_url: 'https://sansad.in/getFile/BillsTexts/other.pdf' }),
  ]);
  const found = await checkNamed('already_live').all!(records, ctxOf(live));
  assertEquals(live.docCalls.length, 1);
  assertEquals(live.docCalls[0].sourceKeys.length, 4);
  assertEquals(live.docCalls[0].fileUrls.length, 4);
  assertEquals([...found.keys()].sort(), [key(1), key(3)]);
  assertEquals(found.get(key(1))![0].reason, 'already_live');
  assertEquals(found.get(key(1))![0].covers, ['dedupe']);
});

Deno.test('already live: a record with no file_url cannot be judged and is held', async () => {
  const found = await checkNamed('already_live').all!([await bill(1, { file_url: undefined })], ctxOf(new FakeLive()));
  assertEquals(found.get(key(1))?.map((f) => f.reason), ['already_live']);
});

/** Another record with exactly this record's text (pages, hash and counts follow it). */
const sameText = async (n: number, of: Rec, over: Rec = {}): Promise<Rec> => ({
  ...(await bill(n, over)),
  text: of.text,
  pages: of.pages,
  content_sha256: of.content_sha256,
  n_chars: of.n_chars,
});

Deno.test('duplicate text: the lowest source_key stays, the rest are held, others untouched', async () => {
  const a = await bill(1), c = await bill(3), d = await bill(4);
  const records = [await sameText(3, a), a, await sameText(2, a), d];
  void c;
  const found = await checkNamed('duplicate_text').all!(records, ctxOf());
  assertEquals([...found.keys()].sort(), [key(2), key(3)]);
  assertEquals(found.get(key(3))![0].reason, 'duplicate_text');
  assertEquals(found.get(key(3))![0].detail, `same text as ${key(1)}`);
  assertEquals(found.get(key(3))![0].covers, ['dedupe']);
  // Two groups at once.
  const g = await checkNamed('duplicate_text').all!([a, await sameText(2, a), c, await sameText(4, c)], ctxOf());
  assertEquals([...g.keys()].sort(), [key(2), key(4)]);
  // A text that cannot be read cannot be judged.
  const bad = await checkNamed('duplicate_text').all!([{ ...a, text: undefined }, { ...d, text: 5 }], ctxOf());
  assertEquals([...bad.keys()].sort(), [key(1), key(4)]);
});

Deno.test('duplicate text compares the hash prepare will store: texts equal after layout-break normalisation', async () => {
  // prepare turns vertical tabs and form feeds into line breaks and drops other control codes before it hashes.
  const base = 'Clause one of the bill, in full. '.repeat(10);
  const a = await withText(await bill(1), [`${base}\n${base}`]);
  const b = await withText(await bill(2), [`${base}\x0b${base}`]); // a layout break, stored as a line break
  const c = await withText(await bill(3), [`${base}\x01\n${base}`]); // a control code, removed
  assert(a.content_sha256 !== b.content_sha256 && a.content_sha256 !== c.content_sha256, 'the pack hashes differ');
  const found = await checkNamed('duplicate_text').all!([c, b, a], ctxOf());
  assertEquals([...found.keys()].sort(), [key(2), key(3)]);
  assertEquals(found.get(key(2))![0].detail, `same text as ${key(1)}`);
});

Deno.test('duplicate text live: a live document with the stored hash holds the record, by one read of the hashes', async () => {
  const records = [await bill(1), await bill(2), await bill(3)];
  const base = 'Clause one of the bill, in full. '.repeat(10);
  const vt = await withText(await bill(4), [`${base}\x0b${base}`]);
  const stored = await sha256Hex(`${base}\n${base}`);
  // prepare stores form feeds as line breaks too, so a record's stored hash is not its pack hash.
  const storedOf = (r: Rec) => sha256Hex((r.text as string).replaceAll('\f', '\n'));
  const live = new FakeLive([], [
    liveDoc({ id: 'h1', source_key: key(90), content_sha256: await storedOf(records[1]) }),
    liveDoc({ id: 'h2', source_key: key(91), content_sha256: stored }),
    liveDoc({ id: 'h3', source_key: key(3), content_sha256: await storedOf(records[2]) }), // the record itself
  ]);
  const found = await checkNamed('duplicate_text_live').all!([...records, vt], ctxOf(live));
  assertEquals(live.docCalls.length, 1);
  assertEquals(live.docCalls[0].contentHashes?.length, 4);
  assertEquals([...found.keys()].sort(), [key(2), key(4)]);
  assertEquals(found.get(key(2))![0].reason, 'duplicate_text_live');
  assertEquals(found.get(key(2))![0].covers, ['dedupe']);
  assertEquals(found.get(key(2))![0].detail, `held by ${key(90)}`);
  // The empty-text hash is never a duplicate (SQL: content_sha256 <> e3b0c442...).
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const none = await checkNamed('duplicate_text_live').all!(
    [await bill(1, { text: '' })],
    ctxOf(new FakeLive([], [liveDoc({ source_key: key(90), content_sha256: empty })])),
  );
  assertEquals(none.size, 0); // the length check holds an empty text; it is never a duplicate of the empty hash
});

Deno.test('bill_role_collision: records sharing key, house and role (not errata) are all held, none picked', async () => {
  const mk = (n: number, over: Rec = {}) => bill(n, over);
  const a = await mk(1), b = await mk(2, { source_key: key(50) });
  const sameBill = (r: Rec, k: string) => ({
    ...r,
    source_key: k,
    citation: { ...(r.citation as Rec) },
    links: r.links,
  });
  const x = sameBill(a, key(10)), y = sameBill(a, key(11));
  const otherRole = withCitation(sameBill(a, key(12)), { version: 'synopsis' });
  const otherHouse = withCitation(sameBill(a, key(13)), { house: 'Rajya Sabha' });
  const errata1 = withCitation(sameBill(a, key(14)), { version: 'errata' });
  const errata2 = withCitation(sameBill(a, key(15)), { version: 'errata' });
  const lone = withCitation(sameBill(a, key(16)), { bill_number: '9' });
  const found = await checkNamed('role_collision').all!(
    [x, y, otherRole, otherHouse, errata1, errata2, lone, b],
    ctxOf(),
  );
  assertEquals([...found.keys()].sort(), [key(10), key(11)]);
  for (const k of [key(10), key(11)]) {
    assertEquals(found.get(k)!.map((f) => f.reason), ['bill_role_collision']);
    assertEquals(found.get(k)![0].covers, ['dedupe']);
  }
  assertEquals(found.get(key(10))![0].detail, `shared with ${key(11)}`);
  // Three records: each names the others.
  const z = sameBill(a, key(17));
  const three = await checkNamed('role_collision').all!([x, y, z], ctxOf());
  assertEquals([...three.keys()].sort(), [key(10), key(11), key(17)]);
  assertEquals(three.get(key(10))![0].detail, `shared with ${key(11)}, ${key(17)}`);
  // A record whose key, house or role cannot be read cannot collide on it (citation_complete holds it).
  const unreadable = withCitation(sameBill(a, key(18)), { version: undefined });
  assertEquals((await checkNamed('role_collision').all!([x, unreadable], ctxOf())).size, 0);
});

Deno.test('role_held_live: a live Bills document of the key, house (or none) and role holds the record; errata never', async () => {
  const live = new FakeLive([], [
    liveDoc({
      id: 'a',
      source_key: key(80),
      document_key: 'bill:2025:1',
      house: 'Lok Sabha',
      document_role: 'as_introduced',
    }),
    liveDoc({ id: 'b', source_key: key(81), document_key: 'bill:2025:2', house: null, document_role: 'as_introduced' }), // no house: counts
    liveDoc({
      id: 'c',
      source_key: key(82),
      document_key: 'bill:2025:3',
      house: 'Rajya Sabha',
      document_role: 'as_introduced',
    }),
    liveDoc({
      id: 'd',
      source_key: key(83),
      document_key: 'bill:2025:4',
      house: 'Lok Sabha',
      document_role: 'synopsis',
    }),
    liveDoc({ id: 'e', source_key: key(84), document_key: 'bill:2025:5', house: 'Lok Sabha', document_role: 'errata' }),
    liveDoc({
      id: 'f',
      source_key: key(85),
      document_key: 'bill:2025:6',
      house: 'Lok Sabha',
      document_role: 'as_introduced',
      desk_feature: 'Other',
    }),
  ]);
  const records = [
    await bill(1),
    await bill(2),
    await bill(3),
    await bill(4),
    withCitation(await bill(5), { version: 'errata' }),
    await bill(6),
    await bill(7),
  ];
  const found = await checkNamed('role_held_live').all!(records, ctxOf(live));
  assertEquals(live.docCalls.length, 1);
  assertEquals(live.docCalls[0].tier, 'national');
  assertEquals(live.docCalls[0].feature, BILLS);
  assertEquals([...(live.docCalls[0].documentKeys ?? [])].sort().length, 6); // the errata record asks nothing
  assertEquals([...found.keys()].sort(), [key(1), key(2)]);
  assertEquals(found.get(key(1))![0].reason, 'bill_role_held_live');
  assertEquals(found.get(key(1))![0].covers, ['dedupe']);
  assertEquals(found.get(key(1))![0].detail, `held by ${key(80)}`);
  // A reader that returns documents of other features anyway does not make the record held.
  live.leaky = true;
  const leaked = await checkNamed('role_held_live').all!([await bill(6)], ctxOf(live));
  assertEquals(leaked.size, 0);
  // Nothing readable to look up: no read.
  const none = new FakeLive();
  await checkNamed('role_held_live').all!([withCitation(await bill(1), { bill_year: undefined })], ctxOf(none));
  assertEquals(none.docCalls.length, 0);
});

Deno.test('file_url_collision: records sharing a file_url are all held', async () => {
  const a = await bill(1), b = await bill(2, { file_url: a.file_url, file_name: a.file_name }), c = await bill(3);
  const found = await checkNamed('file_url_collision').all!([b, a, c], ctxOf());
  assertEquals([...found.keys()].sort(), [key(1), key(2)]);
  assertEquals(found.get(key(1))![0].reason, 'file_url_collision');
  assertEquals(found.get(key(1))![0].covers, ['dedupe']);
  assertEquals(found.get(key(1))![0].detail, `shared with ${key(2)}`);
  // No file_url: nothing to collide on (official_source holds it).
  assertEquals(
    (await checkNamed('file_url_collision').all!(
      [{ ...a, file_url: undefined }, { ...b, file_url: undefined }],
      ctxOf(),
    )).size,
    0,
  );
});

Deno.test('corrigenda are held corrigendum_unmapped, by doc_type or by the errata role', async () => {
  assertEquals(await oneReasons('corrigendum', await bill(1, { doc_type: 'corrigendum' })), ['corrigendum_unmapped']);
  assertEquals(await oneReasons('corrigendum', withCitation(await bill(1), { version: 'errata' })), [
    'corrigendum_unmapped',
  ]);
  assertEquals(await oneReasons('corrigendum', await bill(1)), []);
  const found = await runAll([await bill(1, { doc_type: 'corrigendum' })]);
  assert(reasons(found, key(1)).includes('corrigendum_unmapped'));
});

Deno.test('findings never carry record text, only keys, numbers and reason names', async () => {
  const secret = 'ZZSECRETTEXTZZ';
  const r = await withText(await bill(1, { title: secret }), [`${secret} short`]);
  const bad: Rec = {
    ...r,
    file_url: `https://x.example/${secret}`,
    licence_class: `BARRED_${secret}`,
    content_sha256: 'x',
  };
  const found = await runAll([bad, { ...bad, source_key: key(2) }]);
  const json = JSON.stringify([...found.values()]);
  assert(found.size > 0 && json.length > 10);
  assert(!json.includes(secret), json);
});

Deno.test('the whole screen holds each failing record with its named reasons, and passes the clean one', async () => {
  const clean = await bill(1);
  const dup = await sameText(2, clean);
  const rowless = await bill(7);
  const live = new FakeLive([liveRow('bill:2025:1'), liveRow('bill:2025:2'), liveRow('bill:2025:3')], [
    liveDoc({ source_key: key(3) }),
  ]);
  const records = [clean, dup, await bill(3), rowless];
  const found = await runAll(records, ctxOf(live));
  assertEquals(reasons(found, key(1)), []);
  assert(reasons(found, key(2)).includes('duplicate_text'));
  assertEquals(reasons(found, key(3)), ['already_live']);
  assertEquals(reasons(found, key(7)), ['no_live_row']);
  assertEquals(live.rowCalls.length, 1);
  assertEquals(live.docCalls.length, 3, 'one read per live check: source keys and URLs, role, text hash');
});

Deno.test('every finding names its check and the review checks it covers', async () => {
  const found = await runAll([await bill(1, { servable: false, doc_type: 'corrigendum' })]);
  for (const f of found.get(key(1))!) {
    const c = checkNamed(f.check);
    assertEquals(f.covers, c.covers);
  }
});

Deno.test('listing row: the name must match a row of the key and house (bill_norm, exact), else listing_name_mismatch', async () => {
  const live = new FakeLive([
    liveRow('bill:2025:1', 'Lok Sabha', { bill_name: 'the river navigation amendment bill 2025.' }), // case and punctuation
    liveRow('bill:2025:2', 'Lok Sabha', { bill_name: 'The Coastal Shipping Bill, 2025' }), // another bill, same key
    liveRow('bill:2025:3', 'Lok Sabha', { bill_name: 'The River Navigation (Amendment) Bill, 2024' }), // year differs: removed
    liveRow('bill:2025:4', 'Lok Sabha', { bill_name: 'The River Navigation Bill, 2025' }), // part of the name only
    liveRow('bill:2025:5', 'Lok Sabha', { bill_name: undefined }),
    liveRow('bill:2025:6', 'Lok Sabha', { bill_name: 'The Coastal Shipping Bill, 2025' }),
    liveRow('bill:2025:6', 'Lok Sabha'), // a second row of the key: one match is enough
  ]);
  const records = [1, 2, 3, 4, 5, 6].map((n) => bill(n));
  const found = await checkNamed('listing_row').all!(await Promise.all(records), ctxOf(live));
  assertEquals(live.rowCalls.length, 1);
  assertEquals([...found.keys()].sort(), [key(2), key(4), key(5)]);
  for (const k of [key(2), key(4), key(5)]) {
    assertEquals(found.get(k)!.map((f) => f.reason), ['listing_name_mismatch']);
    assertEquals(found.get(k)![0].covers, ['identity']);
  }
});

Deno.test('listing row: a name that cannot be read is held, never matched to a row with no name', async () => {
  const live = new FakeLive([liveRow('bill:2025:1', 'Lok Sabha', { bill_name: undefined })]);
  const r = withCitation(await bill(1), { bill_name: undefined });
  const found = await checkNamed('listing_row').all!([r], ctxOf(live));
  assertEquals(found.get(key(1))?.map((f) => f.reason), ['listing_name_mismatch']);
});

Deno.test('listing row: introduced_on must be within 3 days of the matching row, else listing_date_far', async () => {
  const at = (date: unknown) => new FakeLive([liveRow('bill:2025:1', 'Lok Sabha', { date_introduced: date })]);
  const run = async (date: unknown, introduced: unknown = '2025-03-04') => {
    const r = withCitation(await bill(1), { introduced_on: introduced });
    const found = await checkNamed('listing_row').all!([r], ctxOf(at(date)));
    return found.get(key(1))?.map((f) => f.reason) ?? [];
  };
  assertEquals(await run('2025-03-04'), []);
  assertEquals(await run('2025-03-07'), []); // 3 days after
  assertEquals(await run('2025-03-01'), []); // 3 days before
  assertEquals(await run('2025-03-08'), ['listing_date_far']);
  assertEquals(await run('2025-02-28'), ['listing_date_far']);
  assertEquals(await run('2025-03-31'), ['listing_date_far']);
  assertEquals(await run(undefined), ['listing_date_far']); // the row has no date
  assertEquals(await run('4 March 2025'), ['listing_date_far']);
  assertEquals(await run('2025-02-30'), ['listing_date_far']); // not a date
  // No introduced_on: the date is not checked.
  assertEquals(await run('2020-01-01', null), []);
  assertEquals(await run(undefined, null), []);
  // A date the record gives but that is not a date is ignored, as the SQL ignores it.
  assertEquals(await run('2020-01-01', '4 March 2025'), []);
  assertEquals(await run('2020-01-01', 20250304), []);
  assertEquals(await run('2020-01-01', '2025-02-30'), []);
});

Deno.test('listing row: the date is judged on the row whose name matches, and one matching row in range is enough', async () => {
  const live = new FakeLive([
    liveRow('bill:2025:1', 'Lok Sabha', {
      bill_name: 'The Coastal Shipping Bill, 2025',
      date_introduced: '2025-03-04',
    }),
    liveRow('bill:2025:1', 'Lok Sabha', { date_introduced: '2024-01-01' }), // name matches, date far
    liveRow('bill:2025:2', 'Lok Sabha', { date_introduced: '2024-01-01' }),
    liveRow('bill:2025:2', 'Lok Sabha', { date_introduced: '2025-03-05' }),
  ]);
  const found = await checkNamed('listing_row').all!([await bill(1), await bill(2)], ctxOf(live));
  assertEquals(found.get(key(1))?.map((f) => f.reason), ['listing_date_far']);
  assertEquals(found.has(key(2)), false);
  assertEquals(live.rowCalls.length, 1);
});

Deno.test('listing row: no row of the key and house stays no_live_row, before the name is judged', async () => {
  const live = new FakeLive([liveRow('bill:2025:1', 'Rajya Sabha', { bill_name: 'Another Bill, 2025' })]);
  const found = await checkNamed('listing_row').all!([await bill(1)], ctxOf(live));
  assertEquals(found.get(key(1))?.map((f) => f.reason), ['no_live_row']);
});

Deno.test('project: adds exactly document_key and document_role, from the links and citation.version', async () => {
  const s = screen();
  assert(s.project);
  const r = await bill(7);
  const p = s.project(r);
  assertEquals(p, { ...r, document_key: 'bill:2025:7', document_role: 'as_introduced' });
  assertEquals(Object.keys(p).filter((k) => !(k in r)).sort(), ['document_key', 'document_role']);
  assert(!('document_key' in r) && !('document_role' in r), 'the input is not changed');
  const rs = withCitation(await bill(8), {
    version: 'as_passed_both_houses',
    bill_number: 'VIII',
    house: 'Rajya Sabha',
  });
  const linked = withLink(rs, { document_key: 'bill:2025:VIII', bill_number: 'VIII', house: 'Rajya Sabha' });
  assertEquals(s.project(linked).document_key, 'bill:2025:VIII');
  assertEquals(s.project(linked).document_role, 'as_passed_both_houses');
  // An existing equal value is kept; the result is the same.
  const had = { ...r, document_key: 'bill:2025:7', document_role: 'as_introduced' };
  assertEquals(s.project(had), had);
});

Deno.test('project: throws, never guesses, on a missing value, disagreeing links, or a different existing value', async () => {
  const s = screen();
  assert(s.project, 'project exists');
  const project = s.project;
  const r = await bill(7);
  const bad: [string, Rec][] = [
    ['no links', { ...r, links: [] }],
    ['links absent', { ...r, links: undefined }],
    ['link without key', withLink(r, { document_key: undefined })],
    ['link with another key', withLink(r, { document_key: 'bill:2025:8' })],
    ['links disagree', {
      ...r,
      links: [(r.links as Rec[])[0], { ...(r.links as Rec[])[0], document_key: 'bill:2025:8' }],
    }],
    ["key not the citation's", withCitation(r, { bill_number: '9' })],
    ['no version', withCitation(r, { version: undefined })],
    ['unknown version', withCitation(r, { version: 'draft' })],
    ['no citation', { ...r, citation: undefined }],
    ['existing key differs', { ...r, document_key: 'bill:2025:8' }],
    ['existing role differs', { ...r, document_role: 'synopsis' }],
  ];
  for (const [name, rec] of bad) {
    let threw = false;
    try {
      project(rec);
    } catch {
      threw = true;
    }
    assert(threw, `${name} must throw`);
  }
});

Deno.test('links: each link row_key must be among the listing rows matched by key, house and name', async () => {
  const r = await bill(1);
  const link = (r.links as Rec[])[0];
  const live = new FakeLive([
    liveRow('bill:2025:1'), // row-1: matches
    liveRow('bill:2025:1', 'Lok Sabha', { bill_name: 'The Coastal Shipping Bill, 2025' }), // same key, other bill
  ]);
  live.rows[1] = { ...live.rows[1], row_key: 'row-other' };
  const run = async (links: Rec[]) => {
    const found = await checkNamed('listing_row').all!([{ ...r, links }], ctxOf(live));
    return (found.get(key(1)) ?? []).map((f) => [f.reason, f.detail]);
  };
  assertEquals(await run([link]), []);
  assertEquals(await run([{ ...link, row_key: 'row-other' }]), [['link_disagrees', 'link 0: row_key']]); // another bill's row
  assertEquals(await run([{ ...link, row_key: 'row-zzz' }]), [['link_disagrees', 'link 0: row_key']]); // no such row
  // Real v1.1 Bills links carry row_key null (they link by document_key; admission picks the rows): not compared.
  assertEquals(await run([{ ...link, row_key: null }]), []);
  assertEquals(await run([{ ...link, row_key: undefined }]), []);
  const { row_key: _absent, ...noKey } = link as Rec;
  assertEquals(await run([noKey]), []);
  assertEquals(await run([{ ...link, row_key: '' }]), []);
  assertEquals(await run([{ ...link, row_key: 7 }]), [['link_disagrees', 'link 0: row_key']]); // wrong type
  assertEquals(await run([{ ...link, row_key: {} }]), [['link_disagrees', 'link 0: row_key']]);
  assertEquals(await run([{ ...link, row_key: null }, { ...link, row_key: 'row-zzz' }]), [[
    'link_disagrees',
    'link 1: row_key',
  ]]);
  assertEquals(await run([link, { ...link, row_key: 'row-zzz' }]), [['link_disagrees', 'link 1: row_key']]);
  // A record already held for its name does not also report link rows.
  const wrongName = new FakeLive([liveRow('bill:2025:1', 'Lok Sabha', { bill_name: 'Another Bill, 2025' })]);
  const f = await checkNamed('listing_row').all!([r], ctxOf(wrongName));
  assertEquals(f.get(key(1))!.map((x) => x.reason), ['listing_name_mismatch']);
});
