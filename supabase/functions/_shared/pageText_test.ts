import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  composeDocument,
  inlineTables,
  isMarginNote,
  locateBlocks,
  type MistralPage,
  normaliseBox,
  normaliseChromeLine,
} from './pageText.ts';

// The real Mistral OCR response for the 12-page Classified Information and Espionage Control Bill, 2025
// (Rajya Sabha private member's bill; public parliamentary text). Chunk-contract spec, "Testing strategy".
const BILL = JSON.parse(
  await Deno.readTextFile(new URL('./__fixtures__/mistral-bill-12p.json', import.meta.url)),
) as { pages: MistralPage[] };
const DOC = composeDocument(BILL.pages);
const page = (n: number) => DOC.pages[n - 1];
const raw = (n: number) => BILL.pages[n - 1];

const DIMS = { dpi: 100, width: 1000, height: 1000 };
function synthetic(markdowns: string[], extra: Partial<MistralPage>[] = []): MistralPage[] {
  return markdowns.map((markdown, index) => ({ index, markdown, dimensions: DIMS, ...extra[index] }));
}
function box(x0: number, x1: number) {
  return { top_left_x: x0, top_left_y: 100, bottom_right_x: x1, bottom_right_y: 150 };
}

// ─── normaliseBox ────────────────────────────────────────────────────────────

Deno.test('normaliseBox is undefined without page dimensions or with a missing coordinate', () => {
  const b = { top_left_x: 10, top_left_y: 20, bottom_right_x: 30, bottom_right_y: 40 };
  assertEquals(normaliseBox(b, undefined), undefined);
  assertEquals(normaliseBox(b, null), undefined);
  assertEquals(normaliseBox(b, { width: 0, height: 100 }), undefined);
  assertEquals(normaliseBox({ ...b, bottom_right_y: undefined }, { width: 100, height: 100 }), undefined);
  assertEquals(normaliseBox({ ...b, top_left_x: null }, { width: 100, height: 100 }), undefined);
});

Deno.test('normaliseBox orders min/max and clamps to 0..1', () => {
  assertEquals(
    normaliseBox({ top_left_x: 30, top_left_y: 40, bottom_right_x: 10, bottom_right_y: 20 }, {
      width: 100,
      height: 200,
    }),
    { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.2 },
  );
  assertEquals(
    normaliseBox({ top_left_x: -5, top_left_y: -1, bottom_right_x: 150, bottom_right_y: 250 }, {
      width: 100,
      height: 200,
    }),
    { x0: 0, y0: 0, x1: 1, y1: 1 },
  );
});

// ─── R1.1 tables ─────────────────────────────────────────────────────────────

Deno.test('inlineTables replaces known placeholders and leaves and reports unknown ones', () => {
  const r = inlineTables('Before\n\n[tbl-0.md](tbl-0.md)\n\n[tbl-9.md](tbl-9.md)\n', [
    { id: 'tbl-0.md', content: '| a | b |\n|---|---|\n| 1 | 2 |', format: 'markdown' },
  ]);
  assertEquals(r.markdown, 'Before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[tbl-9.md](tbl-9.md)\n');
  assertEquals(r.unresolved, ['tbl-9.md']);
});

Deno.test('composeDocument reports an unresolved table placeholder with its page and keeps it', () => {
  const doc = composeDocument(synthetic(['Intro.', 'Rows:\n\n[tbl-3.md](tbl-3.md)'], [{}, { tables: [] }]));
  assertEquals(doc.unresolvedTables, [{ page_number: 2, id: 'tbl-3.md' }]);
  assertEquals(doc.pages[1].text, 'Rows:\n\n[tbl-3.md](tbl-3.md)');
});

// ─── R1.2 images ─────────────────────────────────────────────────────────────

Deno.test('image placeholders become img:<page>-<n>, n per page in order of appearance', () => {
  const doc = composeDocument(synthetic([
    'A ![img-0.jpeg](img-0.jpeg) B ![img-1.jpeg](img-1.jpeg)',
    'C ![img-2.jpeg](img-2.jpeg)',
  ]));
  assertEquals(doc.pages[0].text, 'A ![img:1-0](img:1-0) B ![img:1-1](img:1-1)');
  assertEquals(doc.pages[1].text, 'C ![img:2-0](img:2-0)');
  assertEquals(doc.imagePlaceholders, [
    { page_number: 1, id: 'img-0.jpeg', placeholder: 'img:1-0' },
    { page_number: 1, id: 'img-1.jpeg', placeholder: 'img:1-1' },
    { page_number: 2, id: 'img-2.jpeg', placeholder: 'img:2-0' },
  ]);
});

// ─── R1.4 empty pages ────────────────────────────────────────────────────────

Deno.test('a page with only an image placeholder gets text "" but keeps its image and its position', () => {
  const doc = composeDocument(synthetic(['First.', '![img-0.jpeg](img-0.jpeg)\n', 'Third.']));
  assertEquals(doc.pages.map((p) => p.text), ['First.', '', 'Third.']);
  assertEquals(doc.ocrText, 'First.\n\n\n\nThird.');
  assertEquals(doc.imagePlaceholders, [{ page_number: 2, id: 'img-0.jpeg', placeholder: 'img:2-0' }]);
  assertEquals([doc.pages[1].char_from, doc.pages[1].char_to], [8, 8]);
  for (const p of doc.pages) assertEquals(doc.ocrText.slice(p.char_from, p.char_to), p.text);
});

// ─── R1.3 headers and footers ────────────────────────────────────────────────

Deno.test('normaliseChromeLine: NFKC, lowercase, any-script digit runs to #, whitespace collapsed', () => {
  assertEquals(normaliseChromeLine('  Page\t12  of 3४ '), 'page # of #');
  assertEquals(normaliseChromeLine('पृष्ठ ३'), 'पृष्ठ #');
  assertEquals(normaliseChromeLine('ＰＡＧＥ　７'), 'page #');
});

Deno.test('a Devanagari page-number footer on 3 pages is running and not put back', () => {
  const doc = composeDocument(synthetic(['क', 'ख', 'ग'], [
    { footer: 'पृष्ठ ३' },
    { footer: 'पृष्ठ ४' },
    { footer: 'पृष्ठ ५' },
  ]));
  assertEquals(doc.pages.map((p) => p.text), ['क', 'ख', 'ग']);
  assertEquals(doc.pages.map((p) => p.footer_in_text), [false, false, false]);
  assertEquals(doc.pages.map((p) => p.footer), ['पृष्ठ ३', 'पृष्ठ ४', 'पृष्ठ ५']);
});

Deno.test('in a document of 4+ pages a line on 30% of pages is running', () => {
  // 2 of 4 pages = 50%; 2 < 3, so only the percentage rule makes it running.
  const doc = composeDocument(synthetic(['a', 'b', 'c', 'd'], [{ header: 'Draft 1' }, { header: 'Draft 2' }]));
  assertEquals(doc.pages.map((p) => p.text), ['a', 'b', 'c', 'd']);
});

Deno.test('a 2-page document treats every header line as unique and puts it back', () => {
  const doc = composeDocument(synthetic(['Body one.', 'Body two.'], [{ header: 'Gazette' }, { header: 'Gazette' }]));
  assertEquals(doc.pages.map((p) => p.text), ['Gazette\n\nBody one.', 'Gazette\n\nBody two.']);
  assertEquals(doc.pages.map((p) => p.header_in_text), [true, true]);
});

Deno.test('a unique header or footer already at the page edge is not duplicated', () => {
  const doc = composeDocument(synthetic(['  NOTICE\n\nBody.\n\nSigned, Clerk\n'], [{
    header: 'NOTICE',
    footer: 'Signed, Clerk',
  }]));
  assertEquals(doc.pages[0].text, 'NOTICE\n\nBody.\n\nSigned, Clerk');
  assertEquals([doc.pages[0].header_in_text, doc.pages[0].footer_in_text], [false, false]);
});

Deno.test('a multi-line header puts back only the lines missing from the page edge', () => {
  const doc = composeDocument(synthetic(['Line two\n\nBody.'], [{ header: 'Line one\nLine two' }]));
  assertEquals(doc.pages[0].text, 'Line one\n\nLine two\n\nBody.');
});

// ─── R1 on the real bill ─────────────────────────────────────────────────────

Deno.test('bill: the page-number footers 2..11 are running and dropped', () => {
  for (let n = 2; n <= 11; n++) {
    assertEquals(page(n).footer, String(n));
    assertEquals(page(n).footer_in_text, false);
    assertEquals(page(n).text, raw(n).markdown.trim(), `page ${n}`);
  }
});

Deno.test('bill: the page-1 header and the page-12 header and sponsor footer are unique and kept', () => {
  assertEquals(
    page(1).text.slice(0, 74),
    'AS INTRODUCED IN THE RAJYA SABHA\nON THE 5TH DECEMBER, 2025\n\n**Bill No. XLV',
  );
  assertEquals(page(1).header_in_text, true);
  assert(page(12).text.startsWith('RAJYA SABHA\n\n# A\nBILL\n'));
  assert(page(12).text.endsWith('incidental thereto.\n\n(Shri Sujeet Kumar, M.P.)\nRS-P&P-PMB(H)—329—08.12.2025.'));
  assertEquals([page(12).header_in_text, page(12).footer_in_text], [true, true]);
  assertEquals(page(12).footer, '(Shri Sujeet Kumar, M.P.)\nRS-P&P-PMB(H)—329—08.12.2025.');
});

Deno.test('bill: page offsets round-trip for all 12 pages and pages are joined by "\\n\\n"', () => {
  assertEquals(DOC.pages.length, 12);
  DOC.pages.forEach((p, i) => {
    assertEquals(p.page_number, i + 1);
    assert(p.text.length > 0);
    assertEquals(DOC.ocrText.slice(p.char_from, p.char_to), p.text);
    if (i > 0) assertEquals(p.char_from, DOC.pages[i - 1].char_to + 2);
  });
  assertEquals(DOC.pages[0].char_from, 0);
  assertEquals(DOC.pages[11].char_to, DOC.ocrText.length);
  assertEquals(DOC.ocrText, DOC.pages.map((p) => p.text).join('\n\n'));
  assertEquals([page(3).width_px, page(3).height_px, page(3).dpi], [720, 1018, 87]);
  assertEquals([DOC.unresolvedTables, DOC.imagePlaceholders], [[], []]);
});

// ─── R2 margin notes ─────────────────────────────────────────────────────────

Deno.test('bill: margin notes are found by geometry, whatever their type', () => {
  const notes: string[] = [];
  for (const p of BILL.pages) {
    for (const b of p.blocks ?? []) if (isMarginNote(b, p.dimensions)) notes.push(`${p.index + 1}:${b.content}`);
  }
  assert(notes.includes('2:Definitions.'));
  assert(notes.includes('4:Presumption of prejudicial purpose.'));
  assert(notes.includes('5:Public interest disclosure and whistleblower protection.'));
  assertEquals(notes.length, 22);
  assertEquals(raw(2).blocks![4].type, 'aside_text');
  assertEquals(raw(4).blocks![0].type, 'text');
});

Deno.test('bill: margin line numbers and the Act citation "5 of 1908." are not margin notes', () => {
  const p6 = raw(6);
  const lineNumbers = p6.blocks!.filter((b) => b.type === 'text' && /^\d+$/.test(b.content));
  assertEquals(lineNumbers.length, 10);
  for (const b of lineNumbers) assertEquals(isMarginNote(b, p6.dimensions), false, b.content);
  const citation = p6.blocks!.find((b) => b.content === '5 of 1908.')!;
  assertEquals(isMarginNote(citation, p6.dimensions), false);
});

Deno.test('isMarginNote: needs 3 letters, at most 150 chars, a margin box, a text type and dimensions', () => {
  const note = (content: string, x0 = 830, x1 = 920, type = 'text') => ({ type, content, ...box(x0, x1) });
  assertEquals(isMarginNote(note('Penalty.'), DIMS), true);
  assertEquals(isMarginNote(note('Penalty.', 70, 180, 'aside_text'), DIMS), true);
  assertEquals(isMarginNote(note('45'), DIMS), false);
  assertEquals(isMarginNote(note('(a)'), DIMS), false);
  assertEquals(isMarginNote(note('x'.repeat(151)), DIMS), false);
  assertEquals(isMarginNote(note('Penalty.', 820, 920), DIMS), true);
  assertEquals(isMarginNote(note('Penalty.', 810, 920), DIMS), false);
  assertEquals(isMarginNote(note('Penalty.', 70, 181), DIMS), false);
  assertEquals(isMarginNote(note('Penalty.', 830, 920, 'title'), DIMS), false);
  assertEquals(isMarginNote(note('12 of 2005'), DIMS), false);
  assertEquals(isMarginNote(note('Penalty.'), undefined), false);
});

// ─── R5 locating blocks ──────────────────────────────────────────────────────

Deno.test('bill: page 2 definitions list block is located with a span of its length', () => {
  const located = locateBlocks(page(2).text, raw(2).blocks!, raw(2).dimensions);
  const defs = located[5];
  assertEquals(defs.type, 'list');
  assertEquals(raw(2).blocks![5].content.length, 1388);
  assertEquals(defs.char_to! - defs.char_from!, 1388);
  assertEquals(page(2).text.slice(defs.char_from!, defs.char_to!), raw(2).blocks![5].content);
  assertEquals(defs.box, { x0: 177 / 720, y0: 400 / 1018, x1: 581 / 720, y1: 800 / 1018 });
});

Deno.test('bill: every body block is located in reading order; page-number footers are not', () => {
  for (const p of DOC.pages) {
    const blocks = raw(p.page_number).blocks!;
    const located = locateBlocks(p.text, blocks);
    let last = -1;
    located.forEach((l, i) => {
      assertEquals(l.block_index, i);
      if (blocks[i].type === 'header' || blocks[i].type === 'footer') return;
      assert(l.char_from !== null, `page ${p.page_number} block ${i}`);
      assert(l.char_from! >= last, `page ${p.page_number} block ${i} out of order`);
      last = l.char_to!;
    });
  }
  for (let n = 2; n <= 11; n++) {
    const footer = locateBlocks(page(n).text, raw(n).blocks!).find((l) => l.type === 'footer')!;
    assertEquals([footer.char_from, footer.char_to], [null, null], `page ${n}`);
  }
});

Deno.test('bill: put-back header and footer blocks are located at the page edges', () => {
  const p1 = locateBlocks(page(1).text, raw(1).blocks!);
  assertEquals([p1[0].type, p1[0].char_from, p1[0].char_to], ['header', 0, 58]);
  const p12 = locateBlocks(page(12).text, raw(12).blocks!);
  const t = page(12).text;
  assertEquals(t.slice(p12[3].char_from!, p12[3].char_to!), '(Shri Sujeet Kumar, M.P.)');
  assertEquals([p12[4].char_from, p12[4].char_to], [t.length - 29, t.length]);
});

Deno.test('locateBlocks matches whitespace-insensitively and maps back to exact offsets', () => {
  const text = 'Intro.\n\nThe  quick\nbrown   fox.\n\nEnd.';
  const [b] = locateBlocks(text, [{ type: 'text', content: 'The quick brown\nfox.' }]);
  assertEquals(text.slice(b.char_from!, b.char_to!), 'The  quick\nbrown   fox.');
  assertEquals(b.box, undefined);
});

Deno.test('locateBlocks strips leading markdown # and widens the span over the marker', () => {
  const text = 'Body.\n\n## CHAPTER II\nPRELIMINARY\n\nMore.';
  const [b] = locateBlocks(text, [{ type: 'title', content: '# CHAPTER II\nPRELIMINARY' }]);
  assertEquals(text.slice(b.char_from!, b.char_to!), '## CHAPTER II\nPRELIMINARY');
  const [c] = locateBlocks('Body.\n\nCHAPTER IV\n\nMore.', [{ type: 'title', content: '#### CHAPTER IV' }]);
  assertEquals([c.char_from, c.char_to], [7, 17]);
});

Deno.test('locateBlocks anchors header and footer blocks to the page edges and never moves the cursor', () => {
  // A running page-number header "3" was dropped from the text; a stray "3" further down must not
  // swallow it, or the body blocks before that "3" would be searched for after it and lost.
  const text = 'Clause one.\n\nClause 3 text.\n\nEnd.';
  const r = locateBlocks(text, [
    { type: 'header', content: '3' },
    { type: 'text', content: 'Clause one.' },
    { type: 'text', content: 'Clause 3 text.' },
    { type: 'footer', content: 'End.' },
  ]);
  assertEquals(r.map((l) => [l.char_from, l.char_to]), [[null, null], [0, 11], [13, 27], [29, 33]]);
});

Deno.test('locateBlocks searches forward: repeated content maps to successive occurrences', () => {
  const text = 'Alpha.\n\n5\n\nBeta.\n\n5\n\nGamma.';
  const r = locateBlocks(text, [
    { type: 'text', content: 'Alpha.' },
    { type: 'text', content: '5' },
    { type: 'text', content: 'Beta.' },
    { type: 'text', content: '5' },
    { type: 'text', content: 'Missing.' },
    { type: 'text', content: 'Gamma.' },
  ]);
  assertEquals(r.map((l) => l.char_from), [0, 8, 11, 18, null, 21]);
});
