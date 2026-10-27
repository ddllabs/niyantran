import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { resolvePersonaPrompt } from './personaPilot.ts';

function sources(published = true) {
  return {
    published: () => Promise.resolve(published),
    canEdit: () => Promise.resolve(published),
    active: () => Promise.resolve({ text: '  Published\nπ\n ', id: 'v2' }),
    bundled: () => Promise.resolve('  Default\n '),
  };
}
Deno.test('published consumer text is preserved exactly; ordinary callers retain bundled text', async () => {
  assertEquals((await resolvePersonaPrompt('student.md', sources())).text, '  Published\nπ\n ');
  assertEquals((await resolvePersonaPrompt('student.md', sources(false))).text, '  Default\n ');
});
Deno.test('unsaved probe text is exact and an unauthorized override is rejected', async () => {
  const text = '  Unsaved\nπ\n ';
  assertEquals((await resolvePersonaPrompt('student.md', sources(), text)).text, text);
  await assertRejects(() => resolvePersonaPrompt('student.md', sources(false), text), Error, 'admin');
});
Deno.test('storage outage falls back and reports why, never leaking the prompt in metadata', async () => {
  const result = await resolvePersonaPrompt('student.md', {
    ...sources(), active: () => Promise.reject(new Error('database unavailable')),
  });
  assertEquals(result.source, 'bundled_fallback');
  assertEquals(result.reason, 'storage_unavailable');
  assertEquals(result.text, '  Default\n ');
  assertEquals(result.hash.length, 64);
});
Deno.test('blank and oversized Unicode overrides fail before reaching a model', async () => {
  await assertRejects(() => resolvePersonaPrompt('student.md', sources(), ' \n '));
  await assertRejects(() => resolvePersonaPrompt('student.md', sources(), 'π'.repeat(50001)));
});

Deno.test('global consumers cannot submit editor overrides', async () => {
  await assertRejects(() => resolvePersonaPrompt('student.md', {
    ...sources(true), canEdit: () => Promise.resolve(false),
  }, 'unauthorized override'), Error);
});
Deno.test('admin can test editor text while published consumption is paused', async () => {
  assertEquals((await resolvePersonaPrompt('student.md', {
    ...sources(false), canEdit: () => Promise.resolve(true),
  }, 'admin draft')).text, 'admin draft');
});
