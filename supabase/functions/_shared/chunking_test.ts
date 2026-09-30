import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import {
  blocks,
  CHUNK,
  chunkDocument,
  chunkHashInput,
  chunkPages,
  chunkUnit,
  estimateTokens,
  PAGE_CHUNK_VERSION,
  type PageChunkRow,
} from './chunking.ts';
import { composeDocument, type MistralBlock, type MistralPage } from './pageText.ts';
import { normalise, sha256Hex } from './textNormalise.ts';

// A short real OCR passage (2006-32-gaz, Gazette of India), kept as the
// exact-span fixture. OCR noise is part of the point.
const OCR = `EXTRAORDINARY :
wt T— Brel
PART I — Section 1
PUBLISHED BY AUTHORITY
MINISTRY OF LAW AND JUSTICE
(Legislative Department)
New Delhi, the 21st December, 2005/Agrahayana 30, 1927 (Saka)
The following Act of Parliament received the assent of the President on
the 20th December, 2005, and is hereby published for general information:—   `;
// (the trailing spaces above are deliberate: an exact span keeps them)

function sentence(i: number): string {
  return `Sentence number ${i} of the synthetic document states a fact about clause ${i % 7}.`;
}
function paragraphs(count: number, perPara = 6): string {
  const paras: string[] = [];
  let n = 0;
  for (let p = 0; p < count; p++) {
    const s: string[] = [];
    for (let k = 0; k < perPara; k++) s.push(sentence(n++));
    paras.push(s.join(' '));
  }
  return paras.join('\n\n');
}
function table(rows: number): string {
  const lines = ['| Page | Column | For | Read |', '|---|---|---|---|'];
  for (let r = 0; r < rows; r++) lines.push(`| ${r + 1} | 3 | "person ${r}" | "persons ${r}" |`);
  return lines.join('\n');
}

function assertExactSpans(text: string, spans: { charFrom: number; charTo: number; content: string }[]) {
  assert(spans.length > 0, 'expected at least one span');
  for (const s of spans) {
    assertEquals(s.content, text.slice(s.charFrom, s.charTo));
    assert(s.charTo > s.charFrom);
  }
}

Deno.test('one unit: spans of one unit never carry text of another', () => {
  const a = {
    unitKey: 'p1',
    text: 'A'.repeat(700) + ' ' + 'A'.repeat(699),
    sourceKind: 'pdf_page' as const,
    pageNumber: 1,
  };
  const b = {
    unitKey: 'p2',
    text: 'B'.repeat(700) + ' ' + 'B'.repeat(699),
    sourceKind: 'pdf_page' as const,
    pageNumber: 2,
  };
  const spans = [...chunkUnit(a), ...chunkUnit(b)];
  assert(spans.length >= 2);
  for (const s of spans) {
    const unit = s.unitKey === 'p1' ? a : b;
    assertEquals(s.pageNumber, unit.pageNumber);
    assert(s.charTo <= unit.text.length);
    assert(!s.content.includes(s.unitKey === 'p1' ? 'B' : 'A'));
  }
});

Deno.test('exact span on a real OCR passage and on a long synthetic document', async () => {
  assertExactSpans(OCR, await chunkDocument(OCR));
  const long = paragraphs(20);
  assert(long.length > 9000);
  assertExactSpans(long, await chunkDocument(long));
});

Deno.test('a table under tableAtomicMax is one span; a longer one splits at row boundaries', () => {
  const small = table(30);
  assert(small.length > 1000 && small.length < CHUNK.tableAtomicMax, `small table ${small.length}`);
  const doc1 = `${paragraphs(1)}\n\n${small}\n\n${paragraphs(1)}`;
  const spans1 = chunkUnit({ unitKey: 'document', text: doc1, sourceKind: 'document' });
  assertExactSpans(doc1, spans1);
  assert(spans1.some((s) => s.content.includes(small)), 'small table must be inside one span');

  const big = table(45);
  assert(big.length > CHUNK.tableAtomicMax);
  const spans2 = chunkUnit({ unitKey: 'document', text: big, sourceKind: 'document' });
  assert(spans2.length > 1);
  for (const s of spans2) {
    assert(s.content.startsWith('|'), 'row-aligned start');
    assert(s.content.endsWith('|'), 'row-aligned end');
  }
});

Deno.test('target and overlap on a paragraph-only document', () => {
  const doc = paragraphs(14);
  assert(doc.length > 5000);
  const spans = chunkUnit({ unitKey: 'document', text: doc, sourceKind: 'document' });
  assert(spans.length >= 5);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    assert(s.charTo - s.charFrom <= CHUNK.targetChars + CHUNK.overlapChars, `span ${i} too long`);
    if (i > 0) {
      assert(s.charFrom <= spans[i - 1].charTo, `span ${i} has no overlap`);
      assert(s.charFrom > spans[i - 1].charFrom, `span ${i} makes no progress`);
      assert(s.charFrom === 0 || /\s/.test(doc[s.charFrom - 1]), `span ${i} starts mid-word`);
    }
  }
});

Deno.test('a short trailing paragraph folds into the previous span', () => {
  const doc = `${paragraphs(2)}\n\nShort tail.`;
  const spans = chunkUnit({ unitKey: 'document', text: doc, sourceKind: 'document' });
  assert(spans[spans.length - 1].content.endsWith('Short tail.'));
  assert(spans[spans.length - 1].charTo - spans[spans.length - 1].charFrom >= CHUNK.minChars);
});

Deno.test('the chunker version participates in the hash', async () => {
  const doc = paragraphs(3);
  const v1 = (await chunkDocument(doc, { version: 1 })).map((r) => r.chunkHash);
  const v2 = (await chunkDocument(doc, { version: 2 })).map((r) => r.chunkHash);
  assertEquals(v1.length, v2.length);
  for (const h of v2) assert(!v1.includes(h));
  assertEquals(chunkHashInput(1, 'document', ' a  b '), '1|document|a b');
});

Deno.test('a whitespace-only change keeps every hash and moves the spans', async () => {
  // CRLF line endings: every span's offsets shift, no span boundary moves.
  const doc = paragraphs(3);
  const spaced = doc.replace(/\n/g, '\r\n');
  const a = await chunkDocument(doc);
  const b = await chunkDocument(spaced);
  assertEquals(a.map((r) => r.chunkHash), b.map((r) => r.chunkHash));
  assertNotEquals(a.map((r) => r.charTo), b.map((r) => r.charTo));
});

Deno.test('no span exceeds maxChars even without whitespace', () => {
  const doc = 'x'.repeat(20_000);
  const spans = chunkUnit({ unitKey: 'document', text: doc, sourceKind: 'document' });
  assert(spans.length >= 4);
  for (const s of spans) assert(s.charTo - s.charFrom <= CHUNK.maxChars);
  assertExactSpans(doc, spans);
});

Deno.test('empty and blank documents produce no chunks; tokens are estimated at four chars each', async () => {
  assertEquals(await chunkDocument(''), []);
  assertEquals(await chunkDocument('\n\n  \n'), []);
  assertEquals(estimateTokens('abcdefgh'), 2);
  assertEquals(estimateTokens('abcdefghi'), 3);
});

// F12: scanned tables leave bare '|' characters for the printed rules, so a
// line that merely starts with a pipe is OCR noise, not table structure. A
// table row starts and ends with a pipe and has at least one non-empty cell.
Deno.test('a real pipe table is a table block; stray pipe lines are paragraph text', () => {
  const table = '| Clause | Subject |\n|---|---|\n| 1 | Short title |';
  const tb = blocks(table);
  assertEquals(tb.length, 1);
  assertEquals(tb[0].kind, 'table');

  for (const noise of ['| THE SCHEDULE', '|', '| |', '|   |   |', '|the Bill shall come into force']) {
    const b = blocks(noise);
    assertEquals(b.length, 1, noise);
    assertEquals(b[0].kind, 'para', noise);
  }

  const mixed = 'Section 2 of the Act\n| amended as follows\n| (a) in clause (i)';
  const mb = blocks(mixed);
  assertEquals(mb.map((b) => b.kind), ['para']);
  assertEquals([mb[0].from, mb[0].to], [0, mixed.length]);
});

Deno.test('the table rule change bumps the chunker version so a re-ingest re-embeds', () => {
  assertEquals(CHUNK.version, 2);
});

// ─── Version 2 regression (chunk-contract spec R3.1) ────────────────────────
// SHA-256 of JSON.stringify(await chunkDocument(input)) for each input, recorded from the code before the
// page chunker was added (commit 54b5db6). Version 2 must stay byte-for-byte identical: a change here
// re-chunks and re-embeds all 2,338 existing documents on their next ingest.

const BILL_PAGES = (JSON.parse(
  await Deno.readTextFile(new URL('./__fixtures__/mistral-bill-12p.json', import.meta.url)),
) as { pages: MistralPage[] }).pages;
const BILL_TEXT = composeDocument(BILL_PAGES).ocrText;

const V2_REGRESSION: Array<[string, () => string, number, string]> = [
  ['real OCR passage', () => OCR, 1, '09b6cbf1786fcc455e0f8262d544d34eedac5483c0d113dc15e2b7702b514e6e'],
  ['20 paragraphs', () => paragraphs(20), 19, '6ddd8f44d908c42959d4f875982a1dac674cb7c9ededa9ee3b8657b8cedb4c3a'],
  [
    'small table between paragraphs',
    () => `${paragraphs(1)}\n\n${table(30)}\n\n${paragraphs(1)}`,
    3,
    'aed41de83720398df05c2d3fe041c171b1366049e520ed5afd1c1f6d32be45ec',
  ],
  ['big table', () => table(45), 3, '489443eed0a48346f3609705c31b0591c392ba75ac48d6c12a4e9d4ca0b6bc4b'],
  ['14 paragraphs', () => paragraphs(14), 13, '67aeb5e662444e23b372e4ed7bb954b90c1312e22c2678ec86e21ddfb9b5c7d2'],
  [
    'short tail',
    () => `${paragraphs(2)}\n\nShort tail.`,
    1,
    'e39ed22bdce456d9199d1980e1d3f978570f355e921d1728c3f11b2063666d4c',
  ],
  [
    'CRLF',
    () => paragraphs(3).replace(/\n/g, '\r\n'),
    2,
    '2fcea398f8e8348ebaa2ced3e39f5f5cbbc00bc588646f797dee3b740300285b',
  ],
  ['no whitespace', () => 'x'.repeat(20_000), 4, '07019fa24e3d7fff5d611b65c38d318b81baed05189c230be7cb24eb014d5d92'],
  [
    // Version 2 cuts inside this image token; placeholder atomicity must stay off for chunkDocument.
    'placeholder at the hard cut',
    () => 'x'.repeat(5995) + '![img:3-0](img:3-0)' + 'x'.repeat(200) + ' A link [see s. 5. Next](s5) here.',
    2,
    '9c6045c8f2ae2bc9d4f2d05ef40777b16e4e4d8cab475b261f656c05536feaeb',
  ],
  [
    'full text of the 12-page bill',
    () => BILL_TEXT,
    37,
    '7632c9f21250f68b201ce301eca0861fbef7b565f7bcde4087a1fe0042850865',
  ],
];

Deno.test('chunkDocument (version 2) output is byte-for-byte what it was before the page chunker', async () => {
  for (const [name, input, count, digest] of V2_REGRESSION) {
    const rows = await chunkDocument(input());
    assertEquals(rows.length, count, name);
    assertEquals(await sha256Hex(JSON.stringify(rows)), digest, name);
  }
});

// ─── Page chunker (chunk-contract spec R2–R5) ───────────────────────────────

const BILL_DOC = composeDocument(BILL_PAGES);
const BILL = await chunkPages({ document: BILL_DOC, pages: BILL_PAGES });
const onPage = (n: number) => BILL.rows.filter((r) => r.page_number === n);
/** The row of page n whose page-local span contains page-local offset `at`, first in order. */
function rowAt(n: number, at: number): PageChunkRow {
  const page = BILL_DOC.pages[n - 1];
  const row = onPage(n).find((r) => r.char_from - page.char_from <= at && at < r.char_to - page.char_from);
  assert(row, `no row on page ${n} at ${at}`);
  return row;
}
const localOf = (n: number, needle: string) => {
  const at = BILL_DOC.pages[n - 1].text.indexOf(needle);
  assert(at >= 0, `"${needle}" not on page ${n}`);
  return at;
};

Deno.test('page chunks: version 3 for pages, version 2 unchanged for documents', () => {
  assertEquals(PAGE_CHUNK_VERSION, 3);
  assertEquals(BILL.pageVersion, 3);
  assertEquals(CHUNK.version, 2);
});

Deno.test('bill: every row is an exact slice of its page and of ocr_text, and no row crosses a page', () => {
  assert(BILL.rows.length > 12);
  for (const r of BILL.rows) {
    const page = BILL_DOC.pages[r.page_number - 1];
    assertEquals(BILL_DOC.ocrText.slice(r.char_from, r.char_to), r.content);
    assert(r.char_from >= page.char_from && r.char_to <= page.char_to, `row ${r.chunk_index} leaves its page`);
    assertEquals(page.text.slice(r.char_from - page.char_from, r.char_to - page.char_from), r.content);
    assertEquals(r.unit_key, `page:${r.page_number}`);
    assertEquals(r.source_kind, 'pdf_page');
    assertEquals(r.token_estimate, Math.ceil(r.content.length / 4));
  }
  assertEquals(new Set(BILL.rows.map((r) => r.page_number)).size, 12);
});

Deno.test('bill: chunk_index is contiguous from 0 in page order, then by span', () => {
  assert(BILL.rows.length > 12);
  BILL.rows.forEach((r, i) => {
    assertEquals(r.chunk_index, i);
    if (i > 0) {
      const p = BILL.rows[i - 1];
      assert(
        p.page_number < r.page_number || (p.page_number === r.page_number && p.char_from < r.char_from),
        `row ${i} out of order`,
      );
    }
  });
});

Deno.test('bill: hashes are identity over (version 3, page key, content) and embed over the embedding input', async () => {
  assert(BILL.rows.length > 12);
  for (const r of BILL.rows) {
    assertEquals(r.chunk_hash, await sha256Hex(chunkHashInput(3, r.unit_key, r.content)));
    assertEquals(r.embed_hash, await sha256Hex(normalise(r.embedding_input)));
    assert(r.embedding_input.endsWith(r.content));
  }
});

Deno.test('bill sections: section 7 on page 4 has its own margin note, not the carried "Espionage."', () => {
  const r = rowAt(4, localOf(4, '7. In a prosecution under section 6'));
  assertEquals(r.section, {
    heading: 'CHAPTER III › OFFENCES AND PENALTIES',
    note: 'Presumption of prejudicial purpose.',
  });
  assert(
    r.embedding_input.startsWith('CHAPTER III › OFFENCES AND PENALTIES › Presumption of prejudicial purpose.\n\n'),
  );
  // Every row starting in section 7 after its "7." line keeps the note: the line has a note of its own.
  const next = localOf(4, 'Possession of classified material without authority.');
  const later = onPage(4).filter((row) => {
    const start = row.char_from - BILL_DOC.pages[3].char_from;
    return start > localOf(4, '7. In a prosecution') && start + 200 <= next;
  });
  assert(later.length > 0);
  for (const row of later) assertEquals(row.section.note, 'Presumption of prejudicial purpose.');
});

/** Rows of page 2 that start inside its 1,388-character definitions `list` block (block 5). */
function definitionsRows(): PageChunkRow[] {
  const [from, to] = [localOf(2, '2. In this Act'), localOf(2, '# CHAPTER II')];
  assertEquals(to - from, 1388 + 2, 'the list block, then a blank line');
  const rows = onPage(2).filter((r) => {
    const start = r.char_from - BILL_DOC.pages[1].char_from;
    return start > from && start < to;
  });
  assert(rows.length > 0, 'a row starts inside the definitions');
  return rows;
}

Deno.test('bill sections: page 2 definitions have heading "CHAPTER I PRELIMINARY" and note "Definitions."', () => {
  const chapter2 = localOf(2, '# CHAPTER II');
  const startOf = (r: PageChunkRow) => r.char_from - BILL_DOC.pages[1].char_from;
  const inside = definitionsRows().filter((r) => startOf(r) + 200 <= chapter2);
  assert(inside.length > 0);
  for (const r of inside) {
    assertEquals(r.section, { heading: 'CHAPTER I PRELIMINARY', note: 'Definitions.' });
    assert(r.embedding_input.startsWith('CHAPTER I PRELIMINARY › Definitions.\n\n'));
  }
  // A row starting within 200 characters of the next chapter takes that chapter (R2 window, replace).
  for (const r of definitionsRows().filter((r) => startOf(r) + 200 > chapter2)) {
    assertEquals(r.section.heading, 'CHAPTER II › CLASSIFICATION AND HANDLING OF INFORMATION');
  }
});

Deno.test('bill sections: a title run joins with › and drops a trailing margin line number', () => {
  const r = rowAt(2, localOf(2, '3. (1) The Central Government'));
  assertEquals(r.section.heading, 'CHAPTER II › CLASSIFICATION AND HANDLING OF INFORMATION');
});

Deno.test('bill sections: the back page "# A" title is not a heading; the previous heading carries over', () => {
  const rows = onPage(12);
  assert(rows.length > 0);
  for (const r of rows) {
    assertEquals(r.section, { heading: 'MEMORANDUM REGARDING DELEGATED LEGISLATION' });
  }
});

Deno.test('bill links: a chunk inside page 2 definitions links that list block, not the heading or a footer', () => {
  const listIndex = BILL_PAGES[1].blocks!.findIndex((b) => b.type === 'list' && b.content.startsWith('2. In this Act'));
  assertEquals(listIndex, 5);
  for (const r of definitionsRows()) {
    assert(r.block_refs.some((b) => b.page_number === 2 && b.block_index === listIndex), 'definitions block linked');
    assert(!r.block_refs.some((b) => b.block_index === 1), 'CHAPTER I title not linked');
  }
  for (const row of BILL.rows) {
    for (const ref of row.block_refs) {
      assertEquals(ref.page_number, row.page_number);
      const type = BILL_PAGES[ref.page_number - 1].blocks![ref.block_index].type;
      assert(type !== 'header' && type !== 'footer', `row ${row.chunk_index} links a ${type}`);
    }
  }
  // Page 12's footer lines are located in its text and overlap its last chunk, yet are not linked.
  const last = onPage(12).at(-1)!;
  assert(last.content.endsWith('RS-P&P-PMB(H)—329—08.12.2025.'));
});

// Synthetic pages: dimensions 1000×1000, so a box's pixel x is its normalised x × 1000.
const DIMS = { dpi: 100, width: 1000, height: 1000 };
function title(content: string): MistralBlock {
  return { type: 'title', content, top_left_x: 400, top_left_y: 50, bottom_right_x: 600, bottom_right_y: 80 };
}
function note(content: string): MistralBlock {
  return { type: 'text', content, top_left_x: 60, top_left_y: 100, bottom_right_x: 170, bottom_right_y: 130 };
}
function body(content: string): MistralBlock {
  return { type: 'text', content, top_left_x: 240, top_left_y: 100, bottom_right_x: 770, bottom_right_y: 900 };
}
async function pagesOf(specs: Array<{ markdown: string; blocks?: MistralBlock[]; images?: string[] }>) {
  const pages: MistralPage[] = specs.map((s, index) => ({
    index,
    markdown: s.markdown,
    dimensions: DIMS,
    blocks: s.blocks ?? [],
    images: (s.images ?? []).map((id) => ({ id })),
  }));
  const document = composeDocument(pages);
  return { document, ...(await chunkPages({ document, pages })) };
}
const TOKEN = '![img:3-0](img:3-0)';

Deno.test('placeholder atomicity: a hard cut that would fall inside an image token moves (option on only)', async () => {
  const text = 'x'.repeat(5995) + TOKEN + 'x'.repeat(200);
  const inside = (i: number) => i > 5995 && i < 5995 + TOKEN.length;
  const plain = chunkUnit({ unitKey: 'page:3', text, sourceKind: 'pdf_page', pageNumber: 3 });
  assert(plain.some((s) => inside(s.charFrom) || inside(s.charTo)), 'without the option the cut splits the token');
  const atomic = chunkUnit({ unitKey: 'page:3', text, sourceKind: 'pdf_page', pageNumber: 3 }, {}, {
    atomicPlaceholders: true,
  });
  assertExactSpans(text, atomic);
  for (const s of atomic) assert(!inside(s.charFrom) && !inside(s.charTo), `span ${s.charFrom}-${s.charTo}`);

  // Through chunkPages: page 3's image becomes img:3-0 and lands whole in exactly the rows that hold it.
  const out = await pagesOf([
    { markdown: 'First page.' },
    { markdown: 'Second page.' },
    { markdown: 'x'.repeat(5995) + '![img-0.jpeg](img-0.jpeg)' + 'x'.repeat(200), images: ['img-0.jpeg'] },
  ]);
  const p3 = out.rows.filter((r) => r.page_number === 3);
  assert(p3.length >= 2);
  for (const r of p3) {
    assertEquals(r.image_placeholders.length > 0, r.content.includes(TOKEN));
    if (r.content.includes(TOKEN)) assertEquals(r.image_placeholders, ['img:3-0']);
    assertEquals(r.content.includes('img:3-0'), r.content.includes(TOKEN), 'token cut');
  }
  assert(p3.some((r) => r.content.includes(TOKEN)));
});

Deno.test('placeholder atomicity: sentence splits and overlap starts never land inside a link token', () => {
  // Two fillers, chosen so that version 2 starts an overlap inside a token ('') and ends a span at a
  // sentence boundary inside one ('wwwwwww '), e.g. inside "[see s. 3. and the rest](s3)".
  const cases: Array<[string, 'charFrom' | 'charTo']> = [['', 'charFrom'], ['wwwwwww ', 'charTo']];
  for (const [filler, provoked] of cases) {
    const para = Array.from(
      { length: 40 },
      (_, i) => `Clause ${i} ${filler}refers to [see s. ${i}. and the rest](s${i}) here.`,
    ).join(' ');
    const tokens = [...para.matchAll(/!?\[[^\]\n]*\]\([^)\n]*\)/g)].map((m) => [m.index!, m.index! + m[0].length]);
    const inside = (i: number) => tokens.some(([a, b]) => i > a && i < b);
    const unit = { unitKey: 'page:1', text: para, sourceKind: 'pdf_page' as const, pageNumber: 1 };
    assert(chunkUnit(unit).some((s) => inside(s[provoked])), `without the option a ${provoked} lands in a token`);
    const atomic = chunkUnit(unit, {}, { atomicPlaceholders: true });
    assertExactSpans(para, atomic);
    for (const s of atomic) assert(!inside(s.charFrom) && !inside(s.charTo), `span ${s.charFrom}-${s.charTo}`);
  }
});

Deno.test('a chunk starting inside a table repeats its header only in the embedding input', async () => {
  const t = table(60);
  assert(t.length > CHUNK.tableAtomicMax);
  const out = await pagesOf([{ markdown: t }]);
  assert(out.rows.length >= 2);
  const [first, ...rest] = out.rows;
  assertEquals(first.embedding_input, first.content, 'the chunk that opens the table gets no repeat');
  for (const r of rest) {
    assert(!r.content.startsWith('| Page |'), 'content is untouched');
    assertEquals(out.document.ocrText.slice(r.char_from, r.char_to), r.content);
    assertEquals(r.embedding_input, '| Page | Column | For | Read |\n|---|---|---|---|\n' + r.content);
    assertEquals(r.embed_hash, await sha256Hex(normalise(r.embedding_input)));
  }
});

Deno.test('a heading edit changes embed_hash but not chunk_hash of a chunk whose text is unchanged', async () => {
  const long = Array.from({ length: 12 }, (_, i) => `Sentence ${i} of the second page, unchanged by the edit.`).join(
    ' ',
  );
  const run = (heading: string) =>
    pagesOf([
      { markdown: `# ${heading}\n\nIntro.`, blocks: [title(`# ${heading}`), body('Intro.')] },
      { markdown: long, blocks: [body(long)] },
    ]);
  const a = (await run('Part One')).rows.filter((r) => r.page_number === 2);
  const b = (await run('Part Two')).rows.filter((r) => r.page_number === 2);
  assertEquals(a.length, b.length);
  assert(a.length > 0);
  for (let i = 0; i < a.length; i++) {
    assertEquals(a[i].chunk_hash, b[i].chunk_hash);
    assertNotEquals(a[i].embed_hash, b[i].embed_hash);
    assertEquals(a[i].section, { heading: 'Part One' });
    assertEquals(b[i].embedding_input, `Part Two\n\n${b[i].content}`);
  }
});

Deno.test('sections: margin notes by geometry, cleared at a numbered section without its own note', async () => {
  const text = [
    'Punishments.',
    '5. Whoever does the first thing shall be punished.',
    '6. Whoever does the second thing shall also be punished.',
  ];
  const out = await pagesOf([{
    markdown: text.join('\n\n'),
    blocks: [note(text[0]), body(text[1]), body(text[2])],
  }]);
  assertEquals(out.rows.length, 1);
  // The row starts at the note, so the note applies; section 6 later clears it, which no row starts after.
  assertEquals(out.rows[0].section, { note: 'Punishments.' });
  assertEquals(out.rows[0].embedding_input, `Punishments.\n\n${out.rows[0].content}`);
  assertEquals(out.rows[0].block_refs, [0, 1, 2].map((block_index) => ({ page_number: 1, block_index })));

  // Across pages: page 2 starts with section 6 (no note of its own), so the carried note is cleared.
  const two = await pagesOf([
    { markdown: text.slice(0, 2).join('\n\n'), blocks: [note(text[0]), body(text[1])] },
    { markdown: text[2], blocks: [body(text[2])] },
    {
      markdown: 'A trailing paragraph with no section number.',
      blocks: [body('A trailing paragraph with no section number.')],
    },
  ]);
  assertEquals(two.rows.map((r) => r.section), [{ note: 'Punishments.' }, {}, {}]);
  assertEquals(two.rows[1].embedding_input, two.rows[1].content);
});

Deno.test('a page holding only an image yields no row; images elsewhere are still referenced', async () => {
  const out = await pagesOf([
    { markdown: 'Text on page one.' },
    { markdown: '![img-0.jpeg](img-0.jpeg)', images: ['img-0.jpeg'] },
    { markdown: 'Text on page three.' },
  ]);
  assertEquals(out.document.pages[1].text, '');
  assertEquals(out.rows.map((r) => [r.page_number, r.chunk_index]), [[1, 0], [3, 1]]);
});

Deno.test('rows with equal chunk_hash are de-duplicated, keeping the first, and indexes stay contiguous', async () => {
  const out = await pagesOf([{ markdown: 'y'.repeat(12_000) }, { markdown: 'Second page.' }]);
  // Version 2 splitting cuts 12,000 unbroken characters into two identical 6,000-character spans.
  const spans = chunkUnit({ unitKey: 'page:1', text: 'y'.repeat(12_000), sourceKind: 'pdf_page', pageNumber: 1 });
  assertEquals(spans.map((s) => s.content.length), [6000, 6000]);
  assertEquals(out.rows.map((r) => [r.page_number, r.chunk_index, r.char_from]), [[1, 0, 0], [2, 1, 12_002]]);
});
