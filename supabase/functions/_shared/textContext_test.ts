import { assert, assertEquals } from 'jsr:@std/assert@1';
import { chunkTextWithContext } from './textContext.ts';
import { chunkDocument } from './chunking.ts';

Deno.test('context: short Markdown sections never pack together and source spans stay exact', async () => {
  const text = '# Powers\nFirst power.\n\n## Appeals\nSecond remedy.';
  const rows = await chunkTextWithContext(text);
  assertEquals(rows.length, 2);
  assertEquals(rows[1].section.heading, 'Powers › Appeals');
  assert(rows[1].embedding_input.startsWith('Powers › Appeals\n\n'));
  for (const r of rows) assertEquals(r.content, text.slice(r.charFrom, r.charTo));
});

Deno.test('context: arrangement labels cannot leak into bill body; chapter survives continuations', async () => {
  const text = 'ARRANGEMENT OF CLAUSES\nCHAPTER IX\nWRONG CONTEXT\n1. Definitions.\n\nBE it enacted by Parliament as follows:—\nCHAPTER I\nPRELIMINARY\n1. (1) This Act applies.\n' + 'A complete sentence about scope. '.repeat(100) + '\nDefinitions.    2. In this Act, unless otherwise required,—\nDefinitions follow.';
  const rows = await chunkTextWithContext(text);
  const body = rows.filter(r => r.charFrom >= text.indexOf('1. (1)'));
  assert(body.length > 2);
  for (const r of body) assertEquals(r.section.heading, 'CHAPTER I › PRELIMINARY');
  assertEquals(body.at(-1)!.section.note, 'Definitions. › 2.');
  assertEquals(rows[0].section, {});
  for (const r of rows) assertEquals(r.content, text.slice(r.charFrom, r.charTo));
});

Deno.test('context: identical continuation text under different headings has different vector identity', async () => {
  const content = 'The same complete sentence. '.repeat(100);
  const a = await chunkTextWithContext('# Powers\n' + content);
  const b = await chunkTextWithContext('# Appeals\n' + content);
  assertEquals(a.at(-1)!.content, b.at(-1)!.content);
  assert(a.at(-1)!.chunkHash !== b.at(-1)!.chunkHash);
  assert(a.at(-1)!.embed_hash !== b.at(-1)!.embed_hash);
  const legacy = await chunkDocument(content);
  assert(a.at(-1)!.chunkHash !== legacy.at(-1)!.chunkHash);
});

Deno.test('context: unstructured text remains exact and deterministic without fabricated labels', async () => {
  const text = 'Plain source paragraph. '.repeat(100);
  const rows = await chunkTextWithContext(text);
  for (const r of rows) {
    assertEquals(r.section, {});
    assertEquals(r.embedding_input, r.content);
    assertEquals(r.content, text.slice(r.charFrom, r.charTo));
  }
  assertEquals(rows, await chunkTextWithContext(text));
});

Deno.test('context: long Markdown tables repeat verified headers only in embedding inputs', async () => {
  const header = '| Item | Amount |\n| --- | --- |\n';
  const text = '# Accounts\n' + header + Array.from({ length: 100 }, (_, i) => `| ${i} | Amount ${i} |`).join('\n');
  const rows = await chunkTextWithContext(text);
  assert(rows.length > 1);
  assert(rows[1].embedding_input.startsWith('Accounts\n\n' + header));
  assertEquals(rows[1].content, text.slice(rows[1].charFrom, rows[1].charTo));
});

Deno.test('context: a schedule clears clause context and an unclosed TOC never invents body context', async () => {
  const text = 'BE it enacted as follows:—\nCHAPTER I\nPRELIMINARY\n1. (1) A rule.\nTHE SCHEDULE\n2. A schedule entry.';
  const rows = await chunkTextWithContext(text);
  assertEquals(rows.at(-1)!.section, { heading: 'THE SCHEDULE' });
  const toc = await chunkTextWithContext('ARRANGEMENT OF CLAUSES\nCHAPTER I\nPRELIMINARY\n1. Definitions.\nSome text without an enactment marker.');
  assert(toc.every(r => Object.keys(r.section).length === 0));
});

Deno.test('context: long OCR sentences hard-split at available whitespace instead of inside words', async () => {
  const text = 'continuation '.repeat(1100);
  const rows = await chunkTextWithContext(text);
  assert(rows.length > 1);
  for (const r of rows) {
    assert(r.content.length <= 6000);
    assert(!(r.charFrom > 0 && /\w/.test(text[r.charFrom - 1]) && /\w/.test(text[r.charFrom])));
    assert(!(r.charTo < text.length && /\w/.test(text[r.charTo - 1]) && /\w/.test(text[r.charTo])));
  }
});

Deno.test('context: quoted and later schedules plus extracted Acts clear preceding bill clause', async () => {
  const text = 'BE it enacted as follows:—\n1. (1) A rule.\n“THE FOURTH SCHEDULE.\n1. Schedule entry.\nEXTRACTS FROM THE ORIGINAL ACT\n2. Extracted provision.';
  const rows = await chunkTextWithContext(text);
  assertEquals(rows.at(-1)!.section, { heading: 'EXTRACTS FROM THE ORIGINAL ACT' });
  assertEquals(rows.at(-2)!.section, { heading: '“THE FOURTH SCHEDULE.' });
});

Deno.test('context: a short clause label stays with the following long paragraph in its own section', async () => {
  const text = 'BE it enacted as follows:—\nDefinitions.    2. In this Act,—\n' + 'A definition includes repeated source words '.repeat(60);
  const rows = await chunkTextWithContext(text);
  const definitions = rows.filter(r => r.section.note === 'Definitions. › 2.');
  assert(definitions.length > 0);
  assert(definitions[0].content.length >= 200);
  assert(definitions[0].content.startsWith('Definitions.'));
  for (const r of definitions) assertEquals(r.content, text.slice(r.charFrom, r.charTo));
});
