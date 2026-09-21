import { assertEquals } from 'jsr:@std/assert@1';
import { createAnswerDecoder } from './answerStream.ts';

const ENVELOPES = [
  { answer: 'Plain answer with [1] and [2].', sources: [{ id: 1, source: 'ref:abc123-1' }], follow_up_questions: [] },
  { answer: 'Line one\nLine "two" with a \\ backslash and a tab\tend', sources: [], follow_up_questions: ['x'] },
  { answer: 'Unicode: ₹1,200 crore — Lok Sabha; escaped é and emoji 😀', sources: [], follow_up_questions: [] },
  { answer: 'Braces inside: {"not":"json"} and more', sources: [], follow_up_questions: [] },
  { sources: [{ id: 1, source: 'ref:abc123-1' }], answer: 'Answer is not the first key', follow_up_questions: [] },
];

function feed(full: string, step: number): { streamed: string; decoder: ReturnType<typeof createAnswerDecoder> } {
  const d = createAnswerDecoder();
  let streamed = '';
  for (let i = 0; i < full.length; i += step) streamed += d.push(full.slice(i, i + step));
  return { streamed, decoder: d };
}

Deno.test('streamed one character at a time, the emitted text equals JSON.parse(full).answer', () => {
  for (const env of ENVELOPES) {
    const full = JSON.stringify(env);
    for (const step of [1, 3, 7, 1000]) {
      const { streamed, decoder } = feed(full, step);
      assertEquals(streamed, env.answer, `step ${step}: ${full.slice(0, 40)}`);
      assertEquals(decoder.text, env.answer);
      assertEquals(decoder.closed, true);
    }
  }
});

Deno.test('prose before the first { is never emitted; text after the answer closes is ignored', () => {
  const full = 'Sure! Here is the JSON you asked for:\n```json\n' +
    JSON.stringify({ answer: 'Real answer', sources: [], follow_up_questions: [] }) + '\n```';
  const { streamed } = feed(full, 5);
  assertEquals(streamed, 'Real answer');
});

Deno.test('a partial escape across deltas is held, not shown; unicode escapes split across deltas decode', () => {
  const d = createAnswerDecoder();
  assertEquals(d.push('{"answer":"a\\'), 'a');
  assertEquals(d.push('nb\\u00'), '\nb');
  assertEquals(d.push('e9c"}'), 'éc');
  assertEquals(d.closed, true);
});

Deno.test('opened reports whether anything was shown; reset restarts for a retried attempt; a null answer streams nothing', () => {
  const d = createAnswerDecoder();
  assertEquals(d.opened, false);
  d.push('{"sources":[],"answ');
  assertEquals(d.opened, false);
  d.push('er":"Hi');
  assertEquals(d.opened, true);
  d.reset();
  assertEquals(d.opened, false);
  assertEquals(d.push('{"answer":null}'), '');
  assertEquals(d.closed, true);
  assertEquals(d.text, '');
});

Deno.test('only a direct property of the top-level envelope can open the answer stream', () => {
  const full = JSON.stringify({
    metadata: { answer: 'nested decoy' },
    note: 'the text says "answer": "string decoy"',
    candidates: [{ answer: 'array decoy' }],
    answer: 'top-level answer',
    sources: [],
    follow_up_questions: [],
  });

  for (let split = 0; split <= full.length; split++) {
    const d = createAnswerDecoder();
    const streamed = d.push(full.slice(0, split)) + d.push(full.slice(split));
    assertEquals(streamed, 'top-level answer', `split at ${split}`);
    assertEquals(d.text, 'top-level answer');
    assertEquals(d.closed, true);
  }
});

Deno.test('answer-like text inside an earlier JSON string is not treated as a property', () => {
  const full = JSON.stringify({
    note: 'an example envelope says {"answer": "string decoy"}',
    answer: 'real answer',
    sources: [],
    follow_up_questions: [],
  });
  const { streamed, decoder } = feed(full, 1);
  assertEquals(streamed, 'real answer');
  assertEquals(decoder.text, 'real answer');
  assertEquals(decoder.closed, true);
});

Deno.test('malformed root grammar and a top-level array cannot expose an answer', () => {
  const malformed = createAnswerDecoder();
  assertEquals(malformed.push('{"note":"answer":"decoy","answer":"real"}'), '');
  assertEquals(malformed.closed, true);

  const array = createAnswerDecoder();
  assertEquals(array.push('[{"answer":"array decoy"}]'), '');
  assertEquals(array.closed, true);
});

Deno.test('a root array remains invalid after prose or a JSON fence opener', () => {
  for (const prefix of ['Some prose before the value: ', 'Some prose\n', '```json\n']) {
    const d = createAnswerDecoder();
    assertEquals(d.push(prefix + '[{"answer":"array decoy"}]'), '');
    assertEquals(d.closed, true);
  }
});

Deno.test('a surrogate pair split across unicode escapes is held until the whole character is available', () => {
  const d = createAnswerDecoder();
  assertEquals(d.push('{"answer":"cost \\uD83D'), 'cost ');
  assertEquals(d.push('\\uDE00'), '😀');
  assertEquals(d.push(' done"}'), ' done');
  assertEquals(d.text, 'cost 😀 done');
  assertEquals(d.closed, true);
});

Deno.test('a raw surrogate pair split across deltas is held until the complete character arrives', () => {
  const d = createAnswerDecoder();
  assertEquals(d.push('{"answer":"' + String.fromCharCode(0xd83d)), '');
  assertEquals(d.push(String.fromCharCode(0xde00) + '"}'), '😀');
  assertEquals(d.text, '😀');
  assertEquals(d.closed, true);
});

Deno.test('root key length and JSON nesting are bounded while large discarded strings are not answer text', () => {
  const longKey = createAnswerDecoder();
  assertEquals(longKey.push('{"' + 'k'.repeat(257) + '":0,"answer":"hidden"}'), '');
  assertEquals(longKey.closed, true);

  const deep = createAnswerDecoder();
  assertEquals(deep.push('{"note":' + '['.repeat(65) + '0' + ']'.repeat(65) + ',"answer":"hidden"}'), '');
  assertEquals(deep.closed, true);

  const largeNote = createAnswerDecoder();
  assertEquals(largeNote.push('{"note":"' + 'x'.repeat(1_000_000) + '","answer":"real"}'), 'real');
  assertEquals(largeNote.text, 'real');
});

Deno.test('a malformed answer closes without output and reset clears all parser state', () => {
  const d = createAnswerDecoder();
  assertEquals(d.push('prefix {"answer":null}'), '');
  assertEquals(d.closed, true);
  assertEquals(d.text, '');
  assertEquals(d.push('{"answer":"ignored until reset"}'), '');

  d.reset();
  assertEquals(d.closed, false);
  assertEquals(d.opened, false);
  assertEquals(d.text, '');
  assertEquals(d.push('{"other":{"answer":"nested"},"answer":"fresh"}'), 'fresh');
  assertEquals(d.closed, true);
});
