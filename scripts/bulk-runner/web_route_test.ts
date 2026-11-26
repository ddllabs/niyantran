// Tests for the web-page text route (F369, scripts/bulk-runner/web_route.ts). Records are built by hand in the v1.3
// archive's shape; the database is a fake that records what it is asked; the Regulatory screen is the real one with a
// fake page check and a fake live reader. Nothing here touches a database, the network or a real pack, and no document
// text of a real pack is used.
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { createHash } from 'node:crypto';
import { resolve } from 'jsr:@std/path@1';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { canonical } from '../../supabase/functions/_shared/suppliedText.ts';
import {
  buildWebRecord,
  DEFAULT_MIN_IDENTITY,
  type EnqueueItem,
  type EnqueueResult,
  identityBucket,
  identityShare,
  MAX_SELECTION,
  normaliseMarkdown,
  officialPage,
  parseWebArgs,
  planWeb,
  PsqlWebDb,
  REQUEST_OPTIONS,
  type SelectOptions,
  type WebCliDeps,
  webCommand,
  type WebDb,
  WebRecordError,
  type WebRow,
} from './web_route.ts';
import type { HoldLine } from './ocr_route.ts';
import { type CliDeps, main } from './cli.ts';
import REGULATORY from './screens/regulatory.json' with { type: 'json' };
import { makeSearchOnlyScreen } from './screens/search_only.ts';
import { runScreen } from './screen.ts';
import type { Check, Finding, LiveReader, ScreenContext } from './screen_types.ts';
import type { Rec } from './prepare.ts';

const key = (n: number) => n.toString(16).padStart(40, '0');
const PR = (n: number) => `https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=${n}`;
const NT = (n: number) => `https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=${n}`;
const SEBI = (n: number) => `https://www.sebi.gov.in/legal/circulars/oct-2026/a-circular_${n}.html`;
const MARKER = 'HOSTILE-MARKER-4d2c';

/** A made-up regulatory notice: about 900 characters of words, a different one per n. */
const notice = (n: number) =>
  [
    `The Reserve Bank has today issued directions number ${n} to all scheduled commercial banks.`,
    'The directions require each bank to report its liquidity position every fortnight to the regional office.',
    'Banks shall maintain the prescribed ratio on a daily basis and shall not fall below it on any day.',
    'A bank that fails to comply shall be liable to the penalty specified under the relevant section of the Act.',
    'These directions come into force with immediate effect and supersede the earlier circular on the subject.',
    `Table ${n}: Item | Amount | Change; Reserve money | 4,500 | 12; Currency in circulation | 3,900 | 8.`,
    'Issued by the Chief General Manager in charge of the Department of Regulation, Central Office, Mumbai.',
  ].join('\n');
/** n distinct words that no notice has. */
const filler = (n: number) => Array.from({ length: n }, (_, i) => `qz${i}`).join(' ');
/** The pack's own text of the page: the notice with the site's menu above it (as 310 of the archive's records have). */
const packText = (n: number) => `Home | About Us | Notifications | Press Releases | Search\n${notice(n)}`;
/** Firecrawl's markdown of the same page: the notice, with a heading, links, an image and a table. */
const markdown = (n: number) =>
  [
    `# Directions number ${n}`,
    '',
    '![RBI logo](https://www.rbi.org.in/images/logo.png "logo")',
    '',
    '',
    '',
    notice(n).replace('scheduled commercial banks', '[scheduled commercial banks](https://www.rbi.org.in/x?a=1)'),
    '',
    'See <https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=1> for the earlier circular.   ',
  ].join('\n');

async function packRecord(n: number, over: Rec = {}): Promise<Rec> {
  const text = packText(n);
  const url = over.file_url === undefined ? PR(n) : over.file_url;
  return {
    schema: 'nter.citation_pack/1.1',
    source_key: key(n),
    desk_tier: 'national',
    desk_feature: REGULATORY.desk_feature,
    desk_rows_feature: REGULATORY.desk_rows_feature,
    doc_type: 'regulatory',
    title: `Directions number ${n}`,
    title_stem: `rbi_press_release_${n}`,
    file_name: `rbi_press_release_${n}.html`,
    file_url: url,
    source_host: 'www.rbi.org.in',
    licence_class: 'govt_material_confirm_counsel',
    as_of: '2026-10-08',
    file_bytes: 112_741,
    extraction: 'html',
    text_engine: 'rbi page html -> text [archive fold v1.3]',
    ocr_quality: null,
    integrity: null,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: null,
    page_split: 'none',
    pages_with_text: 0,
    citation_text: `Reserve Bank of India, press release, "Directions number ${n}", 2026-10-07; rbi.org.in`,
    citation: {
      kind: 'regulatory',
      regulator: 'RBI',
      series: 'press_release',
      id: String(n),
      date: '2026-10-07',
      page_url: url,
      source: 'rbi.org.in',
    },
    links: [{
      tier: 'national',
      feature: REGULATORY.desk_rows_feature,
      row_key: null,
      document_key: `reg:rbi:press_release:${n}`,
      role: 'document',
    }],
    pages: [],
    text,
    has_blocks: false,
    delta: 'v1.3',
    document_key_suggested: `reg:rbi:press_release:${n}`,
    archive_fetch: '2026-10-07T20:19:58',
    pdf_blocked: true,
    pdf_url_for_topup: `https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR${n}.PDF`,
    ...over,
  };
}

async function row(r: Rec, over: Partial<WebRow> = {}): Promise<WebRow> {
  const text = over.text === undefined ? markdown(Number.parseInt(String(r.source_key), 16)) : over.text;
  return {
    source_key: String(r.source_key),
    official_url: String(r.file_url),
    pack_sha256: String(r.content_sha256),
    status: 'done',
    attempts: 1,
    credits: 1,
    cost_usd: 0.005,
    error_code: null,
    source_status: 200,
    final_url_host: new URL(String(r.file_url)).hostname,
    content_type: 'text/html; charset=utf-8',
    text_sha256: typeof text === 'string' ? await sha256Hex(text) : null,
    ...over,
    text,
  };
}

const hold = (n: number, reasons = ['extraction_not_allowed']): HoldLine => ({ source_key: key(n), reasons });
const opts = (over: Partial<SelectOptions> = {}): SelectOptions => ({ limit: 20, offset: 0, budgetUsd: 1, ...over });

// ---- arguments ----

Deno.test('parseWebArgs: the two commands, their defaults and their refusals', () => {
  assertEquals(parseWebArgs(['web-enqueue', '--records', 'r', '--holds', 'h', '--dry-run']), {
    cmd: 'web-enqueue',
    records: 'r',
    holds: 'h',
    limit: MAX_SELECTION,
    offset: 0,
    psql: 'psql',
    budgetUsd: 1,
    dryRun: true,
  });
  assertEquals(parseWebArgs(['web-collect', '--records', 'r', '--holds', 'h', '--out', 'o']), {
    cmd: 'web-collect',
    records: 'r',
    holds: 'h',
    limit: MAX_SELECTION,
    offset: 0,
    psql: 'psql',
    out: 'o',
    minIdentity: DEFAULT_MIN_IDENTITY,
  });
  assertEquals(DEFAULT_MIN_IDENTITY, 0.8);
  const c = parseWebArgs(['web-collect', '--records', 'r', '--holds', 'h', '--out', 'o', '--min-identity', '0.65']);
  assertEquals(c.cmd === 'web-collect' && c.minIdentity, 0.65);
  for (const m of ['1.5', '-0.1', 'x', '2', '.8']) {
    assertThrows(
      () => parseWebArgs(['web-collect', '--records', 'r', '--holds', 'h', '--out', 'o', '--min-identity', m]),
      Error,
      '--min-identity',
      m,
    );
  }
  assertThrows(() => parseWebArgs(['web-collect', '--records', 'r', '--holds', 'h']), Error, '--out is required');
  assertThrows(
    () => parseWebArgs(['web-collect', '--records', 'r', '--holds', 'h', '--out', 'o', '--dry-run']),
    Error,
    '--dry-run',
  );
  assertThrows(
    () => parseWebArgs(['web-enqueue', '--records', 'r', '--holds', 'h', '--min-identity', '0.5']),
    Error,
    'unknown option --min-identity',
  );
  assertThrows(() => parseWebArgs(['web-enqueue', '--records', 'r']), Error, '--holds is required');
  assertThrows(
    () => parseWebArgs(['web-enqueue', '--records', 'r', '--holds', 'h', '--budget-usd', '1e3']),
    Error,
    '--budget-usd',
  );
  assertThrows(() => parseWebArgs(['web-enqueue', '--records', 'r', '--holds', 'h', '--limit', '-1']), Error);
  assertThrows(() => parseWebArgs(['ocr-enqueue']), Error, 'usage');
});

// ---- the URL rule ----

Deno.test("officialPage: each of the record's official page forms passes, as it is", () => {
  for (const u of [PR(63752), NT(13734), PR(1), NT(1234567), SEBI(94363), 'https://www.sebi.gov.in/a/b_c-d.e.html']) {
    assertEquals(officialPage(u), u, u);
  }
});

Deno.test('officialPage: the blocked PDF, other hosts and every malformed link are refused', () => {
  const refused: unknown[] = [
    'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR1.PDF',
    'https://rbidocs.rbi.org.in/rdocs/notification/PDFs/NT1.pdf',
    'https://rbidocs.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'http://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://WWW.RBI.ORG.IN/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=12345678',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1&x=2',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?x=2&prid=1',
    'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1#top',
    'https://www.rbi.org.in/Scripts/NotificationUser.aspx?id=1',
    'https://www.rbi.org.in:443/Scripts/NotificationUser.aspx?Id=1',
    'https://u:p@www.rbi.org.in/Scripts/NotificationUser.aspx?Id=1',
    'https://www.rbi.org.in/Scripts/../Scripts/NotificationUser.aspx?Id=1',
    'https://www.sebi.gov.in/legal/a.html?x=1',
    'https://www.sebi.gov.in/legal/a.pdf',
    'https://www.sebi.gov.in/legal/A.html',
    'https://www.sebi.gov.in/legal/../a.html',
    'https://www.sebi.gov.in/legal/./a.html',
    'https://www.sebi.gov.in/legal/%2e%2e/a.html',
    'https://www.sebi.gov.in/legal%2fa.html',
    'https://www.sebi.gov.in/legal/a b.html',
    'https://www.sebi.gov.in.example.org/legal/a.html',
    'https://sebi.gov.in/legal/a.html',
    `https://www.sebi.gov.in/${'a'.repeat(401)}.html`,
    'https://www.pib.gov.in/x.html',
    `${PR(1)}\n`,
    '',
    null,
    5,
    {},
  ];
  for (const u of refused) assertEquals(officialPage(u), null, String(u));
});

// ---- the plan ----

Deno.test('planWeb: selects html records held only for text reasons, in key order, with the estimate', async () => {
  const records = [await packRecord(3), await packRecord(1), await packRecord(2), await packRecord(4)];
  const holds = [
    hold(3),
    hold(1, ['extraction_not_allowed', 'too_short']),
    hold(2, ['extraction_not_allowed', 'too_long']),
    hold(4, ['extraction_not_allowed', 'already_live']),
  ];
  const plan = planWeb(records, holds, opts());
  assert(plan.ok);
  assertEquals(plan.items, [
    { source_key: key(1), official_url: PR(1), pack_sha256: String(records[1].content_sha256) },
    { source_key: key(2), official_url: PR(2), pack_sha256: String(records[2].content_sha256) },
    { source_key: key(3), official_url: PR(3), pack_sha256: String(records[0].content_sha256) },
  ]);
  assertEquals(plan.counts, { records: 4, eligible: 3, other_holds: 1, selected: 3 });
  assertEquals(plan.estimate_usd, 0.015);
});

Deno.test('planWeb: a reason the new text cannot change keeps a record out; so does a text type other than html', async () => {
  const blocking = [
    'already_live',
    'suggested_key_collision',
    'suggested_key_held_live',
    'file_url_collision',
    'duplicate_title_live',
    'publisher_unresolved',
    'unknown_host',
    'citation_incomplete',
    'not_official_url',
    'bad_shape',
    'licence_not_admitted',
    'no_page_spans',
    'screen_incomplete',
    'check_error',
  ];
  for (const reason of blocking) {
    const plan = planWeb([await packRecord(1)], [hold(1, ['extraction_not_allowed', reason])], opts());
    assertEquals(plan.ok, false, reason);
    assertEquals(plan.refused, { nothing_selected: 1 }, reason);
  }
  // Not held for the text type at all: nothing to scrape.
  assertEquals(planWeb([await packRecord(1)], [hold(1, ['too_short'])], opts()).counts.eligible, 0);
  // The SEBI PDFs held as mixed or ocr are not web pages: never selected, even when their only hold is the text type.
  for (const extraction of ['mixed', 'ocr', 'pdf_text', 'web_firecrawl', undefined]) {
    const plan = planWeb([await packRecord(1, { extraction })], [hold(1)], opts());
    assertEquals(plan.counts.eligible, 0, String(extraction));
  }
  // A held key with no record is not selected either.
  assertEquals(planWeb([], [hold(1)], opts()).counts.eligible, 0);
});

Deno.test('planWeb: limit and offset slice the eligible keys; the limit is at most 50', async () => {
  const records: Rec[] = [];
  for (let i = 1; i <= 60; i++) records.push(await packRecord(i));
  const holds = records.map((_, i) => hold(i + 1));
  const plan = planWeb(records, holds, opts({ limit: 50, offset: 5 }));
  assertEquals(plan.items.length, 50);
  assertEquals(plan.items[0].source_key, key(6));
  assertEquals(plan.estimate_usd, 0.25);
  assertEquals(planWeb(records, holds, opts({ limit: 10, offset: 55 })).items.map((i) => i.source_key), [
    key(56),
    key(57),
    key(58),
    key(59),
    key(60),
  ]);
  assertThrows(() => planWeb(records, holds, opts({ limit: 51 })), Error, 'limit');
  assertThrows(() => planWeb(records, holds, opts({ limit: 0 })), Error, 'limit');
  assertThrows(() => planWeb(records, holds, opts({ budgetUsd: 0 })), Error, 'budget');
  assertEquals(planWeb(records, holds, opts({ offset: 60 })).refused, { nothing_selected: 1 });
});

Deno.test('planWeb: one link outside the rule refuses the whole plan; so does any other bad record', async () => {
  const fine = [await packRecord(1), await packRecord(2)];
  const holds = [hold(1), hold(2), hold(3)];
  const cases: Array<[Rec, string]> = [
    [await packRecord(3, { file_url: 'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR3.PDF' }), 'file_url'],
    [
      await packRecord(3, { file_url: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=3&x=1' }),
      'file_url',
    ],
    [
      await packRecord(3, { citation: { kind: 'regulatory', regulator: 'RBI', source: 's', page_url: PR(4) } }),
      'page_url_mismatch',
    ],
    [await packRecord(3, { pages: [{ page_number: 1, char_from: 0, char_to: 1 }] }), 'page_split'],
    [await packRecord(3, { page_split: 'exact' }), 'page_split'],
    [await packRecord(3, { page_count: 1 }), 'page_split'],
    [await packRecord(3, { content_sha256: 'x' }), 'content_sha256'],
    [await packRecord(3, { text: 5 }), 'pack_text'],
  ];
  for (const [bad, reason] of cases) {
    const plan = planWeb([...fine, bad], holds, opts());
    assertEquals(plan.ok, false, reason);
    assertEquals(plan.items, [], reason);
    assertEquals(plan.refused, { [reason]: 1 }, reason);
  }
  // A key that is not 40 hex (a record the screen would hold as record_shape) is refused, never queued.
  const odd = { ...await packRecord(3), source_key: 'k3' };
  assertEquals(
    planWeb([...fine, odd], [hold(1), hold(2), { source_key: 'k3', reasons: ['extraction_not_allowed'] }], opts())
      .refused,
    {
      record_shape: 1,
    },
  );
});

Deno.test('planWeb: an estimate over the budget refuses the whole plan; exactly the budget passes', async () => {
  const records: Rec[] = [];
  for (let i = 1; i <= 50; i++) records.push(await packRecord(i));
  const holds = records.map((_, i) => hold(i + 1));
  const over = planWeb(records, holds, opts({ limit: 50, budgetUsd: 0.2 }));
  assertEquals([over.ok, over.items.length, over.refused], [false, 0, { over_budget: 1 }]);
  assertEquals(planWeb(records, holds, opts({ limit: 50, budgetUsd: 0.25 })).ok, true);
});

// ---- the normaliser ----

Deno.test('normaliseMarkdown: images removed, links to their labels, bare URLs kept, blank runs collapsed, controls counted', () => {
  const n = (s: string) => normaliseMarkdown(s);
  assertEquals(n('a ![logo](https://x/y.png) b'), { text: 'a  b', controlCodesRemoved: 0 });
  assertEquals(n('![x](<https://x/a b.png>)').text, '');
  assertEquals(n('see [the circular](https://x/a?b=1 "title") now').text, 'see the circular now');
  assertEquals(n("see [it](https://x/a 'single') now").text, 'see it now');
  assertEquals(n('[Wiki](https://en.wikipedia.org/wiki/A_(b)) page').text, 'Wiki page');
  assertEquals(n('[![img](https://x/i.png)](https://x/page)').text, '');
  assertEquals(n('[a](https://x/1) and [b](<https://x/2>)').text, 'a and b');
  assertEquals(n('[[nested]](https://x/1)').text, '[nested]');
  assertEquals(n('see [note [1] here](https://x/1) now').text, 'see note [1] here now');
  assertEquals(n('go to https://www.rbi.org.in/x?y=1 now').text, 'go to https://www.rbi.org.in/x?y=1 now');
  assertEquals(n('see <https://www.rbi.org.in/x> now').text, 'see https://www.rbi.org.in/x now');
  assertEquals(n('a\n\n\n\nb\n \n\t\nc').text, 'a\n\nb\n\nc');
  assertEquals(n('a  \nb\t\n').text, 'a\nb');
  assertEquals(n('\n\n  title\n'), { text: 'title', controlCodesRemoved: 0 });
  assertEquals(n('a\u0000b\u0007c\r\nd\fe\u007f'), { text: 'abc\nde', controlCodesRemoved: 5 });
  // Tabs and line feeds are text; a table keeps its rows.
  assertEquals(n('| a | b |\n|---|---|\n| 1 | 2 |').text, '| a | b |\n|---|---|\n| 1 | 2 |');
  // A bracket that is not a link is left as it is.
  assertEquals(n('[note] (see below)').text, '[note] (see below)');
  // The same input gives the same output.
  assertEquals(n(markdown(7)), n(markdown(7)));
});

// ---- the identity check ----

Deno.test('identityShare: the share of the new text 5-grams the pack text has; case and punctuation do not count', () => {
  assertEquals(identityShare('one two three four five', 'One, two; three - four. Five!'), 1);
  assertEquals(identityShare('one two three four five six', 'one two three four five'), 0.5);
  assertEquals(identityShare('a b c d e f g h', 'z y x w v u'), 0);
  // Fewer than five words prove nothing.
  assertEquals(identityShare('one two three four', 'one two three four'), 0);
  assertEquals(identityShare('', 'anything at all here now'), 0);
  // Extra words in the pack (its menu) do not lower the share.
  assertEquals(identityShare(notice(3), packText(3)), 1);
  // The markdown of the page against the pack text of the same page, and of another page.
  assert(identityShare(normaliseMarkdown(markdown(3)).text, packText(3)) >= 0.8);
  assert(identityShare('Access denied. Please enable cookies and try again later today.', packText(3)) < 0.1);
  assertEquals(
    ['0-0.5', '0.5-0.8', '0.8-0.9', '0.9-0.95', '0.95-1', '1'],
    [0.1, 0.6, 0.8, 0.94, 0.99, 1].map(identityBucket),
  );
});

// ---- the record built from the web text ----

const screenSettings: Rec = {
  licenceClasses: ['govt_material_confirm_counsel'],
  minCharsPerPage: 600,
  minPagesForDensity: 5,
  requirePageCount: false,
};
const PREPARE = { maxChunks: 700, requireTextIdentity: true, dropInvalidCitationDates: true };
const live: LiveReader = {
  documents: () => Promise.resolve([]),
  identity: () => Promise.resolve({ database: 'fake', server: 'fake', documents: 1, deskRows: 0 }),
  deskRows: () => Promise.reject(new Error('no listing rows')),
};
const offered: string[] = [];
const passPage = {
  name: 'text_per_page',
  covers: ['completeness'],
  needs: 'pages',
  onlyIfClean: true,
  stats: { scans: [] },
  all: (records: Rec[]) => {
    offered.push(...records.map((r) => String(r.source_key)));
    return Promise.resolve(new Map<string, Finding[]>());
  },
} as unknown as Check;
const screen = () => makeSearchOnlyScreen(REGULATORY, passPage);
const screenRun = (records: Rec[], settings = screenSettings) =>
  runScreen(screen(), records, { live, settings, prepare: PREPARE } as ScreenContext, {
    packageId: 'National/v1.3/documents/regulators_archive.jsonl.gz#' + 'a'.repeat(64),
    fileSha256: 'b'.repeat(64),
    decisionId: 'decision-1',
    rulesSha256: 'c'.repeat(64),
    noLive: false,
    noPages: false,
  });
const regulatoryTextBinds = () => screen().checks.find((c) => c.name === 'text_binds')!;

Deno.test("buildWebRecord: the pack's own record with the normalised text, web_firecrawl, no pages, and a hash that binds", async () => {
  const orig = await packRecord(5);
  const { record, controlCodesRemoved, identity } = await buildWebRecord(orig, await row(orig), 0.8);
  const text = normaliseMarkdown(markdown(5)).text;
  assertEquals(record.text, text);
  assertEquals(record.content_sha256, await sha256Hex(text));
  assertEquals(record.n_chars, [...text].length);
  assertEquals(record.extraction, 'web_firecrawl');
  assertEquals(record.text_engine, 'firecrawl v2/scrape markdown onlyMainContent proxy=basic');
  assertEquals([record.page_split, record.pages, Object.hasOwn(record, 'page_count')], ['none', [], false]);
  assertEquals(controlCodesRemoved, 0);
  assert(identity >= 0.8 && identity <= 1);
  // Every other field is the pack's own.
  for (const k of Object.keys(orig)) {
    if (!['text', 'content_sha256', 'n_chars', 'extraction', 'text_engine', 'page_count'].includes(k)) {
      assertEquals(record[k], orig[k], k);
    }
  }
  // The screen's own text_binds (the Regulatory one, unpaged) passes it; the pack's record is not touched.
  assertEquals(await regulatoryTextBinds().one!(record, {} as ScreenContext), []);
  assertEquals(orig.extraction, 'html');
  assertEquals(orig.text, packText(5));
});

Deno.test('buildWebRecord: the identity check holds a text below the threshold and passes one at or above it', async () => {
  const orig = await packRecord(6);
  const blocked = 'Access denied\n\nYour request was blocked by the security policy of this site. Reference number 18.';
  await assertRejects(() => buildWebRecord(orig, rowSync(orig, blocked), 0.8), WebRecordError, 'web_text_unbound');
  // A text half of whose 5-grams the pack has: below 0.8, at or above 0.5.
  const half = `${notice(6)}\n${filler(140)}`;
  const share = identityShare(normaliseMarkdown(half).text, packText(6));
  assert(share > 0.2 && share < 0.8, String(share));
  await assertRejects(() => buildWebRecord(orig, rowSync(orig, half), 0.8), WebRecordError, 'web_text_unbound');
  assertEquals((await buildWebRecord(orig, rowSync(orig, half), share)).identity, share);
  await assertRejects(
    () => buildWebRecord(orig, rowSync(orig, half), share + 1e-9),
    WebRecordError,
    'web_text_unbound',
  );
});
/** A done row for a given text, its hash filled in when built. */
function rowSync(orig: Rec, text: string): WebRow {
  return {
    source_key: String(orig.source_key),
    official_url: String(orig.file_url),
    pack_sha256: String(orig.content_sha256),
    status: 'done',
    credits: 1,
    cost_usd: 0.005,
    source_status: 200,
    final_url_host: new URL(String(orig.file_url)).hostname,
    text,
    text_sha256: createHash('sha256').update(text).digest('hex'),
  };
}

Deno.test("buildWebRecord: a row that is not this record's own finished request, or a text that does not bind, builds nothing", async () => {
  const orig = await packRecord(7);
  const refuse = async (r: WebRow, code: string, o: Rec = orig) =>
    await assertRejects(() => buildWebRecord(o, r, 0.8), WebRecordError, code);
  await refuse(await row(orig, { source_key: key(8) }), 'row_key_mismatch');
  await refuse(await row(orig, { status: 'running', text: null }), 'not_done');
  await refuse(await row(orig, { status: 'failed', error_code: 'source_status_403' }), 'not_done');
  await refuse(await row(orig, { pack_sha256: 'e'.repeat(64) }), 'pack_hash_mismatch');
  await refuse(await row(orig, { official_url: PR(8) }), 'url_mismatch');
  const pdfRec = await packRecord(7, { file_url: 'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR7.PDF' });
  await refuse(await row(pdfRec), 'url_mismatch', pdfRec);
  await refuse(await row(orig, { source_status: 403 }), 'source_status');
  await refuse(await row(orig, { source_status: null }), 'source_status');
  await refuse(await row(orig, { final_url_host: 'www.example.org' }), 'final_host');
  await refuse(await row(orig, { final_url_host: null }), 'final_host');
  await refuse(await row(orig, { text: 5 as unknown as string, text_sha256: 'a'.repeat(64) }), 'text_not_string');
  await refuse(await row(orig, { text_sha256: 'a'.repeat(64) }), 'text_hash_mismatch');
  await refuse(await row(orig, { text_sha256: null }), 'text_hash_mismatch');
  await refuse(await row(orig, { text: '![only](https://x/an-image.png)\n\n\u0001' }), 'empty_text');
  await refuse(await row(orig, { text: `${markdown(7)}\ud800` }), 'text_malformed');
  const paged = await packRecord(7, { page_split: 'exact' });
  await refuse(await row(paged), 'not_a_page_record', paged);
  const pdfText = await packRecord(7, { extraction: 'pdf_text' });
  await refuse(await row(pdfText), 'not_a_page_record', pdfText);
});

Deno.test('screen: the pack record is held for its text type; the same record with the Firecrawl text is screened', async () => {
  offered.length = 0;
  const orig = await packRecord(9);
  const before = await screenRun([orig]);
  assertEquals(before.screened, []);
  assertEquals(before.holds.map((h) => h.reasons), [['extraction_not_allowed']]);
  const { record } = await buildWebRecord(orig, await row(orig), 0.8);
  const after = await screenRun([record]);
  assertEquals(after.holds, []);
  assertEquals(after.screened.map((r) => [r.extraction, r.completeness_basis]), [['web_firecrawl', 'density_only']]);
  // Never offered to the page check (no PDF is fetched).
  assertEquals(offered, []);
  // Under a policy that requires a page count, it is held, as admission would hold it.
  assertEquals((await screenRun([record], { ...screenSettings, requirePageCount: true })).holds.map((h) => h.reasons), [
    [
      'no_page_spans',
    ],
  ]);
  // A stub page whose text is short stays held as too short.
  const stub = await buildWebRecord(orig, rowSync(orig, notice(9).split('\n').slice(0, 3).join('\n')), 0.8);
  assertEquals((await screenRun([stub.record])).holds.map((h) => h.reasons), [['too_short']]);
});

// ---- the commands ----

class FakeWebDb implements WebDb {
  calls: string[] = [];
  enqueued: EnqueueItem[][] = [];
  constructor(
    public rows: WebRow[] = [],
    public result: (items: EnqueueItem[]) => EnqueueResult = (i) =>
      i.map((x) => ({ source_key: x.source_key, outcome: 'queued' as const })),
  ) {}
  session() {
    this.calls.push('session');
    return Promise.resolve();
  }
  enqueue(items: EnqueueItem[]) {
    this.calls.push('enqueue');
    this.enqueued.push(items);
    return Promise.resolve(this.result(items));
  }
  read(keys: string[]) {
    this.calls.push(`read ${keys.length}`);
    return Promise.resolve(this.rows.filter((r) => keys.includes(r.source_key)));
  }
  status() {
    this.calls.push('status');
    return Promise.resolve({ by_status: { queued: 2 } });
  }
}

const OUT = resolve(Deno.env.get('TMPDIR') ?? '/tmp', 'f369-out-test');

async function world(n = 3, extra: (i: number) => Rec = () => ({})) {
  const recs: Rec[] = [];
  for (let i = 1; i <= n; i++) recs.push(await packRecord(i, extra(i)));
  const body = recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const files = new Map<string, string>([
    ['/in/records.jsonl', body],
    [
      '/in/holds.jsonl',
      recs.map((r) =>
        JSON.stringify({
          source_key: r.source_key,
          set: 'records',
          reasons: ['extraction_not_allowed'],
          findings: [{ detail: MARKER }],
        })
      ).join('\n') + '\n',
    ],
    [
      '/in/records.jsonl.receipt.json',
      JSON.stringify({
        pack: 'National/v1.3',
        entry: 'documents/regulators_archive.jsonl.gz',
        manifest_sha256: 'd'.repeat(64),
        lines_written: n,
        output_sha256: createHash('sha256').update(body).digest('hex'),
        output_bytes: body.length,
      }),
    ],
  ]);
  const logs: string[] = [];
  const written = new Map<string, string>();
  const made: string[] = [];
  const db = new FakeWebDb();
  const deps: WebCliDeps = {
    readText: (p) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Deno.errors.NotFound(p)),
    readBytes: (p) =>
      files.has(p)
        ? Promise.resolve(new TextEncoder().encode(files.get(p)!))
        : Promise.reject(new Deno.errors.NotFound(p)),
    writeText: (p, b) => {
      if (written.has(p)) return Promise.reject(new Error('exists'));
      written.set(p, b);
      return Promise.resolve();
    },
    makeDir: (d) => (made.push(d), Promise.resolve()),
    commonDir: () => Promise.resolve(null),
    webDb: () => db,
    log: (l) => logs.push(l),
    now: () => 1_700_000_000_000,
  };
  return { recs, files, logs, written, made, db, deps };
}

const enqueueArgs = (extra: string[] = []) => [
  'web-enqueue',
  '--records',
  '/in/records.jsonl',
  '--holds',
  '/in/holds.jsonl',
  ...extra,
];
const collectArgs = (extra: string[] = []) => [
  'web-collect',
  '--records',
  '/in/records.jsonl',
  '--holds',
  '/in/holds.jsonl',
  '--out',
  OUT,
  ...extra,
];

/** Nothing of a record but counts may reach the output: no URL, no source key, no text, no finding detail. */
function assertCountsOnly(logs: string[], recs: Rec[]) {
  const out = logs.join('\n');
  for (const r of recs) {
    assert(!out.includes(String(r.source_key)), 'a source key was printed');
    assert(!out.includes(String(r.file_url)), 'a URL was printed');
  }
  for (const bad of ['rbi.org.in', 'http', MARKER, 'Reserve Bank', 'Directions number', 'liquidity']) {
    assert(!out.includes(bad), `printed ${bad}`);
  }
}

Deno.test('web-enqueue: queues the selected records and prints counts only', async () => {
  const w = await world(3);
  assertEquals(await webCommand(enqueueArgs(['--limit', '2']), w.deps), 0);
  assertEquals(w.db.enqueued.length, 1);
  assertEquals(w.db.enqueued[0], [
    { source_key: key(1), official_url: PR(1), pack_sha256: String(w.recs[0].content_sha256) },
    { source_key: key(2), official_url: PR(2), pack_sha256: String(w.recs[1].content_sha256) },
  ]);
  assertEquals(w.db.calls, ['session', 'enqueue', 'status']);
  const out = w.logs.join('\n');
  assert(out.includes('3 records, 3 html records held only for text reasons, 0 other holds'), out);
  assert(out.includes('selected 2: scrape estimate US$0.010'), out);
  assert(out.includes('queued 2 of 2'), out);
  assertCountsOnly(w.logs, w.recs);
});

Deno.test('web-enqueue --dry-run touches no database', async () => {
  const w = await world(3);
  assertEquals(await webCommand(enqueueArgs(['--dry-run']), w.deps), 0);
  assertEquals(w.db.calls, []);
  assert(w.logs.join('\n').includes('dry run: nothing queued'));
});

Deno.test('web-enqueue: a refused plan sends nothing; duplicates alone are not a failure; another refusal is', async () => {
  const bad = await world(
    3,
    (i) => i === 2 ? { file_url: 'https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR2.PDF' } : {},
  );
  assertEquals(await webCommand(enqueueArgs(), bad.deps), 1);
  assertEquals(bad.db.calls, []);
  assert(bad.logs.join('\n').includes('refused: 1 file_url'));
  assertCountsOnly(bad.logs, bad.recs);
  const over = await world(3);
  assertEquals(await webCommand(enqueueArgs(['--budget-usd', '0.01']), over.deps), 1);
  assertEquals(over.db.calls, []);
  assert(over.logs.join('\n').includes('refused: 1 over_budget'));
  const dup = await world(2);
  dup.db.result = (items) =>
    items.map((i) => ({ source_key: i.source_key, outcome: 'refused' as const, reason: 'duplicate' }));
  assertEquals(await webCommand(enqueueArgs(), dup.deps), 0);
  assert(dup.logs.join('\n').includes('refused: 2 duplicate'));
  const other = await world(2);
  other.db.result = (items) =>
    items.map((i) => ({ source_key: i.source_key, outcome: 'refused' as const, reason: 'url_rule' }));
  assertEquals(await webCommand(enqueueArgs(), other.deps), 1);
  assertCountsOnly(other.logs, other.recs);
});

Deno.test('web-collect: writes the records and a receipt chained to the reader; counts outcomes, money and identity', async () => {
  const w = await world(4);
  w.db.rows = [
    await row(w.recs[0]),
    await row(w.recs[1], { status: 'running', text: null, credits: null, cost_usd: null }),
    await row(w.recs[2], {
      status: 'failed',
      text: null,
      error_code: 'source_status_403',
      credits: 1,
      cost_usd: 0.005,
    }),
    rowSync(w.recs[3], 'Access denied. Your request was blocked by the security policy of this site today.'),
  ];
  assertEquals(await webCommand(collectArgs(), w.deps), 1);
  assertEquals(w.made, [OUT]);
  const recordsPath = `${OUT}/web-records.jsonl`;
  assertEquals([...w.written.keys()].sort(), [recordsPath, `${recordsPath}.receipt.json`]);
  const body = w.written.get(recordsPath)!;
  const lines = body.trim().split('\n').map((l) => JSON.parse(l) as Rec);
  assertEquals(lines.map((l) => [l.source_key, l.extraction]), [[key(1), 'web_firecrawl']]);
  assertEquals(await regulatoryTextBinds().one!(lines[0], {} as ScreenContext), []);
  const receipt = JSON.parse(w.written.get(`${recordsPath}.receipt.json`)!);
  assertEquals(receipt.output_sha256, createHash('sha256').update(body).digest('hex'));
  assertEquals([receipt.lines_written, receipt.lines_read], [1, 1]);
  assertEquals(receipt.output_bytes, new TextEncoder().encode(body).length);
  assertEquals([receipt.pack, receipt.manifest_sha256], ['National/v1.3', 'd'.repeat(64)]);
  assertEquals(receipt.entry, 'documents/regulators_archive.jsonl.gz+web-f369');
  assertEquals(
    receipt.derived_from.output_sha256,
    JSON.parse(w.files.get('/in/records.jsonl.receipt.json')!).output_sha256,
  );
  assertEquals(receipt.derived_from.hold_reasons, ['extraction_not_allowed', 'too_short', 'too_long']);
  assertEquals(receipt.web.request_options, REQUEST_OPTIONS);
  assertEquals(
    receipt.web.request_options_sha256,
    createHash('sha256').update(canonical(REQUEST_OPTIONS)).digest('hex'),
  );
  assertEquals(receipt.web.outcomes, { done: 1, pending: 1, failed: 1, not_queued: 0, not_built: 1 });
  assertEquals(receipt.web.failed_by_code, { source_status_403: 1 });
  assertEquals(receipt.web.not_built_by_code, { web_text_unbound: 1 });
  assertEquals(receipt.web.failed_keys, { source_status_403: [key(3)] });
  assertEquals(receipt.web.not_built_keys, { web_text_unbound: [key(4)] });
  // Money of every finished row: the done one, the failed one and the unbound one (1 credit each).
  assertEquals([receipt.web.credits, receipt.web.cost_usd], [3, 0.015]);
  assertEquals(receipt.web.identity.threshold, 0.8);
  assertEquals(Object.values(receipt.web.identity.distribution as Record<string, number>).reduce((a, b) => a + b), 2);
  assertEquals(receipt.web.identity.distribution['0-0.5'], 1);
  assertEquals(receipt.web.complete, false);
  const out = w.logs.join('\n');
  assert(out.includes('done 1, pending 1, failed 1, not queued 0, not built 1'), out);
  assert(out.includes('failed by code: 1 source_status_403'), out);
  assert(out.includes('not built by code: 1 web_text_unbound'), out);
  assertCountsOnly(w.logs, w.recs);
});

Deno.test('web-collect: all done is complete and exits 0; nothing done writes nothing and exits 1', async () => {
  const w = await world(2);
  w.db.rows = [await row(w.recs[0]), await row(w.recs[1])];
  assertEquals(await webCommand(collectArgs(), w.deps), 0);
  assertEquals(JSON.parse(w.written.get(`${OUT}/web-records.jsonl.receipt.json`)!).web.complete, true);
  const none = await world(2);
  assertEquals(await webCommand(collectArgs(), none.deps), 1);
  assertEquals(none.written.size, 0);
  assert(none.logs.join('\n').includes('not queued 2'));
});

Deno.test('web-collect: --min-identity is the threshold the build uses and the receipt records', async () => {
  const w = await world(2);
  const half = `${notice(2)}\n${filler(140)}`;
  w.db.rows = [await row(w.recs[0]), rowSync(w.recs[1], half)];
  assertEquals(await webCommand(collectArgs(['--min-identity', '0.1']), w.deps), 0);
  const receipt = JSON.parse(w.written.get(`${OUT}/web-records.jsonl.receipt.json`)!);
  assertEquals([receipt.web.identity.threshold, receipt.lines_written], [0.1, 2]);
  const strict = await world(2);
  strict.db.rows = [await row(strict.recs[0]), rowSync(strict.recs[1], half)];
  assertEquals(await webCommand(collectArgs(), strict.deps), 0);
  assertEquals(JSON.parse(strict.written.get(`${OUT}/web-records.jsonl.receipt.json`)!).lines_written, 1);
});

Deno.test("web-collect: a row that is not the record's own request is not built", async () => {
  const w = await world(2);
  w.db.rows = [await row(w.recs[0], { pack_sha256: 'e'.repeat(64) }), await row(w.recs[1])];
  assertEquals(await webCommand(collectArgs(), w.deps), 0);
  assert(w.logs.join('\n').includes('not built by code: 1 pack_hash_mismatch'));
  assertEquals(w.written.get(`${OUT}/web-records.jsonl`)!.trim().split('\n').length, 1);
});

Deno.test('web-collect: refuses a records file its receipt does not vouch for, and an output inside a checkout', async () => {
  const w = await world(2);
  w.files.set('/in/records.jsonl', w.files.get('/in/records.jsonl')! + ' ');
  await assertRejects(() => webCommand(collectArgs(), w.deps), Error, "not the receipt's output_sha256");
  assertEquals(w.db.calls, []);
  const w2 = await world(2);
  w2.files.delete('/in/records.jsonl.receipt.json');
  await assertRejects(() => webCommand(collectArgs(), w2.deps), Error, 'receipt');
  const w3 = await world(2);
  const inside = [
    'web-collect',
    '--records',
    '/in/records.jsonl',
    '--holds',
    '/in/holds.jsonl',
    '--out',
    `${Deno.cwd()}/out-inside`,
  ];
  await assertRejects(() => webCommand(inside, w3.deps), Error);
  assertEquals([w3.written.size, w3.db.calls.length], [0, 0]);
});

Deno.test('web-collect: reads the queue ten keys at a time', async () => {
  const w = await world(23);
  await webCommand(collectArgs(['--limit', '23']), w.deps);
  assertEquals(w.db.calls.filter((c) => c.startsWith('read')), ['read 10', 'read 10', 'read 3']);
});

// ---- psql and the entry point ----

Deno.test('PsqlWebDb: connects only as corpus_ingest, calls the queue functions, and quotes what it sends', async () => {
  const scripts: string[] = [];
  const exec = (who: string, answer = '[]') => (sql: string) => {
    scripts.push(sql);
    return Promise.resolve({
      code: 0,
      stdout: sql.includes('current_user') ? `${who}\n` : answer,
      stderr: '',
      timedOut: false,
    });
  };
  await assertRejects(() => new PsqlWebDb(exec('postgres')).session(), Error, 'only as corpus_ingest');
  await assertRejects(() => new PsqlWebDb(exec('service_role')).session(), Error, 'only as corpus_ingest');
  await new PsqlWebDb(exec('corpus_ingest')).session();
  const db = new PsqlWebDb(
    exec('corpus_ingest', JSON.stringify({ results: [{ source_key: key(1), outcome: 'queued' }] })),
  );
  const item = { source_key: key(1), official_url: `${PR(1)}$q$;drop table x;--'`, pack_sha256: 'a'.repeat(64) };
  assertEquals((await db.enqueue([item]))[0].outcome, 'queued');
  let sent = scripts.at(-1)!;
  assert(sent.includes('select public.web_text_enqueue($q'), sent);
  assert(sent.includes("set statement_timeout = '60000ms'"));
  assert(sent.startsWith('\\set ON_ERROR_STOP on'));
  // The literal's tag is not one that occurs in the text, so nothing in a record can end it.
  const tag = /\$q[0-9a-f]{12}\$/.exec(sent)![0];
  assertEquals(sent.split(tag).length, 3);
  const reader = new PsqlWebDb(exec('corpus_ingest', JSON.stringify([{ source_key: key(1), status: 'done' }])));
  assertEquals((await reader.read([key(1), key(2)])).length, 1);
  sent = scripts.at(-1)!;
  assert(sent.includes('public.web_text_read(array(select jsonb_array_elements_text($q'), sent);
  assertEquals(await new PsqlWebDb(exec('corpus_ingest', 'null')).read([key(1)]), []);
  await new PsqlWebDb(exec('corpus_ingest', '{"by_status":{}}')).status();
  assert(scripts.at(-1)!.includes('select public.web_text_status()::text;'));
  await assertRejects(
    () => new PsqlWebDb(() => Promise.resolve({ code: 1, stdout: '', stderr: 'boom', timedOut: false })).read([key(1)]),
    Error,
    'psql exited 1',
  );
  await assertRejects(
    () => new PsqlWebDb(() => Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: true })).status(),
    Error,
    'no answer',
  );
  await assertRejects(
    () => new PsqlWebDb(() => Promise.resolve({ code: 0, stdout: '  ', stderr: '', timedOut: false })).status(),
    Error,
    'empty answer',
  );
});

Deno.test('cli main: web-enqueue and web-collect are dispatched to this route', async () => {
  const w = await world(2);
  const deps = { ...w.deps } as unknown as CliDeps;
  assertEquals(await main(enqueueArgs(['--dry-run']), deps), 0);
  assert(w.logs.join('\n').includes('dry run: nothing queued'));
  w.db.rows = [await row(w.recs[0]), await row(w.recs[1])];
  assertEquals(await main(collectArgs(), deps), 0);
  assert(w.written.has(`${OUT}/web-records.jsonl`));
});
