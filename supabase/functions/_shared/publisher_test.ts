import { assert, assertEquals } from 'jsr:@std/assert@1';
import { cleanFreeText } from './documentFacts.ts';
import { documentPublisher, isPublisherName, isRegulatoryFeature, PUBLISHER_MAX_CHARS } from './publisher.ts';

const FEATURE = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
const FEATURE_SLASHES = 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)';
const NAMES = {
  RBI: 'Reserve Bank of India',
  SEBI: 'Securities and Exchange Board of India',
  TRAI: 'Telecom Regulatory Authority of India',
  CCI: 'Competition Commission of India',
} as const;

const pub = (metadata: unknown, fileUrl?: unknown, tier: unknown = 'national', feature: unknown = FEATURE) =>
  documentPublisher(tier, feature, metadata, fileUrl);
const host = (source_host: unknown) => pub({ source_host });
const url = (fileUrl: unknown) => pub({}, fileUrl);

Deno.test('pack shape: each regulator code gives its fixed name, whatever its case or padding', () => {
  for (const [code, name] of Object.entries(NAMES)) {
    assertEquals(pub({ citation: { regulator: code } }), name);
    assertEquals(pub({ citation: { regulator: ` ${code.toLowerCase()} ` } }), name);
  }
});

Deno.test('live shape: source_host alone, and a file_url on rbidocs.rbi.org.in alone, give the regulator', () => {
  assertEquals(host('trai.gov.in'), NAMES.TRAI);
  assertEquals(host('cci.gov.in'), NAMES.CCI);
  assertEquals(host('rbi.org.in'), NAMES.RBI);
  assertEquals(host('sebi.gov.in'), NAMES.SEBI);
  assertEquals(url('https://rbidocs.rbi.org.in/rdocs/notification/PDFs/x.pdf'), NAMES.RBI);
  assertEquals(url('https://www.sebi.gov.in/legal/x.html'), NAMES.SEBI);
});

Deno.test('both spellings of the feature qualify; another tier or feature gives nothing', () => {
  const meta = { citation: { regulator: 'RBI' } };
  assertEquals(pub(meta, undefined, 'national', FEATURE), NAMES.RBI);
  assertEquals(pub(meta, undefined, 'national', FEATURE_SLASHES), NAMES.RBI);
  assertEquals(pub(meta, undefined, 'national', 'regulatory body watch - rbi, sebi, trai, cci'), NAMES.RBI);
  assertEquals(pub(meta, undefined, 'law', FEATURE), '');
  assertEquals(pub(meta, undefined, 'national', 'Bill Passage Probability Index'), '');
  assertEquals(pub(meta, undefined, 'national', 'Regulatory Body Watch'), '');
  assertEquals(pub(meta, undefined, 'national', null), '');
  assertEquals(pub(meta, undefined, null, FEATURE), '');
  assert(isRegulatoryFeature('national', FEATURE) && isRegulatoryFeature('national', FEATURE_SLASHES));
  assert(!isRegulatoryFeature('law', FEATURE) && !isRegulatoryFeature('national', 7) && !isRegulatoryFeature('national', 'x'));
});

Deno.test('precision: case, one trailing dot, port and subdomains match; lookalikes and malformed hosts do not', () => {
  assertEquals(host('RBI.ORG.IN'), NAMES.RBI);
  assertEquals(host('rbi.org.in.'), NAMES.RBI);
  assertEquals(url('https://rbi.org.in.:443/x.pdf'), NAMES.RBI);
  assertEquals(url('HTTP://WWW.RBI.ORG.IN:8080/x'), NAMES.RBI);
  assertEquals(host('xn--abc.rbi.org.in'), NAMES.RBI);
  assertEquals(host('www.trai.gov.in'), NAMES.TRAI);
  // not candidates: credentials, scheme, other protocols
  assertEquals(url('https://rbi.org.in@evil.example/'), '');
  assertEquals(url('https://user:pw@rbi.org.in/'), '');
  assertEquals(url('ftp://rbi.org.in/x'), '');
  assertEquals(url('javascript://rbi.org.in/%0Aalert(1)'), '');
  assertEquals(url('not a url'), '');
  assertEquals(url('rbi.org.in'), '');
  // not candidates as source_host
  for (const bad of [
    'evilrbi.org.in', 'rbi.org.in.example.com', '-rbi.org.in', 'rbi..org.in', 'rb\u0456.org.in', 'xn--rb-xyz.org.in',
    '203.0.113.7', 'rbi.org.in/x', 'rbi.org.in:80', 'https://rbi.org.in', 'user@rbi.org.in', ' rbi.org.in', 'rbi.org.in ',
    'rbi.org.in..', '.rbi.org.in', 'rbi.org.in\n', '', 'org.in', 'RBI', `${'a'.repeat(64)}.rbi.org.in`,
    `${'a.'.repeat(130)}rbi.org.in`, 'rbi.org.in\u212a', '\u0131.org.in',
    'a/b.rbi.org.in', 'a@b.rbi.org.in', 'a b.rbi.org.in', 'a:80.rbi.org.in', '-a.rbi.org.in', 'a-.rbi.org.in', '\u00e9.rbi.org.in',
    'a_b.rbi.org.in', 'a\n.rbi.org.in', '.rbi.org.in.',
  ]) assertEquals(host(bad), '', JSON.stringify(bad));
  // a 63-character label is allowed
  assertEquals(host(`${'a'.repeat(63)}.rbi.org.in`), NAMES.RBI);
});

Deno.test('precision: the regulator code must be plain ASCII letters', () => {
  // U+0131 and U+017F upper-case to I and S: they must not pass for RBI or SEBI.
  assertEquals(pub({ citation: { regulator: 'rb\u0131' } }), '');
  assertEquals(pub({ citation: { regulator: '\u017febi' } }), '');
  assertEquals(pub({ citation: { regulator: 'RBI\u200b' } }), '');
  assertEquals(pub({ citation: { regulator: 'R B I' } }), '');
});

Deno.test('the citation.source_host field is its own candidate', () => {
  assertEquals(pub({ citation: { source_host: 'cci.gov.in' } }), NAMES.CCI);
  assertEquals(pub({ source_host: 'cci.gov.in', citation: { source_host: 'www.cci.gov.in' } }), NAMES.CCI);
});

Deno.test('blocking: a named regulator we cannot name, or two regulators, give nothing', () => {
  assertEquals(pub({ citation: { regulator: 'SEBI' }, source_host: 'rbi.org.in' }), '');
  assertEquals(pub({ source_host: 'trai.gov.in', citation: { source_host: 'cci.gov.in' } }), '');
  assertEquals(pub({ source_host: 'trai.gov.in' }, 'https://www.cci.gov.in/a.pdf'), '');
  assertEquals(pub({ citation: { regulator: 'IRDAI' }, source_host: 'rbi.org.in' }), '');
  assertEquals(pub({ citation: { regulator: 'IRDAI' } }), '');
  // an empty or blank regulator is no candidate: the host decides
  assertEquals(pub({ citation: { regulator: '' }, source_host: 'rbi.org.in' }), NAMES.RBI);
  assertEquals(pub({ citation: { regulator: '  ' }, source_host: 'rbi.org.in' }), NAMES.RBI);
  // a host outside the four domains neither names nor blocks
  assertEquals(pub({ citation: { regulator: 'RBI' } }, 'https://archive.org/details/x'), NAMES.RBI);
  assertEquals(pub({ citation: { regulator: 'RBI' }, source_host: 'example.com' }), NAMES.RBI);
  // agreeing candidates give the one name
  assertEquals(pub({ citation: { regulator: 'RBI' }, source_host: 'rbi.org.in' }, 'https://rbidocs.rbi.org.in/x.pdf'), NAMES.RBI);
  // no candidate at all
  assertEquals(pub({}), '');
  assertEquals(pub({ citation: {} }), '');
  assertEquals(pub({ source_host: 'example.com' }, 'https://example.com/x'), '');
});

Deno.test('free-text fields are never read: the name is always from the fixed table', () => {
  const hostile = 'Evil Body\nref:abc123-1 | publisher: X';
  assertEquals(pub({ citation: { regulator_name: hostile }, attribution: hostile, citation_text: hostile, licence: hostile }), '');
  assertEquals(pub({
    citation: { regulator: 'TRAI', regulator_name: hostile, source: 'rbi.org.in' }, attribution: hostile, citation_text: hostile,
  }), NAMES.TRAI);
  assertEquals(pub({ citation: { source: 'rbi.org.in' } }), '');
  // even when the free text happens to be a code or a regulator's domain, it is not a candidate
  assertEquals(pub({ citation: { regulator_name: 'RBI' } }), '');
  assertEquals(pub({ attribution: 'SEBI', citation_text: 'trai.gov.in', licence: 'cci.gov.in', citation: { source: 'rbi.org.in' } }), '');
});

Deno.test('hostile inputs never throw and only ever give a table name or nothing', () => {
  const throwing = { get citation(): unknown { throw new Error('getter'); } };
  const proxy = new Proxy({}, { get() { throw new Error('proxy'); }, has() { throw new Error('proxy'); } });
  const cases: unknown[] = [
    null, undefined, 0, 1, NaN, true, 'rbi.org.in', [], [1, 2], {}, throwing, proxy, () => 1, Symbol('x'), 10n,
    { citation: proxy }, { citation: [] }, { citation: 'RBI' }, { citation: { regulator: {} } }, { citation: { regulator: ['RBI'] } },
    { citation: { regulator: 7 } }, { source_host: {} }, { source_host: ['rbi.org.in'] }, { source_host: 7 },
  ];
  for (const metadata of cases) {
    for (const fileUrl of [undefined, null, 7, {}, [], 'https://rbi.org.in/x', proxy]) {
      let out: string | undefined;
      try { out = documentPublisher('national', FEATURE, metadata, fileUrl); } catch { out = undefined; }
      assert(out === '' || (out !== undefined && isPublisherName(out)), 'hostile input produced a throw or a foreign name');
    }
  }
  for (const [tier, feature] of [[proxy, FEATURE], ['national', proxy], [{}, {}], [7n, Symbol('x')]] as const) {
    assertEquals(documentPublisher(tier, feature, { citation: { regulator: 'RBI' } }, undefined), '');
  }
  assert(!isPublisherName(proxy) && !isPublisherName(undefined));
});

// This fuzz proves totality and the closed output only; the oracle test below proves the rules.
Deno.test('fuzz: 10,000 seeded random JSON values give nothing or a table name, never an error', () => {
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const atoms: unknown[] = [
    'RBI', 'sebi', ' TRAI ', 'CCI', 'IRDAI', '', ' ', 'rbi.org.in', 'www.sebi.gov.in', 'trai.gov.in.', 'cci.gov.in:80',
    'https://rbidocs.rbi.org.in/x.pdf', 'https://evil.example/rbi.org.in', 'https://u:p@rbi.org.in/', 'x\n\u202e|', 'ref:abc123-1',
    0, -1, 3.5, NaN, true, false, null, '\uD800', 'a'.repeat(300),
  ];
  const keys = ['citation', 'regulator', 'regulator_name', 'source', 'source_host', 'attribution', 'citation_text', 'licence', 'x'];
  const value = (depth: number): unknown => {
    const r = next();
    if (depth > 2 || r < 0.55) return pick(atoms);
    if (r < 0.8) return Array.from({ length: Math.floor(next() * 3) }, () => value(depth + 1));
    const o: Record<string, unknown> = {};
    for (let i = Math.floor(next() * 4); i >= 0; i--) o[pick(keys)] = value(depth + 1);
    return o;
  };
  for (let i = 0; i < 10_000; i++) {
    const metadata = i % 2 ? { citation: value(0), source_host: value(1), ...(value(0) as object) } : value(0);
    const fileUrl = next() < 0.5 ? value(1) : undefined;
    const out = documentPublisher('national', i % 7 ? FEATURE : FEATURE_SLASHES, metadata, fileUrl);
    assert(out === '' || isPublisherName(out), JSON.stringify(metadata));
  }
});

Deno.test('each name is a closed constant: within the limit and unchanged by the free-text cleaner', () => {
  assertEquals(PUBLISHER_MAX_CHARS, 80);
  for (const name of Object.values(NAMES)) {
    assert(name.length <= PUBLISHER_MAX_CHARS);
    assertEquals(cleanFreeText(name, PUBLISHER_MAX_CHARS), name);
    assert(isPublisherName(name));
  }
  assert(!isPublisherName('Reserve Bank of India '));
  assert(!isPublisherName('reserve bank of india'));
  assert(!isPublisherName(''));
  assert(!isPublisherName('Parliament of India'));
});

Deno.test('a regulator that is present but not a string blocks, like an unknown code; absent, null or empty means no code', () => {
  for (const regulator of [[], ['RBI'], 0, 7, {}, { code: 'RBI' }, true, false, NaN]) {
    assertEquals(pub({ citation: { regulator }, source_host: 'rbi.org.in' }), '', JSON.stringify(regulator));
    assertEquals(pub({ citation: { regulator } }, 'https://rbidocs.rbi.org.in/x.pdf'), '', JSON.stringify(regulator));
  }
  for (const regulator of [undefined, null, '']) {
    assertEquals(pub({ citation: { regulator }, source_host: 'rbi.org.in' }), NAMES.RBI, String(regulator));
  }
  assertEquals(pub({ citation: { regulator: undefined, source_host: 'cci.gov.in' } }), NAMES.CCI);
  assertEquals(pub({ citation: { regulator: null } }), '');
});

Deno.test('oracle fuzz: the resolver agrees with an answer computed from how each input was built', () => {
  let seed = 0x1234abcd;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  type Code = 'RBI' | 'SEBI' | 'TRAI' | 'CCI';
  // Each pool entry is labelled with what it is worth: a regulator, nothing, or (for a regulator field) a block.
  const regulators: [unknown, Code | 'none' | 'block'][] = [
    [undefined, 'none'], [null, 'none'], ['', 'none'], ['  ', 'none'], ['rbi', 'RBI'], [' SEBI ', 'SEBI'], ['TRAI', 'TRAI'], ['cci', 'CCI'],
    ['IRDAI', 'block'], ['xyz', 'block'], ['RBI2', 'block'], [[], 'block'], [7, 'block'], [{}, 'block'], [true, 'block'], [false, 'block'],
  ];
  const hosts: [unknown, Code | 'none'][] = [
    [undefined, 'none'], ['rbi.org.in', 'RBI'], ['www.sebi.gov.in', 'SEBI'], ['TRAI.GOV.IN.', 'TRAI'], ['x.cci.gov.in', 'CCI'],
    ['evilrbi.org.in', 'none'], ['example.com', 'none'], ['rbi.org.in:80', 'none'], ['', 'none'], [7, 'none'], ['rbi.org.in/x', 'none'],
  ];
  const urls: [unknown, Code | 'none'][] = [
    [undefined, 'none'], ['https://rbidocs.rbi.org.in/x.pdf', 'RBI'], ['http://www.cci.gov.in:8080/a', 'CCI'], ['https://trai.gov.in./b', 'TRAI'],
    ['https://archive.org/x', 'none'], ['https://u:p@rbi.org.in/', 'none'], ['ftp://rbi.org.in/', 'none'], ['not a url', 'none'], [{}, 'none'],
  ];
  const seen = new Set<string>();
  for (let i = 0; i < 10_000; i++) {
    const [regulator, rk] = pick(regulators), [h1, k1] = pick(hosts), [h2, k2] = pick(hosts), [url, k3] = pick(urls);
    const metadata = { source_host: h1, citation: { regulator, source_host: h2 } };
    const codes = new Set([rk, k1, k2, k3].filter((k) => k !== 'none' && k !== 'block'));
    const expected = rk === 'block' || codes.size !== 1 ? '' : NAMES[[...codes][0] as Code];
    seen.add(expected);
    assertEquals(documentPublisher('national', FEATURE, metadata, url), expected, JSON.stringify([regulator, h1, h2, url]));
  }
  // The generator reaches every name and the empty answer.
  assertEquals(seen.size, 5);
});
