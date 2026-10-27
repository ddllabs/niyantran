import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { resolvePilotPersona } from './personaPilot.ts';

function sources(pilot = true) {
  return {
    pilot: () => Promise.resolve(pilot),
    active: () => Promise.resolve({ text: '  Published\nπ\n ', id: 'v2' }),
    bundled: () => Promise.resolve('  Default\n '),
  };
}
Deno.test('published pilot text is preserved exactly; ordinary callers retain bundled text', async () => {
  assertEquals((await resolvePilotPersona('student.md', sources())).text, '  Published\nπ\n ');
  assertEquals((await resolvePilotPersona('student.md', sources(false))).text, '  Default\n ');
});
Deno.test('unsaved probe text is exact and an unauthorized override is rejected', async () => {
  const text = '  Unsaved\nπ\n ';
  assertEquals((await resolvePilotPersona('student.md', sources(), text)).text, text);
  await assertRejects(() => resolvePilotPersona('student.md', sources(false), text), Error, 'pilot');
});
Deno.test('storage outage falls back and reports why, never leaking the prompt in metadata', async () => {
  const result = await resolvePilotPersona('student.md', {
    ...sources(), active: () => Promise.reject(new Error('database unavailable')),
  });
  assertEquals(result.source, 'bundled_fallback');
  assertEquals(result.reason, 'storage_unavailable');
  assertEquals(result.text, '  Default\n ');
  assertEquals(result.hash.length, 64);
});
Deno.test('blank and oversized Unicode overrides fail before reaching a model', async () => {
  await assertRejects(() => resolvePilotPersona('student.md', sources(), ' \n '));
  await assertRejects(() => resolvePilotPersona('student.md', sources(), 'π'.repeat(50001)));
});
