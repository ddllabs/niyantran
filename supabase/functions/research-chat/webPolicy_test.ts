import { assertEquals } from 'jsr:@std/assert@1';
import type { WebPage } from '../_shared/webSearch.ts';
import { checkLinks, decideWebSearch, webModelAllowed, type WebScope, webSourcesOf } from './webPolicy.ts';

const scope = (over: Partial<WebScope>): WebScope => ({
  focus: 'attached',
  records: [],
  documentAttached: false,
  moduleHasDocuments: null,
  ...over,
});
const decide = (
  s: Partial<WebScope>,
  extra: { override?: boolean | null; conversational?: boolean; modelAllowed?: boolean } = {},
) =>
  decideWebSearch({
    scope: scope(s),
    override: extra.override ?? null,
    conversational: extra.conversational ?? false,
    modelAllowed: extra.modelAllowed ?? true,
  });

// ---- decideWebSearch: the automatic table (spec section 1) ----

Deno.test('attached: a record without a document key turns web search on', () => {
  assertEquals(decide({ focus: 'attached', records: [{ key: null, indexed: false }] }), {
    offered: true,
    mode: 'auto',
    reason: 'record-without-document',
  });
});

Deno.test('attached: a key that resolves to no indexed document turns it on', () => {
  assertEquals(decide({ focus: 'attached', records: [{ key: 'bill:2026:1', indexed: false }] }).reason, 'record-without-document');
});

Deno.test('attached: one record without a document is enough, even beside an indexed one', () => {
  const d = decide({
    focus: 'attached',
    records: [{ key: 'bill:2026:1', indexed: true }, { key: null, indexed: false }],
  });
  assertEquals([d.offered, d.reason], [true, 'record-without-document']);
});

Deno.test('attached: records that are all indexed leave it off', () => {
  assertEquals(decide({ focus: 'attached', records: [{ key: 'bill:2026:1', indexed: true }] }), {
    offered: false,
    mode: 'auto',
    reason: 'documents-in-scope',
  });
});

Deno.test('attached: an "Ask about this document" chip alone leaves it off', () => {
  assertEquals(decide({ focus: 'attached', documentAttached: true }), {
    offered: false,
    mode: 'auto',
    reason: 'documents-in-scope',
  });
});

Deno.test('attached: only uploaded files, or nothing at all, is no-record and off', () => {
  assertEquals(decide({ focus: 'attached', records: [] }), { offered: false, mode: 'auto', reason: 'no-record' });
});

Deno.test('selection follows the same rule as attached', () => {
  assertEquals(decide({ focus: 'selection', records: [{ key: null, indexed: false }] }).reason, 'record-without-document');
  assertEquals(decide({ focus: 'selection', records: [{ key: 'bill:2026:1', indexed: true }] }).reason, 'documents-in-scope');
  assertEquals(decide({ focus: 'selection', records: [] }).reason, 'no-record');
});

Deno.test('desk: a module that is not among document_modules() turns it on', () => {
  assertEquals(decide({ focus: 'desk', moduleHasDocuments: false }), {
    offered: true,
    mode: 'auto',
    reason: 'module-without-documents',
  });
});

Deno.test('desk: a module with documents leaves it off; no open module is no-record', () => {
  assertEquals(decide({ focus: 'desk', moduleHasDocuments: true }), {
    offered: false,
    mode: 'auto',
    reason: 'documents-in-scope',
  });
  assertEquals(decide({ focus: 'desk', moduleHasDocuments: null }), { offered: false, mode: 'auto', reason: 'no-record' });
});

Deno.test('broad is never automatic, whatever else is in scope', () => {
  assertEquals(
    decide({ focus: 'broad', records: [{ key: null, indexed: false }], moduleHasDocuments: false }),
    { offered: false, mode: 'auto', reason: 'broad' },
  );
});

Deno.test('desk and broad ignore stray record data, and attached ignores the module flag', () => {
  assertEquals(decide({ focus: 'desk', moduleHasDocuments: true, records: [{ key: null, indexed: false }] }).reason, 'documents-in-scope');
  assertEquals(decide({ focus: 'attached', moduleHasDocuments: false, records: [] }).reason, 'no-record');
});

// ---- overrides and gates ----

Deno.test('override true turns it on in every focus, and override false turns it off', () => {
  for (const focus of ['attached', 'selection', 'desk', 'broad'] as const) {
    assertEquals(decide({ focus, records: [{ key: 'bill:2026:1', indexed: true }] }, { override: true }), {
      offered: true,
      mode: 'on',
      reason: 'override-on',
    });
    assertEquals(decide({ focus, records: [{ key: null, indexed: false }], moduleHasDocuments: false }, { override: false }), {
      offered: false,
      mode: 'off',
      reason: 'override-off',
    });
  }
});

Deno.test('a conversational turn is never offered web search, override or not', () => {
  for (const override of [null, true, false]) {
    const d = decide({ focus: 'attached', records: [{ key: null, indexed: false }] }, { override, conversational: true });
    assertEquals([d.offered, d.reason], [false, 'conversational']);
    assertEquals(d.mode, override === true ? 'on' : override === false ? 'off' : 'auto');
  }
});

Deno.test('conversational beats the model gate and override-off', () => {
  assertEquals(
    decide({ focus: 'broad' }, { override: false, conversational: true, modelAllowed: false }).reason,
    'conversational',
  );
});

Deno.test('a gated-out model withholds web search when it is wanted, automatic or forced', () => {
  const auto = decide({ focus: 'attached', records: [{ key: null, indexed: false }] }, { modelAllowed: false });
  assertEquals(auto, { offered: false, mode: 'auto', reason: 'model-unsupported' });
  const forced = decide({ focus: 'broad' }, { override: true, modelAllowed: false });
  assertEquals(forced, { offered: false, mode: 'on', reason: 'model-unsupported' });
});

Deno.test('a gated-out model that was not wanted keeps the ordinary reason', () => {
  assertEquals(
    decide({ focus: 'attached', records: [{ key: 'bill:2026:1', indexed: true }] }, { modelAllowed: false }).reason,
    'documents-in-scope',
  );
  assertEquals(decide({ focus: 'broad' }, { modelAllowed: false }).reason, 'broad');
  assertEquals(decide({ focus: 'broad' }, { override: false, modelAllowed: false }).reason, 'override-off');
});

// ---- webModelAllowed ----

Deno.test('webModelAllowed refuses :free models and models whose params turn web search off', () => {
  assertEquals(webModelAllowed('google/gemini-3.8-flash'), true);
  assertEquals(webModelAllowed('google/gemma-4:free'), false);
  assertEquals(webModelAllowed('Vendor/Model:FREE'), false);
  assertEquals(webModelAllowed('vendor/free-model'), true);
  assertEquals(webModelAllowed('vendor/model', { web_search: false }), false);
  assertEquals(webModelAllowed('vendor/model', { web_search: true }), true);
  assertEquals(webModelAllowed('vendor/model', {}), true);
  assertEquals(webModelAllowed('vendor/model', null), true);
  assertEquals(webModelAllowed('vendor/model', 'web_search=false'), true);
});

// ---- checkLinks ----

const GOOD = 'https://www.rbi.org.in/press/2026';
const check = (text: string, allowed: string[] = [GOOD], options?: { scanCode?: boolean }) => checkLinks(text, allowed, options);

Deno.test('checkLinks keeps a link to a page that was searched, and nothing changes', () => {
  const text = `The repo rate held ([RBI](${GOOD})).`;
  assertEquals(check(text), { text, removed: 0 });
});

Deno.test('checkLinks matches on the normalised URL: host case and a title', () => {
  const text = `See [RBI](HTTPS://WWW.RBI.ORG.IN/press/2026 "Press release").`;
  assertEquals(check(text), { text, removed: 0 });
});

// Security pass M2: a fragment never reaches the server, so it can carry the reader's data to a
// searched page's own script. The page is allowed; a link to it with a fragment is not.
Deno.test('checkLinks removes a link with a fragment, even to a searched page', () => {
  assertEquals(check(`See [RBI](${GOOD}#d=SECRET).`), { text: 'See RBI.', removed: 1 });
  assertEquals(check('See [RBI](HTTPS://WWW.RBI.ORG.IN:443/press/2026#x).'), { text: 'See RBI.', removed: 1 });
  assertEquals(check(`See [RBI](${GOOD}#).`), { text: 'See RBI.', removed: 1 });
});

// Security pass M1: the chat client links with its own lazy pattern (AiMarkdown), not CommonMark.
// Whatever that pattern would render as a link must also have passed the check.
const CLIENT_LINK = /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
Deno.test('checkLinks leaves nothing the chat client would render as a link to an unsearched page', () => {
  const payloads = [
    '[a]](https://evil.example/x)',
    '[a] ](https://evil.example/x)',
    '\\[a](https://evil.example/x)',
    '[a\\](https://evil.example/x)',
    '[a](https://evil.example/x(1)',
    'x [a]]](https://evil.example/x) y',
    '**[a](https://evil.example/x)**',
  ];
  for (const payload of payloads) {
    const { text, removed } = check(payload, [GOOD], { scanCode: true });
    const rendered = [...text.matchAll(CLIENT_LINK)].map((m) => m[2]);
    assertEquals(rendered, [], `${payload} -> ${text}`);
    assertEquals(removed > 0, true, payload);
  }
  // An allowed link the client renders is untouched.
  assertEquals(check(`[RBI](${GOOD})`, [GOOD], { scanCode: true }), { text: `[RBI](${GOOD})`, removed: 0 });
});

Deno.test('checkLinks keeps the text and drops the URL of a link that was not searched', () => {
  assertEquals(check('See [the circular](https://evil.example/x) now.'), { text: 'See the circular now.', removed: 1 });
});

Deno.test('checkLinks counts every removed link and keeps the allowed ones', () => {
  const out = check(`[a](https://one.example/) and [b](${GOOD}) and [c](https://two.example/)`);
  assertEquals(out, { text: `a and [b](${GOOD}) and c`, removed: 2 });
});

Deno.test('checkLinks removes javascript: and data: links even when listed as allowed', () => {
  const out = checkLinks(
    '[x](javascript:alert(1)) [y](data:text/html;base64,AAA) [z](JavaScript:void(0)) [w](vbscript:x)',
    ['javascript:alert(1)', 'data:text/html;base64,AAA', 'JavaScript:void(0)'],
  );
  assertEquals(out, { text: 'x y z w', removed: 4 });
});

Deno.test('checkLinks removes relative, mailto and empty destinations', () => {
  assertEquals(check('[a](/internal) [b](mailto:x@y.z) [c]() [d](#frag)'), { text: 'a b c d', removed: 4 });
});

Deno.test('checkLinks treats a userinfo lookalike as a different page', () => {
  const out = checkLinks('[go](https://www.rbi.org.in@evil.example/press/2026)', [GOOD]);
  assertEquals(out, { text: 'go', removed: 1 });
});

Deno.test('checkLinks treats a subdomain or path lookalike as a different page', () => {
  assertEquals(check('[a](https://www.rbi.org.in.evil.example/press/2026)').removed, 1);
  assertEquals(check('[a](https://www.rbi.org.in/press/2026/extra)').removed, 1);
});

Deno.test('checkLinks never touches citation markers', () => {
  const text = 'Introduced in 2025 [1] and passed [1, 2]. See [3] and [4,5], then [12].';
  assertEquals(check(text), { text, removed: 0 });
});

Deno.test('checkLinks handles an angle-bracket destination and a destination with parentheses', () => {
  assertEquals(check('[a](<https://evil.example/a b>)'), { text: 'a', removed: 1 });
  const wiki = 'https://en.wikipedia.org/wiki/Rupee_(currency)';
  const kept = `[Rupee](${wiki})`;
  assertEquals(checkLinks(kept, [wiki]), { text: kept, removed: 0 });
  assertEquals(checkLinks('[Rupee](https://en.wikipedia.org/wiki/Rupee_(currency)) ok', []), { text: 'Rupee ok', removed: 1 });
});

Deno.test('checkLinks turns a disallowed image into its alt text and keeps an allowed one', () => {
  assertEquals(check('![a chart](https://evil.example/c.png) after'), { text: 'a chart after', removed: 1 });
  const ok = `![chart](${GOOD})`;
  assertEquals(check(ok), { text: ok, removed: 0 });
});

Deno.test('checkLinks leaves links in inline code and fenced code alone by default', () => {
  const text = 'Use `[x](https://evil.example/a)` literally.\n\n```md\n[y](https://evil.example/b)\n```\n\n~~~\n[z](https://evil.example/c)\n~~~\n';
  assertEquals(check(text), { text, removed: 0 });
});

Deno.test('checkLinks resumes after a fenced block and after an inline code span', () => {
  const out = check('`code` then [a](https://evil.example/a)\n```\n[b](https://evil.example/b)\n```\n[c](https://evil.example/c)');
  assertEquals(out, { text: '`code` then a\n```\n[b](https://evil.example/b)\n```\nc', removed: 2 });
});

Deno.test('checkLinks: a longer fence is closed only by an equal or longer fence of the same kind', () => {
  const text = '````\n```\n[a](https://evil.example/a)\n```\n````\n[b](https://evil.example/b)';
  assertEquals(check(text), { text: '````\n```\n[a](https://evil.example/a)\n```\n````\nb', removed: 1 });
});

Deno.test('checkLinks: an unclosed fence runs to the end, an unmatched backtick is plain text', () => {
  assertEquals(check('```\n[a](https://evil.example/a)'), { text: '```\n[a](https://evil.example/a)', removed: 0 });
  assertEquals(check('a ` stray [b](https://evil.example/b)'), { text: 'a ` stray b', removed: 1 });
});

Deno.test('checkLinks scanCode: true also checks links inside code (the client renders them)', () => {
  const text = 'x `[x](https://evil.example/a)` y\n```\n[y](https://evil.example/b)\n```\n';
  assertEquals(check(text, [GOOD], { scanCode: true }), { text: 'x `x` y\n```\ny\n```\n', removed: 2 });
});

Deno.test('checkLinks removes a nested disallowed link inside the text of another link', () => {
  const out = check(`[see [inner](https://evil.example/i) here](${GOOD})`);
  assertEquals(out, { text: `[see inner here](${GOOD})`, removed: 1 });
});

Deno.test('checkLinks ignores malformed links and text with no links', () => {
  for (const text of ['a [b] (https://evil.example) c', '[a](https://evil.example foo bar)', '[unclosed(https://evil.example)', 'plain', '']) {
    assertEquals(check(text), { text, removed: 0 });
  }
});

Deno.test('checkLinks honours an escaped bracket and a list of allowed URLs given as any iterable', () => {
  assertEquals(check('\\[a](https://evil.example)'), { text: '\\[a](https://evil.example)', removed: 0 });
  assertEquals(checkLinks(`[a](${GOOD})`, new Set([GOOD])), { text: `[a](${GOOD})`, removed: 0 });
  assertEquals(checkLinks(`[a](${GOOD})`, []), { text: 'a', removed: 1 });
});

Deno.test('checkLinks: an escaped backtick does not open a code span that would hide a link', () => {
  assertEquals(check('\\`[a](https://evil.example/a)\\`'), { text: '\\`a\\`', removed: 1 });
});

Deno.test('checkLinks stays fast and does not throw on pathological input', () => {
  const started = performance.now();
  checkLinks('['.repeat(60_000), [GOOD]);
  checkLinks('[a]('.repeat(15_000), [GOOD]);
  checkLinks('`'.repeat(30_000) + '[a](https://evil.example)', [GOOD]);
  const deep = checkLinks('[x '.repeat(2_000) + '[leaf](https://evil.example/leaf)' + `](${GOOD})`.repeat(2_000), [GOOD]);
  assertEquals(deep.text.includes('[leaf](https://evil.example/leaf)'), false);
  assertEquals(performance.now() - started < 3_000, true);
});

Deno.test('checkLinks removes a destination too long to be a real URL', () => {
  const long = `https://evil.example/${'a'.repeat(9_000)}`;
  const out = checkLinks(`before [a](${long}) after`, [GOOD]);
  assertEquals(out.removed, 1);
  assertEquals(out.text.includes('[a]('), false);
});

// ---- webSourcesOf ----

const page = (url: string, title = url): WebPage => ({ url, title, excerpt: 'x' });

Deno.test('webSourcesOf lists every page with its domain, uncited when the answer links to none', () => {
  const out = webSourcesOf([page('https://www.rbi.org.in/a', 'RBI A'), page('https://example.com/b', 'B')], 'No links here.');
  assertEquals(out, [
    { url: 'https://www.rbi.org.in/a', title: 'RBI A', domain: 'rbi.org.in', cited: false },
    { url: 'https://example.com/b', title: 'B', domain: 'example.com', cited: false },
  ]);
});

Deno.test('webSourcesOf puts cited pages first, in order of first appearance in the answer', () => {
  const pages = [page('https://a.example/1'), page('https://b.example/2'), page('https://c.example/3'), page('https://d.example/4')];
  const answer = 'First [c](https://c.example/3), then [b](https://b.example/2), then [c again](https://c.example/3#x).';
  assertEquals(webSourcesOf(pages, answer).map((s) => [s.url, s.cited]), [
    ['https://c.example/3', true],
    ['https://b.example/2', true],
    ['https://a.example/1', false],
    ['https://d.example/4', false],
  ]);
});

Deno.test('webSourcesOf: only a markdown link cites; a bare URL, a marker or a code span does not', () => {
  const pages = [page('https://a.example/1'), page('https://b.example/2'), page('https://c.example/3')];
  const answer = 'See https://a.example/1 and [1]. Code: `[x](https://b.example/2)`. Real: [c](https://c.example/3).';
  assertEquals(webSourcesOf(pages, answer).map((s) => [s.url, s.cited]), [
    ['https://c.example/3', true],
    ['https://a.example/1', false],
    ['https://b.example/2', false],
  ]);
});

Deno.test('webSourcesOf caps the title at 300 and the list at 20, keeping cited pages', () => {
  const pages = Array.from({ length: 30 }, (_, i) => page(`https://site${i}.example/p`, 't'.repeat(400)));
  const out = webSourcesOf(pages, '[last](https://site29.example/p)');
  assertEquals(out.length, 20);
  assertEquals(out[0], { url: 'https://site29.example/p', title: 't'.repeat(300), domain: 'site29.example', cited: true });
  assertEquals(out[1].url, 'https://site0.example/p');
});

Deno.test('webSourcesOf drops a page with an unusable URL and de-duplicates by normalised URL', () => {
  const out = webSourcesOf(
    [page('https://a.example/1#one'), page('https://a.example/1#two'), page('javascript:alert(1)'), page('')],
    '',
  );
  assertEquals(out.map((s) => s.url), ['https://a.example/1']);
});

Deno.test('webSourcesOf falls back to the URL when a page has no title', () => {
  assertEquals(webSourcesOf([page('https://a.example/1', '  ')], '')[0].title, 'https://a.example/1');
});

Deno.test('F264 unknown record and revoked direct document never authorize automatic web', () => {
  assertEquals(decide({ records: [{ key: null, indexed: null }] }), { offered: false, mode: 'auto', reason: 'coverage-unknown' });
  assertEquals(decide({ documentUnknown: true }), { offered: false, mode: 'auto', reason: 'coverage-unknown' });
  assertEquals(decide({ records: [{ key: null, indexed: null }] }, { override: true }).offered, true);
  assertEquals(decide({ records: [{ key: null, indexed: false }] }, { override: false }).offered, false);
});
