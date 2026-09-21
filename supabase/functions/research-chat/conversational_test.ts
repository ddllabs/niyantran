import { assert, assertEquals } from 'jsr:@std/assert@1';
import { isConversational } from './conversational.ts';

Deno.test('plain greetings and courtesies are recognised, punctuation and case aside', () => {
  for (const m of ['hi', 'Hi', 'HI!', '  hi  ', 'hi...', 'Hello there', 'good morning', 'Thanks!', 'namaste', 'ok']) {
    assert(isConversational(m), `should be conversational: ${JSON.stringify(m)}`);
  }
});

// A false positive answers a real question as small talk, which is far worse
// than a greeting getting the full treatment. These must all stay ordinary.
Deno.test('anything that asks something is an ordinary turn', () => {
  for (
    const m of [
      'hi, what changed in the Finance Bill?',
      'hello?',
      'what is the status of the Waterways Bill',
      'summarise the attached rows',
      'hi there, give me a briefing on Open Fronts',
      'thanks - now show me the Gaza ceasefire timeline',
      'okay so what happens next',
      'high court rulings this week',
      'hello world program',
      '',
      '   ',
    ]
  ) {
    assertEquals(isConversational(m), false, `should NOT be conversational: ${JSON.stringify(m)}`);
  }
});

Deno.test('null, undefined and long text are ordinary turns', () => {
  assertEquals(isConversational(null), false);
  assertEquals(isConversational(undefined), false);
  assertEquals(isConversational('hi '.repeat(40)), false);
});

// "hi" is a prefix of "high"; a prefix match would swallow real questions.
Deno.test('matching is exact, never a prefix', () => {
  assertEquals(isConversational('high'), false);
  assertEquals(isConversational('hey day'), false);
  assertEquals(isConversational('okra'), false);
});
