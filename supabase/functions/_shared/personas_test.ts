import { assert, assertEquals } from 'jsr:@std/assert';
import { PERSONA_MAP } from './personaMap.ts';
import { personaPrompt, PERSONA_PROMPTS } from './personas.ts';

// The bundled JSON must match the markdown on disk. A stale bundle would ship a
// prompt nobody reviewed; a missing one would reproduce the production failure
// where every turn died before reaching a model.
Deno.test('every persona in the map resolves to a bundled prompt', () => {
  for (const entry of PERSONA_MAP) {
    const text = personaPrompt(entry.prompt);
    assert(text, `no bundled prompt for ${entry.db} -> ${entry.prompt}`);
    assert(text.trim().length > 0, `${entry.prompt} is blank`);
  }
});

Deno.test('the default fallback prompt is bundled', () => {
  assert(personaPrompt('analyst.md'), 'analyst.md is the fallback and must ship');
});

Deno.test('personas.json is not stale', async () => {
  const dir = new URL('./personas/', import.meta.url);
  const onDisk: Record<string, string> = {};
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith('.md')) onDisk[e.name] = await Deno.readTextFile(new URL(e.name, dir));
  }
  assertEquals(
    Object.keys(PERSONA_PROMPTS).sort(),
    Object.keys(onDisk).sort(),
    'run `node scripts/build-personas.mjs`',
  );
  for (const [name, text] of Object.entries(onDisk)) {
    assertEquals(PERSONA_PROMPTS[name].replace(/\r\n/g, '\n'), text.replace(/\r\n/g, '\n'), `${name} differs; run \`node scripts/build-personas.mjs\``);
  }
});

Deno.test('academic resolves to its own prompt, not the UPSC exam prompt', () => {
  const academic = PERSONA_MAP.find((p) => p.db === 'academic');
  assertEquals(academic?.prompt, 'academic.md');
  assert(personaPrompt('academic.md'), 'academic.md must ship');
  assert(personaPrompt('academic.md') !== personaPrompt('student.md'), 'academic must differ from student');
});

Deno.test('an unknown persona file resolves to null rather than throwing', () => {
  assertEquals(personaPrompt('nope.md'), null);
});
