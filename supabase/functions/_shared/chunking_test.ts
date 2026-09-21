import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { CHUNK, chunkDocument, chunkHashInput, chunkUnit, estimateTokens } from './chunking.ts';

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
  const a = { unitKey: 'p1', text: 'A'.repeat(700) + ' ' + 'A'.repeat(699), sourceKind: 'pdf_page' as const, pageNumber: 1 };
  const b = { unitKey: 'p2', text: 'B'.repeat(700) + ' ' + 'B'.repeat(699), sourceKind: 'pdf_page' as const, pageNumber: 2 };
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
  const v1 = (await chunkDocument(doc)).map((r) => r.chunkHash);
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
