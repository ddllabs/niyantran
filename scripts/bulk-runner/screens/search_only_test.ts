// Tests for the generic search-only screen with the Regulatory configuration. Records are built by hand in the pack's
// shape; live reads and the page check are fakes. Nothing here touches a database, the network or a real pack.
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { sha256Hex } from '../../../supabase/functions/_shared/textNormalise.ts';
import { type Check, type Finding, type LiveDocument, type LiveReader, REVIEW_CHECKS } from '../screen_types.ts';
import type { ScreenContext } from '../screen_types.ts';
import { type PrepareOptions, prepareRecord, type Rec } from '../prepare.ts';
import { NATIONAL_SEARCH_ONLY } from '../../../supabase/functions/_shared/suppliedText.ts';
import { rulesSha256, type RunOptions, runScreen, runScreenSets, screenSets } from '../screen.ts';
import { makeBillsScreen, makeLength } from './bills.ts';
import {
  makeSearchOnlyScreen,
  parseSearchOnlyConfig,
  pdfUrlRule,
  verhoeffValid,
  yearLikeTriple,
} from './search_only.ts';
import REGULATORY from './regulatory.json' with { type: 'json' };
import BUDGET from './budget.json' with { type: 'json' };
import CABINET from './cabinet.json' with { type: 'json' };
import TRANSFERS from './transfers.json' with { type: 'json' };
import INDUSTRY from './industry.json' with { type: 'json' };
import MP_PROFILES from './mp_profiles.json' with { type: 'json' };

const FEATURE = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
const LISTING = 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)';
const LICENCE = 'govt_material_confirm_counsel';
const SETTINGS: Rec = {
  licenceClasses: [LICENCE],
  minCharsPerPage: 600,
  minPagesForDensity: 5,
  requirePageCount: true,
};
const PDF = (n: number) => `https://rbidocs.rbi.org.in/rdocs/notification/PDFs/N${n}.pdf`;
const HTML = (n: number) => `https://www.sebi.gov.in/legal/circulars/c${n}.html`;
const ASPX = (n: number) => `https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=${n}`;
const key = (n: number) => n.toString(16).padStart(40, '0');
const MARKER = 'HOSTILE-MARKER-4d2c';
/** The runner's prepare block for this collection (D6: 700 chunks), as the collection file carries it. */
const PREPARE: PrepareOptions = {
  maxChunks: 700,
  requireTextIdentity: true,
  dropInvalidCitationDates: true,
};

type DocQuery = Parameters<LiveReader['documents']>[0];
class FakeLive implements LiveReader {
  docCalls: DocQuery[] = [];
  /** A reader that ignores the tier and feature of a query, as a faulty one might: the check must not trust it. */
  leaky = false;
  constructor(public docs: LiveDocument[] = [], public fail = false) {}
  identity() {
    return Promise.resolve({ database: 'fake', server: 'fake', documents: 1, deskRows: 0 });
  }
  deskRows(): Promise<never> {
    return Promise.reject(new Error('the search-only screen reads no listing rows'));
  }
  documents(q: DocQuery) {
    this.docCalls.push(q);
    // The real reader refuses a bad key for the whole call (live.ts checkKeys): a fake that did not would hide a record
    // that takes every other record down with it.
    for (
      const list of [
        q.sourceKeys,
        q.fileUrls,
        q.contentHashes ?? [],
        q.documentKeys ?? [],
        q.suggestedKeys ?? [],
        q.fileMtimes ?? [],
      ]
    ) {
      for (const k of list) {
        if (typeof k !== 'string' || k === '' || k.length > 4_000 || k.includes('\0')) {
          return Promise.reject(new Error('documents: a key is not a non-empty string without NUL'));
        }
      }
    }
    if (this.fail) return Promise.reject(new Error('live read failed'));
    return Promise.resolve(
      this.docs.filter((d) =>
        q.sourceKeys.includes(d.source_key ?? '\0') || q.fileUrls.includes(d.file_url ?? '\0') ||
        (q.contentHashes ?? []).includes(d.content_sha256 ?? '\0') ||
        ((q.suggestedKeys ?? []).includes(d.document_key_suggested ?? '\0') &&
          (this.leaky || q.feature === undefined || q.feature === d.desk_feature)) ||
        ((q.fileMtimes ?? []).includes(d.file_mtime ?? '\0') &&
          (this.leaky || q.feature === undefined || q.feature === d.desk_feature))
      ),
    );
  }
}
const liveDoc = (o: Partial<LiveDocument>): LiveDocument => ({
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
  title: null,
  file_mtime: null,
  source_host: null,
  ...o,
});

type PageCheckLike = Check & { stats: Record<string, unknown> };
/** A page check that holds the keys it is told to (with the reasons given) and records what it was offered. */
function fakePage(verdicts: Record<string, string[]> = {}, extra: Rec = {}, scanKeys: string[] = []) {
  const seen: string[][] = [];
  const check = {
    name: 'text_per_page',
    covers: ['completeness'],
    needs: 'pages',
    onlyIfClean: true,
    stats: { fetched: 2, cached: 1, scans: ['aa'], unverifiedPages: 3, unverifiedRecords: 1 },
    all(records: Rec[]) {
      seen.push(records.map((r) => String(r.source_key)));
      const m = new Map<string, Finding[]>();
      for (const r of records) {
        const v = verdicts[String(r.source_key)];
        if (v) {
          m.set(
            String(r.source_key),
            v.map((reason) => ({ check: 'text_per_page', covers: ['completeness'], reason })),
          );
        }
      }
      for (const [k, v] of Object.entries(extra)) m.set(k, v as Finding[]);
      for (const r of records) {
        if (scanKeys.includes(String(r.source_key)) && !verdicts[String(r.source_key)]) {
          (check.stats.scans as string[]).push(String(r.source_key));
        }
      }
      return Promise.resolve(m);
    },
  } as unknown as PageCheckLike;
  return { check, seen };
}

const screenWith = (config: unknown = REGULATORY, page = fakePage()) => makeSearchOnlyScreen(config, page.check);
const ctxOf = (live: LiveReader = new FakeLive(), settings: Rec = SETTINGS, prepare = PREPARE): ScreenContext => ({
  live,
  settings,
  prepare,
});
const checkNamed = (name: string, s = screenWith()) => {
  const c = s.checks.find((x) => x.name === name);
  assert(c, `no check ${name}`);
  return c;
};

const CITATION: Rec = {
  kind: 'regulation',
  regulator: 'TRAI',
  regulator_name: 'Telecom Regulatory Authority',
  title: 'T',
  source: 'S',
};

/** Pages of `chars` characters each, joined by form feeds, with the spans, counts and hash the pack gives. */
async function textRec(n: number, pages: number, chars: number, over: Rec = {}, lead = ''): Promise<Rec> {
  const texts = Array.from(
    { length: pages },
    (_, i) => `Page ${i + 1} of document ${n}. ${i === 0 ? lead : ''}`.padEnd(chars, 'w'),
  );
  const text = texts.join('\f');
  let at = 0;
  const spans = texts.map((t, i) => {
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
    title: `Master Direction number ${n}`,
    file_name: `N${n}.pdf`,
    file_url: null,
    source_host: 'trai.gov.in',
    licence_class: LICENCE,
    extraction: 'pdf_text',
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: pages,
    page_split: 'exact',
    citation: { ...CITATION },
    links: [],
    pages: spans,
    text,
    document_key_suggested: `reg:${n}`,
    ...over,
  };
}
/** A record that passes every offline check: 3 pages of 400 characters, no official file. */
const good = (n = 1, over: Rec = {}) => textRec(n, 3, 400, over);
/** A record with an RBI PDF and its one link. */
const goodPdf = (n = 1, over: Rec = {}) =>
  textRec(n, 3, 400, {
    file_url: PDF(n),
    source_host: 'rbi.org.in',
    citation: { ...CITATION, regulator: 'RBI', regulator_name: 'Reserve Bank of India' },
    links: [{
      tier: 'national',
      feature: LISTING,
      role: 'primary_document',
      row_key: String(n),
      document_key: `reg:${n}`,
    }],
    ...over,
  });

const oneFindings = async (name: string, r: Rec, ctx = ctxOf()) => await checkNamed(name).one!(r, ctx);
const oneReasons = async (name: string, r: Rec, ctx = ctxOf()) =>
  (await oneFindings(name, r, ctx)).map((f) => f.reason);
const allReasons = async (name: string, records: Rec[], live: LiveReader = new FakeLive()) => {
  const m = await checkNamed(name).all!(records, ctxOf(live));
  return Object.fromEntries([...m].map(([k, fs]) => [k, fs.map((f) => f.reason)]));
};

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  packageId: 'National/v1.1/documents/regulatory.jsonl.gz#' + 'a'.repeat(64),
  fileSha256: 'b'.repeat(64),
  decisionId: 'decision-1',
  rulesSha256: 'c'.repeat(64),
  noLive: false,
  noPages: false,
  ...over,
});
const run = (records: Rec[], s = screenWith(), live: LiveReader = new FakeLive(), over: Partial<RunOptions> = {}) =>
  runScreen(s, records, ctxOf(live), opts(over));
const holdOf = (out: Awaited<ReturnType<typeof run>>, k: string) => out.holds.find((h) => h.source_key === k);

// ---- the screen definition and the configuration ----

Deno.test('definition: collection, version, rules files in the spec order, all five review checks covered, 20 checks in order', () => {
  const s = screenWith();
  assertEquals(s.collection, 'national-regulatory');
  assertEquals(s.mappingVersion, 'search-only-screen-v1');
  assertEquals(s.listingRows, 'none');
  assertEquals(s.rulesFiles, [
    'scripts/bulk-runner/screens/search_only.ts',
    'scripts/bulk-runner/screens/regulatory.json',
    'scripts/bulk-runner/screens/bills.ts',
    'scripts/bulk-runner/screen.ts',
    'scripts/bulk-runner/screen_types.ts',
    'scripts/bulk-runner/screens/index.ts',
    'scripts/bulk-runner/live.ts',
    'scripts/bulk-runner/page_check.ts',
    'scripts/bulk-runner/prepare.ts',
    'supabase/functions/_shared/suppliedText.ts',
    'supabase/functions/_shared/textNormalise.ts',
    'supabase/functions/_shared/publisher.ts',
  ]);
  assertEquals(s.checks.map((c) => c.name), [
    'record_shape',
    'not_a_replacement',
    'source_fields',
    'publisher_unresolved',
    'links_shape',
    'text_binds',
    'length',
    'density',
    'extraction',
    'servable_licence',
    'licence_admitted',
    'already_live',
    'suggested_key_held_live',
    'suggested_key_collision',
    'file_url_collision',
    'duplicate_text',
    'duplicate_text_live',
    'duplicate_title_live',
    'completeness_basis',
    'prepare_holds',
  ]);
  const covered = new Set(s.checks.flatMap((c) => c.covers));
  for (const c of REVIEW_CHECKS) assert(covered.has(c), `${c} not covered`);
  for (const c of s.checks) assert(!!c.one !== !!c.all, `${c.name} needs exactly one of one and all`);
  assertEquals(s.checks.filter((c) => c.needs === 'live').map((c) => c.name), [
    'already_live',
    'suggested_key_held_live',
    'duplicate_text_live',
    'duplicate_title_live',
  ]);
  assertEquals(s.checks.filter((c) => c.needs === 'pages').map((c) => c.name), ['completeness_basis']);
  assertEquals(checkNamed('completeness_basis').onlyIfClean, true);
  assertEquals(checkNamed('completeness_basis').covers, ['completeness']);
});

Deno.test('definition: the rules hash covers the configuration file and the reused Bills checks, and moves with either', async () => {
  const s = screenWith();
  const root = await Deno.makeTempDir({ dir: Deno.env.get('TMPDIR') ?? undefined });
  try {
    const files = new Map(s.rulesFiles.map((f, i) => [f, `content ${i}`]));
    const read = (changed?: string) => (p: string) => {
      const rel = [...files.keys()].find((f) => p.endsWith(f))!;
      return Promise.resolve(new TextEncoder().encode(rel === changed ? 'changed' : files.get(rel)!));
    };
    const base = await rulesSha256(s.rulesFiles, root, read(), SETTINGS);
    assert(
      await rulesSha256(s.rulesFiles, root, read('scripts/bulk-runner/screens/regulatory.json'), SETTINGS) !== base,
    );
    assert(await rulesSha256(s.rulesFiles, root, read('scripts/bulk-runner/screens/bills.ts'), SETTINGS) !== base);
    // The resolver decides a hold, so a change to it must change what the receipt says the rules were.
    assert(await rulesSha256(s.rulesFiles, root, read('supabase/functions/_shared/publisher.ts'), SETTINGS) !== base);
    assert(await rulesSha256(s.rulesFiles, root, read(), { ...SETTINGS, minCharsPerPage: 601 }) !== base);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('definition: every rules file exists in the repository', async () => {
  for (const f of screenWith().rulesFiles) {
    assert((await Deno.stat(new URL(`../../../${f}`, import.meta.url))).isFile, f);
  }
});

Deno.test('configuration: the file in the repository is accepted; anything off is refused by name, and nothing is guessed', () => {
  screenWith();
  const bad = (over: Rec, text: string) =>
    assertThrows(() => makeSearchOnlyScreen({ ...REGULATORY, ...over }, fakePage().check), Error, text);
  bad({ collection: '' }, 'collection');
  bad({ desk_tier: 5 }, 'desk_tier');
  bad({ desk_feature: '' }, 'desk_feature');
  bad({ desk_rows_feature: 1 }, 'desk_rows_feature');
  bad({ doc_type: null }, 'doc_type');
  bad({ suggested_key_prefix: '' }, 'suggested_key_prefix');
  bad({ citation_required: 'kind' }, 'citation_required');
  bad({ citation_required: [] }, 'citation_required');
  bad({ citation_required: [1] }, 'citation_required');
  bad({ extraction_allowed: [] }, 'extraction_allowed');
  bad({ source_hosts: [] }, 'source_hosts');
  bad({ url_hosts: ['https://x/'] }, 'url_hosts');
  bad({ url_hosts: ['UPPER.example'] }, 'url_hosts');
  bad({ pdf_url_rule: '(' }, 'pdf_url_rule');
  bad({ pdf_url_rule: '^http://x' }, 'pdf_url_rule');
  bad({ min_chars: 0 }, 'min_chars');
  bad({ min_chars: 500, max_chars: 400 }, 'max_chars');
  bad({ max_chars: 1.5 }, 'max_chars');
  bad({ replacement_fields: 'x' }, 'replacement_fields');
  bad({ replacement_flags: [''] }, 'replacement_flags');
  bad({ allow_density_only: 'yes' }, 'allow_density_only');
  bad({ require_page_count: true }, 'require_page_count');
  bad({ max_chars: 600_001 }, 'max_chars');
  bad({ pdf_url_rule: '^https://rbidocs\\.rbi\\.org\\.in/.+\\.pdf' }, 'pdf_url_rule');
  bad({ pdf_url_rule: 'https://rbidocs\\.rbi\\.org\\.in/.+\\.pdf$' }, 'pdf_url_rule');
  bad({ pdf_url_rule: '^https://other\\.example/.+\\.pdf$' }, 'pdf_url_rule');
  bad({ pdf_url_rule: '^https://.*$' }, 'pdf_url_rule');
  bad({ unknown_field: 1 }, 'unknown_field');
  bad({ mapping_version: '' }, 'mapping_version');
  for (const nope of [null, 'x', 5, [], undefined]) {
    assertThrows(() => makeSearchOnlyScreen(nope, fakePage().check), Error, 'configuration');
  }
  const { desk_tier: _gone, ...missing } = REGULATORY;
  assertThrows(() => makeSearchOnlyScreen(missing, fakePage().check), Error, 'desk_tier');
});

Deno.test('configuration: the page check must be a whole-set check that needs the pages', () => {
  const wrap = (o: Partial<Check>) => ({ ...fakePage().check, ...o }) as Check;
  assertThrows(
    () => makeSearchOnlyScreen(REGULATORY, wrap({ all: undefined, one: () => Promise.resolve([]) })),
    Error,
    'page check',
  );
  assertThrows(() => makeSearchOnlyScreen(REGULATORY, wrap({ needs: 'live' })), Error, 'page check');
  assertThrows(() => makeSearchOnlyScreen(REGULATORY, null as never), Error, 'page check');
});

Deno.test('configuration: the PDF rule matches RBI PDFs only, with any case, and nothing else', () => {
  const rule = pdfUrlRule(REGULATORY);
  assert(rule.test(PDF(1)) && rule.test(PDF(1).toUpperCase().replace('HTTPS', 'https')));
  for (
    const no of [
      HTML(1),
      ASPX(1),
      'http://rbidocs.rbi.org.in/a.pdf',
      'https://rbidocs.rbi.org.in.evil.example/a.pdf',
      'https://rbidocs.rbi.org.in/a.pdf.html',
      'https://www.rbi.org.in/a.pdf',
    ]
  ) {
    assert(!rule.test(no), no);
  }
});

// ---- the clean record, and the review it earns ----

Deno.test('a clean record with no official file passes every offline check and earns the density_only basis', async () => {
  const r = await good(1);
  for (const c of screenWith().checks) {
    // prepare_holds probes the record with the basis the whole-set completeness check earned; the run below covers it.
    if (c.one && c.name !== 'prepare_holds') assertEquals((await c.one(r, ctxOf())).map((f) => f.reason), [], c.name);
  }
  const out = await run([r]);
  assertEquals(out.holds, []);
  assertEquals(out.screened.length, 1);
  assertEquals(out.screened[0].completeness_basis, 'density_only');
  const review = out.screened[0].review as Rec;
  assertEquals(review.mapping_version, 'search-only-screen-v1');
  assertEquals(review.checks, { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true });
  // The projection only added the one field.
  const { text_sha256: _t, review: _r, completeness_basis: _b, ...rest } = out.screened[0];
  assertEquals(rest, r);
});

Deno.test('a clean record with an RBI PDF whose page check passes earns the page_check basis', async () => {
  const page = fakePage();
  const out = await run([await goodPdf(2)], screenWith(REGULATORY, page));
  assertEquals(out.holds, []);
  assertEquals(out.screened[0].completeness_basis, 'page_check');
  assertEquals(page.seen, [[key(2)]]);
});

// ---- 1 record_shape: bad_shape ----

Deno.test('record_shape: each wrong identity field holds bad_shape and names the field, never its value', async () => {
  const wrong: Rec = {
    schema: 'other/1',
    source_key: 'ab'.repeat(19),
    desk_tier: 'law',
    desk_feature: LISTING,
    desk_rows_feature: FEATURE,
    doc_type: 'bill',
    document_key_suggested: 'law:1',
  };
  for (const [f, v] of Object.entries(wrong)) {
    const fs = await oneFindings('record_shape', await good(1, { [f]: v }));
    assertEquals(fs.map((x) => x.reason), ['bad_shape'], f);
    assertEquals(fs[0].detail, f);
  }
  for (
    const f of [
      'schema',
      'source_key',
      'desk_tier',
      'desk_feature',
      'desk_rows_feature',
      'doc_type',
    ]
  ) {
    for (const v of [undefined, null, 5, {}, [], true]) {
      assertEquals(await oneReasons('record_shape', await good(1, { [f]: v })), ['bad_shape'], `${f} ${String(v)}`);
    }
  }
  assertEquals(await oneReasons('record_shape', await good(1, { source_key: key(0xabc).toUpperCase() })), [
    'bad_shape',
  ]);
  assertEquals(await oneReasons('record_shape', await good(1, { document_key_suggested: 'reg' })), ['bad_shape']);
  assertEquals(await oneReasons('record_shape', await good(1)), []);
});

Deno.test('record_shape: a record that brings its own completeness_basis is held; the screen alone decides it', async () => {
  assertEquals(await oneReasons('record_shape', await good(1, { completeness_basis: 'page_check' })), ['bad_shape']);
  assertEquals(await oneReasons('record_shape', await good(1, { completeness_basis: null })), ['bad_shape']);
});

// ---- 2 not_a_replacement ----

Deno.test('not_a_replacement: v16_replaces true, or a delta_patch or replaces_text of any value, holds replacement_not_supported', async () => {
  for (
    const over of [{ v16_replaces: true }, { delta_patch: null }, { delta_patch: 'x' }, { replaces_text: '' }, {
      replaces_text: {},
    }]
  ) {
    assertEquals(
      await oneReasons('not_a_replacement', await good(1, over)),
      ['replacement_not_supported'],
      JSON.stringify(over),
    );
  }
  for (const over of [{}, { v16_replaces: false }, { v16_replaces: undefined }]) {
    assertEquals(await oneReasons('not_a_replacement', await good(1, over)), [], JSON.stringify(over));
  }
});

// ---- 3 source_fields ----

Deno.test('source_fields: title_invalid for a title that is missing, blank, over 300, not a string or holds NUL', async () => {
  for (const title of [undefined, null, '', '   ', 'x'.repeat(301), 5, {}, 'a\0b']) {
    assertEquals(
      await oneReasons('source_fields', await good(1, { title })),
      ['title_invalid'],
      String(title).slice(0, 10),
    );
  }
  for (const title of ['x', 'x'.repeat(300)]) {
    assertEquals(await oneReasons('source_fields', await good(1, { title })), []);
  }
});

Deno.test('source_fields: citation_incomplete for a citation that is not a non-empty object or lacks a configured field', async () => {
  const cite = (over: Rec) => ({ kind: 'k', regulator: 'R', regulator_name: 'RN', title: 'T', source: 'S', ...over });
  for (const citation of [undefined, null, [], {}, 'x', 5]) {
    assertEquals(await oneReasons('source_fields', await good(1, { citation })), ['citation_incomplete']);
  }
  for (const f of REGULATORY.citation_required) {
    for (const v of [undefined, null, '', '  ', 5, {}]) {
      const fs = await oneFindings('source_fields', await good(1, { citation: cite({ [f]: v }) }));
      assertEquals(fs.map((x) => x.reason), ['citation_incomplete'], f);
      assertEquals(fs[0].detail, f);
    }
  }
  // The date is not required: 2,284 of the pack's records have none.
  assertEquals(await oneReasons('source_fields', await good(1, { citation: cite({ date: '' }) })), []);
  assertEquals(await oneReasons('source_fields', await good(1, { citation: cite({}) })), []);
});

Deno.test('source_fields: field_invalid for a copied field that is not a non-blank string of at most 4,000 without NUL', async () => {
  const fields = [
    'doc_type',
    'pack',
    'schema',
    'as_of',
    'source_host',
    'text_engine',
    'ocr_lang',
    'file_name',
    'file_url',
    'file_url_alt',
    'source_path',
    'source_archive_url',
    'language',
    'extraction',
    'licence',
    'licence_class',
    'attribution',
    'citation_text',
  ];
  for (const f of fields) {
    for (const v of [5, {}, [], true, '', '   ', 'x'.repeat(4001), 'a\0b']) {
      const reasons = await oneReasons('source_fields', await good(1, { [f]: v }));
      assert(
        reasons.includes('field_invalid') || (f === 'source_host' && reasons.includes('unknown_host')),
        `${f} ${String(v).slice(0, 8)}: ${reasons}`,
      );
    }
  }
  for (
    const f of fields.filter((x) =>
      !['source_host', 'doc_type', 'schema', 'extraction', 'licence_class', 'document_key_suggested', 'file_url']
        .includes(x)
    )
  ) {
    assertEquals(
      await oneReasons('source_fields', await good(1, { [f]: f.includes('url') ? 'https://example.org/x' : 'ok' })),
      [],
      f,
    );
    assertEquals(await oneReasons('source_fields', await good(1, { [f]: null })), [], f);
  }
  for (const v of ['ftp://example.org/x', 'https://user:pw@example.org/x', 'not a url', 'javascript:alert(1)']) {
    for (const f of ['file_url_alt', 'source_archive_url']) {
      assertEquals(await oneReasons('source_fields', await good(1, { [f]: v })), ['field_invalid'], `${f} ${v}`);
    }
  }
});

Deno.test('source_fields: text_quality must be absent or ok', async () => {
  for (const v of ['draft', 'OK', null, 1, '']) {
    assertEquals(await oneReasons('source_fields', await good(1, { text_quality: v })), ['text_quality']);
  }
  for (const v of [undefined, 'ok']) {
    assertEquals(await oneReasons('source_fields', await good(1, { text_quality: v })), []);
  }
});

Deno.test('source_fields: unknown_host unless source_host is one of the configured hosts', async () => {
  for (const v of [undefined, null, 'example.org', 'TRAI.GOV.IN', 'trai.gov.in.evil.example']) {
    assert(
      (await oneReasons('source_fields', await good(1, { source_host: v }))).some((r) =>
        r === 'unknown_host' || r === 'field_invalid'
      ),
      String(v),
    );
  }
  assertEquals(await oneReasons('source_fields', await good(1, { source_host: 'example.org' })), ['unknown_host']);
  for (const h of REGULATORY.source_hosts) {
    assertEquals(await oneReasons('source_fields', await good(1, { source_host: h })), []);
  }
});

Deno.test('source_fields: not_official_url for a file_url that is not https on a listed host, or has credentials or a dot segment', async () => {
  for (
    const url of [
      'http://rbidocs.rbi.org.in/a.pdf',
      'https://example.org/a.pdf',
      'https://rbidocs.rbi.org.in.evil.example/a.pdf',
      'https://u:p@rbidocs.rbi.org.in/a.pdf',
      'https://rbidocs.rbi.org.in/a/../b.pdf',
      'https://rbidocs.rbi.org.in/a/%2e%2e/b.pdf',
      'https://rbidocs.rbi.org.in/a%2Fb.pdf',
      'https://rbidocs.rbi.org.in/a\\b.pdf',
      'https://rbidocs.rbi.org.in/a\u0001b.pdf',
      'https://RBIDOCS.rbi.org.in:8443/a.pdf',
      '//rbidocs.rbi.org.in/a.pdf',
      'rbidocs.rbi.org.in/a.pdf',
    ]
  ) {
    assertEquals(await oneReasons('source_fields', await good(1, { file_url: url })), ['not_official_url'], url);
  }
  for (const url of [PDF(1), HTML(1), ASPX(1), 'https://rbidocs.rbi.org.in/a....pdf', null]) {
    assertEquals(await oneReasons('source_fields', await good(1, { file_url: url })), [], String(url));
  }
});

// ---- 4 links_shape ----

Deno.test('links_shape: link_shape unless there are no links or one link that names this document under the listing spelling', async () => {
  const link = { tier: 'national', feature: LISTING, role: 'primary_document', row_key: '7', document_key: 'reg:1' };
  for (const links of [undefined, null, [], [link], [{ ...link, row_key: 'rbi_00012' }]]) {
    assertEquals(await oneReasons('links_shape', await good(1, { links })), [], JSON.stringify(links));
  }
  const bad: unknown[] = [
    [link, link],
    'x',
    5,
    {},
    [5],
    [null],
    [[]],
    [{ ...link, tier: 'law' }],
    [{ ...link, feature: FEATURE }],
    [{ ...link, feature: undefined }],
    [{ ...link, role: 'attachment' }],
    [{ ...link, row_key: '' }],
    [{ ...link, row_key: null }],
    [{ ...link, row_key: 7 }],
    [{ ...link, document_key: 'reg:2' }],
    [{ ...link, document_key: undefined }],
  ];
  for (const links of bad) {
    assertEquals(await oneReasons('links_shape', await good(1, { links })), ['link_shape'], JSON.stringify(links));
  }
});

// ---- 5 text_binds (reused) and 6 length ----

Deno.test('text_binds: reused, holds a text that does not match its hash, count, split or spans; passes a bound text', async () => {
  const r = await good(1);
  assertEquals(await oneReasons('text_binds', r), []);
  assertEquals(await oneReasons('text_binds', { ...r, content_sha256: 'a'.repeat(64) }), ['text_hash_mismatch']);
  assertEquals(await oneReasons('text_binds', { ...r, n_chars: 5 }), ['n_chars_mismatch']);
  assertEquals(await oneReasons('text_binds', { ...r, page_split: 'approximate' }), ['page_split']);
  assertEquals(await oneReasons('text_binds', { ...r, page_count: 9 }), ['page_spans']);
  const gap = (r.pages as Rec[]).map((p, i) => i === 1 ? { ...p, char_from: (p.char_from as number) + 1 } : p);
  assertEquals(await oneReasons('text_binds', { ...r, pages: gap }), ['page_spans']);
  assertEquals(await oneReasons('text_binds', { ...r, pages: null }), ['page_spans']);
  // The pack separates pages with a form feed; a text joined any other way is not bound.
  const other = (r.text as string).replace(/\f/g, '\n');
  assertEquals(
    await oneReasons('text_binds', {
      ...r,
      text: other,
      content_sha256: await sha256Hex(other),
      pages: (r.pages as Rec[]).map(({ text: _t, ...p }) => p),
    }),
    ['page_spans'],
  );
  const none = await good(1, { page_split: 'none', pages: [], page_count: 0 });
  assertEquals(await oneReasons('text_binds', none), []);
  assertEquals(await oneReasons('text_binds', { ...none, page_count: 3 }), ['page_count_unsplittable']);
});

Deno.test('text_binds: a hostile page number never reaches the finding text', async () => {
  const r = await good(1);
  const pages = (r.pages as Rec[]).map((p, i) => i === 1 ? { ...p, page_number: MARKER.repeat(500) } : p);
  const fs = await oneFindings('text_binds', { ...r, pages });
  assertEquals(fs.map((f) => f.reason), ['page_spans']);
  assert(!JSON.stringify(fs).includes(MARKER), 'the finding quotes the page number');
});

Deno.test('length: too_short under 300 and too_long over 600,000 UTF-16 units; both limits pass', async () => {
  const at = (n: number) => ({ text: 'x'.repeat(n) });
  assertEquals(await oneReasons('length', at(299) as Rec), ['too_short']);
  assertEquals(await oneReasons('length', at(300) as Rec), []);
  assertEquals(await oneReasons('length', at(600_000) as Rec), []);
  assertEquals(await oneReasons('length', at(600_001) as Rec), ['too_long']);
  assertEquals(await oneReasons('length', { text: 5 }), ['too_short']);
  assertEquals(await oneReasons('length', {}), ['too_short']);
  // Counted in UTF-16 units: 150 astral characters are 300 units.
  assertEquals(await oneReasons('length', { text: '\u{1F600}'.repeat(150) }), []);
  assertEquals(await oneReasons('length', { text: '\u{1F600}'.repeat(149) }), ['too_short']);
});

Deno.test('Bills keeps its own length limits (200 to 600,000) now that the check is built by makeLength', async () => {
  const bills = makeBillsScreen().checks.find((c) => c.name === 'length')!;
  const reasons = async (n: number) => (await bills.one!({ text: 'x'.repeat(n) }, ctxOf())).map((f) => f.reason);
  assertEquals(await reasons(199), ['too_short']);
  assertEquals(await reasons(200), []);
  assertEquals(await reasons(600_000), []);
  assertEquals(await reasons(600_001), ['too_long']);
  const mine = makeLength(10, 20);
  assertEquals(mine.name, 'length');
  assertEquals((await mine.one!({ text: 'x'.repeat(9) }, ctxOf())).map((f) => f.reason), ['too_short']);
  assertEquals((await mine.one!({ text: 'x'.repeat(21) }, ctxOf())).map((f) => f.reason), ['too_long']);
  assertEquals((await mine.one!({ text: 'x'.repeat(15) }, ctxOf())).map((f) => f.reason), []);
});

Deno.test('Bills screen: its check names, order, rules files and mapping version are as the spec states', () => {
  const s = makeBillsScreen();
  assertEquals(s.mappingVersion, 'bills-screen-v1');
  assertEquals(s.collection, 'national-bills');
  assertEquals(s.listingRows, undefined);
  assertEquals(s.reports, undefined);
  assertEquals(s.rulesFiles, [
    'scripts/bulk-runner/screens/bills.ts',
    'scripts/bulk-runner/screen.ts',
    'scripts/bulk-runner/screen_types.ts',
    'scripts/bulk-runner/screens/index.ts',
    'scripts/bulk-runner/live.ts',
    'scripts/bulk-runner/page_check.ts',
  ]);
  assertEquals(s.checks.map((c) => c.name), [
    'record_shape',
    'official_source',
    'citation_complete',
    'links_agree',
    'listing_row',
    'text_binds',
    'length',
    'servable_licence',
    'licence_admitted',
    'already_live',
    'role_held_live',
    'role_collision',
    'file_url_collision',
    'duplicate_text',
    'duplicate_text_live',
    'corrigendum',
  ]);
});

// ---- the publisher (F332): the resolver of the live citation path, called with what the stored row will hold ----

const REGULATORS: Array<[code: string, host: string, url: string]> = [
  ['RBI', 'rbi.org.in', PDF(1)],
  ['SEBI', 'sebi.gov.in', HTML(2)],
  ['TRAI', 'trai.gov.in', ''],
  ['CCI', 'cci.gov.in', ''],
];
const withCitation = (r: Rec, over: Rec): Rec => ({ ...r, citation: { ...(r.citation as Rec), ...over } });
const publisherOf = async (r: Rec) => await oneReasons('publisher_unresolved', r);

Deno.test('publisher: each of the four regulators resolves and passes, by code and host, with or without a file', async () => {
  for (const [code, host, url] of REGULATORS) {
    const r = withCitation(await good(1, { source_host: host, file_url: url || null }), { regulator: code });
    assertEquals(await publisherOf(r), [], code);
    const noFile = withCitation(await good(1, { source_host: host, file_url: null }), { regulator: code });
    assertEquals(await publisherOf(noFile), [], `${code} without a file`);
  }
});

Deno.test('publisher: an unknown regulator code is held, whatever the host says', async () => {
  for (const code of ['XYZ', 'RB1', 'R.B.I', 'RBI SEBI', '\u0131']) {
    const r = withCitation(await good(1, { source_host: 'rbi.org.in' }), { regulator: code });
    assertEquals(await publisherOf(r), ['publisher_unresolved'], JSON.stringify(code));
  }
});

Deno.test('publisher: a regulator that is present and not a string is held', async () => {
  for (const code of [5, true, ['RBI'], { name: 'RBI' }]) {
    const r = withCitation(await good(1, { source_host: 'rbi.org.in' }), { regulator: code });
    assertEquals(await publisherOf(r), ['publisher_unresolved'], JSON.stringify(code));
  }
});

Deno.test('publisher: a code that disagrees with the host or the file URL is held', async () => {
  const sebiFile = withCitation(await good(1, { source_host: 'rbi.org.in', file_url: HTML(1) }), { regulator: 'RBI' });
  assertEquals(await publisherOf(sebiFile), ['publisher_unresolved'], 'RBI code, SEBI file');
  const sebiHost = withCitation(await good(2, { source_host: 'sebi.gov.in' }), { regulator: 'RBI' });
  assertEquals(await publisherOf(sebiHost), ['publisher_unresolved'], 'RBI code, SEBI host');
  const agree = withCitation(await good(3, { source_host: 'rbi.org.in', file_url: PDF(3) }), { regulator: 'RBI' });
  assertEquals(await publisherOf(agree), [], 'the same regulator on all three');
});

Deno.test('publisher: no regulator and no regulator host is held', async () => {
  const { regulator: _drop, ...noRegulator } = CITATION;
  const r = await good(1, { source_host: 'example.org', citation: noRegulator });
  assertEquals(await publisherOf(r), ['publisher_unresolved']);
  const nulled = withCitation(await good(2, { source_host: 'example.org' }), { regulator: null });
  assertEquals(await publisherOf(nulled), ['publisher_unresolved']);
  assertEquals(await publisherOf(await good(3, { source_host: 'example.org', citation: 'RBI' })), [
    'publisher_unresolved',
  ]);
});

Deno.test('publisher: with no regulator code a record passes only when its hosts name exactly one regulator', async () => {
  const { regulator: _drop, ...noRegulator } = CITATION;
  const hostOnly = await good(1, { source_host: 'rbi.org.in', citation: noRegulator });
  assertEquals(await publisherOf(hostOnly), []);
  const fileOnly = await good(2, { source_host: 'example.org', file_url: HTML(2), citation: noRegulator });
  assertEquals(await publisherOf(fileOnly), []);
  const two = await good(3, { source_host: 'rbi.org.in', file_url: HTML(3), citation: noRegulator });
  assertEquals(await publisherOf(two), ['publisher_unresolved'], 'two regulators among the hosts');
  const inCitation = await good(4, {
    source_host: 'example.org',
    citation: { ...noRegulator, source_host: 'cci.gov.in' },
  });
  assertEquals(await publisherOf(inCitation), [], 'the citation own source_host counts, as at serve time');
});

Deno.test('publisher: the verdict is the live resolver verdict on the stored values, for a spread of records', async () => {
  const { documentPublisher } = await import('../../../supabase/functions/_shared/publisher.ts');
  const hosts = ['rbi.org.in', 'sebi.gov.in', 'trai.gov.in', 'cci.gov.in', 'example.org'];
  const urls = [null, PDF(1), HTML(1), ASPX(1)];
  const regs: unknown[] = ['RBI', 'SEBI', 'TRAI', 'CCI', 'XYZ', undefined, null, 7];
  let n = 0;
  for (const host of hosts) {
    for (const url of urls) {
      for (const reg of regs) {
        const r = withCitation(await good(1, { source_host: host, file_url: url }), { regulator: reg });
        const stored = { source_host: r.source_host, citation: r.citation };
        const live = documentPublisher('national', FEATURE, stored, r.file_url) !== '';
        assertEquals((await publisherOf(r)).length === 0, live, `${host} ${url} ${JSON.stringify(reg)}`);
        n++;
      }
    }
  }
  assertEquals(n, 160);
});

Deno.test('publisher: a hold names no value from the record, and a hostile one reaches no finding', async () => {
  const hostile = [MARKER, [MARKER], { x: MARKER }];
  for (const code of hostile) {
    const r = withCitation(await good(1, { source_host: MARKER }), { regulator: code, source_host: MARKER });
    const found = await oneFindings('publisher_unresolved', r);
    assertEquals(found.map((f) => f.reason), ['publisher_unresolved']);
    assert(!JSON.stringify(found).includes(MARKER), 'a finding quotes the record');
    assertEquals(found.every((f) => f.detail === undefined || f.detail === ''), true);
  }
  assertEquals(await oneReasons('publisher_unresolved', {}), ['publisher_unresolved'], 'an empty record');
  assertEquals(
    await oneReasons('publisher_unresolved', null as unknown as Rec),
    ['publisher_unresolved'],
    'not an object',
  );
});

Deno.test('publisher: a run holds an unresolved record with the reason and passes a resolved one', async () => {
  const ok = await good(1);
  const bad = withCitation(await good(2), { regulator: 'XYZ' });
  const out = await run([ok, bad]);
  assertEquals(out.screened.map((r) => r.source_key), [key(1)]);
  assertEquals(holdOf(out, key(2))?.reasons, ['publisher_unresolved']);
  assertEquals(out.holds.length, 1);
});

// ---- 7 density ----

Deno.test('density: below_density when the spans are at least the minimum and the characters per span are under it', async () => {
  const t = async (pages: number, chars: number) => await oneReasons('density', await textRec(1, pages, chars));
  assertEquals(await t(6, 100), ['below_density']);
  assertEquals(await t(5, 599), ['below_density']);
  assertEquals(await t(5, 700), []);
  assertEquals(await t(4, 100), [], 'under 5 pages the density is not judged');
  assertEquals(await t(1, 300), []);
});

Deno.test('density: judged on the text after prepare strips control codes, as admission sees it', async () => {
  const pages = 6;
  const per = 650;
  const r = await textRec(1, pages, per);
  assertEquals(await oneReasons('density', r), []);
  // 100 control codes in every page: 550 characters a page are left once they are stripped.
  const dirty = { ...r, text: (r.text as string).replace(/w{100}/g, '\x01'.repeat(100)) };
  assertEquals(await oneReasons('density', dirty), ['below_density']);
  // Form feeds stay (they become line breaks), so the page separators do not lower the count.
  assertEquals(await oneReasons('density', r), []);
});

Deno.test('density: no_page_spans when requirePageCount is set and the record has none, or pages is not a list', async () => {
  for (const pages of [undefined, null, [], 'x', {}]) {
    assertEquals(await oneReasons('density', await good(1, { pages })), ['no_page_spans'], JSON.stringify(pages));
  }
  const c = checkNamed('density');
  const lax = ctxOf(new FakeLive(), { ...SETTINGS, requirePageCount: false });
  assertEquals((await c.one!(await good(1, { pages: [] }), lax)).map((f) => f.reason), []);
});

Deno.test('density: the policy numbers come from the collection settings; missing or malformed ones are an error, not a pass', async () => {
  const r = await good(1);
  for (
    const settings of [
      {},
      { minCharsPerPage: 600 },
      { minCharsPerPage: 600, minPagesForDensity: 5 },
      {
        ...SETTINGS,
        requirePageCount: 'yes',
      },
      { minCharsPerPage: 'x', minPagesForDensity: 5, requirePageCount: true },
      {
        minCharsPerPage: -1,
        minPagesForDensity: 5,
      },
      { minCharsPerPage: 600, minPagesForDensity: 0.5 },
    ]
  ) {
    await assertRejects(() => checkNamed('density').one!(r, ctxOf(new FakeLive(), settings)), Error, 'settings');
  }
  const out = await run([r], screenWith(), new FakeLive(), {});
  assertEquals(out.holds, []);
  const bad = await runScreen(screenWith(), [r], { live: new FakeLive(), settings: {} }, opts());
  assertEquals(bad.screened, []);
  assert(holdOf(bad, key(1))!.reasons.includes('check_error'));
});

// ---- 8 extraction ----

Deno.test('extraction: extraction_not_allowed for ocr, missing, or any value outside the configured list', async () => {
  for (const v of ['ocr', 'pdf_text ', 'PDF_TEXT', undefined, null, 5, {}]) {
    assertEquals(
      await oneReasons('extraction', await good(1, { extraction: v })),
      ['extraction_not_allowed'],
      String(v),
    );
  }
  assertEquals(await oneReasons('extraction', await good(1)), []);
});

// ---- 9 servable_licence and 10 licence_admitted (reused) ----

Deno.test('servable_licence: not servable, barred or personal-data records are held; absent servable and a plain class pass', async () => {
  assertEquals(await oneReasons('servable_licence', await good(1, { servable: false })), ['not_servable']);
  assertEquals(await oneReasons('servable_licence', await good(1, { servable: 'yes' })), ['servable_malformed']);
  assertEquals(await oneReasons('servable_licence', await good(1, { licence_class: 'BARRED_x' })), ['licence_barred']);
  assertEquals(await oneReasons('servable_licence', await good(1, { licence_class: 'personal_data_x' })), [
    'personal_data',
  ]);
  assertEquals(await oneReasons('servable_licence', await good(1, { licence_class: undefined })), ['licence_barred']);
  assertEquals(await oneReasons('servable_licence', await good(1)), []);
  assertEquals(await oneReasons('servable_licence', await good(1, { servable: true })), []);
});

Deno.test('licence_admitted: only the classes the collection settings admit pass; no settings is an error, not a pass', async () => {
  assertEquals(await oneReasons('licence_admitted', await good(1, { licence_class: 'other' })), [
    'licence_not_admitted',
  ]);
  assertEquals(await oneReasons('licence_admitted', await good(1)), []);
  await assertRejects(
    () => checkNamed('licence_admitted').one!({}, ctxOf(new FakeLive(), {})),
    Error,
    'licenceClasses',
  );
});

// ---- 11 to 16 dedupe ----

Deno.test('already_live: a source_key held by any document, or a file_url held by a document of this desk, is held', async () => {
  const live = new FakeLive([
    liveDoc({ id: 'a', source_key: key(1), desk_feature: 'Another desk' }),
    liveDoc({ id: 'b', source_key: 'legacy', file_url: PDF(2) }),
    liveDoc({ id: 'c', source_key: 'other', file_url: PDF(3), desk_feature: 'Another desk' }),
  ]);
  const records = [await good(1), await goodPdf(2), await goodPdf(3), await good(4)];
  assertEquals(await allReasons('already_live', records, live), {
    [key(1)]: ['already_live'],
    [key(2)]: ['already_live'],
  });
  assertEquals(live.docCalls.length, 1);
  assertEquals(live.docCalls[0].sourceKeys.sort(), records.map((r) => r.source_key as string).sort());
  assertEquals(live.docCalls[0].fileUrls.sort(), [PDF(2), PDF(3)]);
  // A record with no file_url that is not live passes (Bills' check held every one of those).
  assertEquals(await allReasons('already_live', [await good(9)], new FakeLive()), {});
});

Deno.test('already_live: a failed live read is an error for the whole check, never a pass', async () => {
  await assertRejects(
    async () => await checkNamed('already_live').all!([await good(1)], ctxOf(new FakeLive([], true))),
    Error,
    'live read failed',
  );
  const out = await run([await good(1)], screenWith(), new FakeLive([], true));
  assertEquals(out.screened, []);
  assert(holdOf(out, key(1))!.reasons.includes('check_error'));
});

Deno.test('suggested_key_held_live: a document of this desk with the same suggested key holds the record; another desk does not', async () => {
  const live = new FakeLive([
    liveDoc({ id: 'a', source_key: 'old1', document_key_suggested: 'reg:1' }),
    liveDoc({ id: 'b', source_key: 'old2', document_key_suggested: 'reg:2', desk_feature: 'Another desk' }),
  ]);
  const records = [await good(1), await good(2), await good(3)];
  assertEquals(await allReasons('suggested_key_held_live', records, live), { [key(1)]: ['suggested_key_held_live'] });
  assertEquals(live.docCalls.length, 1);
  assertEquals(live.docCalls[0].suggestedKeys?.sort(), ['reg:1', 'reg:2', 'reg:3']);
  assertEquals([live.docCalls[0].tier, live.docCalls[0].feature], ['national', FEATURE]);
  assertEquals(live.docCalls[0].sourceKeys, []);
});

Deno.test('suggested_key_collision: records sharing a suggested key are all held; distinct keys pass', async () => {
  const records = [await good(1), await good(2, { document_key_suggested: 'reg:1' }), await good(3)];
  assertEquals(await allReasons('suggested_key_collision', records), {
    [key(1)]: ['suggested_key_collision'],
    [key(2)]: ['suggested_key_collision'],
  });
  assertEquals(await allReasons('suggested_key_collision', [await good(1), await good(3)]), {});
});

Deno.test('file_url_collision: records sharing a file_url are all held; records with no url never collide', async () => {
  const records = [
    await goodPdf(1),
    await goodPdf(2, { file_url: PDF(1) }),
    await goodPdf(3),
    await good(4),
    await good(5),
  ];
  assertEquals(await allReasons('file_url_collision', records), {
    [key(1)]: ['file_url_collision'],
    [key(2)]: ['file_url_collision'],
  });
});

Deno.test('duplicate_text: the lowest source_key of a text stays and the rest are held', async () => {
  const a = await good(1);
  const same = await good(2, { text: a.text, pages: a.pages, content_sha256: a.content_sha256, n_chars: a.n_chars });
  const c = await good(3);
  assertEquals(await allReasons('duplicate_text', [same, a, c]), { [key(2)]: ['duplicate_text'] });
  assertEquals(await allReasons('duplicate_text', [a, c]), {});
});

Deno.test('duplicate_text_live: another document holding the same stored text holds the record', async () => {
  const a = await good(1);
  const live = new FakeLive([
    liveDoc({ id: 'x', source_key: 'old', content_sha256: await sha256Hex((a.text as string).replace(/\f/g, '\n')) }),
  ]);
  assertEquals(await allReasons('duplicate_text_live', [a, await good(2)], live), {
    [key(1)]: ['duplicate_text_live'],
  });
  assertEquals(await allReasons('duplicate_text_live', [await good(2)], live), {});
});

Deno.test('hold details name keys, never record values: a hostile source_key cannot reach a collision or duplicate finding', async () => {
  const hostile = MARKER.repeat(100);
  const a = await good(1, { source_key: hostile, document_key_suggested: 'reg:1', file_url: PDF(1) });
  const b = await good(2, {
    document_key_suggested: 'reg:1',
    file_url: PDF(1),
    text: a.text,
    pages: a.pages,
    content_sha256: a.content_sha256,
    n_chars: a.n_chars,
  });
  for (const name of ['suggested_key_collision', 'file_url_collision', 'duplicate_text']) {
    const m = await checkNamed(name).all!([a, b], ctxOf());
    assert(!JSON.stringify([...m]).includes(MARKER), name);
  }
});

// ---- 17 completeness_basis ----

Deno.test('completeness_basis: a PDF record is judged by the page check, whose reasons are the hold; the others never go to it', async () => {
  const page = fakePage({ [key(2)]: ['page_count_mismatch'], [key(3)]: ['thin_page', 'pdf_unavailable'] });
  const s = screenWith(REGULATORY, page);
  const records = [
    await goodPdf(1),
    await goodPdf(2),
    await goodPdf(3),
    await good(4),
    await good(5, { file_url: HTML(5) }),
    await good(6, { file_url: ASPX(6) }),
  ];
  const m = await checkNamed('completeness_basis', s).all!(records, ctxOf());
  assertEquals(page.seen, [[key(1), key(2), key(3)]]);
  assertEquals(Object.fromEntries([...m].map(([k, f]) => [k, f.map((x) => x.reason)])), {
    [key(2)]: ['page_count_mismatch'],
    [key(3)]: ['thin_page', 'pdf_unavailable'],
    [key(4)]: ['no_completeness_basis'],
    [key(5)]: ['no_completeness_basis'],
    [key(6)]: ['no_completeness_basis'],
  });
});

Deno.test('completeness_basis: the density-only basis needs checks 5 to 8 to have run and passed on that very record', async () => {
  // Called on its own, on a record the other checks never judged: nothing is assumed, nothing passes.
  const s = screenWith();
  const r = await good(1);
  const direct = await checkNamed('completeness_basis', s).all!([r], ctxOf());
  assertEquals(direct.get(key(1))?.map((f) => f.reason), ['no_completeness_basis']);
  // Once the four checks have run on it and found nothing, it passes.
  for (const n of ['text_binds', 'length', 'density', 'extraction']) await checkNamed(n, s).one!(r, ctxOf());
  assertEquals((await checkNamed('completeness_basis', s).all!([r], ctxOf())).size, 0);
  // Every one of the four is needed: the same record, with one of them not having run, is held.
  for (const skip of ['text_binds', 'length', 'density', 'extraction']) {
    const s2 = screenWith();
    const r2 = await good(2);
    for (const n of ['text_binds', 'length', 'density', 'extraction'].filter((x) => x !== skip)) {
      await checkNamed(n, s2).one!(r2, ctxOf());
    }
    const m = await checkNamed('completeness_basis', s2).all!([r2], ctxOf());
    assertEquals(m.get(key(2))?.map((f) => f.reason), ['no_completeness_basis'], `without ${skip}`);
  }
  // A check that ran and found something does not count as passed. Each record below fails exactly one of the checks
  // (the explicit conditions of the density-only basis hold for all of them), so only the record of what passed
  // can hold it.
  const failing: Array<[string, Promise<Rec>]> = [
    ['text_binds', good(3, { content_sha256: 'a'.repeat(64) })],
    ['length', good(4, { text: 'x'.repeat(10) })],
    ['density', textRec(5, 6, 100)],
  ];
  for (const [name, p] of failing) {
    const s3 = screenWith();
    const bad = await p;
    const found: string[] = [];
    for (const n of ['text_binds', 'length', 'density', 'extraction']) {
      if ((await checkNamed(n, s3).one!(bad, ctxOf())).length) found.push(n);
    }
    assert(found.includes(name), `${name} should have found something`);
    const m = await checkNamed('completeness_basis', s3).all!([bad], ctxOf());
    assertEquals(m.get(bad.source_key as string)?.map((f) => f.reason), ['no_completeness_basis'], name);
  }
});

Deno.test('completeness_basis: a configuration that does not allow density-only holds every record without a checkable PDF', async () => {
  const sebi = { file_url: HTML(2), source_host: 'sebi.gov.in', citation: { ...CITATION, regulator: 'SEBI' } };
  const strict = screenWith({ ...REGULATORY, allow_density_only: false });
  const out = await run([await good(1), await good(2, sebi), await goodPdf(3)], strict);
  assertEquals(out.screened.map((r) => r.source_key), [key(3)]);
  assertEquals(holdOf(out, key(1))!.reasons, ['no_completeness_basis']);
  assertEquals(holdOf(out, key(2))!.reasons, ['no_completeness_basis']);
  // And the same configuration, allowed, passes them with the named basis.
  const lax = await run([await good(1), await good(2, sebi)]);
  assertEquals(lax.screened.map((r) => r.completeness_basis), ['density_only', 'density_only']);
});

Deno.test('completeness_basis: the density-only basis needs an allowed text-layer extraction, exact page split and page spans', async () => {
  for (
    const over of [{ extraction: 'ocr' }, { page_split: 'none' }, { page_split: 'approximate' }, { pages: [] }, {
      pages: null,
    }]
  ) {
    const out = await run([await good(1, over)]);
    assertEquals(out.screened, [], JSON.stringify(over));
  }
});

Deno.test('completeness_basis: an RBI PDF whose page check holds is not rescued by the density-only basis', async () => {
  const page = fakePage({ [key(1)]: ['page_count_mismatch'] });
  const out = await run([await goodPdf(1)], screenWith(REGULATORY, page));
  assertEquals(out.screened, []);
  assertEquals(holdOf(out, key(1))!.reasons, ['page_count_mismatch']);
});

Deno.test('completeness_basis: a page check that returns a key it was not offered is an error, not a pass', async () => {
  const page = fakePage({}, { [key(9)]: [{ check: 'x', covers: ['completeness'], reason: 'thin_page' }] });
  const out = await run([await goodPdf(1)], screenWith(REGULATORY, page));
  assertEquals(out.screened, []);
  assert(holdOf(out, key(1))!.reasons.includes('check_error'));
});

Deno.test('completeness_basis: a page check that fails holds the PDF records only; the density-only ones are judged', async () => {
  const page = fakePage();
  page.check.all = () => Promise.reject(new Error(`robots.txt ${MARKER}`));
  const out = await run([await goodPdf(1), await good(2)], screenWith(REGULATORY, page));
  assertEquals(out.screened.map((r) => r.source_key), [key(2)]);
  assertEquals(holdOf(out, key(1))!.reasons, ['page_check_error']);
  assert(!JSON.stringify(out.holds).includes(MARKER), 'the error message must not reach a hold');
});

Deno.test('completeness_basis: the receipt counts each basis, and the page check counters ride along', async () => {
  const page = fakePage({ [key(3)]: ['thin_page'] });
  const s = screenWith(REGULATORY, page);
  const out = await run([await goodPdf(1), await goodPdf(2), await goodPdf(3), await good(4), await good(5)], s);
  assertEquals(out.screened.length, 4);
  const stats = (checkNamed('completeness_basis', s) as { stats?: Record<string, unknown> }).stats!;
  assertEquals(stats.page_check, 2);
  assertEquals(stats.density_only, 2);
  assertEquals([stats.fetched, stats.cached, stats.unverifiedPages, stats.unverifiedRecords], [2, 1, 3, 1]);
  assertEquals(stats.scans, ['aa']);
  // A second run over the same screen starts its counts again.
  await run([await good(4)], s);
  assertEquals([stats.page_check, stats.density_only], [0, 1]);
});

Deno.test('project: a record whose basis was not recorded by this screen is held project_failed, never given a default', async () => {
  const s = screenWith();
  await assertRejects(async () => s.project!(await good(1)), Error, 'completeness');
  const out = await run([await good(1)], s);
  assertEquals(out.screened[0].completeness_basis, 'density_only');
  // A different object with the same key and content is not the record that was judged.
  const twin = structuredClone(await good(1));
  await assertRejects(() => Promise.resolve().then(() => s.project!(twin)), Error, 'completeness');
});

// ---- a switched-off check never passes a record ----

Deno.test('--no-live and --no-pages hold every record screen_incomplete; nothing is screened', async () => {
  const records = [await good(1), await goodPdf(2)];
  for (const over of [{ noLive: true }, { noPages: true }, { noLive: true, noPages: true }]) {
    const out = await run(records, screenWith(), new FakeLive(), over);
    assertEquals(out.screened, [], JSON.stringify(over));
    assertEquals(out.holds.length, 2);
    for (const h of out.holds) assert(h.reasons.includes('screen_incomplete'));
  }
});

Deno.test('mutant guard: if the completeness check passed what it did not judge, a record without a checkable basis would be screened', async () => {
  // Every kind of record the check must not pass by default, run through the whole screen.
  const records = [
    await good(1, { file_url: HTML(1) }),
    await good(2, { extraction: 'ocr' }),
    await good(3, { page_split: 'approximate' }),
    await goodPdf(4, { extraction: 'ocr' }),
  ];
  const strict = await run(records, screenWith({ ...REGULATORY, allow_density_only: false }));
  assertEquals(strict.screened, []);
  for (const r of records) assert(holdOf(strict, r.source_key as string), String(r.source_key));
});

// ---- the whole screen: other hold codes seen end to end ----

Deno.test('whole screen: one hold code per defect, each shown against a clean record in the same run', async () => {
  const live = new FakeLive([liveDoc({ id: 'x', source_key: key(30) })]);
  const bad: Array<[string, Promise<Rec>]> = [
    ['bad_shape', good(10, { doc_type: 'bill' })],
    ['replacement_not_supported', good(11, { delta_patch: 'x' })],
    ['title_invalid', good(12, { title: '' })],
    ['link_shape', good(13, { links: [{}] })],
    ['text_hash_mismatch', good(14, { content_sha256: 'a'.repeat(64) })],
    ['too_short', textRec(15, 1, 100)],
    ['below_density', textRec(16, 6, 100)],
    ['extraction_not_allowed', good(17, { extraction: 'ocr' })],
    ['not_servable', good(18, { servable: false })],
    ['licence_not_admitted', good(19, { licence_class: 'other' })],
    ['already_live', good(30)],
  ];
  const cleanRec = await good(1);
  const out = await run([cleanRec, ...await Promise.all(bad.map((b) => b[1]))], screenWith(), live);
  assertEquals(out.screened.map((r) => r.source_key), [key(1)]);
  for (const [code, p] of bad) {
    const h = holdOf(out, (await p).source_key as string);
    assert(h && h.reasons.includes(code), `${code}: ${h?.reasons}`);
  }
});

// ---- untrusted input: hostile records never throw and never pass ----

/** An independent statement of what a passing record must look like (types only). */
function looksValid(r: Rec): boolean {
  const s = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const c = r.citation as Rec | undefined;
  return s(r.schema) && /^[0-9a-f]{40}$/.test(String(r.source_key)) && r.desk_tier === 'national' &&
    r.desk_feature === FEATURE &&
    r.desk_rows_feature === LISTING && r.doc_type === 'regulatory' && s(r.title) && (r.title as string).length <= 300 &&
    s(r.document_key_suggested) && String(r.document_key_suggested).startsWith('reg:') && typeof r.text === 'string' &&
    (r.text as string).length >= 300 && (r.text as string).length <= 600_000 && r.extraction === 'pdf_text' &&
    r.page_split === 'exact' && Array.isArray(r.pages) && r.pages.length > 0 && Number.isSafeInteger(r.page_count) &&
    !!c && typeof c === 'object' && !Array.isArray(c) &&
    ['kind', 'regulator', 'regulator_name', 'title', 'source'].every((f) => s(c[f])) &&
    ['trai.gov.in', 'cci.gov.in', 'rbi.org.in', 'sebi.gov.in'].includes(String(r.source_host)) &&
    r.licence_class === LICENCE &&
    r.completeness_basis !== undefined;
}

const HOSTILE: unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -1,
  1.5,
  2 ** 53,
  Number.NaN,
  Infinity,
  '',
  ' ',
  'x'.repeat(5000),
  `${MARKER}\0${MARKER}`,
  '\ud800',
  '\x0c'.repeat(50),
  [],
  [null],
  [[]],
  [{}],
  {},
  { __proto__: { polluted: 1 } },
  JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}}}'),
  [MARKER],
  { [MARKER]: MARKER },
  () => 1,
  Symbol.for('x'),
];

Deno.test('fuzz: every field the screen reads, replaced by each hostile value, never throws and never passes a record it should not', async () => {
  const sample = await goodPdf(1, { citation_text: MARKER, attribution: MARKER });
  const fields = [
    ...new Set([
      ...Object.keys(sample),
      ...['servable', 'text_quality', 'v16_replaces', 'delta_patch', 'replaces_text', 'review', 'text_sha256'],
      ...['completeness_basis', 'file_url_alt', 'source_archive_url', 'language', 'licence', 'ocr_lang'],
    ]),
  ];
  const records: Rec[] = [];
  const labels = new Map<string, string>();
  const claimed = new Set<string>();
  let n = 100;
  for (const f of fields) {
    for (const v of HOSTILE) {
      n++;
      const r = await goodPdf(n, { citation_text: MARKER, attribution: MARKER });
      if (v === undefined) delete r[f];
      else r[f] = v;
      records.push(r);
      labels.set(r.text as string, `${f} <- ${typeof v} #${HOSTILE.indexOf(v)}`);
      if (['review', 'text_sha256', 'completeness_basis'].includes(f) && v !== undefined) claimed.add(r.text as string);
    }
  }
  // Records that are not objects at all.
  const notObjects: unknown[] = [null, undefined, 5, 'x', [], [1], true];
  const s = screenWith();
  let screened = 0;
  const set = (rs: unknown[]) => ({
    records: { records: rs as Rec[], packageId: 'p#' + 'a'.repeat(64), fileSha256: 'b'.repeat(64) },
  });
  const shared = { decisionId: 'd', rulesSha256: 'c'.repeat(64), noLive: false, noPages: false };
  for (let i = 0; i < records.length; i += 150) {
    let out;
    try {
      out = await runScreenSets(s, set(records.slice(i, i + 150)), ctxOf(new FakeLive()), shared);
    } catch (e) {
      throw new Error(`the screen threw on a hostile record: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const h of out.records.holds) {
      assert(!h.reasons.includes('check_error'), `a check threw instead of holding (${h.reasons.join(',')})`);
      assert(!JSON.stringify([h.reasons, h.findings]).includes(MARKER), 'a hold quotes record text');
    }
    for (const r of out.records.screened) {
      screened++;
      assert(
        !claimed.has(r.text as string),
        `a record that claimed its own review or basis was screened (${labels.get(r.text as string)})`,
      );
      assert(looksValid(r), `a record that is not valid was screened (${labels.get(r.text as string)})`);
    }
  }
  assert(screened > 0, 'the fuzz passed nothing at all, so it proved nothing about passing records');
  const odd = await runScreenSets(s, set(notObjects), ctxOf(new FakeLive()), shared);
  assertEquals(odd.records.screened, []);
  assertEquals(odd.records.holds.length, notObjects.length);
});

Deno.test('fuzz: random combinations of hostile fields (fixed seed) never throw a check and never pass an invalid record', async () => {
  let seed = 20261112;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const base = await goodPdf(1);
  const keys = Object.keys(base);
  const records: Rec[] = [];
  for (let i = 0; i < 600; i++) {
    const r: Rec = { ...base, source_key: key(5000 + i), document_key_suggested: `reg:${i}`, file_url: PDF(5000 + i) };
    for (let k = rnd(4); k >= 0; k--) {
      const f = keys[rnd(keys.length)];
      if (f === 'source_key' || f === 'document_key_suggested' || f === 'file_url') continue;
      const v = HOSTILE[rnd(HOSTILE.length)];
      if (v === undefined) delete r[f];
      else r[f] = v;
    }
    records.push(r);
  }
  const out = await runScreenSets(
    screenWith(),
    { records: { records, packageId: 'p#' + 'a'.repeat(64), fileSha256: 'b'.repeat(64) } },
    ctxOf(new FakeLive()),
    { decisionId: 'd', rulesSha256: 'c'.repeat(64), noLive: false, noPages: false },
  );
  for (const h of out.records.holds) {
    assert(!h.reasons.includes('check_error'), `a check threw (${h.reasons.join(',')})`);
    assert(!JSON.stringify([h.reasons, h.findings]).includes(MARKER));
  }
  for (const r of out.records.screened) assert(looksValid(r));
  assertEquals(out.records.screened.length + out.records.holds.length, 600);
});

Deno.test('fuzz: very large values are held with a code and the output stays small', async () => {
  const big = 'y'.repeat(3_000_000);
  const base = await good(1);
  const cases: Rec[] = [
    { ...base, source_key: key(1), title: big },
    {
      ...base,
      source_key: key(2),
      citation: { kind: big, regulator: 'R', regulator_name: 'N', title: 'T', source: 'S' },
    },
    { ...base, source_key: key(3), document_key_suggested: `reg:${big}` },
    { ...base, source_key: key(4), file_url: `https://rbidocs.rbi.org.in/${big}.pdf` },
    { ...base, source_key: key(5), links: Array.from({ length: 50_000 }, () => ({})) },
    { ...base, source_key: key(6), pages: Array.from({ length: 50_000 }, () => 5) },
    { ...base, source_key: key(7), text: big, content_sha256: await sha256Hex(big), n_chars: big.length },
  ];
  const out = await run(cases);
  assertEquals(out.screened, []);
  assertEquals(out.holds.length, cases.length);
  assert(JSON.stringify(out.holds).length < 20_000, 'the holds are not small');
  for (const h of out.holds) assert(!h.reasons.includes('check_error'), h.reasons.join(','));
});

// ---- the report-only scan ----

const PAN = 'ABCDE1234F';
const PAN2 = 'QWERT9876Z';
// Twelve digits whose Verhoeff check digit is right (vectors computed apart from the code under test).
const AADHAAR_OK = '2345 6789 0124';
const AADHAAR_OK_PLAIN = '987654321096';
const AADHAAR_OK_3 = '345678901238';
const AADHAAR_BAD_SUM = '2345 6789 0123';
const AADHAAR_YEARS = '2000 1999 2021';
const NOTE = 'strings shaped like identifiers; unverified upper bound; not evidence of personal data';

Deno.test('verhoeff: fixed vectors, valid and invalid', () => {
  for (const v of ['2363', '234567890124', '987654321096', '345678901238', '200019992021', '0']) {
    assert(verhoeffValid(v), v);
  }
  for (const v of ['2364', '234567890123', '234567890125', '987654321097', '234567890142', '', '12a4', '2363 ']) {
    assert(!verhoeffValid(v), v);
  }
});

Deno.test('year-like: three groups of four digits each between 1900 and 2099', () => {
  for (const v of ['2000 1999 2021', '200019992021', '2099-1900-2000', '2001 2001 2001']) assert(yearLikeTriple(v), v);
  for (const v of ['2100 1999 2021', '2000 1899 2021', '2000 1999 2100', '2345 6789 0124', '2000 1999 20']) {
    assert(!yearLikeTriple(v), v);
  }
});

Deno.test('the identifier scan: shaped-like counters by host and outcome; checksum failures and year triples are counted apart', async () => {
  const s = screenWith();
  assertEquals(s.reports?.map((r) => r.name), ['identifier_shapes']);
  const report = s.reports![0];
  assertEquals(report.note, NOTE);
  const rec = (text: string, host = 'trai.gov.in') => ({ source_host: host, text });
  const obs = async (r: Rec, outcome: 'screened' | 'held' = 'screened') => await report.one(r, ctxOf(), outcome);
  const zero = {
    records: 1,
    shaped_like_pan_records: 0,
    shaped_like_pan_matches: 0,
    shaped_like_aadhaar_records: 0,
    shaped_like_aadhaar_matches: 0,
    aadhaar_shaped_year_like: 0,
    aadhaar_shaped_checksum_fail: 0,
  };
  assertEquals(await obs(rec('nothing to see here')), [{ group: 'screened.trai.gov.in', counts: zero }]);
  assertEquals((await obs(rec(`a ${PAN} b ${PAN2} c`)))[0].counts, {
    ...zero,
    shaped_like_pan_records: 1,
    shaped_like_pan_matches: 2,
  });
  assertEquals((await obs(rec(`id ${AADHAAR_OK} and ${AADHAAR_OK_PLAIN}, ${AADHAAR_OK_3}`)))[0].counts, {
    ...zero,
    shaped_like_aadhaar_records: 1,
    shaped_like_aadhaar_matches: 3,
  });
  assertEquals((await obs(rec(`${AADHAAR_BAD_SUM}; 234567890123`)))[0].counts, {
    ...zero,
    aadhaar_shaped_checksum_fail: 2,
  });
  assertEquals((await obs(rec(`dates ${AADHAAR_YEARS} and 2001 1999 2020`)))[0].counts, {
    ...zero,
    aadhaar_shaped_year_like: 2,
  });
  // A held record is counted under its own group.
  assertEquals((await obs(rec(PAN), 'held'))[0].group, 'held.trai.gov.in');
  // Shapes that are not those: lower case, a leading 0 or 1, 11 or 13 digits, a longer run, a PAN inside a longer token.
  for (
    const no of [
      'abcde1234f',
      '123456789012',
      '023456789012',
      '23456789012',
      '2345678901234',
      `X${PAN}`,
      `${PAN}Q`,
      '12345 6789 0123',
    ]
  ) {
    const c = (await obs(rec(`see ${no} end`)))[0].counts;
    assertEquals(
      [
        c.shaped_like_pan_matches,
        c.shaped_like_aadhaar_matches,
        c.aadhaar_shaped_year_like,
        c.aadhaar_shaped_checksum_fail,
      ],
      [0, 0, 0, 0],
      no,
    );
  }
  for (const host of ['example.org', undefined, 5, MARKER]) {
    assertEquals((await obs({ source_host: host, text: PAN } as Rec))[0].group, 'screened.other');
  }
  assertEquals(await obs({ source_host: 'trai.gov.in', text: 5 } as Rec), []);
  assertEquals(await obs({} as Rec), []);
});

Deno.test('the identifier scan: a record held and a record screened are counted in separate groups, and every input record is scanned', async () => {
  const lead = () => `Ids ${PAN} ${AADHAAR_OK} ${AADHAAR_BAD_SUM} `;
  const kept = await textRec(1, 3, 400, {}, lead());
  const held = await textRec(2, 3, 400, { licence_class: 'other', document_key_suggested: 'reg:2' }, lead());
  const ocr = await textRec(3, 3, 400, {
    extraction: 'ocr',
    source_host: 'cci.gov.in',
    document_key_suggested: 'reg:3',
  }, lead());
  const out = await runScreenSets(
    screenWith(),
    { records: { records: [kept, held, ocr], packageId: 'p#' + 'a'.repeat(64), fileSha256: 'b'.repeat(64) } },
    ctxOf(),
    { decisionId: 'd', rulesSha256: 'c'.repeat(64), noLive: false, noPages: false },
  );
  assertEquals(out.records.screened.map((r) => r.source_key), [key(1)]);
  const g = out.summary.reports.identifier_shapes;
  assertEquals(Object.keys(g).sort(), ['held.cci.gov.in', 'held.trai.gov.in', 'screened.trai.gov.in']);
  assertEquals(g['screened.trai.gov.in'].records, 1);
  assertEquals(g['held.trai.gov.in'].records, 1);
  assertEquals(g['held.cci.gov.in'].records, 1);
  assertEquals(g['held.cci.gov.in'].shaped_like_pan_matches, 1);
  assertEquals(g['screened.trai.gov.in'].shaped_like_aadhaar_matches, 1);
  assertEquals(g['screened.trai.gov.in'].aadhaar_shaped_checksum_fail, 1);
  assertEquals(out.summary.reportNotes.identifier_shapes, NOTE);
});

Deno.test('the identifier scan: a matched value is written nowhere, not in the summary, the logs or the holds', async () => {
  const lines: string[] = [];
  const ids = `Intro ${PAN} then ${AADHAAR_OK} and ${PAN2} ${AADHAAR_OK_PLAIN} ${AADHAAR_BAD_SUM} ${AADHAAR_YEARS} `;
  const records = [
    await textRec(1, 3, 400, {}, ids),
    await good(2, { document_key_suggested: 'reg:2', licence_class: 'other' }),
  ];
  const out = await runScreenSets(
    screenWith(),
    { records: { records, packageId: 'p#' + 'a'.repeat(64), fileSha256: 'b'.repeat(64) } },
    ctxOf(),
    {
      decisionId: 'd',
      rulesSha256: 'c'.repeat(64),
      noLive: false,
      noPages: false,
      log: (l) => lines.push(l),
    },
  );
  assertEquals(out.summary.reportErrors, {});
  const all = JSON.stringify({ summary: out.summary, holds: out.records.holds, lines });
  for (const v of [PAN, PAN2, AADHAAR_OK, AADHAAR_OK_PLAIN, AADHAAR_BAD_SUM, AADHAAR_YEARS, '2345', 'ABCDE', '9876']) {
    assert(!all.includes(v), `a matched value reached an output: ${v}`);
  }
  assertEquals(out.summary.reports.identifier_shapes['screened.trai.gov.in'], {
    records: 1,
    shaped_like_pan_records: 1,
    shaped_like_pan_matches: 2,
    shaped_like_aadhaar_records: 1,
    shaped_like_aadhaar_matches: 2,
    aadhaar_shaped_year_like: 1,
    aadhaar_shaped_checksum_fail: 1,
  });
  assertEquals(out.records.screened.map((r) => r.source_key), [key(1)]);
  assertEquals(out.records.holds.map((h) => h.reasons), [['licence_not_admitted']]);
});

Deno.test('the identifier scan: it does not hold a record that has ids', async () => {
  const records = [await good(1, { text: `${PAN} `.repeat(100), extraction: 'ocr' })];
  const out = await runScreenSets(
    screenWith(),
    { records: { records, packageId: 'p#' + 'a'.repeat(64), fileSha256: 'b'.repeat(64) } },
    ctxOf(),
    { decisionId: 'd', rulesSha256: 'c'.repeat(64), noLive: false, noPages: false },
  );
  assertEquals(out.summary.reports.identifier_shapes['held.trai.gov.in'].shaped_like_pan_matches, 100);
  assert(!out.records.holds[0].reasons.includes('personal_data'));
});

Deno.test('a screen with a screen-level exception in the scan: the scan failing never changes a hold', async () => {
  const s = screenWith();
  const broken = { ...s, reports: [{ name: 'identifier_shapes', one: () => Promise.reject(new Error('x')) }] };
  const a = await run([await good(1), await good(2, { licence_class: 'other' })], s);
  const b = await run([await good(1), await good(2, { licence_class: 'other' })], broken);
  assertEquals(b.holds, a.holds);
  assertEquals(b.screened, a.screened);
});

Deno.test('screenSets still hands over each outcome while a record carries ids (smoke)', async () => {
  const seen: string[] = [];
  await screenSets(
    screenWith(),
    { records: { records: [await good(1)], packageId: 'p#' + 'a'.repeat(64), fileSha256: 'b'.repeat(64) } },
    ctxOf(),
    { decisionId: 'd', rulesSha256: 'c'.repeat(64), noLive: false, noPages: false },
    {
      screened: (_s, r) => void seen.push(String(r.source_key)),
      hold: () => {},
    },
  );
  assertEquals(seen, [key(1)]);
});

// ---- registration ----

Deno.test('registration: national-regulatory builds the Regulatory screen without reading, fetching or running anything', async () => {
  const { SCREENS } = await import('./index.ts');
  assertEquals(Object.keys(SCREENS).sort(), [
    'national-bill-corrigenda',
    'national-bills',
    'national-budget',
    'national-cabinet',
    'national-industry',
    'national-mp-profiles',
    'national-regulatory',
    'national-transfers',
  ]);
  const s = await SCREENS['national-regulatory']();
  assertEquals([s.collection, s.mappingVersion, s.listingRows], [
    'national-regulatory',
    'search-only-screen-v1',
    'none',
  ]);
  assertEquals(s.checks.at(-1)?.name, 'prepare_holds');
  assertEquals(s.checks.at(-2)?.name, 'completeness_basis');
  assertEquals(s.checks.filter((c) => c.needs === 'pages').length, 1);
  assertEquals((await SCREENS['national-bills']()).collection, 'national-bills');
});

// ---- review round: scanned PDFs, byte limits, the PDF rule, well-formed text, small pins ----

const bytes = (s: string) => new TextEncoder().encode(s).length;

Deno.test('completeness_basis: an official PDF with no text layer is held official_pdf_no_text, not given the page_check basis', async () => {
  const page = fakePage({}, {}, [key(1)]);
  const s = screenWith(REGULATORY, page);
  const out = await run([await goodPdf(1), await goodPdf(2)], s);
  assertEquals(out.screened.map((r) => [r.source_key, r.completeness_basis]), [[key(2), 'page_check']]);
  assertEquals(holdOf(out, key(1))!.reasons, ['official_pdf_no_text']);
  const stats = (checkNamed('completeness_basis', s) as { stats?: Record<string, unknown> }).stats!;
  assertEquals(stats.page_check, 1);
});

Deno.test('completeness_basis: a scan listed by an earlier call does not hold a record judged in a later one', async () => {
  const scanKeys = [key(1)];
  const page = fakePage({}, {}, scanKeys);
  const s = screenWith(REGULATORY, page);
  assertEquals((await run([await goodPdf(1)], s)).screened, []);
  scanKeys.length = 0; // the page check keeps its list for the whole run; this call adds nothing to it
  assert((page.check.stats.scans as string[]).includes(key(1)));
  const again = await run([await goodPdf(1)], s);
  assertEquals(again.screened.map((r) => r.completeness_basis), ['page_check']);
});

Deno.test('source_fields: a file_url over 2,000 UTF-8 bytes is not_official_url; exactly 2,000 passes; bytes, not characters', async () => {
  const head = 'https://rbidocs.rbi.org.in/';
  const mk = (pad: string) => `${head}${pad}.pdf`;
  const at2000 = mk('a' + 'é'.repeat(984));
  assertEquals(bytes(at2000), 2000);
  assert(at2000.length < 1100, 'the value is long in bytes but short in characters');
  assertEquals(await oneReasons('source_fields', await good(1, { file_url: at2000 })), []);
  const over = mk('aa' + 'é'.repeat(984));
  assertEquals(bytes(over), 2001);
  assertEquals(await oneReasons('source_fields', await good(1, { file_url: over })), ['not_official_url']);
  assertEquals(await oneReasons('source_fields', await good(1, { file_url: mk('a'.repeat(2000 - 31)) })), []);
  assertEquals(await oneReasons('source_fields', await good(1, { file_url: mk('a'.repeat(2000 - 30)) })), [
    'not_official_url',
  ]);
});

Deno.test('source_fields: document_key_suggested over 500 UTF-8 bytes, blank or not a string is suggested_key_invalid', async () => {
  const ok500 = 'reg:' + 'x'.repeat(496);
  const ok500b = 'reg:' + 'é'.repeat(248);
  assertEquals([bytes(ok500), bytes(ok500b)], [500, 500]);
  for (const v of [ok500, ok500b, 'reg:1']) {
    assertEquals(await oneReasons('source_fields', await good(1, { document_key_suggested: v })), [], v.slice(0, 8));
  }
  for (
    const v of ['reg:' + 'x'.repeat(497), 'reg:' + 'é'.repeat(249), '', '   ', '\t\n', undefined, null, 5, {}, [], true]
  ) {
    assertEquals(
      await oneReasons('source_fields', await good(1, { document_key_suggested: v })),
      ['suggested_key_invalid'],
      String(v).slice(0, 8),
    );
  }
  // A string with the wrong prefix is still a shape problem only.
  assertEquals(await oneReasons('record_shape', await good(1, { document_key_suggested: 'law:1' })), ['bad_shape']);
  assertEquals(await oneReasons('source_fields', await good(1, { document_key_suggested: 'law:1' })), []);
  // And a value record_shape cannot judge is not reported twice.
  assertEquals(await oneReasons('record_shape', await good(1, { document_key_suggested: 5 })), []);
});

Deno.test('configuration: the PDF rule matches a path of the official host ending .pdf, with no query or fragment', () => {
  const rule = pdfUrlRule(REGULATORY);
  for (const yes of [PDF(1), 'https://rbidocs.rbi.org.in/a/b/c.PDF', 'https://rbidocs.rbi.org.in/a b.pdf']) {
    assert(rule.test(yes), yes);
  }
  for (
    const no of [
      'https://rbidocs.rbi.org.in/a.html?x=.pdf',
      'https://rbidocs.rbi.org.in/a.pdf?x=1',
      'https://rbidocs.rbi.org.in/a.pdf#p',
      'https://rbidocs.rbi.org.in/.pdf',
      'https://rbidocs.rbi.org.in/',
    ]
  ) {
    assert(!rule.test(no), no);
  }
});

Deno.test('source_fields: text copied into the payload must be well-formed UTF-16; a lone surrogate is field_invalid', async () => {
  const lone = ['\ud800', 'a\udc00b', 'x\ud83d'];
  for (const v of lone) {
    const t = await oneFindings('source_fields', await good(1, { title: `T${v}` }));
    assertEquals(t.map((f) => f.reason), ['field_invalid']);
    assertEquals(t[0].detail, 'title');
  }
  for (
    const f of [
      'pack',
      'as_of',
      'text_engine',
      'ocr_lang',
      'file_name',
      'source_path',
      'language',
      'licence',
      'attribution',
      'citation_text',
    ]
  ) {
    assertEquals(await oneReasons('source_fields', await good(1, { [f]: 'a\ud800' })), ['field_invalid'], f);
    assertEquals(await oneReasons('source_fields', await good(1, { [f]: 'a\u{1F600}b' })), [], f);
  }
  for (
    const citation of [
      { kind: 'k', regulator: 'R', regulator_name: 'N', title: 'T\ud800', source: 'S' },
      { kind: 'k', regulator: 'R', regulator_name: 'N', title: 'T', source: 'S', note: 'x\udc00' },
      { kind: 'k', regulator: 'R', regulator_name: 'N', title: 'T', source: 'S', 'k\ud800': 'v' },
    ]
  ) {
    assertEquals(await oneReasons('source_fields', await good(1, { citation })), ['field_invalid']);
  }
  assertEquals(await oneReasons('source_fields', await good(1, { title: 'T\u{1F600}' })), []);
});

Deno.test('density: exactly the floor passes (the database refuses only below it), one character fewer is held', async () => {
  const at = (n: number): Rec => ({ text: 'x'.repeat(n), pages: [1, 2, 3, 4, 5].map((p) => ({ page_number: p })) });
  assertEquals(await oneReasons('density', at(3000)), []);
  assertEquals(await oneReasons('density', at(2999)), ['below_density']);
  assertEquals(await oneReasons('density', at(3001)), []);
});

Deno.test('not_a_replacement: any v16_replaces value but false, null or absent is held', async () => {
  for (const v of [true, 1, 0, '', 'false', 'true', {}, [], 'no']) {
    assertEquals(await oneReasons('not_a_replacement', await good(1, { v16_replaces: v })), [
      'replacement_not_supported',
    ], JSON.stringify(v));
  }
  for (const v of [false, null, undefined]) {
    assertEquals(await oneReasons('not_a_replacement', await good(1, { v16_replaces: v })), []);
  }
});

Deno.test('suggested_key_held_live: a reader that returns a document of another desk does not make the record held', async () => {
  const live = new FakeLive([
    liveDoc({ id: 'b', source_key: 'old2', document_key_suggested: 'reg:2', desk_feature: 'Another desk' }),
  ]);
  live.leaky = true;
  assertEquals(live.docs.length, 1);
  assertEquals(await allReasons('suggested_key_held_live', [await good(2)], live), {});
  const own = new FakeLive([liveDoc({ id: 'a', source_key: 'old1', document_key_suggested: 'reg:1' })]);
  own.leaky = true;
  assertEquals(await allReasons('suggested_key_held_live', [await good(1)], own), {
    [key(1)]: ['suggested_key_held_live'],
  });
});

Deno.test('holds print the record source_key only when it is 40 hex characters; this screen asks for that', async () => {
  const s = screenWith();
  assertEquals(s.holdKeys, 'hex40');
  const out = await run([
    await good(1, { licence_class: 'other' }),
    await good(2, { source_key: 'printable-but-not-a-key' }),
    await good(3, { source_key: MARKER }),
  ], s);
  assertEquals(out.holds.map((h) => h.source_key), [key(1), null, null]);
  assert(!JSON.stringify(out.holds).includes(MARKER));
  assertEquals(makeBillsScreen().holdKeys, undefined);
});

Deno.test('licence_admitted: the settings error names the screen that raised it; Bills keeps its exact text', async () => {
  const message = async (c: Check) => {
    try {
      await c.one!({}, ctxOf(new FakeLive(), {}));
    } catch (e) {
      return (e as Error).message;
    }
    return '';
  };
  assertEquals(
    await message(makeBillsScreen().checks.find((c) => c.name === 'licence_admitted')!),
    'bills screen: settings.licenceClasses (an array of strings) is required',
  );
  assertEquals(
    await message(checkNamed('licence_admitted')),
    'search-only screen: settings.licenceClasses (an array of strings) is required',
  );
});

// ---- F339: the screen holds what prepare would hold ----

/** A record that passes every offline check and makes several chunks: 3 pages of `chars` characters each. */
const longish = (n = 1, over: Rec = {}) => textRec(n, 3, 1_500, over);
/** The chunk count prepare gives a record the screen passed (the runner's own input: the screened record). */
async function chunksOf(screened: Rec): Promise<number> {
  const p = await prepareRecord(screened, { maxChunks: 800 });
  assertEquals(p.kind, 'request');
  return p.kind === 'request' ? p.item.chunks : -1;
}
const runWith = (
  records: Rec[],
  prepare: PrepareOptions | undefined,
  live: LiveReader = new FakeLive(),
) =>
  runScreen(
    screenWith(),
    records,
    { live, settings: SETTINGS, prepare },
    opts(),
  );

Deno.test('prepare_holds: a record whose chunks exceed the collection file maxChunks is held over_chunk_limit, under the completeness group', async () => {
  const rec = await longish(1);
  const passing = await runWith([rec], PREPARE);
  assertEquals(passing.holds, []);
  const n = await chunksOf(passing.screened[0]);
  assert(n >= 3, `the fixture should make several chunks, made ${n}`);
  const at = await runWith([rec], { ...PREPARE, maxChunks: n });
  assertEquals(
    at.holds,
    [],
    'exactly at the limit is admitted, as prepare admits it',
  );
  const over = await runWith([rec], { ...PREPARE, maxChunks: n - 1 });
  assertEquals(over.screened, []);
  assertEquals(over.holds.length, 1);
  assertEquals(over.holds[0].reasons, ['over_chunk_limit']);
  assertEquals(over.holds[0].findings[0].detail, `${n} chunks`);
  assertEquals(
    over.holds[0].findings.map((f) => [f.check, f.covers, f.reason]),
    [
      ['prepare_holds', ['completeness'], 'over_chunk_limit'],
    ],
  );
  assert(
    !JSON.stringify(over.holds).includes('Page 1 of document'),
    'a finding carries no record text',
  );
});

Deno.test('prepare_holds: every record the screen passes, prepare admits at the same limit, and every one it holds prepare would hold', async () => {
  const records = [
    await longish(1),
    await good(2),
    await textRec(3, 3, 3_000),
    await textRec(4, 3, 400, {}, '\u0001'.repeat(11)),
  ];
  let sawHeld = false, sawPassed = false;
  for (const maxChunks of [1, 3, 5, 700]) {
    const prepare = { ...PREPARE, maxChunks };
    const out = await runWith(records, prepare);
    for (const s of out.screened) {
      sawPassed = true;
      assertEquals(
        (await prepareRecord(s, prepare)).kind,
        'request',
        `max ${maxChunks}`,
      );
    }
    for (const h of out.holds) {
      sawHeld = true;
      const rec = records.find((r) => r.source_key === h.source_key)!;
      const passing = (await runWith([rec], { ...PREPARE, maxChunks: 800 })).screened[0];
      // The reason prepare gives for the same record at the same limit, or the record was held by prepare's other rule.
      const p = passing ? await prepareRecord(passing, prepare) : null;
      if (p) {
        assertEquals(
          p.kind === 'hold' ? p.hold.reason : null,
          h.reasons[0],
          `max ${maxChunks}`,
        );
      }
    }
  }
  assert(sawHeld && sawPassed);
});

Deno.test('prepare_holds: a dense run of control codes is held control_codes_excess, as prepare holds it', async () => {
  const lead = '\u0001'.repeat(11);
  const rec = await good(1, {});
  const dense = await textRec(1, 3, 400, {}, lead);
  void rec;
  const out = await runWith([dense], PREPARE);
  assertEquals(out.screened, []);
  assertEquals(out.holds[0].reasons, ['control_codes_excess']);
  assertEquals(out.holds[0].findings[0].check, 'prepare_holds');
  assertEquals(out.holds[0].findings[0].covers, ['completeness']);
  // Ten codes in the window are allowed, by prepare and so by the screen.
  const ten = await runWith(
    [await textRec(2, 3, 400, {}, '\u0001'.repeat(10))],
    PREPARE,
  );
  assertEquals(ten.holds, []);
});

Deno.test('prepare_holds: with no prepare block in the context the check fails closed (check_error), never passes', async () => {
  const out = await runWith([await good(1)], undefined);
  assertEquals(out.screened, []);
  assertEquals(out.holds[0].reasons, ['check_error']);
  assertEquals(out.holds[0].findings[0].check, 'prepare_holds');
  const bad = await runWith(
    [await good(1)],
    { maxChunks: 0 } as PrepareOptions,
  );
  assertEquals(bad.holds[0].reasons, ['check_error']);
});

Deno.test('prepare_holds: only a record every other check passed is probed, and a record already held is not', async () => {
  const out = await runWith([await longish(1, { licence_class: 'other' })], {
    ...PREPARE,
    maxChunks: 1,
  });
  assertEquals(out.holds[0].reasons, ['licence_not_admitted']);
});

Deno.test('definition: the screen says it uses the prepare block, and the rules hash moves with it', async () => {
  const s = screenWith();
  assertEquals(s.usesPrepare, true);
  assertEquals(makeBillsScreen().usesPrepare, undefined);
  const read = () => Promise.resolve(new TextEncoder().encode('x'));
  const a = await rulesSha256(s.rulesFiles, '/r', read, SETTINGS, PREPARE);
  assert(
    a !==
      await rulesSha256(s.rulesFiles, '/r', read, SETTINGS, {
        ...PREPARE,
        maxChunks: 800,
      }),
  );
  assert(a !== await rulesSha256(s.rulesFiles, '/r', read, SETTINGS));
  assertEquals(
    await rulesSha256(s.rulesFiles, '/r', read, SETTINGS),
    await rulesSha256(s.rulesFiles, '/r', read, SETTINGS),
  );
});

// ---- F345: a live document of the desk holds the same title and file date under another key ----

const MTIME = '2026-09-08T21:59:01Z';
const twin = (o: Partial<LiveDocument> = {}) =>
  liveDoc({
    id: 'twin',
    source_key: 'a'.repeat(40),
    title: 'TRAI_recommendation__Letter-to-Secretary-MIB',
    file_name: 'TRAI_recommendation__Letter-to-Secretary-MIB.pdf',
    file_mtime: MTIME,
    source_host: 'trai.gov.in',
    ...o,
  });
const titled = (n: number, over: Rec = {}) =>
  good(n, {
    title: 'TRAI: TRAI recommendation — Letter to Secretary, MIB',
    title_stem: 'TRAI_recommendation__Letter to Secretary, MIB',
    file_mtime: MTIME,
    ...over,
  });

Deno.test('duplicate_title_live: the same normalised title and file date under another key holds the record', async () => {
  const r = await titled(1);
  const live = new FakeLive([twin()]);
  assertEquals(await allReasons('duplicate_title_live', [r], live), {
    [key(1)]: ['duplicate_title_live'],
  });
  const m = await checkNamed('duplicate_title_live').all!([r], ctxOf(live));
  const f = m.get(key(1))![0];
  assertEquals([f.check, f.covers], ['duplicate_title_live', ['dedupe']]);
  assertEquals(live.docCalls.at(-1)?.tier, 'national');
  assertEquals(live.docCalls.at(-1)?.feature, FEATURE);
  assertEquals(live.docCalls.at(-1)?.fileMtimes, [MTIME]);
});

Deno.test('duplicate_title_live: the title may match the live title, the live file stem, the record title_stem or the record title', async () => {
  const stemOnly = twin({
    title: 'something else',
    file_name: 'Report on Spectrum.PDF',
  });
  const byLiveStem = await titled(1, {
    title: 'Report-on_Spectrum',
    title_stem: 'unrelated',
  });
  assertEquals(
    await allReasons(
      'duplicate_title_live',
      [byLiveStem],
      new FakeLive([stemOnly]),
    ),
    {
      [key(1)]: ['duplicate_title_live'],
    },
  );
  const byTitle = await titled(2, {
    title: 'Report, on spectrum',
    title_stem: 'unrelated',
  });
  assertEquals(
    await allReasons(
      'duplicate_title_live',
      [byTitle],
      new FakeLive([stemOnly]),
    ),
    {
      [key(2)]: ['duplicate_title_live'],
    },
  );
  const byLiveTitle = twin({ title: 'Report on Spectrum', file_name: 'x.pdf' });
  assertEquals(
    await allReasons(
      'duplicate_title_live',
      [byTitle],
      new FakeLive([byLiveTitle]),
    ),
    {
      [key(2)]: ['duplicate_title_live'],
    },
  );
});

Deno.test('duplicate_title_live: a different file date, regulator, desk, or no usable title does not hold', async () => {
  const r = await titled(1);
  const none = async (live: FakeLive, rec = r) =>
    assertEquals(await allReasons('duplicate_title_live', [rec], live), {});
  await none(new FakeLive([twin({ file_mtime: '2026-09-08T21:59:02Z' })]));
  await none(new FakeLive([twin({ file_mtime: null })]));
  await none(new FakeLive([twin({ source_host: 'cci.gov.in' })]));
  await none(new FakeLive([twin({ source_host: null })]));
  await none(
    new FakeLive([
      twin({
        title: 'Letter to Secretary DoT',
        file_name: 'Letter to Secretary DoT.pdf',
      }),
    ]),
  );
  const other = new FakeLive([twin({ desk_feature: 'Another desk' })]);
  other.leaky = true;
  await none(other);
  // Nothing that normalises to nothing matches anything.
  const blank = await titled(2, { title: '— —', title_stem: '__' });
  await none(new FakeLive([twin({ title: '--', file_name: '__.pdf' })]), blank);
  // A record without a file date asks nothing and is not held by this check.
  const noDate = await titled(3, { file_mtime: undefined });
  const live = new FakeLive([twin()]);
  await none(live, noDate);
  assertEquals(live.docCalls.length, 0);
});

Deno.test('duplicate_title_live: a reader that returns documents of another file date is not trusted; the finding names the live key', async () => {
  const r = await titled(1);
  const reader = (docs: LiveDocument[]): LiveReader => ({
    identity: () => Promise.reject(new Error('unused')),
    deskRows: () => Promise.reject(new Error('unused')),
    documents: () => Promise.resolve(docs),
  });
  assertEquals(
    await allReasons('duplicate_title_live', [r], reader([twin({ file_mtime: '2026-09-08T21:59:02Z' })])),
    {},
  );
  const m = await checkNamed('duplicate_title_live').all!([r], ctxOf(reader([twin()])));
  assertEquals(m.get(key(1))![0].detail, `held by ${'a'.repeat(40)}`);
});

Deno.test('duplicate_title_live: titles in other scripts are compared too, not reduced to nothing', async () => {
  const r = await titled(1, { title: 'सलाह पत्र 7', title_stem: 'zz' });
  const live = new FakeLive([twin({ title: 'सलाह_पत्र-7', file_name: 'q.pdf' })]);
  assertEquals(await allReasons('duplicate_title_live', [r], live), { [key(1)]: ['duplicate_title_live'] });
  const other = new FakeLive([twin({ title: 'अन्य_पत्र-7', file_name: 'q.pdf' })]);
  assertEquals(await allReasons('duplicate_title_live', [r], other), {});
});

Deno.test("duplicate_title_live: the document that holds the record's own key is already_live, not a second finding here", async () => {
  const r = await titled(1);
  const same = twin({ source_key: key(1) });
  assertEquals(
    await allReasons('duplicate_title_live', [r], new FakeLive([same])),
    {},
  );
  const out = await run([r], screenWith(), new FakeLive([same]));
  assertEquals(out.holds[0].reasons, ['already_live']);
  const other = await run([r], screenWith(), new FakeLive([twin()]));
  assertEquals(other.screened, []);
  assertEquals(other.holds[0].reasons, ['duplicate_title_live']);
  assertEquals(other.holds[0].findings.map((f) => f.check), [
    'duplicate_title_live',
  ]);
});

Deno.test('duplicate_title_live: a failed live read is an error for the whole check, never a pass', async () => {
  await assertRejects(
    async () =>
      await checkNamed('duplicate_title_live').all!(
        [await titled(1)],
        ctxOf(new FakeLive([twin()], true)),
      ),
    Error,
    'live read failed',
  );
});

Deno.test('duplicate_title_live: a leading www. on either host is ignored, the full timestamp still must match', async () => {
  const r = await titled(1, { source_host: 'www.trai.gov.in' });
  assertEquals(await allReasons('duplicate_title_live', [r], new FakeLive([twin()])), {
    [key(1)]: ['duplicate_title_live'],
  });
  const r2 = await titled(2);
  assertEquals(
    await allReasons('duplicate_title_live', [r2], new FakeLive([twin({ source_host: 'www.trai.gov.in' })])),
    {
      [key(2)]: ['duplicate_title_live'],
    },
  );
  assertEquals(
    await allReasons('duplicate_title_live', [r2], new FakeLive([twin({ source_host: 'www.cci.gov.in' })])),
    {},
  );
});

Deno.test('prepare_holds: a prepare block that carries patches fails closed (check_error), never holds a patch record as superseded', async () => {
  const out = await runWith([await good(1)], { ...PREPARE, patches: { [key(1)]: {} } });
  assertEquals(out.screened, []);
  assertEquals(out.holds[0].reasons, ['check_error']);
  assertEquals(out.holds[0].findings[0].check, 'prepare_holds');
});

// ---- the five National desks (F374; docs/specs/2026-11-19-five-desk-search-only-route.md, Design 2 to 4) ----
// Records are synthetic. Each desk's configuration is exercised through the real runner, with a fake page check and the
// real publisher resolver (supabase/functions/_shared/publisher.ts names the five desks by host).

/** The settings the five desks will really run with: page-less text is theirs (policy requirePageCount false). */
const DESK_SETTINGS: Rec = { ...SETTINGS, requirePageCount: false };
const deskCtx = (settings: Rec = DESK_SETTINGS) => ctxOf(new FakeLive(), settings);

interface Desk {
  name: string;
  file: string;
  cfg: Rec;
  collection: string;
  /** Text from pages (a PDF text layer) or from a page or dataset with none. */
  paged: boolean;
  sourceHost: string;
  extraction: string;
  /** A file link the desk's host list allows, and whether the page check applies to it. */
  url: (n: number) => string | null;
  citation: Rec;
  prefix: string | null;
  basis: 'page_check' | 'density_only';
  /** A file link on another desk's host. */
  foreignUrl: string;
  /** An extraction the desk does not allow. */
  otherExtraction: string;
}
const DESKS: Desk[] = [
  {
    name: 'budget',
    file: 'budget.json',
    cfg: BUDGET,
    collection: 'national-budget',
    paged: true,
    sourceHost: 'indiabudget.gov.in',
    extraction: 'pdf_text',
    url: (n) => `https://www.indiabudget.gov.in/doc/budget_speech/bs${n}.pdf`,
    citation: { kind: 'budget', collection: 'c', issuer: 'Ministry of Finance', source: 'S', licence_note: 'n' },
    prefix: 'budget:',
    basis: 'page_check',
    foreignUrl: 'https://www.pib.gov.in/doc/x.pdf',
    otherExtraction: 'doc',
  },
  {
    name: 'cabinet',
    file: 'cabinet.json',
    cfg: CABINET,
    collection: 'national-cabinet',
    paged: false,
    sourceHost: 'pib.gov.in',
    extraction: 'html',
    url: (n) => `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${n}`,
    citation: { kind: 'cabinet_decision', issuer: 'Cabinet', prid: '100', posted_on: null, source: 'S' },
    prefix: null,
    basis: 'density_only',
    foreignUrl: 'https://mha.gov.in/x.pdf',
    otherExtraction: 'pdf_text',
  },
  {
    name: 'transfers',
    file: 'transfers.json',
    cfg: TRANSFERS,
    collection: 'national-transfers',
    paged: true,
    sourceHost: 'mha.gov.in',
    extraction: 'pdf_text',
    url: (n) => `https://mha.gov.in/sites/default/files/T${n}.pdf`,
    citation: { kind: 'transfer_order', issuer: 'MHA', date: '2025-01-01', source: 'S' },
    prefix: null,
    basis: 'page_check',
    foreignUrl: 'https://www.pib.gov.in/doc/x.pdf',
    otherExtraction: 'ocr',
  },
  {
    name: 'industry',
    file: 'industry.json',
    cfg: INDUSTRY,
    collection: 'national-industry',
    paged: true,
    sourceHost: 'www.dpiit.gov.in',
    extraction: 'pdf_text',
    url: (n) => `https://www.dpiit.gov.in/static/uploads/I${n}.pdf`,
    citation: { kind: 'industry_update', issuer: 'DPIIT', source: 'S' },
    prefix: 'industry:',
    basis: 'page_check',
    foreignUrl: 'https://www.pib.gov.in/doc/x.pdf',
    otherExtraction: 'ocr',
  },
  {
    name: 'mp_profiles',
    file: 'mp_profiles.json',
    cfg: MP_PROFILES,
    collection: 'national-mp-profiles',
    paged: false,
    sourceHost: 'sansad.in',
    extraction: 'html',
    url: (n) => `https://sansad.in/ls/members/biography/${n}?x=1`,
    citation: { kind: 'mp_profile', house: 'Lok Sabha', mp_name: 'A. Member', mpsno: '12', source: 'S' },
    prefix: 'mp:',
    basis: 'density_only',
    foreignUrl: 'https://www.pib.gov.in/x?PRID=1',
    otherExtraction: 'ocr',
  },
];
const deskNamed = (n: string) => DESKS.find((d) => d.name === n)!;

/** A web page or dataset: text with no pages, as the pack gives it (page_split none, no page_count). */
async function unpagedRec(n: number, chars: number): Promise<Rec> {
  const text = `Document ${n}. `.padEnd(chars, 'w');
  return {
    schema: 'nter.citation_pack/1.1',
    source_key: key(n),
    desk_tier: 'national',
    title: `Record number ${n}`,
    file_name: `r${n}`,
    licence_class: LICENCE,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: null,
    page_split: 'none',
    links: [],
    pages: [],
    text,
  };
}
/** A record of the desk that passes every check; `over` replaces fields, and an undefined value removes one. */
async function deskRec(d: Desk, n: number, over: Rec = {}, chars = 1_200): Promise<Rec> {
  const base = d.paged ? await textRec(n, 1, chars) : await unpagedRec(n, chars);
  const rec: Rec = {
    ...base,
    desk_feature: d.cfg.desk_feature,
    desk_rows_feature: d.cfg.desk_rows_feature,
    doc_type: d.cfg.doc_type,
    source_host: d.sourceHost,
    extraction: d.extraction,
    file_url: d.url(n),
    citation: { ...d.citation },
    document_key_suggested: d.prefix === null ? undefined : `${d.prefix}${n}`,
    links: [],
    ...over,
  };
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return rec;
}
/**
 * The desk's screen. `prepare_holds` asks the adapter's own prepare step, which names the search-only desks in
 * `supabase/functions/_shared/suppliedText.ts` (task 2 of the spec, not this task): until it names these five it holds
 * every record of them as prepare_failed. So the desk tests stand that one check in with a pass, and the last test of
 * this section asks the real one for every desk the adapter already names.
 */
const deskScreen = (d: Desk, cfg: Rec = {}, page = fakePage(), realPrepare = false) => {
  const s = makeSearchOnlyScreen({ ...d.cfg, ...cfg }, page.check, {
    configFile: `scripts/bulk-runner/screens/${d.file}`,
  });
  return realPrepare ? s : {
    ...s,
    checks: s.checks.map((c) => c.name === 'prepare_holds' ? { ...c, one: () => Promise.resolve([]) } : c),
  };
};
const deskRun = (d: Desk, records: Rec[], cfg: Rec = {}, page = fakePage()) =>
  runScreen(deskScreen(d, cfg, page), records, deskCtx(), opts());
const reasonsOf = (out: Awaited<ReturnType<typeof run>>, k: string) => holdOf(out, k)?.reasons ?? [];

Deno.test('desks: each of the five configurations parses and names its collection, desk and limits', () => {
  for (const d of DESKS) {
    const cfg = parseSearchOnlyConfig(d.cfg);
    assertEquals(cfg.collection, d.collection);
    assertEquals(cfg.desk_tier, 'national');
    assertEquals(cfg.desk_rows_feature, cfg.desk_feature, d.name);
    assertEquals([cfg.min_chars, cfg.max_chars], [300, 600_000]);
    assertEquals(deskScreen(d).collection, d.collection);
  }
  const feature = (d: string) => deskNamed(d).cfg.desk_feature;
  assertEquals(feature('budget'), 'Budget Utilisation & Schemes');
  assertEquals(feature('cabinet'), 'Cabinet Decisions');
  assertEquals(feature('transfers'), 'Bureaucratic Transfers \u2014 AGMUT Cadre');
  assertEquals(feature('industry'), 'Industry Updates (Ministry Data)');
  assertEquals(feature('mp_profiles'), 'MP Profiles & Performance (MPLAD attendance debates)');
});

Deno.test('desks: the values of the spec table (text types, citation fields, key prefix, hosts)', () => {
  const want: Record<string, Rec> = {
    budget: {
      extraction_allowed: ['pdf_text', 'ocr_mistral'],
      citation_required: ['kind', 'issuer', 'source'],
      suggested_key_prefix: 'budget:',
      url_hosts: ['www.indiabudget.gov.in'],
    },
    cabinet: {
      extraction_allowed: ['html'],
      citation_required: ['kind', 'issuer', 'prid', 'source'],
      suggested_key_prefix: undefined,
      url_hosts: ['www.pib.gov.in'],
    },
    transfers: {
      extraction_allowed: ['pdf_text'],
      citation_required: ['kind', 'source'],
      suggested_key_prefix: undefined,
      url_hosts: ['mha.gov.in'],
    },
    industry: {
      extraction_allowed: ['pdf_text'],
      citation_required: ['kind', 'source'],
      suggested_key_prefix: 'industry:',
      url_hosts: ['www.dpiit.gov.in', 'eaindustry.nic.in', 'www.mospi.gov.in', 'mospi.gov.in'],
    },
    mp_profiles: {
      extraction_allowed: ['html', 'dataset'],
      citation_required: ['kind', 'house', 'mp_name', 'mpsno', 'source'],
      suggested_key_prefix: 'mp:',
      url_hosts: ['sansad.in'],
    },
  };
  for (const d of DESKS) {
    const cfg = parseSearchOnlyConfig(d.cfg);
    for (const [k, v] of Object.entries(want[d.name])) {
      assertEquals((cfg as unknown as Rec)[k], v, `${d.name} ${k}`);
    }
  }
  // Budget holds a record with no checkable file by not allowing the density-only basis; the others allow it.
  assertEquals(parseSearchOnlyConfig(BUDGET).allow_density_only, false);
  for (const d of DESKS.filter((x) => x.name !== 'budget')) {
    assertEquals(parseSearchOnlyConfig(d.cfg).allow_density_only, true, d.name);
  }
});

Deno.test('desks: a good record of each desk passes and earns the basis the spec gives it', async () => {
  for (const d of DESKS) {
    const out = await deskRun(d, [await deskRec(d, 1)]);
    assertEquals(out.holds, [], d.name);
    assertEquals(out.screened.length, 1, d.name);
    assertEquals(out.screened[0].completeness_basis, d.basis, d.name);
  }
});

Deno.test('desks: MP Profiles takes a dataset as well as a page; Industry, a record with no file link; Budget its second doc_type', async () => {
  const mp = deskNamed('mp_profiles');
  const set = await deskRec(mp, 2, { extraction: 'dataset', doc_type: 'mp_record_profile', source_record_id: 'r2' });
  const page = await deskRec(mp, 3, { doc_type: 'mp_profile' });
  const out = await deskRun(mp, [set, page]);
  assertEquals(out.holds, []);
  const ind = deskNamed('industry');
  const noLink = await deskRec(ind, 4, { file_url: undefined, source_host: 'eaindustry.nic.in' });
  const out2 = await deskRun(ind, [noLink]);
  assertEquals(out2.holds, []);
  assertEquals(out2.screened[0].completeness_basis, 'density_only');
  for (const dt of ['industry_document', 'industry_report', 'industry_update']) {
    assertEquals((await deskRun(ind, [await deskRec(ind, 5, { doc_type: dt })])).holds, [], dt);
  }
  const bud = deskNamed('budget');
  // budget_doc is the pack's spelling for the one OCR record: accepted as a doc_type, held for its text type.
  const ocr = await deskRec(bud, 6, { doc_type: 'budget_doc', extraction: 'ocr' });
  assertEquals(reasonsOf(await deskRun(bud, [ocr]), key(6)), ['extraction_not_allowed']);
  assertEquals((await deskRun(bud, [await deskRec(bud, 7, { doc_type: 'budget_doc' })])).holds, []);
  for (const dt of ['regulatory', 'budget_documents', '']) {
    assert(reasonsOf(await deskRun(bud, [await deskRec(bud, 8, { doc_type: dt })]), key(8)).includes('bad_shape'), dt);
  }
});

Deno.test('desks: each hold of the spec shows on a record built for it', async () => {
  for (const d of DESKS) {
    const own = (k: number) => d.name + k;
    // Too short (299 characters) and too long (600,001).
    const short = await deskRec(d, 1, {}, 299);
    const long = await deskRec(d, 2, {}, 600_001);
    const edge1 = await deskRec(d, 3, {}, 300);
    const edge2 = await deskRec(d, 4, {}, 600_000);
    const out = await deskRun(d, [short, long, edge1, edge2]);
    assert(reasonsOf(out, key(1)).includes('too_short'), own(1));
    assert(reasonsOf(out, key(2)).includes('too_long'), own(2));
    assertEquals(holdOf(out, key(3)), undefined, own(3));
    assertEquals(holdOf(out, key(4)), undefined, own(4));
    // A text type the desk does not allow.
    const ext = await deskRun(d, [await deskRec(d, 5, { extraction: d.otherExtraction })]);
    assertEquals(reasonsOf(ext, key(5)), ['extraction_not_allowed'], own(5));
    // A source host the desk does not list; a file link on another desk's host.
    const host = await deskRun(d, [await deskRec(d, 6, { source_host: 'example.org' })]);
    assertEquals(reasonsOf(host, key(6)), ['unknown_host'], own(6));
    const foreign = await deskRun(d, [await deskRec(d, 7, { file_url: d.foreignUrl })]);
    assertEquals(reasonsOf(foreign, key(7)), ['not_official_url'], own(7));
    // Each required citation field, missing or blank.
    for (const f of d.cfg.citation_required as string[]) {
      for (const bad of [undefined, '', '  ']) {
        const c = { ...d.citation, [f]: bad };
        if (bad === undefined) delete c[f];
        const r = await deskRun(d, [await deskRec(d, 8, { citation: c })]);
        assertEquals(reasonsOf(r, key(8)), ['citation_incomplete'], `${d.name} ${f}`);
        assertEquals(holdOf(r, key(8))!.findings[0].detail, f, `${d.name} ${f}`);
      }
    }
    // A key with another desk's prefix; a desk with no prefix takes no suggested key at all.
    const wrong = await deskRun(d, [await deskRec(d, 9, { document_key_suggested: 'law:9' })]);
    assertEquals(reasonsOf(wrong, key(9)), ['bad_shape'], own(9));
    assertEquals(holdOf(wrong, key(9))!.findings[0].detail, 'document_key_suggested', own(9));
    if (d.prefix !== null) {
      const missing = await deskRun(d, [await deskRec(d, 10, { document_key_suggested: undefined })]);
      assertEquals(reasonsOf(missing, key(10)), ['suggested_key_invalid'], own(10));
    }
  }
});

Deno.test('desks: a desk is not another desk (feature, rows feature and tier are named by the configuration)', async () => {
  const a = deskNamed('budget'), b = deskNamed('cabinet');
  const out = await deskRun(a, [
    await deskRec(a, 1, { desk_feature: b.cfg.desk_feature }),
    await deskRec(a, 2, { desk_rows_feature: b.cfg.desk_rows_feature }),
    await deskRec(a, 3, { desk_tier: 'law' }),
  ]);
  for (const n of [1, 2, 3]) assertEquals(reasonsOf(out, key(n)), ['bad_shape'], String(n));
});

Deno.test('desks: pack links are not read for a desk that carries none (a search-only document has no row links)', async () => {
  // The pack's Cabinet link has no row_key and names a document key the record does not carry; MP's names the listing
  // under its commas. Admission writes no link for a search-only document, so these are no hold.
  const cab = deskNamed('cabinet'), mp = deskNamed('mp_profiles');
  const link = (feature: string, document_key: string | null) => [{
    tier: 'national',
    feature,
    role: 'press_release',
    row_key: null,
    document_key,
    match_on: 'x',
  }];
  const r1 = await deskRec(cab, 1, { links: link('Cabinet Decisions', 'cab:1') });
  const r2 = await deskRec(mp, 2, { links: link('MP Profiles & Performance (MPLAD, attendance, debates)', 'mp:2') });
  assertEquals((await deskRun(cab, [r1])).holds, []);
  assertEquals((await deskRun(mp, [r2])).holds, []);
  // Proof that the field is what lets them through: without it, the same records are held as link_shape.
  assertEquals(reasonsOf(await deskRun(cab, [r1], { ignore_pack_links: false }), key(1)), ['link_shape']);
  assertEquals(reasonsOf(await deskRun(mp, [r2], { ignore_pack_links: false }), key(2)), ['link_shape']);
  // Regulatory keeps reading its links.
  assertEquals(parseSearchOnlyConfig(REGULATORY).ignore_pack_links, false);
});

Deno.test('desks: text from a page or dataset has no pages, and passes when the policy does not require a page count', async () => {
  for (const name of ['cabinet', 'mp_profiles']) {
    const d = deskNamed(name);
    const r = await deskRec(d, 1);
    assertEquals(r.page_split, 'none');
    assertEquals(r.page_count, null);
    const out = await deskRun(d, [r]);
    assertEquals(out.holds, [], name);
    assertEquals(out.screened[0].completeness_basis, 'density_only', name);
  }
});

Deno.test('desks: with a policy that requires a page count, page-less records are held, as admission holds them (S1)', async () => {
  for (const name of ['cabinet', 'mp_profiles']) {
    const d = deskNamed(name);
    const strict = await runScreen(
      deskScreen(d),
      [await deskRec(d, 1)],
      deskCtx({ ...SETTINGS, requirePageCount: true }),
      opts(),
    );
    assertEquals(strict.screened, [], name);
    assertEquals(reasonsOf(strict, key(1)), ['no_page_spans'], name);
    const loose = await runScreen(
      deskScreen(d),
      [await deskRec(d, 2)],
      deskCtx({ ...SETTINGS, requirePageCount: false }),
      opts(),
    );
    assertEquals(loose.holds, [], name);
  }
});

Deno.test('desks: unpaged_text only relaxes records with no pages; without it a page-less record is held', async () => {
  const cab = deskNamed('cabinet');
  const r = await deskRec(cab, 1);
  const strict = await deskRun(cab, [r], { unpaged_text: false });
  assert(reasonsOf(strict, key(1)).includes('page_count_unsplittable'), JSON.stringify(reasonsOf(strict, key(1))));
  // A split that is not 'none', or spans that do not add up, still hold.
  const odd = await deskRun(cab, [await deskRec(cab, 2, { page_split: 'exact' })]);
  assert(reasonsOf(odd, key(2)).includes('page_spans'), JSON.stringify(reasonsOf(odd, key(2))));
  const bad = await deskRun(cab, [await deskRec(cab, 3, { page_split: 'approximate' })]);
  assert(reasonsOf(bad, key(3)).includes('page_split'));
  const count = await deskRun(cab, [await deskRec(cab, 4, { page_count: 3 })]);
  assert(reasonsOf(count, key(4)).includes('page_count_unsplittable'));
  const hash = await deskRun(cab, [await deskRec(cab, 5, { content_sha256: '0'.repeat(64) })]);
  assert(reasonsOf(hash, key(5)).includes('text_hash_mismatch'));
});

Deno.test('desks: Budget (density-only not allowed) holds a record whose official file cannot be page-checked; a desk that allows it passes it', async () => {
  const bud = deskNamed('budget'), ind = deskNamed('industry'), tr = deskNamed('transfers');
  // No file link, and a link the PDF rule does not match (a page of the site, a PDF on the wrong host).
  const none = await deskRec(bud, 1, { file_url: undefined });
  const html = await deskRec(bud, 2, { file_url: 'https://www.indiabudget.gov.in/doc/page.html' });
  const out = await deskRun(bud, [none, html]);
  for (const n of [1, 2]) {
    assertEquals(reasonsOf(out, key(n)), ['no_completeness_basis'], String(n));
    assertEquals(
      holdOf(out, key(n))!.findings[0].detail,
      'the density-only basis is not allowed and there is no checkable file',
    );
  }
  // The same two records, with density-only allowed, are what they were: held by nothing and passed on density alone.
  const off = await deskRun(bud, [none, html], { allow_density_only: true });
  assertEquals(off.holds, []);
  assertEquals(off.screened.map((r) => r.completeness_basis), ['density_only', 'density_only']);
  // The same shape of record on desks whose table allows density-only passes.
  const i1 = await deskRec(ind, 3, { file_url: undefined });
  const t1 = await deskRec(tr, 4, { file_url: undefined });
  assertEquals((await deskRun(ind, [i1])).holds, []);
  assertEquals((await deskRun(tr, [t1])).holds, []);
  // A Budget link the page check cannot read is held by the page check, as for every desk.
  const bad = await deskRec(bud, 5);
  const failed = await deskRun(bud, [bad], {}, fakePage({ [key(5)]: ['pdf_unavailable'] }));
  assertEquals(reasonsOf(failed, key(5)), ['pdf_unavailable']);
  const ok = await deskRun(bud, [await deskRec(bud, 6)]);
  assertEquals(ok.screened[0].completeness_basis, 'page_check');
});

Deno.test("desks: the page check is offered the desk's own PDFs only", async () => {
  const ind = deskNamed('industry');
  const page = fakePage();
  const hosts = [
    'https://www.dpiit.gov.in/a.pdf',
    'https://eaindustry.nic.in/a.pdf',
    'https://www.mospi.gov.in/a.pdf',
    'https://mospi.gov.in/a.pdf',
  ];
  const recs = await Promise.all(
    hosts.map((u, i) => deskRec(ind, 10 + i, { file_url: u, source_host: new URL(u).host })),
  );
  const page2 = await deskRec(ind, 20, { file_url: undefined });
  const html = await deskRec(ind, 21, { file_url: 'https://www.dpiit.gov.in/a.html' });
  const out = await deskRun(ind, [...recs, page2, html], {}, page);
  assertEquals(out.holds, []);
  assertEquals(page.seen.flat().sort(), recs.map((r) => String(r.source_key)).sort());
  const rule = pdfUrlRule(INDUSTRY);
  for (const u of hosts) assert(rule.test(u), u);
  for (
    const no of [
      'https://www.pib.gov.in/a.pdf',
      'https://dpiit.gov.in/a.pdf',
      'https://www.dpiit.gov.in.evil.example/a.pdf',
      'https://www.dpiit.gov.in/a.pdf?x=1',
      'http://www.dpiit.gov.in/a.pdf',
    ]
  ) {
    assert(!rule.test(no), no);
  }
  // A desk with no PDF rule has no page-checkable file at all.
  for (const n of ['cabinet', 'mp_profiles']) {
    assertEquals(pdfUrlRule(deskNamed(n).cfg).test(deskNamed(n).url(1)!), false, n);
  }
});

Deno.test('desks: pdf_url_rule is optional, and a rule over several hosts must name only listed hosts, plainly', () => {
  const bad = (over: Rec, text: string) =>
    assertThrows(() => parseSearchOnlyConfig({ ...INDUSTRY, ...over }), Error, text);
  bad({ pdf_url_rule: '^https://(?:www\\.dpiit\\.gov\\.in|other\\.example)/[^?#]+\\.pdf$' }, 'pdf_url_rule');
  bad({ pdf_url_rule: '^https://(?:www\\.dpiit\\.gov\\.in|.*)/[^?#]+\\.pdf$' }, 'pdf_url_rule');
  bad({ pdf_url_rule: '^https://(?:www\\.dpiit\\.gov\\.in)x/a\\.pdf$' }, 'pdf_url_rule');
  bad({ pdf_url_rule: '^https://(?:)/a\\.pdf$' }, 'pdf_url_rule');
  bad({ pdf_url_rule: '' }, 'pdf_url_rule');
  const { pdf_url_rule: _gone, ...noRule } = INDUSTRY;
  assertEquals(parseSearchOnlyConfig(noRule).pdf_url_rule, undefined);
  assertEquals(pdfUrlRule(noRule).test('https://www.dpiit.gov.in/a.pdf'), false);
});

Deno.test('desks: the new configuration fields are refused by name when malformed', () => {
  const bad = (over: Rec, text: string) =>
    assertThrows(() => parseSearchOnlyConfig({ ...TRANSFERS, ...over }), Error, text);
  bad({ doc_type_also: 'x' }, 'doc_type_also');
  bad({ doc_type_also: [''] }, 'doc_type_also');
  bad({ doc_type_also: ['transfer_order'] }, 'doc_type_also');
  bad({ suggested_key_prefix: '' }, 'suggested_key_prefix');
  bad({ ignore_pack_links: 'yes' }, 'ignore_pack_links');
  bad({ unpaged_text: 1 }, 'unpaged_text');
  bad({ spelling_rewrites: [] }, 'spelling_rewrites');
  bad({ spelling_rewrites: { a: 'not a spelling of this desk' } }, 'spelling_rewrites');
  bad({ spelling_rewrites: { [TRANSFERS.desk_feature]: TRANSFERS.desk_feature } }, 'spelling_rewrites');
  bad({ spelling_rewrites: { '': TRANSFERS.desk_feature } }, 'spelling_rewrites');
});

// ---- Design 3: one spelling per desk ----

const HYPHEN = 'Bureaucratic Transfers - AGMUT Cadre';
const DASH = 'Bureaucratic Transfers \u2014 AGMUT Cadre';

Deno.test('spelling: the Transfers configuration accepts the hyphen spelling and writes the dash spelling into both fields', async () => {
  const tr = deskNamed('transfers');
  const s = deskScreen(tr);
  assertEquals(TRANSFERS.desk_feature, DASH);
  assertEquals(TRANSFERS.desk_rows_feature, DASH);
  assertEquals((TRANSFERS as Rec).spelling_rewrites, { [HYPHEN]: DASH });
  const v11 = await deskRec(tr, 1, { desk_feature: HYPHEN, desk_rows_feature: HYPHEN });
  // The checks accept it (the identity check is the one that names the spellings).
  for (const c of s.checks) {
    if (c.one && c.name !== 'prepare_holds') {
      assertEquals((await c.one(v11, deskCtx())).map((f) => f.reason), [], c.name);
    }
  }
  await s.checks.find((c) => c.name === 'completeness_basis')!.all!([v11], deskCtx());
  const done = s.project!(v11);
  assertEquals(done.desk_feature, DASH);
  assertEquals(done.desk_rows_feature, DASH);
});

Deno.test('spelling: a hyphen Transfers record goes through the real runner and comes out screened with the dash spelling in both fields', async () => {
  const tr = deskNamed('transfers');
  const v11 = await deskRec(tr, 1, { desk_feature: HYPHEN, desk_rows_feature: HYPHEN });
  const before = structuredClone(v11);
  const out = await deskRun(tr, [v11, await deskRec(tr, 2)]);
  assertEquals(out.holds, []);
  assertEquals(out.screened.map((r) => [r.desk_feature, r.desk_rows_feature]), [[DASH, DASH], [DASH, DASH]]);
  const { text_sha256: _t, review: _r, completeness_basis: _b, ...rest } = out.screened[0];
  assertEquals(rest, { ...before, desk_feature: DASH, desk_rows_feature: DASH });
  const sets = await runScreenSets(
    deskScreen(tr),
    { records: { records: [v11, await deskRec(tr, 2)], packageId: 'p#' + 'a'.repeat(64), fileSha256: 'b'.repeat(64) } },
    deskCtx(),
    { decisionId: 'd', rulesSha256: 'c'.repeat(64), noLive: false, noPages: false },
  );
  assertEquals(sets.summary.reports.desk_spelling.screened, { records: 2, rewritten: 1 });
  // Only a screen that has an alias map declares rewrites.
  assertEquals(deskScreen(tr).projectRewrites, ['desk_feature', 'desk_rows_feature']);
  assertEquals(screenWith().projectRewrites, undefined);
  for (const d of DESKS.filter((x) => x.name !== 'transfers')) assertEquals(deskScreen(d).projectRewrites, undefined);
});

Deno.test('spelling: nothing but the two fields changes, and the input record is not touched', async () => {
  const tr = deskNamed('transfers');
  const s = deskScreen(tr);
  const v11 = await deskRec(tr, 1, { desk_feature: HYPHEN, desk_rows_feature: HYPHEN });
  const before = structuredClone(v11);
  // The basis needs the completeness check to have run; do that through the whole-set check.
  await s.checks.find((c) => c.name === 'completeness_basis')!.all!([v11], deskCtx());
  const done = s.project!(v11);
  assertEquals(v11, before);
  assertEquals(done, { ...before, desk_feature: DASH, desk_rows_feature: DASH, completeness_basis: 'page_check' });
  // Either field alone is rewritten alone.
  const one = await deskRec(tr, 2, { desk_feature: HYPHEN });
  await s.checks.find((c) => c.name === 'completeness_basis')!.all!([one], deskCtx());
  assertEquals(s.project!(one).desk_feature, DASH);
  assertEquals(s.project!(one).desk_rows_feature, DASH);
});

Deno.test('spelling: a dash record is untouched; any other spelling, on this desk or another, is bad_shape', async () => {
  const tr = deskNamed('transfers'), bud = deskNamed('budget');
  const dash = await deskRec(tr, 1);
  assertEquals(dash.desk_feature, DASH);
  const out = await deskRun(tr, [
    await deskRec(tr, 2, { desk_feature: 'Bureaucratic Transfers - AGMUT cadre' }),
    await deskRec(tr, 3, { desk_rows_feature: 'Transfers' }),
    await deskRec(tr, 4, { desk_feature: HYPHEN.replace('-', '\u2013') }),
  ]);
  for (const n of [2, 3, 4]) assertEquals(reasonsOf(out, key(n)), ['bad_shape'], String(n));
  // The hyphen spelling is the Transfers desk's only: other desks name no alias.
  const b = await deskRun(bud, [await deskRec(bud, 5, { desk_feature: HYPHEN, desk_rows_feature: HYPHEN })]);
  assertEquals(reasonsOf(b, key(5)), ['bad_shape']);
});

Deno.test('spelling: the report counts the records it rewrote, screened ones only, and a desk with no alias has no such report', async () => {
  const tr = deskNamed('transfers');
  const s = deskScreen(tr);
  assertEquals(s.reports?.map((r) => r.name), ['identifier_shapes', 'desk_spelling']);
  const rep = s.reports!.find((r) => r.name === 'desk_spelling')!;
  const hy = await deskRec(tr, 1, { desk_feature: HYPHEN, desk_rows_feature: HYPHEN });
  const hy1 = await deskRec(tr, 2, { desk_rows_feature: HYPHEN });
  const da = await deskRec(tr, 3);
  const total = (rec: Rec, outcome: 'screened' | 'held') =>
    rep.one(rec, deskCtx(), outcome) as Array<{ group: string; counts: Record<string, number> }>;
  assertEquals(total(hy, 'screened'), [{ group: 'screened', counts: { records: 1, rewritten: 1 } }]);
  assertEquals(total(hy1, 'screened'), [{ group: 'screened', counts: { records: 1, rewritten: 1 } }]);
  assertEquals(total(da, 'screened'), [{ group: 'screened', counts: { records: 1, rewritten: 0 } }]);
  assertEquals(total(hy, 'held'), [{ group: 'held', counts: { records: 1, rewritten: 0 } }]);
  assertEquals(deskScreen(deskNamed('budget')).reports?.map((r) => r.name), ['identifier_shapes']);
  assertEquals(screenWith().reports?.map((r) => r.name), ['identifier_shapes']);
});

// ---- the rules hash and the seams ----

Deno.test("rules files: a desk hashes its own configuration file in place of Regulatory's, every file exists", async () => {
  for (const d of DESKS) {
    const files = deskScreen(d).rulesFiles;
    assert(files.includes(`scripts/bulk-runner/screens/${d.file}`), d.name);
    assert(!files.includes('scripts/bulk-runner/screens/regulatory.json'), d.name);
    assertEquals(files.length, screenWith().rulesFiles.length, d.name);
    for (const f of files) assert((await Deno.stat(new URL(`../../../${f}`, import.meta.url))).isFile, f);
  }
  assertThrows(
    () => makeSearchOnlyScreen(REGULATORY, fakePage().check, { configFile: 'x' }),
    Error,
    'configFile',
  );
});

Deno.test('publisher: the screen asks the resolver it is given, and holds a record it cannot name', async () => {
  const bud = deskNamed('budget');
  const mute = makeSearchOnlyScreen(BUDGET, fakePage().check, { publisher: () => '' });
  const out = await runScreen(mute, [await deskRec(bud, 1)], deskCtx(), opts());
  assertEquals(reasonsOf(out, key(1)), ['publisher_unresolved']);
  const asked: unknown[][] = [];
  const spy = makeSearchOnlyScreen(BUDGET, fakePage().check, {
    publisher: (...a) => (asked.push(a), 'P'),
  });
  await runScreen(spy, [await deskRec(bud, 2)], deskCtx(), opts());
  assertEquals(asked[0][0], 'national');
  assertEquals(asked[0][1], 'Budget Utilisation & Schemes');
});

Deno.test('desks: the real prepare step accepts a good record of every desk the adapter already names', async () => {
  const named: string[] = NATIONAL_SEARCH_ONLY.map((x) => x.feature);
  let asked = 0;
  for (const d of DESKS) {
    if (!named.includes(d.cfg.desk_feature as string)) continue;
    asked++;
    const out = await runScreen(deskScreen(d, {}, fakePage(), true), [await deskRec(d, 1)], deskCtx(), opts());
    assertEquals(out.holds, [], d.name);
  }
  // The prepare probe sees the record as the runner will: with the one spelling. (Observable once the adapter names Transfers.)
  const tr = deskNamed('transfers');
  if (named.includes(tr.cfg.desk_feature as string)) {
    const v11 = await deskRec(tr, 3, { desk_feature: HYPHEN, desk_rows_feature: HYPHEN });
    const out = await runScreen(deskScreen(tr, {}, fakePage(), true), [v11], deskCtx(), opts());
    assert(!reasonsOf(out, key(3)).includes('prepare_failed'), JSON.stringify(reasonsOf(out, key(3))));
  }
  // Until suppliedText.ts names a desk, its records are held by prepare itself: the sign that task 2 is still to do.
  if (asked < DESKS.length) {
    const d = DESKS.find((x) => !named.includes(x.cfg.desk_feature as string))!;
    const out = await runScreen(deskScreen(d, {}, fakePage(), true), [await deskRec(d, 2)], deskCtx(), opts());
    assertEquals(reasonsOf(out, key(2)), ['prepare_failed']);
  }
});

Deno.test('registration: the five desks are registered under their collections, built without the network, each with its own file in the rules', async () => {
  const { SCREENS, screenUsesPrepare } = await import('./index.ts');
  const real = globalThis.fetch;
  let touched = 0;
  globalThis.fetch = (() => (touched++, Promise.reject(new Error('network touched')))) as typeof fetch;
  try {
    for (const d of DESKS) {
      const s = await SCREENS[d.collection]();
      assertEquals([s.collection, s.listingRows, s.usesPrepare], [d.collection, 'none', true], d.name);
      assert(s.rulesFiles.includes(`scripts/bulk-runner/screens/${d.file}`), d.name);
      assert(s.rulesFiles.includes('scripts/bulk-runner/screens/index.ts'), d.name);
      assertEquals(await screenUsesPrepare(d.collection), true, d.name);
    }
    assertEquals(touched, 0);
  } finally {
    globalThis.fetch = real;
  }
});

Deno.test('publisher: through the real resolver each desk holds a record none of whose hosts it can name', async () => {
  for (const d of DESKS) {
    const host = 'example.org';
    const cfg = { source_hosts: [...(d.cfg.source_hosts as string[]), host] };
    const out = await deskRun(d, [await deskRec(d, 1, { source_host: host, file_url: undefined })], cfg);
    assertEquals(reasonsOf(out, key(1)), ['publisher_unresolved'], d.name);
    // and the same record with a host of the desk is named, so the hold is the resolver's
    assertEquals((await deskRun(d, [await deskRec(d, 2)])).holds, [], d.name);
  }
});
