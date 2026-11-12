// The screening stage end to end, offline: realistic v1.1 Bills records go through the registered screen's own checks
// (Bills screen plus the page check, with a fake network and a fake listing) and then through prepareRecord with the
// collection's policy. Nothing here reads Drive, NTER or the network.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { join } from 'jsr:@std/path@1';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { makePageCheck } from './page_check.ts';
import { prepareAll, prepareRecord, type Rec } from './prepare.ts';
import { runScreen, runScreenSets } from './screen.ts';
import { makeBillsScreen } from './screens/bills.ts';
import type { LiveDeskRow, LiveDocument, LiveReader } from './screen_types.ts';
import { rulesSha256 } from './screen.ts';
import { plan } from './plan.ts';
import { LIMITS } from './fixtures.ts';
import { makeSearchOnlyScreen, pdfUrlRule } from './screens/search_only.ts';
import REGULATORY from './screens/regulatory.json' with { type: 'json' };
import { documentPublisher } from '../../supabase/functions/_shared/publisher.ts';
import { prepareSuppliedText, searchOnlyUrlOk } from '../../supabase/functions/_shared/suppliedText.ts';

const BILLS = 'Bill Passage Probability Index';
const LICENCE = 'gazette_s52_1_q_i_unconfirmed';
const NAME = 'The River Navigation (Amendment) Bill, 2025';
const key = (n: number) => n.toString(16).padStart(40, '0');
const enc = new TextEncoder();

/** The pages of bill `n` as the pack holds them: a title page and an enacting page, long enough to be real. */
const pageTexts = (n: number, name = NAME) => [
  `THE ${name.toUpperCase()}\nBill No. ${n} of 2025. A Bill to amend the law relating to navigation on inland waterways ` +
  'and to provide for matters connected therewith or incidental thereto.',
  'Be it enacted by Parliament in the Seventy-sixth Year of the Republic of India as follows: this Act may be called ' +
  `the River Navigation (Amendment) Act, 2025, and it shall come into force on such date as the Central Government ` +
  `may by notification appoint. Section ${n}.`,
];

/** A clean v1.1 Bills record: pages joined by form feeds, spans by code point, links keyed bill:<year>:<number>. */
async function bill(n: number, over: Rec = {}): Promise<Rec> {
  const texts = pageTexts(n);
  const text = texts.join('\f');
  let at = 0;
  const pages = texts.map((t, i) => {
    const p = { page_number: i + 1, char_from: at, char_to: at + [...t].length, text: t };
    at = p.char_to + 1;
    return p;
  });
  const file = `${2200 + n}LS.pdf`;
  return {
    schema: 'nter.citation_pack/1.1',
    source_key: key(n),
    desk_tier: 'national',
    desk_feature: BILLS,
    desk_rows_feature: BILLS,
    doc_type: 'bill',
    title: NAME,
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
      bill_name: NAME,
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
      bill_name: NAME,
      bill_number: String(n),
      bill_year: '2025',
    }],
    pages,
    text,
    ...over,
  };
}

const deskRow = (n: number, over: Rec = {}): LiveDeskRow => ({
  tier: 'national',
  feature: BILLS,
  row_key: `row-${n}`,
  document_key: `bill:2025:${n}`,
  row: { house: 'Lok Sabha', bill_name: NAME, date_introduced: '2025-03-04', ...over },
});

/** A listing with these rows and no live documents. */
const listing = (rows: LiveDeskRow[]): LiveReader => ({
  documents: () => Promise.resolve([]),
  identity: () => Promise.resolve({ database: 'fake', server: 'local', documents: 1, deskRows: rows.length }),
  deskRows: (q) => Promise.resolve(rows.filter((r) => q.documentKeys.includes(r.document_key ?? ''))),
});

// A fake PDF is `%PDF-fake` and a line of JSON; the page check's reader is told to read that.
const fakePdf = (pages: string[]) => enc.encode(`%PDF-fake\n${JSON.stringify(pages)}`);
const fakeReader = (bytes: Uint8Array): Promise<string[]> =>
  Promise.resolve(JSON.parse(new TextDecoder().decode(bytes).slice(10)));

const RUN = {
  packageId: 'National/v1.1/documents/bills.jsonl.gz#' + 'a'.repeat(64),
  fileSha256: 'b'.repeat(64),
  decisionId: 'decision-e2e',
  rulesSha256: 'c'.repeat(64),
  noLive: false,
  noPages: false,
};

async function screenAll(
  records: Rec[],
  rows: LiveDeskRow[],
  served: Record<string, string[]>,
  patches: Rec[] | null = null,
) {
  const cacheDir = await Deno.makeTempDir({ prefix: 'screening-e2e-' });
  const requested: string[] = [];
  try {
    const pageCheck = makePageCheck({
      fetch: ((input: string | URL | Request) => {
        const u = String(input instanceof Request ? input.url : input);
        requested.push(u);
        const pages = served[u];
        if (pages) return Promise.resolve(new Response(fakePdf(pages) as BodyInit, { status: 200 }));
        return Promise.resolve(new Response('not found', { status: 404 }));
      }) as typeof fetch,
      sleep: () => Promise.resolve(),
      now: () => 0,
      cacheDir: join(cacheDir, 'pdfs'),
      readPdf: fakeReader,
      commonDir: () => Promise.resolve(null),
    });
    const screen = makeBillsScreen([pageCheck]);
    const ctx = { live: listing(rows), settings: { licenceClasses: [LICENCE] } };
    if (patches) {
      const { packageId: _p, fileSha256: _f, ...shared } = RUN;
      const both = await runScreenSets(
        screen,
        {
          records: { records, packageId: RUN.packageId, fileSha256: RUN.fileSha256 },
          patches: { records: patches, packageId: RUN.packageId.replace('bills', 'fixed'), fileSha256: 'd'.repeat(64) },
        },
        ctx,
        shared,
      );
      return { ...both.records, patches: both.patches!, pageCheck, requested };
    }
    const result = await runScreen(screen, records, ctx, RUN);
    return { ...result, patches: null, pageCheck, requested };
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
}

const served = (records: Rec[]) =>
  Object.fromEntries(records.map((r) => [String(r.file_url), (r.pages as Rec[]).map((p) => String(p.text))]));

Deno.test('screened Bills records become requests in prepareRecord, with the five checks and bill_identity true', async () => {
  const records = [await bill(1), await bill(2), await bill(3), await bill(4)];
  const { screened, holds, pageCheck } = await screenAll(records, [1, 2, 3, 4].map((n) => deskRow(n)), served(records));
  assertEquals(holds, []);
  assertEquals(screened.length, 4);
  assertEquals(pageCheck.stats.fetched, 4);
  assertEquals(pageCheck.stats.scans, []);

  for (const r of screened) {
    const out = await prepareRecord(r, { maxChunks: 700, requireTextIdentity: true });
    assertEquals(out.kind, 'request', out.kind === 'hold' ? `${out.hold.reason}: ${out.hold.detail}` : '');
    if (out.kind !== 'request') continue;
    const payload = JSON.parse(out.request.payload) as Rec;
    assertEquals(payload.document_key, `bill:2025:${Number.parseInt(String(r.source_key).slice(-2), 16)}`);
    assertEquals(payload.document_role, 'as_introduced');
    const review = payload.review as Rec;
    assertEquals(review.checks, {
      identity: true,
      completeness: true,
      sensitivity: true,
      dedupe: true,
      rights: true,
      bill_identity: true,
    });
    // The form feeds between pages become line breaks, so the hash moves with the text and the screened one is kept.
    assertEquals(review.text_sha256, await sha256Hex(String(payload.text)));
    assertEquals(payload.original_text_sha256, r.text_sha256);
    assertEquals(review.decision_id, 'decision-e2e');
  }
});

Deno.test('a record whose listing name disagrees is held by the screen and never reaches prepareRecord', async () => {
  const good = await bill(1);
  const bad = await bill(2);
  const rows = [deskRow(1), deskRow(2, { bill_name: 'The Coastal Shipping (Reform) Bill, 2025' })];
  const { screened, holds } = await screenAll([good, bad], rows, served([good, bad]));
  assertEquals(screened.map((r) => r.source_key), [key(1)]);
  assertEquals(holds.map((h) => h.source_key), [key(2)]);
  assert(holds[0].reasons.length > 0);
  assert(!JSON.stringify(holds).includes('River Navigation'), 'a hold carries record text');
  for (const r of screened) {
    assertEquals((await prepareRecord(r, { maxChunks: 700, requireTextIdentity: true })).kind, 'request');
  }
});

Deno.test('a PDF that disagrees with the pack is held by the page check, and the stats name no text or URL', async () => {
  const ok = await bill(1);
  const short = await bill(2);
  const wrong = { ...served([ok, short]), [String(short.file_url)]: ['only one page'] };
  const { screened, holds, pageCheck } = await screenAll([ok, short], [deskRow(1), deskRow(2)], wrong);
  assertEquals(screened.map((r) => r.source_key), [key(1)]);
  assertEquals(holds[0].reasons, ['page_count_mismatch']);
  assert(!JSON.stringify(pageCheck.stats).includes('sansad'));
});

Deno.test('a patch for a record in the pack: the original is held, the patch is screened in its place, and prepare takes both as ordinary records', async () => {
  // The same bill, same file and same document key and role in both: if the original were offered to the whole-set
  // checks they would collide. The original is superseded by the patch input and left out, so the patch stands.
  const original = await bill(1);
  const fixed = await bill(1, { title: 'The River Navigation (Amendment) Bill, 2025 (links fixed)' });
  const other = await bill(2);
  const rows = [deskRow(1), deskRow(2)];
  const { screened, holds, patches: maybe } = await screenAll(
    [original, other],
    rows,
    served([original, other]),
    [fixed],
  );
  assertEquals(screened.map((r) => r.source_key), [key(2)]);
  assertEquals(holds.map((h) => [h.source_key, h.reasons]), [[key(1), ['superseded_by_patch_input']]]);
  const patches = maybe!;
  assertEquals(patches.holds, []);
  assertEquals(patches.screened.map((r) => r.source_key), [key(1)]);
  // The patch is a complete record under the original's key: no `patches` option, no patch handling in prepare.
  const options = { maxChunks: 700, requireTextIdentity: true };
  const out = await prepareRecord(patches.screened[0], options);
  assertEquals(out.kind, 'request', out.kind === 'hold' ? `${out.hold.reason}: ${out.hold.detail}` : '');
  const all = await prepareAll([...screened, ...patches.screened], options);
  assertEquals(all.holds, []);
  assertEquals(all.requests.map((r) => r.source_key), [key(2), key(1)]);
  const review = patches.screened[0].review as Rec;
  assertEquals(review.file_sha256, 'd'.repeat(64));
  assert(String(review.package_id).includes('/documents/fixed.jsonl.gz#'));
});

// ---- Regulatory (search-only): the screen, prepare and plan together ----

const FEATURE = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
const LISTING = 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)';
const REG_LICENCE = 'govt_material_confirm_counsel';
const REG_SETTINGS = {
  licenceClasses: [REG_LICENCE],
  minCharsPerPage: 600,
  minPagesForDensity: 5,
  requirePageCount: true,
};
const REGULATORS: Record<string, [host: string, regulator: string]> = {
  trai: ['trai.gov.in', 'TRAI'],
  cci: ['cci.gov.in', 'CCI'],
  rbi: ['rbi.org.in', 'RBI'],
  sebi: ['sebi.gov.in', 'SEBI'],
};
const rbiPdf = (n: number) => `https://rbidocs.rbi.org.in/rdocs/notification/PDFs/N${n}.pdf`;
const bytesOf = (s: string) => enc.encode(s).length;

/** A Regulatory record in the pack's shape: `pages` pages of `chars` characters, joined by form feeds. */
async function reg(n: number, over: Rec = {}, o: { pages?: number; chars?: number; who?: string } = {}): Promise<Rec> {
  const [host, regulator] = REGULATORS[o.who ?? 'trai'];
  const texts = Array.from(
    { length: o.pages ?? 3 },
    (_, i) => `Page ${i + 1} of regulatory document ${n}. `.padEnd(o.chars ?? 400, 'w'),
  );
  const text = texts.join('\f');
  let at = 0;
  const pages = texts.map((t, i) => {
    const p = { page_number: i + 1, char_from: at, char_to: at + [...t].length, text: t };
    at = p.char_to + 1;
    return p;
  });
  return {
    schema: 'nter.citation_pack/1.1',
    source_key: key(n),
    desk_tier: 'national',
    desk_feature: FEATURE,
    desk_rows_feature: LISTING,
    doc_type: 'regulatory',
    title: `Master Direction ${n}`,
    file_name: `N${n}.pdf`,
    file_url: null,
    source_host: host,
    licence_class: REG_LICENCE,
    extraction: 'pdf_text',
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: pages.length,
    page_split: 'exact',
    citation: {
      kind: 'regulation',
      regulator,
      regulator_name: `${regulator} authority`,
      title: `T${n}`,
      source: 'S',
      date: '2024-05-06',
    },
    links: [],
    pages,
    text,
    document_key_suggested: `reg:${n}`,
    ...over,
  };
}
const pdfRec = async (n: number, over: Rec = {}) =>
  await reg(n, {
    file_url: rbiPdf(n),
    links: [{
      tier: 'national',
      feature: LISTING,
      role: 'primary_document',
      row_key: String(n),
      document_key: `reg:${n}`,
    }],
    ...over,
  }, { who: 'rbi' });

/** A live reader with these documents and no listing rows (Regulatory's listing sits under another spelling). */
const regLive = (docs: LiveDocument[] = []): LiveReader => ({
  documents: (q) =>
    Promise.resolve(
      docs.filter((d) =>
        q.sourceKeys.includes(d.source_key ?? '\0') || q.fileUrls.includes(d.file_url ?? '\0') ||
        (q.contentHashes ?? []).includes(d.content_sha256 ?? '\0') ||
        (q.suggestedKeys ?? []).includes(d.document_key_suggested ?? '\0')
      ),
    ),
  identity: () => Promise.resolve({ database: 'fake', server: 'local', documents: 1, deskRows: 0 }),
  deskRows: () => Promise.reject(new Error('the search-only screen reads no listing rows')),
});
const liveDocument = (o: Partial<LiveDocument>): LiveDocument => ({
  id: 'd1',
  source_key: null,
  file_url: null,
  file_name: null,
  desk_feature: FEATURE,
  document_key: null,
  house: null,
  document_role: null,
  content_sha256: null,
  document_key_suggested: null,
  ...o,
});

/** The real screen and page check with a fake network: `served` maps a URL to the text of each page of its PDF. */
async function screenRegulatory(records: Rec[], served: Record<string, string[]>, docs: LiveDocument[] = []) {
  const cacheDir = await Deno.makeTempDir({ prefix: 'screening-e2e-reg-' });
  const requested: string[] = [];
  try {
    const pageCheck = makePageCheck({
      fetch: ((input: string | URL | Request) => {
        const u = String(input instanceof Request ? input.url : input);
        requested.push(u);
        const pages = served[u];
        return Promise.resolve(
          pages
            ? new Response(fakePdf(pages) as BodyInit, { status: 200 })
            : new Response('not found', { status: 404 }),
        );
      }) as typeof fetch,
      sleep: () => Promise.resolve(),
      now: () => 0,
      cacheDir: join(cacheDir, 'pdfs'),
      readPdf: fakeReader,
      commonDir: () => Promise.resolve(null),
      urlRule: pdfUrlRule(REGULATORY),
    });
    const screen = makeSearchOnlyScreen(REGULATORY, pageCheck);
    const result = await runScreen(screen, records, { live: regLive(docs), settings: REG_SETTINGS }, {
      ...RUN,
      packageId: RUN.packageId.replace('bills', 'regulatory'),
    });
    return { ...result, requested, screen };
  } finally {
    await Deno.remove(cacheDir, { recursive: true });
  }
}
const pagesOf = (r: Rec) => (r.pages as Rec[]).map((p) => String(p.text));
const PREPARE = { maxChunks: 700, dropInvalidCitationDates: true };
const regLimits = { ...LIMITS, partitioned: [FEATURE] };

Deno.test('Regulatory: a clean text-layer record earns density_only and a clean RBI PDF earns page_check; prepare carries each basis', async () => {
  const plain = await reg(1);
  const pdf = await pdfRec(2);
  const { screened, holds, requested } = await screenRegulatory([plain, pdf], { [String(pdf.file_url)]: pagesOf(pdf) });
  assertEquals(holds, []);
  assertEquals(
    requested.filter((u) => !u.endsWith('/robots.txt')),
    [String(pdf.file_url)],
    'only the PDF record is fetched',
  );
  assertEquals(screened.map((r) => [r.source_key, r.completeness_basis]), [[key(1), 'density_only'], [
    key(2),
    'page_check',
  ]]);
  for (const r of screened) {
    // The adapter takes the screened record as it is, and stores the basis in the payload.
    const prepared = await prepareSuppliedText(r, { batch: true });
    assertEquals(prepared.input.completeness_basis, r.completeness_basis);
    const out = await prepareRecord(r, PREPARE);
    assertEquals(out.kind, 'request', out.kind === 'hold' ? `${out.hold.reason}: ${out.hold.detail}` : '');
    if (out.kind !== 'request') continue;
    const payload = JSON.parse(out.request.payload) as Rec;
    assertEquals(payload.completeness_basis, r.completeness_basis);
    assertEquals(payload.links ?? undefined, undefined, 'a search-only payload carries no link');
    assertEquals((payload.review as Rec).checks, {
      identity: true,
      completeness: true,
      sensitivity: true,
      dedupe: true,
      rights: true,
    });
    assertEquals(out.desk, { tier: 'national', feature: FEATURE });
  }
});

Deno.test('Regulatory: a mixed input of every hold code and clean records of both kinds - nothing the screen passes is refused by prepare or plan', async () => {
  const live = [
    liveDocument({ id: 'a', source_key: key(30) }),
    liveDocument({ id: 'b', source_key: 'old', document_key_suggested: 'reg:31' }),
  ];
  const clean: Rec[] = [
    await reg(1, {}, { who: 'trai' }),
    await reg(2, {}, { who: 'cci' }),
    await reg(3, { file_url: 'https://www.sebi.gov.in/legal/circulars/c3.html' }, { who: 'sebi' }),
    await reg(4, { file_url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=4' }, { who: 'rbi' }),
    await pdfRec(5),
    await reg(6, {
      citation: {
        kind: 'regulation',
        regulator: 'TRAI',
        regulator_name: 'x',
        title: 't',
        source: 's',
        date: '2020-13-45',
      },
    }),
  ];
  const first = clean[0];
  const pdfBad = await pdfRec(21);
  const pdfScan = await pdfRec(22);
  const held: Array<[string, Rec]> = [
    ['bad_shape', await reg(10, { doc_type: 'bill' })],
    ['replacement_not_supported', await reg(11, { delta_patch: 'x' })],
    ['title_invalid', await reg(12, { title: ' ' })],
    ['citation_incomplete', await reg(13, { citation: { kind: 'k' } })],
    ['field_invalid', await reg(14, { language: 'a\ud800' })],
    ['text_quality', await reg(15, { text_quality: 'draft' })],
    ['unknown_host', await reg(16, { source_host: 'example.org' })],
    ['not_official_url', await reg(17, { file_url: 'http://www.sebi.gov.in/x.html' })],
    ['suggested_key_invalid', await reg(18, { document_key_suggested: '  ' })],
    ['link_shape', await reg(19, { links: [{}] })],
    ['text_hash_mismatch', await reg(20, { content_sha256: 'a'.repeat(64) })],
    ['too_short', await reg(23, {}, { pages: 1, chars: 100 })],
    ['below_density', await reg(24, {}, { pages: 6, chars: 100 })],
    ['extraction_not_allowed', await reg(25, { extraction: 'ocr' })],
    ['not_servable', await reg(26, { servable: false })],
    ['licence_not_admitted', await reg(27, { licence_class: 'other' })],
    ['already_live', await reg(30)],
    ['suggested_key_held_live', await reg(31)],
    [
      'duplicate_text',
      await reg(32, {
        text: first.text,
        pages: first.pages,
        content_sha256: first.content_sha256,
        n_chars: first.n_chars,
      }),
    ],
    ['page_count_mismatch', pdfBad],
    ['official_pdf_no_text', pdfScan],
    ['file_url_collision', await reg(33, { file_url: 'https://www.sebi.gov.in/legal/dup.html' })],
    ['file_url_collision', await reg(34, { file_url: 'https://www.sebi.gov.in/legal/dup.html' })],
    ['suggested_key_collision', await reg(35, { document_key_suggested: 'reg:shared' })],
    ['suggested_key_collision', await reg(36, { document_key_suggested: 'reg:shared' })],
  ];
  const records = [...clean, ...held.map(([, r]) => r)];
  const served = {
    [String(clean[4].file_url)]: pagesOf(clean[4]),
    [String(pdfBad.file_url)]: ['only one page'],
    [String(pdfScan.file_url)]: ['', '', ''],
  };
  const { screened, holds } = await screenRegulatory(records, served, live);

  assertEquals(screened.map((r) => r.source_key), clean.map((r) => r.source_key));
  assertEquals(screened.map((r) => r.completeness_basis), [
    'density_only',
    'density_only',
    'density_only',
    'density_only',
    'page_check',
    'density_only',
  ]);
  assertEquals(holds.length, held.length);
  for (const [code, r] of held) {
    const h = holds.find((x) => x.source_key === r.source_key);
    assert(h && h.reasons.includes(code), `${code}: ${h?.reasons}`);
  }
  assert(!JSON.stringify(holds).includes('regulatory document'), 'a hold carries record text');

  // Everything the screen passed goes through prepare with no refusal at all.
  const all = await prepareAll(screened, PREPARE);
  assertEquals(all.holds, [], 'prepare refused or held a record the screen passed');
  assertEquals(all.requests.map((r) => r.source_key).sort(), screened.map((r) => String(r.source_key)).sort());
  const heldKeys = new Set(holds.map((h) => h.source_key));
  assert(all.requests.every((r) => !heldKeys.has(r.source_key)), 'a held record reached prepare');
  assertEquals(all.citationDatesDropped, 1);
  const p = await plan(all.requests, regLimits);
  assert(p.ok, p.ok ? '' : JSON.stringify(p));
  if (p.ok) {
    assertEquals(
      p.batches.flatMap((b) => b.requests.map((r) => r.source_key)).sort(),
      screened.map((r) => String(r.source_key)).sort(),
    );
  }
});

Deno.test('Regulatory: with dropInvalidCitationDates on the invalid date is left out and counted; with it off the record is prepared with it', async () => {
  const dated = await reg(6, {
    citation: {
      kind: 'regulation',
      regulator: 'TRAI',
      regulator_name: 'x',
      title: 't',
      source: 's',
      date: '2020-13-45',
    },
  });
  const { screened } = await screenRegulatory([dated], {});
  assertEquals(screened.length, 1);
  const on = await prepareRecord(screened[0], { maxChunks: 700, dropInvalidCitationDates: true });
  assertEquals(on.kind, 'request');
  if (on.kind === 'request') {
    assert(!('date' in (JSON.parse(on.request.payload).citation as Rec)));
    assertEquals(on.citationDatesDropped, 1);
  }
  // Off: the adapter does not look at the date, so the record is prepared with the invalid date as it came.
  const off = await prepareRecord(screened[0], { maxChunks: 700 });
  assertEquals(off.kind, 'request');
  if (off.kind === 'request') {
    assertEquals(JSON.parse(off.request.payload).citation.date, '2020-13-45');
    assertEquals(off.citationDatesDropped, 0);
  }
});

Deno.test('Regulatory: a file_url of exactly 2,000 bytes and a suggested key of exactly 500 pass the screen and prepare; one byte more is held and refused', async () => {
  const head = 'https://www.sebi.gov.in/';
  const url = (extra: number) => `${head}${'a'.repeat(extra)}${'é'.repeat(900)}.html`;
  const fill = 2000 - bytesOf(url(0));
  const url2000 = url(fill), url2001 = url(fill + 1);
  assertEquals([bytesOf(url2000), bytesOf(url2001)], [2000, 2001]);
  const key500 = 'reg:' + 'é'.repeat(100) + 'k'.repeat(500 - 4 - 200);
  const key501 = key500 + 'k';
  assertEquals([bytesOf(key500), bytesOf(key501)], [500, 501]);

  const ok = [
    await reg(1, { file_url: url2000 }, { who: 'sebi' }),
    await reg(2, { document_key_suggested: key500 }),
  ];
  const { screened, holds } = await screenRegulatory(ok, {});
  assertEquals(holds, []);
  for (const r of screened) {
    assertEquals((await prepareRecord(r, PREPARE)).kind, 'request');
    await prepareSuppliedText(r, { batch: true });
  }
  const over = [
    await reg(3, { file_url: url2001 }, { who: 'sebi' }),
    await reg(4, { document_key_suggested: key501 }),
  ];
  const out = await screenRegulatory(over, {});
  assertEquals(out.screened, []);
  assertEquals(out.holds.map((h) => h.reasons), [['not_official_url'], ['suggested_key_invalid']]);
  // The adapter refuses the same values when asked directly (a screened record of the same text, with the value swapped in).
  const base = screened[0];
  await assertRejects(() => prepareSuppliedText({ ...base, file_url: url2001 }, { batch: true }), Error, 'file_url');
  await assertRejects(
    () => prepareSuppliedText({ ...base, document_key_suggested: key501 }, { batch: true }),
    Error,
    'document_key_suggested',
  );
});

Deno.test('Regulatory: a record whose publisher cannot be resolved is held and never prepared; one per regulator passes and prepares', async () => {
  const ok = [
    await reg(1, {}, { who: 'trai' }),
    await reg(2, {}, { who: 'cci' }),
    await reg(3, { file_url: 'https://www.sebi.gov.in/legal/circulars/c3.html' }, { who: 'sebi' }),
    await reg(4, { file_url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=4' }, { who: 'rbi' }),
  ];
  const own = (n: number, citation: Rec) => reg(n, { citation: { ...ok[0].citation as Rec, ...citation } });
  const bad = [
    await own(11, { regulator: 'XYZ' }),
    await own(12, { regulator: ['TRAI'] }),
    // The code says RBI and the file is SEBI's: two regulators, no name.
    await reg(13, {
      file_url: 'https://www.sebi.gov.in/legal/circulars/c13.html',
      citation: { ...ok[0].citation as Rec, regulator: 'RBI' },
    }, { who: 'rbi' }),
  ];
  const out = await screenRegulatory([...ok, ...bad], {});
  assertEquals(out.screened.map((r) => r.source_key), ok.map((r) => r.source_key));
  assertEquals(out.holds.map((h) => h.source_key), bad.map((r) => r.source_key));
  for (const h of out.holds) assert(h.reasons.includes('publisher_unresolved'), String(h.source_key));
  // Only the list in a citation is also an incomplete citation; the other two are held for the publisher alone.
  assertEquals(out.holds.map((h) => h.reasons.length), [1, 2, 1]);
  // The publisher of the row admission will store, resolved from the prepared payload. The metadata mirrors the
  // search-only branch of ingest_admit_document (20261113090000_national_search_only.sql): the payload record minus
  // text, pages, sections, source_key, title, desk_tier and desk_feature; tier and feature are the row's own columns.
  const stored = (payload: string): string => {
    const p = JSON.parse(payload) as Rec;
    const meta: Rec = { ...p };
    for (const k of ['text', 'pages', 'sections', 'source_key', 'title', 'desk_tier', 'desk_feature']) delete meta[k];
    return documentPublisher('national', p.desk_feature, meta, p.file_url ?? null);
  };
  for (const r of out.screened) {
    const prepared = await prepareRecord(r, PREPARE);
    assertEquals(prepared.kind, 'request');
    if (prepared.kind !== 'request') continue;
    const name = stored(prepared.request.payload);
    assert(name !== '', `stored row of ${r.source_key} has no publisher`);
    assertEquals(
      name,
      documentPublisher('national', r.desk_feature, { source_host: r.source_host, citation: r.citation }, r.file_url),
    );
  }
  // Bypassing the screen: the same screened record with the values a held record had swapped in is prepared, and the
  // row it would be stored as has no publisher (the screen's hold is what keeps such a row from being written).
  const base = out.screened[0], baseCitation = base.citation as Rec;
  const swapped: Rec[] = [
    { ...base, citation: { ...baseCitation, regulator: 'XYZ' } },
    { ...base, citation: { ...baseCitation, regulator: ['TRAI'] } },
    {
      ...base,
      file_url: 'https://www.sebi.gov.in/legal/circulars/c13.html',
      citation: { ...baseCitation, regulator: 'RBI' },
    },
  ];
  for (const r of swapped) {
    const prepared = await prepareRecord(r, PREPARE);
    assertEquals(prepared.kind, 'request', JSON.stringify(prepared.kind === 'hold' ? prepared.hold : null));
    if (prepared.kind === 'request') assertEquals(stored(prepared.request.payload), '');
  }
  assert(!JSON.stringify(out.holds).includes('XYZ'), 'a hold carries a value from the record');
});

Deno.test('rules_sha256: the Regulatory screen moves with each of its rule files; the Bills screen does not move with the search-only files', async () => {
  const reg = makeSearchOnlyScreen(REGULATORY, {
    name: 'p',
    covers: ['completeness'],
    needs: 'pages',
    all: () => Promise.resolve(new Map()),
  });
  const bills = makeBillsScreen();
  const read = (changed: string | null) => (path: string) => {
    const rel = [...reg.rulesFiles, ...bills.rulesFiles].find((f) => path.endsWith(f))!;
    return Promise.resolve(enc.encode(rel === changed ? `changed ${rel}` : `content of ${rel}`));
  };
  const settings = { licenceClasses: ['x'] };
  const base = await rulesSha256(reg.rulesFiles, '/repo', read(null), settings);
  for (const f of reg.rulesFiles) {
    assert(await rulesSha256(reg.rulesFiles, '/repo', read(f), settings) !== base, `${f} does not move the hash`);
  }
  const billsBase = await rulesSha256(bills.rulesFiles, '/repo', read(null), settings);
  for (const f of ['scripts/bulk-runner/screens/search_only.ts', 'scripts/bulk-runner/screens/regulatory.json']) {
    assert(!bills.rulesFiles.includes(f), `${f} is a Bills rule file`);
    assertEquals(await rulesSha256(bills.rulesFiles, '/repo', read(f), settings), billsBase);
  }
  for (const f of bills.rulesFiles) {
    assert(await rulesSha256(bills.rulesFiles, '/repo', read(f), settings) !== billsBase, f);
  }
});

// Each row: the URL, what the screen says, and what admission says (the SQL branch in 20261113090000_national_search_only.sql
// and searchOnlyUrlOk in suppliedText.ts). A change to either side that opens a gap between them shows here.
const URL_CASES: Array<[label: string, url: string, screenAccepts: boolean, sqlAccepts: boolean]> = [
  ['RBI document PDF', 'https://rbidocs.rbi.org.in/rdocs/x/N1.pdf', true, true],
  ['RBI site page with a query', 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=4', true, true],
  ['SEBI page', 'https://www.sebi.gov.in/legal/circulars/c1.html', true, true],
  ['http scheme', 'http://www.sebi.gov.in/a.html', false, false],
  ['host not on the list', 'https://example.org/a.pdf', false, false],
  ['upper-case host (the SQL regex is case-sensitive)', 'https://RBIDOCS.rbi.org.in/a.pdf', false, false],
  ['host as a sub-domain of a listed one', 'https://x.rbidocs.rbi.org.in/a.pdf', false, false],
  ['user information', 'https://user@rbidocs.rbi.org.in/a.pdf', false, false],
  ['port', 'https://rbidocs.rbi.org.in:443/a.pdf', false, false],
  ['bare host (no path slash)', 'https://rbidocs.rbi.org.in', false, false],
  ['query straight after the host (no slash)', 'https://rbidocs.rbi.org.in?x=1', false, false],
  ['fragment straight after the host (no slash)', 'https://rbidocs.rbi.org.in#f', false, false],
  ['leading space', ' https://rbidocs.rbi.org.in/a.pdf', false, false],
  ['dot-dot segment', 'https://rbidocs.rbi.org.in/a/../b.pdf', false, false],
  ['single-dot segment', 'https://rbidocs.rbi.org.in/a/./b.pdf', false, false],
  ['encoded dot-dot', 'https://rbidocs.rbi.org.in/a/%2e%2E/b.pdf', false, false],
  ['dot segment with a path parameter', 'https://rbidocs.rbi.org.in/a/.;x/b.pdf', false, false],
  ['encoded slash', 'https://rbidocs.rbi.org.in/a%2Fb.pdf', false, false],
  ['encoded backslash', 'https://rbidocs.rbi.org.in/a%5cb.pdf', false, false],
  ['backslash', 'https://rbidocs.rbi.org.in/a\\b.pdf', false, false],
  ['tab character', 'https://rbidocs.rbi.org.in/a\tb.pdf', false, false],
  ['DEL character', 'https://rbidocs.rbi.org.in/a\x7fb.pdf', false, false],
  ['dots inside a file name', 'https://rbidocs.rbi.org.in/a....pdf', true, true],
  [
    'dot segment only in the query (the rule reads the part before ?)',
    'https://rbidocs.rbi.org.in/a.pdf?x=../y',
    true,
    true,
  ],
  ['encoded slash only in the query', 'https://rbidocs.rbi.org.in/a.pdf?x=%2f', true, true],
  ['dot segment only in the fragment', 'https://rbidocs.rbi.org.in/a.pdf#../x', true, true],
  ['space inside the path', 'https://rbidocs.rbi.org.in/a b.pdf', true, true],
  ['double slash', 'https://rbidocs.rbi.org.in//a.pdf', true, true],
  ['non-ASCII in the path', 'https://rbidocs.rbi.org.in/é/a.pdf', true, true],
];

Deno.test('URL rule: the screen and admission agree on every row of the table, each with its expected verdict', async () => {
  const screen = makeSearchOnlyScreen(REGULATORY, {
    name: 'p',
    covers: ['completeness'],
    needs: 'pages',
    all: () => Promise.resolve(new Map()),
  });
  const check = screen.checks.find((c) => c.name === 'source_fields')!;
  const ctx = { live: regLive(), settings: REG_SETTINGS };
  for (const [label, url, screenAccepts, sqlAccepts] of URL_CASES) {
    const found = (await check.one!(await reg(1, { file_url: url }), ctx)).map((f) => f.reason);
    assertEquals(!found.includes('not_official_url'), screenAccepts, `screen: ${label}`);
    // The adapter's own function stands for the SQL rule (the two are written to match; the table pins both).
    assertEquals(bytesOf(url) <= 2000 && searchOnlyUrlOk(url), sqlAccepts, `admission: ${label}`);
    assertEquals(screenAccepts, sqlAccepts, `the screen and admission differ: ${label}`);
  }
});
