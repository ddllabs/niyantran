// The screening stage end to end, offline: realistic v1.1 Bills records go through the registered screen's own checks
// (Bills screen plus the page check, with a fake network and a fake listing) and then through prepareRecord with the
// collection's policy. Nothing here reads Drive, NTER or the network.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { join } from 'jsr:@std/path@1';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { makePageCheck } from './page_check.ts';
import { prepareRecord, type Rec } from './prepare.ts';
import { runScreen } from './screen.ts';
import { makeBillsScreen } from './screens/bills.ts';
import type { LiveDeskRow, LiveReader } from './screen_types.ts';

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

async function screenAll(records: Rec[], rows: LiveDeskRow[], served: Record<string, string[]>) {
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
    const result = await runScreen(
      screen,
      records,
      { live: listing(rows), settings: { licenceClasses: [LICENCE] } },
      RUN,
    );
    return { ...result, pageCheck, requested };
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
